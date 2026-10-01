"""Website-scoped, immutable published catalogues with explicit supply components."""
from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from ..services.catalog import default_release, make_release, validate_release, asset_choices, credit_allowed
from ..services.errors import DomainError
from ..services.catalog_editor import choice_label, euro_to_cents, field_index


class CatalogRelease(models.Model):
    _name = "cs.prefab.catalog.release"
    _description = "Prefab catalog publication"
    _order = "id desc"
    _check_company_auto = True

    name = fields.Char(required=True, default="Nieuwe catalogus")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company)
    website_id = fields.Many2one("website", required=True, check_company=True,
                                default=lambda self: self.env["website"].search([("company_id", "=", self.env.company.id)], limit=1))
    state = fields.Selection([("draft", "Concept"), ("published", "Gepubliceerd"), ("retired", "Vorige versie")], default="draft", required=True, copy=False)
    revision = fields.Char(readonly=True, copy=False, index=True)
    catalog_json = fields.Json(required=True, default=lambda self: default_release()["catalog"])
    pricebook_json = fields.Json(required=True, default=lambda self: default_release()["pricebook"])
    price_mode = fields.Selection([("demonstration", "Demonstratie"), ("commercial", "Eigen goedgekeurde tarieven")], required=True, default="demonstration")
    commercial_reference = fields.Char(string="Bron / besluitreferentie", help="Herleidbare prijslijst of intern besluit; dit is geen automatisch goedgekeurde leveranciersinformatie.")
    commercial_terms = fields.Text(string="Prijs- en leveringsvoorwaarden")
    commercial_rates_confirmed = fields.Boolean(string="Eigen tarieven gecontroleerd", copy=False)
    commercial_scope_confirmed = fields.Boolean(string="Leveringsomvang gecontroleerd", copy=False)
    commercial_tax_confirmed = fields.Boolean(string="Btw en prijsvoorwaarden gecontroleerd", copy=False)
    approval_hash = fields.Char(readonly=True, copy=False)
    approved_by_id = fields.Many2one("res.users", readonly=True, copy=False)
    approved_at = fields.Datetime(readonly=True, copy=False)
    validation_summary = fields.Text(readonly=True, copy=False)
    commercial_approval_state = fields.Selection([("demonstration", "Demonstratie"), ("pending", "Nog niet goedgekeurd / gewijzigd"), ("approved", "Deze inhoud goedgekeurd")], compute="_compute_approval_state")
    option_ids = fields.One2many("cs.prefab.catalog.option", "release_id", copy=True)
    currency_id = fields.Many2one("res.currency", compute="_compute_price_summary")
    pricebook_version = fields.Char(string="Versie prijslijst", compute="_compute_price_summary")
    base_price_eur = fields.Monetary(string="Casco per m² excl. btw", compute="_compute_price_summary",
        help="Lineaire cascoprijs per m² vloer. Staat er een cascostaffel, dan rekent de configurator met de staffel en is "
             "dit alleen de terugval voor een oudere applicatieversie.")
    base_curve_summary = fields.Char(string="Cascostaffel", compute="_compute_price_summary",
        help="De cascoprijs volgens de maatentabel van de prijslijst: vaste basis + factor × (breedte × diepte in m²)^groeifactor, "
             "afgerond. Leeg: de casco wordt lineair per m² berekend. Wijzigen via Bewerken via nieuw concept → Basisprijzen.")
    setup_price_eur = fields.Monetary(string="Vaste startkosten excl. btw", compute="_compute_price_summary",
        help="Vaste post per aanvraag voor werkvoorbereiding, transport en plaatsing; een eigen regel in het voorstel.")
    vat_percent = fields.Integer(string="Btw (%)", compute="_compute_price_summary",
        help="Btw over het subtotaal. De prijzen in de catalogus zijn exclusief btw.")
    price_disclaimer = fields.Text(string="Prijstoelichting", compute="_compute_price_summary",
        help="De toelichting die de klant bij elke prijs en in het voorstel leest.")
    published_json = fields.Json(readonly=True, copy=False)
    published_at = fields.Datetime(readonly=True, copy=False)
    _revision_unique = models.Constraint("UNIQUE(revision)", "A catalog revision must be unique.")

    @api.model_create_multi
    def create(self, vals_list):
        for values in vals_list:
            if values.get("state", "draft") != "draft" or any(values.get(k) for k in ("revision", "published_json", "published_at", "approval_hash", "approved_by_id", "approved_at", "validation_summary")):
                raise UserError("Maak eerst een concept en gebruik Publiceren.")
        records = super().create(vals_list)
        for record in records:
            if not record.option_ids:
                release = make_release(record.catalog_json, record.pricebook_json)
                labels = {f["key"]: f["label"] for g in record.catalog_json["groups"] for f in g["fields"]}
                all_options = [(key, "*", policy) for key, policy in release["policies"].items()]
                all_options += [(key, value, choice) for key, policy in release["policies"].items() for value, choice in policy.get("choices", {}).items()]
                for key, value, policy in all_options:
                    self.env["cs.prefab.catalog.option"].create({"release_id": record.id, "key": key,
                        "value_key": value,
                        "name": labels.get(key, key), "visual_mode": policy["visualMode"], "asset_key": policy["assetKey"],
                        "component_ids": [(0, 0, {"role": c["role"], "status": c["status"], "pricing_basis": c["pricing"],
                            "unit_price_cents": c.get("unitPrice", 0), "option_prices_json": c.get("prices", {})}) for c in policy["components"]]})
        return records

    def write(self, values):
        self._lock_for_mutation()
        if any(record.state != "draft" for record in self):
            if values != {"state": "retired"}:
                raise UserError("Een gepubliceerde catalogus is onveranderlijk. Dupliceer naar een nieuw concept.")
        if any(key in values for key in ("revision", "published_json", "published_at", "approval_hash", "approved_by_id", "approved_at", "validation_summary")) or values.get("state") == "published":
            raise UserError("Gebruik Publiceren om de catalogus vast te leggen.")
        if set(values) - {"state"}:
            self._invalidate_approval()
        return super().write(values)

    def unlink(self):
        self._lock_for_mutation()
        if any(record.state != "draft" for record in self):
            raise UserError("Gepubliceerde catalogi blijven bewaard voor eerdere aanvragen.")
        return super().unlink()

    def _lock_for_mutation(self):
        if self.ids:
            self.env.cr.execute("SELECT id FROM cs_prefab_catalog_release WHERE id IN %s ORDER BY id FOR UPDATE", [tuple(self.ids)])
            self.invalidate_recordset(["state"])

    def _require_draft(self):
        self._lock_for_mutation()
        if any(record.state != "draft" for record in self):
            raise UserError("Bewerk alleen conceptcatalogi.")

    def _invalidate_approval(self):
        records = self.filtered(lambda r: r.approval_hash or r.validation_summary)
        if records:
            super(CatalogRelease, records).write({"approval_hash": False, "approved_by_id": False, "approved_at": False, "validation_summary": False})

    def action_new_draft(self):
        self.ensure_one()
        draft = self.copy({"name": self.name + " · nieuw concept", "state": "draft"})
        return {"type": "ir.actions.act_window", "res_model": self._name, "res_id": draft.id, "view_mode": "form", "target": "current"}

    @api.depends("pricebook_json")
    def _compute_price_summary(self):
        eur = self.env.ref("base.EUR")
        for record in self:
            book = record.pricebook_json or {}
            record.currency_id = eur
            record.pricebook_version = book.get("pricebookVersion", "")
            record.base_price_eur = book.get("basePerM2", 0) / 100
            curve = book.get("baseCurve")
            def nl(cents):  # € 29.750,00, the notation the rest of the Dutch back office shows
                return "€ " + "{:,.2f}".format(cents / 100).replace(",", " ").replace(".", ",").replace(" ", ".")
            record.base_curve_summary = (
                "{} + {} × m²^{} · afgerond op {}".format(nl(curve["fixed"]), nl(curve["factor"]), curve["exponent"], nl(curve["roundTo"]))
                if isinstance(curve, dict) and {"fixed", "factor", "exponent", "roundTo"} <= set(curve) else False)
            record.setup_price_eur = book.get("fixedSetup", 0) / 100
            record.vat_percent = book.get("vatRate", 0)
            record.price_disclaimer = book.get("disclaimer", "")

    def action_open_editor(self):
        self.ensure_one()
        return self.env["cs.prefab.catalog.editor"].open_release(self)

    def action_edit_new_draft(self):
        self.ensure_one()
        self.check_access("read")
        draft = self.copy({"name": self.name + " · nieuw concept", "state": "draft"})
        return self.env["cs.prefab.catalog.editor"].open_release(draft)

    def _content_bundle(self):
        self.ensure_one()
        policies = {}
        overrides = []
        for option in self.option_ids:
            policy = {"visualMode": option.visual_mode, "modelFidelity": "representative", "assetKey": option.asset_key or option.key,
                "components": [{"role": c.role, "status": c.status, "pricing": c.pricing_basis, "unitPrice": c.unit_price_cents,
                                "prices": c.option_prices_json or {}} for c in option.component_ids]}
            if option.value_key == "*":
                policies[option.key] = policy
            else:
                overrides.append((option.key, option.value_key, policy))
        for key, value, policy in overrides:
            if key not in policies:
                raise ValidationError("Maak eerst een standaardregel (*) voor: " + key)
            policies[key].setdefault("choices", {})[value] = policy
        book = dict(self.pricebook_json, priceMode=self.price_mode)
        if self.price_mode == "commercial":
            book.update(disclaimer=self.commercial_terms or "Conceptprijzen; nog niet commercieel goedgekeurd.", commercialReference=self.commercial_reference or "",
                commercialApprovalContext={"companyId": self.company_id.id, "websiteId": self.website_id.id},
                commercialChecks={"rates": self.commercial_rates_confirmed, "scope": self.commercial_scope_confirmed, "tax": self.commercial_tax_confirmed})
        return make_release(self.catalog_json, book, policies)

    def _commercial_missing(self):
        self.ensure_one()
        if self.price_mode != "commercial":
            return []
        checks = [(bool(self.commercial_reference and self.commercial_reference.strip()), "Een herleidbare bron- of besluitreferentie ontbreekt."),
            (bool(self.commercial_terms and self.commercial_terms.strip()), "Commerciële prijs- en leveringsvoorwaarden ontbreken."),
            (self.commercial_rates_confirmed, "De eigen tarieven zijn nog niet bevestigd."),
            (self.commercial_scope_confirmed, "De leveringsomvang is nog niet bevestigd."),
            (self.commercial_tax_confirmed, "Btw en prijsvoorwaarden zijn nog niet bevestigd."),
            (bool(self.pricebook_json.get("pricebookVersion")) and not self.pricebook_json["pricebookVersion"].upper().startswith("DEMO"), "Geef de eigen prijslijst een herkenbare versie zonder DEMO-prefix.")]
        return [message for valid, message in checks if not valid]

    def _draft_bundle(self, *, allow_unapproved=False):
        try:
            bundle = self._content_bundle()
            if self.price_mode == "commercial" and self.approval_hash == bundle["revision"] and not self._commercial_missing():
                bundle["commercialApproval"] = {"reference": self.commercial_reference, "contentRevision": self.approval_hash,
                    "approvedById": self.approved_by_id.id, "approvedAt": fields.Datetime.to_string(self.approved_at)}
            if not allow_unapproved and self.price_mode == "commercial" and self._commercial_missing():
                raise ValidationError("\n".join(self._commercial_missing()))
            return validate_release(bundle, allow_unapproved=allow_unapproved)
        except DomainError as exc:
            raise ValidationError(str(exc)) from None
        except (KeyError, TypeError, ValueError) as exc:
            raise ValidationError("Ongeldige catalogusstructuur: " + type(exc).__name__) from None

    @api.depends("company_id", "website_id", "price_mode", "catalog_json", "pricebook_json", "commercial_reference", "commercial_terms", "commercial_rates_confirmed", "commercial_scope_confirmed", "commercial_tax_confirmed", "approval_hash", "option_ids.key", "option_ids.value_key", "option_ids.visual_mode", "option_ids.asset_key", "option_ids.component_ids.role", "option_ids.component_ids.status", "option_ids.component_ids.pricing_basis", "option_ids.component_ids.unit_price_cents", "option_ids.component_ids.option_prices_json")
    def _compute_approval_state(self):
        for record in self:
            record.commercial_approval_state = "demonstration" if record.price_mode == "demonstration" else "pending"
            if record.price_mode == "commercial" and record.approval_hash:
                try:
                    if record.approval_hash == record._content_bundle()["revision"] and not record._commercial_missing():
                        record.commercial_approval_state = "approved"
                except (KeyError, TypeError, ValueError, ValidationError):
                    pass

    def action_validate_draft(self):
        self.ensure_one()
        self.check_access("write")
        self._require_draft()
        self._draft_bundle(allow_unapproved=True)
        missing = self._commercial_missing()
        summary = "Schema, prijzen, leveringsregels en geometrie zijn geldig."
        if missing:
            summary += "\nNog nodig voor commerciële publicatie:\n" + "\n".join(missing)
        elif self.price_mode == "commercial" and self.commercial_approval_state != "approved":
            summary += "\nGebruik Commercieel goedkeuren om deze exacte inhoud vast te leggen."
        super(CatalogRelease, self).write({"validation_summary": summary})
        return {"type": "ir.actions.client", "tag": "display_notification", "params": {"title": "Concept gecontroleerd", "message": summary, "sticky": True, "type": "warning" if missing else "success"}}

    def action_approve_commercial(self):
        self.ensure_one()
        self.check_access("write")
        self._require_draft()
        if self.price_mode != "commercial":
            raise UserError("Kies eerst Eigen goedgekeurde tarieven en voer de echte prijsgegevens in.")
        bundle = self._draft_bundle(allow_unapproved=True)
        if self._commercial_missing():
            raise UserError("\n".join(self._commercial_missing()))
        super(CatalogRelease, self).write({"approval_hash": bundle["revision"], "approved_by_id": self.env.user.id, "approved_at": fields.Datetime.now(),
            "validation_summary": "Deze exacte prijs-, scope- en modelinhoud is commercieel goedgekeurd. Elke wijziging vereist een nieuwe goedkeuring."})
        return {"type": "ir.actions.client", "tag": "display_notification", "params": {"title": "Commerciële inhoud goedgekeurd", "message": "De catalogus is nog niet gepubliceerd.", "type": "success"}}

    def action_preview(self):
        self.ensure_one()
        self.check_access("write")
        self._require_draft()
        self._draft_bundle(allow_unapproved=True)
        domain = (self.website_id.domain or "").rstrip("/")
        return {"type": "ir.actions.act_url", "url": f"{domain}/prefab?catalog_preview={self.id}", "target": "new"}

    def action_publish(self):
        self.ensure_one()
        self.check_access("write")
        self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"prefab-catalog:{self.website_id.id}",))
        self._require_draft()
        bundle = self._draft_bundle()
        self.search([("website_id", "=", self.website_id.id), ("company_id", "=", self.company_id.id), ("state", "=", "published")]).write({"state": "retired"})
        bundle["revision"] = f"odoo-{self.company_id.id}-{self.website_id.id}-{self.id}-{bundle['revision'][6:]}"
        super(CatalogRelease, self).write({"state": "published", "revision": bundle["revision"], "published_json": bundle, "published_at": fields.Datetime.now()})
        return {"type": "ir.actions.client", "tag": "display_notification", "params": {"title": "Catalogus gepubliceerd", "message": "Nieuwe aanvragen gebruiken deze versie; eerdere aanvragen blijven onveranderd.", "type": "success", "sticky": False}}


class CatalogOption(models.Model):
    _name = "cs.prefab.catalog.option"
    _description = "Prefab option supply policy"
    _order = "key,id"

    release_id = fields.Many2one("cs.prefab.catalog.release", required=True, ondelete="cascade")
    release_state = fields.Selection(related="release_id.state", readonly=True)
    company_id = fields.Many2one(related="release_id.company_id", store=True, readonly=True)
    key = fields.Char(required=True)
    value_key = fields.Char(string="Optiewaarde", required=True, default="*", help="* geldt voor alle waarden. Een specifieke waarde, bijvoorbeeld left of both, vervangt de volledige leveringsregel voor die keuze.")
    name = fields.Char(required=True)
    choice_name = fields.Char(string="Geldt voor", compute="_compute_choice_name")
    field_name = fields.Char(string="Onderdeel", compute="_compute_choice_name")
    visual_mode = fields.Selection([("representative", "Voorbeeldapparaat"), ("product", "Productmodel"), ("preparation", "Voorbereidingspunt"), ("none", "Niet tonen")], default="representative", required=True)
    asset_key = fields.Selection(selection=lambda self: asset_choices(), help="Kies een ondersteund voorbeeldmodel voor dit onderdeel. Radiator: verticale buizen of horizontaal paneel; plafondlamp: kegel of koepel. Dit is geen merk- of producttoezegging.")
    component_ids = fields.One2many("cs.prefab.catalog.component", "option_id", copy=True)
    _key_unique = models.Constraint("UNIQUE(release_id,key,value_key)", "Each option value has one supply policy per catalog.")

    @api.depends("release_id.catalog_json", "key", "value_key", "name")
    def _compute_choice_name(self):
        for record in self:
            catalog = record.release_id.catalog_json or {"groups": []}
            record.field_name = field_index(catalog).get(record.key, {}).get("label", record.name)
            record.choice_name = "Alle keuzes (standaardregel)" if record.value_key == "*" else choice_label(catalog, record.key, record.value_key)

    def action_open_policy(self):
        self.ensure_one()
        self.check_access("read")
        return {"type": "ir.actions.act_window", "res_model": self._name, "res_id": self.id, "view_mode": "form", "target": "current",
            "views": [(self.env.ref("cs_prefab_configurator.view_prefab_catalog_option_form").id, "form")]}

    def action_back_catalog(self):
        self.ensure_one()
        return {"type": "ir.actions.act_window", "res_model": self.release_id._name, "res_id": self.release_id.id, "view_mode": "form", "target": "current"}

    @api.model_create_multi
    def create(self, vals_list):
        releases = self.env["cs.prefab.catalog.release"].browse([v.get("release_id") for v in vals_list])
        releases._require_draft()
        releases._invalidate_approval()
        return super().create(vals_list)

    def write(self, values):
        target = self.env["cs.prefab.catalog.release"].browse(values.get("release_id"))
        (self.release_id | target)._require_draft()
        (self.release_id | target)._invalidate_approval()
        return super().write(values)

    def unlink(self):
        self.release_id._require_draft()
        self.release_id._invalidate_approval()
        return super().unlink()


class CatalogComponent(models.Model):
    _name = "cs.prefab.catalog.component"
    _description = "Prefab delivery component"
    _order = "id"

    option_id = fields.Many2one("cs.prefab.catalog.option", required=True, ondelete="cascade")
    company_id = fields.Many2one(related="option_id.company_id", store=True, readonly=True)
    role = fields.Selection([("preparation", "Voorbereiding"), ("product", "Product"), ("installation", "Montage"), ("connection", "Aansluiting")], required=True)
    status = fields.Selection([("excluded", "Niet inbegrepen"), ("included", "In casco inbegrepen"), ("extra", "Apart geprijsd")], required=True, default="excluded")
    pricing_basis = fields.Selection([("option", "Optiepakket"), ("count", "Per positie / stuk"), ("area", "Per m² vloer"), ("fixed", "Vaste post")], required=True, default="count")
    unit_price_cents = fields.Integer(string="Eenheidsprijs excl. btw (eurocenten)", default=0)
    option_prices_json = fields.Json(string="Pakketprijzen per optiewaarde (eurocenten)", default=dict)
    currency_id = fields.Many2one(related="option_id.release_id.currency_id", readonly=True)
    unit_price_eur = fields.Monetary(string="Eenheidsprijs excl. btw", compute="_compute_price_eur", inverse="_inverse_price_eur")
    package_price_count = fields.Integer(string="Pakketprijzen", compute="_compute_price_eur")
    _role_unique = models.Constraint("UNIQUE(option_id,role)", "Define each component role once per option.")
    _price_nonnegative = models.Constraint("CHECK(unit_price_cents >= 0)", "A component price cannot be negative.")

    @api.depends("unit_price_cents", "option_prices_json")
    def _compute_price_eur(self):
        for record in self:
            record.unit_price_eur = record.unit_price_cents / 100
            record.package_price_count = len(record.option_prices_json or {})

    def _inverse_price_eur(self):
        for record in self:
            record.unit_price_cents = euro_to_cents(record.unit_price_eur)

    def action_edit_prices(self):
        self.ensure_one()
        return self.option_id.release_id.action_open_editor()

    @api.constrains("option_prices_json", "unit_price_cents", "role", "pricing_basis")
    def _check_prices(self):
        for record in self:
            value = record.option_prices_json or {}
            credit = credit_allowed(record.option_id.key, record.role, record.pricing_basis)
            if not isinstance(value, dict) or any(not isinstance(k, str) or type(v) is not int or v < 0 and not credit for k, v in value.items()):
                raise ValidationError("Pakketprijzen moeten optiewaarden naar gehele eurocenten koppelen. Alleen een productpakket "
                                      "(Optiepakket) mag een negatieve minderprijs hebben; voorzieningen en prijzen per m² of per stuk niet.")

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [self._convert_euro_values(values) for values in vals_list]
        releases = self.env["cs.prefab.catalog.option"].browse([v.get("option_id") for v in vals_list]).release_id
        releases._require_draft()
        releases._invalidate_approval()
        return super().create(vals_list)

    def write(self, values):
        values = self._convert_euro_values(values)
        target = self.env["cs.prefab.catalog.option"].browse(values.get("option_id"))
        (self.option_id | target).release_id._require_draft()
        (self.option_id | target).release_id._invalidate_approval()
        return super().write(values)

    @api.model
    def _convert_euro_values(self, values):
        values = dict(values)
        if "unit_price_eur" in values:
            try:
                cents = euro_to_cents(values.pop("unit_price_eur"))
            except ValueError as exc:
                raise ValidationError(str(exc)) from None
            if "unit_price_cents" in values and values["unit_price_cents"] != cents:
                raise ValidationError("De EUR-prijs en eurocentprijs spreken elkaar tegen.")
            values["unit_price_cents"] = cents
        return values

    def unlink(self):
        self.option_id.release_id._require_draft()
        self.option_id.release_id._invalidate_approval()
        return super().unlink()

"""Native customer, CRM, quotation and project flow for immutable prefab requests."""
import hashlib
import logging

import psycopg2
from markupsafe import Markup, escape
from odoo import api, fields, models, Command
from odoo.exceptions import UserError

from ..services.sales_projection import sales_rows, row_total, request_summary


_logger = logging.getLogger(__name__)
QUIET = dict(mail_create_nosubscribe=True, mail_create_nolog=True, tracking_disable=True)


class PrefabCompany(models.Model):
    _inherit = "res.company"

    prefab_sales_user_id = fields.Many2one("res.users", string="Prefab verkoopverantwoordelijke",
        domain=[("share", "=", False), ("active", "=", True)], check_company=True,
        help="Nieuwe prefab-aanvragen worden aan deze gebruiker toegewezen. Anders wordt een bestaande klantverantwoordelijke of interne bedrijfsgebruiker gebruikt.")


class PrefabProduct(models.Model):
    _inherit = "product.template"

    prefab_item_key = fields.Char(index=True, copy=False, readonly=True)
    _prefab_product_unique = models.Constraint("UNIQUE(company_id, prefab_item_key)", "Dit prefab-onderdeel heeft al een product in dit bedrijf.")


class PrefabQuoteNative(models.Model):
    _inherit = "cs.prefab.quote"

    partner_id = fields.Many2one("res.partner", string="Klant", readonly=True, check_company=True, ondelete="set null")
    sale_order_id = fields.Many2one("sale.order", string="Verkoopofferte", readonly=True, check_company=True, ondelete="set null")
    native_error = fields.Text(string="Verkoopofferte aanvullen", readonly=True)
    project_id = fields.Many2one(related="sale_order_id.project_id", string="Project")
    native_order_state = fields.Selection(related="sale_order_id.state", string="Offertestatus")
    currency_id = fields.Many2one("res.currency", compute="_compute_readable")
    amount_untaxed = fields.Monetary(compute="_compute_readable", string="Aanvraag excl. btw")
    amount_tax = fields.Monetary(compute="_compute_readable", string="Btw aanvraag")
    amount_total = fields.Monetary(compute="_compute_readable", string="Aanvraag incl. btw")
    width_cm = fields.Float(compute="_compute_readable", string="Breedte (cm)")
    depth_cm = fields.Float(compute="_compute_readable", string="Diepte (cm)")
    height_cm = fields.Float(compute="_compute_readable", string="Hoogte (cm)")
    area_m2 = fields.Float(compute="_compute_readable", string="Oppervlakte (m²)", digits=(16, 4))
    contact_name = fields.Char(compute="_compute_readable", string="Naam bij aanvraag")
    contact_email = fields.Char(compute="_compute_readable", string="E-mail bij aanvraag")
    contact_phone = fields.Char(compute="_compute_readable", string="Telefoon bij aanvraag")
    contact_street = fields.Char(compute="_compute_readable", string="Uitvoeringsadres")
    contact_zip = fields.Char(compute="_compute_readable", string="Postcode")
    contact_city = fields.Char(compute="_compute_readable", string="Plaats")
    contact_message = fields.Text(compute="_compute_readable", string="Klantopmerking")
    config_line_ids = fields.One2many("cs.prefab.quote.selection", "quote_id", string="Ingediende keuzes", readonly=True)
    price_line_ids = fields.One2many("cs.prefab.quote.line", "quote_id", string="Prijs en levering bij aanvraag", readonly=True)
    visual_ids = fields.One2many("cs.prefab.quote.visual", "quote_id", string="Ontwerpbeelden", readonly=True)

    @api.model
    def _configure_unit_precision(self):
        # Centimetre dimensions produce four decimal places in square metres.
        # Use Odoo's shared native precision rather than changing sale fields.
        precision = self.env["decimal.precision"].search([("name", "=", "Product Unit")], limit=1)
        if precision and precision.digits < 4:
            precision.write({"digits": 4})

    @api.depends("snapshot_json", "contact_json", "company_id")
    def _compute_readable(self):
        for record in self:
            snapshot, contact = record.snapshot_json or {}, record.contact_json or {}
            price, config = snapshot.get("price", {}), snapshot.get("config", {})
            record.currency_id = self.env["res.currency"].search([("name", "=", price.get("currency", "EUR"))], limit=1) or record.company_id.currency_id
            record.amount_untaxed = price.get("subtotal", 0) / 100
            record.amount_tax = price.get("vat", 0) / 100
            record.amount_total = price.get("total", 0) / 100
            record.width_cm, record.depth_cm, record.height_cm = config.get("width", 0), config.get("depth", 0), config.get("height", 0)
            record.area_m2 = price.get("areaM2", record.width_cm * record.depth_cm / 10000)
            record.contact_name, record.contact_email, record.contact_phone = contact.get("name", ""), contact.get("email", ""), contact.get("phone", "")
            record.contact_street = " ".join(str(contact.get(key, "")) for key in ("address", "houseNumber")).strip()
            record.contact_zip, record.contact_city, record.contact_message = contact.get("postcode", ""), contact.get("city", ""), contact.get("message", "")

    def _lock(self, suffix):
        key = hashlib.sha256(f"prefab:{self.company_id.id}:{suffix}".encode()).hexdigest()
        self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (key,))

    def _ensure_readable_rows(self):
        for record in self:
            if not record.config_line_ids:
                self.env["cs.prefab.quote.selection"].sudo().create([
                    {"quote_id": record.id, "sequence": index, "name": row["label"], "value": str(row["value"])}
                    for index, row in enumerate(record.snapshot_json.get("labels", []))])
            if not record.price_line_ids:
                self.env["cs.prefab.quote.line"].sudo().create([
                    {"quote_id": record.id, "sequence": index, "name": row["name"], "role_label": row["roleLabel"],
                     "status_label": row["statusLabel"], "quantity": row["quantity"], "unit_label": row["unit"],
                     "unit_price": row["unitPrice"] / 100, "amount_total": row_total(row)}
                    for index, row in enumerate(sales_rows(record.snapshot_json))])
            if not record.visual_ids:
                self.env["cs.prefab.quote.visual"].sudo().create([
                    {"quote_id": record.id, "sequence": index, "name": row["label"], "image_1920": row["dataUrl"].split(",", 1)[1]}
                    for index, row in enumerate(record.snapshot_json.get("visuals", {}).get("views", []))])

    def _responsible_user(self, partner):
        self.ensure_one()
        candidates = self.lead_id.user_id | self.company_id.prefab_sales_user_id | partner.user_id | self.env.ref("base.user_admin")
        allowed = candidates.filtered(lambda user: user.active and not user.share and self.company_id in user.company_ids)
        return allowed[:1] or self.env["res.users"].sudo().search([("active", "=", True), ("share", "=", False), ("company_ids", "in", self.company_id.ids)], limit=1)

    def _ensure_customer(self):
        self.ensure_one()
        if self.partner_id:
            return self.partner_id
        if self.lead_id.partner_id:
            partner = self.lead_id.partner_id
            if partner.company_id and partner.company_id != self.company_id:
                raise UserError("De CRM-klant hoort bij een ander bedrijf.")
            return partner
        contact = self.contact_json
        self._lock("customer:" + contact.get("email", "").strip().lower() + ":" + contact.get("name", "").strip().lower())
        partners = self.env["res.partner"].sudo().with_company(self.company_id).with_context(**QUIET)
        # An anonymous submission never changes an existing customer's master data.
        matches = partners.search([("company_id", "in", [False, self.company_id.id]), ("type", "=", "contact"),
                                   ("email", "=ilike", contact.get("email", "")), ("name", "=ilike", contact.get("name", ""))], limit=2)
        if len(matches) == 1:
            return matches
        return partners.create({"name": contact.get("name") or self.name, "email": contact.get("email"), "phone": contact.get("phone"),
            "street": self.contact_street, "zip": contact.get("postcode"), "city": contact.get("city"),
            "country_id": self.env.ref("base.nl").id, "company_id": self.company_id.id, "customer_rank": 1,
            "lang": self.env["res.lang"].sudo().search([("code", "=", "nl_NL"), ("active", "=", True)], limit=1).code or self.company_id.partner_id.lang or "en_US"})

    def _delivery_partner(self, partner):
        self.ensure_one()
        address = {"street": self.contact_street, "zip": self.contact_zip, "city": self.contact_city}
        if all((partner[key] or "").strip().casefold() == (value or "").strip().casefold() for key, value in address.items()):
            return partner
        self._lock("delivery:" + str(partner.id) + ":" + self.contact_street + ":" + self.contact_zip)
        model = self.env["res.partner"].sudo().with_company(self.company_id).with_context(**QUIET)
        domain = [("parent_id", "=", partner.id), ("type", "=", "delivery"), ("company_id", "in", [False, self.company_id.id])]
        domain += [(key, "=ilike", value) for key, value in address.items()]
        return model.search(domain, limit=1) or model.create(dict(address, name=partner.name, parent_id=partner.id, type="delivery",
            country_id=self.env.ref("base.nl").id, company_id=self.company_id.id))

    def _native_tax(self):
        rate = float(self.snapshot_json["price"]["vatRate"])
        taxes = self.env["account.tax"].sudo().with_company(self.company_id)
        default = self.company_id.account_sale_tax_id
        if default and default.active and default.type_tax_use == "sale" and default.amount_type == "percent" and not default.price_include and default.amount == rate:
            return default
        match = taxes.search([("company_id", "=", self.company_id.id), ("type_tax_use", "=", "sale"), ("amount_type", "=", "percent"),
                              ("amount", "=", rate), ("price_include", "=", False)], limit=1)
        if match:
            return match
        # No guessed tax configuration: keep a saved request available for review.
        raise UserError("Stel voor dit bedrijf een verkoopbelasting van %s%% exclusief btw in voordat de verkoopofferte wordt aangemaakt." % rate)

    def _native_product(self, row, tax):
        unit = row["unit"]
        uom = self.env.ref("uom.product_uom_square_meter" if unit == "m²" else "cs_prefab_configurator.uom_prefab_post" if unit == "post" else "uom.product_uom_unit")
        key = row["key"] + ":" + unit
        self._lock("product:" + key)
        products = self.env["product.product"].sudo().with_company(self.company_id).with_context(**QUIET)
        product = products.with_context(active_test=False).search([("prefab_item_key", "=", key), ("company_id", "=", self.company_id.id)], limit=1)
        if product and not product.active:
            # A second product would violate UNIQUE(company_id, prefab_item_key) and lose the whole request.
            raise UserError("Prefabproduct '%s' is gearchiveerd. Activeer het product of pas de catalogus aan en maak daarna de verkoopofferte opnieuw; de aanvraag is bewaard." % product.display_name)
        if not product:
            product = products.create({"name": "Prefab · " + row["name"].split(": ", 1)[0], "prefab_item_key": key,
                "default_code": "PREFAB-" + hashlib.sha256(key.encode()).hexdigest()[:12].upper(), "type": "service",
                "sale_ok": True, "purchase_ok": False, "company_id": self.company_id.id, "uom_id": uom.id,
                "invoice_policy": "order", "service_tracking": "project_only" if row["key"] == "base" else "no",
                "list_price": 0, "taxes_id": [Command.set(tax.ids)]})
            product.product_tmpl_id._prefab_initialize_purchase_vendor()
        return product, uom

    def _native_line_commands(self, order, tax):
        commands = []
        excluded = []
        mapped_tax = order.fiscal_position_id.map_tax(tax) if order.fiscal_position_id else tax
        for row in sales_rows(self.snapshot_json):
            if row["status"] == "excluded":
                excluded.append(row["name"])
                continue
            product, uom = self._native_product(row, tax)
            name = row["name"] + (" — inbegrepen in casco" if row["status"] == "included" else "")
            commands.append(Command.create({"name": name, "product_id": product.id, "product_uom_qty": row["quantity"],
                "product_uom_id": uom.id, "price_unit": row["unitPrice"] / 100, "tax_ids": [Command.set(mapped_tax.ids)],
                "prefab_component_key": row["key"], "sequence": len(commands) + 10}))
        if excluded:
            commands.append(Command.create({"display_type": "line_note", "name": "Niet inbegrepen:\n" + "\n".join(excluded), "sequence": len(commands) + 20}))
        return commands

    def _ensure_native_documents(self):
        for original in self:
            record = original.sudo().with_company(original.company_id).with_context(**QUIET)
            record._lock("request:" + str(record.id))
            record.invalidate_recordset(["partner_id", "sale_order_id"])
            record._ensure_readable_rows()
            if record.sale_order_id:
                continue
            partner = record._ensure_customer()
            if partner.customer_rank < 1:
                partner.with_context(**QUIET).write({"customer_rank": 1})
            user = record._responsible_user(partner)
            if record.lead_id:
                values = {"partner_id": partner.id}
                if not record.lead_id.user_id:
                    values["user_id"] = user.id
                record.lead_id.with_context(**QUIET).write(values)
            tax = record._native_tax()
            orders = self.env["sale.order"].sudo().with_company(record.company_id).with_context(**QUIET)
            order = orders.search([("prefab_quote_id", "=", record.id)], limit=1)
            if not order and record.lead_id:
                # Reuse only an untouched, empty native draft; never rewrite a user's lines or a sent offer.
                candidates = orders.search([("opportunity_id", "=", record.lead_id.id), ("company_id", "=", record.company_id.id),
                    ("state", "=", "draft"), ("prefab_quote_id", "=", False)], order="id")
                order = candidates.filtered(lambda candidate: not candidate.order_line)[:1]
            summary = request_summary(record.snapshot_json, record.contact_json)
            values = {"partner_id": partner.id, "partner_shipping_id": record._delivery_partner(partner).id,
                "company_id": record.company_id.id, "opportunity_id": record.lead_id.id, "user_id": user.id,
                "origin": record.name, "client_order_ref": record.name, "prefab_quote_id": record.id,
                "prefab_origin_ref": record.name, "prefab_source_price_mode": record.price_mode,
                "prefab_summary": summary, "prefab_width_cm": record.width_cm, "prefab_depth_cm": record.depth_cm,
                "prefab_area_m2": record.area_m2, "prefab_snapshot_total": record.amount_total,
                "note": Markup("<p>%s</p>") % escape(record.snapshot_json["price"].get("disclaimer", ""))}
            if order:
                order.write(values)
            else:
                order = orders.create(values)
            if order.currency_id != record.currency_id:
                pricelist = self.env["product.pricelist"].sudo().search([("currency_id", "=", record.currency_id.id), ("company_id", "in", [False, record.company_id.id])], limit=1)
                if not pricelist:
                    raise UserError("Stel een prijslijst in de valuta van deze aanvraag in voor het verkoopbedrijf.")
                order.pricelist_id = pricelist
            if not order.order_line:
                order.write({"order_line": record._native_line_commands(order, tax)})
            record._set_native_links({"partner_id": partner.id, "sale_order_id": order.id, "native_error": False})
            # Keep submitted images with the native quotation beyond private-link expiry.
            for visual in record.visual_ids:
                self.env["ir.attachment"].sudo().create({"name": record.name + " · " + visual.name + ".jpg", "type": "binary",
                    "raw": visual.image_1920, "mimetype": "image/jpeg", "res_model": "sale.order", "res_id": order.id})

    def _try_native_documents(self):
        """A missing business setting must not discard an already valid customer request."""
        for record in self:
            try:
                with self.env.cr.savepoint():
                    record._ensure_native_documents()
            except UserError as error:
                record._ensure_readable_rows()
                record._set_native_links({"native_error": str(error)})
                user = record._responsible_user(record.lead_id.partner_id)
                if record.lead_id and user:
                    self.env["mail.activity"].sudo().create({"res_model_id": self.env["ir.model"]._get_id("crm.lead"),
                        "res_id": record.lead_id.id, "activity_type_id": self.env.ref("mail.mail_activity_data_todo").id,
                        "user_id": user.id, "date_deadline": fields.Date.context_today(record),
                        "summary": "Prefab-aanvraag: verkoopinstellingen controleren", "note": escape(str(error))})

    def action_sync_native(self):
        self.check_access("write")
        self._ensure_native_documents()
        return self.action_open_sale_order()

    def _open_native(self, field):
        self.ensure_one()
        self.check_access("read")
        target = self[field]
        if not target:
            raise UserError("Dit document is nog niet beschikbaar.")
        target.check_access("read")
        return {"type": "ir.actions.act_window", "res_model": target._name, "res_id": target.id, "view_mode": "form", "target": "current"}

    def action_open_partner(self):
        return self._open_native("partner_id")

    def action_open_sale_order(self):
        return self._open_native("sale_order_id")

    def action_open_project(self):
        return self._open_native("project_id")


class PrefabSnapshotRow(models.AbstractModel):
    _name = "cs.prefab.snapshot.row"
    _description = "Read-only submitted prefab data"

    def write(self, values):
        raise UserError("De oorspronkelijke aanvraag blijft behouden. Bewerk de klant of verkoopofferte voor actuele gegevens.")


class PrefabSelection(models.Model):
    _name = "cs.prefab.quote.selection"
    _inherit = "cs.prefab.snapshot.row"
    _description = "Submitted prefab choice"
    _order = "sequence, id"
    quote_id = fields.Many2one("cs.prefab.quote", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="quote_id.company_id", store=True)
    sequence = fields.Integer()
    name = fields.Char(string="Onderdeel", required=True)
    value = fields.Char(string="Keuze")


class PrefabPriceLine(models.Model):
    _name = "cs.prefab.quote.line"
    _inherit = "cs.prefab.snapshot.row"
    _description = "Submitted prefab price and scope"
    _order = "sequence, id"
    quote_id = fields.Many2one("cs.prefab.quote", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="quote_id.company_id", store=True)
    currency_id = fields.Many2one(related="quote_id.currency_id")
    sequence = fields.Integer()
    name = fields.Char(string="Onderdeel", required=True)
    role_label = fields.Char(string="Levering")
    status_label = fields.Char(string="Status")
    quantity = fields.Float(string="Aantal", digits=(16, 4))
    unit_label = fields.Char(string="Eenheid")
    unit_price = fields.Monetary(string="Prijs per eenheid")
    amount_total = fields.Monetary(string="Subtotaal excl. btw")


class PrefabVisual(models.Model):
    _name = "cs.prefab.quote.visual"
    _inherit = "cs.prefab.snapshot.row"
    _description = "Submitted prefab design image"
    _order = "sequence, id"
    quote_id = fields.Many2one("cs.prefab.quote", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="quote_id.company_id", store=True)
    sequence = fields.Integer()
    name = fields.Char(string="Aanzicht", required=True)
    image_1920 = fields.Image(string="Ontwerpbeeld", max_width=1920, max_height=1920, attachment=True)


class PrefabSaleLine(models.Model):
    _inherit = "sale.order.line"
    prefab_component_key = fields.Char(readonly=True, copy=False, index=True)


class PrefabSaleOrder(models.Model):
    _inherit = "sale.order"

    prefab_quote_id = fields.Many2one("cs.prefab.quote", string="Prefab-aanvraag", readonly=True, copy=False, check_company=True, ondelete="set null", index=True)
    prefab_origin_ref = fields.Char(string="Prefab-referentie", readonly=True, copy=False)
    prefab_source_price_mode = fields.Selection([("demonstration", "Demonstratie"), ("commercial", "Goedgekeurde tarieven")], string="Bronprijzen", readonly=True, copy=False)
    prefab_summary = fields.Text(string="Ingediende configuratie", readonly=True, copy=False)
    prefab_width_cm = fields.Float(string="Ingediende breedte (cm)", readonly=True, copy=False)
    prefab_depth_cm = fields.Float(string="Ingediende diepte (cm)", readonly=True, copy=False)
    prefab_area_m2 = fields.Float(string="Ingediende oppervlakte (m²)", readonly=True, copy=False, digits=(16, 4))
    prefab_snapshot_total = fields.Monetary(string="Totaal bij aanvraag", readonly=True, copy=False)
    prefab_crm_activity_created = fields.Boolean(readonly=True, copy=False)
    _prefab_quote_unique = models.Constraint("UNIQUE(prefab_quote_id)", "Deze prefab-aanvraag heeft al een gekoppelde verkoopofferte.")

    def action_open_prefab_request(self):
        self.ensure_one()
        if not self.prefab_quote_id:
            raise UserError("De oorspronkelijke aanvraag is niet meer beschikbaar; de verkoopgegevens blijven bewaard.")
        self.prefab_quote_id.check_access("read")
        return {"type": "ir.actions.act_window", "res_model": "cs.prefab.quote", "res_id": self.prefab_quote_id.id, "view_mode": "form"}

    def action_confirm(self):
        prefab = self.filtered(lambda order: order.prefab_origin_ref and order.state in ("draft", "sent"))
        result = super().action_confirm()
        for order in prefab.filtered(lambda item: item.state == "sale"):
            # sale_project creates the base service's project, including its analytic account.
            project = order.project_id or order.order_line.project_id[:1]
            if not project:
                line = order.order_line.filtered(lambda row: not row.display_type and row.product_id.type == "service")[:1]
                if line:
                    project = line.sudo().with_company(order.company_id)._timesheet_create_project()
                else:
                    project = self.env["project.project"].sudo().with_company(order.company_id).create({"name": order.name + " · " + order.prefab_origin_ref,
                        "partner_id": order.partner_id.id, "company_id": order.company_id.id,
                        "sale_line_id": order.order_line.filtered(lambda row: not row.display_type)[:1].id,
                        "reinvoiced_sale_order_id": order.id})
                order.project_id = project
            if not project.prefab_origin_ref:
                values = {"prefab_origin_ref": order.prefab_origin_ref,
                    "description": Markup(project.description or "") + Markup("<h3>Prefab-aanvraag %s</h3><p>%s</p>") % (escape(order.prefab_origin_ref), escape(order.prefab_summary or "").replace("\n", Markup("<br/>")))}
                if not project.user_id:
                    values["user_id"] = order.user_id.id
                project.sudo().write(values)
            project._ensure_prefab_workflow(order)
            try:
                with self.env.cr.savepoint():
                    order._ensure_prefab_procurement()
            except psycopg2.OperationalError:
                raise  # concurrency errors must reach Odoo's transaction retry
            except Exception:
                # Purchasing is a follow-up step; a failure there must not block confirming the sale.
                _logger.exception("Prefab procurement failed for sale order %s", order.id)
                order._prefab_notify_purchase(["Inkoopaanvragen konden niet automatisch worden aangemaakt. Gebruik 'Ontbrekende inkoopaanvragen aanvullen' "
                    "op het tabblad Prefab-inkoop; blijft dit mislukken, geef de beheerder dan het tijdstip van bevestiging door."])
            if order.opportunity_id and not order.prefab_crm_activity_created:
                user = order.opportunity_id.user_id or order.user_id or self.env.user
                self.env["mail.activity"].sudo().create({"res_model_id": self.env["ir.model"]._get_id("crm.lead"),
                    "res_id": order.opportunity_id.id, "activity_type_id": self.env.ref("mail.mail_activity_data_todo").id,
                    "user_id": user.id, "date_deadline": fields.Date.context_today(order),
                    "summary": "Prefab-offerte bevestigd: CRM-fase beoordelen",
                    "note": Markup("<p>Verkooporder %s is bevestigd. Project %s is aangemaakt. Controleer de vervolgstap; de CRM-fase is behouden.</p>") % (escape(order.name), escape(project.display_name))})
                order.prefab_crm_activity_created = True
        return result


class PrefabProject(models.Model):
    _inherit = "project.project"
    prefab_origin_ref = fields.Char(string="Prefab-referentie", readonly=True, copy=False, index=True)


class PrefabLead(models.Model):
    _inherit = "crm.lead"
    prefab_request_ids = fields.One2many("cs.prefab.quote", "lead_id", string="Prefab-aanvragen", readonly=True)
    prefab_request_count = fields.Integer(compute="_compute_prefab_request_count")

    @api.depends("prefab_request_ids")
    def _compute_prefab_request_count(self):
        for lead in self:
            lead.prefab_request_count = len(lead.prefab_request_ids)

    def action_open_prefab_requests(self):
        self.ensure_one()
        return {"type": "ir.actions.act_window", "res_model": "cs.prefab.quote", "view_mode": "list,form", "domain": [("lead_id", "=", self.id)]}

    def action_new_quotation(self):
        self.ensure_one()
        request = self.prefab_request_ids[:1]
        if request:
            return request.action_sync_native()
        return super().action_new_quotation()

"""Native Odoo editors, applied atomically to an unchanged draft source."""
import copy
import json
import math

from odoo import api, Command, fields, models
from odoo.exceptions import UserError, ValidationError

from ..services.catalog import ROLE_LABELS, STATUS_LABELS, check_base_curve, credit_allowed
from ..services.catalog_editor import choice_label, euro_to_cents, field_index, patch_existing, patch_fields, same_value, value_key
from ..services.travel import ROAD_FACTOR, TRAVEL_DEFAULTS, check_travel, travel_settings


def _eur(value, credit=False):
    try:
        return euro_to_cents(value, allow_negative=credit)
    except ValueError as exc:
        raise ValidationError(str(exc)) from None


def _text(value):
    return "" if value is None or value is False else str(value)


class CatalogEditor(models.TransientModel):
    _name = "cs.prefab.catalog.editor"
    _description = "Catalogus bewerken"

    release_id = fields.Many2one("cs.prefab.catalog.release", required=True, readonly=True, ondelete="cascade")
    company_id = fields.Many2one(related="release_id.company_id", readonly=True)
    source_state = fields.Selection(related="release_id.state", readonly=True)
    source_hash = fields.Char(required=True, readonly=True)
    currency_id = fields.Many2one("res.currency", required=True, readonly=True, default=lambda self: self.env.ref("base.EUR"))
    name = fields.Char(related="release_id.name", readonly=True)
    pricebook_version = fields.Char(string="Versie prijslijst", required=True,
        help="Herkenbare naam van de prijslijst waarop deze catalogus rekent, bijvoorbeeld HSB-CONCEPT-2025-12-01. Staat in "
             "elke aanvraag en elk voorstel, zodat later na te gaan is met welke prijzen gerekend is.")
    base_per_m2 = fields.Monetary(string="Casco per m² vloer (excl. btw)", required=True,
        help="Lineaire cascoprijs: vloeroppervlak × dit bedrag. Staat de cascostaffel hieronder aan, dan rekent de "
             "configurator met de staffel en dient dit bedrag alleen als terugval voor een oudere applicatieversie.")
    fixed_setup = fields.Monetary(string="Vaste startkosten (excl. btw)", required=True,
        help="Eén vaste post per aanvraag voor werkvoorbereiding, transport en plaatsing. Staat als eigen regel in het "
             "voorstel. Bij 0 verdwijnt de regel.")
    vat_rate = fields.Integer(string="Btw (%)", required=True,
        help="Btw-percentage over het subtotaal. Alle bedragen in deze editor zijn exclusief btw; het totaal voor de klant "
             "is inclusief. Voorbeeld: 21.")
    disclaimer = fields.Text(string="Prijstoelichting", required=True,
        help="De tekst onder elke prijs en in het voorstel: wat de prijs wel en niet is. Bij eigen goedgekeurde tarieven "
             "vervangen de commerciële voorwaarden deze tekst.")
    use_base_curve = fields.Boolean(string="Casco volgens prijsstaffel",
        help="Aan: de cascoprijs groeit volgens een staffel zoals in een prijslijst met een maatentabel, "
             "casco = vaste basis + factor × (breedte × diepte in m²)^groeifactor. Uit: vloeroppervlak × casco per m².")
    base_curve_fixed = fields.Monetary(string="Vaste basis casco (excl. btw)",
        help="Het deel van de cascoprijs dat bij elke maat gelijk is. Posten die als eigen regel meetellen (zoals de "
             "vaste startkosten) trek je hiervan af. Voorbeeld: prijslijst 33.000 − startkosten 3.250 = 29.750.")
    base_curve_factor = fields.Monetary(string="Factor per m² (excl. btw)",
        help="Het bedrag dat met het vloeroppervlak tot de macht groeifactor wordt vermenigvuldigd. Voorbeeld: 650.")
    base_curve_exponent = fields.Char(string="Groeifactor",
        help="Hoe snel de cascoprijs met het oppervlak meegroeit. 1 = recht evenredig; groter dan 1 = grotere aanbouwen "
             "worden per m² duurder. Decimaal getal met een punt tussen 0.5 en 2, bijvoorbeeld 1.1860002 (volgt de "
             "prijslijst HSB 1-12-2025 in alle 169 maten).")
    base_curve_round_to = fields.Monetary(string="Afronden op (excl. btw)",
        help="De cascoprijs wordt afgerond op een veelvoud van dit bedrag. 1,00 geeft hele euro's zoals de prijslijst.")
    # Kilometervergoeding (2.18.0). Without its own block in the pricebook the configurator uses services/travel.py
    # TRAVEL_DEFAULTS; this form shows those and writes a block only when something differs from them.
    travel_origin_postcode = fields.Char(string="Postcode vestiging", size=4,
        help="Vanaf waar de kilometers tellen: de vier cijfers van de postcode van de vestiging, bijvoorbeeld 2288 voor "
             "Rijswijk. De afstand naar de bouwplaats is de rechte lijn tussen de twee postcodegebieden keer "
             + str(ROAD_FACTOR).replace(".", ",") + ", de gemiddelde omweg over de weg (CBS-postcodegebieden).")
    travel_origin_label = fields.Char(string="Plaats vestiging",
        help="De plaatsnaam in de prijsregel van het voorstel, bijvoorbeeld 'Kilometervergoeding vanaf Rijswijk: ca. 112 km, "
             "124 km boven de eerste 50 km (heen en terug) à € 1,50'.")
    travel_free_km = fields.Integer(string="Vrije kilometers (enkele reis)",
        help="Zoveel kilometer vanaf de vestiging zijn inbegrepen; pas daarboven telt de kilometervergoeding. Voorbeeld: 50.")
    travel_per_km = fields.Monetary(string="Prijs per kilometer (excl. btw)",
        help="Het bedrag per kilometer boven de vrije kilometers. Bij 0 staat de kilometervergoeding uit en verdwijnt de "
             "regel. Voorbeeld: 1,50.")
    travel_round_trip = fields.Boolean(string="Heen en terug rekenen",
        help="Aan: elke kilometer boven de vrije afstand telt twee keer, heen en terug. Uit: alleen de enkele reis.")
    field_ids = fields.One2many("cs.prefab.catalog.editor.field", "editor_id", string="Keuzevelden")
    number_ids = fields.One2many("cs.prefab.catalog.editor.number", "editor_id", string="Maatregels")
    text_ids = fields.One2many("cs.prefab.catalog.editor.text", "editor_id", string="Secties en toelichtingen")
    price_ids = fields.One2many("cs.prefab.catalog.editor.price", "editor_id", string="Alle prijsposten")
    scope_price_ids = fields.One2many("cs.prefab.catalog.editor.price", "editor_id", domain=[("source", "=", "component")], string="Toegepaste leveringsprijzen")
    reference_price_ids = fields.One2many("cs.prefab.catalog.editor.price", "editor_id", domain=[("source", "=", "book")], string="Referentieprijsboek")
    policy_field_id = fields.Many2one("cs.prefab.catalog.editor.field", string="Onderdeel", domain="[('editor_id', '=', id), ('has_scope_rule', '=', True)]", ondelete="set null")
    policy_choice_id = fields.Many2one("cs.prefab.catalog.editor.choice", string="Uitvoering", domain="[('field_id', '=', policy_field_id)]", ondelete="set null")

    @api.constrains("base_per_m2", "fixed_setup", "vat_rate", "use_base_curve", "base_curve_fixed", "base_curve_factor", "base_curve_exponent", "base_curve_round_to",
                    "travel_origin_postcode", "travel_origin_label", "travel_free_km", "travel_per_km", "travel_round_trip")
    def _check_globals(self):
        for record in self:
            _eur(record.base_per_m2)
            _eur(record.fixed_setup)
            if not 0 <= record.vat_rate <= 100:
                raise ValidationError("Btw moet tussen 0 en 100 procent liggen.")
            record._base_curve()
            record._travel()

    def _base_curve(self):
        """The pricebook's baseCurve from the form, or None when the switch is off; validated like a publication."""
        self.ensure_one()
        if not self.use_base_curve:
            return None
        curve = {"fixed": _eur(self.base_curve_fixed), "factor": _eur(self.base_curve_factor),
                 "exponent": (self.base_curve_exponent or "").strip(), "roundTo": _eur(self.base_curve_round_to)}
        try:
            check_base_curve(curve)
        except ValueError as exc:
            raise ValidationError(str(exc)) from None
        return curve

    def _travel(self):
        """The pricebook's kilometervergoeding from the form; validated like a publication."""
        self.ensure_one()
        travel = {"originPostcode": (self.travel_origin_postcode or "").strip(), "originLabel": (self.travel_origin_label or "").strip(),
                  "freeKm": self.travel_free_km, "perKm": _eur(self.travel_per_km), "roundTrip": bool(self.travel_round_trip)}
        try:
            check_travel(travel)
        except ValueError as exc:
            raise ValidationError(str(exc)) from None
        return travel

    @api.model_create_multi
    def create(self, vals_list):
        for values in vals_list:
            for key in ("base_per_m2", "fixed_setup", "base_curve_fixed", "base_curve_factor", "base_curve_round_to", "travel_per_km"):
                if key in values:
                    _eur(values[key])
        return super().create(vals_list)

    def write(self, values):
        for key in ("base_per_m2", "fixed_setup", "base_curve_fixed", "base_curve_factor", "base_curve_round_to", "travel_per_km"):
            if key in values:
                _eur(values[key])
        return super().write(values)

    @api.model
    def _source_lines(self, release):
        """Create editable projections without modifying stored catalogue content."""
        catalog, book = release.catalog_json, release.pricebook_json
        result = {"field_ids": [], "number_ids": [], "text_ids": [], "price_ids": []}
        def number(path, name, value, unit="cm", integer=True):
            result["number_ids"].append({"path_key": json.dumps(path), "name": name, "value": value, "unit": unit, "integer_only": integer})
        def text(path, name, value):
            result["text_ids"].append({"path_key": json.dumps(path), "name": name, "value": _text(value)})
        for gi, group in enumerate(catalog["groups"]):
            text(["groups", gi, "label"], "Sectie · " + group["label"], group["label"])
            for field in group["fields"]:
                key, default = field["key"], catalog["defaults"][field["key"]]
                kind = "multiple" if field["type"] == "multiselect" else "choice" if field.get("options") else "boolean" if type(default) is bool else "integer" if type(default) is int else "text"
                result["field_ids"].append({"key": key, "name": field["label"], "group_name": group["label"], "description": _text(field.get("description")),
                    "placeholder": _text(field.get("placeholder")), "value_type": kind, "has_scope_rule": kind == "choice" and bool(release.option_ids.filtered(lambda o: o.key == key and o.value_key == "*")), "default_integer": default if kind == "integer" else 0,
                    "default_boolean": default if kind == "boolean" else False, "default_text": default if kind == "text" else "",
                    "choice_ids": [Command.create({"key": value_key(option["id"]), "name": option["label"], "description": _text(option.get("description"))}) for option in field.get("options", [])]})
                for prop, label in (("min", "minimum"), ("max", "maximum"), ("step", "stapgrootte"), ("maxLength", "maximale tekstlengte")):
                    if prop in field:
                        number(["groups", gi, "fields", group["fields"].index(field), prop], field["label"] + " · " + label, field[prop], "tekens" if prop == "maxLength" else "stuks")
        for key, rule in catalog["dimensions"].items():
            text(["dimensions", key, "label"], "Maatnaam · " + rule["label"], rule["label"])
            for prop, label in (("min", "minimum"), ("max", "maximum"), ("step", "stapgrootte")):
                number(["dimensions", key, prop], rule["label"] + " · " + label, rule[prop])
            number(["defaults", key], rule["label"] + " · standaardmaat", catalog["defaults"][key])
        for key in ("engineeringNotice",):
            if key in catalog:
                text([key], "Technische toelichting", catalog[key])
        if "notice" in catalog.get("openingRules", {}):
            text(["openingRules", "notice"], "Toelichting kozijnprofielen", catalog["openingRules"]["notice"])
        opening_names = {"none": "Zonder pui", "french": "Dubbele deur", "sliding-2": "Schuifpui 2 delen", "sliding-4": "Schuifpui 4 delen", "folding": "Harmonicapui"}
        for key, value in catalog.get("openingRules", {}).get("minimumWidthCm", {}).items():
            number(["openingRules", "minimumWidthCm", key], opening_names.get(key, key) + " · basisminimum breedte", value)
        geometry = catalog.get("geometryRules", {})
        for section, title in (("openingProfiles", "Pui"), ("rooflightProfiles", "Daklicht")):
            for key, profile in geometry.get(section, {}).items():
                label = opening_names.get(key, key) if section == "openingProfiles" else choice_label(catalog, "rooflight", key)
                for prop, prop_label in (("minWidthCm", "minimum breedte"), ("maxWidthCm", "maximum breedte"), ("minDepthCm", "minimum diepte"), ("maxDepthCm", "maximum diepte")):
                    number(["geometryRules", section, key, prop], title + " · " + label + " · " + prop_label, profile[prop])
        for key, value in geometry.get("clearanceCm", {}).items():
            number(["geometryRules", "clearanceCm", key], "Vrije ruimte · " + {"roof": "daklicht", "wallEdge": "wandrand", "fixture": "apparaten onderling"}.get(key, key), value, integer=False)
        by_key = field_index(catalog)
        for key, prices in book.get("optionPrices", {}).items():
            for choice, amount in prices.items():
                result["price_ids"].append({"path_key": json.dumps(["optionPrices", key, choice]), "source": "book", "name": by_key.get(key, {}).get("label", key),
                    "choice_name": choice_label(catalog, key, choice), "unit": "per m² vloer" if key in book.get("perM2", []) else "per pakket", "amount": amount / 100})
        for option in release.option_ids:
            for component in option.component_ids:
                identity = {"source": "component", "component_id": component.id, "name": by_key.get(option.key, {}).get("label", option.name),
                    "policy_name": "Alle keuzes" if option.value_key == "*" else choice_label(catalog, option.key, option.value_key),
                    "role_name": ROLE_LABELS[component.role], "status_name": STATUS_LABELS[component.status],
                    "unit": {"option": "per pakket", "area": "per m² vloer", "count": "per positie / stuk", "fixed": "per aanvraag"}[component.pricing_basis]}
                result["price_ids"].append(dict(identity, path_key=json.dumps(["unitPrice"]), choice_name="Eenheidsprijs", amount=component.unit_price_cents / 100))
                credit = credit_allowed(option.key, component.role, component.pricing_basis)
                for choice, amount in (component.option_prices_json or {}).items():
                    result["price_ids"].append(dict(identity, path_key=json.dumps(["prices", choice]), choice_name=choice_label(catalog, option.key, choice),
                                                    amount=amount / 100, allow_credit=credit))
        return result

    @api.model
    def open_release(self, release):
        release.ensure_one()
        release.check_access("read")
        if not self.env.user.has_group("sales_team.group_sale_manager"):
            raise UserError("Alleen een verkoopbeheerder kan de cataloguseditor openen.")
        source = self._source_lines(release)
        book = release.pricebook_json
        curve = book.get("baseCurve") or {}
        travel = travel_settings(book)
        wizard = self.create({"release_id": release.id, "source_hash": release._content_bundle()["revision"],
            "pricebook_version": book["pricebookVersion"], "base_per_m2": book["basePerM2"] / 100,
            "fixed_setup": book["fixedSetup"] / 100, "vat_rate": book["vatRate"], "disclaimer": book["disclaimer"],
            "use_base_curve": bool(curve), "base_curve_fixed": curve.get("fixed", 0) / 100, "base_curve_factor": curve.get("factor", 0) / 100,
            "base_curve_exponent": curve.get("exponent", "1"), "base_curve_round_to": curve.get("roundTo", 100) / 100,
            **{"travel_" + name: value for name, value in (
                ("origin_postcode", travel["originPostcode"]), ("origin_label", travel["originLabel"]), ("free_km", travel["freeKm"]),
                ("per_km", travel["perKm"] / 100), ("round_trip", travel["roundTrip"]))},
            **{key: [Command.create(line) for line in lines] for key, lines in source.items()}})
        for field in wizard.field_ids:
            default = release.catalog_json["defaults"][field.key]
            if field.value_type == "choice":
                field.default_choice_id = field.choice_ids.filtered(lambda c: c.key == value_key(default))
            elif field.value_type == "multiple":
                keys = {value_key(v) for v in default}
                field.default_choice_ids = [Command.set(field.choice_ids.filtered(lambda c: c.key in keys).ids)]
        return {"type": "ir.actions.act_window", "name": "Catalogus · " + release.name,
            "res_model": self._name, "res_id": wizard.id, "view_mode": "form", "target": "current"}

    def action_back(self):
        self.ensure_one()
        return {"type": "ir.actions.act_window", "res_model": "cs.prefab.catalog.release", "res_id": self.release_id.id, "view_mode": "form", "target": "current"}

    @api.onchange("policy_field_id")
    def _onchange_policy_field(self):
        self.policy_choice_id = False

    def action_create_scope_override(self):
        self.ensure_one()
        if not self.policy_field_id or self.policy_field_id not in self.field_ids or not self.policy_choice_id or self.policy_choice_id not in self.policy_field_id.choice_ids:
            raise ValidationError("Kies een onderdeel en een bijbehorende uitvoering.")
        key, value = self.policy_field_id.key, self.policy_choice_id.key
        field = field_index(self.release_id.catalog_json)[key]
        base = self.release_id.option_ids.filtered(lambda o: o.key == key and o.value_key == "*")
        if not base or field["type"] == "multiselect":
            raise ValidationError("Voor dit onderdeel is geen afzonderlijke pakketregel beschikbaar.")
        # Apply pending workbook changes first, using the same stale-source protection.
        self.action_apply()
        option = self.release_id.option_ids.filtered(lambda o: o.key == key and o.value_key == value)
        if not option:
            option = base.copy({"value_key": value, "name": self.policy_field_id.name})
        return option.action_open_policy()

    def action_apply(self):
        self.ensure_one()
        self.check_access("write")
        release = self.release_id
        release.check_access("write")
        release._require_draft()
        # Reload after taking the parent lock, including changes from other sessions.
        release.invalidate_recordset()
        release.option_ids.invalidate_recordset()
        release.option_ids.component_ids.invalidate_recordset()
        if self.source_hash != release._content_bundle()["revision"]:
            raise UserError("Deze catalogus is intussen gewijzigd. Open de editor opnieuw; jouw wijzigingen zijn niet overschreven.")
        source = self._source_lines(release)
        catalog, book = release.catalog_json, release.pricebook_json
        by_key = field_index(catalog)
        if len(self.field_ids) != len(by_key) or set(self.field_ids.mapped("key")) != set(by_key):
            raise ValidationError("Keuzevelden mogen niet worden toegevoegd of verwijderd.")
        field_edits = {}
        for field in self.field_ids:
            original = by_key[field.key]
            change = {}
            for target, attr in (("label", "name"), ("description", "description"), ("placeholder", "placeholder")):
                value = field[attr] or ""
                if value != _text(original.get(target)):
                    change[target] = value
            options = {value_key(option["id"]): option for option in original.get("options", [])}
            if len(field.choice_ids) != len(options) or set(field.choice_ids.mapped("key")) != set(options):
                raise ValidationError("Optiewaarden mogen niet via de editor worden toegevoegd of verwijderd.")
            changes = {}
            for choice in field.choice_ids:
                values = {key: choice[attr] or "" for key, attr in (("label", "name"), ("description", "description")) if (choice[attr] or "") != _text(options[choice.key].get(key))}
                if values:
                    changes[choice.key] = values
            if changes:
                change["choices"] = changes
            default = catalog["defaults"][field.key]
            if original["type"] == "multiselect":
                if field.default_choice_ids - field.choice_ids:
                    raise ValidationError("De standaardposities horen bij een ander keuzeveld.")
                selected = set(field.default_choice_ids.mapped("key"))
                # Preserve existing selection order when the user did not change it.
                value = default if selected == {value_key(v) for v in default} else [option["id"] for option in original["options"] if value_key(option["id"]) in selected]
            elif options:
                if not field.default_choice_id or field.default_choice_id not in field.choice_ids:
                    raise ValidationError("Kies een geldige standaardoptie voor: " + original["label"])
                value = options[field.default_choice_id.key]["id"]
            else:
                value = field.default_boolean if type(default) is bool else field.default_integer if type(default) is int else field.default_text or ""
            if not same_value(default, value):
                change["default"] = value
            if change:
                field_edits[field.key] = change
        try:
            updated_catalog = patch_fields(catalog, field_edits)
            for relation, value_attr in (("number_ids", "value"), ("text_ids", "value")):
                expected = {line["path_key"]: line for line in source[relation]}
                records = self[relation]
                if len(records) != len(expected) or set(records.mapped("path_key")) != set(expected):
                    raise ValidationError("Maatregels of toelichtingen zijn gewijzigd. Open de editor opnieuw.")
                patches = []
                for record in records:
                    original = expected[record.path_key]
                    value = record[value_attr]
                    if relation == "number_ids":
                        if not math.isfinite(value) or value < 0 or original["integer_only"] and value != int(value):
                            raise ValidationError("Gebruik niet-negatieve maten; profielgrenzen vereisen gehele centimeters.")
                        if value == original["value"]:
                            continue
                        value = int(value) if original["integer_only"] else value
                    else:
                        value = value or ""
                        if value == original["value"]:
                            continue
                    patches.append((json.loads(record.path_key), value))
                updated_catalog = patch_existing(updated_catalog, patches)
        except (ValueError, KeyError, TypeError) as exc:
            raise ValidationError(str(exc)) from None
        updated_book = copy.deepcopy(book)
        updated_book.update(pricebookVersion=self.pricebook_version, basePerM2=_eur(self.base_per_m2), fixedSetup=_eur(self.fixed_setup), vatRate=self.vat_rate, disclaimer=self.disclaimer)
        # The curve is written only when switched on and dropped when switched off, so an unchanged apply leaves a book
        # without a curve byte-identical (no injected key: that would change every revision and approval).
        curve = self._base_curve()
        if curve is None:
            updated_book.pop("baseCurve", None)
        elif curve != book.get("baseCurve"):
            updated_book["baseCurve"] = curve
        # Same rule as the curve: a book without a kilometervergoeding of its own stays byte-identical while the form
        # still shows the defaults, so an unchanged apply changes no revision and voids no approval.
        travel = self._travel()
        if ("travel" in book or travel != TRAVEL_DEFAULTS) and travel != book.get("travel"):
            updated_book["travel"] = travel
        expected = {(line["source"], line.get("component_id", False), line["path_key"]): line for line in source["price_ids"]}
        actual = {(line.source, line.component_id.id, line.path_key): line for line in self.price_ids}
        if len(self.price_ids) != len(expected) or set(actual) != set(expected):
            raise ValidationError("De prijsposten zijn gewijzigd. Open de editor opnieuw.")
        components = {}
        for identity, line in actual.items():
            credit = bool(expected[identity].get("allow_credit"))
            cents = _eur(line.amount, credit)
            if cents == _eur(expected[identity]["amount"], credit):
                continue
            if line.source == "book":
                updated_book = patch_existing(updated_book, [(json.loads(line.path_key), cents)])
            else:
                component = line.component_id
                values = components.setdefault(component.id, {})
                path = json.loads(line.path_key)
                if path == ["unitPrice"]:
                    values["unit_price_cents"] = cents
                else:
                    values.setdefault("option_prices_json", dict(component.option_prices_json or {}))[path[1]] = cents
        # A validation failure rolls the whole operation back, including approval invalidation.
        with self.env.cr.savepoint():
            values = {}
            if updated_catalog != catalog:
                values["catalog_json"] = updated_catalog
            if updated_book != book:
                values["pricebook_json"] = updated_book
            if values:
                release.write(values)
            for component_id, values in components.items():
                self.env["cs.prefab.catalog.component"].browse(component_id).write(values)
            release._draft_bundle(allow_unapproved=True)
        return self.action_back()


class CatalogEditorField(models.TransientModel):
    _name = "cs.prefab.catalog.editor.field"
    _description = "Cataloguskeuze bewerken"
    _order = "id"

    editor_id = fields.Many2one("cs.prefab.catalog.editor", required=True, ondelete="cascade")
    source_state = fields.Selection(related="editor_id.source_state")
    key = fields.Char(required=True, readonly=True)
    name = fields.Char(string="Keuzenaam", required=True)
    group_name = fields.Char(string="Sectie", readonly=True)
    description = fields.Text(string="Toelichting")
    placeholder = fields.Char(string="Invoervoorbeeld")
    value_type = fields.Selection([(k, k) for k in ("choice", "multiple", "boolean", "integer", "text")], readonly=True, required=True)
    has_scope_rule = fields.Boolean(readonly=True)
    default_integer = fields.Integer(string="Standaardgetal")
    default_boolean = fields.Boolean(string="Standaard ingeschakeld")
    default_text = fields.Char(string="Standaardtekst")
    choice_ids = fields.One2many("cs.prefab.catalog.editor.choice", "field_id", string="Beschikbare keuzes")
    default_choice_id = fields.Many2one("cs.prefab.catalog.editor.choice", string="Standaardkeuze", domain="[('field_id', '=', id)]", ondelete="set null")
    default_choice_ids = fields.Many2many("cs.prefab.catalog.editor.choice", "cs_prefab_editor_default_choice_rel", "field_id", "choice_id", string="Standaardposities", domain="[('field_id', '=', id)]")
    default_summary = fields.Char(string="Standaardontwerp", compute="_compute_default_summary")

    @api.depends("value_type", "default_integer", "default_boolean", "default_text", "default_choice_id.name", "default_choice_ids.name")
    def _compute_default_summary(self):
        for record in self:
            if record.value_type == "choice":
                record.default_summary = record.default_choice_id.name or "Kies een optie"
            elif record.value_type == "multiple":
                record.default_summary = ", ".join(record.default_choice_ids.mapped("name")) or "Geen"
            elif record.value_type == "boolean":
                record.default_summary = "Ja" if record.default_boolean else "Nee"
            elif record.value_type == "integer":
                record.default_summary = str(record.default_integer)
            else:
                record.default_summary = record.default_text or "Leeg"


class CatalogEditorChoice(models.TransientModel):
    _name = "cs.prefab.catalog.editor.choice"
    _description = "Catalogusoptie bewerken"
    _order = "id"

    field_id = fields.Many2one("cs.prefab.catalog.editor.field", required=True, ondelete="cascade")
    source_state = fields.Selection(related="field_id.source_state")
    key = fields.Char(required=True, readonly=True)
    name = fields.Char(string="Optienaam", required=True)
    description = fields.Text(string="Toelichting")


class CatalogEditorNumber(models.TransientModel):
    _name = "cs.prefab.catalog.editor.number"
    _description = "Catalogusmaatregel bewerken"
    _order = "id"

    editor_id = fields.Many2one("cs.prefab.catalog.editor", required=True, ondelete="cascade")
    path_key = fields.Char(required=True, readonly=True)
    name = fields.Char(string="Maatregel", required=True, readonly=True)
    value = fields.Float(string="Waarde", required=True)
    unit = fields.Char(string="Eenheid", readonly=True)
    integer_only = fields.Boolean(readonly=True)


class CatalogEditorText(models.TransientModel):
    _name = "cs.prefab.catalog.editor.text"
    _description = "Catalogustekst bewerken"
    _order = "id"

    editor_id = fields.Many2one("cs.prefab.catalog.editor", required=True, ondelete="cascade")
    path_key = fields.Char(required=True, readonly=True)
    name = fields.Char(string="Onderdeel", required=True, readonly=True)
    value = fields.Text(string="Tekst")


class CatalogEditorPrice(models.TransientModel):
    _name = "cs.prefab.catalog.editor.price"
    _description = "Catalogusprijs bewerken"
    _order = "id"

    editor_id = fields.Many2one("cs.prefab.catalog.editor", required=True, ondelete="cascade")
    currency_id = fields.Many2one(related="editor_id.currency_id", readonly=True)
    path_key = fields.Char(required=True, readonly=True)
    component_id = fields.Many2one("cs.prefab.catalog.component", readonly=True, ondelete="cascade")
    source = fields.Selection([("component", "Levering"), ("book", "Referentieprijsboek")], required=True, readonly=True)
    name = fields.Char(string="Onderdeel", readonly=True)
    policy_name = fields.Char(string="Leveringsregel", readonly=True)
    choice_name = fields.Char(string="Keuze", readonly=True)
    role_name = fields.Char(string="Component", readonly=True)
    status_name = fields.Char(string="Omvang", readonly=True)
    unit = fields.Char(string="Grondslag", readonly=True)
    amount = fields.Monetary(string="EUR excl. btw", required=True,
        help="Prijs exclusief btw voor deze keuze. Alleen bij een productpakket mag het bedrag negatief zijn: dan is het "
             "een minderprijs, bijvoorbeeld buitenstuc -2.000 omdat de aanneemsom daarmee lager wordt.")
    allow_credit = fields.Boolean(string="Minderprijs toegestaan", readonly=True,
        help="Aan voor pakketprijzen van producten: daar mag een negatief bedrag (minderprijs) staan. Voorzieningen zoals "
             "lichtpunten en radiatoren blijven altijd nul of hoger.")

    @api.model_create_multi
    def create(self, vals_list):
        for values in vals_list:
            if "amount" in values:
                _eur(values["amount"], bool(values.get("allow_credit")))
        return super().create(vals_list)

    def write(self, values):
        if "amount" in values:
            for record in self:
                _eur(values["amount"], record.allow_credit)
        return super().write(values)

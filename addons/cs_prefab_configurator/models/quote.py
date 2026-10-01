"""Private records. Anonymous access is only through scoped controller methods."""
from odoo import api, fields, models
from odoo.exceptions import UserError

from ..services.appearance import proposal_palette


# What the office may change on a request. Everything else is the customer's submission and its price, frozen at the
# moment it was sent: the proposal PDF, the CRM lead and the sale order are all built from it, so editing it would
# make them disagree. The office's own information lives beside it — who follows it up, when, and notes — plus the
# chatter (mail.thread), which writes its own message/follower/activity fields.
OFFICE_FIELDS = {"state", "user_id", "follow_up_date", "internal_note"}
MAIL_FIELD_PREFIXES = ("message_", "activity_", "website_message", "has_message", "rating_")


class PrefabQuote(models.Model):
    _name = "cs.prefab.quote"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _description = "Prefab quotation request snapshot"
    _order = "create_date desc"
    _check_company_auto = True

    name = fields.Char(required=True, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, index=True, readonly=True)
    website_id = fields.Many2one("website", required=True, index=True, readonly=True, check_company=True)
    lead_id = fields.Many2one("crm.lead", readonly=True, ondelete="set null", check_company=True)
    token = fields.Char(required=True, readonly=True, copy=False, index=True)
    idempotency_key = fields.Char(required=True, readonly=True, copy=False, index=True)
    payload_hash = fields.Char(required=True, readonly=True)
    snapshot_json = fields.Json(required=True, readonly=True, copy=False)
    contact_json = fields.Json(required=True, readonly=True, copy=False)
    pricebook_version = fields.Char(required=True, readonly=True)
    price_mode = fields.Selection([("demonstration", "Demonstratie"), ("commercial", "Goedgekeurde tarieven")], default="demonstration", readonly=True)
    catalog_revision = fields.Char(readonly=True, help="Vastgelegde catalogusversie. Leeg voor historische aanvragen van vóór versie 2.")
    total_cents = fields.Integer(required=True, readonly=True)
    expires_at = fields.Datetime(required=True, readonly=True, index=True)
    state = fields.Selection([("new", "Nieuw"), ("review", "In beoordeling"), ("contacted", "Contact opgenomen"), ("closed", "Afgerond")],
                             default="new", required=True, tracking=True, string="Opvolging",
        help="Waar deze aanvraag in de opvolging staat. Nieuw: nog niemand heeft ernaar gekeken. In beoordeling: "
             "technisch of commercieel in behandeling. Contact opgenomen: de klant is gebeld of gemaild. Afgerond: "
             "afgehandeld, met of zonder opdracht. Elke wijziging wordt in de berichtenhistorie vastgelegd.")
    user_id = fields.Many2one("res.users", string="Verantwoordelijke", tracking=True, index=True,
        domain="[('share', '=', False)]",
        help="De collega die deze aanvraag opvolgt. Hij of zij ziet de aanvraag onder 'Mijn aanvragen' en krijgt "
             "de geplande activiteiten. Leeg: nog niet toegewezen.")
    follow_up_date = fields.Date(string="Opvolgen op", tracking=True, index=True,
        help="Wanneer deze aanvraag weer opgepakt moet worden, bijvoorbeeld de dag van de terugbelafspraak. "
             "Aanvragen waarvan deze datum vandaag of eerder is, staan onder het filter 'Op te volgen'.")
    internal_note = fields.Html(string="Interne notities", sanitize=True,
        help="Notities voor het team, nooit zichtbaar voor de klant en nooit in het voorstel of de PDF: afspraken, "
             "bijzonderheden van de locatie, wat er aan de telefoon is besproken. Voor een tijdlijn met datum en "
             "naam gebruik je 'Notitie loggen' in de berichtenhistorie onder het formulier.")

    _token_unique = models.Constraint("UNIQUE(token)", "A quote access token must be unique.")
    _idempotency_unique = models.Constraint("UNIQUE(company_id, website_id, idempotency_key)", "A submission can only be processed once per website.")
    _reference_unique = models.Constraint("UNIQUE(name)", "A quote reference must be unique.")

    def write(self, values):
        editable = OFFICE_FIELDS | {"write_uid", "write_date"} | {name for name in self._fields if name.startswith(MAIL_FIELD_PREFIXES)}
        frozen = set(values) - editable
        if frozen:
            raise UserError("De ingediende gegevens en de prijs van een aanvraag liggen vast: het voorstel, de "
                            "CRM-aanvraag en de verkoopofferte zijn erop gebaseerd. Je kunt de opvolging, de "
                            "verantwoordelijke, de opvolgdatum en de interne notities wel wijzigen. Voor een andere "
                            "uitvoering maak je een nieuwe aanvraag in de configurator, of je past de verkoopofferte aan "
                            "via 'Offerte bewerken'. (Niet te wijzigen: %s)" % ", ".join(sorted(frozen)))
        return super().write(values)

    def action_open_configurator(self):
        """'Nieuwe aanvraag': a priced request can only be made in the configurator, so this opens it."""
        website = self.env["website"].get_current_website()
        base = (website.domain or "").rstrip("/") if website and website.domain else ""
        if base and not base.startswith("http"):
            base = "https://" + base
        return {"type": "ir.actions.act_url", "url": base + "/prefab", "target": "new"}

    def _proposal_appearance(self):
        """This request's website vormgeving, read with sudo, or an empty recordset when none was ever saved.

        Read with sudo: the anonymous PDF link and an internal report render the same
        header, and neither reader needs rights on the vormgeving record itself.
        """
        self.ensure_one()
        return self.env["cs.prefab.appearance"].sudo().search([("website_id", "=", self.website_id.id)], limit=1)

    def _proposal_company(self):
        self.ensure_one()
        return (self.company_id or self.website_id.company_id).sudo()

    def _proposal_logo(self):
        """Brand mark for this request's website, shared by the QWeb report and the PDF endpoint.

        A website that never saved a vormgeving still gets its company's Odoo logo — the default the
        vormgeving itself has — instead of the CS prefab wordmark it used to fall back to.
        """
        appearance = self._proposal_appearance()
        if appearance:
            return appearance._proposal_logo()
        return self.env["cs.prefab.appearance"]._company_logo(self._proposal_company())

    def _proposal_palette(self):
        """The colours all three proposal renderers print in (services.appearance.proposal_palette).

        With a vormgeving, its own mode decides: its colours, or Odoo's document colours. Without one, Odoo's
        document colours — Instellingen → Bedrijven → Documentlay-out — because that is the only colour an
        administrator of such a website has ever set.
        """
        appearance, company = self._proposal_appearance(), self._proposal_company()
        values = appearance._palette_values() if appearance else {"mode": "odoo"}
        return proposal_palette(values, company_primary=company.primary_color, company_secondary=company.secondary_color)

    def _proposal_brand_name(self):
        """The name printed where a logo would be, when the logo that was asked for is not usable.

        Empty when the administrator deliberately chose the built-in wordmark: that choice prints the CS prefab
        mark, and a company name in its place would override a setting somebody made on purpose.
        """
        appearance = self._proposal_appearance()
        if appearance and appearance.logo_source == "wordmark":
            return ""
        return self._proposal_company().name or ""

    def action_open_lead(self):
        self.ensure_one()
        return {"type": "ir.actions.act_window", "res_model": "crm.lead", "res_id": self.lead_id.id, "view_mode": "form", "target": "current"}

    def _set_native_links(self, values):
        """Internal relation updates leave the submitted document immutable."""
        if set(values) - {"partner_id", "sale_order_id", "native_error"}:
            raise UserError("Ongeldige documentkoppeling.")
        return super().write(values)

    @api.model
    def _cron_purge_expired(self):
        # CRM leads follow the organisation's separate retention policy.
        self.sudo().search([("expires_at", "<=", fields.Datetime.now())]).unlink()
        self.env["cs.prefab.share"].sudo().search([("expires_at", "<=", fields.Datetime.now())]).unlink()


class PrefabShare(models.Model):
    _name = "cs.prefab.share"
    _description = "Prefab configuration share without personal details"
    _check_company_auto = True

    token = fields.Char(required=True, readonly=True, index=True, copy=False)
    company_id = fields.Many2one("res.company", required=True, index=True, readonly=True)
    website_id = fields.Many2one("website", required=True, index=True, readonly=True, check_company=True)
    config_json = fields.Json(required=True, readonly=True)
    catalog_revision = fields.Char(readonly=True)
    schema_version = fields.Char(readonly=True)
    expires_at = fields.Datetime(required=True, readonly=True, index=True)
    _token_unique = models.Constraint("UNIQUE(token)", "A share token must be unique.")

    def write(self, values):
        raise UserError("Gedeelde configuraties zijn onveranderlijk. Maak een nieuwe deellink.")

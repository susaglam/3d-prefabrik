"""Private records. Anonymous access is only through scoped controller methods."""
from odoo import api, fields, models
from odoo.exceptions import UserError


class PrefabQuote(models.Model):
    _name = "cs.prefab.quote"
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
    total_cents = fields.Integer(required=True, readonly=True)
    expires_at = fields.Datetime(required=True, readonly=True, index=True)
    state = fields.Selection([("new", "Nieuw"), ("review", "In beoordeling"), ("contacted", "Contact opgenomen"), ("closed", "Afgerond")], default="new", required=True)

    _token_unique = models.Constraint("UNIQUE(token)", "A quote access token must be unique.")
    _idempotency_unique = models.Constraint("UNIQUE(company_id, website_id, idempotency_key)", "A submission can only be processed once per website.")
    _reference_unique = models.Constraint("UNIQUE(name)", "A quote reference must be unique.")

    def write(self, values):
        protected = set(self._fields) - {"state", "write_uid", "write_date"}
        if set(values) & protected:
            raise UserError("Opgeslagen offertegegevens zijn onveranderlijk. Maak een nieuwe aanvraag voor een wijziging.")
        return super().write(values)

    def action_open_lead(self):
        self.ensure_one()
        return {"type": "ir.actions.act_window", "res_model": "crm.lead", "res_id": self.lead_id.id, "view_mode": "form", "target": "current"}

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
    expires_at = fields.Datetime(required=True, readonly=True, index=True)
    _token_unique = models.Constraint("UNIQUE(token)", "A share token must be unique.")

    def write(self, values):
        raise UserError("Gedeelde configuraties zijn onveranderlijk. Maak een nieuwe deellink.")

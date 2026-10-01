"""Read-only UI preferences and isolated native website theme CSS."""
from odoo import http
from odoo.http import request

from ..services.appearance import appearance_payload


class PrefabAppearanceController(http.Controller):
    @http.route("/prefab/api/appearance", type="http", auth="public", website=True, methods=["GET"], save_session=False)
    def appearance(self, **kwargs):
        website = request.env["website"].get_current_website()
        record = request.env["cs.prefab.appearance"].sudo().search([
            ("website_id", "=", website.id), ("company_id", "=", website.company_id.id)], limit=1)
        return request.make_json_response(record._public_payload() if record else appearance_payload(),
            headers=[("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")])

    @http.route("/prefab/theme", type="http", auth="public", website=True, methods=["GET"], sitemap=False, save_session=False)
    def theme(self, **kwargs):
        return request.render("cs_prefab_configurator.theme_probe", {}, headers=[
            ("Cache-Control", "no-store"), ("X-Frame-Options", "SAMEORIGIN"),
            ("Referrer-Policy", "no-referrer"), ("X-Content-Type-Options", "nosniff"),
            ("Content-Security-Policy", "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'none'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'")])

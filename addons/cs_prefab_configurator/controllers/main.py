"""Thin Odoo HTTP/CRM adapter for the shared, standard-library domain layer."""
from datetime import timedelta
from pathlib import Path
import secrets
from urllib.parse import urlsplit

from markupsafe import Markup, escape
from odoo import fields, http
from odoo.http import request

from ..services.configuration import canonical_config, canonical_quote_payload
from ..services.errors import DomainError
from ..services.http_api import MAX_BODY_BYTES, RateLimiter, dispatch, enforce_origin, parse_json_body
from ..services.storage import QUOTE_TTL, SHARE_TTL, new_snapshot, valid_token

LIMITER = RateLimiter()


class OdooRepository:
    def __init__(self):
        self.website = request.website
        self.company = self.website.company_id
        self.env = request.env(context=dict(request.env.context, allowed_company_ids=[self.company.id]))

    def _model(self, name):
        return self.env[name].sudo().with_company(self.company)

    def _domain(self):
        return [("company_id", "=", self.company.id), ("website_id", "=", self.website.id)]

    def health(self):
        return {"ok": True, "storage": "odoo", "mode": "demonstration", "emailDelivery": False}

    def create_share(self, config):
        config = canonical_config(config)
        config["postcode"] = ""
        token = secrets.token_urlsafe(32)
        self._model("cs.prefab.share").create({"token": token, "company_id": self.company.id,
            "website_id": self.website.id, "config_json": config,
            "expires_at": fields.Datetime.now() + timedelta(seconds=SHARE_TTL)})
        return {"token": token, "url": f"/prefab?share={token}", "expiresInDays": 30}

    def get_share(self, token):
        if not valid_token(token):
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        record = self._model("cs.prefab.share").search(self._domain() + [("token", "=", token), ("expires_at", ">", fields.Datetime.now())], limit=1)
        if not record:
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        return {"config": record.config_json}

    @staticmethod
    def _quote_result(record):
        return {"reference": record.name, "token": record.token,
            "pdfUrl": f"/prefab/api/quote/{record.token}/pdf", "price": record.snapshot_json["price"],
            "createdAt": record.snapshot_json["createdAt"], "emailSent": False}

    def create_quote(self, payload):
        canonical, key, payload_hash = canonical_quote_payload(payload)
        # Transaction-scoped PostgreSQL lock makes lookup + CRM/quote creation atomic
        # across Odoo workers. The DB unique constraint is the final invariant.
        lock_key = f"prefab:{self.company.id}:{self.website.id}:{key}"
        self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (lock_key,))
        model = self._model("cs.prefab.quote")
        existing = model.search(self._domain() + [("idempotency_key", "=", key)], limit=1)
        if existing:
            if not secrets.compare_digest(existing.payload_hash, payload_hash):
                raise DomainError("Deze aanvraagcode is al gebruikt voor een andere aanvraag.", code="idempotency_conflict", status=409)
            return self._quote_result(existing)
        snapshot = new_snapshot(canonical)
        contact = canonical["contact"]
        reference = f"CS-{fields.Date.today():%Y%m%d}-{secrets.token_hex(4).upper()}"
        description = Markup("<p><strong>Demonstratieprijs — nog technisch en commercieel te beoordelen.</strong></p>")
        description += Markup("<p>%s</p>") % escape(snapshot["price"]["disclaimer"])
        description += Markup("<ul>%s</ul>") % Markup("").join(Markup("<li>%s: %s</li>") % (escape(item["label"]), escape(item["value"])) for item in snapshot["labels"])
        if contact["message"]:
            description += Markup("<p>%s</p>") % escape(contact["message"])
        lead = self._model("crm.lead").with_context(mail_create_nosubscribe=True, mail_create_nolog=True, tracking_disable=True).create({
            "name": f"{reference} · Prefab aanbouw · {contact['name']}", "type": "opportunity",
            "contact_name": contact["name"], "email_from": contact["email"], "phone": contact["phone"],
            "street": f"{contact['address']} {contact['houseNumber']}".strip(), "zip": contact["postcode"], "city": contact["city"],
            "description": description, "company_id": self.company.id, "user_id": False,
            # No fabricated pipeline revenue from the demonstration price book.
            "expected_revenue": 0,
        })
        record = model.create({"name": reference, "token": secrets.token_urlsafe(32),
            "company_id": self.company.id, "website_id": self.website.id, "lead_id": lead.id,
            "idempotency_key": key, "payload_hash": payload_hash, "snapshot_json": snapshot,
            "contact_json": contact, "pricebook_version": snapshot["price"]["pricebookVersion"],
            "total_cents": snapshot["price"]["total"], "expires_at": fields.Datetime.now() + timedelta(seconds=QUOTE_TTL)})
        return self._quote_result(record)

    def get_quote(self, token):
        if not valid_token(token):
            raise DomainError("Deze aanvraag is niet gevonden of verlopen.", code="not_found", status=404)
        record = self._model("cs.prefab.quote").search(self._domain() + [("token", "=", token), ("expires_at", ">", fields.Datetime.now())], limit=1)
        if not record:
            raise DomainError("Deze aanvraag is niet gevonden of verlopen.", code="not_found", status=404)
        return {"reference": record.name, "snapshot": record.snapshot_json, "contact": record.contact_json}


class PrefabController(http.Controller):
    @http.route(["/prefab", "/prefab/"], type="http", auth="public", website=True, sitemap=True, methods=["GET"])
    def configurator(self, **kwargs):
        content = (Path(__file__).resolve().parent.parent / "static" / "index.html").read_bytes()
        return request.make_response(content, headers=[("Content-Type", "text/html; charset=utf-8"), ("Referrer-Policy", "no-referrer")])

    @http.route("/prefab/api/<path:endpoint>", type="http", auth="public", website=True,
                csrf=False, methods=["GET", "POST"], save_session=False)
    def api(self, endpoint, **kwargs):
        try:
            method = request.httprequest.method
            operation = endpoint if endpoint in {"quote", "share", "price"} and method == "POST" else "read"
            identity = f"{request.website.id}:{request.httprequest.remote_addr}"
            LIMITER.check(identity, operation)
            payload = None
            if method == "POST":
                domain = request.website.domain or request.httprequest.host_url
                parsed = urlsplit(domain)
                origin = f"{parsed.scheme}://{parsed.netloc}"
                enforce_origin(request.httprequest.headers, origin)
                length = request.httprequest.content_length
                if length is None or not 0 < length <= MAX_BODY_BYTES:
                    raise DomainError("Ongeldige of te grote aanvraag.", code="payload_too_large", status=413)
                payload = parse_json_body(request.httprequest.get_data(cache=False))
            status, content_type, response = dispatch(OdooRepository(), method, "/prefab/api/" + endpoint, payload)
            headers = [("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer"), ("X-Content-Type-Options", "nosniff")]
            if content_type == "application/json":
                return request.make_json_response(response, status=status, headers=headers)
            headers.append(("Content-Type", content_type))
            if content_type == "application/pdf":
                headers.append(("Content-Disposition", 'attachment; filename="CS-Prefab-aanvraag.pdf"'))
            return request.make_response(response, headers=headers, status=status)
        except DomainError as exc:
            return request.make_json_response(exc.as_dict(), status=exc.status, headers=[("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer")])

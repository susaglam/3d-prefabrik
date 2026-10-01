"""Thin Odoo HTTP/CRM adapter for the shared, standard-library domain layer."""
from datetime import timedelta
from pathlib import Path
import secrets
from urllib.parse import urlsplit

from markupsafe import Markup, escape
from odoo import fields, http
from odoo.http import request
from odoo.exceptions import AccessError, UserError, ValidationError

from ..services.configuration import canonical_config, canonical_quote_payload
from ..services.errors import DomainError
from ..services.http_api import RateLimiter, body_limit, dispatch, enforce_origin, parse_json_body
from ..services.storage import QUOTE_TTL, SHARE_TTL, new_snapshot, valid_token, submission_key, retry_payload
from ..services.catalog import default_release, check_revision, current_release, release_context, public_catalog
from ..services.pricing import price_config

LIMITER = RateLimiter()

# The frame policy of the configurator page, standalone and embedded.
#
# Measured before this existed: /prefab answered with no X-Frame-Options and no
# Content-Security-Policy at all (docs/website/odoo-target.md §5.1, checked twice — once by
# reading web/controllers/home.py and odoo/http/router.py, once with a real HTTPS request from
# outside). Odoo sets a frame policy on /odoo and /web/login and nowhere else; a website route
# gets none. So the page that creates CRM leads could be framed by any site on the internet,
# which is a clickjacking surface over a form.
#
# Embedding the configurator in the new site therefore needs nothing loosened. It needs this
# tightened, and 'self' is exactly enough: the host page and the frame are the same scheme and
# host, because the iframe's src is root-relative and /prefab is a website=True route served on
# whatever host the request arrived at (§5.2).
#
# DENY is the wrong value here, and not only because it would forbid the embed: Odoo's own website
# builder renders the page being edited inside a same-origin iframe, so an administrator editing
# the offerte page would see a blank box where the configurator is. SAMEORIGIN covers both.
#
# Both headers are sent on purpose. frame-ancestors is the one browsers honour; X-Frame-Options
# is for the ones that predate it, and it matches what /prefab/theme and scripts/serve.py have
# always sent. If a genuinely cross-origin parent is ever required, frame-ancestors gains the
# explicit origins AND X-Frame-Options must be dropped in the same edit — the header has no
# multi-origin form, and the strictest of the two wins, which would be the one you did not want.
FRAME_HEADERS = [
    ("X-Frame-Options", "SAMEORIGIN"),
    ("Content-Security-Policy", "frame-ancestors 'self'"),
]


class OdooRepository:
    def __init__(self):
        self.website = request.env["website"].get_current_website()
        if not self.website:
            raise DomainError("Website niet gevonden.", code="not_found", status=404)
        self.company = self.website.company_id
        self.env = request.env(context=dict(request.env.context, allowed_company_ids=[self.company.id]))

    def _model(self, name):
        return self.env[name].sudo().with_company(self.company)

    def _domain(self):
        return [("company_id", "=", self.company.id), ("website_id", "=", self.website.id)]

    def catalog_release(self):
        record = self._model("cs.prefab.catalog.release").search(self._domain() + [("state", "=", "published")], limit=1)
        return record.published_json if record else default_release()

    def health(self):
        return {"ok": True, "storage": "odoo", "mode": current_release()["pricebook"]["priceMode"], "emailDelivery": False}

    def create_share(self, config):
        config = canonical_config(config)
        config["postcode"] = ""
        token = secrets.token_urlsafe(32)
        self._model("cs.prefab.share").create({"token": token, "company_id": self.company.id,
            "website_id": self.website.id, "config_json": config,
            "catalog_revision": current_release()["revision"], "schema_version": str(current_release()["catalog"]["schemaVersion"]),
            "expires_at": fields.Datetime.now() + timedelta(seconds=SHARE_TTL)})
        return {"token": token, "url": f"/prefab?share={token}", "expiresInDays": 30}

    def get_share(self, token):
        if not valid_token(token):
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        record = self._model("cs.prefab.share").search(self._domain() + [("token", "=", token), ("expires_at", ">", fields.Datetime.now())], limit=1)
        if not record:
            raise DomainError("Deze deellink is niet gevonden of verlopen.", code="not_found", status=404)
        return {"config": record.config_json, "catalogRevision": record.catalog_revision or None, "schemaVersion": record.schema_version or "1.0"}

    @staticmethod
    def _quote_result(record):
        return {"reference": record.name, "token": record.token,
            "pdfUrl": f"/prefab/api/quote/{record.token}/pdf", "price": record.snapshot_json["price"],
            "createdAt": record.snapshot_json["createdAt"], "emailSent": False}

    def create_quote(self, payload):
        key = submission_key(payload)
        # Transaction-scoped PostgreSQL lock makes lookup + CRM/quote creation atomic
        # across Odoo workers. The DB unique constraint is the final invariant.
        lock_key = f"prefab:{self.company.id}:{self.website.id}:{key}"
        self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (lock_key,))
        model = self._model("cs.prefab.quote")
        existing = model.search(self._domain() + [("idempotency_key", "=", key)], limit=1)
        if existing:
            canonical, _, payload_hash = retry_payload(payload, existing.snapshot_json)
            if not secrets.compare_digest(existing.payload_hash, payload_hash):
                raise DomainError("Deze aanvraagcode is al gebruikt voor een andere aanvraag.", code="idempotency_conflict", status=409)
            return self._quote_result(existing)
        check_revision(payload.get("catalogRevision"))
        canonical, _, payload_hash = canonical_quote_payload(payload)
        snapshot = new_snapshot(canonical)
        contact = canonical["contact"]
        reference = f"CS-{fields.Date.today():%Y%m%d}-{secrets.token_hex(4).upper()}"
        description = Markup("<p><strong>%s</strong></p>") % escape(snapshot["price"]["priceStatusLabel"])
        description += Markup("<p>%s</p>") % escape(snapshot["price"]["disclaimer"])
        description += Markup("<ul>%s</ul>") % Markup("").join(Markup("<li>%s: %s</li>") % (escape(item["label"]), escape(item["value"])) for item in snapshot["labels"])
        description += Markup("<h3>Leveringsomvang</h3><ul>%s</ul>") % Markup("").join(
            Markup("<li>%s — %s</li>") % (escape(item["label"]), escape(item["summary"])) for item in snapshot["scope"])
        if contact["message"]:
            description += Markup("<p>%s</p>") % escape(contact["message"])
        lead = self._model("crm.lead").with_context(mail_create_nosubscribe=True, mail_create_nolog=True, tracking_disable=True).create({
            "name": f"{reference} · Prefab aanbouw · {contact['name']}", "type": "opportunity",
            "contact_name": contact["name"], "email_from": contact["email"], "phone": contact["phone"],
            "street": f"{contact['address']} {contact['houseNumber']}".strip(), "zip": contact["postcode"], "city": contact["city"],
            "description": description, "company_id": self.company.id, "user_id": False,
            # Only an explicitly approved commercial release can populate revenue.
            "expected_revenue": snapshot["price"]["subtotal"] / 100 if snapshot["price"]["priceMode"] == "commercial" and snapshot.get("commercialApproval") else 0,
        })
        record = model.create({"name": reference, "token": secrets.token_urlsafe(32),
            "company_id": self.company.id, "website_id": self.website.id, "lead_id": lead.id,
            "idempotency_key": key, "payload_hash": payload_hash, "snapshot_json": snapshot,
            "contact_json": contact, "pricebook_version": snapshot["price"]["pricebookVersion"],
            "catalog_revision": snapshot["catalogRevision"],
            "price_mode": snapshot["price"]["priceMode"],
            "total_cents": snapshot["price"]["total"], "expires_at": fields.Datetime.now() + timedelta(seconds=QUOTE_TTL)})
        record._try_native_documents()
        return self._quote_result(record)

    def get_quote(self, token):
        if not valid_token(token):
            raise DomainError("Deze aanvraag is niet gevonden of verlopen.", code="not_found", status=404)
        record = self._model("cs.prefab.quote").search(self._domain() + [("token", "=", token), ("expires_at", ">", fields.Datetime.now())], limit=1)
        if not record:
            raise DomainError("Deze aanvraag is niet gevonden of verlopen.", code="not_found", status=404)
        # The brand — mark, colours and name — is the only live part of an otherwise frozen document:
        # a logo or colour change must reach the proposal without reopening an immutable request.
        return {"reference": record.name, "snapshot": record.snapshot_json, "contact": record.contact_json,
                "brand": record._proposal_logo(), "palette": record._proposal_palette(),
                "brandName": record._proposal_brand_name()}


class PrefabController(http.Controller):
    @http.route("/prefab/admin-preview/<int:release_id>/<string:operation>", type="http", auth="user", website=True,
                csrf=False, methods=["GET", "POST"], save_session=False)
    def admin_preview(self, release_id, operation, **kwargs):
        headers = [("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer"), ("X-Content-Type-Options", "nosniff")]
        try:
            # No sudo or bearer token: both group membership and normal record ACLs apply.
            if not request.env.user.has_group("sales_team.group_sale_manager"):
                raise DomainError("Alleen een verkoopbeheerder kan een concept bekijken.", code="access_denied", status=403)
            website = request.env["website"].get_current_website()
            release = request.env["cs.prefab.catalog.release"].search([("id", "=", release_id), ("website_id", "=", website.id), ("company_id", "in", request.env.companies.ids)], limit=1)
            if not release:
                raise DomainError("Concept niet gevonden binnen deze website en toegestane bedrijven.", code="not_found", status=404)
            if release.state != "draft":
                raise DomainError("Deze versie is geen concept meer.", code="preview_unavailable", status=409)
            bundle = release._draft_bundle(allow_unapproved=True)
            approved = bool(bundle.get("commercialApproval"))
            bundle["revision"] = f"draft-{release.id}-{bundle['revision'][6:]}-{'approved' if approved else 'pending'}"
            preview = {"enabled": True, "releaseId": release.id, "state": "draft", "canSubmit": False,
                       "commercialApprovalStatus": "approved" if approved else "pending" if release.price_mode == "commercial" else "demonstration",
                       "missingCommercialData": release._commercial_missing()}
            with release_context(bundle):
                method = request.httprequest.method
                if operation == "catalog" and method == "GET":
                    result = public_catalog()
                elif operation == "price" and method == "POST":
                    parsed = urlsplit(website.domain or request.httprequest.host_url)
                    enforce_origin(request.httprequest.headers, f"{parsed.scheme}://{parsed.netloc}")
                    maximum = body_limit("/prefab/api/price")
                    if request.httprequest.content_length is None or not 0 < request.httprequest.content_length <= maximum:
                        raise DomainError("Ongeldige of te grote aanvraag.", code="payload_too_large", status=413)
                    payload = parse_json_body(request.httprequest.get_data(cache=False), max_bytes=maximum)
                    if "config" not in payload or set(payload) - {"config", "catalogRevision"}:
                        raise DomainError("Alleen config en catalogRevision zijn toegestaan.")
                    check_revision(payload.get("catalogRevision"))
                    result = price_config(payload["config"])
                else:
                    raise DomainError("Conceptvoorbeelden kunnen niet worden gedeeld of ingediend.", code="preview_read_only", status=403)
            result["preview"] = preview
            return request.make_json_response(result, headers=headers)
        except DomainError as exc:
            return request.make_json_response(exc.as_dict(), status=exc.status, headers=headers)
        except AccessError:
            return request.make_json_response(DomainError("Geen toegang tot dit concept.", code="access_denied", status=403).as_dict(), status=403, headers=headers)
        except (ValidationError, UserError) as exc:
            return request.make_json_response(DomainError(str(exc), code="draft_invalid").as_dict(), status=422, headers=headers)

    @staticmethod
    def _page():
        return (Path(__file__).resolve().parent.parent / "static" / "index.html").read_bytes()

    @http.route(["/prefab", "/prefab/"], type="http", auth="public", website=True, sitemap=True, methods=["GET"])
    def configurator(self, **kwargs):
        return request.make_response(self._page(), headers=[
            ("Content-Type", "text/html; charset=utf-8"), ("Referrer-Policy", "no-referrer")] + FRAME_HEADERS)

    @http.route("/prefab/embed", type="http", auth="public", website=True, sitemap=False, methods=["GET"])
    def configurator_embed(self, **kwargs):
        """The same page, for a frame inside a page of the site.

        The bytes are identical to /prefab -- what differs is the address, and the page reads its
        own path. A distinct route rather than ?embed=1 because app.js calls history.replaceState
        three times to strip a share token from the URL, and the first of those that forgot to
        carry the parameter through would un-embed the page mid-session; and because a route can
        carry its own headers, which a query parameter cannot.

        sitemap=False: the embed address must not be offered to search engines as a second copy
        of the configurator. The page itself already carries <meta name="robots" content="noindex">
        for the same reason, which is the second, independent control -- one covers the sitemap we
        publish, the other covers a crawler that found the URL some other way.
        """
        return request.make_response(self._page(), headers=[
            ("Content-Type", "text/html; charset=utf-8"), ("Referrer-Policy", "no-referrer")] + FRAME_HEADERS)

    @http.route("/prefab/api/<path:endpoint>", type="http", auth="public", website=True,
                csrf=False, methods=["GET", "POST"], save_session=False)
    def api(self, endpoint, **kwargs):
        try:
            repository = OdooRepository()
            method = request.httprequest.method
            operation = endpoint if endpoint in {"quote", "share", "price"} and method == "POST" else "read"
            identity = f"{repository.website.id}:{request.httprequest.remote_addr}"
            LIMITER.check(identity, operation)
            payload = None
            if method == "POST":
                domain = repository.website.domain or request.httprequest.host_url
                parsed = urlsplit(domain)
                origin = f"{parsed.scheme}://{parsed.netloc}"
                enforce_origin(request.httprequest.headers, origin)
                length = request.httprequest.content_length
                maximum = body_limit("/prefab/api/" + endpoint)
                if length is None or not 0 < length <= maximum:
                    raise DomainError("Ongeldige of te grote aanvraag.", code="payload_too_large", status=413)
                payload = parse_json_body(request.httprequest.get_data(cache=False), max_bytes=maximum)
            status, content_type, response = dispatch(repository, method, "/prefab/api/" + endpoint, payload)
            headers = [("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer"), ("X-Content-Type-Options", "nosniff")]
            if content_type == "application/json":
                return request.make_json_response(response, status=status, headers=headers)
            headers.append(("Content-Type", content_type))
            if content_type == "application/pdf":
                headers.append(("Content-Disposition", 'attachment; filename="CS-Prefab-aanvraag.pdf"'))
            return request.make_response(response, headers=headers, status=status)
        except DomainError as exc:
            return request.make_json_response(exc.as_dict(), status=exc.status, headers=[("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer")])

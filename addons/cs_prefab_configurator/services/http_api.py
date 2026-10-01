"""Small JSON API contract, usable without an Odoo runtime."""
from collections import deque
import json
import threading
import time

from .catalog import public_catalog, release_context, check_revision
from .documents import quote_html, quote_pdf
from .errors import DomainError
from .pricing import price_config

MAX_BODY_BYTES = 32768
MAX_QUOTE_BODY_BYTES = 6 * 1024 * 1024


def body_limit(path):
    return MAX_QUOTE_BODY_BYTES if path == "/prefab/api/quote" else MAX_BODY_BYTES


class RateLimiter:
    """Bounded sliding-window limiter. Production should also limit at its proxy."""
    def __init__(self):
        self._entries = {}
        self._lock = threading.Lock()

    def check(self, identity, operation, *, now=None):
        now = time.monotonic() if now is None else now
        limit, window = {"quote": (10, 3600), "share": (30, 3600), "price": (240, 60), "read": (300, 60)}[operation]
        key = (identity, operation)
        with self._lock:
            if len(self._entries) > 10000:
                self._entries = {k: v for k, v in self._entries.items() if v and v[-1] > now - 3600}
                if len(self._entries) > 10000:
                    raise DomainError("De dienst is druk. Probeer het later opnieuw.", code="rate_limited", status=429)
            queue = self._entries.setdefault(key, deque())
            while queue and queue[0] <= now - window:
                queue.popleft()
            if len(queue) >= limit:
                raise DomainError("Te veel aanvragen. Probeer het later opnieuw.", code="rate_limited", status=429)
            queue.append(now)


def enforce_origin(headers, expected_origin):
    origin = headers.get("Origin", "")
    if not origin or origin.rstrip("/") != expected_origin.rstrip("/"):
        raise DomainError("Aanvraag vanaf een onbekende website geweigerd.", code="invalid_origin", status=403)
    if headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
        raise DomainError("Cross-site aanvraag geweigerd.", code="invalid_origin", status=403)
    content_type = headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise DomainError("Gebruik application/json.", code="unsupported_media_type", status=415)


def parse_json_body(raw, *, max_bytes=MAX_BODY_BYTES):
    if len(raw) > max_bytes:
        raise DomainError("De aanvraag is te groot.", code="payload_too_large", status=413)
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result

    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                             parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        raise DomainError("Ongeldige JSON.", code="invalid_json", status=400) from None
    if not isinstance(payload, dict):
        raise DomainError("Een JSON-object is vereist.", code="invalid_json", status=400)
    pending = [(payload, 0)]
    while pending:
        node, depth = pending.pop()
        if depth > 12:
            raise DomainError("JSON is te diep genest.", code="invalid_json", status=400)
        if isinstance(node, dict):
            pending.extend((key, depth + 1) for key in node)
            pending.extend((value, depth + 1) for value in node.values())
        elif isinstance(node, list):
            pending.extend((value, depth + 1) for value in node)
        elif isinstance(node, str):
            try:
                node.encode("utf-8")
            except UnicodeError:
                raise DomainError("JSON bevat ongeldige Unicode-tekens.", code="invalid_json", status=400) from None
    return payload


def dispatch(repository, method, path, payload=None):
    release = repository.catalog_release() if hasattr(repository, "catalog_release") else None
    with release_context(release):
        return _dispatch(repository, method, path, payload)


def _dispatch(repository, method, path, payload=None):
    if method == "GET" and path == "/prefab/api/health":
        return 200, "application/json", repository.health()
    if method == "GET" and path == "/prefab/api/catalog":
        return 200, "application/json", public_catalog()
    if method == "POST" and path in ("/prefab/api/price", "/prefab/api/share"):
        if not isinstance(payload, dict) or "config" not in payload or set(payload) - {"config", "catalogRevision"}:
            raise DomainError("Alleen config en catalogRevision zijn toegestaan.")
        check_revision(payload.get("catalogRevision"))
        if path.endswith("price"):
            return 200, "application/json", price_config(payload["config"])
        return 201, "application/json", repository.create_share(payload["config"])
    if method == "POST" and path == "/prefab/api/quote":
        return 201, "application/json", repository.create_quote(payload)
    if method == "GET" and path.startswith("/prefab/api/share/"):
        return 200, "application/json", repository.get_share(path.removeprefix("/prefab/api/share/"))
    parts = path.strip("/").split("/")
    if method == "GET" and len(parts) == 5 and parts[:3] == ["prefab", "api", "quote"] and parts[4] in ("pdf", "html"):
        quote = repository.get_quote(parts[3])
        if parts[4] == "pdf":
            return 200, "application/pdf", quote_pdf(quote)
        return 200, "text/html; charset=utf-8", quote_html(quote)
    raise DomainError("Niet gevonden.", code="not_found", status=404)

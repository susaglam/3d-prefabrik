#!/usr/bin/env python3
"""Run the local durable configurator: python3 scripts/serve.py --port 8069."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import mimetypes
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "addons" / "cs_prefab_configurator"
sys.path.insert(0, str(ADDON))

from services.errors import DomainError
from services.http_api import RateLimiter, body_limit, dispatch, enforce_origin, parse_json_body
from services.storage import SQLiteRepository

STATIC = ADDON / "static"
LOGGER = logging.getLogger("prefab")


class Handler(BaseHTTPRequestHandler):
    server_version = "CSPrefab/1.0"
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, fmt, *args):
        # Do not log contact values, request bodies, or bearer tokens in URL paths.
        LOGGER.info("%s %s", self.command, self._safe_path())

    def _safe_path(self):
        path = urlsplit(self.path).path
        if "/quote/" in path or "/share/" in path:
            return path.rsplit("/", 2)[0] + "/[private]"
        return path[:160]

    def _send(self, status, content_type, data, *, head=False):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Cache-Control", "no-store" if "/api/" in self.path else "no-cache")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
        if content_type == "application/pdf":
            self.send_header("Content-Disposition", 'attachment; filename="CS-Prefab-aanvraag.pdf"')
        if status == 429:
            self.send_header("Retry-After", "60")
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def _handle(self, *, head=False):
        try:
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            if path.startswith("/prefab/api/"):
                method = "GET" if head else self.command
                operation = path.rsplit("/", 1)[-1] if method == "POST" else "read"
                self.server.limiter.check(self.client_address[0], operation if operation in {"price", "quote", "share"} else "read")
                payload = None
                if method == "POST":
                    expected = self.server.public_origin or ("http://" + self.headers.get("Host", ""))
                    if not self.server.public_origin:
                        host = urlsplit(expected).hostname
                        if host not in {"localhost", "127.0.0.1", "::1", self.server.server_address[0]}:
                            raise DomainError("Onbekende host. Stel --public-origin in.", code="invalid_host", status=403)
                    enforce_origin(self.headers, expected)
                    if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                        raise DomainError("Chunked requests worden niet ondersteund.", code="invalid_request", status=400)
                    try:
                        length = int(self.headers.get("Content-Length", "0"))
                    except ValueError:
                        length = -1
                    maximum = body_limit(path)
                    if not 0 < length <= maximum:
                        raise DomainError("Ongeldige of te grote aanvraag.", code="payload_too_large", status=413)
                    payload = parse_json_body(self.rfile.read(length), max_bytes=maximum)
                status, content_type, response = dispatch(self.server.repository, method, path, payload)
                self._send(status, content_type, response, head=head)
                return
            if self.command not in {"GET", "HEAD"}:
                raise DomainError("Methode niet toegestaan.", code="method_not_allowed", status=405)
            if path in ("/", "/prefab", "/prefab/", "/offerte", "/offerte/"):
                asset = STATIC / "index.html"
            else:
                relative = path.removeprefix("/cs_prefab_configurator/static/").lstrip("/")
                asset = (STATIC / relative).resolve()
                if STATIC.resolve() not in asset.parents:
                    raise DomainError("Niet gevonden.", code="not_found", status=404)
            if not asset.is_file():
                raise DomainError("Niet gevonden.", code="not_found", status=404)
            self._send(200, mimetypes.guess_type(asset.name)[0] or "application/octet-stream", asset.read_bytes(), head=head)
        except DomainError as exc:
            if self.command == "POST":
                # Unconsumed bodies must not become a second request on this connection.
                self.close_connection = True
            self._send(exc.status, "application/json", exc.as_dict(), head=head)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception:
            LOGGER.exception("Request failed at %s", self._safe_path())
            self.close_connection = True
            self._send(500, "application/json", {"error": {"code": "internal_error", "message": "Er ging iets mis. Probeer opnieuw.", "fields": {}}}, head=head)

    def do_GET(self):
        self._handle()

    def do_HEAD(self):
        self._handle(head=True)

    def do_POST(self):
        self._handle()

    def do_OPTIONS(self):
        self._send(405, "application/json", {"error": {"code": "method_not_allowed", "message": "Cross-origin toegang is niet toegestaan."}})


def create_server(host="127.0.0.1", port=8069, database=None, public_origin=None):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.repository = SQLiteRepository(database or ROOT / ".data" / "prefab.sqlite3")
    server.repository.purge_expired()
    server.limiter = RateLimiter()
    server.public_origin = public_origin
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8069)
    parser.add_argument("--db", type=Path, default=ROOT / ".data" / "prefab.sqlite3")
    parser.add_argument("--public-origin", help="Exact permitted browser origin for a trusted reverse proxy.")
    parser.add_argument("--purge-expired", action="store_true", help="Delete expired private records and exit.")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.purge_expired:
        print(json.dumps(SQLiteRepository(args.db).purge_expired()))
        return
    server = create_server(args.host, args.port, args.db, args.public_origin)
    print(f"CS Prefab running at http://{args.host}:{server.server_port}/prefab (DEMONSTRATION pricing; local storage only)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

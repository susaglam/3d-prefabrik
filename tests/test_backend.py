"""Run with: python3 -m unittest discover -s tests -p 'test_*.py' -v."""
import copy
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, ROUND_HALF_UP
import http.client
import importlib.util
import io
import json
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "addons" / "cs_prefab_configurator"
sys.path.insert(0, str(ADDON))
from services.catalog import get_catalog, get_pricebook, public_catalog
from services.configuration import canonical_config, canonical_contact, canonical_quote_payload
from services.documents import quote_html, quote_pdf
from services.errors import DomainError
from services.http_api import RateLimiter, parse_json_body
from services.pricing import price_config
from services.storage import SQLiteRepository

spec = importlib.util.spec_from_file_location("prefab_dev_server", ROOT / "scripts" / "serve.py")
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


def contact():
    return {"firstName": "Ada", "lastName": "Tester", "email": "ada@example.test", "phone": "+31 6 12345678",
            "postcode": "1234 AB", "houseNumber": "12A", "address": "Voorbeeldstraat", "city": "Utrecht", "message": "Testaanvraag"}


def payload():
    return {"config": {}, "contact": contact(), "consent": True, "idempotencyKey": str(uuid.uuid4())}


class DomainTests(unittest.TestCase):
    def test_source_dimension_boundaries_and_integer_precision(self):
        for width, depth in [(150, 100), (750, 340), (151, 101), (501, 299)]:
            result = canonical_config({"width": width, "depth": depth, "frontOpening": "none"})
            self.assertEqual((result["width"], result["depth"]), (width, depth))
        for value in [149, 751, 150.5, True, "500", None, float("nan")]:
            with self.subTest(value=value), self.assertRaises(DomainError):
                canonical_config({"width": value})
        for value in [99, 341]:
            with self.assertRaises(DomainError):
                canonical_config({"depth": value})
        with self.assertRaises(DomainError):
            canonical_config({"height": 300})

    def test_catalog_exact_option_counts_and_pricebook_coverage(self):
        catalog = get_catalog()
        fields = {f["key"]: f for g in catalog["groups"] for f in g["fields"]}
        self.assertEqual(len(fields["facade"]["options"]), 13)
        self.assertEqual(len(fields["frontOpening"]["options"]), 11)
        self.assertEqual(len(fields["rooflight"]["options"]), 11)
        for key, prices in get_pricebook()["optionPrices"].items():
            expected = {str(o["id"]).lower() if isinstance(o["id"], bool) else str(o["id"]) for o in fields[key]["options"]}
            self.assertEqual(set(prices), expected, key)

    def test_all_catalog_options_are_valid_and_priceable(self):
        for group in get_catalog()["groups"]:
            for field in group["fields"]:
                for option in field.get("options", []):
                    with self.subTest(key=field["key"], option=option["id"]):
                        value = [option["id"]] if field["type"] == "multiselect" else option["id"]
                        result = price_config({"interior": True, field["key"]: value})
                        self.assertGreater(result["total"], 0)
                        self.assertIs(type(result["total"]), int)

    def test_unknown_fields_options_and_wrong_types_rejected(self):
        for config in [{"total": 1}, {"facade": "free"}, {"piles": 5}, {"piles": "3"},
                       {"interior": 1}, {"spotlights": True}, {"outsideSocket": "invalid"}, {"postcode": []}]:
            with self.subTest(config=config), self.assertRaises(DomainError):
                canonical_config(config)

    def test_hidden_interior_values_reset_and_not_charged(self):
        configured = {"interior": True, "plaster": True, "screed": True, "underfloorHeating": True,
                      "heating": "both", "ceilingLights": 2, "switches": 2, "spotlights": 12, "sockets": "both"}
        self.assertGreater(price_config(configured)["total"], price_config({})["total"])
        configured["interior"] = False
        reset = price_config(configured)
        self.assertEqual(reset["total"], price_config({})["total"])
        self.assertFalse(reset["config"]["plaster"])
        self.assertEqual(reset["config"]["spotlights"], 0)
        self.assertNotIn("plaster", [x["key"] for x in reset["labels"]])

    def test_invalid_hidden_values_still_rejected(self):
        with self.assertRaises(DomainError):
            canonical_config({"interior": False, "spotlights": 10000})

    def test_independent_default_price_and_decimal_rounding(self):
        result = price_config({})
        # 2.16.0: the design opens with "geen kozijn" (the customer: "başlangıçta geen deur seçili olmalı"), so the
        # 2-delige schuifpui's EUR 2.850 is no longer in the opening price. Everything else is unchanged.
        expected_net = 15 * 135000 + 325000 + 15 * 18000 + 25000 + 65000 + 270000
        self.assertEqual(result["subtotal"], expected_net)
        self.assertEqual(result["total"], expected_net + int(expected_net * 0.21))
        self.assertEqual(price_config({"frontOpening": "sliding-2-black"})["subtotal"], expected_net + 285000,
                         "choosing the schuifpui adds exactly its price")
        fractional = price_config({"width": 151, "depth": 101, "frontOpening": "none"})
        base = next(line for line in fractional["lines"] if line["id"] == "base")
        self.assertEqual(base["total"], 205889)  # 1.5251 m2 * EUR 1350, half-up cents
        self.assertEqual(fractional["vat"], int((Decimal(fractional["subtotal"]) * Decimal("0.21")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)))

    def test_demo_and_scope_disclaimers_preserved(self):
        catalog = public_catalog()
        self.assertEqual(catalog["priceMode"], "demonstration")
        result = price_config({"interior": True, "underfloorHeating": True, "heating": "left", "ceilingLights": 1})
        self.assertEqual(result["priceMode"], "demonstration")
        self.assertTrue(any("loze leiding" in w for w in result["warnings"]))
        self.assertTrue(any("aansluiting" in w.lower() for w in result["warnings"]))
        self.assertTrue(any("Plafondlampen" in w for w in result["warnings"]))

    def test_postcode_and_contact_normalization(self):
        self.assertEqual(canonical_config({"postcode": "1234ab"})["postcode"], "1234 AB")
        data = contact()
        data["email"] = "ADA@EXAMPLE.TEST"
        result = canonical_contact(data)
        self.assertEqual(result["email"], "ada@example.test")
        self.assertEqual(result["name"], "Ada Tester")
        for key in ("firstName", "lastName", "email", "phone", "postcode", "houseNumber", "address", "city"):
            invalid = contact()
            invalid[key] = ""
            with self.subTest(key=key), self.assertRaises(DomainError):
                canonical_contact(invalid)

    def test_contact_rejects_bad_lengths_control_chars_and_unknown_fields(self):
        for key, value in [("email", "bad"), ("phone", "x"), ("postcode", "0000 XX"), ("message", "a" * 3001), ("lastName", "a\x00b"), ("admin", True)]:
            invalid = contact()
            invalid[key] = value
            with self.subTest(key=key), self.assertRaises(DomainError):
                canonical_contact(invalid)

    def test_quote_payload_consent_key_and_postcode_binding(self):
        data = payload()
        canonical, key, hashed = canonical_quote_payload(data)
        self.assertEqual(canonical["config"]["postcode"], "1234 AB")
        self.assertEqual(len(hashed), 64)
        for field, value in [("consent", False), ("consent", "true"), ("idempotencyKey", "guessable"), ("total", 1), ("config", {"postcode": "5678 CD"})]:
            invalid = payload()
            invalid[field] = value
            with self.subTest(field=field), self.assertRaises(DomainError):
                canonical_quote_payload(invalid)

    def test_json_rejects_duplicates_nonfinite_oversize_and_deep_nesting(self):
        for raw in [b'{"config":{},"config":{"width":100}}', b'{"width":NaN}', b'{"x":Infinity}', b'{"x":"\\ud800"}', b'{"\\udfff":true}', b'[]', b'x', b'a' * 32769, b'{"x":' + b'[' * 2000 + b']' * 2000 + b'}']:
            with self.subTest(raw=raw[:60]), self.assertRaises(DomainError):
                parse_json_body(raw)

    def test_rate_limit_is_ip_scoped_and_window_expires(self):
        limiter = RateLimiter()
        for _ in range(10):
            limiter.check("ip-a", "quote", now=0)
        with self.assertRaises(DomainError) as caught:
            limiter.check("ip-a", "quote", now=1)
        self.assertEqual(caught.exception.status, 429)
        limiter.check("ip-b", "quote", now=1)
        limiter.check("ip-a", "quote", now=3600)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "db.sqlite3"
        self.repo = SQLiteRepository(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_share_strips_location_and_has_no_contact(self):
        result = self.repo.create_share({"postcode": "1234 AB", "facade": "wood-vertical"})
        shared = self.repo.get_share(result["token"])
        self.assertEqual(shared["config"]["postcode"], "")
        self.assertEqual(shared["config"]["facade"], "wood-vertical")
        self.assertEqual(set(shared), {"config", "catalogRevision", "schemaVersion"})
        self.assertEqual(shared["catalogRevision"], public_catalog()["catalogRevision"])
        self.assertEqual(len(result["token"]), 43)

    def test_tokens_are_scoped_and_unpredictable(self):
        other = SQLiteRepository(self.path, scope="other:company:website")
        share = self.repo.create_share({})
        quote = self.repo.create_quote(payload())
        for repository, operation, token in [(other, "get_share", share["token"]), (other, "get_quote", quote["token"]), (self.repo, "get_share", "bad"), (self.repo, "get_quote", secrets.token_urlsafe(32))]:
            with self.assertRaises(DomainError) as caught:
                getattr(repository, operation)(token)
            self.assertEqual(caught.exception.status, 404)

    def test_idempotent_retry_and_restart_preserve_original_snapshot(self):
        data = payload()
        first = self.repo.create_quote(data)
        with patch("services.storage.new_snapshot", side_effect=AssertionError("Must not reprice retry")):
            second = SQLiteRepository(self.path).create_quote(copy.deepcopy(data))
        self.assertEqual(first, second)
        stored = self.repo.get_quote(first["token"])
        self.assertEqual(stored["snapshot"]["price"]["total"], first["price"]["total"])
        self.assertEqual(stored["snapshot"]["consent"]["textVersion"], "quote-contact-v1")

    def test_reused_key_cannot_return_different_customers_private_token(self):
        data = payload()
        first = self.repo.create_quote(data)
        data["contact"]["email"] = "other@example.test"
        with self.assertRaises(DomainError) as caught:
            self.repo.create_quote(data)
        self.assertEqual(caught.exception.status, 409)
        self.assertNotIn(first["token"], str(caught.exception))

    def test_concurrent_duplicate_submissions_create_one_record(self):
        data = payload()
        with ThreadPoolExecutor(max_workers=6) as executor:
            responses = list(executor.map(lambda _: self.repo.create_quote(copy.deepcopy(data)), range(12)))
        self.assertEqual(len({r["reference"] for r in responses}), 1)
        with self.repo.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM quotes").fetchone()[0], 1)

    def test_saved_snapshot_cannot_be_updated(self):
        result = self.repo.create_quote(payload())
        with self.assertRaises(sqlite3.IntegrityError), self.repo.connect() as db:
            db.execute("UPDATE quotes SET snapshot_json = '{}' WHERE token = ?", (result["token"],))

    def test_expired_links_unavailable_and_purge_removes_personal_data(self):
        with patch("services.storage.time.time", return_value=1):
            share = self.repo.create_share({})
            quote = self.repo.create_quote(payload())
        for method, token in [("get_share", share["token"]), ("get_quote", quote["token"])]:
            with self.assertRaises(DomainError):
                getattr(self.repo, method)(token)
        self.assertEqual(self.repo.purge_expired(), {"shares": 1, "quotes": 1})

    def test_pdf_is_real_paginated_snapshot_and_html_escapes_contact(self):
        data = payload()
        data["contact"]["message"] = '<script>alert("x")</script> ' + "uitgebreide toelichting " * 90
        result = self.repo.create_quote(data)
        quote = self.repo.get_quote(result["token"])
        pdf = quote_pdf(quote)
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertTrue(pdf.endswith(b"%%EOF\n"))
        self.assertIn(b"/FontFile2", pdf)
        self.assertIn(b"/ToUnicode", pdf)
        self.assertGreater(pdf.count(b"/Type /Page "), 1)
        html = quote_html(quote)
        self.assertNotIn(b"<script>", html)
        self.assertIn(b"&lt;script&gt;", html)

    @unittest.skipUnless(importlib.util.find_spec("pypdf"), "Optional pypdf independent parser is not installed")
    def test_pdf_independent_parser_validates_pages_and_saved_text(self):
        from pypdf import PdfReader
        data = payload()
        data["contact"]["message"] = "uitgebreide toelichting " * 90
        result = self.repo.create_quote(data)
        pdf = quote_pdf(self.repo.get_quote(result["token"]))
        parsed = PdfReader(io.BytesIO(pdf))
        self.assertGreater(len(parsed.pages), 1)
        text = " ".join(page.extract_text() for page in parsed.pages)
        self.assertIn("demonstratie", text.lower())
        self.assertIn("Ada Tester", text)
        self.assertIn(result["reference"], text)
        self.assertIn("Schematische plattegrond", text)

    @unittest.skipUnless(importlib.util.find_spec("pypdf"), "Optional pypdf independent parser is not installed")
    def test_pdf_preserves_turkish_names_and_dimensioned_plan(self):
        from pypdf import PdfReader
        data = payload()
        data["contact"].update({"firstName": "Şükrü", "lastName": "Çağrı", "message": "İstanbul, ığüşöç — €"})
        data["config"].update({"width": 501, "depth": 299, "rooflight": "lean-2"})
        result = self.repo.create_quote(data)
        pdf = quote_pdf(self.repo.get_quote(result["token"]))
        self.assertIn(b"/Identity-H", pdf)
        text = " ".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
        self.assertIn("Şükrü Çağrı", text)
        self.assertIn("İstanbul, ığüşöç — €", text)
        self.assertIn("Breedte: 501 cm", text)
        self.assertIn("Diepte: 299 cm", text)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = server_module.create_server(port=0, database=Path(cls.temp.name) / "http.sqlite3")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def send(self, method, path, data=None, headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
        request_headers = {"Content-Type": "application/json", "Origin": self.origin}
        request_headers.update(headers or {})
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        content = response.read()
        result = (response.status, dict(response.getheaders()), content)
        connection.close()
        return result

    def test_health_catalog_and_static_assets(self):
        for path in ("/prefab/api/health", "/prefab/api/catalog", "/prefab", "/cs_prefab_configurator/static/src/app.js"):
            status, headers, body = self.send("GET", path)
            self.assertEqual(status, 200, (path, body))
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_entrypoint_csp_allows_importmap_without_allowing_inline_scripts(self):
        status, headers, body = self.send("GET", "/prefab")
        self.assertEqual(status, 200)
        script_policy = next(part.strip() for part in headers["Content-Security-Policy"].split(";") if part.strip().startswith("script-src "))
        # Golden hash for the 23-entry import map (embed.js added for the /prefab/embed frame contract;
        # house_type_icons.js in 2.9.3; finishes.js and scene_content.js in 2.9.6; denoise.js gone with the path
        # tracer; view_icons.js and scene_icons.js in 2.10.7 for the Weergave dialog and the drawn camera tools;
        # garden_fence.js in 2.12.0 for the garden boundary styles). Browser acceptance also verifies that the real module graph executes — a module missing from the
        # map would load unversioned and verify-workspace fails, and a hash that did not match the script it
        # authorises would make Chromium block the map outright, so every browser gate would go red at once.
        # The hash covers the map TEXT, so EVERY release that moves the ?v= stamp changes it. The bump step
        # recomputes it with serve.importmap_csp_sources over the shipped index.html and rewrites the line
        # below; it is never typed by hand, and no release number belongs in this comment because every
        # release reissues it.
        self.assertEqual(script_policy, "script-src 'self' 'sha256-Zsy7kD7aq73jHxpd25OGTTcsSSbiiGtL+wta61t/XqA='")
        self.assertNotIn("unsafe-inline", script_policy)
        self.assertEqual(server_module.importmap_csp_sources(body.replace(b"\r\n", b"\n")),
                         server_module.importmap_csp_sources(body.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")))
        _, api_headers, _ = self.send("GET", "/prefab/api/catalog")
        self.assertNotIn("sha256-", api_headers["Content-Security-Policy"])

    def test_importmap_hash_does_not_authorize_other_inline_scripts(self):
        trusted_map = b'<script type="importmap">{"imports":{}}</script>'
        extra_scripts = b'<script>alert(1)</script><script type="module">alert(2)</script>'
        self.assertEqual(server_module.importmap_csp_sources(trusted_map + extra_scripts),
                         server_module.importmap_csp_sources(trusted_map))
        self.assertEqual(server_module.importmap_csp_sources(extra_scripts), "")

    def test_complete_share_quote_pdf_funnel(self):
        status, headers, body = self.send("POST", "/prefab/api/price", {"config": {"width": 600}})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["config"]["width"], 600)
        status, _, body = self.send("POST", "/prefab/api/share", {"config": {"facade": "wood-vertical"}})
        self.assertEqual(status, 201)
        token = json.loads(body)["token"]
        status, _, body = self.send("GET", f"/prefab/api/share/{token}")
        self.assertEqual(json.loads(body)["config"]["facade"], "wood-vertical")
        status, _, body = self.send("POST", "/prefab/api/quote", payload())
        self.assertEqual(status, 201, body)
        quote = json.loads(body)
        status, headers, pdf = self.send("GET", quote["pdfUrl"])
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/pdf")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_cross_origin_and_wrong_content_type_rejected(self):
        for headers, expected in [({"Origin": "https://attacker.example"}, 403), ({"Origin": ""}, 403),
                                  ({"Sec-Fetch-Site": "cross-site"}, 403), ({"Content-Type": "text/plain"}, 415)]:
            status, _, _ = self.send("POST", "/prefab/api/price", {"config": {}}, headers=headers)
            self.assertEqual(status, expected)

    def test_invalid_payload_unknown_route_and_traversal(self):
        for path, body, expected in [("/prefab/api/price", b'{"config":{"width":9999}}', 422),
                                     ("/prefab/api/price", b'{"config":{},"total":0}', 422),
                                     ("/prefab/api/price", b'not JSON', 400),
                                     ("/prefab/api/price", b'X' * 32769, 413),
                                     ("/prefab/api/unknown", b'{}', 404)]:
            status, _, _ = self.send("POST", path, raw=body)
            self.assertEqual(status, expected)
        for path in ("/cs_prefab_configurator/static/../data/catalog.json", "/%2e%2e/services/storage.py", "/prefab/api/quote/guessed/pdf"):
            status, _, _ = self.send("GET", path)
            self.assertEqual(status, 404)

    def test_embed_address_serves_the_same_page_under_a_frame_policy(self):
        """The dev server and the Odoo route answer /prefab/embed identically.

        This matters beyond tidiness: scripts/serve.py was already STRICTER than production
        (frame-ancestors 'self' since it was written, while /prefab in Odoo had no frame policy at
        all), so a developer testing the embed locally was measuring behaviour the live site did
        not have. The two are the same now, and this is the assertion that keeps them so.
        """
        standalone_status, standalone_headers, standalone_body = self.send("GET", "/prefab")
        status, headers, body = self.send("GET", "/prefab/embed")
        self.assertEqual((standalone_status, status), (200, 200))
        self.assertEqual(body, standalone_body)
        for response_headers in (standalone_headers, headers):
            self.assertEqual(response_headers["X-Frame-Options"], "SAMEORIGIN")
            self.assertIn("frame-ancestors 'self'", response_headers["Content-Security-Policy"])
            self.assertNotIn("frame-ancestors *", response_headers["Content-Security-Policy"])

    def test_head_preserves_content_length_without_body(self):
        status, headers, body = self.send("HEAD", "/prefab/api/catalog")
        self.assertEqual(status, 200)
        self.assertGreater(int(headers["Content-Length"]), 0)
        self.assertEqual(body, b"")


class OdooStaticTests(unittest.TestCase):
    def test_all_xml_parses_and_manifest_files_exist(self):
        import ast
        manifest = ast.literal_eval((ADDON / "__manifest__.py").read_text())
        self.assertEqual(manifest["version"], "saas~19.4.2.18.4")
        for relative in manifest["data"]:
            path = ADDON / relative
            self.assertTrue(path.exists(), relative)
            if path.suffix == ".xml":
                ET.parse(path)

    def test_the_embed_route_is_declared_the_way_the_frame_policy_assumes(self):
        """Two things a response cannot show you, read from the source instead.

        `sitemap=False` keeps the embed address out of /sitemap.xml -- a routing flag, invisible
        from outside. And the two header values are pinned here as literals as well as in the
        module's own Odoo test, because those two checks fail for different reasons: this one
        fails when somebody edits the constant, the Odoo one fails when the constant stops being
        applied to the response.
        """
        source = (ADDON / "controllers" / "main.py").read_text(encoding="utf-8")
        embed = source.split('@http.route("/prefab/embed"', 1)
        self.assertEqual(len(embed), 2, "the embed route is gone")
        declaration = embed[1].split(")", 1)[0]
        self.assertIn("sitemap=False", declaration)
        self.assertIn('methods=["GET"]', declaration)
        self.assertIn('auth="public"', declaration)
        self.assertIn('("X-Frame-Options", "SAMEORIGIN")', source)
        self.assertIn("""("Content-Security-Policy", "frame-ancestors 'self'")""", source)

    def test_no_public_or_portal_model_acl(self):
        import csv
        with (ADDON / "security" / "ir.access.csv").open() as handle:
            for row in csv.DictReader(handle):
                self.assertNotIn(row["group_id/id"], {"base.group_public", "base.group_portal"})
                self.assertTrue(row["model_id"].startswith("cs.prefab."))
                if row["group_id/id"] and row["model_id"] in {"cs.prefab.quote", "cs.prefab.share"}:
                    self.assertNotIn("c", row["operation"])
                if not row["group_id/id"]:
                    self.assertIn("company_ids", row["domain"])


class RemovedOdooApiTests(unittest.TestCase):
    """APIs saas~19.4 dropped, checked across every module this repository ships.

    Each of these raises at load time, not at call time in some rare branch, so a single occurrence takes the
    whole deploy down: the module installs, the registry fails and the database is left uninitialised. That is
    exactly what happened on 2026-09-17 with `ir.config_parameter.get_param`, which cost a full clone-test cycle
    to discover. The entry was already in the global compatibility matrix; nothing read it.

    Keep this list to removals that are FATAL and STATIC. Something merely deprecated does not belong here: a
    gate that cries wolf is switched off, and the real protection goes with it.
    """

    # (fragment, what to use instead). Matched as plain text against the source of every shipped .py file.
    REMOVED = (
        (".get_param(", "ir.config_parameter typed getters: get_str / get_int / get_bool / get_float"),
        (".set_param(", "ir.config_parameter typed setters: set_str / set_int / set_bool / set_float"),
        (".check_access_rights(", "has_access()"),
        ("registry.clear_cache(", "env.transaction.invalidate_ormcache()"),
        ("from odoo import SUPERUSER_ID", "from odoo.api import SUPERUSER_ID"),
    )

    def _shipped_sources(self):
        for module in sorted((ROOT / "addons").iterdir()):
            if not module.is_dir() or not (module / "__manifest__.py").is_file():
                continue
            for path in sorted(module.rglob("*.py")):
                if "__pycache__" in path.parts:
                    continue
                yield path

    def test_no_module_calls_an_api_saas_19_4_removed(self):
        found = []
        for path in self._shipped_sources():
            source = path.read_text(encoding="utf-8")
            for fragment, replacement in self.REMOVED:
                if fragment in source:
                    found.append(f"{path.relative_to(ROOT)} uses {fragment} -- use {replacement}")
        self.assertEqual(found, [], "\n".join(found))

    def test_the_guard_can_actually_fail(self):
        """A control only ever seen passing is not evidence. Prove the matcher fires on a known-bad line."""
        sample = 'value = self.env["ir.config_parameter"].sudo().get_param("x", "y")'
        self.assertTrue(any(fragment in sample for fragment, _ in self.REMOVED))

    def test_security_files_use_the_saas_19_4_model(self):
        """ir.model.access.csv and ir.rule records were replaced by ir.access in saas~19.4."""
        for module in sorted((ROOT / "addons").iterdir()):
            if not module.is_dir() or not (module / "__manifest__.py").is_file():
                continue
            security = module / "security"
            if not security.is_dir():
                continue
            self.assertFalse((security / "ir.model.access.csv").is_file(),
                             f"{module.name}: ir.model.access.csv was replaced by ir.access.csv")
            for path in sorted(security.rglob("*.xml")):
                body = path.read_text(encoding="utf-8")
                self.assertNotIn('model="ir.rule"', body, str(path.relative_to(ROOT)))
                self.assertNotIn('model="ir.model.access"', body, str(path.relative_to(ROOT)))


if __name__ == "__main__":
    unittest.main()

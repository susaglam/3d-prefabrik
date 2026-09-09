"""Document capture validation, retry integrity, and adapter body limits."""
import base64
import copy
import http.client
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "addons" / "cs_prefab_configurator"))
from services.configuration import canonical_config, canonical_quote_payload, document_config_key
from services.document_visuals import JPEG_PREFIX, MAX_IMAGE_BYTES, MAX_VISUAL_BYTES, VIEW_LABELS
from services.errors import DomainError
from services.http_api import MAX_BODY_BYTES, MAX_QUOTE_BODY_BYTES, body_limit, parse_json_body
from services.storage import SQLiteRepository, new_snapshot

# Genuine 256 x 256 RGB JPEGs. No optional imaging library is needed to run tests.
JPEG_RED = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAEAAQADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqAmGlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/9k="
)
JPEG_BLUE = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAEAAQADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAKDPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/9k="
)


def image_view(view_id="perspective-left", data=JPEG_RED):
    return {"id": view_id, "label": "User-controlled label", "width": 256, "height": 256,
            "dataUrl": JPEG_PREFIX + base64.b64encode(data).decode("ascii")}


def quote_payload(config=None):
    config = config or {}
    return {"config": config, "contact": {"firstName": "Ada", "lastName": "Tester",
            "email": "ada@example.test", "phone": "+31 6 12345678", "postcode": "1234 AB",
            "houseNumber": "12A", "address": "Voorbeeldstraat", "city": "Utrecht", "message": "Test"},
            "consent": True, "idempotencyKey": str(uuid.uuid4()),
            "visuals": {"version": 1, "configKey": document_config_key(canonical_config(config)),
                        "views": [image_view()], "missingViews": []}}


def with_metadata(data, contents):
    chunks = [contents[index:index + 60000] for index in range(0, len(contents), 60000)]
    return data[:2] + b"".join(b"\xff\xe1" + (len(chunk) + 2).to_bytes(2, "big") + chunk for chunk in chunks) + data[2:]


class DocumentVisualTests(unittest.TestCase):
    def test_visuals_bind_canonical_geometry_but_allow_contact_postcode_fill(self):
        data = quote_payload({"interior": False, "plaster": True})
        canonical, _, _ = canonical_quote_payload(data)
        self.assertFalse(canonical["config"]["plaster"])
        self.assertEqual(canonical["config"]["postcode"], "1234 AB")
        self.assertNotIn("postcode", canonical["visuals"]["configKey"])
        data["config"]["width"] = 600
        with self.assertRaises(DomainError) as error:
            canonical_quote_payload(data)
        self.assertIn("visuals", error.exception.fields)

    def test_sanitized_snapshot_fixes_order_labels_metadata_and_missing_views(self):
        data = quote_payload()
        data["visuals"]["views"] = [image_view("plan"), image_view(data=with_metadata(JPEG_RED, b"PRIVATE-EXIF"))]
        canonical, _, _ = canonical_quote_payload(data)
        visuals = canonical["visuals"]
        self.assertEqual([v["id"] for v in visuals["views"]], ["perspective-left", "plan"])
        self.assertEqual(visuals["views"][0]["label"], VIEW_LABELS["perspective-left"])
        self.assertEqual(visuals["missingViews"], ["perspective-right", "interior", "front", "side"])
        pixels = base64.b64decode(visuals["views"][0]["dataUrl"].split(",")[1])
        self.assertNotIn(b"PRIVATE-EXIF", pixels)
        self.assertNotIn(b"JFIF", pixels)
        snapshot = new_snapshot(canonical)
        canonical["visuals"]["views"].clear()
        self.assertEqual(len(snapshot["visuals"]["views"]), 2)

    def test_legacy_and_empty_capture_bundles_remain_supported(self):
        legacy = quote_payload()
        legacy.pop("visuals")
        canonical, _, _ = canonical_quote_payload(legacy)
        self.assertNotIn("visuals", new_snapshot(canonical))
        data = quote_payload()
        data["visuals"]["views"] = []
        canonical, _, _ = canonical_quote_payload(data)
        self.assertEqual(canonical["visuals"]["missingViews"], list(VIEW_LABELS))

    def test_external_urls_svg_png_and_malformed_or_truncated_jpeg_are_rejected(self):
        invalid = ["https://example.test/image.jpg", "data:image/svg+xml;base64,PHN2Zz4=",
                   "data:image/png;base64,aGVsbG8=", JPEG_PREFIX + "???", JPEG_PREFIX + "é",
                   JPEG_PREFIX + base64.b64encode(JPEG_RED[:-20]).decode(),
                   JPEG_PREFIX + base64.b64encode(JPEG_RED + b"<script/>").decode(),
                   JPEG_PREFIX + base64.b64encode(b"\xff\xd8\xff\xd9").decode()]
        for encoded in invalid:
            data = quote_payload()
            data["visuals"]["views"][0]["dataUrl"] = encoded
            with self.subTest(encoded=encoded[:45]), self.assertRaises(DomainError):
                canonical_quote_payload(data)

    def test_dimension_pixel_payload_and_id_limits(self):
        variants = [{"width": 257}, {"width": True}, {"height": 0}, {"height": 2001},
                    {"width": 2000, "height": 2000}, {"id": "outside"}, {"id": []},
                    {"dataUrl": JPEG_PREFIX + base64.b64encode(b"x" * (MAX_IMAGE_BYTES + 1)).decode()}]
        for change in variants:
            data = quote_payload()
            data["visuals"]["views"][0].update(change)
            with self.subTest(fields=list(change)), self.assertRaises(DomainError):
                canonical_quote_payload(data)
        data = quote_payload()
        data["visuals"]["views"] *= 2
        with self.assertRaises(DomainError):
            canonical_quote_payload(data)
        data = quote_payload()
        bulky = with_metadata(JPEG_RED, b"x" * (MAX_VISUAL_BYTES // 6 + 1))
        self.assertLess(len(bulky), MAX_IMAGE_BYTES)
        data["visuals"]["views"] = [image_view(view_id, bulky) for view_id in VIEW_LABELS]
        with self.assertRaises(DomainError):
            canonical_quote_payload(data)

    def test_capture_bytes_do_not_change_quote_identity_or_commercial_price(self):
        first = quote_payload()
        second = copy.deepcopy(first)
        second["visuals"]["views"][0] = image_view(data=JPEG_BLUE)
        canonical_a, _, hash_a = canonical_quote_payload(first)
        canonical_b, _, hash_b = canonical_quote_payload(second)
        self.assertEqual(hash_a, hash_b)
        self.assertEqual(new_snapshot(canonical_a)["price"], new_snapshot(canonical_b)["price"])
        self.assertNotEqual(canonical_a["visuals"], canonical_b["visuals"])
        with tempfile.TemporaryDirectory() as directory:
            repo = SQLiteRepository(Path(directory) / "db.sqlite3")
            original = repo.create_quote(first)
            with patch("services.storage.new_snapshot", side_effect=AssertionError("Retry must preserve capture")):
                repeated = repo.create_quote(second)
            self.assertEqual(original, repeated)
            self.assertEqual(repo.get_quote(original["token"])["snapshot"]["visuals"], canonical_a["visuals"])
            shared = repo.get_share(repo.create_share(first["config"])["token"])
            self.assertEqual(set(shared), {"config"})
            second["contact"]["email"] = "different@example.test"
            with self.assertRaises(DomainError) as error:
                repo.create_quote(second)
            self.assertEqual(error.exception.status, 409)

    def test_quote_json_keeps_unicode_duplicate_and_nesting_validation(self):
        for raw in (b'{"x":"\\ud800"}', b'{"x":1,"x":2}', b'{"x":' + b'[' * 15 + b']' * 15 + b'}'):
            with self.assertRaises(DomainError):
                parse_json_body(raw, max_bytes=MAX_QUOTE_BODY_BYTES)
        for path in ("/prefab/api/price", "/prefab/api/share", "/prefab/api/quote/", "/prefab/api/quote/anything"):
            self.assertEqual(body_limit(path), MAX_BODY_BYTES)
        self.assertEqual(body_limit("/prefab/api/quote"), MAX_QUOTE_BODY_BYTES)


class CaptureHttpTests(unittest.TestCase):
    def test_large_capture_quote_allowed_while_price_and_share_stay_small(self):
        spec = importlib.util.spec_from_file_location("prefab_visual_server", ROOT / "scripts" / "serve.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            server = module.create_server(port=0, database=Path(directory) / "http.sqlite3")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            data = quote_payload()
            data["visuals"]["views"][0] = image_view(data=with_metadata(JPEG_RED, b"x" * 40000))
            body = json.dumps(data).encode()
            self.assertGreater(len(body), MAX_BODY_BYTES)
            try:
                for route, expected in (("quote", 201), ("price", 413), ("share", 413)):
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                    connection.request("POST", "/prefab/api/" + route, body=body,
                                       headers={"Origin": f"http://127.0.0.1:{server.server_port}", "Content-Type": "application/json"})
                    response = connection.getresponse()
                    response_body = response.read()
                    self.assertEqual(response.status, expected, response_body[:200])
                    connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()

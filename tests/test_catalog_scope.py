"""Commercial scope, publication integrity, legacy retry and placement regressions."""
import copy
import json
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons" / "cs_prefab_configurator"))
from services.catalog import DATA_DIR, default_release, make_release, public_catalog, release_context, validate_release
from services.configuration import canonical_config, canonical_json, canonical_quote_payload
from services.documents import choice_rows, quote_html
from services.errors import DomainError
from services.http_api import dispatch
from services.pricing import price_config
from services.storage import SQLiteRepository, new_snapshot
from test_backend import payload


class ScopeTests(unittest.TestCase):
    def test_preparation_is_billed_while_device_mounting_and_connection_are_excluded(self):
        result = price_config({"interior": True, "heating": "both", "outsideTap": "left", "underfloorHeating": True})
        for key in ("heating", "outsideTap", "underfloorHeating"):
            scope = next(item for item in result["scope"] if item["key"] == key)
            components = {c["role"]: c for c in scope["components"]}
            self.assertGreater(components["preparation"]["total"], 0)
            self.assertEqual(components["preparation"]["status"], "extra")
            self.assertFalse(scope["productIncluded"])
            self.assertEqual(scope["visualMode"], "preparation" if key == "underfloorHeating" else "representative")
            for role in ("product", "installation", "connection"):
                self.assertEqual(components[role]["status"], "excluded")
                self.assertEqual(components[role]["total"], 0)

    def test_included_at_zero_and_paid_products_are_resolved_by_server_policy(self):
        release = default_release()
        heating = release["policies"]["heating"]
        next(c for c in heating["components"] if c["role"] == "product").update(status="included", unitPrice=999999)
        next(c for c in heating["components"] if c["role"] == "connection").update(status="extra", unitPrice=12345)
        heating["choices"] = {"right": copy.deepcopy(heating)}
        next(c for c in heating["choices"]["right"]["components"] if c["role"] == "product").update(status="extra", unitPrice=67890)
        validate_release(release)
        with release_context(release):
            left = price_config({"interior": True, "heating": "left"})
            right = price_config({"interior": True, "heating": "right"})
            request = payload()
            request["config"] = left["config"]
            canonical, _, _ = canonical_quote_payload(request)
            snapshot = new_snapshot(canonical)
        scope = next(item for item in left["scope"] if item["key"] == "heating")
        product = next(c for c in scope["components"] if c["role"] == "product")
        self.assertEqual(product["status"], "included")
        self.assertEqual(product["total"], 0)
        self.assertTrue(scope["productIncluded"])
        self.assertEqual(scope["visualMode"], "product")
        self.assertEqual(right["subtotal"] - left["subtotal"], 67890)
        self.assertIn(b"Product: inbegrepen in casco", quote_html({"reference": "SCOPE-TEST", "snapshot": snapshot, "contact": canonical["contact"]}))
        heating["components"][0]["status"] = "excluded"
        self.assertEqual(next(i for i in snapshot["scope"] if i["key"] == "heating")["components"][0]["status"], "extra")

    def test_preparation_display_remains_independent_of_product_inclusion(self):
        release = default_release()
        release["policies"]["heating"]["visualMode"] = "preparation"
        next(c for c in release["policies"]["heating"]["components"] if c["role"] == "product")["status"] = "included"
        with release_context(release):
            item = next(i for i in price_config({"interior": True, "heating": "left"})["scope"] if i["key"] == "heating")
        self.assertTrue(item["productIncluded"])
        self.assertEqual(item["visualMode"], "preparation")

    def test_excluded_preparation_never_promises_installed_points(self):
        release = default_release()
        for key in ("heating", "ceilingLights", "underfloorHeating"):
            next(c for c in release["policies"][key]["components"] if c["role"] == "preparation")["status"] = "excluded"
        with release_context(release):
            warnings = price_config({"interior": True, "heating": "left", "ceilingLights": 1, "underfloorHeating": True})["warnings"]
        text = " ".join(warnings)
        self.assertNotIn("worden als loze leiding aangelegd", text)
        self.assertNotIn("de stroompunten worden voorbereid", text)
        self.assertIn("voorbereiding van stroompunten is niet inbegrepen", text)
        self.assertIn("voorbereiding van de vloer niet inbegrepen", text)

    def test_retired_rollaag_toggle_is_ignored_and_every_finish_is_priced_and_labelled(self):
        # Since 2.8.1 the finish above the frame is a plain three-way choice; the old toggle key is dropped like the client does.
        for finish in ("masonry", "panel-white", "panel-black"):
            with self.subTest(finish=finish):
                result = price_config({"facade": "wood-horizontal", "rollaag": finish})
                self.assertEqual(result["config"]["rollaag"], finish)
                self.assertIn("rollaag", {i["key"] for i in result["scope"]})
                self.assertIn("rollaag", {i["key"] for i in result["labels"]})
        legacy = price_config({"rollaag": "panel-black", "rollaagEnabled": False})
        self.assertNotIn("rollaagEnabled", legacy["config"])
        self.assertEqual(legacy["total"], price_config({"rollaag": "panel-black"})["total"])
        with self.assertRaises(DomainError):
            price_config({"rollaag": "panel-black", "rollaagColour": "black"})

    def test_catalogue_published_before_2_8_1_loses_the_retired_toggle_when_loaded(self):
        # Shape taken from the live publication odoo-1-1-12 (2026-09-16): default, boolean field and the finish's visibleWhen.
        legacy = default_release()
        catalog = legacy["catalog"]
        catalog["defaults"]["rollaagEnabled"] = True
        group = next(g for g in catalog["groups"] if any(f["key"] == "rollaag" for f in g["fields"]))
        index = next(i for i, f in enumerate(group["fields"]) if f["key"] == "rollaag")
        group["fields"].insert(index, {"key": "rollaagEnabled", "label": "Rollaag", "description": "", "type": "boolean",
                                       "options": [{"id": True, "label": "Ja"}, {"id": False, "label": "Nee"}]})
        group["fields"][index + 1]["visibleWhen"] = {"field": "rollaagEnabled", "equals": True}
        legacy["policies"]["rollaagEnabled"] = {"visualMode": "none", "modelFidelity": "representative", "assetKey": "rollaagEnabled", "components": []}
        legacy["revision"] = "odoo-1-1-12-legacy"
        with release_context(legacy):
            public = public_catalog()
            self.assertEqual(public["catalogRevision"], "odoo-1-1-12-legacy", "the stored revision is kept")
            self.assertNotIn("rollaagEnabled", public["defaults"])
            fields = {f["key"]: f for g in public["groups"] for f in g["fields"]}
            self.assertNotIn("rollaagEnabled", fields)
            self.assertNotIn("visibleWhen", fields["rollaag"])
            self.assertNotIn("rollaagEnabled", public["scopePolicies"])
            self.assertEqual(sorted(public["defaults"]), sorted(default_release()["catalog"]["defaults"]))
            # A browser holding the old catalogue still sends the toggle with its document images.
            result = price_config({"rollaag": "panel-black", "rollaagEnabled": False})
            self.assertNotIn("rollaagEnabled", result["config"])
            self.assertEqual(result["catalogRevision"], "odoo-1-1-12-legacy")
        self.assertIn("rollaagEnabled", legacy["catalog"]["defaults"], "the caller's bundle is not mutated")

    def test_every_socket_position_is_priced_and_zero_cost_body_choices_are_included(self):
        result = price_config({"interior": True, "socketPositions": ["L1", "L2", "L3", "R1", "R2", "R3"]})
        sockets = next(i for i in result["scope"] if i["key"] == "sockets")
        self.assertEqual(sockets["quantity"], 6)
        self.assertEqual(sockets["components"][0]["total"], 90000)
        material = next(i for i in result["scope"] if i["key"] == "openingMaterial")
        self.assertEqual(material["components"][0]["status"], "included")
        self.assertEqual(material["components"][0]["total"], 0)

    def test_publish_rejects_missing_prices_components_and_unsupported_schema(self):
        validate_release(default_release())
        mutations = [
            lambda r: r["policies"].pop("heating"),
            lambda r: r["policies"]["heating"]["components"].pop(),
            lambda r: r["policies"]["heating"]["components"][0]["prices"].pop("both"),
            lambda r: r["policies"]["heating"]["components"][0].update(unitPrice=-1),
            lambda r: r["catalog"]["defaults"].update(arbitraryFeature=True),
            lambda r: r["catalog"]["dimensions"]["width"].update(max=1000),
            lambda r: r["pricebook"].update(priceMode="commercial"),
            lambda r: r["policies"]["heating"].update(assetKey="unverified-branded-radiator"),
            lambda r: r["catalog"].update(assetRevision="unsupported"),
        ]
        for mutate in mutations:
            release = default_release()
            mutate(release)
            with self.subTest(mutation=mutate), self.assertRaises(DomainError):
                validate_release(release)


class PlacementTests(unittest.TestCase):
    def test_position_validation_and_legacy_counts(self):
        config = canonical_config({"interior": True, "ceilingLights": 2, "spotlights": 3, "sockets": "both"})
        self.assertEqual(config["ceilingPositions"], ["left", "center"])
        self.assertEqual(config["spotPositions"], ["r1c1", "r1c2", "r1c3"])
        self.assertEqual(config["socketPositions"], ["L1", "R1"])
        self.assertEqual(canonical_config({"interior": True, "spotlights": 12, "spotPositions": []})["spotlights"], 0)
        for value in ("L1", ["L1", "L1"], ["L9"], [True], [["L1"]]):
            with self.subTest(value=value), self.assertRaises(DomainError):
                canonical_config({"socketPositions": value})

    def test_roof_radiator_and_branch_constraints_are_canonicalized(self):
        result = canonical_config({"interior": True, "rooflight": "gable-10", "heating": "both",
            "ceilingPositions": ["left", "center", "right"], "spotPositions": ["r2c2", "r2c3", "r2c4", "r1c1"],
            "socketPositions": ["L3", "R2", "R3"],
            "roofShade": True, "painting": True, "overhangSpots": 6})
        self.assertEqual(result["ceilingPositions"], ["left", "center", "right"])
        layout = price_config(result)["fixtureLayout"]
        # The front ceiling strip accommodates the pendants beyond the roof opening.
        self.assertEqual(len({layout["ceilingPositions"][key][2] for key in result["ceilingPositions"]}), 1)
        for key in result["ceilingPositions"]:
            _, _, z = layout["ceilingPositions"][key]
            self.assertGreaterEqual(z - 15, layout["roofBounds"][3] + 5)
            self.assertLessEqual(z + 15, result["depth"] / 2 - 22 - 8)
        self.assertEqual(result["spotPositions"], [])
        # The sockets at 35 cm clash with the radiator on the same slot and are removed. (Wall lighting used to be
        # checked here too; it is not part of the product any more — services/catalog.py RETIRED_FIELDS.)
        self.assertNotIn("wallLights", result, "wall lighting is retired, not merely empty")
        self.assertEqual(result["socketPositions"], ["R2"])
        self.assertNotIn("roofShade", result, "zonwering is retired too")
        self.assertFalse(result["painting"])
        self.assertEqual(result["overhangSpots"], 0)
        self.assertEqual(canonical_config(dict(result, interior=False))["socketPositions"], [])

    def test_physical_roof_clearance_removes_spots_beyond_source_static_slots(self):
        # At shallow depth, even the back-row center lies inside the roof opening.
        result = canonical_config({"interior": True, "depth": 200, "rooflight": "lean-3", "spotPositions": ["r1c3", "r3c3", "r1c1"]})
        self.assertNotIn("r1c3", result["spotPositions"])
        self.assertIn("r1c1", result["spotPositions"])

    def test_opening_width_and_legacy_material_meaning_are_preserved(self):
        with self.assertRaises(DomainError) as caught:
            canonical_config({"width": 150, "frontOpening": "sliding-4-black"})
        self.assertIn("width", caught.exception.fields)
        config = canonical_config({"frontOpening": "sliding-2-black"})
        self.assertEqual(config["frontOpening"], "sliding-2-black")
        self.assertEqual(config["openingMaterial"], "unspecified")


class ReleasePersistenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repository = SQLiteRepository(Path(self.directory.name) / "scope.sqlite")

    def tearDown(self):
        self.directory.cleanup()

    def test_connection_context_closes_on_success_and_exception(self):
        for fail in (False, True):
            connection = self.repository.connect()
            try:
                with connection:
                    connection.execute("SELECT 1")
                    if fail:
                        raise ValueError("rollback")
            except ValueError:
                pass
            with self.assertRaises(sqlite3.ProgrammingError):
                connection.execute("SELECT 1")

    def test_revision_is_pinned_and_stale_new_submissions_are_rejected(self):
        release = default_release()
        with release_context(release):
            catalog = public_catalog()
            for endpoint in ("price", "share", "quote"):
                data = payload() if endpoint == "quote" else {"config": {}}
                data["catalogRevision"] = "retired"
                with self.subTest(endpoint=endpoint), self.assertRaises(DomainError) as caught:
                    dispatch(self.repository, "POST", "/prefab/api/" + endpoint, data)
                self.assertEqual((caught.exception.status, caught.exception.code), (409, "catalog_changed"))
            data = payload()
            data["catalogRevision"] = catalog["catalogRevision"]
            result = self.repository.create_quote(data)
            self.assertEqual(result["price"]["catalogRevision"], catalog["catalogRevision"])
        release["pricebook"]["basePerM2"] += 100000
        changed = make_release(release["catalog"], release["pricebook"], release["policies"])
        with release_context(changed):
            self.assertGreater(price_config({})["total"], result["price"]["total"])
            self.assertEqual(self.repository.create_quote(data), result)
        saved = self.repository.get_quote(result["token"])["snapshot"]
        self.assertEqual(saved["catalogRevision"], catalog["catalogRevision"])
        self.assertEqual(saved["scope"], result["price"]["scope"])

    def test_legacy_snapshot_retry_is_not_reinterpreted_by_new_schema(self):
        data = payload()
        data["config"] = {"width": 150, "frontOpening": "sliding-2-black", "interior": True, "heating": "left"}
        legacy_catalog = json.loads((DATA_DIR / "catalog.legacy-v1.json").read_text(encoding="utf-8"))
        release = default_release()
        with release_context(make_release(legacy_catalog, release["pricebook"], {})):
            canonical, key, payload_hash = canonical_quote_payload(data)
        token = secrets.token_urlsafe(32)
        snapshot = {"config": canonical["config"], "labels": [{"key": "heating", "label": "Heating old", "value": "Links"}],
                    "price": {"total": 1234}, "createdAt": "2025-01-01T00:00:00+00:00"}
        with self.repository.connect() as db:
            db.execute("INSERT INTO quotes (scope,idempotency_key,payload_hash,token,reference,snapshot_json,contact_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)",
                       (self.repository.scope, key, payload_hash, token, "LEGACY-1", canonical_json(snapshot), canonical_json(canonical["contact"]), snapshot["createdAt"], time.time() + 3600))
        retry = self.repository.create_quote(data)
        self.assertEqual((retry["token"], retry["price"]["total"]), (token, 1234))
        frozen = self.repository.get_quote(token)["snapshot"]
        self.assertNotIn("openingMaterial", frozen["config"])
        self.assertNotIn("snapshotVersion", frozen)
        self.assertTrue(any(label == "Radiator" for _, rows in choice_rows(frozen) for label, _ in rows))

    def test_client_cannot_supply_scope_or_price(self):
        for key, value in (("scope", []), ("price", {"total": 0}), ("modelFidelity", "verified")):
            data = payload()
            data[key] = value
            with self.subTest(key=key), self.assertRaises(DomainError):
                self.repository.create_quote(data)


if __name__ == "__main__":
    unittest.main()

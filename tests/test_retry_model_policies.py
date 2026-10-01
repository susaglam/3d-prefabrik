"""Immutable quote retries keep the model rules that originally normalized them."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons" / "cs_prefab_configurator"))
from services.catalog import default_release, release_context
from services.errors import DomainError
from services.storage import SQLiteRepository, new_snapshot


def payload(config):
    return {"config": config, "contact": {
        "firstName": "Ada", "lastName": "Tester", "email": "ada@example.test",
        "phone": "+31 6 12345678", "postcode": "1234 AB", "houseNumber": "12A",
        "address": "Voorbeeldstraat", "city": "Utrecht", "message": ""},
        "consent": True, "idempotencyKey": str(uuid.uuid4())}


def historical_snapshot(canonical):
    snapshot = new_snapshot(canonical)
    snapshot.pop("modelPolicies")
    return snapshot


class ModelPolicyRetryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = SQLiteRepository(Path(self.directory.name) / "retry.sqlite3")

    def assert_retry_unchanged(self, request, original):
        saved = self.repo.get_quote(original["token"])
        self.assertEqual(self.repo.create_quote(copy.deepcopy(request)), original)
        self.assertEqual(self.repo.get_quote(original["token"]), saved)

    def assert_conflict(self, request):
        with self.assertRaises(DomainError) as caught:
            self.repo.create_quote(request)
        self.assertEqual(caught.exception.code, "idempotency_conflict")

    def test_historical_selected_panel_keeps_l3_electrics_and_snapshot(self):
        for revision in ("2026-09-13.1", "2026-09-13.2", "2026-09-13.3", "2026-09-13.4"):
            with self.subTest(revision=revision):
                release = default_release()
                release["catalog"]["assetRevision"] = revision
                release["policies"]["heating"]["assetKey"] = "heating-panel"
                request = payload({"interior": True, "heating": "left", "socketPositions": ["L3"], "wallLights": ["L3"]})
                with release_context(release), patch("services.storage.new_snapshot", historical_snapshot):
                    original = self.repo.create_quote(request)
                self.assertEqual(original["price"]["config"]["socketPositions"], ["L3"])
                self.assertEqual(original["price"]["config"]["wallLights"], ["L3"])
                self.assertNotIn("modelPolicies", self.repo.get_quote(original["token"])["snapshot"])
                self.assert_retry_unchanged(request, original)
                changed = copy.deepcopy(request)
                changed["config"]["socketPositions"] = []
                self.assert_conflict(changed)

    def test_new_snapshot_freezes_all_model_choices_across_admin_changes(self):
        release = default_release()
        release["policies"]["heating"]["assetKey"] = "heating-panel"
        release["policies"]["heating"]["choices"] = {
            "right": dict(copy.deepcopy(release["policies"]["heating"]), assetKey="heating")}
        release["policies"]["ceilingLights"]["assetKey"] = "ceiling-dome"
        request = payload({"interior": True, "heating": "left", "socketPositions": ["L3"], "wallLights": ["L3"]})
        with release_context(release):
            original = self.repo.create_quote(request)
        frozen = self.repo.get_quote(original["token"])["snapshot"]
        self.assertEqual(frozen["modelPolicies"]["heating"], {
            "assetKey": "heating-panel", "choices": {"right": {"assetKey": "heating"}}})
        self.assertEqual(frozen["modelPolicies"]["ceilingLights"]["assetKey"], "ceiling-dome")
        self.assertNotIn("components", frozen["modelPolicies"]["heating"])
        self.assertEqual(frozen["price"]["fixtureLayout"]["version"], 2)
        changed_release = default_release()
        changed_release["pricebook"]["basePerM2"] += 10000
        with release_context(changed_release):
            self.assert_retry_unchanged(request, original)
            for field, value in (("heating", "right"), ("width", 501), ("wallLights", [])):
                changed = copy.deepcopy(request)
                changed["config"][field] = value
                self.assert_conflict(changed)
            changed = copy.deepcopy(request)
            changed["contact"]["email"] = "another@example.test"
            self.assert_conflict(changed)

    def test_new_snapshot_retains_policy_for_a_fit_cleared_choice(self):
        release = default_release()
        release["policies"]["heating"]["choices"] = {
            "left": dict(copy.deepcopy(release["policies"]["heating"]), assetKey="heating-panel")}
        request = payload({"interior": True, "depth": 230, "heating": "left", "socketPositions": ["L3"]})
        with release_context(release):
            original = self.repo.create_quote(request)
        self.assertEqual(original["price"]["config"]["heating"], "none")
        self.assertNotIn("heating", {item["key"] for item in original["price"]["scope"]})
        self.assert_retry_unchanged(request, original)

    def test_historical_fit_cleared_choice_uses_only_unique_saved_availability(self):
        release = default_release()
        release["catalog"]["assetRevision"] = "2026-09-13.3"
        release["policies"]["heating"]["choices"] = {
            "left": dict(copy.deepcopy(release["policies"]["heating"]), assetKey="heating-panel")}
        request = payload({"interior": True, "depth": 230, "heating": "left", "socketPositions": ["L3"]})
        with release_context(release), patch("services.storage.new_snapshot", historical_snapshot):
            original = self.repo.create_quote(request)
        self.assertEqual(original["price"]["config"]["heating"], "none")
        self.assertNotIn("left", original["price"]["allowedPositions"]["heating"])
        self.assertIn("right", original["price"]["allowedPositions"]["heating"])
        self.assert_retry_unchanged(request, original)
        changed = copy.deepcopy(request)
        changed["config"]["heating"] = "right"
        self.assert_conflict(changed)

    def test_historical_absent_policy_cannot_hide_a_new_valid_radiator(self):
        release = default_release()
        release["catalog"]["assetRevision"] = "2026-09-13.3"
        request = payload({"interior": True, "depth": 230, "heating": "none"})
        with release_context(release), patch("services.storage.new_snapshot", historical_snapshot):
            original = self.repo.create_quote(request)
        self.assertIn("left", original["price"]["allowedPositions"]["heating"])
        self.assert_retry_unchanged(request, original)
        changed = copy.deepcopy(request)
        changed["config"]["heating"] = "left"
        self.assert_conflict(changed)

    def test_missing_historical_availability_does_not_guess_a_panel_to_match(self):
        def without_evidence(canonical):
            snapshot = historical_snapshot(canonical)
            snapshot["price"].pop("allowedPositions")
            return snapshot
        release = default_release()
        release["catalog"]["assetRevision"] = "2026-09-13.3"
        release["policies"]["heating"]["assetKey"] = "heating-panel"
        request = payload({"interior": True, "depth": 230, "heating": "left"})
        with release_context(release), patch("services.storage.new_snapshot", without_evidence):
            original = self.repo.create_quote(request)
        self.assertEqual(original["price"]["config"]["heating"], "none")
        saved = self.repo.get_quote(original["token"])
        self.assert_conflict(request)
        self.assertEqual(self.repo.get_quote(original["token"]), saved)


if __name__ == "__main__":
    unittest.main()

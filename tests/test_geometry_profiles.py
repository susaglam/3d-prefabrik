"""Numeric profile safety, actual mounting envelopes and approved-content invariants."""
import copy
import math
import sys
from pathlib import Path
import tempfile
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons" / "cs_prefab_configurator"))
from services.catalog import default_release, make_release, release_context, validate_release
from services.configuration import canonical_config
from services.errors import DomainError
from services.pricing import price_config
from services.geometry_rules import fixture_layout, mounting_state, default_geometry_rules, opening_aperture_cm, opening_spec
from services.storage import SQLiteRepository


class GeometryProfileTests(unittest.TestCase):
    def test_roof_opening_removes_ceiling_mount_and_reports_clearance_reason(self):
        result = price_config({"interior": True, "depth": 200, "rooflight": "lean-1", "ceilingPositions": ["left", "center", "right"], "spotPositions": ["r2c3"]})
        self.assertEqual(result["config"]["ceilingPositions"], ["left", "right"])
        self.assertNotIn("center", result["allowedPositions"]["ceilingPositions"])
        self.assertEqual({(r["field"], r["position"]) for r in result["clearedSelections"]}, {("ceilingPositions", "center"), ("spotPositions", "r2c3")})
        self.assertTrue(all(r["message"] in result["warnings"] for r in result["clearedSelections"]))

    def test_ceiling_fixture_takes_precedence_over_nearby_spot(self):
        # At depth 200 cm the front-center spot lies close to the central pendant.
        result = price_config({"interior": True, "depth": 200, "ceilingPositions": ["center"], "spotPositions": ["r3c3", "r1c1"]})
        self.assertEqual(result["config"]["spotPositions"], ["r1c1"])
        self.assertTrue(any(i["code"] == "ceiling_fixture" and i["position"] == "r3c3" for i in result["clearedSelections"]))

    def test_short_wall_cannot_promise_a_radiator(self):
        result = price_config({"interior": True, "depth": 100, "heating": "left", "socketPositions": ["L1", "L2", "L3"]})
        self.assertEqual(result["config"]["heating"], "none")
        self.assertEqual(result["allowedPositions"]["heating"], ["none"])
        self.assertNotIn("heating", {i["key"] for i in result["scope"]})
        self.assertTrue(any(i["field"] == "heating" for i in result["clearedSelections"]))

    def test_asset_envelope_changes_wall_clearance_without_claiming_product_supply(self):
        release = default_release()
        release["policies"]["heating"]["assetKey"] = "heating-panel"
        release["policies"]["ceilingLights"]["assetKey"] = "ceiling-dome"
        validate_release(release)
        config = {"interior": True, "heating": "left", "socketPositions": ["L3"], "wallLights": ["L3"], "ceilingPositions": ["center"]}
        vertical = price_config(config)
        self.assertEqual(vertical["config"]["socketPositions"], [])
        with release_context(release):
            panel = price_config(config)
            shallow = price_config(dict(config, depth=230))
        self.assertEqual(panel["config"]["socketPositions"], ["L3"])
        self.assertEqual(panel["config"]["wallLights"], ["L3"])
        radiator = next(i for i in panel["scope"] if i["key"] == "heating")
        self.assertEqual(radiator["assetKey"], "heating-panel")
        self.assertFalse(radiator["productIncluded"])
        self.assertEqual(shallow["config"]["heating"], "none")

    def test_specific_option_asset_policy_uses_its_own_width(self):
        release = default_release()
        panel = copy.deepcopy(release["policies"]["heating"])
        panel["assetKey"] = "heating-panel"
        release["policies"]["heating"]["choices"] = {"left": panel}
        with release_context(release):
            result = price_config({"interior": True, "depth": 230, "heating": "left"})
        self.assertEqual(result["config"]["heating"], "none")
        self.assertNotIn("left", result["allowedPositions"]["heating"])
        self.assertIn("right", result["allowedPositions"]["heating"])
        self.assertTrue(any(i["field"] == "heating" and i["position"] == "left" for i in result["clearedSelections"]))

    def test_profile_limits_are_admin_data_but_cannot_expand_unsupported_geometry(self):
        release = default_release()
        release["catalog"]["geometryRules"]["rooflightProfiles"]["lean-1"]["minWidthCm"] = 400
        validate_release(release)
        with release_context(release), self.assertRaises(DomainError) as caught:
            canonical_config({"width": 350, "rooflight": "lean-1"})
        self.assertIn("rooflight", caught.exception.fields)
        for mutate in (lambda r: r["catalog"]["geometryRules"]["rooflightProfiles"]["lean-1"].update(minWidthCm=100),
                       lambda r: r["catalog"]["geometryRules"].update(evaluate="os.system('x')"),
                       lambda r: r["catalog"]["geometryRules"]["clearanceCm"].update(roof=0),
                       lambda r: r["policies"]["heating"].update(assetKey="ceiling-dome")):
            invalid = default_release()
            mutate(invalid)
            with self.assertRaises(DomainError):
                validate_release(invalid)

    def test_legacy_catalog_without_profile_retains_original_normalization(self):
        old = default_release()
        old["catalog"].pop("geometryRules")
        with release_context(old):
            result = canonical_config({"interior": True, "rooflight": "gable-10", "ceilingPositions": ["center"]})
        self.assertEqual(result["ceilingPositions"], ["center"])
        self.assertEqual(canonical_config({"interior": True, "depth": 230, "rooflight": "gable-10", "ceilingPositions": ["center"]})["ceilingPositions"], [])

    def test_pendant_axis_uses_available_front_strip_and_never_moves_with_selections(self):
        base = {"interior": True, "rooflight": "gable-10", "ceilingPositions": ["center"]}
        one = price_config(base)
        many = price_config(dict(base, ceilingPositions=["left", "center", "right"], spotPositions=["r3c1", "r3c5"]))
        self.assertEqual(one["config"]["ceilingPositions"], ["center"])
        self.assertEqual(one["fixtureLayout"], many["fixtureLayout"])
        layout = one["fixtureLayout"]
        self.assertGreaterEqual(layout["ceilingPositions"]["center"][2] - 15, layout["roofBounds"][3] + 5)
        self.assertEqual(len({point[2] for point in layout["ceilingPositions"].values()}), 1)

    def test_narrow_room_cannot_select_three_overlapping_pendants(self):
        result = price_config({"interior": True, "width": 150, "depth": 100, "frontOpening": "none", "ceilingPositions": ["left", "center", "right"]})
        self.assertEqual(result["config"]["ceilingPositions"], ["left", "right"])
        self.assertTrue(any(i["position"] == "center" and i["code"] == "ceiling_fixture" for i in result["clearedSelections"]))
        a, b = (result["fixtureLayout"]["ceilingPositions"][key] for key in ("left", "right"))
        self.assertGreaterEqual(math.hypot(a[0] - b[0], a[2] - b[2]), 35)

    def test_all_accepted_roof_mounts_respect_holes_edges_and_selected_fixtures(self):
        slots = [f"r{r}c{c}" for r in range(1, 4) for c in range(1, 6)]
        for width, depth, roof in ((150, 100, "none"), (500, 200, "lean-1"), (500, 230, "gable-10"), (500, 300, "lean-3"), (750, 340, "gable-10")):
            with self.subTest(width=width, depth=depth, roof=roof):
                result = price_config({"interior": True, "width": width, "depth": depth, "frontOpening": "none", "rooflight": roof, "ceilingPositions": ["left", "center", "right"], "spotPositions": slots})
                accepted = []
                layout = result["fixtureLayout"]
                for field, radius in (("ceilingPositions", 15), ("spotPositions", 4.5)):
                    for position in result["config"][field]:
                        x, _, z = layout[field][position]
                        self.assertGreaterEqual(x - radius, -width / 2 + 22 + 8)
                        self.assertLessEqual(x + radius, width / 2 - 22 - 8)
                        self.assertGreaterEqual(z - radius, -depth / 2 + 8)
                        self.assertLessEqual(z + radius, depth / 2 - 22 - 8)
                        roof_bounds = layout["roofBounds"]
                        if roof_bounds:
                            self.assertTrue(x + radius + 5 <= roof_bounds[0] or x - radius - 5 >= roof_bounds[1] or z + radius + 5 <= roof_bounds[2] or z - radius - 5 >= roof_bounds[3])
                        for ax, az, ar in accepted:
                            self.assertGreaterEqual(math.hypot(x - ax, z - az) + 1e-8, radius + ar + 5)
                        accepted.append((x, z, radius))

    def test_geen_kozijn_is_a_skeleton_opening_sized_like_the_two_leaf_schuifpui(self):
        # "Geen kozijn" keeps a real rough opening so the customer can fit their own frame later: the aperture a
        # sliding-2 would get at this width, shrinking with the width below 230 cm and capped at 320 cm above 410 cm.
        # The numbers are written out here on purpose - the JS parity test compares the two implementations against
        # each other, this one pins what they must both say.
        expected = {150: 60, 200: 110, 230: 140, 300: 210, 410: 320, 500: 320, 750: 320}
        for width, aperture in expected.items():
            with self.subTest(width=width):
                spec = opening_spec("none", width)
                self.assertEqual(spec["width"], aperture)
                self.assertEqual(spec["width"], opening_spec("sliding-2", width)["width"])
                self.assertEqual(spec["panelCount"], 0)
                self.assertTrue(spec["skeleton"])
                self.assertEqual((spec["height"], spec["bottom"]), (230, 7))
                # Both piers keep the 45 cm minimum, which is what caps the aperture on a narrow extension.
                self.assertGreaterEqual((width - spec["width"]) / 2, 45)
                self.assertEqual(opening_aperture_cm("none", width), aperture)
        # A fitted kozijn is untouched by the skeleton rule.
        self.assertEqual([opening_spec(kind, 750)["width"] for kind in ("french", "sliding-2", "sliding-4", "folding")], [220, 320, 440, 440])
        self.assertEqual([opening_spec(kind, 750)["panelCount"] for kind in ("french", "sliding-2", "sliding-4", "folding")], [2, 2, 4, 4])
        self.assertFalse(any(opening_spec(kind, 750)["skeleton"] for kind in ("french", "sliding-2", "sliding-4", "folding")))
        # The fixture layout reads the same aperture: a 150 cm extension now has a 45 cm pier, not a 75 cm one.
        layout = fixture_layout(canonical_config({"width": 150, "depth": 100, "frontOpening": "none"}), default_geometry_rules())
        self.assertEqual(layout["exterior"]["right"]["surface"], "front")
        self.assertGreaterEqual(layout["exterior"]["right"]["socket"][0] - 8.4, 60 / 2 + 8)
        # The catalogue minimum for "geen kozijn" is unchanged: 150 cm still builds.
        self.assertEqual(canonical_config({"width": 150, "depth": 100, "frontOpening": "none"})["width"], 150)

    def test_front_hardware_shares_axis_and_tap_clears_socket_drain_and_opening(self):
        # Drain on both sides. A narrow pier stacks all three fittings on one front axis (tier 2) — even the
        # narrowest 45 cm pier next to a downpipe, so the garden-facing side always keeps its fittings; a wide
        # pier keeps two front axes with the tap toward the corner (tier 1).
        # "Geen kozijn" is no longer a closed wall: at 150 cm it leaves a 60 cm skeleton aperture, so the fittings
        # sit on a 45 cm pier there too, exactly like a fitted kozijn would give them.
        cases = ((150, 100, "none", 60, "stacked"), (230, 100, "french-black", 140, "stacked"),
                 (500, 300, "sliding-2-black", 320, "stacked"), (750, 340, "folding-white", 440, "front"))
        for width, depth, opening, opening_width, tier in cases:
            result = price_config({"width": width, "depth": depth, "frontOpening": opening, "drainSide": "both", "outsideLight": "both", "outsideSocket": "double-both", "outsideTap": "both"})
            for side, sign in (("left", -1), ("right", 1)):
                with self.subTest(width=width, side=side):
                    mount = result["fixtureLayout"]["exterior"][side]
                    self.assertTrue(mount["available"])
                    self.assertEqual(mount["light"][::2], mount["socket"][::2])
                    self.assertGreaterEqual(math.dist(mount["socket"], mount["tap"]), 35)
                    self.assertGreater(sign * mount["tap"][0], 0)
                    if tier == "side":
                        self.assertEqual(mount["surface"], side)
                        self.assertEqual(mount["rotation"], sign * math.pi / 2)
                        self.assertEqual([mount["socket"][1], mount["tap"][1], mount["light"][1]], [105, 65, 190])
                        self.assertGreater(mount["tap"][2], mount["socket"][2])
                        self.assertGreaterEqual(mount["socket"][2] - 8.4, -depth / 2 + 8)
                        continue
                    drain_x = sign * (width / 2 - 12)
                    self.assertEqual(mount["surface"], "front")
                    self.assertEqual(mount["rotation"], 0)
                    self.assertEqual({point[2] for point in (mount["light"], mount["socket"], mount["tap"])}, {depth / 2 + 2.5})
                    # A stack only needs to clear the 7.5 cm downpipe (8.4 + 3.75 + 3 cm); two axes keep the wider gap.
                    # The nudged stack lands exactly on the clearance, so compare with the file's usual 1e-8 slack.
                    self.assertGreaterEqual(abs(mount["socket"][0] - drain_x) + 1e-8, 15.15 if tier == "stacked" else 18.4)
                    self.assertGreaterEqual(abs(mount["tap"][0] - drain_x) + 1e-8, 15.15 if tier == "stacked" else 14.5)
                    self.assertGreaterEqual(sign * mount["socket"][0] - 8.4, opening_width / 2 + 8)
                    self.assertGreaterEqual(sign * mount["tap"][0] - 4.5, opening_width / 2 + 8)
                    self.assertLessEqual(sign * mount["tap"][0] + 4.5, width / 2 - 8)
                    if tier == "stacked":
                        self.assertEqual(mount["tap"][0], mount["socket"][0])
                        # Stacked or not, the socket sits ABOVE the tap and the tap never moves (customer report).
                        self.assertEqual([mount["socket"][1], mount["tap"][1], mount["light"][1]], [105, 65, 190])
                    else:
                        self.assertGreater(sign * mount["tap"][0], sign * mount["socket"][0])
                        self.assertEqual([mount["socket"][1], mount["tap"][1], mount["light"][1]], [105, 65, 190])

    def test_stacked_front_axis_is_preferred_over_the_side_wall_and_shifts_clear_of_the_drain(self):
        # sliding-4 on 650 cm: the corner tap (tier 1) would sit 5.5 cm from the right-hand drain, so the
        # right side stacks all three fittings on the pier axis, while the drain-free left side keeps two axes.
        result = price_config({"width": 650, "depth": 300, "frontOpening": "sliding-4-black", "drainSide": "right", "outsideLight": "both", "outsideSocket": "both", "outsideTap": "both"})
        right, left = (result["fixtureLayout"]["exterior"][side] for side in ("right", "left"))
        self.assertEqual({key: right[key] for key in ("surface", "rotation", "available")}, {"surface": "front", "rotation": 0, "available": True})
        self.assertEqual(right["light"], [272.5, 190, 152.5])
        self.assertEqual(right["socket"], [272.5, 105, 152.5])
        self.assertEqual(right["tap"], [272.5, 65, 152.5])  # the tap never moves; the socket is above it
        self.assertEqual(left["surface"], "front")
        self.assertEqual(left["socket"], [-272.5, 105, 152.5])
        self.assertEqual(left["tap"], [-307.5, 65, 152.5])
        self.assertEqual(result["config"]["outsideTap"], "both")
        # 540 cm: the pier axis itself (245) lies inside the 15.15 cm drain clearance of a stack, so the whole
        # stack moves toward the opening to exactly that clearance and still stays inside the pier strip.
        shifted = price_config({"width": 540, "depth": 300, "frontOpening": "sliding-4-black", "drainSide": "right", "outsideTap": "right"})["fixtureLayout"]["exterior"]["right"]
        self.assertEqual(shifted["surface"], "front")
        self.assertEqual(shifted["light"][0], shifted["socket"][0])
        self.assertEqual(shifted["tap"][0], shifted["socket"][0])
        self.assertAlmostEqual(shifted["socket"][0], 258 - 15.15)
        self.assertGreaterEqual(shifted["socket"][0] - 8.4, 440 / 2 + 8)
        self.assertEqual([shifted["socket"][1], shifted["tap"][1], shifted["light"][1]], [105, 65, 190])
        # The narrowest pier (45 cm at 230 cm wide) with the drain on that side still stacks on the front.
        narrow = price_config({"width": 230, "depth": 100, "frontOpening": "french-black", "drainSide": "both", "outsideTap": "both", "outsideLight": "both"})["fixtureLayout"]["exterior"]
        for side, sign in (("left", -1), ("right", 1)):
            self.assertEqual(narrow[side]["surface"], "front", side)
            self.assertAlmostEqual(sign * narrow[side]["light"][0], 103 - 15.15)
            self.assertGreaterEqual(sign * narrow[side]["light"][0] - 8.4, 140 / 2 + 8)

    def test_wide_pier_keeps_the_tap_on_its_own_front_axis_toward_the_corner(self):
        # french on 750 cm: pier 265 cm, so tier 1 holds on both sides — tap 35 cm beyond the electrical axis.
        result = price_config({"width": 750, "depth": 300, "frontOpening": "french-black", "drainSide": "right", "outsideLight": "both", "outsideSocket": "both", "outsideTap": "both"})
        for side, sign in (("left", -1), ("right", 1)):
            with self.subTest(side=side):
                mount = result["fixtureLayout"]["exterior"][side]
                self.assertEqual({key: mount[key] for key in ("surface", "rotation", "available")}, {"surface": "front", "rotation": 0, "available": True})
                self.assertEqual(mount["light"], [sign * 242.5, 190, 152.5])
                self.assertEqual(mount["socket"], [sign * 242.5, 105, 152.5])
                self.assertEqual(mount["tap"], [sign * 277.5, 65, 152.5])
                self.assertEqual(sign * (mount["tap"][0] - mount["socket"][0]), 35)

    def test_excessive_clearance_disables_unusable_exterior_and_unknown_asset_is_conservative(self):
        release = default_release()
        release["catalog"]["geometryRules"]["clearanceCm"].update(wallEdge=40, fixture=40)
        with release_context(release):
            result = price_config({"width": 230, "depth": 100, "frontOpening": "french-black", "outsideSocket": "both"})
        self.assertEqual(result["config"]["outsideSocket"], "none")
        self.assertTrue(any(i["field"] == "outsideSocket" and i["code"] == "exterior_space" for i in result["clearedSelections"]))
        config = canonical_config({"interior": True, "depth": 230, "heating": "left"})
        state = mounting_state(config, default_geometry_rules(), {"heating": "unknown-model"})
        self.assertNotIn("left", state["allowedPositions"]["heating"])

    def test_old_published_quote_retry_preserves_original_rules_price_and_snapshot(self):
        old = default_release()
        old["catalog"]["assetRevision"] = "2026-09-13.3"
        payload = {"config": {"interior": True, "rooflight": "lean-1", "ceilingPositions": ["center"]},
            "contact": {"firstName": "Ada", "lastName": "Tester", "email": "ada@example.test", "phone": "+31 6 12345678", "postcode": "1234 AB", "houseNumber": "12A", "address": "Voorbeeldstraat", "city": "Utrecht", "message": ""},
            "consent": True, "idempotencyKey": str(uuid.uuid4())}
        with tempfile.TemporaryDirectory() as directory:
            repo = SQLiteRepository(Path(directory) / "placement.sqlite3")
            with release_context(old):
                original = repo.create_quote(payload)
            self.assertEqual(original["price"]["config"]["ceilingPositions"], [])
            self.assertNotIn("fixtureLayout", original["price"])
            self.assertEqual(price_config(payload["config"])["config"]["ceilingPositions"], ["center"])
            repeated = repo.create_quote(payload)
            self.assertEqual(repeated, original)
            new_payload = copy.deepcopy(payload)
            new_payload["idempotencyKey"] = str(uuid.uuid4())
            newer = repo.create_quote(new_payload)
            self.assertEqual(newer["price"]["fixtureLayout"]["version"], 2)
            self.assertEqual(newer["price"]["config"]["ceilingPositions"], ["center"])


class CommercialContentTests(unittest.TestCase):
    def test_commercial_publication_requires_approval_of_exact_content(self):
        release = default_release()
        release["pricebook"].update(priceMode="commercial", pricebookVersion="TEST-OWN-RATES", disclaimer="Testvoorwaarden; definitieve offerte na beoordeling.")
        with self.assertRaises(DomainError):
            validate_release(release)
        validate_release(release, allow_unapproved=True)
        with release_context(release):
            self.assertIn("nog niet goedgekeurd", price_config({})["priceStatusLabel"])
        release["commercialApproval"] = {"contentRevision": make_release(release["catalog"], release["pricebook"], release["policies"])["revision"],
            "reference": "ISOLATED TEST ONLY", "approvedById": 1, "approvedAt": "2026-09-13 12:00:00"}
        validate_release(release)
        with release_context(release):
            self.assertEqual(price_config({})["priceStatusLabel"], "Prijsindicatie op goedgekeurde tarieven")
        release["policies"]["heating"]["components"][0]["prices"]["left"] += 1
        with self.assertRaises(DomainError):
            validate_release(release)


if __name__ == "__main__":
    unittest.main()

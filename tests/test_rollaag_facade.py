"""A rollaag is priced only where it exists: in a brick facade (2.18.0).

The owner, 2026-10-07, on a masonry rollaag that cost € 700 on a wooden, plastic or stucco facade: "olmadığı halde
neden fiyat eklesin". A rollaag is a course of bricks standing on end over the kozijn; on any other facade the first
rollaag choice simply means the cladding carries on above the frame, which is what the 3D has always drawn there
(preview.js draws the brick course only when the facade starts with 'brick'). So on those facades the choice costs
nothing and reads "Gevel loopt door boven het kozijn" in the summary, the price breakdown and the proposal.
"""
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "addons" / "cs_prefab_configurator"))
from services.catalog import default_release, release_context  # noqa: E402
from services.configuration import config_labels, canonical_config, masonry_rollaag_applies  # noqa: E402
from services.pricing import price_config  # noqa: E402

NON_BRICK = ("wood-horizontal", "wood-vertical", "open-vertical", "open-horizontal", "pvc-black", "pvc-green", "pvc-cream",
             "pvc-anthracite", "render")
BRICK = ("brick-red", "brick-black", "brick-white", "brick-yellow")


def priced(facade, rollaag):
    with release_context(default_release()):
        return price_config({"facade": facade, "rollaag": rollaag})


class RollaagFacadeTests(unittest.TestCase):
    def test_the_rule_names_every_brick_and_nothing_else(self):
        for facade in BRICK:
            self.assertTrue(masonry_rollaag_applies({"facade": facade, "rollaag": "masonry"}), facade)
        for facade in NON_BRICK:
            self.assertFalse(masonry_rollaag_applies({"facade": facade, "rollaag": "masonry"}), facade)
        self.assertFalse(masonry_rollaag_applies({"facade": "brick-red", "rollaag": "panel-white"}), "a panel is not a rollaag")

    def test_a_brick_facade_still_pays_for_its_rollaag(self):
        for facade in BRICK:
            with self.subTest(facade=facade):
                masonry, panel = priced(facade, "masonry"), priced(facade, "panel-white")
                self.assertIn("rollaag", [line["id"] for line in masonry["lines"]])
                self.assertGreater(masonry["subtotal"], panel["subtotal"], "the course of bricks is extra work")
                self.assertEqual(next(item for item in masonry["labels"] if item["key"] == "rollaag")["value"], "Rollaag")

    def test_any_other_facade_carries_on_above_the_frame_for_nothing(self):
        for facade in NON_BRICK:
            with self.subTest(facade=facade):
                masonry, panel = priced(facade, "masonry"), priced(facade, "panel-white")
                self.assertNotIn("rollaag", [line["id"] for line in masonry["lines"]], "no rollaag line on " + facade)
                self.assertNotIn("rollaag", [item["key"] for item in masonry["scope"]], "and nothing in the delivery scope")
                self.assertEqual(masonry["subtotal"], panel["subtotal"], "the facade carrying on costs what a white panel costs")
                self.assertEqual(next(item for item in masonry["labels"] if item["key"] == "rollaag")["value"], "Gevel loopt door boven het kozijn")

    def test_the_choice_itself_is_kept(self):
        # The configuration is not rewritten behind the visitor's back: switching back to a brick facade brings the
        # rollaag (and its price) back without asking again.
        with release_context(default_release()):
            self.assertEqual(canonical_config({"facade": "wood-vertical", "rollaag": "masonry"})["rollaag"], "masonry")
            labels = {item["key"]: item["value"] for item in config_labels(canonical_config({"facade": "brick-red", "rollaag": "masonry"}))}
        self.assertEqual(labels["rollaag"], "Rollaag")


if __name__ == "__main__":
    unittest.main()

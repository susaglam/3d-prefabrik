"""The sedum roof's scope wiring, and the licence record of the scans the live view draws it with.

Two things can break silently when the green roof is re-modelled in the browser and nobody runs the server:

1. The build-up meshes carry `userData.scopeKey = 'greenRoof'`. That string is the join between the 3D scene and the
   priced scope row (`assetKey`), which is what makes highlighting, the price line and the quote agree. Renaming it on
   one side only produces no error anywhere - the option simply stops highlighting.
2. Every scan in the live view has to stay CC0 with a provenance row. The frontend test proves the bytes match their
   manifest; this proves the same manifest from the other side, in the language that ships the addon, and adds the
   licence rule the JS test cannot state: no asset without a recorded origin and licence URL.
"""
import json
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "addons" / "cs_prefab_configurator"))
from services.catalog import get_catalog
from services.pricing import price_config

ADDON = Path(__file__).resolve().parents[1] / "addons" / "cs_prefab_configurator"
PREVIEW = ADDON / "static" / "src" / "preview.js"
MATERIALS = ADDON / "static" / "src" / "assets" / "materials"


class GreenRoofScopeTests(unittest.TestCase):
    def test_the_green_roof_is_retired_from_the_offer_and_from_the_price(self):
        """2.16.0, the customer: "geen groen dak". The option is not offered, not priced, and a design that still
        asks for one is served without it instead of being refused — services/catalog.py RETIRED_FIELDS.

        The build-up itself (preview.js makeGreenRoof, its scopeKey and its textures) is left in place, dormant: it
        costs a retired release nothing and a later customer who does want a sedum roof gets it back by name.
        """
        catalog = get_catalog()
        self.assertNotIn("greenRoof", catalog["defaults"], "no default for a choice that cannot be made")
        offered = {field["key"] for group in catalog["groups"] for field in group["fields"]}
        self.assertNotIn("greenRoof", offered)
        self.assertNotIn("roofShade", offered, "zonwering went with it")
        self.assertNotIn("wallLights", offered, "and so did wall lighting")
        result = price_config({"greenRoof": True, "roofShade": True})
        self.assertEqual([item for item in result["scope"] if item["key"] in {"greenRoof", "roofShade"}], [])
        self.assertNotIn("greenRoof", result["config"])

    def test_no_green_roof_scope_row_when_the_option_is_off(self):
        result = price_config({"greenRoof": False})
        self.assertEqual([item for item in result["scope"] if item["key"] == "greenRoof"], [])

    def test_the_build_up_is_seated_under_the_daktrim_and_inside_the_roof_edge(self):
        """The three numbers the fix rests on, read out of the source rather than trusted to a comment.

        slabTop + 12 mm is the finished sedum surface; the lowest daktrim cap in the catalogue (anthracite / white)
        tops out at slabTop + 15 mm, so the mat is 3 mm under it. The daktrim's horizontal leg reaches 75 mm inboard
        of the roof edge, so the build-up starts at 85 mm.
        """
        source = PREVIEW.read_text(encoding="utf-8")
        line = next(row for row in source.splitlines() if "flashing=" in row and "matY=" in row)
        values = dict(re.findall(r"(flashing|strip|matY|ballastY)=(?:top\+)?(\.\d+)", line))
        self.assertEqual(values["matY"], ".012")
        self.assertEqual(values["ballastY"], ".006")
        self.assertGreaterEqual(float(values["flashing"]), 0.085)
        self.assertLess(float(values["matY"]), 0.015, "the finished surface stays under the anthracite daktrim cap")
        self.assertLess(float(values["ballastY"]), float(values["matY"]), "planting stands above the ballast")


class MaterialProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.rows = json.loads((MATERIALS / "provenance.json").read_text(encoding="utf-8"))["assets"]
        self.by_file = {row["file"]: row for row in self.rows}

    def test_every_shipped_scan_is_cc0_with_a_recorded_origin(self):
        shipped = {path.name for path in MATERIALS.iterdir() if path.suffix in (".jpg", ".hdr")}
        self.assertEqual(shipped - set(self.by_file), set(), "a scan ships without a provenance row")
        for row in self.rows:
            self.assertEqual(row["license"], "CC0-1.0", row["file"])
            self.assertTrue(row["licenseUrl"].startswith("https://"), row["file"])
            self.assertTrue(row["origin"].startswith("https://"), row["file"])
            self.assertEqual((MATERIALS / row["file"]).stat().st_size, row["bytes"], row["file"])

    def test_the_green_roof_scans_are_loaded_by_the_live_view(self):
        source = PREVIEW.read_text(encoding="utf-8")
        for name in ("sedum_mat_diffuse.jpg", "sedum_mat_nor_gl.jpg", "sedum_mat_rough.jpg", "sedum_mat_ao.jpg",
                     "roof_ballast_diffuse.jpg", "roof_ballast_nor_gl.jpg"):
            self.assertIn(name, self.by_file, f"{name} has a provenance row")
            self.assertIn(name, source, f"{name} is loaded by preview.js")
        # The procedural cushion texture it replaced is gone, not merely unused.
        self.assertNotIn("sedumTexture", source)
        self.assertNotIn("sedum-cushion", source)


if __name__ == "__main__":
    unittest.main()

"""Kilometervergoeding (2.18.0): a per-kilometre charge from the vestiging to the building site.

The owner, 2026-10-07: "müşteriden veri beklemeye gerek yok, sen rakamı belirle; zaten adminden güncellenebilir olacak".
So the defaults are set here (services/travel.py TRAVEL_DEFAULTS: from Rijswijk 2288, the first 50 km included, then
€ 1,50 per kilometre there and back) and an administrator overrides them per catalogue in the catalogue editor.

Two anchors that fail differently:
  * the arithmetic, on exact numbers: distance → kilometres over the free radius → the charge;
  * the geography, against the CBS table itself: a site next door costs nothing, Groningen costs about what the
    road distance says (a hand-computed straight line × 1,25, not the code's own function).
"""
import copy
import json
import math
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "addons" / "cs_prefab_configurator"))
from services.catalog import default_release, make_release, release_context, validate_release  # noqa: E402
from services.errors import DomainError  # noqa: E402
from services.pricing import price_config  # noqa: E402
from services.sales_projection import sales_rows  # noqa: E402
from services.travel import ROAD_FACTOR, TRAVEL_DEFAULTS, pc4, road_km, travel_charge, travel_settings  # noqa: E402

TABLE = json.loads((HERE.parent / "addons" / "cs_prefab_configurator" / "data" / "pc4_centroids.json").read_text(encoding="utf-8"))["points"]


def straight_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*TABLE[a], *TABLE[b]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def half_up(value):
    return math.floor(value + .5)


def priced(**config):
    with release_context(default_release()):
        return price_config(config)


class TravelTests(unittest.TestCase):
    def test_the_table_is_the_whole_country(self):
        self.assertGreater(len(TABLE), 3900)
        for code, (lat, lon) in TABLE.items():
            self.assertRegex(code, r"^[1-9][0-9]{3}$")
            self.assertTrue(50.7 < lat < 53.6 and 3.3 < lon < 7.25, code)
        self.assertIn(TRAVEL_DEFAULTS["originPostcode"], TABLE, "the vestiging itself is in the table")

    def test_postcodes_are_read_by_their_four_digits(self):
        self.assertEqual(pc4("2288 GK"), "2288")
        self.assertEqual(pc4("2288gk"), "2288")
        self.assertEqual(pc4(" 1011AB "), "1011")
        for value in ("", None, "abcd", "0123 AB", 2288):
            self.assertIsNone(pc4(value), value)

    def test_distance_is_the_straight_line_times_the_road_factor(self):
        self.assertEqual(ROAD_FACTOR, 1.25)
        self.assertEqual(road_km("2288", "2288"), 0)
        for code in ("1011", "9711", "6211", "4331"):
            self.assertEqual(road_km("2288", code), half_up(straight_km("2288", code) * 1.25), code)
        self.assertIsNone(road_km("2288", "0000"), "an unknown area has no distance")

    def test_the_charge_counts_only_what_lies_beyond_the_free_radius_there_and_back(self):
        settings = travel_settings({})
        self.assertEqual(settings, TRAVEL_DEFAULTS)
        self.assertEqual((settings["originPostcode"], settings["freeKm"], settings["perKm"], settings["roundTrip"]), ("2288", 50, 150, True))
        near = travel_charge({"postcode": "2611 AB"}, {})  # Delft: well inside 50 km
        self.assertEqual(near["total"], 0)
        groningen = travel_charge({"postcode": "9711 LM"}, {})
        km = half_up(straight_km("2288", "9711") * 1.25)
        self.assertEqual(groningen["km"], km)
        self.assertEqual(groningen["chargedKm"], 2 * (km - 50))
        self.assertEqual(groningen["total"], 2 * (km - 50) * 150)
        self.assertIn("Rijswijk", groningen["label"])
        one_way = travel_charge({"postcode": "9711 LM"}, {"travel": dict(TRAVEL_DEFAULTS, roundTrip=False, perKm=100, freeKm=0)})
        self.assertEqual((one_way["chargedKm"], one_way["total"]), (km, km * 100))
        self.assertIsNone(travel_charge({"postcode": ""}, {}), "no postcode yet: nothing to charge")
        self.assertIsNone(travel_charge({"postcode": "9711 LM"}, {"travel": dict(TRAVEL_DEFAULTS, perKm=0)}), "switched off at 0")

    def test_the_price_carries_one_line_and_the_sale_order_receives_it(self):
        without = priced()
        self.assertNotIn("travel", [line["id"] for line in without["lines"]])
        self.assertTrue(any("kilometervergoeding" in str(w).lower() for w in without["warnings"]), "the visitor is told it follows the postcode")
        near = priced(postcode="2611 AB")
        self.assertNotIn("travel", [line["id"] for line in near["lines"]], "inside the free radius there is no line at all")
        far = priced(postcode="9711 LM")
        line = next(line for line in far["lines"] if line["id"] == "travel")
        self.assertEqual((line["quantity"], line["unit"], line["role"]), (1.0, "post", "installation"))
        self.assertEqual(far["subtotal"] - without["subtotal"], line["total"])
        self.assertIn("travel", [row["key"] for row in sales_rows({"price": far, "scope": far["scope"]})], "the native sale order gets the line")
        unknown = priced(postcode="1009 ZZ")  # a valid shape with no CBS area: priced without it, and said so
        self.assertNotIn("travel", [line["id"] for line in unknown["lines"]])
        self.assertTrue(any("1009" in str(w) for w in unknown["warnings"]))

    def test_an_administrator_sets_the_numbers_and_the_release_checks_them(self):
        release = default_release()
        book = dict(release["pricebook"], travel={"originPostcode": "3511", "originLabel": "Utrecht", "freeKm": 25, "perKm": 99, "roundTrip": False})
        custom = make_release(release["catalog"], book, release["policies"])
        validate_release(copy.deepcopy(custom))
        with release_context(custom):
            far = price_config({"postcode": "9711 LM"})
        line = next(line for line in far["lines"] if line["id"] == "travel")
        km = half_up(straight_km("3511", "9711") * 1.25)
        self.assertEqual(line["total"], (km - 25) * 99)
        self.assertIn("Utrecht", line["label"])
        for broken in ({"originPostcode": "0000"}, {"freeKm": -1}, {"perKm": 1.5}, {"roundTrip": "ja"}, {"originLabel": ""}):
            bad = make_release(release["catalog"], dict(release["pricebook"], travel=dict(TRAVEL_DEFAULTS, **broken)), release["policies"])
            with self.subTest(broken=broken), self.assertRaises(DomainError):
                validate_release(bad)

    def test_the_shipped_release_is_untouched(self):
        # The defaults live in code, not in the shipped pricebook: adding a key there would change the revision of the
        # demo release that every golden in tests/ is pinned to.
        self.assertNotIn("travel", default_release()["pricebook"])


if __name__ == "__main__":
    unittest.main()

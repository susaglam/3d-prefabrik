"""Casco price curve (2.10.4) and price reductions ('minderprijs'): the customer's price list, and nothing else moves.

Two independent anchors:
  * fixtures/legacy_pricing_golden.json, captured from the linear engine BEFORE the curve existed: a pricebook
    without baseCurve must still price byte-for-byte as it did (lines, labels, units, totals and scope);
  * fixtures/excel_base_matrix.json, the 169 cells of 'Aanbouw blanco prijslijst concept HSB 1-12-2025': the curve
    must reproduce every cell to the euro.

One deliberate change to the first anchor (2.18.0): the two designs on a pvc and a render facade lost the default
masonry rollaag line (€ 650 in the demo book) and its scope row — a rollaag exists only in a brick facade, see
test_rollaag_facade.py. Only those rows and the totals they feed moved; every other line is as captured.
"""
import copy
from decimal import Decimal
import json
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "addons" / "cs_prefab_configurator"))
from services.catalog import check_base_curve, credit_allowed, default_release, make_release, release_context, validate_release  # noqa: E402
from services.catalog_editor import euro_to_cents  # noqa: E402
from services.errors import DomainError  # noqa: E402
from services.pricing import base_curve_total, price_config  # noqa: E402
from services.sales_projection import sales_rows  # noqa: E402

# The price list's casco = 33.000 + 650 × m²^1.1860002 (whole euros). The site keeps its own setup line (3.250), so the
# curve's fixed part is 33.000 - 3.250; foundation is part of the list price, which is why the Excel release marks the
# piles as included.
EXCEL_CURVE = {"fixed": 2975000, "factor": 65000, "exponent": "1.1860002", "roundTo": 100}
EXCEL_SETUP = 325000


def curve_release(curve=EXCEL_CURVE, setup=EXCEL_SETUP):
    release = default_release()
    book = dict(release["pricebook"], baseCurve=copy.deepcopy(curve), fixedSetup=setup)
    return make_release(release["catalog"], book, release["policies"])


class LegacyPricingTests(unittest.TestCase):
    def test_pricebook_without_curve_prices_exactly_as_before(self):
        golden = json.loads((HERE / "fixtures" / "legacy_pricing_golden.json").read_text(encoding="utf-8"))
        release = default_release()
        self.assertNotIn("baseCurve", release["pricebook"], "the shipped demo pricebook stays linear")
        self.assertEqual(release["revision"], golden["revision"], "no key was injected into the shipped release")
        with release_context(release):
            for name, expected in golden["designs"].items():
                answer = price_config(dict(expected["config"]))
                with self.subTest(design=name):
                    self.assertEqual(answer["lines"], expected["lines"])
                    self.assertEqual((answer["subtotal"], answer["vat"], answer["total"]), (expected["subtotal"], expected["vat"], expected["total"]))
                    self.assertEqual([{"key": s["key"], "components": s["components"]} for s in answer["scope"]], expected["scope"])

    def test_make_release_keeps_a_curve_free_book_untouched(self):
        release = default_release()
        again = make_release(release["catalog"], copy.deepcopy(release["pricebook"]), release["policies"])
        self.assertEqual(again["pricebook"], release["pricebook"])
        self.assertEqual(again["revision"], release["revision"])


class ExcelCurveTests(unittest.TestCase):
    def test_curve_reproduces_every_cell_of_the_price_list(self):
        cells = json.loads((HERE / "fixtures" / "excel_base_matrix.json").read_text(encoding="utf-8"))["cells"]
        self.assertEqual(len(cells), 169)
        release = curve_release()
        validate_release(release)
        wrong = []
        with release_context(release):
            for cell in cells:
                answer = price_config({"width": cell["widthCm"], "depth": cell["depthCm"], "frontOpening": "none"})
                lines = {line["id"]: line for line in answer["lines"]}
                if lines["base"]["total"] + lines["setup"]["total"] != cell["eur"] * 100:
                    wrong.append((cell, lines["base"]["total"], lines["setup"]["total"]))
        self.assertEqual(wrong, [], "casco + startkosten must equal the price list in all 169 sizes")

    def test_curve_line_is_one_post_so_quantity_times_unit_price_is_the_total(self):
        with release_context(curve_release()):
            answer = price_config({})
        base = next(line for line in answer["lines"] if line["id"] == "base")
        self.assertEqual((base["quantity"], base["unit"], base["label"]), (1.0, "post", "Geïsoleerde prefab casco aanbouw"))
        self.assertEqual(base["unitPrice"], base["total"])
        self.assertEqual(base["total"], (49135 - 3250) * 100, "5 × 3 m: the price list says 49.135 including the setup line")
        self.assertIsInstance(base["total"], int)

    def test_sizes_between_the_table_rows_follow_the_curve_monotonically(self):
        curve = EXCEL_CURVE
        totals = [base_curve_total(curve, Decimal(width * 300) / 10000) for width in range(150, 751)]
        self.assertEqual(totals, sorted(totals), "a wider extension never costs less")
        self.assertTrue(all(total % 100 == 0 for total in totals), "whole euros, like the price list")

    def test_malformed_curves_are_refused_before_publication(self):
        good = dict(EXCEL_CURVE)
        check_base_curve(good)
        bad = [None, {}, dict(good, fixed=-1), dict(good, factor="650"), dict(good, roundTo=0), dict(good, exponent=1.186),
               dict(good, exponent="1,186"), dict(good, exponent="3"), dict(good, exponent="1e0"), dict(good, exponent="nan"),
               dict(good, extra=1), {k: v for k, v in good.items() if k != "roundTo"}]
        for curve in bad:
            with self.subTest(curve=curve):
                with self.assertRaises(ValueError):
                    check_base_curve(curve)
                release = default_release()
                release["pricebook"]["baseCurve"] = curve
                with self.assertRaises(DomainError):
                    validate_release(release)


class PriceReductionTests(unittest.TestCase):
    def _with_facade_credit(self, pricing="option", role=None):
        release = default_release()
        component = release["policies"]["facade"]["components"][0]
        component.update(pricing=pricing, prices=dict(component["prices"], render=-200000))
        if role:
            component["role"] = role
        return release

    def test_a_product_package_may_lower_the_price(self):
        release = self._with_facade_credit()
        validate_release(release)
        with release_context(release):
            plain = price_config({"facade": "wood-vertical"})
            render = price_config({"facade": "render"})
        line = next(line for line in render["lines"] if line["id"].startswith("facade"))
        self.assertEqual(line["total"], -200000)
        facade = next(item for item in render["scope"] if item["key"] == "facade")
        self.assertEqual(facade["components"][0]["statusLabel"], "Minderprijs")
        # this facade rule is priced per package, so wood-vertical is its demo price 2.500 ct once; buitenstuc -2.000
        self.assertEqual(render["subtotal"] - plain["subtotal"], -200000 - 2500)
        rows = sales_rows({"price": render, "scope": render["scope"]})
        credit = next(row for row in rows if row["key"] == "facade.product")
        self.assertEqual((credit["unitPrice"], credit["statusLabel"]), (-200000, "Minderprijs"))

    def test_devices_per_m2_prices_and_unit_prices_never_go_negative(self):
        mutations = [
            lambda r: r["policies"]["heating"]["components"][0]["prices"].update(left=-1),          # a device point
            lambda r: r["policies"]["underfloorHeating"]["components"][0]["prices"].update(true=-1),  # per m², device
            lambda r: r["policies"]["frontOpening"]["components"][0].update(unitPrice=-1),           # unit price
        ]
        for mutate in mutations:
            release = default_release()
            mutate(release)
            with self.subTest(mutation=mutate), self.assertRaises(DomainError):
                validate_release(release)
        with self.assertRaises(DomainError):
            validate_release(self._with_facade_credit(pricing="area"))

    def test_credit_rule_and_editor_amounts(self):
        self.assertTrue(credit_allowed("facade", "product", "option"))
        self.assertFalse(credit_allowed("facade", "product", "area"))
        self.assertFalse(credit_allowed("spotlights", "product", "option"))
        self.assertFalse(credit_allowed("facade", "preparation", "option"))
        self.assertEqual(euro_to_cents("-2000", allow_negative=True), -200000)
        self.assertEqual(euro_to_cents(-0.5, allow_negative=True), -50)
        for value in ("-2000", -0.01):
            with self.subTest(value=value), self.assertRaises(ValueError):
                euro_to_cents(value)
        with self.assertRaises(ValueError):
            euro_to_cents("-0.001", allow_negative=True)


if __name__ == "__main__":
    unittest.main()

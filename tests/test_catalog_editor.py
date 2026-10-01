"""Lossless catalogue-editing contracts, independent of Odoo's transient UI."""
import copy
from decimal import Decimal, localcontext
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "addons" / "cs_prefab_configurator"
sys.path.insert(0, str(ADDON))

from services.catalog_editor import (
    choice_label, euro_to_cents, field_index, patch_existing, patch_fields,
    same_value, value_key,
)


def typed_catalog():
    """Keep False and numeric zero distinct, as JSON does."""
    return {
        "defaults": {"flag": True, "count": 1, "text": "voorbeeld", "number": 4,
                     "positions": ["R2", "L1"]},
        "groups": [{"label": "Keuzes", "fields": [
            {"key": "flag", "type": "select", "label": "Ingeschakeld",
             "options": [{"id": False, "label": "Nee"}, {"id": True, "label": "Ja"}]},
            {"key": "count", "type": "select", "label": "Aantal",
             "options": [{"id": 0, "label": "Geen"}, {"id": 1, "label": "Een"}]},
            {"key": "text", "type": "text", "label": "Toelichting"},
            {"key": "number", "type": "number", "label": "Los getal"},
            {"key": "positions", "type": "multiselect", "label": "Posities",
             "options": [{"id": "L1", "label": "Links 1"}, {"id": "L2", "label": "Links 2"},
                         {"id": "R2", "label": "Rechts 2"}]},
        ]}],
    }


class EuroConversionTests(unittest.TestCase):
    def test_exact_nonnegative_euros_become_integer_cents(self):
        for amount, expected in ((0, 0), ("0.00", 0), ("0.01", 1), (1, 100),
                                 (19.99, 1999), (Decimal("1234.56"), 123456),
                                 ("1.2300", 123), ("21474836.47", 2147483647)):
            with self.subTest(amount=amount):
                result = euro_to_cents(amount)
                self.assertIs(type(result), int)
                self.assertEqual(result, expected)

    def test_rejects_negative_nonfinite_boolean_and_non_numeric_values(self):
        for amount in (-1, "-0.01", True, False, float("nan"), float("inf"),
                       float("-inf"), Decimal("sNaN"), "NaN", "Infinity", None,
                       "", "geen bedrag", [], {}):
            with self.subTest(amount=amount):
                with self.assertRaises(ValueError):
                    euro_to_cents(amount)

    def test_never_rounds_a_subcent_tail_or_a_binary_arithmetic_artifact(self):
        for amount in ("0.001", "10.999", Decimal("1.0001"), 0.1 + 0.2,
                       "12345678.1200000000000000000000000001",
                       "0.0100000000000000000000000000000000000001"):
            with self.subTest(amount=amount):
                with self.assertRaises(ValueError):
                    euro_to_cents(amount)

    def test_rejects_values_above_integer_storage_limit_without_decimal_overflow(self):
        for amount in ("21474836.48", "999999999999999999999999999999", "1e999999"):
            with self.subTest(amount=amount):
                with self.assertRaises(ValueError):
                    euro_to_cents(amount)

    def test_conversion_does_not_depend_on_the_callers_decimal_precision(self):
        with localcontext() as context:
            context.prec = 4
            self.assertEqual(euro_to_cents("1234.56"), 123456)
            with self.assertRaises(ValueError):
                euro_to_cents("1234.560000000000000000000001")


class FieldPatchTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads((ADDON / "data" / "catalog.json").read_text(encoding="utf-8"))

    def test_empty_edit_is_exact_roundtrip_with_metadata_and_independent_nested_objects(self):
        self.catalog["sourceReference"] = {"url": "https://reference.invalid/configuration", "raw": [False, 0, None]}
        self.catalog["groups"][0]["futureMetadata"] = {"preserveOrder": [3, 1, 2]}
        original_json = json.dumps(self.catalog, ensure_ascii=False)
        result = patch_fields(self.catalog, {})
        self.assertEqual(json.dumps(result, ensure_ascii=False), original_json)
        self.assertIsNot(result, self.catalog)
        result["sourceReference"]["raw"].append("changed copy")
        result["groups"][0]["futureMetadata"]["preserveOrder"].reverse()
        self.assertEqual(json.dumps(self.catalog, ensure_ascii=False), original_json)

    def test_label_hint_and_choice_patch_changes_only_explicit_properties(self):
        field = field_index(self.catalog)["facade"]
        field["reference"] = {"layers": [21, 44], "originalLabel": "Extern origineel"}
        choice = field["options"][0]
        choice["assetReference"] = {"material": "verified-material", "variants": ["black", "anthracite"]}
        before = copy.deepcopy(self.catalog)
        option_id = value_key(choice["id"])
        result = patch_fields(self.catalog, {"facade": {
            "label": "Nieuwe gevelnaam", "description": "Vastgelegde toelichting",
            "placeholder": "Kies een gevel", "choices": {option_id: {
                "label": "Nieuw optielabel", "description": "Nieuwe optietoelichting"}},
        }})
        expected = copy.deepcopy(before)
        edited_field = field_index(expected)["facade"]
        edited_field.update(label="Nieuwe gevelnaam", description="Vastgelegde toelichting", placeholder="Kies een gevel")
        edited_field["options"][0].update(label="Nieuw optielabel", description="Nieuwe optietoelichting")
        self.assertEqual(result, expected)
        self.assertEqual(self.catalog, before)

    def test_false_and_zero_default_options_keep_their_json_types(self):
        catalog = typed_catalog()
        result = patch_fields(catalog, {"flag": {"default": False}, "count": {"default": 0},
                                       "number": {"default": 0}, "text": {"default": ""}})
        self.assertIs(result["defaults"]["flag"], False)
        self.assertIs(type(result["defaults"]["count"]), int)
        self.assertEqual(result["defaults"]["count"], 0)
        self.assertEqual(result["defaults"]["number"], 0)
        self.assertEqual(result["defaults"]["text"], "")
        self.assertIs(catalog["defaults"]["flag"], True)
        self.assertEqual(catalog["defaults"]["count"], 1)

    def test_similar_truth_values_do_not_authorize_default_type_changes(self):
        for key, invalid in (("flag", 0), ("flag", "false"), ("count", False),
                             ("count", "0"), ("number", False), ("number", 0.0), ("text", False)):
            with self.subTest(key=key, invalid=invalid):
                with self.assertRaises(ValueError):
                    patch_fields(typed_catalog(), {key: {"default": invalid}})

    def test_multiselect_preserves_existing_order_and_copies_explicit_selection(self):
        catalog = typed_catalog()
        unchanged = patch_fields(catalog, {"positions": {"label": "Aangepaste veldnaam"}})
        self.assertEqual(unchanged["defaults"]["positions"], ["R2", "L1"])
        selected = ["L2", "L1"]
        changed = patch_fields(catalog, {"positions": {"default": selected}})
        selected.append("R2")
        self.assertEqual(changed["defaults"]["positions"], ["L2", "L1"])
        self.assertEqual(catalog["defaults"]["positions"], ["R2", "L1"])
        self.assertEqual(patch_fields(catalog, {"positions": {"default": []}})["defaults"]["positions"], [])

    def test_multiselect_rejects_unknown_duplicate_and_non_list_defaults(self):
        for selected in (["L1", "L1"], ["UNKNOWN"], [False], "L1", ("L1",)):
            with self.subTest(selected=selected):
                with self.assertRaises(ValueError):
                    patch_fields(typed_catalog(), {"positions": {"default": selected}})

    def test_unknown_keys_and_invalid_labels_fail_without_mutating_input(self):
        catalog = typed_catalog()
        before = copy.deepcopy(catalog)
        for edits in ({"unknown": {"label": "Unknown"}}, {"flag": {"key": "renamed"}},
                      {"flag": {"options": []}}, {"flag": {"label": "  "}},
                      {"flag": {"description": None}}, {"flag": {"choices": {"unknown": {"label": "New"}}}},
                      {"flag": {"choices": {"false": {"id": 0}}}},
                      {"flag": {"choices": {"false": {"label": ""}}}}):
            with self.subTest(edits=edits):
                with self.assertRaises(ValueError):
                    patch_fields(catalog, edits)
                self.assertEqual(catalog, before)

    def test_choice_identity_and_labels_distinguish_false_from_zero(self):
        catalog = typed_catalog()
        self.assertEqual(value_key(False), "false")
        self.assertEqual(value_key(0), "0")
        self.assertFalse(same_value(False, 0))
        self.assertFalse(same_value(0, 0.0))
        self.assertEqual(choice_label(catalog, "flag", "false"), "Nee")
        self.assertEqual(choice_label(catalog, "count", "0"), "Geen")
        self.assertEqual(choice_label(catalog, "missing", "original-reference"), "original-reference")


class ExistingPathPatchTests(unittest.TestCase):
    def test_noop_pricebook_preserves_untouched_metadata_and_value_types(self):
        book = json.loads((ADDON / "data" / "pricebook.demo-v1.json").read_text(encoding="utf-8"))
        book["externalReferences"] = {"source": "supplier-2026", "values": [False, 0, None, "0"]}
        before = json.dumps(book, ensure_ascii=False)
        result = patch_existing(book, [])
        self.assertEqual(json.dumps(result, ensure_ascii=False), before)
        result["externalReferences"]["values"].append("copy only")
        self.assertEqual(json.dumps(book, ensure_ascii=False), before)

    def test_nested_patch_changes_only_requested_path_and_copies_incoming_value(self):
        document = {"groups": [{"label": "Origineel", "reference": {"layer": 4}}],
                    "optionPrices": {"heating": {"none": 0, "left": 20000}},
                    "metadata": {"keep": [1, False]}}
        incoming = {"preserved": ["source", 0]}
        original = copy.deepcopy(document)
        result = patch_existing(document, [(["groups", 0, "label"], "Nieuwe sectie"),
                                           (["optionPrices", "heating", "left"], 0),
                                           (["groups", 0, "reference"], incoming)])
        self.assertEqual(result["groups"][0]["label"], "Nieuwe sectie")
        self.assertEqual(result["optionPrices"]["heating"], {"none": 0, "left": 0})
        self.assertEqual(result["metadata"], original["metadata"])
        incoming["preserved"].append("external mutation")
        self.assertEqual(result["groups"][0]["reference"]["preserved"], ["source", 0])
        result["metadata"]["keep"].append("output mutation")
        self.assertEqual(document, original)

    def test_rejects_root_replacement_and_missing_leaf_without_mutating_source(self):
        document = {"existing": {"value": 3}}
        before = copy.deepcopy(document)
        for patches in [([], "replacement"), (["existing", "new"], 1)]:
            with self.subTest(path=patches[0]):
                with self.assertRaises(ValueError):
                    patch_existing(document, [(["existing", "value"], 4), patches])
                self.assertEqual(document, before)


if __name__ == "__main__":
    unittest.main()

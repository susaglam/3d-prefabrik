"""Exercise the native editor against Odoo ORM/view behavior on the exact target."""
import copy
import json

from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import Form, TransactionCase, tagged

from ..services.catalog import release_context
from ..services.pricing import price_config


@tagged("post_install", "-at_install")
class TestCatalogEditor(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.website = cls.env["website"].search([("company_id", "=", cls.env.company.id)], limit=1)
        if not cls.website:
            cls.website = cls.env["website"].create({"name": "Editor test", "company_id": cls.env.company.id})

    def draft(self):
        return self.env["cs.prefab.catalog.release"].create({"name": "Native editor test", "website_id": self.website.id})

    def editor(self, release):
        return self.env["cs.prefab.catalog.editor"].browse(release.action_open_editor()["res_id"])

    def test_native_form_and_noop_preserve_all_source_content(self):
        draft = self.draft()
        catalog = copy.deepcopy(draft.catalog_json)
        book = copy.deepcopy(draft.pricebook_json)
        catalog["reference"]["supplierMemo"] = {"version": "source-only", "approved": False}
        catalog["groups"][0]["fields"][0]["options"][0]["customReference"] = [0, False, "keep"]
        catalog["groups"][0]["fields"][0]["options"][0]["description"] = None
        catalog["geometryRules"]["clearanceCm"]["roof"] = 5.5
        book["supplierMemo"] = {"currencyBasis": "EUR", "source": "untouched"}
        draft.write({"catalog_json": catalog, "pricebook_json": book})
        before = copy.deepcopy(draft._content_bundle())
        wizard = self.editor(draft)
        self.assertEqual(wizard.currency_id, self.env.ref("base.EUR"))
        self.assertEqual(len(wizard.field_ids), sum(len(g["fields"]) for g in catalog["groups"]))
        self.assertEqual(len(wizard.reference_price_ids), sum(len(v) for v in book["optionPrices"].values()))
        with Form(wizard) as form:
            self.assertEqual(form.base_per_m2, 1350)
        wizard.action_apply()
        self.assertEqual(draft._content_bundle(), before)
        self.assertEqual(draft.catalog_json, catalog)
        self.assertEqual(draft.pricebook_json, book)

    def test_native_edits_change_exact_prices_defaults_and_limits(self):
        draft = self.draft()
        before = copy.deepcopy(draft._content_bundle())
        wizard = self.editor(draft)
        wizard.write({"base_per_m2": 1400.01})
        facade = wizard.field_ids.filtered(lambda f: f.key == "facade")
        facade.write({"name": "Gevelmateriaal", "default_choice_id": facade.choice_ids.filtered(lambda c: c.key == "wood-vertical").id})
        facade.choice_ids.filtered(lambda c: c.key == "brick-red").write({"name": "Rode gevelsteen"})
        width = wizard.number_ids.filtered(lambda n: json.loads(n.path_key) == ["dimensions", "width", "max"])
        width.value = 740
        component = draft.option_ids.filtered(lambda o: o.key == "facade" and o.value_key == "*").component_ids.filtered(lambda c: c.role == "product")
        price = wizard.scope_price_ids.filtered(lambda p: p.component_id == component and json.loads(p.path_key) == ["prices", "brick-red"])
        price.amount = 187.25
        wizard.action_apply()
        self.assertEqual(draft.pricebook_json["basePerM2"], 140001)
        self.assertEqual(draft.pricebook_json["optionPrices"], before["pricebook"]["optionPrices"])
        self.assertEqual(draft.catalog_json["defaults"]["facade"], "wood-vertical")
        self.assertEqual(draft.catalog_json["dimensions"]["width"]["max"], 740)
        self.assertEqual(component.option_prices_json["brick-red"], 18725)
        self.assertEqual(draft.catalog_json["reference"], before["catalog"]["reference"])
        self.assertEqual(draft.catalog_json["groups"][0]["fields"][0]["options"][0]["referenceAnswerId"], before["catalog"]["groups"][0]["fields"][0]["options"][0]["referenceAnswerId"])
        with release_context(draft._draft_bundle(allow_unapproved=True)):
            price = price_config({"facade": "brick-red"})
        facade_line = next(line for line in price["lines"] if line["id"].startswith("facade"))
        self.assertEqual(facade_line["unitPrice"], 18725)

    def test_stale_published_and_tampered_editors_cannot_write(self):
        draft = self.draft()
        stale = self.editor(draft)
        book = dict(draft.pricebook_json, fixedSetup=330001)
        draft.write({"pricebook_json": book})
        with self.assertRaises(UserError):
            stale.action_apply()
        self.assertEqual(draft.pricebook_json, book)
        wizard = self.editor(draft)
        wizard.number_ids[0].path_key = '["assetRevision"]'
        with self.assertRaises(ValidationError):
            wizard.action_apply()
        draft.action_publish()
        published = copy.deepcopy(draft.published_json)
        readonly = self.editor(draft)
        self.assertEqual(readonly.source_state, "published")
        with self.assertRaises(UserError):
            readonly.action_apply()
        self.assertEqual(draft.published_json, published)
        next_editor = self.env["cs.prefab.catalog.editor"].browse(draft.action_edit_new_draft()["res_id"])
        self.assertNotEqual(next_editor.release_id, draft)
        self.assertEqual(next_editor.release_id.state, "draft")
        self.assertEqual(next_editor.release_id.catalog_json, draft.catalog_json)
        with self.assertRaises(AccessError):
            self.env["cs.prefab.catalog.editor"].with_user(self.env.ref("base.public_user")).search([])

    def test_invalid_prices_and_geometry_roll_back_without_partial_update(self):
        draft = self.draft()
        wizard = self.editor(draft)
        for value in (-1, 0.001, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                wizard.scope_price_ids[0].write({"amount": value})
        component = draft.option_ids[0].component_ids[0]
        with self.assertRaises(ValidationError):
            component.write({"unit_price_eur": 0.001})
        before = copy.deepcopy(draft._content_bundle())
        wizard.base_per_m2 = 1500
        wizard.number_ids.filtered(lambda n: json.loads(n.path_key) == ["dimensions", "width", "max"]).value = 800
        with self.assertRaises(ValidationError):
            wizard.action_apply()
        self.assertEqual(draft._content_bundle(), before)

    def test_edit_reapproval_and_noop_approval_are_distinct(self):
        draft = self.draft()
        draft.write({"price_mode": "commercial", "commercial_reference": "Test source", "commercial_terms": "Eigen indicatieve tarieven, definitief na controle.",
            "commercial_rates_confirmed": True, "commercial_scope_confirmed": True, "commercial_tax_confirmed": True,
            "pricebook_json": dict(draft.pricebook_json, pricebookVersion="TEST-EUR-1")})
        draft.action_approve_commercial()
        approved_hash = draft.approval_hash
        self.editor(draft).action_apply()
        self.assertEqual(draft.approval_hash, approved_hash)
        wizard = self.editor(draft)
        wizard.fixed_setup += 0.01
        wizard.action_apply()
        self.assertFalse(draft.approval_hash)
        self.assertEqual(draft.commercial_approval_state, "pending")

    def test_base_curve_is_edited_natively_and_an_absent_curve_stays_absent(self):
        draft = self.draft()
        book = copy.deepcopy(draft.pricebook_json)
        self.assertNotIn("baseCurve", book)
        self.editor(draft).action_apply()
        self.assertEqual(draft.pricebook_json, book, "a no-op apply injects no curve key")
        wizard = self.editor(draft)
        self.assertFalse(wizard.use_base_curve)
        wizard.write({"use_base_curve": True, "base_curve_fixed": 29750, "base_curve_factor": 650,
                      "base_curve_exponent": "1.1860002", "base_curve_round_to": 1})
        wizard.action_apply()
        self.assertEqual(draft.pricebook_json["baseCurve"], {"fixed": 2975000, "factor": 65000, "exponent": "1.1860002", "roundTo": 100})
        self.assertEqual(draft.base_curve_summary, "€ 29.750,00 + € 650,00 × m²^1.1860002 · afgerond op € 1,00")
        with release_context(draft._draft_bundle(allow_unapproved=True)):
            base = next(line for line in price_config({})["lines"] if line["id"] == "base")
        # 5 × 3 m: the price list's 49.135, less the setup line the site keeps separately
        self.assertEqual((base["quantity"], base["unit"], base["total"]), (1.0, "post", (49135 - 3250) * 100))
        before = copy.deepcopy(draft.pricebook_json)
        self.editor(draft).action_apply()
        self.assertEqual(draft.pricebook_json, before, "an unchanged curve survives a no-op apply")
        wizard = self.editor(draft)
        with self.assertRaises(ValidationError):
            wizard.write({"base_curve_exponent": "1,186"})
        wizard = self.editor(draft)
        wizard.use_base_curve = False
        wizard.action_apply()
        self.assertNotIn("baseCurve", draft.pricebook_json)

    def test_a_package_price_may_be_a_reduction_but_a_device_price_may_not(self):
        draft = self.draft()
        facade = draft.option_ids.filtered(lambda o: o.key == "facade" and o.value_key == "*").component_ids.filtered(lambda c: c.role == "product")
        heating = draft.option_ids.filtered(lambda o: o.key == "heating" and o.value_key == "*").component_ids.filtered(lambda c: c.role == "preparation")
        facade.write({"pricing_basis": "option"})
        wizard = self.editor(draft)
        render = wizard.scope_price_ids.filtered(lambda p: p.component_id == facade and json.loads(p.path_key) == ["prices", "render"])
        left = wizard.scope_price_ids.filtered(lambda p: p.component_id == heating and json.loads(p.path_key) == ["prices", "left"])
        self.assertTrue(render.allow_credit)
        self.assertFalse(left.allow_credit)
        with self.assertRaises(ValidationError):
            left.write({"amount": -1})
        render.amount = -2000
        wizard.action_apply()
        self.assertEqual(facade.option_prices_json["render"], -200000)
        with release_context(draft._draft_bundle(allow_unapproved=True)):
            answer = price_config({"facade": "render"})
        self.assertEqual(next(line for line in answer["lines"] if line["id"].startswith("facade"))["total"], -200000)
        reopened = self.editor(draft)  # the editor still opens on a release that holds a credit
        self.assertEqual(reopened.scope_price_ids.filtered(lambda p: p.component_id == facade and json.loads(p.path_key) == ["prices", "render"]).amount, -2000)
        with self.assertRaises(ValidationError):
            heating.write({"option_prices_json": dict(heating.option_prices_json, left=-1)})
        with self.assertRaises(ValidationError):
            facade.write({"pricing_basis": "area"})  # a per-m² price cannot carry a credit

    def test_scope_exception_uses_named_choice_and_preserves_base_policy(self):
        draft = self.draft()
        base = draft.option_ids.filtered(lambda o: o.key == "heating" and o.value_key == "*")
        before = copy.deepcopy(draft._content_bundle()["policies"]["heating"])
        wizard = self.editor(draft)
        field = wizard.field_ids.filtered(lambda f: f.key == "heating")
        wizard.write({"policy_field_id": field.id, "policy_choice_id": field.choice_ids.filtered(lambda c: c.key == "left").id})
        action = wizard.action_create_scope_override()
        option = self.env["cs.prefab.catalog.option"].browse(action["res_id"])
        self.assertEqual((option.key, option.value_key), ("heating", "left"))
        option.write({"asset_key": "heating-panel"})
        option.component_ids.filtered(lambda c: c.role == "product").write({"status": "included"})
        self.assertEqual(base.component_ids.filtered(lambda c: c.role == "product").status, "excluded")
        bundle = draft._draft_bundle(allow_unapproved=True)
        current_base = copy.deepcopy(bundle["policies"]["heating"])
        current_base.pop("choices")
        self.assertEqual(current_base, before)
        with release_context(bundle):
            left = next(item for item in price_config({"interior": True, "heating": "left"})["scope"] if item["key"] == "heating")
        self.assertTrue(left["productIncluded"])
        self.assertEqual(left["assetKey"], "heating-panel")
        self.assertEqual(next(c for c in left["components"] if c["role"] == "product")["total"], 0)

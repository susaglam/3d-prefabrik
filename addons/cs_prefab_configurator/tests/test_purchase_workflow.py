"""Native draft procurement contracts, independent from request/snapshot tests."""
import uuid
from datetime import date, timedelta
from unittest.mock import patch

from freezegun import freeze_time

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user


QUIET = dict(tracking_disable=True, mail_create_nolog=True, mail_create_nosubscribe=True,
             mail_auto_subscribe_no_notify=True, mail_notify_force_send=False, send_email=False)


@tagged("post_install", "-at_install", "prefab_purchase_workflow")
class TestPrefabPurchaseWorkflow(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.unit = cls.env.ref("uom.product_uom_unit")
        cls.area = cls.env.ref("uom.product_uom_square_meter")
        cls.vendor = cls.env["res.partner"].with_context(**QUIET).create({
            "name": "Prefab RFQ test supplier A", "is_company": True, "email": False,
            "supplier_rank": 1, "company_id": cls.company.id})
        cls.vendor_b = cls.env["res.partner"].with_context(**QUIET).create({
            "name": "Prefab RFQ test supplier B", "is_company": True, "email": False,
            "supplier_rank": 1, "company_id": cls.company.id})
        cls.customer = cls.env["res.partner"].with_context(**QUIET).create({
            "name": "Prefab RFQ test customer", "email": False, "company_id": cls.company.id})
        cls.buyer = new_test_user(cls.env, login="prefab_rfq_buyer", email=False,
            groups="purchase.group_purchase_user,sales_team.group_sale_salesman,project.group_project_user",
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)])
        cls.sales_user = new_test_user(cls.env, login="prefab_rfq_sales_only", email=False,
            groups="sales_team.group_sale_salesman,project.group_project_user",
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)])
        cls.other_company = cls.env["res.company"].create({"name": "Prefab RFQ other company"})
        cls.other_buyer = new_test_user(cls.env, login="prefab_rfq_other_buyer", email=False,
            groups="purchase.group_purchase_user,sales_team.group_sale_salesman,project.group_project_user",
            company_id=cls.other_company.id, company_ids=[Command.set(cls.other_company.ids)])
        cls.company.write({"prefab_purchase_enabled": True,
            "prefab_purchase_vendor_id": cls.vendor.id, "prefab_purchase_user_id": cls.buyer.id,
            "account_price_include": "tax_excluded"})

    def _product(self, name, *, vendor=None, price=25, unit=None, kind="service",
                 tracking="no", purchase=True, key=False):
        product = self.env["product.product"].with_company(self.company).with_context(**QUIET).create({
            "name": name, "company_id": self.company.id, "type": kind,
            "sale_ok": True, "purchase_ok": purchase, "invoice_policy": "order",
            "service_tracking": tracking, "uom_id": (unit or self.unit).id,
            "taxes_id": [Command.clear()], "supplier_taxes_id": [Command.clear()],
            "prefab_item_key": key})
        if vendor:
            self._seller(product, vendor, price=price)
        return product

    def _seller(self, product, vendor, **values):
        return self.env["product.supplierinfo"].with_company(self.company).create({
            "partner_id": vendor.id, "product_tmpl_id": product.product_tmpl_id.id,
            "company_id": self.company.id, "uom_id": product.uom_id.id,
            "currency_id": self.company.currency_id.id, "min_qty": 0,
            "price": 25, "delay": 0, **values})

    def _order(self, rows=None, *, prefab=True):
        if rows is None:
            base = self._product("Prefab RFQ base service", vendor=self.vendor, tracking="project_only", unit=self.area)
            rows = [(base, 12.5, 900)]
        return self.env["sale.order"].with_company(self.company).with_context(**QUIET).create({
            "partner_id": self.customer.id, "company_id": self.company.id, "user_id": self.buyer.id,
            "prefab_origin_ref": "RFQ-TEST-" + uuid.uuid4().hex[:12] if prefab else False,
            "order_line": [Command.create({"product_id": product.id, "name": product.name,
                "product_uom_qty": quantity, "product_uom_id": product.uom_id.id,
                "price_unit": price, "tax_ids": [Command.clear()]}) for product, quantity, price in rows]})

    def _purchases(self, order):
        return self.env["purchase.order"].search([("prefab_sale_order_id", "=", order.id)])

    def _review_activities(self, order):
        return self.env["mail.activity"].search([("res_model", "=", "sale.order"),
            ("res_id", "=", order.id), ("summary", "=", "Prefab-inkoop controleren")])

    def _reconfirm(self, order):
        order._action_cancel()
        order.action_draft()
        order.action_confirm()

    def test_draft_non_prefab_and_disabled_company_do_not_generate(self):
        draft = self._order()
        self.assertFalse(draft._ensure_prefab_procurement())
        self.assertFalse(self._purchases(draft))
        plain = self._order(prefab=False)
        plain.action_confirm()
        self.assertFalse(plain._ensure_prefab_procurement())
        self.assertFalse(self._purchases(plain))
        self.company.prefab_purchase_enabled = False
        draft.action_confirm()
        self.assertEqual(draft.state, "sale")
        self.assertFalse(self._purchases(draft))
        self.assertFalse(draft.order_line.prefab_purchase_processed)

    def test_confirmation_groups_vendors_and_links_all_positive_native_lines(self):
        base = self._product("Prefab project and shell", vendor=self.vendor, tracking="project_only", unit=self.area)
        service = self._product("Included installation service", vendor=self.vendor, price=13)
        goods = self._product("Purchased facade material", vendor=self.vendor_b, kind="consu", price=7)
        excluded = self._product("Zero quantity option", vendor=self.vendor)
        order = self._order([(base, 24.5, 1100), (service, 2, 0), (goods, 3, 500), (excluded, 0, 100)])
        order.order_line = [Command.create({"display_type": "line_section", "name": "Native section"})]
        order.action_confirm()
        purchases = self._purchases(order)
        self.assertEqual(len(purchases), 2)
        self.assertEqual(set(purchases.mapped("partner_id").ids), {self.vendor.id, self.vendor_b.id})
        self.assertEqual(set(purchases.mapped("state")), {"draft"})
        self.assertEqual(purchases.project_id, order.project_id)
        self.assertTrue(order.project_id.account_id)
        expected = order.order_line.filtered(lambda line: not line.display_type and line.product_uom_qty > 0)
        self.assertEqual(purchases.order_line.sale_line_id, expected)
        for line in expected:
            purchase = line.purchase_line_ids
            self.assertEqual(len(purchase), 1)
            self.assertEqual(purchase.product_qty, line.product_uom_qty)
            self.assertEqual(purchase.uom_id, line.product_uom_id)
            self.assertEqual(purchase.sale_order_id, order)
            self.assertTrue(line.prefab_purchase_processed)
            account_ids = {int(key) for combination in purchase.analytic_distribution for key in combination.split(",")}
            self.assertIn(order.project_id.account_id.id, account_ids)
        free_sale = expected.filtered(lambda line: line.product_id == service)
        self.assertEqual(free_sale.price_unit, 0)
        self.assertEqual(free_sale.purchase_line_ids.price_unit, 13)
        self.assertFalse(order.order_line.filtered(lambda line: line.product_id == excluded).purchase_line_ids)
        self.assertEqual(order.purchase_order_count, 2)
        self.assertEqual(order.project_id.purchase_orders_count, 2)
        self.assertFalse(purchases.invoice_ids)
        self.assertFalse(any(purchases.mapped("date_approve")))
        for purchase in purchases:
            # Internal review guidance must never reach the vendor-facing terms field.
            self.assertNotIn("Prefab-inkoopaanvraag", str(purchase.note or ""))
            self.assertFalse(purchase.partner_ref)
            self.assertTrue(purchase.message_ids.filtered(lambda message: order.name in (message.body or "") and message.subtype_id == self.env.ref("mail.mt_note")))

    def test_vendor_unit_currency_discount_tax_and_price_valid_today(self):
        today = fields.Date.context_today(self.env.user)
        currency = self.env.ref("base.USD") if self.company.currency_id != self.env.ref("base.USD") else self.env.ref("base.GBP")
        currency.active = True
        for current, rate in ((self.company.currency_id, 1), (currency, 2)):
            existing = self.env["res.currency.rate"].search([("currency_id", "=", current.id),
                ("company_id", "=", self.company.id), ("name", "=", today)])
            if existing:
                existing.rate = rate
            else:
                self.env["res.currency.rate"].create({"currency_id": current.id, "company_id": self.company.id,
                    "name": today, "rate": rate})
        pack = self.env["uom.uom"].create({"name": "RFQ six units", "relative_uom_id": self.unit.id, "relative_factor": 6})
        self.vendor_b.with_company(self.company).property_purchase_currency_id = self.company.currency_id
        product = self._product("Currency and packaging service", tracking="project_only")
        tax = self.env["account.tax"].create({"name": "RFQ purchase tax 21", "company_id": self.company.id,
            "amount_type": "percent", "amount": 21, "type_tax_use": "purchase"})
        product.supplier_taxes_id = tax
        seller = self._seller(product, self.vendor_b, price=120, currency_id=currency.id,
            uom_id=pack.id, discount=10, min_qty=2, date_start=today, date_end=today + timedelta(days=1), delay=3)
        order = self._order([(product, 12, 999)])
        order.action_confirm()
        po = self._purchases(order)
        self.assertEqual(len(po), 1)
        line = po.order_line
        self.assertEqual(po.date_order.date(), today)
        self.assertEqual(po.currency_id, self.company.currency_id)
        self.assertEqual(line.selected_seller_id, seller)
        self.assertEqual(line.uom_id, pack)
        self.assertEqual(line.product_qty, 2)
        self.assertAlmostEqual(line.price_unit, 60, places=2)
        self.assertEqual(line.discount, 10)
        self.assertEqual(line.tax_ids, tax)
        self.assertAlmostEqual(line.price_subtotal, 108, places=2)
        self.assertAlmostEqual(line.price_total, 130.68, places=2)
        self.assertEqual(line.date_planned.date(), today + timedelta(days=3))
        self.assertNotEqual(line.price_unit, order.order_line.price_unit)

    def test_setup_preserves_existing_supplier_prices_and_removed_vendor_rows(self):
        fresh = self._product("Initialize supplier only once", purchase=False, key="rfq-new-" + uuid.uuid4().hex)
        existing = self._product("Keep purchased supplier pricing", vendor=self.vendor_b, price=43,
            purchase=False, key="rfq-existing-" + uuid.uuid4().hex)
        old_supplier = existing.seller_ids
        self.company.action_setup_prefab_operations()
        self.assertTrue(fresh.prefab_purchase_seeded)
        self.assertTrue(fresh.purchase_ok)
        self.assertEqual(fresh.seller_ids.partner_id, self.vendor)
        self.assertEqual(fresh.seller_ids.price, 0)
        self.assertEqual(existing.seller_ids, old_supplier)
        self.assertEqual(existing.seller_ids.price, 43)
        fresh.seller_ids.unlink()
        fresh.purchase_ok = False
        self.company.action_setup_prefab_operations()
        fresh.product_tmpl_id._prefab_initialize_purchase_vendor()
        self.assertFalse(fresh.seller_ids)
        self.assertFalse(fresh.purchase_ok, "A deliberately disabled purchase product must stay disabled.")
        self.assertTrue(fresh.prefab_purchase_seeded)
        self.assertEqual(existing.seller_ids, old_supplier)
        self.assertEqual(existing.seller_ids.price, 43)

    def test_missing_vendor_warns_once_while_purchase_opt_out_is_respected(self):
        missing = self._product("Supplier removed intentionally", tracking="project_only")
        opted_out = self._product("No purchase requested", vendor=self.vendor, purchase=False)
        order = self._order([(missing, 1, 1000), (opted_out, 1, 200)])
        order.action_confirm()
        self.assertFalse(self._purchases(order))
        self.assertIn(missing.name, order.prefab_purchase_review)
        self.assertNotIn(opted_out.name, order.prefab_purchase_review)
        activity = self._review_activities(order)
        self.assertEqual(len(activity), 1)
        self.assertEqual(activity.user_id, self.buyer)
        order._ensure_prefab_procurement()
        self.assertEqual(self._review_activities(order), activity)
        self.assertFalse(missing.seller_ids)
        self.assertFalse(any(order.order_line.mapped("prefab_purchase_processed")))

    def test_reconfirmation_preserves_manual_rfq_edits_and_native_project(self):
        order = self._order()
        order.action_confirm()
        po = self._purchases(order)
        project = order.project_id
        po.order_line.write({"name": "Buyer reviewed detail", "product_qty": 9, "price_unit": 77})
        po.note = "Buyer edited terms"
        line_fields = ["name", "product_qty", "uom_id", "price_unit", "discount", "tax_ids", "date_planned"]
        saved = po.order_line.read(line_fields)
        self._reconfirm(order)
        order.action_prepare_prefab_procurement()
        self.assertEqual(self._purchases(order), po)
        self.assertEqual(po.state, "draft")
        self.assertEqual(po.order_line.read(line_fields), saved)
        self.assertIn("Buyer edited terms", po.note)
        self.assertEqual(order.project_id, project)

    def test_cancelled_and_deleted_purchase_documents_are_not_recreated(self):
        base = self._product("Persistent procurement base", vendor=self.vendor, tracking="project_only")
        extra = self._product("Persistent procurement extra", vendor=self.vendor)
        order = self._order([(base, 1, 1000), (extra, 2, 100)])
        order.action_confirm()
        po = self._purchases(order)
        po.button_cancel()
        self._reconfirm(order)
        self.assertEqual(self._purchases(order), po)
        self.assertEqual(po.state, "cancel")
        po.button_draft()
        removed_sale_line = po.order_line[:1].sale_line_id
        po.order_line[:1].unlink()
        order._ensure_prefab_procurement()
        self.assertEqual(len(po.order_line), 1)
        self.assertFalse(removed_sale_line.purchase_line_ids)
        self.assertTrue(removed_sale_line.prefab_purchase_processed)
        po.button_cancel()
        po.unlink()
        self._reconfirm(order)
        self.assertFalse(self._purchases(order))
        self.assertFalse(order.order_line.purchase_line_ids)
        self.assertTrue(all(order.order_line.mapped("prefab_purchase_processed")))

    def test_preexisting_manual_purchase_line_removal_is_not_automatically_reversed(self):
        order = self._order()
        sale_line = order.order_line
        manual = self.env["purchase.order"].with_company(self.company).with_context(**QUIET).create({
            "partner_id": self.vendor.id, "company_id": self.company.id,
            "currency_id": self.company.currency_id.id,
            "order_line": [Command.create({"name": "Manually linked purchase", "product_id": sale_line.product_id.id,
                "product_qty": 4, "uom_id": sale_line.product_uom_id.id, "price_unit": 37,
                "date_planned": fields.Datetime.now(), "tax_ids": [Command.clear()], "sale_line_id": sale_line.id})]})
        order.action_confirm()
        self.assertEqual(sale_line.purchase_line_ids.order_id, manual)
        self.assertTrue(sale_line.prefab_purchase_processed)
        self.assertFalse(manual.prefab_sale_order_id)
        self.assertEqual(manual.order_line.product_qty, 4)
        self.assertEqual(manual.order_line.price_unit, 37)
        manual.button_cancel()
        manual.unlink()
        order.action_prepare_prefab_procurement()
        self.assertFalse(self._purchases(order))
        self.assertFalse(sale_line.purchase_line_ids)
        self.assertTrue(sale_line.prefab_purchase_processed)

    def test_sales_cancellation_notifies_buyer_once_without_cancelling_purchases(self):
        base = self._product("Cancellation shell service", vendor=self.vendor, tracking="project_only")
        extra = self._product("Cancellation supplier B service", vendor=self.vendor_b)
        order = self._order([(base, 1, 900), (extra, 1, 100)])
        order.action_confirm()
        purchases = self._purchases(order)
        self.assertEqual(len(purchases), 2)
        approved = purchases.filtered(lambda po: po.partner_id == self.vendor_b)
        approved.button_confirm()
        self.assertEqual(approved.state, "purchase")
        before = {po.id: po.state for po in purchases}
        order._action_cancel()
        self.assertEqual(order.state, "cancel")
        self.assertEqual({po.id: po.state for po in purchases}, before)
        activities = self.env["mail.activity"].search([("res_model", "=", "purchase.order"),
            ("res_id", "in", purchases.ids), ("summary", "=", "Prefab-verkooporder geannuleerd")])
        self.assertEqual(len(activities), 2)
        self.assertEqual(set(activities.mapped("res_id")), set(purchases.ids))
        self.assertEqual(activities.user_id, self.buyer)
        order._action_cancel()
        repeated = self.env["mail.activity"].search([("res_model", "=", "purchase.order"),
            ("res_id", "in", purchases.ids), ("summary", "=", "Prefab-verkooporder geannuleerd")])
        self.assertEqual(repeated, activities)
        self.assertEqual({po.id: po.state for po in purchases}, before)
        self.assertFalse(purchases.invoice_ids)

    def test_sales_quantity_edit_warns_without_overwriting_purchase(self):
        order = self._order()
        order.action_confirm()
        po = self._purchases(order)
        before = po.order_line.read(["product_qty", "price_unit", "name", "uom_id"])
        order.locked = False
        order.order_line.product_uom_qty = 31
        self.assertEqual(po.order_line.read(["product_qty", "price_unit", "name", "uom_id"]), before)
        activity = self._review_activities(order)
        self.assertEqual(len(activity), 1)
        self.assertEqual(activity.user_id, self.buyer)
        self.assertIn("Verkoopregels gewijzigd", activity.note)
        self.assertIn("31", activity.note)
        # A later procurement run keeps the change notice and does not add a second open activity.
        order.action_prepare_prefab_procurement()
        self.assertEqual(self._review_activities(order), activity)
        self.assertIn("Verkoopregels gewijzigd", activity.note)
        order.order_line.product_uom_qty = 40
        self.assertEqual(self._review_activities(order), activity)
        self.assertIn("40", activity.note)
        self.assertTrue(order.message_ids.filtered(lambda message: "Verkoopregels gewijzigd" in (message.body or "")))

    def test_manual_actions_require_purchase_rights_and_allowed_company(self):
        order = self._order()
        for user, company in ((self.sales_user, self.company), (self.other_buyer, self.other_company)):
            with self.subTest(user=user.login):
                with self.assertRaises(AccessError):
                    order.with_user(user).with_context(allowed_company_ids=company.ids).action_prepare_prefab_procurement()
        with self.assertRaises(AccessError):
            self.company.with_user(self.sales_user).action_setup_prefab_operations()
        self.assertFalse(self._purchases(order))
        self.assertEqual(order.state, "draft")

    def test_zero_cost_review_clears_after_buyer_enters_purchase_price(self):
        product = self._product("Price to be reviewed", vendor=self.vendor, price=0, tracking="project_only")
        product.standard_price = 44
        order = self._order([(product, 2, 999)])
        order.action_confirm()
        po = self._purchases(order)
        self.assertEqual(len(po), 1)
        self.assertEqual(po.state, "draft")
        self.assertEqual(po.order_line.price_unit, 0)
        self.assertTrue(po.prefab_needs_price_review)
        self.assertIn("nulprijzen", order.prefab_purchase_review)
        self.assertEqual(len(self._review_activities(order)), 1)
        self.assertIn(po, self.env["purchase.order"].search([("prefab_needs_price_review", "=", True)]))
        po.order_line.price_unit = 87
        self.assertFalse(po.prefab_needs_price_review)
        self.assertNotIn(po, self.env["purchase.order"].search([("prefab_needs_price_review", "=", True)]))
        self.assertIn(po, self.env["purchase.order"].search([("prefab_needs_price_review", "=", False)]))
        order._ensure_prefab_procurement()
        self.assertFalse(order.prefab_purchase_review)
        self.assertEqual(po.order_line.price_unit, 87)
        self.assertEqual(po.state, "draft")
        self.assertFalse(po.invoice_ids)

    def test_zero_priced_example_vendor_yields_to_real_vendor(self):
        product = self._product("Example vendor then real vendor", vendor=self.vendor, price=0, tracking="project_only")
        real = self._seller(product, self.vendor_b, price=50, sequence=11, min_qty=1)
        self.assertEqual(product.seller_ids.sorted("sequence")[:1].partner_id, self.vendor)
        order = self._order([(product, 2, 900)])
        order.action_confirm()
        po = self._purchases(order)
        self.assertEqual(po.partner_id, self.vendor_b)
        self.assertEqual(po.order_line.selected_seller_id, real)
        self.assertEqual(po.order_line.price_unit, 50)
        self.assertFalse(po.prefab_needs_price_review)

    def test_never_seeded_prefab_product_warns_but_seeded_opt_out_stays_silent(self):
        unseeded = self._product("Prefab product without purchase setup", vendor=self.vendor, purchase=False,
            tracking="project_only", key="rfq-unseeded-" + uuid.uuid4().hex)
        opted_out = self._product("Seeded but deliberately not purchased", vendor=self.vendor, purchase=False,
            key="rfq-optout-" + uuid.uuid4().hex)
        opted_out.product_tmpl_id.prefab_purchase_seeded = True
        order = self._order([(unseeded, 1, 900), (opted_out, 1, 100)])
        order.action_confirm()
        self.assertFalse(self._purchases(order))
        self.assertIn(unseeded.name, order.prefab_purchase_review)
        self.assertIn("Voorbeeldinrichting toepassen", order.prefab_purchase_review)
        self.assertNotIn(opted_out.name, order.prefab_purchase_review)
        self.assertEqual(len(self._review_activities(order)), 1)

    def test_edit_in_quotation_after_cancel_notifies_buyer_without_rewriting_rfq(self):
        base = self._product("Draft edit shell", vendor=self.vendor, tracking="project_only", unit=self.area)
        extra = self._product("Draft edit extra", vendor=self.vendor)
        order = self._order([(base, 12.5, 900), (extra, 2, 100)])
        order.action_confirm()
        po = self._purchases(order)
        saved = po.order_line.read(["product_qty", "price_unit", "name"])
        order.locked = False
        order._action_cancel()
        order.action_draft()
        base_line = order.order_line.filtered(lambda line: line.product_id == base)
        extra_line = order.order_line.filtered(lambda line: line.product_id == extra)
        base_line.product_uom_qty = 30
        extra_line.unlink()
        order.action_confirm()
        self.assertEqual(self._purchases(order), po)
        self.assertEqual(po.order_line.read(["product_qty", "price_unit", "name"]), saved)
        activity = self._review_activities(order)
        self.assertEqual(len(activity), 1)
        self.assertIn(base_line.name, activity.note)
        self.assertIn("30", activity.note)
        removal = self.env["mail.activity"].search([("res_model", "=", "purchase.order"), ("res_id", "=", po.id),
            ("summary", "=", "Prefab-verkoopregel verwijderd")])
        self.assertEqual(len(removal), 1)
        self.assertIn("Draft edit extra", removal.note)

    def test_line_added_after_confirmation_notifies_and_fill_in_buys_it_once(self):
        order = self._order()
        order.action_confirm()
        po = self._purchases(order)
        added_product = self._product("Added after confirmation", vendor=self.vendor, price=11)
        order.locked = False
        order.order_line = [Command.create({"product_id": added_product.id, "name": added_product.name, "product_uom_qty": 3,
            "product_uom_id": added_product.uom_id.id, "price_unit": 40, "tax_ids": [Command.clear()]})]
        added = order.order_line.filtered(lambda line: line.product_id == added_product)
        self.assertFalse(added.purchase_line_ids)
        activity = self._review_activities(order)
        self.assertEqual(len(activity), 1)
        self.assertIn("Nieuwe verkoopregel na bevestiging", activity.note)
        order.action_prepare_prefab_procurement()
        order.action_prepare_prefab_procurement()
        self.assertEqual(len(added.purchase_line_ids), 1)
        self.assertEqual(added.purchase_line_ids.order_id, po)
        self.assertEqual(added.purchase_line_ids.price_unit, 11)

    def test_fill_in_button_explains_disabled_company(self):
        order = self._order()
        order.action_confirm()
        self.company.prefab_purchase_enabled = False
        with self.assertRaises(UserError) as caught:
            order.action_prepare_prefab_procurement()
        self.assertIn("Uitvoering en inkoop", str(caught.exception))

    def test_unexpected_procurement_failure_does_not_block_sale_confirmation(self):
        order = self._order()
        with patch.object(type(self.env["sale.order.line"]), "_purchase_service_prepare_order_values", side_effect=TypeError("boom")):
            order.action_confirm()
        self.assertEqual(order.state, "sale")
        self.assertTrue(order.project_id)
        self.assertFalse(self._purchases(order))
        self.assertIn("konden niet automatisch", order.prefab_purchase_review)
        self.assertFalse(order.order_line.prefab_purchase_processed)

    def test_vendor_price_starting_today_is_used_after_local_midnight(self):
        self.env.user.tz = "Europe/Amsterdam"
        product = self._product("Price valid from local tomorrow", tracking="project_only")
        # 22:30 UTC on 14 September is already 15 September in Amsterdam.
        seller = self._seller(product, self.vendor_b, price=70, date_start=date(2026, 9, 15))
        order = self._order([(product, 1, 900)])
        with freeze_time("2026-09-14 22:30:00"):
            order.action_confirm()
        po = self._purchases(order)
        self.assertEqual(len(po), 1)
        self.assertEqual(po.date_order.date(), date(2026, 9, 15))
        self.assertEqual(po.order_line.selected_seller_id, seller)
        self.assertEqual(po.order_line.price_unit, 70)
        self.assertFalse(order.prefab_purchase_review)

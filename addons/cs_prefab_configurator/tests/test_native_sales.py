"""Real ORM contracts for submitted requests and editable native sales documents."""
import base64
import copy
from datetime import timedelta
import io
import secrets
import uuid
from unittest.mock import patch

from PIL import Image

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user

from ..services import catalog as catalog_service, pricing as pricing_service
from ..services.catalog import default_release, make_release, release_context
from ..services.configuration import canonical_config, canonical_quote_payload, document_config_key
from ..services.document_visuals import VIEW_LABELS
from ..services.storage import new_snapshot


@tagged("post_install", "-at_install", "prefab_native_sales")
class TestPrefabNativeSales(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.eur = cls.env.ref("base.EUR")
        cls.square_meter = cls.env.ref("uom.product_uom_square_meter")
        cls.unit = cls.env.ref("uom.product_uom_unit")
        cls.post = cls.env.ref("cs_prefab_configurator.uom_prefab_post")
        cls.tax = cls.company.account_sale_tax_id
        if not (cls.tax and cls.tax.active and cls.tax.amount_type == "percent"
                and cls.tax.type_tax_use == "sale" and cls.tax.amount == 21 and not cls.tax.price_include):
            cls.tax = cls.env["account.tax"].search([
                ("company_id", "=", cls.company.id), ("type_tax_use", "=", "sale"),
                ("amount_type", "=", "percent"), ("amount", "=", 21), ("price_include", "=", False),
            ], limit=1)
        if not cls.tax:
            raise AssertionError("Native sales tests require the target company's configured 21% excluded sales tax.")
        cls.website = cls.env["website"].search([("company_id", "=", cls.company.id)], limit=1)
        if not cls.website:
            cls.website = cls.env["website"].create({"name": "Prefab native test website", "company_id": cls.company.id})
        cls.sales_user = new_test_user(
            cls.env, login="prefab_native_responsible", name="Prefab native responsible", email=False,
            groups="sales_team.group_sale_salesman,project.group_project_user",
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.company.prefab_sales_user_id = cls.sales_user
        cls.other_company = cls.env["res.company"].create({"name": "Prefab native isolated company"})
        cls.other_website = cls.env["website"].create({
            "name": "Prefab native isolated website", "company_id": cls.other_company.id,
        })
        cls.other_user = new_test_user(
            cls.env, login="prefab_native_other_company", name="Prefab other company", email=False,
            groups="sales_team.group_sale_salesman,project.group_project_user",
            company_id=cls.other_company.id, company_ids=[Command.set(cls.other_company.ids)],
        )
        cls.stage = cls.env["crm.stage"].create({"name": "Prefab technical review pending", "sequence": 2, "is_won": False})
        image = io.BytesIO()
        Image.new("RGB", (640, 400), "#efeee9").save(image, format="JPEG")
        cls.image_url = "data:image/jpeg;base64," + base64.b64encode(image.getvalue()).decode("ascii")

    def _make_quote(self, config=None, *, included_heating=False, with_image=False,
                    contact_changes=None, company=None, website=None, lead=None):
        company = company or self.company
        website = website or self.website
        contact = {"firstName": "Ada", "lastName": "Native " + uuid.uuid4().hex[:8],
                   "email": "native-" + uuid.uuid4().hex + "@example.test", "phone": "+31 6 12345678",
                   "address": "Teststraat", "houseNumber": "12", "postcode": "1234 AB", "city": "Utrecht",
                   "message": "Ingediende uitvoering; technisch te beoordelen."}
        contact.update(contact_changes or {})
        release = default_release()
        if included_heating:
            component = next(c for c in release["policies"]["heating"]["components"] if c["role"] == "product")
            component["status"] = "included"
            release = make_release(release["catalog"], release["pricebook"], release["policies"])
        payload = {"config": dict({"width": 501, "depth": 299, "interior": False}, **(config or {})),
                   "contact": contact, "consent": True, "idempotencyKey": str(uuid.uuid4())}
        with release_context(release):
            if with_image:
                payload["visuals"] = {"version": 1,
                    "configKey": document_config_key(canonical_config(payload["config"])),
                    "views": [{"id": "perspective-left", "label": "Browser label is ignored", "width": 640, "height": 400, "dataUrl": self.image_url}],
                    "missingViews": [key for key in VIEW_LABELS if key != "perspective-left"]}
            canonical, idempotency_key, payload_hash = canonical_quote_payload(payload)
            snapshot = new_snapshot(canonical)
        contact = canonical["contact"]
        if lead is None:
            lead = self.env["crm.lead"].with_company(company).with_context(
                tracking_disable=True, mail_create_nolog=True, mail_create_nosubscribe=True,
            ).create({"name": "Prefab native opportunity " + uuid.uuid4().hex[:8], "type": "opportunity",
                      "company_id": company.id, "stage_id": self.stage.id,
                      "user_id": (self.sales_user if company == self.company else self.other_user).id,
                      "contact_name": contact["name"], "email_from": contact["email"]})
        return self.env["cs.prefab.quote"].sudo().with_company(company).create({
            "name": "CS-NATIVE-" + uuid.uuid4().hex[:16].upper(), "company_id": company.id,
            "website_id": website.id, "lead_id": lead.id, "token": secrets.token_urlsafe(32),
            "idempotency_key": idempotency_key, "payload_hash": payload_hash,
            "snapshot_json": snapshot, "contact_json": contact, "catalog_revision": snapshot["catalogRevision"],
            "pricebook_version": snapshot["price"]["pricebookVersion"], "price_mode": snapshot["price"]["priceMode"],
            "total_cents": snapshot["price"]["total"], "expires_at": fields.Datetime.now() + timedelta(days=90),
        })

    def _product_lines(self, order):
        return order.order_line.filtered(lambda line: not line.display_type)

    def _followup_activities(self, quote):
        return self.env["mail.activity"].sudo().search([
            ("res_model", "=", "crm.lead"), ("res_id", "=", quote.lead_id.id),
            ("summary", "=", "Prefab-offerte bevestigd: CRM-fase beoordelen"),
        ])

    def test_saved_area_quantity_currency_tax_customer_crm_and_draft_are_populated(self):
        quote = self._make_quote({"outsideTap": "left"}, with_image=True)
        original_snapshot, original_contact = copy.deepcopy(quote.snapshot_json), copy.deepcopy(quote.contact_json)
        with patch.object(pricing_service, "price_config", side_effect=AssertionError("Do not reprice saved requests")), \
             patch.object(catalog_service, "get_catalog", side_effect=AssertionError("Do not reread today's catalogue")):
            quote._ensure_native_documents()
        order = quote.sale_order_id
        self.assertTrue(order)
        self.assertEqual(order.state, "draft")
        self.assertEqual(order.currency_id, self.eur)
        self.assertEqual(order.company_id, self.company)
        self.assertEqual(order.opportunity_id, quote.lead_id)
        self.assertEqual(quote.lead_id.partner_id, quote.partner_id)
        self.assertEqual(order.partner_id, quote.partner_id)
        self.assertEqual(order.partner_shipping_id.street, "Teststraat 12")
        self.assertEqual(order.user_id, self.sales_user)
        self.assertEqual(quote.partner_id.email, original_contact["email"])
        self.assertEqual(quote.partner_id.company_id, self.company)
        self.assertFalse(order.project_id)
        base = order.order_line.filtered(lambda line: line.prefab_component_key == "base")
        self.assertEqual(len(base), 1)
        self.assertAlmostEqual(base.product_uom_qty, 14.9799, places=4)
        self.assertEqual(base.product_uom_id, self.square_meter)
        self.assertEqual(base.product_id.service_tracking, "project_only")
        saved_base = next(row for row in original_snapshot["price"]["lines"] if row["id"] == "base")
        self.assertEqual(base.price_unit, saved_base["unitPrice"] / 100)
        self.assertEqual(base.tax_ids, self.tax)
        self.assertTrue(all(line.tax_ids == self.tax for line in self._product_lines(order)))
        setup = order.order_line.filtered(lambda line: line.prefab_component_key == "setup")
        self.assertEqual(setup.product_uom_id, self.post)
        self.assertEqual(setup.product_uom_qty, 1)
        self.assertAlmostEqual(order.amount_untaxed, original_snapshot["price"]["subtotal"] / 100, places=2)
        self.assertAlmostEqual(order.amount_tax, original_snapshot["price"]["vat"] / 100, places=2)
        self.assertAlmostEqual(order.amount_total, original_snapshot["price"]["total"] / 100, places=2)
        submitted_base = quote.price_line_ids.filtered(lambda line: line.name == saved_base["label"])
        self.assertEqual(len(submitted_base), 1)
        self.assertAlmostEqual(submitted_base.quantity, 14.9799, places=4)
        self.assertEqual(quote.snapshot_json, original_snapshot)
        self.assertEqual(quote.contact_json, original_contact)
        self.assertEqual(len(quote.visual_ids), 1)
        attachments = self.env["ir.attachment"].search([("res_model", "=", "sale.order"), ("res_id", "=", order.id), ("mimetype", "=", "image/jpeg")])
        self.assertEqual(len(attachments), 1)
        # saas~19.4 binary record values expose raw content, not base64 text.
        attachment_bytes = bytes(attachments.raw)
        self.assertGreater(len(attachment_bytes), 100)
        self.assertTrue(attachment_bytes.startswith(b"\xff\xd8"))
        self.assertEqual(attachment_bytes, bytes(quote.visual_ids.image_1920))
        with Image.open(io.BytesIO(attachment_bytes)) as attached_image:
            self.assertEqual(attached_image.format, "JPEG")
            self.assertEqual(attached_image.size, (640, 400))
            attached_image.verify()

    def test_included_products_are_zero_price_lines_and_excluded_scope_is_a_note(self):
        quote = self._make_quote({"interior": True, "heating": "left", "outsideTap": "left"}, included_heating=True)
        quote._ensure_native_documents()
        order = quote.sale_order_id
        included = order.order_line.filtered(lambda line: line.prefab_component_key == "heating.product")
        self.assertEqual(len(included), 1)
        self.assertEqual(included.price_unit, 0)
        self.assertEqual(included.product_uom_qty, 1)
        self.assertEqual(included.product_uom_id, self.unit)
        self.assertIn("inbegrepen", included.name.lower())
        self.assertFalse(order.order_line.filtered(lambda line: line.prefab_component_key in {"heating.installation", "outsideTap.product"}))
        notes = order.order_line.filtered(lambda line: line.display_type == "line_note")
        self.assertEqual(len(notes), 1)
        self.assertIn("Niet inbegrepen", notes.name)
        tap_scope = next(item for item in quote.snapshot_json["scope"] if item["key"] == "outsideTap")
        self.assertIn(tap_scope["label"], notes.name)
        self.assertIn("Montage", notes.name)
        self.assertTrue(quote.price_line_ids.filtered(lambda line: line.status_label == "Inbegrepen" and line.unit_price == 0))
        self.assertTrue(quote.price_line_ids.filtered(lambda line: line.status_label == "Niet inbegrepen"))

    def test_repeated_ensure_preserves_links_rows_attachments_and_user_adjusted_native_prices(self):
        quote = self._make_quote(with_image=True)
        quote._ensure_native_documents()
        order, partner = quote.sale_order_id, quote.partner_id
        identities = (quote.config_line_ids.ids, quote.price_line_ids.ids, quote.visual_ids.ids, order.order_line.ids)
        line = self._product_lines(order)[:1]
        line.price_unit = 147.25
        order.note = "Handmatig vastgelegde verkoopafspraak"
        for _ in range(2):
            quote._ensure_native_documents()
        self.assertEqual(quote.sale_order_id, order)
        self.assertEqual(quote.partner_id, partner)
        self.assertEqual((quote.config_line_ids.ids, quote.price_line_ids.ids, quote.visual_ids.ids, order.order_line.ids), identities)
        self.assertEqual(line.price_unit, 147.25)
        self.assertIn("Handmatig vastgelegde verkoopafspraak", str(order.note))
        self.assertEqual(self.env["sale.order"].search_count([("prefab_quote_id", "=", quote.id)]), 1)
        self.assertEqual(self.env["ir.attachment"].search_count([("res_model", "=", "sale.order"), ("res_id", "=", order.id), ("mimetype", "=", "image/jpeg")]), 1)

    def test_existing_empty_crm_draft_is_filled_and_reused(self):
        quote = self._make_quote()
        partner = self.env["res.partner"].create({"name": "Bestaande klant", "company_id": self.company.id})
        quote.lead_id.partner_id = partner
        empty = self.env["sale.order"].with_company(self.company).create({
            "partner_id": partner.id, "company_id": self.company.id, "opportunity_id": quote.lead_id.id,
        })
        self.assertFalse(empty.order_line)
        quote._ensure_native_documents()
        self.assertEqual(quote.sale_order_id, empty)
        self.assertTrue(empty.order_line)
        self.assertEqual(empty.prefab_quote_id, quote)
        self.assertEqual(quote.lead_id.action_new_quotation()["res_id"], empty.id)

    def test_populated_manual_crm_draft_and_partner_master_data_are_not_overwritten(self):
        quote = self._make_quote()
        partner = self.env["res.partner"].create({"name": "Handmatige klant", "email": "manual-master@example.test",
            "phone": "+31 20 1111111", "street": "Bestaand adres 9", "company_id": self.company.id})
        quote.lead_id.partner_id = partner
        product = self.env["product.product"].create({"name": "Handmatig geoffreerde dienst", "type": "service",
            "service_tracking": "no", "invoice_policy": "order", "uom_id": self.unit.id,
            "company_id": self.company.id, "taxes_id": [Command.set(self.tax.ids)]})
        manual = self.env["sale.order"].with_company(self.company).create({
            "partner_id": partner.id, "company_id": self.company.id, "opportunity_id": quote.lead_id.id,
            "note": "Door verkoper gemaakte notitie", "order_line": [Command.create({
                "name": "Bestaande handmatige inhoud mag niet worden vervangen", "product_id": product.id,
                "product_uom_qty": 2, "product_uom_id": self.unit.id, "price_unit": 123.45,
                "tax_ids": [Command.set(self.tax.ids)]})],
        })
        old_order = manual.read(["name", "partner_id", "note", "order_line", "state"])[0]
        line_fields = ["name", "product_id", "product_uom_qty", "product_uom_id", "price_unit", "tax_ids"]
        old_lines = manual.order_line.read(line_fields)
        old_partner = partner.read(["name", "email", "phone", "street"])[0]
        quote._ensure_native_documents()
        self.assertNotEqual(quote.sale_order_id, manual)
        self.assertEqual(manual.read(["name", "partner_id", "note", "order_line", "state"])[0], old_order)
        self.assertEqual(manual.order_line.read(line_fields), old_lines)
        self.assertEqual(partner.read(["name", "email", "phone", "street"])[0], old_partner)
        self.assertEqual(quote.sale_order_id.partner_id, partner)
        self.assertNotEqual(quote.sale_order_id.partner_shipping_id, partner)
        self.assertEqual(quote.sale_order_id.partner_shipping_id.parent_id, partner)
        self.assertEqual(quote.sale_order_id.partner_shipping_id.street, quote.contact_street)

    def test_submitted_snapshot_rows_remain_immutable_while_partner_and_order_are_editable(self):
        quote = self._make_quote(with_image=True)
        quote._ensure_native_documents()
        before = copy.deepcopy(quote.snapshot_json), copy.deepcopy(quote.contact_json)
        for values in ({"snapshot_json": {}}, {"contact_json": {}}, {"total_cents": 1}, {"sale_order_id": False}):
            with self.assertRaises(UserError):
                quote.write(values)
        for row in (quote.config_line_ids[:1], quote.price_line_ids[:1], quote.visual_ids[:1]):
            with self.assertRaises(UserError):
                row.write({"name": "Herinterpreteerde aanvraag"})
        quote.partner_id.write({"phone": "+31 20 2222222", "street": "Actueel klantadres 14"})
        self._product_lines(quote.sale_order_id)[:1].write({"price_unit": 765.43, "product_uom_qty": 2})
        quote._ensure_native_documents()
        self.assertEqual((quote.snapshot_json, quote.contact_json), before)
        self.assertEqual(quote.contact_phone, before[1]["phone"])
        self.assertEqual(quote.partner_id.phone, "+31 20 2222222")
        self.assertEqual(quote.sale_order_id.prefab_snapshot_total, before[0]["price"]["total"] / 100)
        self.assertNotEqual(quote.sale_order_id.amount_total, quote.amount_total)

    def test_confirmation_creates_native_project_preserves_crm_stage_and_schedules_responsible(self):
        quote = self._make_quote({"width": 500, "depth": 300})
        quote._ensure_native_documents()
        order = quote.sale_order_id
        stage = quote.lead_id.stage_id
        self.assertFalse(self._followup_activities(quote))
        order.with_context(send_email=False, mail_notify_force_send=False).action_confirm()
        self.assertEqual(order.state, "sale")
        project = order.project_id
        self.assertTrue(project)
        self.assertEqual(project.partner_id, quote.partner_id)
        self.assertEqual(project.company_id, self.company)
        self.assertEqual(project.sale_order_id, order)
        self.assertEqual(project.reinvoiced_sale_order_id, order)
        self.assertEqual(project.sale_line_id.order_id, order)
        self.assertEqual(project.sale_line_id.product_id.service_tracking, "project_only")
        self.assertEqual(project.user_id, self.sales_user)
        self.assertEqual(project.prefab_origin_ref, quote.name)
        self.assertEqual(quote.project_id, project)
        self.assertEqual(quote.lead_id.stage_id, stage)
        self.assertFalse(quote.lead_id.stage_id.is_won)
        activities = self._followup_activities(quote)
        self.assertEqual(len(activities), 1)
        self.assertEqual(activities.user_id, self.sales_user)
        self.assertTrue(order.prefab_crm_activity_created)

    def test_cancel_draft_reconfirm_reuses_project_and_does_not_recreate_completed_followup(self):
        quote = self._make_quote({"width": 500, "depth": 300})
        quote._ensure_native_documents()
        order = quote.sale_order_id.with_context(send_email=False, mail_notify_force_send=False)
        stage = quote.lead_id.stage_id
        order.action_confirm()
        project = order.project_id
        activity = self._followup_activities(quote)
        self.assertEqual(len(activity), 1)
        # Completion removes the activity record; a persistent marker must still prevent duplicates.
        activity.action_feedback(feedback="Technische vervolgstap is besproken.")
        self.assertFalse(self._followup_activities(quote))
        order._action_cancel()
        order.action_draft()
        self.assertEqual(order.state, "draft")
        order.action_confirm()
        self.assertEqual(order.project_id, project)
        self.assertEqual(project.sale_order_id, order)
        self.assertEqual(self.env["project.project"].search_count([("prefab_origin_ref", "=", quote.name)]), 1)
        self.assertTrue(order.prefab_crm_activity_created)
        self.assertFalse(self._followup_activities(quote))
        self.assertEqual(quote.lead_id.stage_id, stage)

    def test_submitted_row_models_are_read_only_private_and_bound_to_allowed_companies(self):
        own = self._make_quote(with_image=True)
        other = self._make_quote(with_image=True, company=self.other_company, website=self.other_website)
        own._ensure_native_documents()
        other._ensure_readable_rows()
        public = self.env.ref("base.public_user")
        for model_name, own_rows, other_rows in (
            ("cs.prefab.quote.selection", own.config_line_ids, other.config_line_ids),
            ("cs.prefab.quote.line", own.price_line_ids, other.price_line_ids),
            ("cs.prefab.quote.visual", own.visual_ids, other.visual_ids),
        ):
            with self.subTest(model=model_name):
                self.assertTrue(own_rows)
                self.assertTrue(other_rows)
                allowed = self.env[model_name].with_user(self.sales_user).with_context(allowed_company_ids=self.company.ids)
                visible = allowed.search([("quote_id", "in", [own.id, other.id])])
                self.assertEqual(set(visible.ids), set(own_rows.ids))
                self.assertTrue(allowed.browse(own_rows[:1].id).read(["name"]))
                with self.assertRaises(AccessError):
                    allowed.browse(other_rows[:1].id).read(["name"])
                with self.assertRaises((AccessError, UserError)):
                    allowed.browse(own_rows[:1].id).write({"name": "Forbidden"})
                with self.assertRaises(AccessError):
                    allowed.browse(own_rows[:1].id).unlink()
                with self.assertRaises(AccessError):
                    self.env[model_name].with_user(public).search([])
        with self.assertRaises(AccessError):
            other.with_user(self.sales_user).with_context(allowed_company_ids=self.company.ids).action_sync_native()

    def test_archived_prefab_product_keeps_request_with_teaching_error(self):
        first = self._make_quote()
        first._ensure_native_documents()
        template = first.sale_order_id.order_line.filtered("product_id")[:1].product_id.product_tmpl_id
        templates = self.env["product.template"].with_context(active_test=False).search_count([("prefab_item_key", "!=", False)])
        template.action_archive()
        second = self._make_quote()
        second._try_native_documents()
        self.assertTrue(second.exists())
        self.assertFalse(second.sale_order_id)
        self.assertIn("gearchiveerd", second.native_error)
        self.assertEqual(self.env["product.template"].with_context(active_test=False).search_count([("prefab_item_key", "!=", False)]), templates)

    def test_new_prefab_product_gets_default_vendor_once_only_when_purchasing_is_enabled(self):
        vendor = self.env["res.partner"].create({"name": "Prefab seed vendor " + uuid.uuid4().hex[:6], "is_company": True,
            "supplier_rank": 1, "email": False, "company_id": self.company.id})
        quote = self._make_quote()
        row = lambda: {"key": "seed-test-" + uuid.uuid4().hex, "unit": "stuk", "name": "Seed test: onderdeel"}
        self.company.write({"prefab_purchase_enabled": False, "prefab_purchase_vendor_id": vendor.id})
        disabled, _uom = quote._native_product(row(), self.tax)
        self.assertFalse(disabled.seller_ids)
        self.assertFalse(disabled.purchase_ok)
        self.assertFalse(disabled.prefab_purchase_seeded)
        self.company.prefab_purchase_enabled = True
        product, _uom = quote._native_product(row(), self.tax)
        self.assertTrue(product.purchase_ok and product.prefab_purchase_seeded)
        self.assertEqual(product.seller_ids.partner_id, vendor)
        self.assertEqual((product.seller_ids.price, product.seller_ids.min_qty, product.seller_ids.uom_id), (0, 0, product.uom_id))
        self.assertEqual(product.service_tracking, "no")
        product.seller_ids.unlink()
        product.product_tmpl_id._prefab_initialize_purchase_vendor()
        self.assertFalse(product.seller_ids, "A removed vendor row must not be restored.")

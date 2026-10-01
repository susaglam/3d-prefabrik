"""The office side of a prefab request: delete, follow-up fields, internal notes and the chatter.

Customer: "prefab modulumuzdeki teklifleri silemiyoruz. onlar icin silme eylemimiz yok. crud islemlerin hepsi olsun.
arka planda biz not ve gerekli bilgileride ekleyebilelim." The rights to delete already existed for sales managers;
both views hid the action. What the customer SUBMITTED stays frozen — the proposal, the CRM lead and the sale order
are built from it — and everything the office adds lives beside it.
"""
import uuid
from collections import deque

from lxml import etree

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import HttpCase, tagged
from odoo.tests.common import new_test_user

from ..controllers.main import LIMITER


@tagged("post_install", "-at_install")
class TestPrefabQuoteOffice(HttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.website = cls.env["website"].search([("company_id", "=", cls.env.company.id)], limit=1)
        cls.website.domain = cls.base_url()
        cls.manager = new_test_user(cls.env, login="prefab_office_manager", groups="sales_team.group_sale_manager")
        cls.salesperson = new_test_user(cls.env, login="prefab_office_sales", groups="sales_team.group_sale_salesman")

    def submitted_quote(self):
        # Same isolation as test_appearance: the 10-per-hour quote limiter is shared by the whole run.
        limiter = LIMITER._entries
        saved = {key: deque(queue) for key, queue in limiter.items()}
        self.addCleanup(lambda: (limiter.clear(), limiter.update(saved)))
        payload = {"config": {"width": 480, "depth": 280}, "consent": True, "idempotencyKey": str(uuid.uuid4()),
                   "contact": {"firstName": "Otto", "lastName": "Office", "email": "office-test@example.test",
                               "phone": "+31 6 12345678", "address": "Kantoorstraat", "houseNumber": "3",
                               "postcode": "1234 AB", "city": "Utrecht", "message": ""}}
        response = self.url_open("/prefab/api/quote", json=payload, headers={"Origin": self.base_url()})
        self.assertEqual(response.status_code, 201, response.text[:400])
        return self.env["cs.prefab.quote"].search([("name", "=", response.json()["reference"])])

    def test_the_views_offer_delete_the_office_fields_and_the_chatter(self):
        for view_id in ("cs_prefab_configurator.view_prefab_quote_list", "cs_prefab_configurator.view_prefab_quote_form"):
            arch = etree.fromstring(self.env.ref(view_id).arch.encode())
            self.assertEqual(arch.get("delete"), "true", f"{view_id}: the delete action is offered")
        form = etree.fromstring(self.env.ref("cs_prefab_configurator.view_prefab_quote_form").arch.encode())
        for name in ("user_id", "follow_up_date", "internal_note"):
            self.assertTrue(form.xpath(f"//field[@name='{name}']"), f"the form shows {name}")
        self.assertTrue(form.xpath("//chatter"), "the form has a chatter for notes, files and activities")
        action = self.env.ref("cs_prefab_configurator.action_prefab_quote")
        self.assertIn("Nieuwe aanvraag", action.help)
        opened = self.env["cs.prefab.quote"].action_open_configurator()
        self.assertEqual(opened["type"], "ir.actions.act_url")
        self.assertTrue(opened["url"].endswith("/prefab"))

    def test_a_manager_deletes_a_request_and_its_rows_go_with_it(self):
        quote = self.submitted_quote()
        lead, order = quote.lead_id, quote.sale_order_id
        children = {model: self.env[model].search_count([("quote_id", "=", quote.id)])
                    for model in ("cs.prefab.quote.selection", "cs.prefab.quote.line", "cs.prefab.quote.visual")}
        quote.with_user(self.manager).unlink()
        self.assertFalse(self.env["cs.prefab.quote"].search([("id", "=", quote.id)]))
        for model in children:
            self.assertEqual(self.env[model].search_count([("quote_id", "=", quote.id)]), 0, f"{model} rows go with it")
        # The CRM lead is the sales history and follows its own retention; a sale order only loses the link.
        self.assertTrue(lead.exists(), "the CRM lead stays")
        if order:
            self.assertTrue(order.exists())
            self.assertFalse(order.prefab_quote_id)

    def test_a_salesperson_follows_up_but_cannot_delete_or_rewrite_the_submission(self):
        quote = self.submitted_quote().with_user(self.salesperson)
        today = fields.Date.context_today(quote)
        quote.write({"user_id": self.salesperson.id, "follow_up_date": today, "state": "review",
                     "internal_note": "<p>Klant belt terug na de vakantie.</p>"})
        self.assertEqual(quote.user_id, self.salesperson)
        self.assertEqual(quote.follow_up_date, today)
        self.assertIn("vakantie", quote.internal_note)
        for frozen in ({"total_cents": 1}, {"snapshot_json": {}}, {"contact_json": {"name": "x"}}):
            with self.subTest(frozen=list(frozen)), self.assertRaises(UserError) as caught:
                quote.write(frozen)
            self.assertIn("liggen vast", str(caught.exception))
            self.assertIn("interne notities", str(caught.exception), "the refusal says what CAN be changed")
        with self.assertRaises(AccessError):
            quote.unlink()

    def test_the_chatter_keeps_notes_and_tracks_the_follow_up(self):
        quote = self.submitted_quote().with_user(self.salesperson)
        quote.message_post(body="Locatie bekeken, achterom is smal.", message_type="comment", subtype_xmlid="mail.mt_note")
        quote.write({"state": "contacted", "user_id": self.salesperson.id})
        self.env.flush_all()
        messages = quote.sudo().message_ids
        self.assertTrue(messages.filtered(lambda message: "achterom is smal" in (message.body or "")))
        # Which fields the chatter tracks is ours to declare; HOW Odoo stores a tracked change is not — on saas~19.4
        # mail.tracking.value lives in its own addon and mail.message no longer carries tracking_value_ids (the
        # first 2.10.0 clone run failed on exactly that). So the declaration is what is asserted.
        for name in ("state", "user_id", "follow_up_date"):
            self.assertTrue(quote._fields[name].tracking, f"{name} is tracked in the chatter")
        quote.activity_schedule("mail.mail_activity_data_todo", summary="Terugbellen", user_id=self.salesperson.id)
        self.assertEqual(quote.activity_ids.summary, "Terugbellen")

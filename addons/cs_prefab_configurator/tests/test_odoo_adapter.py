"""Actual Odoo/PostgreSQL integration tests, not exercised by standalone unittest."""
import uuid

from odoo.exceptions import AccessError, UserError
from odoo.tests import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestPrefabOdooAdapter(HttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.website = cls.env.ref("website.default_website")
        cls.website.domain = cls.base_url()

    def _payload(self):
        return {"config": {"width": 501, "depth": 299, "interior": True, "plaster": True},
                "contact": {"firstName": "Ada", "lastName": "Isolated test", "email": "odoo-test@example.test",
                    "phone": "+31 6 12345678", "address": "Teststraat", "houseNumber": "12", "postcode": "1234 AB", "city": "Utrecht", "message": "<script>test</script>"},
                "consent": True, "idempotencyKey": str(uuid.uuid4())}

    def _post(self, endpoint, payload):
        return self.url_open("/prefab/api/" + endpoint, json=payload, headers={"Origin": self.base_url()})

    def test_actual_http_crm_snapshot_idempotency_pdf_and_acl(self):
        payload = self._payload()
        response = self._post("quote", payload)
        self.assertEqual(response.status_code, 201, response.text[:500])
        result = response.json()
        record = self.env["cs.prefab.quote"].search([("name", "=", result["reference"])])
        self.assertEqual(len(record), 1)
        self.assertEqual(record.website_id, self.website)
        self.assertEqual(record.company_id, self.website.company_id)
        self.assertEqual(record.lead_id.company_id, self.website.company_id)
        self.assertEqual(record.lead_id.expected_revenue, 0)
        self.assertEqual(record.lead_id.email_from, payload["contact"]["email"])
        self.assertNotIn("<script>", str(record.lead_id.description))
        self.assertEqual(record.snapshot_json["price"]["total"], result["price"]["total"])
        self.assertEqual(record.snapshot_json["consent"]["accepted"], True)
        report_html, _ = self.env["ir.actions.report"]._render_qweb_html("cs_prefab_configurator.action_report_prefab_quote", [record.id])
        self.assertIn(result["reference"].encode(), report_html)
        self.assertIn(b"Demonstratieprijzen", report_html)
        repeated = self._post("quote", payload)
        self.assertEqual(repeated.status_code, 201, repeated.text[:500])
        self.assertEqual(repeated.json()["token"], result["token"])
        self.assertEqual(self.env["crm.lead"].search_count([("name", "ilike", result["reference"])]), 1)
        payload["contact"]["email"] = "different@example.test"
        conflict = self._post("quote", payload)
        self.assertEqual(conflict.status_code, 409, conflict.text[:500])
        self.assertNotIn(result["token"], conflict.text)
        pdf = self.url_open(result["pdfUrl"])
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.content.startswith(b"%PDF-1.4"))
        with self.assertRaises(UserError):
            record.write({"total_cents": 1})
        with self.assertRaises(AccessError):
            self.env["cs.prefab.quote"].with_user(self.env.ref("base.public_user")).search([])
        # Neither private PDFs nor share records become public through model ACLs.
        with self.assertRaises(AccessError):
            self.env["cs.prefab.share"].with_user(self.env.ref("base.public_user")).search([])

    def test_actual_http_share_and_cross_website_isolation(self):
        response = self._post("share", {"config": {"postcode": "1234 AB", "facade": "wood-vertical"}})
        self.assertEqual(response.status_code, 201, response.text[:500])
        token = response.json()["token"]
        shared = self.url_open(f"/prefab/api/share/{token}")
        self.assertEqual(shared.status_code, 200)
        self.assertEqual(shared.json()["config"]["postcode"], "")
        quote = self._post("quote", self._payload()).json()
        other_company = self.env["res.company"].create({"name": "Prefab isolated other company"})
        self.env["website"].create({"name": "Other isolated website", "domain": "http://other-prefab.test", "company_id": other_company.id})
        other = self.url_open(f"/prefab/api/share/{token}", headers={"Host": "other-prefab.test"})
        self.assertEqual(other.status_code, 404, other.text[:500])
        other_pdf = self.url_open(quote["pdfUrl"], headers={"Host": "other-prefab.test"})
        self.assertEqual(other_pdf.status_code, 404, other_pdf.text[:500])

    def test_actual_origin_validation_and_no_client_price(self):
        response = self.url_open("/prefab/api/price", json={"config": {}}, headers={"Origin": "https://attacker.example"})
        self.assertEqual(response.status_code, 403, response.text[:500])
        response = self._post("price", {"config": {}, "total": 1})
        self.assertEqual(response.status_code, 422)
        response = self._post("price", {"config": {"width": 751}})
        self.assertEqual(response.status_code, 422)
        response = self._post("price", {"config": {"interior": False, "plaster": True, "spotlights": 12}})
        self.assertEqual(response.status_code, 200, response.text[:500])
        self.assertFalse(response.json()["config"]["plaster"])
        self.assertEqual(response.json()["config"]["spotlights"], 0)

"""Actual Odoo/PostgreSQL integration tests, not exercised by standalone unittest."""
import base64
import copy
import io
import uuid

from lxml import html
from PIL import Image

from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import HttpCase, tagged
from odoo.tests.common import new_test_user

from ..services.configuration import document_config_key
from ..services.document_visuals import VIEW_LABELS


@tagged("post_install", "-at_install")
class TestPrefabOdooAdapter(HttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Restored and provisioned databases need not retain demo XML identifiers.
        cls.website = cls.env["website"].search([("company_id", "=", cls.env.company.id)], limit=1)
        if not cls.website:
            cls.website = cls.env["website"].create({"name": "Prefab HTTP test website", "company_id": cls.env.company.id})
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
        self.assertFalse(record.native_error)
        self.assertTrue(record.partner_id)
        self.assertTrue(record.sale_order_id.order_line)
        self.assertEqual(record.sale_order_id.opportunity_id, record.lead_id)
        self.assertEqual(record.sale_order_id.partner_id, record.partner_id)
        self.assertEqual(record.sale_order_id.state, "draft")
        self.assertEqual(record.lead_id.expected_revenue, 0)
        self.assertEqual(record.lead_id.email_from, payload["contact"]["email"])
        self.assertNotIn("<script>", str(record.lead_id.description))
        self.assertEqual(record.snapshot_json["price"]["total"], result["price"]["total"])
        self.assertEqual(record.snapshot_json["consent"]["accepted"], True)
        report_html, _ = self.env["ir.actions.report"]._render_qweb_html("cs_prefab_configurator.action_report_prefab_quote", [record.id])
        self.assertIn(result["reference"].encode(), report_html)
        self.assertIn(b"Demonstratieprijzen", report_html)
        self.assertIn(b"geen ontwerpbeelden opgeslagen", report_html)
        self.assertNotIn(b"Jouw ontwerp in 3D", report_html)
        self.assertIn(b"Eenheidsprijs", report_html)
        self.assertIn(b"Gevel en dakrand", report_html)
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

    def test_actual_visual_snapshot_and_qweb_dossier(self):
        payload = self._payload()
        image = io.BytesIO()
        Image.new("RGB", (640, 400), "#f6f5f1").save(image, format="JPEG")
        data_url = "data:image/jpeg;base64," + base64.b64encode(image.getvalue()).decode("ascii")
        # The key must match the catalogue the website actually serves (a stored publication, not the shipped file).
        canonical = self._post("price", {"config": payload["config"]}).json()["config"]
        payload["visuals"] = {
            "version": 1,
            "configKey": document_config_key(canonical),
            "views": [{"id": key, "label": "Ignored browser label", "width": 640, "height": 400,
                       "dataUrl": data_url} for key in VIEW_LABELS],
            "missingViews": [],
        }
        response = self._post("quote", payload)
        self.assertEqual(response.status_code, 201, response.text[:500])
        result = response.json()
        record = self.env["cs.prefab.quote"].search([("name", "=", result["reference"])])
        stored_views = record.snapshot_json["visuals"]["views"]
        self.assertEqual(len(stored_views), 6)
        report_html, _ = self.env["ir.actions.report"]._render_qweb_html(
            "cs_prefab_configurator.action_report_prefab_quote", [record.id])
        document = html.fromstring(report_html)
        pictures = document.xpath('//img[starts-with(@src,"data:image/jpeg;base64,")]')
        self.assertEqual(len(pictures), 6)
        self.assertEqual({pic.get("alt") for pic in pictures}, set(VIEW_LABELS.values()))
        self.assertEqual({pic.get("src") for pic in pictures}, {view["dataUrl"] for view in stored_views})
        self.assertNotIn(b"Ignored browser label", report_html)
        self.assertIn(b"Technisch ontwerpoverzicht", report_html)
        self.assertIn(b"Jouw ontwerp in 3D", report_html)
        self.assertIn(b"geen vaste afdrukschaal", report_html)
        self.assertIn(b"&lt;script&gt;test&lt;/script&gt;", report_html)
        price = record.snapshot_json["price"]
        total = "{:,.2f}".format(price["total"] / 100).replace(",", "~").replace(".", ",").replace("~", ".")
        self.assertIn(total, document.text_content())
        self.assertEqual(len(document.xpath('//div[@class="page"]')), 6)
        report = self.env.ref("cs_prefab_configurator.action_report_prefab_quote")
        self.assertEqual(report.paperformat_id.format, "A4")
        # Odoo otherwise intentionally returns HTML while tests are enabled.
        # Exercise the real installed PDF engine, without mocking or new packages.
        report_pdf, report_type = self.env["ir.actions.report"].with_context(force_report_rendering=True)._render_qweb_pdf(
            "cs_prefab_configurator.action_report_prefab_quote", res_ids=[record.id])
        self.assertEqual(report_type, "pdf")
        self.assertTrue(report_pdf.startswith(b"%PDF"))
        self.assertGreater(len(report_pdf), 10 * 1024)

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

    def test_published_catalog_scope_freeze_retry_and_republication(self):
        release = self.env["cs.prefab.catalog.release"].create({"name": "Scope integration v1", "website_id": self.website.id, "company_id": self.website.company_id.id})
        heating = release.option_ids.filtered(lambda o: o.key == "heating" and o.value_key == "*")
        product = heating.component_ids.filtered(lambda c: c.role == "product")
        product.write({"status": "included"})
        release.action_publish()
        public = self.url_open("/prefab/api/catalog").json()
        self.assertEqual(public["catalogRevision"], release.revision)
        request_payload = self._payload()
        request_payload["config"]["heating"] = "left"
        request_payload["catalogRevision"] = release.revision
        response = self._post("quote", request_payload)
        self.assertEqual(response.status_code, 201, response.text[:500])
        result = response.json()
        item = next(i for i in result["price"]["scope"] if i["key"] == "heating")
        self.assertTrue(item["productIncluded"])
        self.assertEqual(next(c for c in item["components"] if c["role"] == "product")["total"], 0)
        quote = self.env["cs.prefab.quote"].search([("name", "=", result["reference"])])
        self.assertIn("Product: inbegrepen in casco", str(quote.lead_id.description))
        self.assertEqual(quote.catalog_revision, release.revision)
        report_html, _ = self.env["ir.actions.report"]._render_qweb_html("cs_prefab_configurator.action_report_prefab_quote", [quote.id])
        self.assertIn(b"Product: inbegrepen in casco", report_html)
        original_snapshot = copy.deepcopy(quote.snapshot_json)
        for record, values in ((release, {"name": "Changed"}), (heating, {"visual_mode": "none"}), (product, {"status": "extra"})):
            with self.assertRaises(UserError):
                record.write(values)
        with self.assertRaises(UserError):
            product.unlink()
        action = release.action_new_draft()
        next_release = self.env["cs.prefab.catalog.release"].browse(action["res_id"])
        book = dict(next_release.pricebook_json, basePerM2=next_release.pricebook_json["basePerM2"] + 100000)
        next_release.pricebook_json = book
        next_release.action_publish()
        self.assertEqual(release.state, "retired")
        stale = self._post("price", {"config": {}, "catalogRevision": release.revision})
        self.assertEqual(stale.status_code, 409, stale.text[:500])
        self.assertEqual(stale.json()["error"]["code"], "catalog_changed")
        repeated = self._post("quote", request_payload)
        self.assertEqual(repeated.status_code, 201, repeated.text[:500])
        self.assertEqual(repeated.json(), result)
        self.assertEqual(quote.snapshot_json, original_snapshot)
        self.assertGreater(self._post("price", {"config": request_payload["config"]}).json()["total"], result["price"]["total"])

    def test_catalog_roles_and_other_website_fallback(self):
        sales = new_test_user(self.env, login="prefab_catalog_sales", groups="sales_team.group_sale_salesman")
        manager = new_test_user(self.env, login="prefab_catalog_manager", groups="sales_team.group_sale_manager")
        release = self.env["cs.prefab.catalog.release"].with_user(manager).create({"name": "Manager publication", "website_id": self.website.id, "company_id": self.website.company_id.id})
        self.assertTrue(release.with_user(sales).read(["name"]))
        with self.assertRaises(AccessError):
            release.with_user(sales).action_publish()
        for model in ("cs.prefab.catalog.release", "cs.prefab.catalog.option", "cs.prefab.catalog.component"):
            with self.assertRaises(AccessError):
                self.env[model].with_user(self.env.ref("base.public_user")).search([])
        release.action_publish()
        other = self.env["website"].create({"name": "Catalog isolated site", "domain": "http://catalog-other-prefab.test", "company_id": self.website.company_id.id})
        response = self.url_open("/prefab/api/catalog", headers={"Host": "catalog-other-prefab.test"})
        self.assertEqual(response.status_code, 200, response.text[:500])
        self.assertNotEqual(response.json()["catalogRevision"], release.revision)
        self.assertTrue(response.json()["catalogRevision"].startswith("local-"))

    def test_commercial_approval_is_explicit_scoped_and_invalidated_by_changes(self):
        release = self.env["cs.prefab.catalog.release"].create({"name": "ISOLATED commercial approval test", "website_id": self.website.id,
            "company_id": self.website.company_id.id, "price_mode": "commercial"})
        release.action_validate_draft()
        self.assertIn("Nog nodig", release.validation_summary)
        with self.assertRaises(UserError):
            release.action_approve_commercial()
        with self.assertRaises(UserError):
            release.write({"approval_hash": "forged"})
        release.write({"pricebook_json": dict(release.pricebook_json, pricebookVersion="ISOLATED-TEST-RATES"),
            "commercial_reference": "ISOLATED FIXTURE — not real business approval", "commercial_terms": "Testtarieven; definitieve offerte en technische beoordeling volgen.",
            "commercial_rates_confirmed": True, "commercial_scope_confirmed": True, "commercial_tax_confirmed": True})
        release.action_approve_commercial()
        self.assertEqual(release.commercial_approval_state, "approved")
        first_hash = release.approval_hash
        other_site = self.env["website"].create({"name": "Approval scope fixture", "company_id": self.website.company_id.id})
        release.website_id = other_site
        self.assertEqual(release.commercial_approval_state, "pending")
        self.assertNotEqual(release._content_bundle()["revision"], first_hash)
        release.website_id = self.website
        self.assertEqual(release.commercial_approval_state, "pending")  # reverting does not restore approval
        release.action_approve_commercial()
        other_company = self.env["res.company"].create({"name": "Approval company fixture"})
        other_company_site = self.env["website"].create({"name": "Approval other company website", "company_id": other_company.id})
        release.write({"company_id": other_company.id, "website_id": other_company_site.id})
        self.assertEqual(release.commercial_approval_state, "pending")
        release.write({"company_id": self.website.company_id.id, "website_id": self.website.id})
        release.action_approve_commercial()
        component = release.option_ids.filtered(lambda o: o.key == "heating" and o.value_key == "*").component_ids.filtered(lambda c: c.role == "product")
        component.status = "included"
        self.assertEqual(release.commercial_approval_state, "pending")
        with self.assertRaises(ValidationError):
            release.action_publish()
        release.action_approve_commercial()
        release.action_publish()
        public = self.url_open("/prefab/api/catalog").json()
        self.assertEqual(public["priceMode"], "commercial")
        self.assertEqual(public["priceStatusLabel"], "Prijsindicatie op goedgekeurde tarieven")
        result = self._post("quote", dict(self._payload(), catalogRevision=release.revision)).json()
        quote = self.env["cs.prefab.quote"].search([("name", "=", result["reference"])])
        self.assertEqual(quote.snapshot_json["commercialApproval"]["contentRevision"], release.approval_hash)
        self.assertAlmostEqual(quote.lead_id.expected_revenue, result["price"]["subtotal"] / 100)
        self.assertNotIn("Demonstratieprijzen", str(quote.lead_id.description))
        rendered, _ = self.env["ir.actions.report"]._render_qweb_html("cs_prefab_configurator.action_report_prefab_quote", [quote.id])
        self.assertIn(b"Prijsindicatie op goedgekeurde tarieven", rendered)
        self.assertIn(b"Testtarieven", rendered)
        self.assertNotIn(b"Demonstratieprijzen", rendered)

    def test_authenticated_draft_preview_has_no_public_write_or_cross_site_access(self):
        release = self.env["cs.prefab.catalog.release"].create({"name": "ISOLATED PRIVATE PREVIEW", "website_id": self.website.id, "company_id": self.website.company_id.id})
        public_before = self.url_open("/prefab/api/catalog").json()["catalogRevision"]
        endpoint = f"/prefab/admin-preview/{release.id}"
        anonymous = self.url_open(endpoint + "/catalog")
        self.assertNotIn(release.name, anonymous.text)
        sales = new_test_user(self.env, login="prefab_preview_sales", password="isolated-preview-password", groups="sales_team.group_sale_salesman")
        manager = new_test_user(self.env, login="prefab_preview_manager", password="isolated-preview-password", groups="sales_team.group_sale_manager")
        self.authenticate(sales.login, "isolated-preview-password")
        self.assertEqual(self.url_open(endpoint + "/catalog").status_code, 403)
        self.authenticate(manager.login, "isolated-preview-password")
        response = self.url_open(endpoint + "/catalog")
        self.assertEqual(response.status_code, 200, response.text[:500])
        draft = response.json()
        self.assertTrue(draft["preview"]["enabled"])
        self.assertFalse(draft["preview"]["canSubmit"])
        self.assertTrue(draft["catalogRevision"].startswith(f"draft-{release.id}-"))
        priced = self.url_open(endpoint + "/price", json={"config": {}, "catalogRevision": draft["catalogRevision"]}, headers={"Origin": self.base_url()})
        self.assertEqual(priced.status_code, 200, priced.text[:500])
        self.assertEqual(priced.json()["catalogRevision"], draft["catalogRevision"])
        quotes_before = self.env["cs.prefab.quote"].search_count([])
        forbidden = self.url_open(endpoint + "/quote", json=self._payload(), headers={"Origin": self.base_url()})
        self.assertEqual(forbidden.status_code, 403)
        self.assertEqual(self.env["cs.prefab.quote"].search_count([]), quotes_before)
        release.pricebook_json = dict(release.pricebook_json, fixedSetup=release.pricebook_json["fixedSetup"] + 100)
        stale = self.url_open(endpoint + "/price", json={"config": {}, "catalogRevision": draft["catalogRevision"]}, headers={"Origin": self.base_url()})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["error"]["code"], "catalog_changed")
        self.assertEqual(self.url_open("/prefab/api/catalog").json()["catalogRevision"], public_before)
        other_site = self.env["website"].create({"name": "Other private preview site", "company_id": self.website.company_id.id})
        other_release = self.env["cs.prefab.catalog.release"].create({"name": "Other private preview", "website_id": other_site.id, "company_id": self.website.company_id.id})
        self.assertEqual(self.url_open(f"/prefab/admin-preview/{other_release.id}/catalog").status_code, 404)
        release.action_publish()
        self.assertEqual(self.url_open(endpoint + "/catalog").status_code, 409)

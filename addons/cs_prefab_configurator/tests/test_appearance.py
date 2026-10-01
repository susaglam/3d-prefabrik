"""Native appearance forms, company isolation, CSS-only theme bridge and the proposal logo."""
import base64
import io
import random
import uuid
from collections import deque

from lxml import html
from PIL import Image

from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import Form, HttpCase, tagged
from odoo.tests.common import new_test_user

from ..controllers.main import LIMITER
from ..services.pdf_image import MAX_BYTES, pdf_image
from ..services.scene_content import BROWSER_KEYS, EXTRAS as SCENE_EXTRAS


def png_bytes(width=240, height=80, *, color=(0xE9, 0x00, 0x7A, 0xFF), noise=False):
    if noise:
        image = Image.frombytes("RGBA", (width, height), random.Random(7).randbytes(width * height * 4))
    else:
        image = Image.new("RGBA", (width, height), color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@tagged("post_install", "-at_install")
class TestPrefabAppearance(HttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.website = cls.env["website"].search([("company_id", "=", cls.env.company.id)], limit=1)
        cls.website.domain = cls.base_url()

    def appearance(self):
        return self.env["cs.prefab.appearance"].search([("website_id", "=", self.website.id)], limit=1) or self.env["cs.prefab.appearance"].create({"website_id": self.website.id})

    def submitted_quote(self):
        # The quote limiter (10 per hour per client, controllers/main.py LIMITER) is shared by every test in the run,
        # and all of them come from 127.0.0.1. Its state is put back after this test, so a submission made here never
        # eats the budget of a later test — the 2.9.7 clone run failed on exactly that: a 429 in test_odoo_adapter
        # three tests after this class had submitted three quotes. The production limit itself is untouched.
        limiter = LIMITER._entries
        saved = {key: deque(queue) for key, queue in limiter.items()}
        self.addCleanup(lambda: (limiter.clear(), limiter.update(saved)))
        payload = {"config": {"width": 501, "depth": 299}, "consent": True, "idempotencyKey": str(uuid.uuid4()),
                   "contact": {"firstName": "Ada", "lastName": "Logo", "email": "logo-test@example.test",
                               "phone": "+31 6 12345678", "address": "Teststraat", "houseNumber": "12",
                               "postcode": "1234 AB", "city": "Utrecht", "message": ""}}
        response = self.url_open("/prefab/api/quote", json=payload, headers={"Origin": self.base_url()})
        self.assertEqual(response.status_code, 201, response.text[:400])
        result = response.json()
        return self.env["cs.prefab.quote"].search([("name", "=", result["reference"])]), result["token"]

    def report_html(self, record):
        rendered, _ = self.env["ir.actions.report"]._render_qweb_html("cs_prefab_configurator.action_report_prefab_quote", [record.id])
        return rendered

    def test_native_editor_public_read_and_catalog_independence(self):
        release = self.env["cs.prefab.catalog.release"].search([("website_id", "=", self.website.id), ("state", "=", "published")], limit=1)
        before = release._content_bundle() if release else None
        record = self.appearance()
        with Form(record) as form:
            form.mode = "custom"
            form.color_action = "#43285f"
            form.font_size = 18
        response = self.url_open("/prefab/api/appearance")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["colors"]["action"], "#43285f")
        self.assertEqual(response.json()["fontSize"], 18)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        if release:
            self.assertEqual(release._content_bundle(), before)
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            record.write({"color_text": "#ffffff"})

    def test_compare_flag_defaults_off_and_reaches_public_api_when_enabled(self):
        # Default from the field: the clone runs on production data, where the flag may already be on.
        self.assertIs(self.env["cs.prefab.appearance"].default_get(["compare_enabled"])["compare_enabled"], False)
        record = self.appearance()
        record.compare_enabled = False
        self.assertIs(self.url_open("/prefab/api/appearance").json()["compareEnabled"], False)
        with Form(record) as form:
            form.compare_enabled = True
        payload = self.url_open("/prefab/api/appearance").json()
        self.assertIs(payload["compareEnabled"], True)
        # Toggling the flag is independent of the visual mode and still validates.
        self.assertEqual(payload["mode"], record.mode)
        with Form(record) as form:
            form.compare_enabled = False
        self.assertIs(self.url_open("/prefab/api/appearance").json()["compareEnabled"], False)

    def test_the_garden_fence_switch_defaults_on_and_reaches_the_public_api(self):
        # 2.11.0, the customer: "bahçe çitini tamamen kaldırmak için adminde bir ayar koyalım".
        # The defaults are read from the field, not from the record: the clone runs on a copy of production, where an
        # administrator may already have switched the schutting off (the 2.12.0 clone run failed on exactly that).
        defaults = self.env["cs.prefab.appearance"].default_get(["garden_fence", "garden_fence_style"])
        self.assertIs(defaults["garden_fence"], True)
        # 2.12.0: the default boundary style, modern until an administrator picks another.
        self.assertEqual(defaults["garden_fence_style"], "modern")
        record = self.appearance()
        with Form(record) as form:
            form.garden_fence = True
            form.garden_fence_style = "modern"
        self.assertIs(self.url_open("/prefab/api/appearance").json()["gardenFence"], True)
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["gardenFenceStyle"], "modern")
        with Form(record) as form:
            form.garden_fence_style = "hedge"
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["gardenFenceStyle"], "hedge")
        with Form(record) as form:
            form.garden_fence = False
        self.assertIs(self.url_open("/prefab/api/appearance").json()["gardenFence"], False)

    def test_free_orbit_is_off_until_an_administrator_asks_for_it(self):
        # 2.14.0: the visitor stays on the garden side of the house unless Vormgeving says otherwise.
        self.assertIs(self.env["cs.prefab.appearance"].default_get(["camera_free_orbit"])["camera_free_orbit"], False)
        record = self.appearance()
        record.camera_free_orbit = False
        self.assertIs(self.url_open("/prefab/api/appearance").json()["cameraFreeOrbit"], False)
        with Form(record) as form:
            form.camera_free_orbit = True
        self.assertIs(self.url_open("/prefab/api/appearance").json()["cameraFreeOrbit"], True)

    def test_the_binnenweergave_is_empty_until_an_administrator_asks_for_furniture(self):
        # 2.14.1: the example furniture is not drawn while the visitor looks from inside.
        self.assertIs(self.env["cs.prefab.appearance"].default_get(["interior_furniture"])["interior_furniture"], False)
        record = self.appearance()
        record.interior_furniture = False
        self.assertIs(self.url_open("/prefab/api/appearance").json()["interiorFurniture"], False)
        with Form(record) as form:
            form.interior_furniture = True
        self.assertIs(self.url_open("/prefab/api/appearance").json()["interiorFurniture"], True)

    def test_the_exit_address_is_served_and_a_script_address_cannot_be_saved(self):
        # 2.11.0: the logo leads back to the website, or to the address an embedding website names. The value
        # becomes a navigation target in the visitor's browser, so a javascript: address is refused on save.
        # Default from the field (production may already carry an address of its own), then served as saved.
        self.assertEqual(self.env["cs.prefab.appearance"].default_get(["exit_url"])["exit_url"], "/")
        record = self.appearance()
        record.exit_url = "/"
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["exitUrl"], "/")
        with Form(record) as form:
            form.exit_url = "https://www.voorbeeld.nl/aanbouw"
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["exitUrl"], "https://www.voorbeeld.nl/aanbouw")
        for bad in ("javascript:alert(1)", "//elders.example", "www.voorbeeld.nl"):
            # The savepoint rolls the refused write back, so the next attempt starts from the saved record.
            with self.subTest(bad=bad), self.assertRaises(ValidationError), self.env.cr.savepoint():
                record.write({"exit_url": bad})
            record.invalidate_recordset()
        self.assertEqual(record.exit_url, "https://www.voorbeeld.nl/aanbouw")
        record.exit_url = False
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["exitUrl"], "")

    def test_every_illustrative_extra_has_its_own_switch_and_reaches_the_public_api(self):
        """One switch per extra, changed on the record and read back from the page the visitor is served."""
        record = self.appearance()
        served = self.url_open("/prefab/api/appearance").json()["sceneContent"]
        self.assertEqual(served, {"fixtures": "on", "garden": "on", "neighbours": "on",
                                  "interior": "on", "houseOpenings": "on"},
                         "a website that has never been configured shows everything, as it always has")
        for extra in SCENE_EXTRAS:
            self.assertEqual(record[extra["field"]], "on", extra["field"])
            for mode in ("hidden", "off", "on"):
                with self.subTest(field=extra["field"], mode=mode):
                    with Form(record) as form:
                        setattr(form, extra["field"], mode)
                    payload = self.url_open("/prefab/api/appearance").json()
                    scene = payload["sceneContent"]
                    self.assertEqual(scene[BROWSER_KEYS[extra["key"]]], mode)
                    # Switching one extra moves nothing else, and no colour, font or flag travels with it.
                    self.assertEqual({key: value for key, value in scene.items()
                                      if key != BROWSER_KEYS[extra["key"]]},
                                     {key: "on" for key in scene if key != BROWSER_KEYS[extra["key"]]})
                    self.assertEqual(payload["mode"], record.mode)
                    self.assertIs(payload["compareEnabled"], record.compare_enabled)

    def test_the_record_reads_back_what_a_visitor_will_and_will_not_see(self):
        """A switch that silently does nothing is the one failure this feature may not have."""
        record = self.appearance()
        self.assertEqual(record.scene_note, "Alle voorbeelden worden getoond.")
        record.write({"scene_garden": "hidden", "scene_neighbours": "hidden", "scene_interior": "off"})
        self.assertIn("Uitgeschakeld: Tuinaankleding, Buurhuizen.", record.scene_note)
        self.assertIn("Standaard uit", record.scene_note)
        self.assertIn("Inrichting", record.scene_note)
        # And it is a read-back, not a wish: the page serves exactly what the note claims.
        scene = self.url_open("/prefab/api/appearance").json()["sceneContent"]
        self.assertEqual([scene["garden"], scene["neighbours"], scene["interior"]], ["hidden", "hidden", "off"])

    def test_an_unknown_mode_cannot_be_saved_and_the_scene_policy_survives_a_colour_change(self):
        record = self.appearance()
        # The ORM refuses an unknown Selection value before the constraint ever runs; either refusal is the answer
        # this test wants, which is that it cannot be saved.
        with self.assertRaises((ValueError, ValidationError)), self.env.cr.savepoint():
            record.write({"scene_garden": "maybe"})
        record.write({"scene_garden": "hidden"})
        # Editing the colours must not reset the scene, and a refused colour must not strand a saved switch.
        with Form(record) as form:
            form.mode = "custom"
            form.color_action = "#43285f"
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["sceneContent"]["garden"], "hidden")
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            record.write({"color_text": "#ffffff"})
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["sceneContent"]["garden"], "hidden")

    def test_the_scene_policy_is_per_website_and_never_leaks_between_companies(self):
        record = self.appearance()
        record.write({"scene_fixtures": "hidden"})
        other_company = self.env["res.company"].create({"name": "Scene isolated company"})
        other_site = self.env["website"].create({"name": "Scene isolated website", "company_id": other_company.id})
        self.env["cs.prefab.appearance"].create({"website_id": other_site.id, "scene_fixtures": "on",
                                                 "scene_garden": "hidden"})
        scene = self.url_open("/prefab/api/appearance").json()["sceneContent"]
        self.assertEqual(scene["fixtures"], "hidden", "this website's own setting")
        self.assertEqual(scene["garden"], "on", "the other website's setting stays there")

    def test_public_cannot_edit_and_managers_are_company_scoped(self):
        record = self.appearance()
        with self.assertRaises(AccessError):
            record.with_user(self.env.ref("base.public_user")).write({"mode": "odoo"})
        manager = new_test_user(self.env, login="prefab_appearance_manager", groups="sales_team.group_sale_manager")
        record.with_user(manager).write({"mode": "odoo"})
        other_company = self.env["res.company"].create({"name": "Appearance isolated company"})
        other_site = self.env["website"].create({"name": "Appearance isolated website", "company_id": other_company.id})
        other = self.env["cs.prefab.appearance"].create({"website_id": other_site.id, "mode": "custom", "color_action": "#112233"})
        self.assertNotIn(other, self.env["cs.prefab.appearance"].with_user(manager).search([]))
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["mode"], "odoo")
        self.assertNotEqual(self.url_open("/prefab/api/appearance").json()["colors"]["action"], "#112233")

    def test_logo_defaults_to_the_company_logo_with_or_without_a_vormgeving(self):
        """The customer's report: "pdf logo hala odoodan almiyor". Since 2.9.7 the Odoo company logo is the default,
        and a website that never saved a vormgeving gets it too — that was the case that printed CS prefab."""
        company = self.website.company_id
        original = company.logo.to_base64() if company.logo else False
        company.logo = base64.b64encode(png_bytes(300, 100)).decode("ascii")
        try:
            quote, _token = self.submitted_quote()
            self.env["cs.prefab.appearance"].search([("website_id", "=", self.website.id)]).unlink()
            mark = quote._proposal_logo()
            self.assertTrue(mark, "no vormgeving record: still the company logo, not the wordmark")
            self.assertEqual((mark["width"], mark["height"]), (300, 100))
            self.assertNotIn(b"RUIMTE OM TE LEVEN", self.report_html(quote))
            record = self.appearance()
            self.assertEqual(record.logo_source, "odoo")
            self.assertEqual(record._proposal_logo()["dataUrl"], mark["dataUrl"])
            self.assertTrue(record.logo_preview)
            # No logo at all: the company's NAME is printed, never somebody else's wordmark.
            company.logo = False
            record.invalidate_recordset()
            self.assertIsNone(quote._proposal_logo())
            report = self.report_html(quote)
            self.assertIn(company.name.encode(), report)
            self.assertNotIn(b"RUIMTE OM TE LEVEN", report)
            self.assertIn("bedrijfsnaam", record.logo_note)
            # And the wordmark still prints when an administrator chooses it on purpose.
            record.logo_source = "wordmark"
            self.env.flush_all()
            self.assertIn(b"RUIMTE OM TE LEVEN", self.report_html(quote))
        finally:
            company.logo = original

    def test_an_svg_company_logo_is_rasterised_so_the_pdf_can_print_it(self):
        """Production's own company logo is image/svg+xml at every size Odoo keeps, and the proposal PDF embeds only
        PNG and JPEG — that, not a setting, is why the proposal never showed the Odoo logo. The image this runs in
        ships wkhtmltoimage (Odoo's report renderer), which turns it into pixels."""
        record, company = self.appearance(), self.website.company_id
        original = company.logo.to_base64() if company.logo else False
        svg = (b'<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100">'
               b'<rect width="600" height="100" fill="#e9521d"/><rect width="100" height="100" fill="#1a1a1a"/></svg>')
        try:
            company.logo = base64.b64encode(svg).decode("ascii")
            record.invalidate_recordset()
            mark = record._proposal_logo()
            self.assertTrue(mark, "an SVG company logo reaches the proposal as pixels")
            self.assertEqual(mark["type"], "png")
            self.assertAlmostEqual(mark["width"] / mark["height"], 6.0, delta=.1, msg="the drawing keeps its proportions")
            self.assertTrue(record.logo_preview)
            quote, token = self.submitted_quote()
            response = self.url_open(f"/prefab/api/quote/{token}/pdf")
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"/Subtype /Image", response.content, "the rasterised logo is embedded in the PDF")
            self.assertIn(mark["dataUrl"].encode(), self.report_html(quote))
        finally:
            company.logo = original

    def test_the_report_prints_in_the_vormgeving_or_the_odoo_document_colours(self):
        record, company = self.appearance(), self.website.company_id
        quote, token = self.submitted_quote()
        record.write({"mode": "custom", "color_action": "#8a2c0f", "color_heading": "#1b2a4a"})
        self.env.flush_all()
        report = self.report_html(quote)
        self.assertIn(b"#8a2c0f", report)
        self.assertIn(b"#1b2a4a", report)
        self.assertNotIn(b"#a36640", report, "the old hard-coded copper is gone from the stylesheet")
        # Odoo mode: the document layout colours (Instellingen -> Documentlay-out) win where they are set.
        original = (company.primary_color, company.secondary_color)
        company.write({"primary_color": "#0f5c8a", "secondary_color": "#1f2d3a"})
        try:
            record.mode = "odoo"
            self.env.flush_all()
            palette = quote._proposal_palette()
            self.assertEqual(palette["colors"]["accent"], "#0f5c8a")
            self.assertEqual(palette["source"]["accent"], "odoo")
            self.assertIn(b"#0f5c8a", self.report_html(quote))
            # The public PDF endpoint carries the same palette into the hand-composed PDF.
            response = self.url_open(f"/prefab/api/quote/{token}/pdf")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["Content-Type"], "application/pdf")
            # An unreadable brand colour never reaches paper: that slot falls back, the others stay.
            company.primary_color = "#ffe066"
            palette = quote._proposal_palette()
            self.assertNotEqual(palette["colors"]["accent"], "#ffe066")
            self.assertEqual(palette["colors"]["ink"], "#1f2d3a")
            self.assertTrue(palette["notes"])
        finally:
            company.write({"primary_color": original[0], "secondary_color": original[1]})

    def test_the_three_proposal_image_parts_reach_the_public_api(self):
        record = self.appearance()
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["documentParts"],
                         {"slab": True, "terrace": True, "houseRoom": True})
        record.write({"document_terrace": False, "document_house_room": False})
        self.env.flush_all()
        self.assertEqual(self.url_open("/prefab/api/appearance").json()["documentParts"],
                         {"slab": True, "terrace": False, "houseRoom": False})
        self.assertIn("de betonvloer eronder", record.document_note)
        self.assertNotIn("terras naar de tuin", record.document_note)
        record.document_surroundings = True
        self.assertIn("voorbeeldtuin", record.document_note)

    def test_the_odoo_company_logo_is_used_and_falls_back_when_it_is_absent(self):
        record, company = self.appearance(), self.website.company_id
        # Capture the image itself, not the lazy handle: a Binary read returns a BinaryValue bound to the
        # attachment behind it, and the writes below replace that attachment, so a stale handle restores nothing.
        original = company.logo.to_base64() if company.logo else False
        company.logo = base64.b64encode(png_bytes(320, 90)).decode("ascii")
        record.logo_source = "odoo"
        mark = record._proposal_logo()
        self.assertEqual((mark["width"], mark["height"], mark["type"]), (320, 90, "png"))
        self.assertEqual(mark["alt"], company.name)
        self.assertTrue(record.logo_preview)
        self.assertIn("320 × 90 px", record.logo_note)
        # A logo too large for a proposal header uses the smaller variant Odoo already keeps.
        company.logo = base64.b64encode(png_bytes(1800, 1800)).decode("ascii")
        record.invalidate_recordset()
        large = record._proposal_logo()
        self.assertTrue(large)
        self.assertLessEqual(large["width"], 1024)
        # An empty company logo is not an error: the proposal prints the company name instead.
        company.logo = False
        record.invalidate_recordset()
        self.assertIsNone(record._proposal_logo())
        self.assertIn("nog geen logo in Odoo", record.logo_note)
        self.assertIn("bedrijfsnaam", record.logo_note)
        company.logo = original

    def test_an_uploaded_logo_reaches_the_pdf_endpoint_and_the_qweb_report(self):
        record, upload = self.appearance(), png_bytes(240, 80)
        record.write({"logo_source": "upload", "logo_image": base64.b64encode(upload).decode("ascii"), "logo_filename": "merk.png"})
        self.env.flush_all()
        mark = record._proposal_logo()
        self.assertEqual((mark["width"], mark["height"]), (240, 80))
        self.assertIn("240 × 80 px", record.logo_note)
        quote, token = self.submitted_quote()
        self.assertEqual(quote._proposal_logo()["dataUrl"], mark["dataUrl"])
        report = self.report_html(quote)
        self.assertIn(mark["dataUrl"].encode(), report)
        self.assertNotIn(b"RUIMTE OM TE LEVEN", report)
        response = self.url_open(f"/prefab/api/quote/{token}/pdf")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Type"], "application/pdf")
        self.assertIn(pdf_image(upload, filename="merk.png")["stream"], response.content)
        # Back to the wordmark: the same request, same document, built-in mark.
        record.logo_source = "wordmark"
        self.env.flush_all()
        self.assertIn(b"RUIMTE OM TE LEVEN", self.report_html(quote))
        self.assertNotIn(pdf_image(upload, filename="merk.png")["stream"],
                         self.url_open(f"/prefab/api/quote/{token}/pdf").content)

    def test_a_refused_upload_explains_what_failed_why_and_how_to_repair_it(self):
        record = self.appearance()
        cases = {
            "te groot": (png_bytes(400, 400, noise=True), "merk.png", str(MAX_BYTES // 1024) + " kB"),
            "svg": (b"<svg xmlns='http://www.w3.org/2000/svg'><rect width='9' height='9'/></svg>", "merk.svg", "PNG"),
            "onbekend": (b"GIF89a" + b"\x00" * 64, "merk.gif", "merk.gif"),
            "te veel pixels": (png_bytes(1700, 200), "merk.png", "1600 px"),
        }
        for label, (data, filename, expected) in cases.items():
            with self.subTest(case=label), self.assertRaises(ValidationError) as caught, self.env.cr.savepoint():
                record.write({"logo_source": "upload", "logo_image": base64.b64encode(data).decode("ascii"), "logo_filename": filename})
            self.assertIn(expected, str(caught.exception))
            # ValidationError is a UserError, so the administrator sees a dialog, not a traceback.
            self.assertIsInstance(caught.exception, UserError)
            record.invalidate_recordset()
        with self.assertRaises(ValidationError) as caught, self.env.cr.savepoint():
            record.write({"logo_source": "upload", "logo_image": False})
        self.assertIn("Logo van het bedrijf in Odoo", str(caught.exception))
        record.invalidate_recordset()
        self.assertEqual(record.logo_source, "odoo")

    def test_native_probe_has_real_website_css_and_no_scripts(self):
        self.appearance().write({"mode": "odoo"})
        response = self.url_open("/prefab/theme")
        self.assertEqual(response.status_code, 200)
        document = html.fromstring(response.content)
        self.assertFalse(document.xpath("//script"))
        styles = document.xpath("//link[@rel='stylesheet']/@href")
        self.assertTrue(any("web.assets_frontend" in url for url in styles), styles)
        for url in styles:
            self.assertEqual(self.url_open(url).status_code, 200)
        self.assertTrue(document.xpath("//*[@id='prefab-theme-action'][contains(@class,'btn-primary')]"))
        self.assertIn("script-src 'none'", response.headers["Content-Security-Policy"])
        self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")

"""The brand foundation, against a real database.

The repository's ``tests/test_website_foundation.py`` reads the shipped files and can tell
that the code says the right thing. This file is the other half, and it exists because the two
defects it covers were both INVISIBLE to a file-reading test and to the person who deployed
them:

* a customisation write that does not reach the compiled SCSS raises nothing. The module has
  already shipped one silent no-op of exactly that shape: ``_cs_prefab_apply_theme`` returned
  ``{"palette": False}`` for months while every document in the repository described a brand
  palette in the editor's colour picker.
* a page view that is born website-specific disables Odoo's copy-on-write, so ``-u`` rewrites
  it unconditionally. The symptom is the customer's own edits disappearing after an upgrade,
  with no error, no log line, and nobody able to say when it happened.

Both are asserted here against what the database actually holds after the bootstrap has run.
"""
from odoo.tests import HttpCase, tagged

THEME_USER_VALUES = "/website/static/src/scss/options/user_values.scss"
THEME_USER_COLORS = "/website/static/src/scss/options/colors/user_color_palette.scss"
THEME_USER_STATES = "/website/static/src/scss/options/colors/user_theme_color_palette.scss"


@tagged("post_install", "-at_install")
class TestBrandFoundation(HttpCase):
    # HttpCase rather than TransactionCase: one assertion below fetches the favicon URL over
    # HTTP, because a favicon that 404s is worse than none -- the tab then falls back to the
    # browser default rather than to Odoo's icon, and nothing anywhere says so.

    def setUp(self):
        super().setUp()
        self.website = self.env["website"]._cs_prefab_target_website()
        self.assets = self.env["website.assets"].with_context(website_id=self.website.id)

    def scss(self, url):
        """The CUSTOMISED file, not the pristine one Odoo ships.

        `_get_content_from_url(url)` returns the template, whose whole body is a
        `// -- hook --` comment. A check written against it reports that nothing was written,
        every time, however well the write went -- which is exactly the silent no-op this file
        exists to catch, arrived at from the other side. Measured: it did.
        """
        custom = self.assets._make_custom_asset_url(url, "web.assets_frontend")
        return (self.assets._get_content_from_url(custom) or b"").decode("utf-8", "replace")

    # ------------------------------------------------------------------ theme

    def test_the_brand_colours_reach_the_file_odoo_compiles(self):
        """Not the constants, not the docstring: the customisation file itself.

        This is the readback the previous palette attempt never had. A dictionary in Python
        proves nothing about what the server serves.
        """
        self.env["website"]._cs_prefab_apply_theme(self.website)
        colours = self.scss(THEME_USER_COLORS)
        for key, value in self.env["website"]._cs_prefab_palette_values().items():
            self.assertIn(f"'{key}'", colours, f"{key} never reached {THEME_USER_COLORS}")
            self.assertIn(str(value), colours, f"{key} reached the file without its value")

    def test_the_action_colour_is_the_one_that_passes_AA(self):
        """#e8511d on white is 3.73:1 and carried the primary button on all 21 pages."""
        self.env["website"]._cs_prefab_apply_theme(self.website)
        colours = self.scss(THEME_USER_COLORS).lower()
        self.assertIn("#c43f12", colours)
        self.assertNotIn("#e8511d", colours, "the colour that fails AA must be gone")

    def test_the_palette_name_is_written_before_the_colours(self):
        """Order is load-bearing: the name RESETS the colour file (website/models/assets.py).

        Written the wrong way round, the seed erases itself and leaves no trace. So this asserts
        the outcome rather than the order of the source lines: after a full seed, both the name
        and the colours are present at the same time.
        """
        self.env["website"]._cs_prefab_apply_theme(self.website)
        self.assertIn("base-1", self.scss(THEME_USER_VALUES))
        self.assertIn("#C43F12", self.scss(THEME_USER_COLORS))

    def test_the_type_scale_and_the_button_radius_are_website_values(self):
        """Every number that used to be a rule in prefab_site.scss, now owned by the Theme tab."""
        self.env["website"]._cs_prefab_apply_theme(self.website)
        values = self.scss(THEME_USER_VALUES)
        for key in ("h1-font-size", "h2-font-size", "h3-font-size",
                    "btn-border-radius", "input-border-radius", "headings-font-weight",
                    "footer-template", "header-template", "link-underline"):
            # Note what is NOT in this list: 'font' and 'headings-font'. They are left at the
            # theme default on purpose -- see _cs_prefab_website_values -- and asserting them
            # here would lock in the very write that broke the bundle.
            self.assertIn(f"'{key}'", values, f"{key} is not a website value")

    def test_the_seed_reports_whether_it_read_itself_back(self):
        result = self.env["website"]._cs_prefab_apply_theme(self.website)
        self.assertTrue(result["verified"]["ok"], result["verified"])

    def test_nothing_is_written_to_an_instance_wide_bundle(self):
        """The failure that took web.assets_frontend down for every website on this Odoo."""
        self.env["website"]._cs_prefab_apply_theme(self.website)
        touched = self.env["ir.asset"].search([("bundle", "=", "web._assets_primary_variables")])
        self.assertFalse(touched.filtered(lambda a: a.path and "cs_prefab" in a.path),
                         "this module must contribute nothing to the instance-wide bundle")

    def test_every_customisation_belongs_to_this_website_only(self):
        """A customisation without website_id would restyle the customer's other site."""
        self.env["website"]._cs_prefab_apply_theme(self.website)
        for url in (THEME_USER_VALUES, THEME_USER_COLORS, THEME_USER_STATES):
            custom = self.assets._get_custom_attachment(
                self.assets._make_custom_asset_url(url, "web.assets_frontend"))
            self.assertTrue(custom, url)
            self.assertEqual(custom[0].website_id, self.website, url)

    # ------------------------------------------------------------------ chrome

    def test_the_header_no_longer_offers_a_demonstration_telephone_number(self):
        """tel:+1 555-555-5556 shipped twice per page on all 21 pages, next to the real one."""
        self.env["website"]._cs_prefab_apply_chrome_views(self.website)
        if self.env.ref("website.header_text_element", raise_if_not_found=False):
            # viewref, not env.ref().with_context(): the first resolves to this website's own
            # copy, which is what the builder writes and reads, and the second hands back the
            # generic record with a context attached. Measured: the demonstration telephone
            # number read as still active immediately after being switched off.
            view = self.website.with_context(website_id=self.website.id).viewref(
                "website.header_text_element")
            self.assertFalse(view.active)

    def test_the_header_button_opens_the_configurator_and_keeps_the_real_contact_route(self):
        """Check the rendered CTA: the native contact field alone does not drive this view."""
        self.env["website"]._cs_prefab_apply_chrome_views(self.website)
        self.assertEqual(self.website.contact_us_link_url, "/contact")
        rendered = self.env["ir.qweb"]._render(
            "website.header_call_to_action",
            {"website": self.website, "_item_class": "", "_div_class": ""})
        self.assertIn('href="/offerte"', str(rendered))
        self.assertIn("Ontwerp je aanbouw", str(rendered))
        self.assertNotIn("/contactus", str(rendered))

    # ------------------------------------------------------------- page ownership

    def test_no_page_view_is_born_website_specific(self):
        """The defect: website.page.website_id is related+stored onto ir.ui.view.

        Set on the page record, it wrote through onto the view, the view was specific from the
        first install, Odoo skipped copy-on-write (there is nothing left to copy to), and every
        `-u cs_prefab_website` overwrote the customer's edits with the shipped template.
        """
        self.env["website"]._cs_prefab_release_page_views()
        pages = self.env["website.page"].search([("view_id.key", "like", "cs_prefab_website.%")])
        self.assertTrue(pages, "the site's pages must exist for this test to mean anything")
        specific = pages.filtered(lambda p: p.view_id.website_id)
        self.assertFalse(
            specific,
            "these views are website-specific, so copy-on-write cannot fire and an upgrade "
            f"will silently destroy edits to them: {specific.mapped('view_id.key')}")

    def test_website_context_edit_creates_a_cow_separate_from_an_ordinary_generic_write(self):
        """ORM isolation only; a real builder save plus module upgrade is a separate clone gate."""
        self.env["website"]._cs_prefab_release_page_views()
        page = self.env.ref("cs_prefab_website.page_over_ons_record")
        marker = "PROEF-BEWERKING-DIE-MOET-BLIJVEN"
        view = page.view_id.with_context(website_id=self.website.id)
        view.arch_db = view.arch_db.replace("<div", f'<div data-proef="{marker}"', 1)
        views = self.env["ir.ui.view"].with_context(active_test=False)
        specific = views.search(
            [("key", "=", page.view_id.key), ("website_id", "=", self.website.id)], limit=1)
        self.assertTrue(specific, "a website-context edit must produce a COW view")
        self.assertIn(marker, specific.arch_db)
        generic = views.search(
            [("key", "=", page.view_id.key), ("website_id", "=", False)], limit=1)
        self.assertTrue(generic, "the original generic template must remain")
        generic_marker = "GEWIJZIGDE-GENERIEKE-BRON"
        generic.with_context(website_id=False).write({
            "arch_db": generic.arch_db.replace("<div", f'<div data-bron="{generic_marker}"', 1),
        })
        specific.invalidate_recordset(["arch_db"])
        self.assertIn(marker, specific.arch_db)
        self.assertNotIn(generic_marker, specific.arch_db)

    def test_claiming_homepage_preserves_its_native_cow_page_and_public_route(self):
        """The upgrade claim must retain both the generic source and the owner's root page.

        A real builder-save/upgrade reproduced a redirect to /projecten even though
        the saved arch survived: the claim had moved its COW page to /oude-startpagina
        and unpublished it. Exercise the native website-context copy, including its
        website.page, and verify the anonymous route as well as stored content.
        """
        self.env["website"]._cs_prefab_release_page_views()
        generic = self.env.ref("cs_prefab_website.page_home_record")
        self.assertFalse(generic.view_id.website_id)
        self.assertEqual(generic.url, "/")
        self.assertTrue(generic.is_published)
        marker = "PROEF-BEWAARDE-STARTPAGINA-NA-CLAIM"
        original_arch = generic.view_id.arch_db
        generic.view_id.with_context(website_id=self.website.id).write({
            "arch_db": original_arch.replace("<div", f'<div data-proef="{marker}"', 1),
        })
        pages = self.env["website.page"].with_context(active_test=False)
        specific = pages.search([
            ("view_id.key", "=", generic.view_id.key),
            ("website_id", "=", self.website.id),
        ])
        self.assertEqual(len(specific), 1, "native COW must provide a page for this website")
        self.assertNotEqual(specific.id, generic.id)
        self.assertNotEqual(specific.view_id.id, generic.view_id.id)
        self.assertEqual(specific.url, "/")
        self.assertTrue(specific.is_published)
        self.assertIn(marker, specific.view_id.arch_db)
        self.assertEqual(generic.view_id.arch_db, original_arch)

        family = generic | specific

        def snapshot():
            family.invalidate_recordset()
            family.view_id.invalidate_recordset()
            return {page.id: (page.view_id.id, page.view_id.key, page.website_id.id,
                              page.url, page.is_published, page.view_id.arch_db)
                    for page in family.exists()}

        def assert_public_home():
            self.env.flush_all()
            response = self.url_open("/", allow_redirects=False)
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.history, "the root must not redirect to another page")
            self.assertIn(marker, response.text, "anonymous visitors must receive the saved COW page")

        before = snapshot()
        homepage_url = self.website.homepage_url
        assert_public_home()
        result = self.env["website"]._cs_prefab_claim_homepage()
        self.assertEqual(result["moved"], [], "neither member of the homepage family is a stray")
        self.assertEqual(snapshot(), before, "claiming must preserve page IDs, URLs, publication and arch")
        self.website.invalidate_recordset(["homepage_url"])
        self.assertEqual(self.website.homepage_url, homepage_url)
        at_root = pages.search([
            ("url", "=", "/"), ("is_published", "=", True),
            ("website_id", "in", (False, self.website.id)),
        ])
        self.assertEqual(set(at_root.ids), set(family.ids))
        assert_public_home()

    def test_the_release_refuses_to_make_pages_generic_on_a_multi_website_instance(self):
        """A generic page is served by EVERY website, so the fix inverts if a second appears.

        Stated as a test rather than a comment because the day somebody adds a second website is
        exactly the day nobody rereads this module's comments.
        """
        self.env["website"].create({"name": "Tweede website"})
        result = self.env["website"]._cs_prefab_release_page_views()
        self.assertEqual(result.get("skipped"), "multi-website instance")

    # ------------------------------------------------------------- white label

    def test_the_backend_branding_never_ships_the_placeholder(self):
        """cs_white_label_kit writes "Your Brand" into ir.config_parameter on INSTALL.

        Its data/demo_branding.xml sits in the data list rather than the demo list, and the three
        values it writes drive the page titles, the installed-app name and the "Powered by" line
        on the login screen, the portal sidebar and the storefront. Installing it on a live site
        and walking away puts placeholder text in front of real customers, with nothing failing.
        """
        params = self.env["ir.config_parameter"].sudo()
        installed = self.env["ir.module.module"].sudo().search_count(
            [("name", "=", "cs_white_label_kit"), ("state", "=", "installed")])
        result = self.env["website"]._cs_prefab_apply_white_label(self.website)
        if not installed:
            self.assertIn("skipped", result, "the step must be silent when the module is absent")
            return
        for key in ("cs_white_label_kit.brand_name",
                    "cs_white_label_kit.brand_url",
                    "cs_white_label_kit.powered_by_text"):
            value = params.get_str(key) or ""
            self.assertNotIn("Your Brand", value, key)
            self.assertNotIn("example.com", value, key)
            self.assertTrue(value, key)

    def test_the_backend_favicon_points_at_this_sites_own_icon(self):
        """The reason this module is installed at all."""
        if not self.env["ir.module.module"].sudo().search_count(
                [("name", "=", "cs_white_label_kit"), ("state", "=", "installed")]):
            self.skipTest("cs_white_label_kit is not installed on this database")
        self.env["website"]._cs_prefab_apply_white_label(self.website)
        url = self.env["ir.config_parameter"].sudo().get_str("cs_white_label_kit.favicon_url")
        self.assertTrue(url, "the favicon URL is the point of the module")
        self.assertIn("cs_prefab_website", url)
        # And it has to resolve: a favicon URL that 404s is worse than none, because the tab
        # then shows the browser default rather than falling back to Odoo's icon.
        self.assertEqual(self.url_open(url).status_code, 200, url)

    def test_a_brand_the_administrator_already_set_is_never_overwritten(self):
        """Same promise as every other one-shot step in the bootstrap."""
        if not self.env["ir.module.module"].sudo().search_count(
                [("name", "=", "cs_white_label_kit"), ("state", "=", "installed")]):
            self.skipTest("cs_white_label_kit is not installed on this database")
        params = self.env["ir.config_parameter"].sudo()
        params.set_str("cs_white_label_kit.brand_name", "Iets wat de beheerder koos")
        self.env["website"]._cs_prefab_apply_white_label(self.website)
        self.assertEqual(params.get_str("cs_white_label_kit.brand_name"),
                         "Iets wat de beheerder koos")


    def test_warm_design_bootstrap_does_not_reapply_over_owner_tint_scale_or_motion(self):
        """Band 4 is a hand-over: later bootstraps must retain native editor choices."""
        website_model = self.env["website"]
        motion_default = website_model._fields["cs_prefab_motion"].default(website_model)
        self.assertTrue(motion_default)
        self.website.cs_prefab_seed_level = 3
        initial = website_model._cs_prefab_bootstrap()
        self.assertIn("warm_design", initial)
        self.assertEqual(initial["seed_level_after"], 4)
        self.assertIn("#F3F0EB", self.scss(THEME_USER_COLORS))
        self.assertIn("3.75rem", self.scss(THEME_USER_VALUES))
        self.assets.make_scss_customization(THEME_USER_COLORS, {
            "o-color-3": "#E6E0D8", "o-cc2-bg": "#E6E0D8",
        })
        self.assets.make_scss_customization(THEME_USER_VALUES, {"h1-font-size": "4.125rem"})
        self.website.cs_prefab_motion = False
        before = (self.scss(THEME_USER_COLORS), self.scss(THEME_USER_VALUES))
        repeated = website_model._cs_prefab_bootstrap()
        self.assertNotIn("warm_design", repeated)
        self.assertEqual(repeated["seed_level_after"], 4)
        self.assertEqual((self.scss(THEME_USER_COLORS), self.scss(THEME_USER_VALUES)), before)
        self.assertFalse(self.website.cs_prefab_motion)

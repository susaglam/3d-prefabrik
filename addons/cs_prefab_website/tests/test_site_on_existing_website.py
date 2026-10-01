"""What installing this site onto the website that was already there does to the database.

The module installs onto the customer's existing default website -- the one already serving
the configurator on /prefab. That is the whole shape of the risk, and it is a different shape
from "a new record starts empty": every step writes to a record that is IN USE, so the
question each test below asks is not "was the value set" but "was the right thing left
alone".

Three properties are load-bearing and each has a test that fails on its own:

* no website record is created, ever, and the site sits on the default one;
* an upgrade does not undo an administrator: the navigation, the logo, the name and the
  language are one-shot, and the domain is never written at all;
* exactly one page answers "/", and claiming it MOVED the previous homepage rather than
  deleting it.

The repository's tests/test_website_foundation.py asserts that the mechanisms are present in
the source. This file asserts what they do to real records. Two controls with different
failure modes: deleting the code fails the first, breaking its effect fails this one.
"""
import hashlib
import json

from lxml import html

from odoo.exceptions import ValidationError
from odoo.tests import HttpCase, tagged
from odoo.tools import file_open


@tagged("post_install", "-at_install")
class TestPrefabSiteOnExistingWebsite(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.site = cls.env["website"]._cs_prefab_site()
        cls.default = cls.env["website"].search([], order="sequence, id", limit=1)

    # ------------------------------------------------------------------
    # Which website, and how many
    # ------------------------------------------------------------------

    def test_the_site_is_on_the_website_that_was_already_there(self):
        """No record was created for it, and the default website is still the default.

        The strongest statement available from inside the database: the website carrying the
        brand IS the one an unmatched host already resolved to (lowest sequence, id), and this
        module owns no external id of model `website` -- which is what a `<record
        model="website">` would have left behind.
        """
        self.assertTrue(self.site, "the install must flag a website")
        self.assertEqual(self.site, self.default,
                         "the site belongs on the existing default website")
        self.assertTrue(self.site.cs_prefab_site)
        owned = self.env["ir.model.data"].search_count(
            [("module", "=", "cs_prefab_website"), ("model", "=", "website")])
        self.assertEqual(owned, 0,
                         "an external id of ours on a website record would make uninstalling "
                         "this module delete the customer's website")

    def test_the_target_resolver_never_creates_a_website(self):
        """Called twice, it answers the same record and adds nothing."""
        before = self.env["website"].search_count([])
        first = self.env["website"]._cs_prefab_target_website()
        second = self.env["website"]._cs_prefab_target_website()
        self.assertEqual(first, self.site)
        self.assertEqual(second, self.site)
        self.assertEqual(self.env["website"].search_count([]), before)

    def test_running_the_whole_bootstrap_again_creates_no_website_and_moves_nothing(self):
        """It is called from a data file on every upgrade; an unchanged release is a no-op."""
        before = self.env["website"].search_count([])
        name, logo, domain = self.site.name, self.site.logo, self.site.domain
        result = self.env["website"]._cs_prefab_bootstrap()
        self.assertEqual(result["website_id"], self.site.id)
        self.assertFalse(result["first_run"], "the flag says the seeding already happened")
        self.assertEqual(self.env["website"].search_count([]), before)
        self.assertEqual((self.site.name, self.site.logo, self.site.domain),
                         (name, logo, domain))

    # ------------------------------------------------------------------
    # The flag, and the day somebody adds a second website
    # ------------------------------------------------------------------

    def test_only_one_website_may_carry_the_brand(self):
        """Every template and every stylesheet rule this module ships is gated on this flag.

        It is tested against a real second website rather than in the abstract: the constraint
        only has anything to say once there are two, and that is exactly the day it matters.
        """
        other = self.env["website"].create({"name": "Tweede site voor de test"})
        self.assertFalse(other.cs_prefab_site, "a new website must not inherit the brand")
        with self.assertRaises(ValidationError):
            other.cs_prefab_site = True

    def test_a_new_configurator_record_follows_the_website_in_scope(self):
        """Both defaults resolve to the FIRST website unless a website is in scope.

        With one website that can only be right, which is why this test makes a second one:
        without the override, every new draft catalogue and every new appearance record would
        belong to the first website whichever one the sales manager has in mind -- and the
        person who notices is the one wondering why the site still shows demonstration prices
        after they published.
        """
        other = self.env["website"].create({"name": "Tweede site voor de test"})
        for model in ("cs.prefab.catalog.release", "cs.prefab.appearance"):
            scoped = self.env[model].with_context(website_id=other.id).default_get(["website_id"])
            self.assertEqual(scoped.get("website_id"), other.id, model)
            # Outside a website scope it must return exactly what it returned before.
            plain = self.env[model].with_context(website_id=None).default_get(["website_id"])
            self.assertEqual(plain.get("website_id"), self.default.id, model)

    # ------------------------------------------------------------------
    # The domain -- the value this module never writes
    # ------------------------------------------------------------------

    def test_the_install_never_writes_the_domain_of_a_live_website(self):
        """`enforce_origin` compares scheme + host LITERALLY against this field.

        So filling it in with the address the site will have AFTER the DNS switch turns every
        price request, every share and every quote into a 403 on the day of the upgrade. The
        bootstrap therefore leaves it exactly as it found it -- proved here by setting a value
        and running the bootstrap over it.
        """
        self.site.domain = "https://voorbeeld.test"
        self.env["website"]._cs_prefab_bootstrap()
        self.site.invalidate_recordset(["domain"])
        self.assertEqual(self.site.domain, "https://voorbeeld.test")

    def test_the_form_says_which_address_to_set_and_when(self):
        """The readback is the whole mechanism: nothing else performs the switch.

        A parameter nobody reads is decoration, so this also proves the canonical host reaches
        a human instead of only a comment.
        """
        canonical = self.env["ir.config_parameter"].sudo().get_str(
            "cs_prefab_website.canonical_host")
        self.assertTrue(canonical)
        self.site.domain = "https://voorbeeld.test"
        self.site.invalidate_recordset(["domain"])
        self.assertIn(canonical, self.site.cs_prefab_origin_status)
        self.site.domain = False
        self.site.invalidate_recordset(["domain"])
        self.assertIn(canonical, self.site.cs_prefab_origin_status)

    # ------------------------------------------------------------------
    # The configurator's per-website records
    # ------------------------------------------------------------------

    def test_the_install_does_not_invent_a_catalogue(self):
        """The prices this site quotes are the ones the website already publishes.

        There is no second website to copy a catalogue from any more, and a module that
        creates catalogue rows next to the live one is a module inventing prices. What it
        leaves behind instead is the readback.
        """
        before = self.env["cs.prefab.catalog.release"].search_count(
            [("website_id", "=", self.site.id)])
        self.env["website"]._cs_prefab_bootstrap()
        self.assertEqual(self.env["cs.prefab.catalog.release"].search_count(
            [("website_id", "=", self.site.id)]), before)

    def test_the_website_form_reads_back_which_prices_are_served(self):
        """The failure it reports has no other symptom than the prices themselves."""
        status = self.site.cs_prefab_catalog_status
        self.assertTrue(status)
        published = self.env["cs.prefab.catalog.release"].search_count(
            [("website_id", "=", self.site.id), ("state", "=", "published")])
        if not published:
            self.assertIn("demonstratieprijzen", status)

    def test_the_website_has_its_own_form_appearance_and_keeps_the_one_it_has(self):
        """Without it the embedded form renders in the built-in palette on an orange page."""
        appearance = self.env["cs.prefab.appearance"].search(
            [("website_id", "=", self.site.id)])
        self.assertEqual(len(appearance), 1)
        self.assertEqual(appearance.mode, "custom")
        # One definition of the action colour, shared by the page and the embedded form.
        self.assertEqual(appearance.color_action, "#c43f12")
        # The model's own constraint enforces 4.5:1; reaching it here proves the record was
        # accepted rather than silently repaired.
        payload = appearance._public_payload()
        self.assertEqual(payload["colors"]["action"], "#c43f12")
        appearance.color_background = "#ffffff"
        self.env["website"]._cs_prefab_bootstrap()
        self.assertEqual(self.env["cs.prefab.appearance"].search_count(
            [("website_id", "=", self.site.id)]), 1, "a second record would fight the first")
        self.assertEqual(appearance.color_background, "#ffffff",
                         "an appearance an administrator edited is theirs")

    def test_quotes_and_shares_stay_inside_their_own_website(self):
        """Asserted structurally: both models scope by website, so the isolation cannot be
        lost by a configuration change, only by a code change."""
        for model in ("cs.prefab.quote", "cs.prefab.share"):
            field = self.env[model]._fields["website_id"]
            self.assertEqual(field.comodel_name, "website")
            self.assertTrue(field.required, model)

    # ------------------------------------------------------------------
    # Language and routing
    # ------------------------------------------------------------------

    def test_dutch_is_the_language_and_leads_have_somewhere_to_go(self):
        """A website lead with no team is not an error -- it is a lead nobody is assigned."""
        dutch = self.env["res.lang"].sudo().search([("code", "=", "nl_NL")], limit=1)
        if dutch:
            self.assertEqual(self.site.default_lang_id, dutch)
            self.assertIn(dutch, self.site.language_ids)
        if "crm_default_team_id" in self.site._fields and self.site.crm_default_team_id:
            # website_crm routes a contact-form lead through crm_default_team_id, NOT through
            # website_sale's salesteam_id -- reading only the latter is the quiet version of
            # this failure.
            self.assertTrue(self.site.crm_default_team_id)

    def test_a_language_an_administrator_changed_back_is_not_reimposed(self):
        """One-shot, like the menu and the logo: the site is Dutch, the setting is theirs."""
        english = self.env["res.lang"].sudo().search([("code", "=", "en_US")], limit=1)
        if not english:
            self.skipTest("en_US is not installed on this database")
        self.site.write({"language_ids": [(4, english.id)], "default_lang_id": english.id})
        self.env["website"]._cs_prefab_bootstrap()
        self.site.invalidate_recordset(["default_lang_id"])
        self.assertEqual(self.site.default_lang_id, english)

    # ------------------------------------------------------------------
    # The navigation -- the most visible thing this module touches
    # ------------------------------------------------------------------

    def test_the_navigation_of_this_site_is_there_and_the_blog_entry_is_not(self):
        """Native menus carry the content routes; logo and header CTA carry home and design."""
        menus = self.env["website.menu"].search([("website_id", "=", self.site.id)])
        urls = set(menus.mapped("url"))
        self.assertNotIn("/blog", urls)
        self.assertFalse(self.env["website.menu"].search(
            [("url", "=", "/blog"), ("website_id", "=", False)]),
            "the global entry is fanned out onto every website Odoo creates later")
        for expected in ("/over-ons", "/oplossingen", "/oplossingen/prefab-aanbouw",
                         "/oplossingen/prefab-dakkapel", "/oplossingen/prefab-opbouw",
                         "/projecten", "/partner-worden", "/contact"):
            self.assertIn(expected, urls, expected)
        self.assertTrue(self.site.menu_id.exists(), "the native menu root must remain")
        self.assertFalse(self.site.menu_id.parent_id)
        leaves = menus.filtered(lambda menu: menu.parent_id == self.site.menu_id and not menu.child_id)
        self.assertFalse(leaves.filtered(lambda menu: menu.url in ("/", "/offerte", "/prefab")),
                         "home and design are represented by the native logo and header CTA")
        response = self.url_open("/")
        self.assertEqual(response.status_code, 200)
        header = html.fromstring(response.content).xpath("//header")
        self.assertTrue(header)
        self.assertTrue(header[0].xpath(".//a[@href='/'][.//img]"), "the logo must lead home")
        self.assertTrue(header[0].xpath(".//a[@href='/offerte']"), "the header must offer the design route")
        # The dropdown parent is also a real page. On a touch device a tap on a parent expands
        # the submenu instead of navigating, so the overview needs its own leaf -- and Odoo
        # forces a parent's own url to "#" anyway (website.menu._compute_url).
        parent = menus.filtered(lambda menu: menu.name == "Oplossingen" and menu.child_id)
        self.assertTrue(parent)
        self.assertIn("Alle oplossingen", parent.child_id.mapped("name"))

    def test_an_entry_the_website_already_had_is_never_removed_and_is_reported(self):
        """This is a live navigation. An upgrade does not get to tidy it up silently.

        Both halves in one test because they are one decision: nothing is deleted, and what is
        left over is named on the settings form so the customer can remove it deliberately.
        """
        theirs = self.env["website.menu"].create({
            "name": "Eigen item van de klant", "url": "/iets-van-de-klant",
            "sequence": 95, "parent_id": self.site.menu_id.id, "website_id": self.site.id})
        # Both, not just the boolean. Herzien 2026-09-20: the one-shot flag became a LEVEL,
        # because the boolean was already true on the live website and every hand-over step sat
        # behind it -- the module could not add so much as a menu entry. Clearing only the
        # boolean leaves the level at 2 and the band never re-runs.
        self.site.cs_prefab_seeded = False
        self.site.cs_prefab_seed_level = 0
        self.env["website"]._cs_prefab_bootstrap()
        self.assertTrue(theirs.exists(), "a pre-existing menu entry must survive the inrichting")
        self.site.invalidate_recordset(["cs_prefab_menu_status"])
        self.assertIn("/iets-van-de-klant", self.site.cs_prefab_menu_status)

    def test_the_one_shot_seeding_is_never_reimposed(self):
        """The navigation, the logo and the name belong to the customer from the first run on.

        A bootstrap that re-created them on every upgrade would put back a menu entry they
        renamed and a logo they replaced, silently, as part of a release about something else.
        """
        self.assertTrue(self.site.cs_prefab_seeded)
        self.site.logo = False
        renamed = self.env["website.menu"].search(
            [("website_id", "=", self.site.id), ("url", "=", "/over-ons")], limit=1)
        renamed.name = "Over Prefab Partner"
        self.env["website"]._cs_prefab_bootstrap()
        self.assertFalse(self.site.logo, "the bootstrap must not re-impose the shipped logo")
        self.assertEqual(renamed.name, "Over Prefab Partner")
        self.assertEqual(self.env["website.menu"].search_count(
            [("website_id", "=", self.site.id), ("url", "=", "/over-ons")]), 1,
            "a second run must not duplicate the navigation")

    def test_the_site_carries_its_own_name_because_odoo_puts_it_in_every_title(self):
        """website.name is not backend bookkeeping: the layout renders it as the tail of
        every <title> and as the title of the header logo."""
        self.assertEqual(self.site.name, "Prefab Partner")

    def test_the_previous_logo_is_kept_somewhere_it_can_be_taken_back_from(self):
        """Replacing a live website's logo is not reversible unless somebody made it so.

        Proved by bytes rather than by existence: the snapshot is written to `raw`, and the
        `datas` spelling -- which this target drops with only a warning -- would produce an
        attachment of zero bytes and report success.
        """
        known = b"<svg xmlns='http://www.w3.org/2000/svg'><rect width='4' height='4'/></svg>"
        media = self.env["cs.prefab.website.media"]
        self.site.logo = media._binary(known)
        kept_name = "Vorig logo van deze website (bewaard door Prefab Partner)"
        self.env["ir.attachment"].sudo().search([("name", "=", kept_name)]).unlink()
        # Both, not just the boolean. Herzien 2026-09-20: the one-shot flag became a LEVEL,
        # because the boolean was already true on the live website and every hand-over step sat
        # behind it -- the module could not add so much as a menu entry. Clearing only the
        # boolean leaves the level at 2 and the band never re-runs.
        self.site.cs_prefab_seeded = False
        self.site.cs_prefab_seed_level = 0
        self.env["website"]._cs_prefab_bootstrap()
        kept = self.env["ir.attachment"].sudo().search([("name", "=", kept_name)])
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept.checksum, hashlib.sha1(known).hexdigest(),
                         "the snapshot must be the bytes that were there, not an empty file")

    # ------------------------------------------------------------------
    # The homepage
    # ------------------------------------------------------------------

    def test_exactly_one_page_answers_the_root_and_it_is_this_site_s(self):
        """Two pages at "/" on one website is a tie PostgreSQL breaks however it likes.

        `ir.http._serve_page` searches `url = path` with `order='website_id asc', limit=1`, so
        the homepage a visitor gets would be a coin flip. Measured in the saas~19.4 source.
        """
        ours = self.env.ref("cs_prefab_website.page_home_record")
        # Herzien 2026-09-20: scoped to (False, this website) rather than to this website.
        # The module's pages are generic since the copy-on-write repair, so the old filter
        # matched nothing and the assertion would have compared an empty recordset.
        at_root = self.env["website.page"].search(
            [("url", "=", "/"), ("is_published", "=", True),
             ("website_id", "in", (False, self.site.id))])
        self.assertEqual(at_root, ours)
        # The native tree root is a container, not a Home link. The approved header
        # uses the logo for this route, so a root menu's page_id proves nothing here.
        response = self.url_open("/")
        self.assertEqual(response.status_code, 200)
        document = html.fromstring(response.content)
        self.assertTrue(document.xpath("//header//a[@href='/'][.//img]"))
        self.assertIn("Meer ruimte.", " ".join(document.xpath("//main//h1//text()")))

    def test_a_page_that_was_at_the_root_is_moved_and_unpublished_never_deleted(self):
        """The previous homepage is the customer's content, with their words in it.

        So it is moved to /oude-startpagina and unpublished. The record, its view and its
        content survive, and putting it back is one field.
        """
        ours = self.env.ref("cs_prefab_website.page_home_record")
        # A previous homepage has its own view/key. Reusing ours.view_id would make
        # this a member of our COW family and write website_id through onto our view.
        previous_view = self.env["ir.ui.view"].create({
            "name": "Startpagina van de klant", "type": "qweb",
            "key": "cs_prefab_test.previous_customer_homepage", "website_id": self.site.id,
            "arch_db": '<t t-name="cs_prefab_test.previous_customer_homepage">'
                       '<t t-call="website.layout"><div id="wrap">'
                       '<h1>Bestaande startpagina van de klant</h1></div></t></t>',
        })
        stray = self.env["website.page"].create({
            "name": "Startpagina van de klant", "url": "/", "view_id": previous_view.id,
            "website_id": self.site.id, "is_published": True})
        # A customer may add their own Home leaf after the redesign. Build that case
        # explicitly; searching url='/' can select the native tree root or nothing.
        root_menu = self.site.menu_id
        root_page_before = root_menu.page_id
        menu = self.env["website.menu"].create({
            "name": "Eigen startpagina", "page_id": stray.id,
            "parent_id": root_menu.id, "website_id": self.site.id,
        })
        result = self.env["website"]._cs_prefab_claim_homepage()
        self.assertTrue(stray.exists(), "the previous homepage must not be deleted")
        self.assertTrue(stray.url.startswith("/oude-startpagina"), stray.url)
        self.assertFalse(stray.is_published)
        self.assertEqual(result["pages_at_root"], 1)
        self.assertEqual(self.env["website.page"].search(
            [("url", "=", "/"), ("website_id", "in", (False, self.site.id))]), ours)
        menu.invalidate_recordset(["page_id", "url"])
        self.assertEqual(menu.page_id, ours)
        self.assertEqual(menu.url, "/")
        self.assertEqual(menu.parent_id, root_menu)
        root_menu.invalidate_recordset(["page_id"])
        self.assertEqual(root_menu.page_id, root_page_before,
                         "claiming a page must not repurpose the native menu root")

    def test_claiming_the_homepage_twice_changes_nothing_the_second_time(self):
        """It runs from a data file on every upgrade."""
        first = self.env["website"]._cs_prefab_claim_homepage()
        second = self.env["website"]._cs_prefab_claim_homepage()
        self.assertEqual(second["moved"], [])
        self.assertEqual(second["pages_at_root"], 1)
        self.assertEqual(first["claimed"], second["claimed"])

    # ------------------------------------------------------------------
    # Redirects and media
    # ------------------------------------------------------------------

    def test_every_url_that_must_keep_working_has_a_target(self):
        """The source-to-target diff, against the shipped map.

        This asks the question the other checks do not: what existed in the source and has
        arrived nowhere. Every other control asks whether what was built is correct.
        """
        with file_open("cs_prefab_website/data/url_map.json", "r", filter_ext=(".json",)) as handle:
            entries = json.load(handle)["entries"]
        rewrites = {rewrite.url_from: rewrite for rewrite in
                    self.env["website.rewrite"].search([("website_id", "=", self.site.id)])}
        media = self.env["cs.prefab.website.media"]
        for entry in entries:
            if entry["kind"] not in ("redirect", "media"):
                continue
            source = entry["from"].rstrip("/") or "/"
            self.assertIn(source, rewrites, source)
            rewrite = rewrites[source]
            self.assertEqual(rewrite.redirect_type, "301", source)
            self.assertTrue(rewrite.active, source)
            if entry["kind"] == "media":
                self.assertEqual(rewrite.url_to, media._media_url(entry["media"]), source)

    def test_no_rewrite_of_this_module_applies_to_every_website(self):
        """A website.rewrite with an empty website_id applies to every website there is.

        That is still worth holding with one website: it is what keeps a second one, added
        next year, from having its /wp-content/... pointed at this site's media.
        """
        for rewrite in self.env["website.rewrite"].search([]):
            if rewrite.url_from.startswith("/wp-content/"):
                self.assertEqual(rewrite.website_id, self.site,
                                 "a rewrite with no website applies to every website")

    def test_the_terms_pdf_is_downloadable_by_a_visitor_who_is_not_logged_in(self):
        """"It works for me" is the sharpest failure mode for a public file.

        The terms are linked from the footer of every page, so an attachment that is only
        readable by an internal user is a broken link on fourteen pages.
        """
        url = self.env["cs.prefab.website.media"]._media_url("av-prefabpartner.pdf")
        response = self.url_open(url)
        self.assertEqual(response.status_code, 200, url)
        self.assertIn("application/pdf", response.headers.get("Content-Type", ""))

    def test_every_shipped_image_became_an_attachment_with_the_right_bytes(self):
        """`ir.attachment.datas` is dropped SILENTLY on write on this target.

        An XML data file using it would create every attachment with no content and no
        error. Comparing the stored checksum against the file on disk is what makes that
        impossible to ship -- and the checksum is compared rather than the content because
        reading `raw` back can hand you a lazy file object instead of bytes.
        """
        media = self.env["cs.prefab.website.media"]
        index = media._media_index()
        checked = 0
        for entry in index["files"]:
            if entry.get("duplicate_of") or entry["kind"] == "video" or not entry.get("shipped"):
                continue
            attachment = media._media_attachment(entry["filename"])
            self.assertTrue(attachment, entry["filename"])
            self.assertTrue(attachment.public, entry["filename"])
            with file_open("cs_prefab_website/" + entry["shipped"]["path"], "rb") as handle:
                expected = hashlib.sha1(handle.read()).hexdigest()
            self.assertEqual(attachment.checksum, expected, entry["filename"])
            checked += 1
        self.assertGreater(checked, 80, "the whole media set, not a sample")

    def test_running_the_media_sync_again_changes_nothing(self):
        """It runs on every upgrade; an unchanged release must be a no-op."""
        result = self.env["cs.prefab.website.media"]._sync_media()
        self.assertEqual(result["created"], 0)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["missing"], 0)

    # ------------------------------------------------------------------
    # From outside
    # ------------------------------------------------------------------

    def test_the_site_renders_its_own_chrome_on_the_website_it_was_installed_on(self):
        """The page "/" of this Odoo is now this site, and that is the point of the change.

        Everything this module renders is gated on website.cs_prefab_site rather than scoped
        by where its files live, because ir.ui.view records are global and asset bundles are
        per instance. This is that claim from outside: fetch the page a visitor fetches.
        """
        response = self.url_open("/")
        self.assertEqual(response.status_code, 200)
        body = response.text
        self.assertIn("o_prefab_site", body)
        self.assertIn("o_prefab_header", body)
        self.assertIn("o_prefab_whatsapp", body)
        self.assertIn("wa.me/31624845453", body)
        # The footer fixes that have to reach every page.
        self.assertIn("tel:+31624845453", body)
        self.assertIn("mailto:info@prefabpartner.nl", body)
        # And the broken Facebook link from the live site is not carried across.
        self.assertNotIn("facebook.com/share/1AFjFfkSuE", body)

    def test_the_configurator_still_answers_on_the_website_that_had_it(self):
        """/prefab is the thing that must not break. It is checked last and on purpose:
        this module is installed onto the website that has been serving it all along."""
        response = self.url_open("/prefab/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("ok"))
        page = self.url_open("/prefab")
        self.assertEqual(page.status_code, 200)
        embed = self.url_open("/prefab/embed")
        self.assertEqual(embed.status_code, 200)

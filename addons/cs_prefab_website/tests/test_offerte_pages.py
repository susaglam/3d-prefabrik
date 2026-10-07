"""The two offerte addresses, rendered by the website that owns them.

The repository's tests/test_website_foundation.py reads the templates as files: it can tell that
the markup is there and that the version query matches. This file is the other half -- what the
two pages actually serve.

Three failures are worth naming, because each of them produces a page that looks finished:

* the page is created with an EMPTY website_id, which in Odoo does not mean "no website" but
  "every website on this instance" -- so a website added next year starts serving Prefab
  Partner's offerte page, and nobody goes looking for that;
* the frame renders but its stylesheet or its script does not come with it, and the iframe
  collapses to the browser's default 150px;
* somebody drags the configurator out of the page in the builder, which is why the frame lives
  outside every oe_structure and why that is asserted rather than assumed.
"""
from lxml import etree, html

from odoo.tests import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestPrefabOfferte(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.site = cls.env["website"]._cs_prefab_site()
        cls.offerte = cls.env.ref("cs_prefab_website.page_offerte")
        cls.opbouw = cls.env.ref("cs_prefab_website.page_offerte_opbouw")

    def on_the_site(self, url):
        """Fetch a page the way a visitor does.

        No domain is written first: there is one website and the request lands on it, and
        website.domain is the field the configurator's origin check reads.
        """
        response = self.url_open(url)
        self.assertEqual(response.status_code, 200, url)
        return response.content.decode("utf-8")

    # ------------------------------------------------------------------
    # The records
    # ------------------------------------------------------------------

    def test_both_offerte_addresses_are_published_and_stay_editable(self):
        """Herzien 2026-09-20. This asserted `website_id` on both records; now it asserts the
        opposite, and the reason is not a change of mind.

        An empty website_id really is "every website on this instance", and on a multi-website
        Odoo that would be the defect this test was written for. But `website.page.website_id`
        is `related='view_id.website_id', store=True`, so filling it wrote through onto the
        VIEW -- and a view that is already website-specific is one Odoo skips copy-on-write
        for. The measured consequence on the live database: these two views carried
        `website_id = 1` with `noupdate = f`, so every `-u cs_prefab_website` rewrote them and
        destroyed any edit made in the builder, silently.

        This Odoo serves one website, so generic and specific reach the same visitors. Only one
        of them also keeps the pages editable.
        """
        self.assertEqual(self.env["website"].search_count([]), 1,
                         "with a second website these generic pages would answer on it too")
        for page, url in ((self.offerte, "/offerte"), (self.opbouw, "/offerte-prefab-opbouw")):
            self.assertEqual(page.url, url)
            self.assertFalse(page.view_id.website_id, url)
            self.assertTrue(page.is_published, url)
            self.on_the_site(url)

    # ------------------------------------------------------------------
    # What the pages serve
    # ------------------------------------------------------------------

    def test_the_offerte_page_frames_the_configurator_with_everything_the_frame_needs(self):
        document = html.fromstring(self.on_the_site("/offerte"))
        frames = document.xpath("//iframe[@data-prefab-embed]")
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].get("src"), "/prefab/embed")
        # Without these the "volledig scherm" button throws and falls back to a fixed-inset
        # overlay that the iframe's own box clips -- the button appears to do nothing.
        self.assertEqual(frames[0].get("allow"), "fullscreen")
        self.assertIsNotNone(frames[0].get("allowfullscreen"))
        self.assertTrue(frames[0].get("title"))
        # The stylesheet is what gives the frame a height; the script only raises its floor.
        self.assertTrue(document.xpath("//link[contains(@href,'/embed_host.css')]"))
        self.assertTrue(document.xpath("//script[contains(@src,'/embed_host.js')]"))
        # And the way out, for a browser that refuses the frame.
        escape = document.xpath("//a[contains(@class,'o_prefab_embed_escape')][@href='/prefab']")
        self.assertEqual(len(escape), 1)
        self.assertLess(list(document.iter()).index(escape[0]), list(document.iter()).index(frames[0]))

    def test_the_offerte_page_explains_the_proposal_without_a_purchase_commitment(self):
        body = self.on_the_site("/offerte")
        for sentence in ("Ontwerp je aanbouw",
                         "Stel eenvoudig jouw ideale aanbouw samen met onze configurator!",
                         "Elke woning en wens is uniek.",
                         "Geen bestelling en geen betaling."):
            self.assertIn(sentence, body, sentence)

    def test_the_opbouw_page_names_the_maatwerk_route_before_it_offers_the_configurator(self):
        """The configurator designs an aanbouw. This page is about an opbouw.

        Saying so, in the customer's own sentence from /oplossingen/, is the difference between a
        page that helps and a page whose visitor discovers three steps in that the tool is not for
        them. The order is part of the claim, so the order is asserted.
        """
        body = self.on_the_site("/offerte-prefab-opbouw")
        maatwerk = "Voor opbouwen en dakkapellen bieden wij maatwerk."
        self.assertIn("Offerte voor je prefab opbouw", body)
        self.assertIn(maatwerk, body)
        self.assertLess(body.index(maatwerk), body.index("/prefab/embed"))
        document = html.fromstring(body)
        self.assertEqual(len(document.xpath("//iframe[@data-prefab-embed]")), 1)

    def test_each_page_has_exactly_one_h1(self):
        for url in ("/offerte", "/offerte-prefab-opbouw"):
            headings = html.fromstring(self.on_the_site(url)).xpath("//div[@id='wrap']//h1")
            self.assertEqual([heading.text_content().strip() for heading in headings],
                             ["Ontwerp je aanbouw"] if url == "/offerte"
                             else ["Offerte voor je prefab opbouw"], url)

    # ------------------------------------------------------------------
    # The frame is a mechanism, not content
    # ------------------------------------------------------------------

    def test_the_configurator_sits_outside_every_builder_region(self):
        """Everything the builder can reach, it can also delete.

        A "Ontwerp je aanbouw" page whose configurator was dragged off the canvas by accident
        looks finished and converts nobody, and nothing in Odoo would report it. So the copy is
        editable and the frame is not, and the boundary between them is asserted here rather than
        left to whoever edits the template next.
        """
        for page in (self.offerte, self.opbouw):
            tree = etree.fromstring(page.view_id.arch.encode("utf-8"))
            calls = tree.xpath("//t[@t-call='cs_prefab_website.offerte_frame']")
            self.assertEqual(len(calls), 1, page.url)
            ancestors = [node.get("class", "") for node in calls[0].iterancestors()]
            self.assertFalse([cls for cls in ancestors if "oe_structure" in cls], page.url)

    def test_both_pages_share_one_definition_of_the_frame(self):
        """Two copies of an iframe contract drift; one copy cannot."""
        frame = self.env.ref("cs_prefab_website.offerte_frame")
        for page in (self.offerte, self.opbouw):
            self.assertIn("cs_prefab_website.offerte_frame", page.view_id.arch, page.url)
            self.assertNotIn("<iframe", page.view_id.arch, page.url)
        self.assertIn("/prefab/embed", frame.arch)

    # ------------------------------------------------------------------
    # "Je ontwerp staat klaar" (2.18.0, docs/resume-card-contract.md)
    # ------------------------------------------------------------------

    def test_the_resume_bar_follows_the_vormgeving_switch(self):
        """<body> carries data-cs-resume exactly when Vormgeving -> Doorgaan-melding tonen is on.

        Its value is the catalogue revision a saved price must match to be shown; the bar's script
        and stylesheet ride the frontend bundle of every page.
        """
        appearance = self.env["cs.prefab.appearance"].search([("website_id", "=", self.site.id)], limit=1)
        self.assertTrue(self.site.cs_prefab_resume_bar, "on by default")
        body = html.fromstring(self.on_the_site("/")).xpath("//body")[0]
        self.assertIn("data-cs-resume", body.attrib)
        self.assertEqual(body.get("data-cs-resume"), self.site.cs_prefab_resume_revision or "-")
        if appearance:
            appearance.resume_bar = False
            self.site.invalidate_recordset(["cs_prefab_resume_bar"])
            self.assertFalse(self.site.cs_prefab_resume_bar)
            body = html.fromstring(self.on_the_site("/")).xpath("//body")[0]
            self.assertNotIn("data-cs-resume", body.attrib, "switched off: no attribute, so no bar")

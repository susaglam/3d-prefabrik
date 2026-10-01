"""What the rebuilt site actually serves, against a real database.

The repository's ``tests/test_website_pages.py`` reads the shipped files: it can tell that the
markup says the right thing. This file is the other half -- what comes back over HTTP, which
records exist, and what a submitted form leaves behind.

Four failures are worth naming up front, because each of them produces a page that looks
finished to whoever deployed it:

* a page is created with an empty ``website_id``, which in Odoo does not mean "no website" but
  "every website on this instance" -- so a website added next year starts serving Prefab
  Partner's pages, and the symptom is somebody else's site, not this one.
* the project gallery is empty. The seeding runs once, silently, from a ``<function>``; if it
  fails the pages still render, with nothing in them.
* the contact form posts and nothing is stored. That is the highest-revenue failure class on
  any Odoo site: no UI error, no server log, no network tab entry.
* the two old news addresses still redirect to ``/nieuws`` instead of to the article, because
  the ``<function>`` that re-points them sat inside a ``noupdate`` block and never ran again.
"""
import json
import re

from lxml import html

from odoo.tests import HttpCase, tagged

PAGES = [
    ("/", "Meer ruimte."),
    ("/over-ons", "Samen bouwen aan meer ruimte."),
    ("/oplossingen", "Prefab oplossingen"),
    ("/oplossingen/prefab-aanbouw", "Prefab aanbouw"),
    ("/oplossingen/prefab-dakkapel", "Prefab dakkapel"),
    ("/oplossingen/prefab-opbouw", "Prefab opbouw"),
    ("/partner-worden", "Bouw samen met PrefabPartner."),
    ("/contact", "Contactformulier"),
    ("/projecten", "Projecten"),
    ("/nieuws", "Laatste nieuws"),
]


@tagged("post_install", "-at_install")
class TestPrefabPages(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.site = cls.env["website"]._cs_prefab_site()

    def on_the_site(self, url, expect=200):
        """Fetch a page the way a visitor does.

        No domain is written first, and that is the change: there is one website, the request
        lands on it, and pointing website.domain at the test server would be juggling a
        setting that decides whether the configurator answers with a 403.
        """
        response = self.url_open(url)
        self.assertEqual(response.status_code, expect, url)
        return response.content.decode("utf-8")

    # ------------------------------------------------------------------
    # The pages
    # ------------------------------------------------------------------

    def test_every_page_of_the_site_renders_with_its_own_words(self):
        for url, sentence in PAGES:
            body = self.on_the_site(url)
            self.assertIn(sentence, body, url)
            self.assertIn("o_prefab_site", body, url)

    def test_the_frontend_stylesheet_compiles_and_carries_this_module(self):
        """A page can render perfectly while its stylesheet is a compile error. Ask the stylesheet itself.

        Odoo answers 200 and swaps in a stub when a bundle will not compile, so "the page renders" and "the page
        is styled" are two different facts. On 2026-09-17 nine mixed-unit clamp() expressions in prefab_site.scss
        took web.assets_frontend down for the whole INSTANCE -- per-instance, not per-website -- and all 120 tests
        stayed green because every one of them asked about words on the page.
        """
        import re
        body = self.on_the_site("/")
        self.assertNotIn("css error occured", body.lower(),
                         "the page itself is telling us the bundle did not compile")
        links = re.findall(r'<link[^>]+href="([^"]*web\.assets_frontend[^"]*\.css[^"]*)"', body)
        self.assertTrue(links, "the page links no frontend stylesheet at all")
        css = self.url_open(links[0])
        self.assertEqual(css.status_code, 200, links[0])
        stylesheet = css.content.decode("utf-8", "replace")
        self.assertNotIn("Incompatible units", stylesheet)
        self.assertNotIn("css error occured", stylesheet.lower())
        # Not just "some CSS came back": a selector this module defines proves OUR scss reached the bundle.
        self.assertIn(".o_prefab_site", stylesheet,
                      "the bundle compiled but without this module's stylesheet in it")
        self.assertGreater(len(stylesheet), 50000,
                           "a frontend bundle this small is the stub, not the real stylesheet")

    def test_every_page_record_belongs_to_this_website_only(self):
        """An empty website_id makes a page appear on every website of the instance.

        Gemeten op de pagina's die DIT module bezit, opgezocht via ir.model.data, en niet op
        "elk paginarecord met een van onze URLs". Dat laatste is wat hier stond en het mat de
        verkeerde database: de klantendatabase draagt al twee records op '/' van vóór dit
        module -- Odoo's eigen website.homepage_page (website_id leeg, dus geldig voor élke
        website) en de pagina van website 1 -- en `website.page._order` is 'website_id', dus de
        zoekopdracht kwam die eerst tegen en meldde `website(1,) != website(9,)` voor '/',
        terwijl dit module niets aan website 1 hangt.

        De assertie zelf is niet verzwakt maar aangescherpt: elke pagina van dit module wordt
        gecontroleerd (ook die buiten PAGES, zoals /offerte), en daarna wordt afgedwongen dat
        elke pagina uit PAGES die een record hoort te zijn er ook echt bij zit -- anders zou
        een module dat per ongeluk nul pagina's aanmaakt hier nog steeds slagen.
        """
        owned = self.env["ir.model.data"].search([
            ("module", "=", "cs_prefab_website"), ("model", "=", "website.page")])
        pages = self.env["website.page"].browse(owned.mapped("res_id")).exists()
        self.assertTrue(pages)
        for page in pages:
            # NOT website-specific, and that is the point. Herzien 2026-09-20: this line used to
            # read assertEqual(page.website_id, self.site). website.page.website_id is
            # related+stored onto ir.ui.view, so setting it made the view specific from the
            # first install; Odoo then skips copy-on-write (ir_ui_view.py) and every
            # `-u cs_prefab_website` rewrote the view, destroying the customer's builder edits
            # with no error and no log line. There is one website on this Odoo, so "generic"
            # and "this website" serve the same visitors -- and only generic keeps the
            # copy-on-write that makes the pages editable.
            self.assertFalse(page.view_id.website_id, page.url)
            self.assertTrue(page.is_published, page.url)
        self.assertEqual(self.env["website"].search_count([]), 1,
                         "a second website would make these generic pages answer on it too; "
                         "see models/website.py::_cs_prefab_release_page_views")
        served = set(pages.mapped("url"))
        for url, _sentence in PAGES:
            if url in ("/projecten", "/nieuws"):
                continue  # controllers, geen paginarecord -- zie controllers/main.py
            self.assertIn(url, served, url)

    def test_the_two_controller_pages_answer_only_where_the_brand_is(self):
        """Routes are global; records are not.

        /projecten and /nieuws are http routes, so they exist on every website of this Odoo
        the moment the module is installed. The records behind them do not. The guard is
        `_site_or_404`, and this is both halves of it: the pages answer on the website that
        carries the brand, and the helper hands back nothing for a website that does not --
        which is what keeps a website added next year from serving an empty grid and putting
        it in its own sitemap.
        """
        for url in ("/projecten", "/nieuws"):
            self.on_the_site(url)
        other = self.env["website"].create({"name": "Tweede site voor de test"})
        self.assertFalse(other.cs_prefab_site)
        self.assertFalse(self.env["cs.prefab.project"]._gallery_photos(other))

    def test_the_homepage_is_ours_and_there_is_only_one(self):
        """Two pages on one URL is a measured failure.

        `ir.http._serve_page` resolves a path with `order='website_id asc', limit=1`, so two
        pages at "/" on the SAME website is a tie PostgreSQL breaks however it likes: the
        visitor gets this site's homepage or the one the website had before, at random. The
        previous one is moved to /oude-startpagina rather than deleted -- see
        models/website.py::_cs_prefab_claim_homepage."""
        # Herzien 2026-09-20: the search used to filter on website_id = this site, which now
        # matches nothing because the pages are generic. What matters is unchanged and is what
        # is asserted: exactly one published page answers "/", and it is this site's.
        pages = self.env["website.page"].search(
            [("url", "=", "/"), ("is_published", "=", True),
             ("website_id", "in", (False, self.site.id))])
        self.assertEqual(len(pages), 1, pages.mapped("view_id.key"))
        self.assertEqual(pages.view_id, self.env.ref("cs_prefab_website.page_home"))

    def test_each_page_carries_its_own_description_and_share_image(self):
        for url, _sentence in PAGES:
            page = self.env["website.page"].search(
                [("url", "=", url), ("website_id", "in", (False, self.site.id))], limit=1)
            if not page:
                continue  # /projecten en /nieuws zijn controllers; die dragen het in de render
            self.assertGreaterEqual(len(page.website_meta_description or ""), 90, url)
            self.assertTrue(page.website_meta_og_img, url)

    def test_the_two_controller_pages_carry_a_description_in_the_head(self):
        for url in ("/projecten", "/nieuws"):
            body = self.on_the_site(url)
            self.assertIn('name="description"', body, url)
            self.assertIn('property="og:image"', body, url)

    def test_the_structured_data_is_on_every_page(self):
        body = self.on_the_site("/contact")
        self.assertIn("HomeAndConstructionBusiness", body)
        self.assertIn("Lange Kleiweg 62b", body)
        # De FAQ-markering staat alleen op de pagina waar de vragen staan.
        self.assertIn("FAQPage", body)
        self.assertNotIn("FAQPage", self.on_the_site("/over-ons"))

    # ------------------------------------------------------------------
    # Projecten
    # ------------------------------------------------------------------

    def test_the_gallery_became_records_and_kept_every_photograph(self):
        series = self.env["cs.prefab.project"].search([("website_id", "=", self.site.id)])
        self.assertEqual(len(series), 5)
        self.assertEqual(sum(one.image_count for one in series), 36,
                         "de 36 foto's van de live galerij horen er allemaal te zijn")
        for one in series:
            self.assertTrue(one.is_published, one.display_name)
            for image in one.image_ids:
                self.assertTrue(image.alt,
                                "%s heeft een foto zonder beschrijving" % one.display_name)
                self.assertTrue(image.image, "%s heeft een lege foto" % one.display_name)

    def test_nothing_carries_a_name_a_year_or_a_story(self):
        """De bron draagt ze niet, dus het record ook niet.

        Dit is de test die zou zijn afgegaan toen drie reeksen een verzonnen titel kregen. Hij
        kijkt naar de DATABASE en niet naar het JSON-bestand, want de vorige ronde had het
        bestand kunnen opschonen en de seeding onveranderd kunnen laten.
        """
        for one in self.env["cs.prefab.project"].search([("website_id", "=", self.site.id)]):
            self.assertFalse(one.name, one.display_name)
            self.assertFalse(one.year, one.display_name)
            self.assertFalse(one.story, one.display_name)
        places = self.env["cs.prefab.project"].search(
            [("website_id", "=", self.site.id), ("location", "!=", False)]).mapped("location")
        self.assertEqual(sorted(places), ["Den Haag", "Zoetermeer"])

    def test_the_gallery_shows_every_photograph_on_one_page(self):
        body = self.on_the_site("/projecten")
        photos = self.env["cs.prefab.project"]._gallery_photos(self.site)
        self.assertEqual(len(photos), 36)
        for photo in photos:
            self.assertIn("/web/image/cs.prefab.project.image/%d/image/400x400" % photo.id, body)
            self.assertIn(photo.alt, body, photo.alt)
        # En de vergroting staat erin, dicht.
        self.assertIn('data-prefab-lightbox="1"', body)
        self.assertIn('role="dialog"', body)

    def test_the_gallery_shows_the_two_places_the_source_carries_and_no_other_label(self):
        body = self.on_the_site("/projecten")
        self.assertIn("Den Haag", body)
        self.assertIn("Zoetermeer", body)
        # De drie titels die een eerdere ronde had verzonnen.
        for invented in ("Aanbouw met houten lattengevel",
                         "Prefab dakkapellen op een nieuwbouwwoning",
                         "Prefab elementen voor een nieuwbouwwoning"):
            self.assertNotIn(invented, body, invented)

    def test_the_photographs_come_out_in_the_order_of_the_old_gallery(self):
        """De volgorde is die van de klant, en de twee renderpaden moeten het eens zijn.

        ``_gallery_photos`` plakt de reeksen achter elkaar op ``sequence``; dit controleert dat
        de eerste foto van de tweede reeks ook echt na de laatste van de eerste komt, want dat
        is het enige dat een stille herschikking zou laten zien.
        """
        photos = self.env["cs.prefab.project"]._gallery_photos(self.site)
        ordering = [(photo.project_id.sequence, photo.sequence) for photo in photos]
        self.assertEqual(ordering, sorted(ordering))

    def test_a_series_has_no_page_of_its_own(self):
        """Een adres is een naam, en er zijn geen namen."""
        one = self.env.ref("cs_prefab_website.reeks_2")
        self.assertEqual(one.website_url, "/projecten")
        self.on_the_site("/projecten/aanbouw-den-haag", expect=404)

    def test_an_unpublished_series_drops_out_of_the_gallery(self):
        """Depubliceren haalt de foto's én het plaatslabel van de reeks uit de galerij.

        De regel `assertNotIn("Den Haag", body)` die hier stond, is WEGGEHAALD omdat hij fout
        was, niet omdat hij lastig was. views/seo_templates.xml zet op elke pagina van deze site
        een LocalBusiness-blok met `"areaServed": [Rijswijk, Den Haag, Zoetermeer]`, en
        test_the_structured_data_is_on_every_page eist dat blok expliciet. De losse plaatsnaam
        staat dus in de <head> van /projecten ongeacht wat er gepubliceerd is: de assertie mat
        het bedrijfsadres en noemde dat de galerij, en kon per definitie niet slagen.

        Wat hier in de plaats komt meet wél de galerij: de <span class="o_prefab_shot_place">
        die het sjabloon per foto rendert. Zoetermeer (reeks_3) blijft gepubliceerd, dus de
        lijst hoort niet leeg te zijn -- zonder die tussenstap zou een regex die niets vindt de
        assertie stilzwijgend laten slagen.
        """
        one = self.env.ref("cs_prefab_website.reeks_2")
        first = one.image_ids[0]
        self.assertTrue(one.location, "deze controle hangt aan de plaatsnaam van reeks_2")
        one.is_published = False
        self.env.flush_all()
        try:
            body = self.on_the_site("/projecten")
            self.assertNotIn(first.alt, body)
            places = re.findall(r'class="o_prefab_shot_place"[^>]*>([^<]*)<', body)
            self.assertTrue(places, "de galerij hoort de plaats van een gepubliceerde reeks te tonen")
            self.assertNotIn(one.location, places)
        finally:
            one.is_published = True

    def test_running_the_seeding_again_creates_nothing(self):
        """Vanaf het moment dat ze bestaan is deze galerij van de klant."""
        before = self.env["cs.prefab.project"].search_count([])
        result = self.env["cs.prefab.project"]._cs_prefab_seed_projects()
        self.assertEqual(result["created"], 0)
        self.assertEqual(result["missing_images"], 0)
        self.assertEqual(self.env["cs.prefab.project"].search_count([]), before)

    def test_a_series_without_a_name_still_has_a_label_in_the_backend(self):
        """Odoo's eigen terugval is "Unnamed", en vijf regels "Unnamed" is geen lijst."""
        one = self.env.ref("cs_prefab_website.reeks_1")
        self.assertFalse(one.name)
        self.assertTrue(one.display_name)
        self.assertNotIn("Unnamed", one.display_name)

    def test_the_gallery_is_in_the_sitemap_once(self):
        # De sitemap wordt 12 uur gecached als ir.attachment; gooi hem weg zodat dit de
        # huidige paginaset meet en niet die van een vorige test.
        self.env["ir.attachment"].search([("url", "like", "/sitemap")]).unlink()
        response = self.url_open("/sitemap.xml")
        self.assertEqual(response.status_code, 200)
        body = response.content.decode("utf-8")
        self.assertIn("/projecten", body)
        self.assertNotIn("/projecten/", body)

    # ------------------------------------------------------------------
    # Nieuws
    # ------------------------------------------------------------------

    def test_the_two_posts_moved_to_the_blog_and_the_index_lists_them(self):
        blog = self.env.ref("cs_prefab_website.blog_nieuws")
        self.assertEqual(blog.website_id, self.site)
        posts = self.env["blog.post"].search([("blog_id", "=", blog.id)])
        self.assertEqual(len(posts), 2)
        body = self.on_the_site("/nieuws")
        for post in posts:
            self.assertIn(post.name, body)
            self.assertIn(post.website_url, body)

    def test_the_news_cards_show_the_date_the_live_site_threw_away(self):
        """De artikelkop van het bericht draagt wél '7-mrt-2025 | Nieuws'; de kaarten niet.

        Het versheidssignaal bestond dus en werd weggegooid op precies de plek waar een
        bezoeker besluit of hij klikt.
        """
        body = self.on_the_site("/nieuws")
        self.assertIn("<time", body)
        self.assertIn("2025", body)

    def test_the_homepage_keeps_a_named_route_to_the_news_archive(self):
        """The approved home omits the dated teaser; the articles remain discoverable."""
        document = html.fromstring(self.on_the_site("/"))
        links = document.xpath("//a[@href='/nieuws']")
        self.assertTrue(links, "removing the teaser must not orphan the news archive")
        self.assertTrue(any("nieuws" in link.text_content().lower() for link in links))

    def test_the_old_flat_addresses_now_land_on_the_article(self):
        """Stage 1 liet ze naar /nieuws wijzen omdat de berichten nog niet bestonden."""
        for source, xmlid in (
                ("/onze-nieuwe-website-is-live", "cs_prefab_website.post_nieuwe_website"),
                ("/voordelen-van-een-prefab-aanbouw",
                 "cs_prefab_website.post_voordelen_prefab_aanbouw")):
            post = self.env.ref(xmlid)
            rewrite = self.env["website.rewrite"].search(
                [("website_id", "=", self.site.id), ("url_from", "=", source)], limit=1)
            self.assertTrue(rewrite, source)
            self.assertEqual(rewrite.url_to, post.website_url, source)
            self.assertEqual(rewrite.redirect_type, "301")

    # ------------------------------------------------------------------
    # De formulieren
    # ------------------------------------------------------------------

    def _submit(self, values):
        response = self.url_open("/website/form/crm.lead", data=values)
        self.assertEqual(response.status_code, 200, response.text[:200])
        return json.loads(response.text)

    def test_the_contact_form_creates_a_lead_and_keeps_what_was_typed(self):
        """De hoogste-omzetfout van elke Odoo-site: het formulier post en er blijft niets over.

        Geen UI-fout, geen serverlogregel, geen netwerkverzoek in het tabblad. Dit is de enige
        controle die hem vangt, en hij kijkt naar het record, niet naar het antwoord.
        """
        result = self._submit({
            "name": "Contactformulier prefabpartner.nl",
            "contact_name": "Jan de Vries",
            "Woonplaats": "Zoetermeer",
            "phone": "06 12 34 56 78",
            "email_from": "jan@example.com",
            "description": "Ik wil een aanbouw van 4 bij 6 meter.",
            "Toestemming": "Ja",
        })
        self.assertIn("id", result, result)
        lead = self.env["crm.lead"].browse(result["id"])
        self.assertTrue(lead.exists())
        self.assertEqual(lead.contact_name, "Jan de Vries")
        self.assertEqual(lead.phone, "06 12 34 56 78")
        self.assertEqual(lead.email_from, "jan@example.com")
        self.assertIn("4 bij 6 meter", lead.description)
        # Woonplaats staat niet op crm.lead; de formuliercontroller hangt onbekende velden
        # onder "Other Information" aan het standaardveld, en dat is description.
        self.assertIn("Zoetermeer", lead.description)
        self.assertIn("Toestemming", lead.description)

    def test_a_lead_from_this_site_lands_where_the_website_says(self):
        """Een lead zonder team is geen fout -- het is een lead die niemand krijgt.

        Bewust GEEN skipTest wanneer er geen standaardteam is: de deploy controleert de logregel
        "0 failed, 0 error(s) of <N> tests" op exact getal, en een test die zichzelf soms
        overslaat maakt dat getal afhankelijk van de inrichting van de database.
        """
        result = self._submit({
            "name": "Contactformulier prefabpartner.nl",
            "contact_name": "Test",
            "email_from": "test@example.com",
            "phone": "0612345678",
            "description": "Test",
        })
        lead = self.env["crm.lead"].browse(result["id"])
        self.assertTrue(lead.exists())
        if self.site.crm_default_team_id:
            self.assertEqual(lead.team_id, self.site.crm_default_team_id)
        else:
            # Geen standaardteam ingericht: dan hoort de lead er ook geen te krijgen, en
            # hoort de stap "zet het verkoopteam" in de ingebruiknamelijst te staan.
            self.assertFalse(lead.team_id)

    def test_the_partner_form_is_distinguishable_from_a_private_enquiry(self):
        """Op de live site belandt een aannemer in hetzelfde formulier als een particulier,
        zonder veld voor bedrijfsnaam, en in de mailbox is het verschil niet te zien."""
        result = self._submit({
            "name": "Partner worden — aanvraag via prefabpartner.nl",
            "partner_name": "Bouwbedrijf Janssen",
            "contact_name": "Piet Janssen",
            "KvK-nummer": "12345678",
            "phone": "0612345678",
            "email_from": "piet@example.com",
            "description": "Wij bouwen jaarlijks 30 woningen.",
            "Toestemming": "Ja",
        })
        lead = self.env["crm.lead"].browse(result["id"])
        self.assertEqual(lead.partner_name, "Bouwbedrijf Janssen")
        self.assertIn("Partner worden", lead.name)
        self.assertIn("12345678", lead.description)

    def test_a_submission_without_the_required_fields_is_refused(self):
        """Geweigerd, leesbaar geweigerd, zonder 500 en zonder halve lead.

        De kern laat een ONTBREKEND verplicht veld door: `extract_data` berekent
        `missing_required_fields` en hangt de uitzondering daarna aan `if any(error_fields):`
        (website/controllers/form.py:252-254), dus bij een inzending waarin het onderwerp
        simpelweg niet meekomt is die lijst leeg en loopt de controller door naar de INSERT.
        `crm.lead.name` is NOT NULL; de IntegrityError wordt afgevangen zonder rollback en de
        commit daarna geeft InFailedSqlTransaction -- HTTP 500, witte pagina, geen melding en
        geen lead. Zie models/crm_lead.py voor de haak die dat afvangt.
        """
        before = self.env["crm.lead"].search_count([])
        response = self.url_open("/website/form/crm.lead", data={"contact_name": "Alleen naam"})
        self.assertEqual(response.status_code, 200, response.text[:400])
        result = json.loads(response.text)
        self.assertNotIn("id", result, "een lead zonder onderwerp hoort geweigerd te worden")
        # Een weigering die niets zegt is de helft van het probleem: het formulier-widget
        # rendert `error` als statusmelding (form.js:417), dus daar hoort een zin in te staan.
        self.assertIn("error", result, result)
        self.assertIn("onderwerp", result["error"])
        self.assertEqual(self.env["crm.lead"].search_count([]), before,
                         "een geweigerde inzending mag geen halve lead achterlaten")

    # ------------------------------------------------------------------
    # Isolatie
    # ------------------------------------------------------------------

    def test_this_odoo_carries_one_website_and_it_is_the_one_serving_the_site(self):
        """What replaced "nothing reaches the other website", and why it is not simply deleted.

        That assertion measured a separation between two website records. There is no second record any more:
        the customer asked for one website on this Odoo, and the site was moved onto the existing default one.
        A test whose subject is gone has to be replaced rather than removed, or the control quietly disappears
        with it. What is worth asserting now is what would actually hurt if it broke: exactly one website
        exists, it is the default, and it is the one answering with the site.
        """
        websites = self.env["website"].search([])
        self.assertEqual(len(websites), 1, websites.mapped("name"))
        default = self.env["website"].search([], order="sequence, id", limit=1)
        self.assertEqual(websites, default)
        self.assertTrue(default.cs_prefab_site, "the one website must carry the site")
        self.assertIn("o_prefab_site", self.on_the_site("/"))

    def test_the_configurator_still_answers_on_the_website_that_had_it(self):
        """/prefab is het ding dat niet mag breken. Het staat hier voor de tweede keer, met
        opzet: deze fase raakt de configurator niet aan, en dat hoort meetbaar te blijven."""
        response = self.url_open("/prefab/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("ok"))

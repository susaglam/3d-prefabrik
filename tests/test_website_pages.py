"""What the shipped page templates must say, checked without an Odoo runtime.

The Odoo-side tests in ``addons/cs_prefab_website/tests/`` assert what the pages DO against a
real database, and they run for the first time in the clone test. These assert what the files
SAY, and they run in seconds on any machine. Two controls with different failure modes: delete
a template and the first kind fails; mistype an image id, an address or an alt attribute and
this one does.

Everything here is grounded in something outside itself -- the content inventory, the media
index, the URL map, the audit -- because a test that only compares the module to itself proves
that it is self-consistent, not that it is right.
"""
import ast
import csv
import json
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "addons" / "cs_prefab_website"
INVENTORY = ROOT / "docs" / "website" / "content-inventory.json"

PAGE_TEMPLATE_FILES = [
    "views/page_home.xml",
    "views/page_oplossingen.xml",
    "views/page_overige.xml",
    "views/project_templates.xml",
    "views/news_templates.xml",
    "views/offerte_templates.xml",
]
SNIPPET_FILES = [
    "views/snippets/s_prefab_usp.xml",
    "views/snippets/s_prefab_diensten.xml",
    "views/snippets/s_prefab_hotspots.xml",
]

# Every address this site answers. Anything a template links to that is not here, or under one
# of the prefixes, is a link that goes nowhere -- the defect that on the live site costs the
# customer leads on their best-ranking article.
ROUTES = {
    "/", "/over-ons", "/oplossingen", "/oplossingen/prefab-aanbouw",
    "/oplossingen/prefab-dakkapel", "/oplossingen/prefab-opbouw", "/projecten",
    "/partner-worden", "/contact", "/nieuws", "/offerte", "/offerte-prefab-opbouw",
    "/prefab", "/prefab/embed",
}
# Geen "/projecten/<iets>": de galerij is één pagina, en een reeks foto's heeft geen naam
# en dus geen eigen adres.
ROUTE_PREFIXES = ("/blog/", "/web/content/", "/web/image/", "#")


def module_file(relative):
    return (MODULE / relative).read_text(encoding="utf-8")


def templates_of(relative):
    return ET.parse(MODULE / relative).getroot().findall(".//template")


def all_page_markup():
    """Every page template, as an ElementTree root, keyed by its id."""
    pages = {}
    for relative in PAGE_TEMPLATE_FILES:
        for template in templates_of(relative):
            if template.get("inherit_id"):
                continue
            pages["%s:%s" % (relative, template.get("id"))] = template
    return pages


def media_slugs():
    """filename -> xmlid suffix, computed the same way models/site_media.py does."""
    import hashlib
    index = json.loads((MODULE / "data" / "media_index.json").read_text(encoding="utf-8"))
    slugs = {}
    for entry in index["files"]:
        if not entry.get("shipped"):
            continue
        filename = entry["filename"]
        stem = "".join(c if c.isalnum() else "_" for c in filename.lower())
        slugs["media_%s_%s" % (stem, hashlib.sha1(filename.encode()).hexdigest()[:8])] = entry
    return slugs


def every_attribute(name):
    """Every value of one attribute across every template file of the module."""
    found = []
    for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES + [
            "views/layout_templates.xml", "views/seo_templates.xml"]:
        tree = ET.parse(MODULE / relative)
        for element in tree.getroot().iter():
            value = element.get(name)
            if value:
                found.append((relative, element.tag, value))
    return found


class MediaReferenceTests(unittest.TestCase):
    """Every picture a page asks for must be a picture this module ships.

    A mistyped xmlid does not raise: /web/image answers with Odoo's placeholder and the page
    looks finished with a grey box in it. This is the only control that catches that, and it
    is the reason the ids may be pasted by hand at all.
    """

    def test_every_web_image_reference_resolves_to_a_shipped_file(self):
        slugs = media_slugs()
        pattern = re.compile(r"/web/(?:image|content)/cs_prefab_website\.(media_[\w]+)")
        seen = 0
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES + [
                "views/layout_templates.xml", "views/seo_templates.xml",
                "data/page_data.xml", "data/blog_data.xml"]:
            for match in pattern.finditer(module_file(relative)):
                seen += 1
                self.assertIn(match.group(1), slugs,
                              "%s verwijst naar een beeld dat dit module niet levert: %s"
                              % (relative, match.group(0)))
        self.assertGreater(seen, 30, "verwachtte tientallen beeldverwijzingen, vond %d" % seen)

    def test_every_static_reference_exists_on_disk(self):
        pattern = re.compile(r"/cs_prefab_website/(static/[\w\-./]+)")
        seen = 0
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES + ["views/layout_templates.xml"]:
            for match in pattern.finditer(module_file(relative)):
                seen += 1
                self.assertTrue((MODULE / match.group(1)).is_file(),
                                "%s verwijst naar %s, en dat bestand zit niet in het module"
                                % (relative, match.group(1)))
        self.assertGreater(seen, 10)

    def test_the_snippet_thumbnails_exist(self):
        """Een ontbrekende miniatuur is geen lege plek maar een kapot icoontje in de lade."""
        pattern = re.compile(r't-thumbnail="(/cs_prefab_website/[\w\-./]+)"')
        found = 0
        for relative in SNIPPET_FILES:
            for match in pattern.finditer(module_file(relative)):
                found += 1
                path = MODULE / match.group(1).replace("/cs_prefab_website/", "")
                self.assertTrue(path.is_file(), match.group(1))
        self.assertEqual(found, len(SNIPPET_FILES))


class LinkTests(unittest.TestCase):
    def test_no_page_links_to_nowhere(self):
        """href="#" is the measured defect on /voordelen-van-een-prefab-aanbouw/.

        The one exception is Odoo's own form submit, which IS an <a href="#"> with
        role="button": the widget binds to it and there is no native submit button.
        """
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES + ["views/layout_templates.xml"]:
            tree = ET.parse(MODULE / relative)
            for link in tree.getroot().iter("a"):
                classes = link.get("class") or ""
                if "s_website_form_send" in classes:
                    continue
                # Een adres dat de server samenstelt, kan dit bestand niet beoordelen; die
                # kant wordt door de controllertests en door scripts/verify-website.mjs
                # nagelopen, op de echt gerenderde pagina.
                if link.get("t-att-href") or link.get("t-attf-href"):
                    continue
                href = (link.get("href") or "").strip()
                self.assertTrue(href, "%s: <a> zonder href" % relative)
                self.assertNotEqual(href, "#", "%s: <a href='#'> zonder bestemming" % relative)

    def test_every_internal_link_points_at_an_address_this_site_serves(self):
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES + ["views/layout_templates.xml"]:
            tree = ET.parse(MODULE / relative)
            for link in tree.getroot().iter("a"):
                href = (link.get("href") or "").strip()
                if not href.startswith("/"):
                    continue
                clean = href.split("?")[0].split("#")[0]
                if clean in ROUTES or clean.startswith(ROUTE_PREFIXES):
                    continue
                self.fail("%s verwijst naar %s, en dat adres bestaat op deze site niet"
                          % (relative, href))

    def test_the_phone_number_and_the_mail_address_are_clickable(self):
        """Nul mailto: en nul tel: op alle veertien live pagina's -- dit is die reparatie."""
        footer = module_file("views/layout_templates.xml")
        self.assertIn('href="tel:+31624845453"', footer)
        self.assertIn('href="mailto:info@prefabpartner.nl"', footer)


class HeadingTests(unittest.TestCase):
    def test_every_page_has_exactly_one_h1(self):
        for key, template in all_page_markup().items():
            if key.endswith(("prefab_news_card", "offerte_frame")):
                continue
            markup = ET.tostring(template, encoding="unicode")
            if 't-call="website.layout"' not in markup:
                continue
            count = len(template.findall(".//h1"))
            self.assertEqual(count, 1, "%s heeft %d maal <h1>" % (key, count))

    def test_the_usp_bar_is_a_list_and_not_four_headings(self):
        """Tien live pagina's beginnen met vier <h4>'s vóór de <h1>. Dat is een opsomming.

        Op de geparste boom en niet op de bestandstekst: het commentaar erboven noemt <h4> en
        <h1> als uitleg, en een grep vindt dan iets dat er niet staat.
        """
        for template in templates_of("views/snippets/s_prefab_usp.xml"):
            if template.get("inherit_id"):
                continue
            self.assertTrue(template.findall(".//ul"))
            for level in ("h1", "h2", "h3", "h4", "h5", "h6"):
                self.assertEqual(template.findall(".//%s" % level), [], level)

    def test_the_module_stylesheet_sets_no_heading_size_at_all(self):
        """🪤 Een specificiteitssom die precies andersom uitviel dan het commentaar beweerde.

        `.o_prefab_site h3` is (0,1,1); Odoo's `.h5-fs{font-size:1.25rem}` is (0,1,0) en draagt
        geen !important. De moduleregel won dus, en elke `<h3 class="h5-fs">` stond op h3-maat:
        op de dienstenkaarten, op de folderlinks en op elke sectiekop met een maatklasse. Het
        commentaar in de stylesheet beweerde het omgekeerde, dus niemand ging het narekenen.

        **Corrected 2026-09-20:** deze test eiste tot vandaag de `:not([class*="-fs"])`-wacht
        in prefab_site.scss. Die wacht maakte de bewering wáár, maar hij loste het verkeerde
        probleem op: de schaal stond in het bestand in plaats van in het thema, dus de eigenaar
        kon hem nergens wijzigen. In golf 1 is de hele clamp()-schaal een reeks themawaarden
        geworden (`h1-font-size`..`h6-font-size`, gezaaid door `_cs_prefab_website_values`), en
        daarmee is de wacht niet meer nodig maar overbodig: er is geen moduleregel meer om van
        te winnen. Wat de test nu bewaakt is het sterkere feit -- de stylesheet zet NERGENS een
        kopmaat, dus hij kan de maatklassen van de bouwer per definitie niet overrulen.
        """
        text = module_file("static/src/scss/prefab_site.scss")
        code = re.sub(r"(?m)^\s*//.*$", "", text)
        for level in range(1, 7):
            self.assertNotRegex(code, r"\n\s+\.?h%d[^{\n]*\{[^}]*font-size" % level,
                                "h%d krijgt een maat uit de module in plaats van uit het thema"
                                % level)
        # En geen tweede weg naar dezelfde maat: de oude clamp()-typeschaal is ook echt weg.
        self.assertNotIn("$prefab-sizes", code)

    def test_the_size_classes_that_the_templates_ask_for_actually_exist(self):
        """Een klasse die nergens bestaat is een maat die nooit aankomt. Odoo levert hN-fs voor
        1 tot en met 6; een typefout als `h7-fs` of `h4-fs-` valt stil weg."""
        allowed = {"h%d-fs" % level for level in range(1, 7)}
        allowed |= {"display-%d-fs" % level for level in range(1, 5)}
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES:
            for found in re.findall(r'class="[^"]*?\b([a-z0-9-]+-fs)\b', module_file(relative)):
                self.assertIn(found, allowed, "%s: %s" % (relative, found))

    def test_the_footer_labels_are_not_headings(self):
        """De voettekst staat onder élke pagina; <h5> daar breekt elke koppenstructuur."""
        tree = ET.parse(MODULE / "views" / "layout_templates.xml")
        for template in tree.getroot().findall(".//template"):
            if template.get("id") != "prefab_footer":
                continue
            for level in ("h1", "h2", "h3", "h4", "h5", "h6"):
                self.assertEqual(template.findall(".//%s" % level), [],
                                 "de voettekst draagt een <%s>" % level)


class ImageTests(unittest.TestCase):
    def test_every_image_carries_an_alt_attribute(self):
        """Leeg mag: dat is hoe je een decoratie markeert. Ontbreken mag niet."""
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES + ["views/layout_templates.xml"]:
            tree = ET.parse(MODULE / relative)
            for image in tree.getroot().iter("img"):
                has_alt = image.get("alt") is not None or image.get("t-att-alt") is not None
                self.assertTrue(has_alt, "%s: <img src=%r> zonder alt"
                                % (relative, image.get("src") or image.get("t-attf-src")))

    def test_only_each_pages_first_editor_image_loads_eagerly(self):
        """An eager LCP photograph is a per-page budget, not a site-wide count."""
        for key, template in all_page_markup().items():
            if template.find(".//t[@t-call='website.layout']") is None:
                continue
            images = list(template.iter("img"))
            eager = [image for image in images if image.get("loading") != "lazy"]
            self.assertLessEqual(len(eager), 1, (key, [i.get("src") for i in eager]))
            if eager:
                self.assertIs(eager[0], images[0], key)
                self.assertEqual(eager[0].get("loading"), "eager", key)
                self.assertIn("img", eager[0].get("class", "").split(), key)
                self.assertIn("img-fluid", eager[0].get("class", "").split(), key)
        for relative in SNIPPET_FILES:
            for image in ET.parse(MODULE / relative).getroot().iter("img"):
                self.assertEqual(image.get("loading"), "lazy", relative)

    def test_editable_images_do_not_seed_fixed_pixels_through_native_sanitization(self):
        """19.4 sanitize.js converts width/height attributes to fixed inline pixels.

        Reproduced in the native editor: a 1600x1200 image became 672x1200 after
        Bootstrap constrained its width. Editor-owned inline sizing can change; the
        !important w-100 utility cannot. Controller gallery images are outside this
        editable contract and keep their dimensions for loading stability.
        """
        checked = 0
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES:
            root = ET.parse(MODULE / relative).getroot()
            parents = {child: parent for parent in root.iter() for child in parent}
            for image in root.iter("img"):
                ancestor = parents.get(image)
                editable = False
                while ancestor is not None:
                    if ("oe_structure" in ancestor.get("class", "").split()
                            or ancestor.get("data-snippet")):
                        editable = True
                        break
                    ancestor = parents.get(ancestor)
                if not editable:
                    continue
                checked += 1
                label = "%s: %s" % (relative, image.get("src"))
                with self.subTest(image=label):
                    self.assertIsNone(image.get("width"), label)
                    self.assertIsNone(image.get("height"), label)
                    self.assertNotIn("w-100", image.get("class", "").split(), label)
                    style = dict(part.strip().split(":", 1)
                                 for part in image.get("style", "").split(";") if ":" in part)
                    for property_name in ("width", "height"):
                        self.assertNotIn("!important", style.get(property_name, ""), label)
                    if "o_card_img" in image.get("class", "").split():
                        self.assertNotIn("height", style, "Native card ratio owns image height: " + label)
        self.assertGreater(checked, 0)
        gallery = ET.parse(MODULE / "views/project_templates.xml").getroot()
        thumbnail = next(image for image in gallery.iter("img") if image.get("t-attf-srcset"))
        lightbox = gallery.find(".//img[@class='o_prefab_lightbox_image']")
        self.assertEqual((thumbnail.get("width"), thumbnail.get("height")), ("400", "300"))
        self.assertEqual((lightbox.get("width"), lightbox.get("height")), ("1600", "1200"))


class GalleryDataTests(unittest.TestCase):
    """De 36 foto's van de live galerij, in de volgorde van de live galerij.

    De klant heeft de projecten niet als benoemde items op de site gezet maar als galerij. Deze
    klasse toetst dat wat dit module levert diezelfde galerij is -- niet ongeveer, maar foto voor
    foto en in dezelfde volgorde -- en dat er geen woord in staat dat niemand heeft geschreven.
    """

    @staticmethod
    def spec():
        return json.loads((MODULE / "data" / "projects.json").read_text(encoding="utf-8"))

    @staticmethod
    def gallery_items():
        """De 36 foto's van de live galerij, in bronvolgorde, op hun ORIGINELE bestandsnaam.

        De inventaris noemt per item de miniatuurvariant in `src` en het origineel in
        `local_asset`; dat laatste is wat het module verscheept.
        """
        data = json.loads(INVENTORY.read_text(encoding="utf-8"))
        for page in data["pages"]:
            if page.get("slug") != "projecten":
                continue
            for section in page["sections"]:
                for module in section.get("modules", []):
                    if module.get("kind") != "gallery":
                        continue
                    return module["items"]
        raise AssertionError("de galerij van /projecten staat niet in de inventaris")

    def photographs(self):
        """De foto's die dit module toont, plat, in dezelfde volgorde als de pagina ze rendert.

        Eerst op `sequence` van de reeks, daarbinnen op de volgorde in het bestand -- precies
        wat `cs.prefab.project._gallery_photos` in Odoo oplevert en wat
        `scripts/preview_website.py` in de voorbeeldweergave doet.
        """
        out = []
        for series in sorted(self.spec()["projects"], key=lambda item: item.get("sequence", 10)):
            out.extend(series["images"])
        return out

    def test_the_gallery_is_the_live_gallery_photo_for_photo_and_in_order(self):
        """Het anker staat BUITEN dit module: de inventaris van de oude site.

        Een test die de galerij alleen met zichzelf vergelijkt, bewijst dat hij consistent is
        en niet dat hij klopt. Dit is de enige controle die zou omvallen als er een foto
        verdween, er een bij kwam, of de volgorde van de klant werd herschikt.
        """
        expected = [item["local_asset"] for item in self.gallery_items()]
        actual = [filename for filename, _alt in self.photographs()]
        self.assertEqual(len(actual), len(set(actual)), "een foto zit in twee reeksen")
        self.assertEqual(actual, expected,
                         "de galerij wijkt af van die van de live site")

    def test_every_photograph_has_a_written_description(self):
        for filename, alt in self.photographs():
            self.assertTrue(alt and len(alt) > 20,
                            "%s heeft geen echte alt-tekst: %r" % (filename, alt))
            self.assertNotIn(".jpg", alt.lower())
            self.assertNotIn(".webp", alt.lower())

    def test_every_shipped_photograph_exists(self):
        for filename, _alt in self.photographs():
            self.assertTrue((MODULE / "static" / "src" / "media" / filename).is_file(), filename)

    def test_nothing_is_named_that_the_source_does_not_name(self):
        """Titels, omschrijvingen en soorten bestaan niet in de bron, dus ook niet hier.

        Tot 2026-09-17 droegen drie van de vijf reeksen een titel die niemand had geschreven
        ("Aanbouw met houten lattengevel", "Prefab dakkapellen op een nieuwbouwwoning", "Prefab
        elementen voor een nieuwbouwwoning"), plus een korte omschrijving per reeks en een
        indeling in soorten waar de galerij op filterde. De live pagina draagt geen van die
        dingen: 36 foto's, geen titels, geen bijschriften, geen plaatsnamen behalve de twee die
        in de alt-teksten van WordPress staan.
        """
        for series in self.spec()["projects"]:
            for invented in ("name", "summary", "project_type", "slug", "year", "body", "story"):
                self.assertNotIn(invented, series,
                                 "%s draagt %r, en dat staat nergens in de bron"
                                 % (series["key"], invented))

    def test_the_only_place_names_are_the_two_the_source_carries(self):
        """Den Haag en Zoetermeer, en die staan in de alt-teksten van de bron zelf."""
        source_alts = " | ".join(item.get("alt") or "" for item in self.gallery_items())
        for series in self.spec()["projects"]:
            place = series["location"]
            if not place:
                continue
            self.assertIn(place, ("Den Haag", "Zoetermeer"), series["key"])
            self.assertIn(place, source_alts,
                          "%r staat niet in de alt-teksten van de live galerij" % place)
        places = {series["location"] for series in self.spec()["projects"] if series["location"]}
        self.assertEqual(places, {"Den Haag", "Zoetermeer"})

    def test_every_photograph_of_a_placed_series_shows_that_place(self):
        """De twee plaatsnamen die er zijn, zijn ook de twee die de pagina toont."""
        markup = module_file("views/project_templates.xml")
        self.assertIn("photo.project_id.location", markup)
        self.assertIn("o_prefab_shot_place", markup)

    def test_the_series_keys_are_neutral(self):
        """Een sleutel is een naam, en een naam die iets beweert is ook verzonnen.

        `project_dakkapellen` als xmlid beweert dat die reeks over dakkapellen gaat. Dat is
        precies de soort bewering die hier weg moest.
        """
        keys = [series["key"] for series in self.spec()["projects"]]
        self.assertEqual(len(keys), len(set(keys)))
        for key in keys:
            self.assertRegex(key, r"^reeks_\d+$", key)


class GalleryTemplateTests(unittest.TestCase):
    """De vergroting die de klant vroeg, gelezen als opmaak.

    Alles hier faalt op een manier die je in een browser pas merkt als je precies de juiste
    dingen probeert: een venster dat al open staat voor wie geen JavaScript heeft, een knop
    zonder naam, een miniatuur die zonder script nergens heen gaat.
    """

    def gallery(self):
        for template in templates_of("views/project_templates.xml"):
            if template.get("id") == "projects_index":
                return template
        raise AssertionError("projects_index ontbreekt")

    def test_a_thumbnail_is_a_real_link_to_the_photograph(self):
        """Zonder JavaScript hoort een klik de foto te openen, niet niets te doen."""
        markup = ET.tostring(self.gallery(), encoding="unicode")
        self.assertIn('t-attf-href="/web/image/cs.prefab.project.image/{{photo.id}}/image/1600x1600"',
                      markup)

    def test_the_lightbox_ships_hidden_and_says_what_it_is(self):
        box = self.gallery().findall(".//div[@data-prefab-lightbox]")
        self.assertEqual(len(box), 1)
        box = box[0]
        self.assertEqual(box.get("hidden"), "hidden",
                         "zonder hidden staat de vergroting open voor wie geen script krijgt")
        self.assertEqual(box.get("role"), "dialog")
        self.assertEqual(box.get("aria-modal"), "true")
        self.assertTrue(box.get("aria-label"))
        # Sluiten, vorige, volgende -- en elk met een naam, want er staat een pictogram in.
        buttons = box.findall(".//button")
        self.assertEqual(len(buttons), 3)
        for button in buttons:
            self.assertEqual(button.get("type"), "button")
            self.assertTrue(button.get("aria-label"), ET.tostring(button, encoding="unicode"))
        self.assertTrue(box.findall(".//*[@data-prefab-lightbox-close]"))
        self.assertEqual(len(box.findall(".//*[@data-prefab-lightbox-step]")), 2)

    def test_the_enlarged_image_starts_without_a_source(self):
        """Een lege `src` laat sommige browsers de PAGINA ophalen als afbeelding."""
        image = self.gallery().findall(".//img[@class='o_prefab_lightbox_image']")
        self.assertEqual(len(image), 1)
        self.assertIsNone(image[0].get("src"))
        self.assertEqual(image[0].get("alt"), "")

    def test_the_script_can_close_move_and_trap_the_focus(self):
        script = module_file("static/src/js/prefab_site.js")
        for needle in ('"Escape"', '"ArrowRight"', '"ArrowLeft"', '"Tab"',
                       "opener.focus()", "preventDefault"):
            self.assertIn(needle, script, needle)

    def test_every_thumbnail_asks_for_a_size_it_is_actually_shown_at(self):
        """Drie maten en een `sizes`. Zonder dat haalt een telefoon 36 keer een foto binnen die
        vier keer te groot is -- de zwaarste meetbare fout op de oude pagina."""
        markup = ET.tostring(self.gallery(), encoding="unicode")
        for size in ("240x240", "400x400", "600x600"):
            self.assertIn(size, markup, size)
        self.assertIn('sizes="(min-width: 992px) 25vw, (min-width: 768px) 33vw, 50vw"', markup)

    def test_the_three_films_keep_their_controls_and_their_poster(self):
        videos = self.gallery().findall(".//video")
        self.assertEqual(len(videos), 3)
        for video in videos:
            self.assertEqual(video.get("controls"), "controls")
            self.assertEqual(video.get("preload"), "none")
            self.assertTrue(video.get("poster"))
            # Een <video> zonder toegankelijke naam heet "video" bij een schermlezer. De drie
            # beschrijvingen zijn die van de overlaybeelden van de oude site; zelfde scène.
            self.assertTrue(video.get("aria-label"))
            self.assertGreater(len(video.get("aria-label")), 30)


class FormTests(unittest.TestCase):
    """The structural invariants of an Odoo website form, which fail silently when broken.

    Two traps, and the first hides the second: without `s_website_form` on the root <form> the
    widget never binds and clicking Send produces ZERO network requests; without
    `#s_website_form_result` inside the form the widget throws on the first response and the
    visitor sees neither an error nor a confirmation.
    """

    def forms(self):
        found = []
        for relative in PAGE_TEMPLATE_FILES:
            tree = ET.parse(MODULE / relative)
            for form in tree.getroot().iter("form"):
                found.append((relative, form))
        return found

    def test_there_are_two_forms_and_both_create_a_lead(self):
        forms = self.forms()
        self.assertEqual(len(forms), 2, [relative for relative, _ in forms])
        for relative, form in forms:
            self.assertEqual(form.get("data-model_name"), "crm.lead", relative)
            self.assertEqual(form.get("action"), "/website/form/", relative)

    def test_every_form_sits_inside_a_section_that_carries_the_widget_class(self):
        for relative in PAGE_TEMPLATE_FILES:
            tree = ET.parse(MODULE / relative)
            for section in tree.getroot().iter("section"):
                if section.findall(".//form"):
                    self.assertIn("s_website_form", section.get("class") or "", relative)

    def test_every_form_can_report_success_and_failure(self):
        for relative, form in self.forms():
            results = [element for element in form.iter()
                       if element.get("id") == "s_website_form_result"]
            self.assertEqual(len(results), 1,
                             "%s: geen (of meer dan één) #s_website_form_result IN het formulier"
                             % relative)
            sends = [element for element in form.iter("a")
                     if "s_website_form_send" in (element.get("class") or "")]
            self.assertEqual(len(sends), 1, relative)

    def test_the_confirmation_is_a_sibling_of_the_form_and_starts_hidden(self):
        """De widget zoekt `.s_website_form_end_message` op form.parentNode, niet erbinnen."""
        for relative in PAGE_TEMPLATE_FILES:
            tree = ET.parse(MODULE / relative)
            for parent in tree.getroot().iter():
                forms = [child for child in parent if child.tag == "form"]
                if not forms:
                    continue
                messages = [child for child in parent
                            if "s_website_form_end_message" in (child.get("class") or "")]
                self.assertEqual(len(messages), 1,
                                 "%s: het bevestigingsblok is geen broer van het formulier"
                                 % relative)
                self.assertIn("d-none", messages[0].get("class"), relative)
                self.assertEqual(forms[0].get("data-success-mode"), "message", relative)

    def test_the_required_fields_are_required_on_both_sides(self):
        for relative, form in self.forms():
            required = [element for element in form.iter("input")
                        if element.get("required")]
            required += [element for element in form.iter("textarea")
                         if element.get("required")]
            self.assertGreaterEqual(len(required), 5, relative)
            for element in required:
                container = None
                for candidate in form.iter("div"):
                    if element in list(candidate.iter()) and "s_website_form_field" in (candidate.get("class") or ""):
                        container = candidate
                self.assertIsNotNone(container, "%s: %s" % (relative, element.get("name")))
                self.assertIn("s_website_form_required", container.get("class"),
                              "%s: %s is required in HTML maar niet gemarkeerd voor de bouwer"
                              % (relative, element.get("name")))

    def test_the_lead_carries_a_subject_because_the_model_requires_one(self):
        for relative, form in self.forms():
            names = {element.get("name") for element in form.iter("input")}
            self.assertIn("name", names, "%s: crm.lead.name is verplicht op het model" % relative)

    def test_every_field_has_a_visible_label_bound_to_its_control(self):
        """Placeholder-als-label verdwijnt zodra iemand typt, en schermlezers krijgen niets."""
        for relative, form in self.forms():
            labels = {label.get("for") for label in form.iter("label") if label.get("for")}
            for element in list(form.iter("input")) + list(form.iter("textarea")):
                if element.get("type") == "hidden":
                    continue
                self.assertIn(element.get("id"), labels,
                              "%s: %s heeft geen <label for>" % (relative, element.get("id")))

    def test_the_contact_fields_are_the_ones_the_live_form_asks_for(self):
        tree = ET.parse(MODULE / "views" / "page_overige.xml")
        form = None
        for candidate in tree.getroot().iter("form"):
            ids = {element.get("id") for element in candidate.iter("input")}
            if "prefab_contact_naam" in ids:
                form = candidate
        self.assertIsNotNone(form)
        names = [element.get("name") for element in form.iter()
                 if element.tag in ("input", "textarea") and element.get("type") != "hidden"]
        # Naam, Woonplaats, Telefoon, Email, Je bericht -- de vijf velden van het live
        # formulier, in dezelfde volgorde -- plus het toestemmingsvinkje.
        self.assertEqual(names, ["contact_name", "Woonplaats", "phone", "email_from",
                                 "description", "Toestemming"])

    def test_autocomplete_is_filled_in_where_a_phone_can_help(self):
        for relative, form in self.forms():
            for element in form.iter("input"):
                if element.get("name") in ("contact_name", "phone", "email_from", "partner_name"):
                    self.assertTrue(element.get("autocomplete"),
                                    "%s: %s zonder autocomplete" % (relative, element.get("name")))


class StructuredDataTests(unittest.TestCase):
    def blocks(self):
        found = []
        for relative in ["views/seo_templates.xml", "views/page_overige.xml"]:
            tree = ET.parse(MODULE / relative)
            for script in tree.getroot().iter("script"):
                if script.get("type") == "application/ld+json":
                    found.append((relative, json.loads(script.text)))
        return found

    def test_both_blocks_are_valid_json(self):
        types = {block["@type"] for _relative, block in self.blocks()}
        self.assertEqual(types, {"HomeAndConstructionBusiness", "FAQPage"})

    def test_the_organisation_carries_what_a_local_search_needs(self):
        block = next(b for _r, b in self.blocks() if b["@type"] == "HomeAndConstructionBusiness")
        self.assertEqual(block["address"]["streetAddress"], "Lange Kleiweg 62b")
        self.assertEqual(block["address"]["postalCode"], "2288 GK")
        self.assertEqual(block["address"]["addressLocality"], "Rijswijk")
        self.assertEqual(block["telephone"], "+31624845453")
        self.assertTrue(block["areaServed"])
        self.assertTrue(block["sameAs"])
        # Facebook blijft eruit tot de klant een adres levert dat geen HTTP 400 geeft.
        self.assertFalse([url for url in block["sameAs"] if "facebook" in url])

    def test_the_company_details_have_one_value_and_not_two(self):
        """De naam, het adres en het nummer staan op twee plekken; ze moeten gelijk zijn."""
        block = next(b for _r, b in self.blocks() if b["@type"] == "HomeAndConstructionBusiness")
        footer = module_file("views/layout_templates.xml")
        self.assertIn("Lange Kleiweg 62b", footer)
        self.assertIn("2288 GK Rijswijk", footer)
        self.assertIn(block["telephone"], footer.replace(" ", "").replace("0624845453", "+31624845453"))
        self.assertIn(block["email"], footer)

    def test_the_faq_block_holds_the_nine_questions_of_the_live_site(self):
        block = next(b for _r, b in self.blocks() if b["@type"] == "FAQPage")
        questions = [entry["name"] for entry in block["mainEntity"]]
        self.assertEqual(len(questions), 9)
        page = module_file("views/page_overige.xml")
        for question in questions:
            self.assertIn(question, page,
                          "%r staat in de structured data maar niet op de pagina" % question)

    def test_the_structured_data_is_outside_every_builder_region(self):
        """Alles binnen een oe_structure gaat bij het opslaan door de sanitizer."""
        for relative in ["views/seo_templates.xml", "views/page_overige.xml"]:
            tree = ET.parse(MODULE / relative)
            for parent in tree.getroot().iter():
                if "oe_structure" not in (parent.get("class") or ""):
                    continue
                for script in parent.iter("script"):
                    self.fail("%s: een <script> binnen een oe_structure overleeft geen "
                              "bewerking in de bouwer" % relative)


class SeoTests(unittest.TestCase):
    def page_records(self):
        records = []
        for relative in ["data/page_data.xml", "views/offerte_templates.xml"]:
            tree = ET.parse(MODULE / relative)
            for record in tree.getroot().iter("record"):
                if record.get("model") != "website.page":
                    continue
                fields = {field.get("name"): (field.text or "") for field in record.iter("field")}
                records.append((relative, fields))
        return records

    def test_every_page_carries_a_real_description(self):
        """Negen van de veertien live omschrijvingen zijn niet meer dan een echo van de titel."""
        for relative, fields in self.page_records():
            description = fields.get("website_meta_description", "")
            self.assertGreaterEqual(len(description), 90,
                                    "%s (%s): omschrijving van %d tekens"
                                    % (fields.get("url"), relative, len(description)))
            self.assertLessEqual(len(description), 175, fields.get("url"))
            self.assertNotEqual(description.strip().rstrip("."),
                                fields.get("name", "").strip(),
                                "%s: de omschrijving herhaalt de titel" % fields.get("url"))

    def test_every_page_carries_its_own_share_image(self):
        """Acht live pagina's tonen een leeg grijs kaartje bij delen; drie delen er één foto.

        Deze test sloeg tot 2026-09-17 een pagina ZONDER ``website_meta_og_img`` over
        (``continue``) en telde daarna of er acht overbleven. Precies het defect dat hij
        beschrijft — een pagina zonder deelafbeelding — was dus onzichtbaar voor hem, en
        /offerte en /offerte-prefab-opbouw hadden er geen. Een ontbrekend veld is nu een fout.
        """
        images = []
        for relative, fields in self.page_records():
            self.assertIn("website_meta_og_img", fields,
                          "%s (%s) heeft geen deelafbeelding: delen levert een grijs kaartje"
                          % (fields.get("url"), relative))
            self.assertTrue(fields["website_meta_og_img"].strip(), fields.get("url"))
            images.append(fields["website_meta_og_img"])
        self.assertGreaterEqual(len(images), 10)
        self.assertEqual(len(images), len(set(images)),
                         "twee pagina's delen dezelfde foto: %s" % images)

    def test_the_homepage_title_no_longer_starts_with_welkom(self):
        titles = {fields.get("url"): fields.get("website_meta_title", "")
                  for _relative, fields in self.page_records()}
        self.assertFalse(titles["/"].lower().startswith("welkom"), titles["/"])
        self.assertIn("prefab", titles["/"].lower())

    def test_the_controller_pages_carry_their_own_description(self):
        source = module_file("controllers/main.py")
        for block in ("PROJECTS_META", "NEWS_META"):
            self.assertIn(block, source)
            self.assertIn("prefab_meta_description", source)
            self.assertIn("prefab_og_image", source)
        self.assertIn('t-if="prefab_meta_description"', module_file("views/seo_templates.xml"))


class CopyTests(unittest.TestCase):
    """The customer's own words, verbatim, checked against the research inventory."""

    @staticmethod
    def inventory_sentences():
        return INVENTORY.read_text(encoding="utf-8")

    def test_product_copy_keeps_the_source_backed_scope(self):
        """The approved redesign may replace slogans; product facts keep their source."""
        source = self.inventory_sentences()
        templates = {t.get("id"): t for t in templates_of("views/page_oplossingen.xml")}
        expected = {
            "page_prefab_aanbouw": "Wil je jouw woning uitbreiden met een extra kamer, kantoor of leefruimte?",
            "page_prefab_dakkapel": "Met een prefab dakkapel voeg je eenvoudig ruimte en licht toe aan jouw woning.",
            "page_prefab_opbouw": "Heb je behoefte aan meer woonruimte, maar geen ruimte om uit te breiden?",
        }
        for template_id, sentence in expected.items():
            text = " ".join(templates[template_id].itertext())
            self.assertIn(sentence, text, template_id)
            self.assertIn(sentence, source, template_id)
        for product in ("dakkapel", "opbouw"):
            template = templates["page_prefab_" + product]
            self.assertNotIn("configurator", " ".join(template.itertext()).lower(), product)
            self.assertFalse(template.findall(".//a[@href='/offerte']"), product)
            links = template.findall(".//a[@href='/contact']")
            self.assertTrue(any(product in " ".join(link.itertext()).lower() for link in links), product)

    def test_the_two_posts_carry_their_own_text(self):
        blog = module_file("data/blog_data.xml")
        source = self.inventory_sentences()
        for sentence in [
                "We zijn blij om te delen dat onze nieuwe website online is!",
                "Het verhaal achter ons logo",
                "Wil je snel en zonder gedoe extra woonruimte?",
                "Strakke afwerking en flexibiliteit",
        ]:
            self.assertIn(sentence, blog)
            self.assertIn(sentence, source)

    def test_the_dead_button_of_the_second_post_now_goes_somewhere(self):
        """De enige bevinding waarvan zeker is dat hij vandaag leads kost.

        Op de geparste boom: de uitleg bovenaan het databestand citeert het defect letterlijk
        (`href="#"`), en een grep vindt dan zijn eigen commentaar terug.
        """
        tree = ET.parse(MODULE / "data" / "blog_data.xml")
        links = [link for link in tree.getroot().iter("a")]
        self.assertTrue(links)
        for link in links:
            self.assertTrue((link.get("href") or "").strip() not in ("", "#"),
                            "een link in een bericht gaat nergens heen: %r" % (link.text,))
        targets = {link.get("href") for link in links}
        self.assertIn("/offerte", targets)

    def test_the_unsubstantiated_guarantee_is_not_carried_over(self):
        """"100% tevredenheidsgarantie" stond zonder voorwaarden op /projecten/.

        Een onvoorwaardelijke garantiebelofte is een uiting die je waar moet kunnen maken. Hij
        komt terug zodra de klant zegt wat hij inhoudt; tot dan staat hij er niet.
        """
        markup = "".join(module_file(relative) for relative in PAGE_TEMPLATE_FILES)
        self.assertNotIn("tevredenheidsgarantie", markup)

    def test_the_typo_of_the_live_site_is_corrected(self):
        markup = module_file("views/project_templates.xml")
        self.assertIn("Vrijblijvend adviesgesprek", markup)
        self.assertNotIn("advies gesprek", markup)


class SnippetTests(unittest.TestCase):
    def test_every_custom_snippet_is_registered_in_the_builder_panel(self):
        for relative in SNIPPET_FILES:
            text = module_file(relative)
            self.assertIn('inherit_id="website.snippets"', text, relative)
            # 🪤 In saas~19.4 is de selector <snippets>, niet de oude //div[@id=...].
            self.assertIn("//snippets[@id='snippet_structure']", text, relative)
            self.assertIn("t-snippet=", text, relative)
            self.assertIn("group=", text, relative)

    def test_the_process_steps_keep_their_connector_nodes(self):
        """De bouwerplugin schrijft style.left op .s_process_step_connector ZONDER null-check.

        Ze weghalen laat de publieke pagina heel en gooit de BOUWER om -- en een HTTP-controle
        ziet daar niets van. Ze staan er dus in en worden in de stylesheet verborgen.
        """
        found = 0
        for relative in PAGE_TEMPLATE_FILES:
            tree = ET.parse(MODULE / relative)
            for step in tree.getroot().iter("div"):
                if "s_process_step" not in (step.get("class") or "").split():
                    continue
                found += 1
                connectors = [element for element in step.iter()
                              if "s_process_step_connector" in (element.get("class") or "")]
                self.assertEqual(len(connectors), 1,
                                 "%s: een stap zonder verbindings-SVG" % relative)
                self.assertTrue(list(connectors[0].iter("{http://www.w3.org/2000/svg}path"))
                                or list(connectors[0].iter("path")),
                                "%s: de verbindings-SVG heeft geen <path>" % relative)
        self.assertGreaterEqual(found, 6)
        self.assertIn("s_process_step_connector { display: none",
                      module_file("static/src/scss/prefab_site.scss"))

    def test_optional_reusable_snippets_keep_one_definition_and_resolvable_calls(self):
        """Reusable blocks remain available; the design need not repeat them on every page."""
        definitions = {}
        for relative in SNIPPET_FILES:
            for template in templates_of(relative):
                if not template.get("inherit_id"):
                    key = "cs_prefab_website." + template.get("id")
                    definitions[key] = definitions.get(key, 0) + 1
        for name in ("s_prefab_usp", "s_prefab_diensten", "s_prefab_hotspots"):
            self.assertEqual(definitions.get("cs_prefab_website." + name), 1, name)
        for relative in PAGE_TEMPLATE_FILES:
            for node in ET.parse(MODULE / relative).getroot().iter("t"):
                called = node.get("t-call", "")
                if called.startswith("cs_prefab_website.s_prefab_"):
                    self.assertEqual(definitions.get(called), 1, (relative, called))


class MotionTests(unittest.TestCase):
    def stylesheet(self):
        return module_file("static/src/scss/prefab_site.scss")

    def code(self):
        """De stylesheet zonder commentaar. Het commentaar LEGT de weggehaalde waarden uit --
        een greptest die daar overheen loopt, faalt op zijn eigen toelichting."""
        return re.sub(r"(?m)//.*$", "", self.stylesheet())

    def test_no_rule_carries_a_curve_a_colour_or_a_duration_of_its_own(self):
        """Herzien 2026-09-20. Eén BRON per waarde, en de kop van het bestand moet WAAR zijn.

        Deze test telde tot vandaag alleen cubic-beziers. De kop van prefab_site.scss beweerde
        daarnaast dat er 'GEEN losse hexwaarde' en 'GEEN los aantal milliseconden' meer in
        stond, en dat was onwaar: 35 letterlijke `rgba()`-waarden, waarvan er twintig de
        inktkleur opnieuw intypten, plus twee losse `180ms`. Een bewering in een bestandskop
        die niemand naleest, is precies het soort documentatiefout waar de vorige ronde ook al
        op strandde (zie de koptest hierboven).

        Golf 1 haalt de reden weg om er ooit nog één te typen: kleur komt van de combinatie
        (`var(--o-cc-bg)`, `var(--color)`, `var(--o-color-1)`, `var(--o-ccN-bg)`) of uit
        `color-mix()` daarvan, maat en vorm komen uit het thema. Dus wordt de bewering nu
        teruggelezen in plaats van geloofd.
        """
        text = self.code()

        # 1. Geen kale hex, nergens.
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{3,8}\b", text), [],
                         "een hexwaarde hoort in de themawaarden, niet hier")
        # 2. Geen kale rgb()/rgba(): een hairline of sluier is color-mix() op de combinatie,
        #    zodat hij op een lichte én een donkere sectie klopt.
        self.assertEqual(re.findall(r"\brgba?\(", text), [],
                         "gebruik color-mix(in srgb, var(--color) N%, transparent)")
        # 3. Geen los aantal milliseconden buiten het tokenblok.
        loose = [m.group(0) for m in re.finditer(r"\b\d+ms\b", text)
                 if not re.search(r"--prefab-(dur-[\w-]+|stagger):\s*$", text[:m.start()])]
        self.assertEqual(loose, [], "een duur hoort uit een token te komen")

        # 4. En de curves, zoals voorheen: precies twee tokens, allebei echt gebruikt.
        definitions = re.findall(r"(--prefab-ease[\w-]*): (cubic-bezier\([^)]*\))", text)
        self.assertEqual(len(definitions), text.count("cubic-bezier"),
                         "een cubic-bezier staat buiten een tokendefinitie")
        names = [name for name, _ in definitions]
        self.assertEqual(sorted(names), ["--prefab-ease-enter", "--prefab-ease-ui"], names)
        # Geen twee tokens met dezelfde waarde: dat is dezelfde drift met een ander etiket.
        self.assertEqual(len({value for _, value in definitions}), len(definitions))
        self.assertIn("--prefab-ease-enter: cubic-bezier(.77, 0, .175, 1)", text)
        for name in names:
            self.assertIn("var(%s)" % name, text, "%s wordt nergens gebruikt" % name)

    def test_repeated_motion_stays_under_the_budget(self):
        """Wat iemand tientallen keren per bezoek ziet, blijft onder 300 ms.

        Herzien 2026-09-20: `--prefab-dur-nav` en `--prefab-dur-pin` zijn vervallen met de
        regels die ze bedienden -- de menustreep is `header-links-style: 'underline'` geworden
        en de vastklikkende header `website.header_visibility_fixed`. Een token zonder gebruik
        is een token dat morgen ergens wordt ingeplakt.
        """
        text = self.stylesheet()
        for token, ceiling in (("--prefab-dur-press", 300), ("--prefab-dur-hover", 300)):
            match = re.search(re.escape(token) + r":\s*(\d+)ms", text)
            self.assertIsNotNone(match, token)
            self.assertLessEqual(int(match.group(1)), ceiling, token)

    def test_the_once_per_visit_motion_stays_within_500_to_800ms(self):
        """De andere kant van de frequentievraag: 500-800 ms mag, omdat het moment zich niet
        herhaalt — maar het is een venster en geen vrijbrief.

        Herzien 2026-09-20: `--prefab-dur-reveal` is met de eigen onthulling vervallen (zie
        test_the_scroll_reveal_is_odoos_and_not_ours). De hero-entree is wat er van dit
        register over is."""
        for token in ("--prefab-dur-hero",):
            match = re.search(re.escape(token) + r":\s*(\d+)ms", self.stylesheet())
            self.assertIsNotNone(match, token)
            self.assertGreaterEqual(int(match.group(1)), 500, token)
            self.assertLessEqual(int(match.group(1)), 800, token)

    def test_the_lightbox_opens_without_an_animation_of_its_own(self):
        """Herzien 2026-09-20. De vergroting had een eigen @keyframes-entree van 180 ms, met
        twee keyframe-namen die GLOBAAL zijn binnen het document terwijl deze bundel op élke
        website van deze instantie wordt geladen. Golf 6 vervangt het hele blok door Odoo's
        `o_image_popup`; tot die tijd blijft de opmaak staan (zonder haar is er geen overlay
        maar een rij losse foto's midden op /projecten) en gaat de animatie er nu al af.

        Wat dit bewaakt: komt hij terug, dan komt hij terug in het HERHAALDE register en uit
        een token -- wie door zesendertig foto's bladert, opent dit ding tientallen keren."""
        text = self.code()
        self.assertNotIn("@keyframes", text, "keyframe-namen zijn globaal; deze bundel niet")
        self.assertIn(".o_prefab_lightbox {", text)
        # De terugval zonder JavaScript blijft: zonder deze regel staat de vergroting open.
        self.assertIn("&[hidden] { display: none !important; }", text)

    def test_the_hero_entrance_cannot_leave_the_hero_hidden(self):
        """Dezelfde volgorde als bij de onthulling: de stylesheet verbergt pas iets nadat het
        script heeft vastgesteld dat het de entree kan afmaken."""
        text = self.stylesheet()
        self.assertIn("&.o_prefab_hero_ready .o_prefab_hero_copy > *", text)
        script = module_file("static/src/js/prefab_site.js")
        self.assertIn('classList.add("o_prefab_hero_ready")', script)
        # Niet in de bouwer, en niet bij "minder beweging".
        entrance = script[script.index("function heroEnter"):]
        entrance = entrance[:entrance.index("\n    }")]
        # De drie voorwaarden staan in motionAllowed(), gedeeld met de onthulling; de entree
        # mag ze niet omzeilen.
        self.assertIn("motionAllowed()", entrance)
        allowed = script[script.index("function motionAllowed"):]
        allowed = allowed[:allowed.index("\n    }")]
        self.assertIn("isEditing()", allowed)
        self.assertIn("prefersReducedMotion()", allowed)
        self.assertIn("site()", allowed)
        # Twee sleutels met een ander faalpatroon: requestAnimationFrame vuurt niet in een
        # achtergrondtabblad, dus een tweede weg naar dezelfde klasse is geen luxe.
        self.assertIn("requestAnimationFrame", entrance)
        self.assertIn("setTimeout(show", entrance)

    def test_the_hero_video_waits_until_after_the_first_paint(self):
        """De video is de ACHTERGROND van de hero en niet de hero. Zolang de bron meteen werd
        gezet, vocht een halve megabyte om dezelfde bandbreedte als de foto's boven de vouw."""
        script = module_file("static/src/js/prefab_site.js")
        video = script[script.index("function heroVideo"):script.index("function play(")]
        self.assertIn('window.addEventListener("load"', video)
        self.assertIn("requestIdleCallback", video)
        # En de bron wordt nergens anders gezet dan in play().
        self.assertNotIn('setAttribute("src"', video)

    def test_reduced_motion_is_honoured(self):
        self.assertIn("prefers-reduced-motion", self.stylesheet())
        self.assertIn("prefers-reduced-motion", module_file("static/src/js/prefab_site.js"))

    def test_the_scroll_reveal_is_odoos_and_not_ours(self):
        """De eigen onthulling is weg. Odoo 19.4 heeft `o_animate` (website.scss:2709-3055),
        dat verbergt met CSS uit de renderblokkerende bundel — dus vóór de eerste verf, waar de
        onze pas ná de eerste verf zijn klasse zette en dertien secties liet flikkeren. En hij
        schreef `data-prefab-reveal` in de `oe_structure`, dus in de inhoud van de klant.

        Wat dit bewaakt is niet de smaak maar de terugkeer: zodra dit script weer secties gaat
        verbergen, moet het ook weer bewijzen dat het ze terugbrengt — en die discussie hoort
        dan opnieuw gevoerd, niet stilletjes hersteld."""
        script = module_file("static/src/js/prefab_site.js")
        # Op de CODE, niet op het commentaar: de reden waarom dit weg is, hoort juist wél in
        # het bestand te blijven staan.
        code = re.sub(r"(?m)^\s*//.*$", "", re.sub(r"/\*.*?\*/", "", script, flags=re.S))
        for gone in ("data-prefab-reveal", "o_prefab_reveal_ready", "o_prefab_revealed",
                     "IntersectionObserver"):
            self.assertNotIn(gone, code, gone)

    def test_home_hero_keeps_native_cover_controls_and_no_saved_runtime_player(self):
        """The native poster remains editable; public video never pollutes a saved arch."""
        template = next(t for t in templates_of("views/page_home.xml") if t.get("id") == "page_home")
        region = template.find(".//div[@id='oe_structure_prefab_home']")
        self.assertIsNotNone(region)
        hero = region.find("section")
        self.assertEqual(hero.get("data-snippet"), "s_cover")
        self.assertEqual(hero.get("data-prefab-home-video"),
                         "/cs_prefab_website/static/src/video/prefab-partner.mp4")
        backgrounds = [node for node in hero.iter()
                       if "oe_img_bg" in node.get("class", "").split()]
        self.assertEqual(len(backgrounds), 1)
        self.assertIn("background-image:", backgrounds[0].get("style", ""))
        self.assertIn("prefab-partner-poster", backgrounds[0].get("style", ""))
        filters = [node for node in hero.iter()
                   if "o_we_bg_filter" in node.get("class", "").split()]
        self.assertEqual(len(filters), 1)
        for name in ("o_prefab_home_video_layer", "o_prefab_home_video_controls"):
            anchors = [node for node in hero.iter() if name in node.get("class", "").split()]
            self.assertEqual(len(anchors), 1, name)
            self.assertEqual(list(anchors[0]), [], "runtime player/control leaked into XML")
        self.assertTrue(hero.findall(".//a[@href='/offerte']"))
        self.assertEqual(hero.findall(".//video"), [])
        self.assertFalse(any(node.get("data-prefab-hero-video") for node in hero.iter()))


class BackendViewTests(unittest.TestCase):
    """The backend surface the customer maintains the gallery from."""

    def test_the_search_view_avoids_the_two_nodes_that_fail_validation(self):
        """🪤 Gemeten op deze reeks: <separator/> en <group expand="0"> in een zoekweergave
        laten de view-validatie vallen met "Ongeldige weergave … definitie", en de melding
        noemt de oorzaak niet -- alleen het bestand en het regelnummer."""
        tree = ET.parse(MODULE / "views" / "project_views.xml")
        for search in tree.getroot().iter("search"):
            self.assertEqual(search.findall(".//separator"), [])
            for group in search.findall(".//group"):
                self.assertIsNone(group.get("expand"), "group expand= in een zoekweergave")

    def test_every_field_the_customer_sees_explains_itself(self):
        """Het vraagteken naast een veld is hoe iemand zonder handleiding leert wat het doet.

        Vier velden zijn uitgezonderd en elk om dezelfde reden: hun label IS de uitleg
        (`name`), of ze staan er alleen om iets anders te kunnen berekenen.
        """
        source = (MODULE / "models" / "project.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
                continue
            call = node.value
            if not (isinstance(call.func, ast.Attribute)
                    and isinstance(call.func.value, ast.Name)
                    and call.func.value.id == "fields"):
                continue
            keywords = {keyword.arg for keyword in call.keywords}
            name = node.targets[0].id if isinstance(node.targets[0], ast.Name) else "?"
            self.assertIn("help", keywords, "veld %s heeft geen help-tekst" % name)
            help_text = next(keyword.value for keyword in call.keywords if keyword.arg == "help")
            text = self._concat(help_text)
            self.assertGreater(len(text), 60,
                               "de help van %s is een verkapt label: %r" % (name, text))

    @staticmethod
    def _concat(node):
        """Odoo help texts are usually adjacent string literals; flatten them."""
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.BinOp):
            return BackendViewTests._concat(node.left) + BackendViewTests._concat(node.right)
        return ast.literal_eval(node)

    def test_the_menu_entry_is_a_leaf_under_an_existing_parent(self):
        """Een groepsmenu mag geen action dragen: op een touchscreen navigeert een tik dan in
        plaats van het submenu te openen, en de kinderen worden onbereikbaar."""
        tree = ET.parse(MODULE / "views" / "project_views.xml")
        menus = tree.getroot().findall(".//menuitem")
        self.assertEqual(len(menus), 1)
        self.assertEqual(menus[0].get("parent"), "website.menu_content")
        self.assertTrue(menus[0].get("action"))
        self.assertIsNone(menus[0].get("web_icon"))

    def test_the_empty_list_teaches_instead_of_saying_no_records(self):
        tree = ET.parse(MODULE / "views" / "project_views.xml")
        actions = [record for record in tree.getroot().iter("record")
                   if record.get("model") == "ir.actions.act_window"]
        self.assertTrue(actions)
        for action in actions:
            helps = [field for field in action.iter("field") if field.get("name") == "help"]
            self.assertTrue(helps, action.get("id"))
            markup = ET.tostring(helps[0], encoding="unicode")
            self.assertIn("o_view_nocontent_smiling_face", markup)
            self.assertGreater(len(markup), 400, "de lege lijst zegt te weinig")


class ManifestTests(unittest.TestCase):
    def manifest(self):
        return ast.literal_eval(module_file("__manifest__.py"))

    def test_every_template_file_is_loaded(self):
        data = self.manifest()["data"]
        for relative in PAGE_TEMPLATE_FILES + SNIPPET_FILES:
            self.assertIn(relative, data, relative)

    def test_the_page_records_load_after_the_views_they_reference(self):
        """ref() wordt opgelost terwijl het bestand wordt ingelezen; de view moet er dan zijn."""
        data = self.manifest()["data"]
        for relative in PAGE_TEMPLATE_FILES:
            if relative == "views/offerte_templates.xml":
                continue
            self.assertLess(data.index(relative), data.index("data/page_data.xml"), relative)

    def test_the_blog_and_the_projects_are_seeded_after_the_media(self):
        data = self.manifest()["data"]
        self.assertLess(data.index("data/media_data.xml"), data.index("data/project_data.xml"))

    def test_the_new_asset_is_scoped_and_tiny(self):
        """Wat er over de lijn gaat, niet wat er in het bestand staat.

        Tot 2026-09-17 mat deze test de ruwe bestandsgrootte. Dat is het verkeerde getal: Odoo
        minificeert de frontend-bundel (rjsmin) en commentaar bereikt de bezoeker nooit. Een
        budget op de ruwe tekst straft uitleg en laat code ongemoeid — precies andersom.

        De grens staat op wat de bezoeker krijgt. Hij is met de vergroting in de galerij mee
        omhoog gegaan van 9.000 naar 10.000, en dat is een BESLUIT: er kwam een functie bij die
        de klant heeft gevraagd. De ruwe bovengrens staat er nog naast, zodat het bestand niet
        ongemerkt een essay wordt.
        """
        bundle = self.manifest()["assets"]["web.assets_frontend"]
        self.assertIn("cs_prefab_website/static/src/js/prefab_site.js", bundle)
        script = module_file("static/src/js/prefab_site.js")
        shipped = re.sub(r"(?m)^\s*//.*$", "", re.sub(r"/\*.*?\*/", "", script, flags=re.S))
        shipped = re.sub(r"(?m)^\s*\n", "", shipped)
        self.assertLess(len(shipped), 10000,
                        "dit draait op élke pagina van élke website (zonder commentaar gemeten)")
        self.assertLess(len(script), 20000, "het bestand zelf, commentaar meegerekend")
        self.assertIn("body.o_prefab_site", script)

    def test_the_bridge_is_still_not_a_dependency(self):
        self.assertNotIn("cs_mcp_bridge", self.manifest()["depends"])
        self.assertIn("cs_security_base", self.manifest()["depends"])
        self.assertIn("website_blog", self.manifest()["depends"])
        self.assertIn("website_crm", self.manifest()["depends"])


if __name__ == "__main__":
    unittest.main()

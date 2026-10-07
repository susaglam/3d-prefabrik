"""The site is installed ON the website that is already there, and everything that has to
be told to that website because a website record cannot express it.

This module does not create a website record and never has. The customer has one Odoo with
one website on it, that website already serves the configurator on ``/prefab``, and the site
in this module is what that website becomes. A second record would have been a layer with
nothing on the other side of it: a second host to point somewhere, a second catalogue to
publish, a second set of settings to keep in step, and a live configurator sitting on the
wrong one of the two.

What that costs, and it is the whole difficulty of this file: every step below writes to a
record that is ALREADY IN USE. On a blank website "fill in the language" is bookkeeping; on
this one it changes the language of a page that is being served right now. So the steps are
sorted into three kinds, and which kind a step is, is a decision rather than a detail:

* **repeatable** -- it re-states something this module owns outright and nobody else edits
  (a missing appearance record). Safe on every upgrade.
* **one-shot** -- it hands something over. The navigation, the logo, the favicon, the site
  name, the cookie bar: the moment they are in place they are the customer's, and re-running
  them would put back a logo they replaced and a menu entry they renamed, on every upgrade,
  silently. ``cs_prefab_seeded`` is the line between the two.
* **never** -- ``website.domain``. It decides whether the configurator answers a price
  request or returns 403, and until DNS actually moves, the address visitors use is NOT the
  canonical one. Writing it would take the live configurator down on the day of the upgrade
  rather than on the day of the switch. It is read back on the settings form with the value
  it should get and when; a human sets it.

Every step reads its own result back, because a write to a computed or protected field
succeeds silently.
"""
import hashlib
import logging

from odoo import api, fields, models
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)

# The one canonical host of the site. Naked, not www: every canonical URL, every Open Graph
# url and the whole XML sitemap of the old WordPress site are naked, so choosing www would
# invalidate them all for no gain. It is a parameter and not a constant because the value has
# to be settable before DNS moves without shipping a release.
#
# NOTE what it is NOT: it is not written into ``website.domain`` by this module. See the
# module docstring, and ``_compute_cs_prefab_status`` for where it surfaces instead.
CANONICAL_HOST_PARAM = "cs_prefab_website.canonical_host"
CANONICAL_HOST_DEFAULT = "https://prefabpartner.nl"

# Typography is NOT set here, and that is a decision rather than an omission.
#
# The live site uses Figtree, loaded from Google Fonts. Odoo can do both halves of that --
# `make_scss_customization` accepts a `font` name and a `google-fonts` / `google-local-fonts`
# entry, and the local variant downloads the face into an attachment, which is the
# privacy-correct outcome. Both halves also carry a failure mode this stage cannot verify:
# a font name that no font config resolves leaves a null in a Sass font stack, and the whole
# frontend bundle then compiles to the "A css error occured, using an old style" stub -- for
# every website on the instance. The local variant additionally performs an outbound HTTP
# request during module install.
#
# Neither is a risk worth taking blind for a typeface. It is a browser-verifiable change and
# belongs in the stage that has a browser; see README.md, "Openstaande punten".

# The main menu of prefabpartner.nl, verbatim from docs/website/content-inventory.json
# (global_chrome.header.menu). Labels are the customer's own; nothing is paraphrased.
#
# "Alle oplossingen" is the one addition, and it is a fix rather than an invention: the parent
# "Oplossingen" is both a dropdown and a real page, and on a touch device a tap on a dropdown
# parent expands the submenu instead of navigating -- so without a leaf the overview page is
# unreachable on a phone. Repeating the parent's own label as the leaf's is the confusing
# variant, hence the distinct wording. (Odoo enforces the same thing from the other side:
# ``website.menu.url`` is computed, and a menu that has children is forced to "#".)
MENU_TREE = [
    {"name": "Home", "url": "/", "sequence": 10},
    {"name": "Over ons", "url": "/over-ons", "sequence": 20},
    {"name": "Oplossingen", "url": "/oplossingen", "sequence": 30, "children": [
        {"name": "Alle oplossingen", "url": "/oplossingen", "sequence": 10},
        {"name": "Prefab aanbouw", "url": "/oplossingen/prefab-aanbouw", "sequence": 20},
        {"name": "Prefab dakkapel", "url": "/oplossingen/prefab-dakkapel", "sequence": 30},
        {"name": "Prefab opbouw", "url": "/oplossingen/prefab-opbouw", "sequence": 40},
    ]},
    {"name": "Projecten", "url": "/projecten", "sequence": 40},
    {"name": "Partner worden", "url": "/partner-worden", "sequence": 50},
    {"name": "Contact", "url": "/contact", "sequence": 60},
    {"name": "Ontwerp je aanbouw", "url": "/offerte", "sequence": 70},
]

# The ONE menu entry this module removes, and the only one it is entitled to remove: /blog is
# seeded by website_blog, which is in this module's own `depends`. It did not exist before
# this module was installed, so taking it away leaves the navigation exactly as the customer
# had it -- which is the promise. The news index of this site lives at /nieuws (it is in the
# URL contract), so a second, English entry pointing at /blog is a duplicate address in a
# Dutch menu.
#
# Everything ELSE in the navigation is pre-existing and stays. There is no copied generic
# tree to prune any more: that pruning only made sense while Odoo's ``Website.create()`` was
# putting Home + Shop on a brand-new record. On a website that already exists, a /shop entry
# is the customer's own navigation and removing it is not this module's call -- it is
# reported on the settings form instead (``cs_prefab_menu_status``).
BLOG_MENU_URL = "/blog"

# Where the website's previous homepage goes when this site takes over "/". It is MOVED and
# unpublished, never deleted: the record, its view and its content survive, so putting it
# back is changing one field.
PREVIOUS_HOMEPAGE_URL = "/oude-startpagina"

# How far the one-shot inrichting of this module has been applied to a website.
#
# It replaces a plain boolean, and the reason is measured rather than stylistic. The boolean
# was already ``True`` on the live website, and every hand-over step -- the navigation, the
# site name, the logo, the favicon -- sat behind it. So as the code stood, this module could
# never again add a single menu entry to the site it ships: a new release would compute the
# step, skip it, and log success. A whole overhaul was unreachable behind one flag that had
# already been set.
#
# A LEVEL keeps the promise the boolean was making while removing that trap. Each band runs
# exactly once, in order, and a release that genuinely has something new to hand over gets its
# own band instead of re-running the previous one. What the customer has already renamed,
# replaced or deleted is never touched again, because the band that placed it has passed.
#
#   1  identity, brand images, navigation, the blog menu, the company partner   (was the boolean)
#   2  the brand foundation: the theme values Odoo's own editor owns
#   3  the white-label placeholders, replaced with this company's own brand     (this release)
#
# Bump this ONLY together with a band in ``_cs_prefab_bootstrap``.
CS_PREFAB_SEED_LEVEL = 4

# The SCSS files Odoo's own Theme tab writes. They are not ours; we seed them once with the
# brand and then they belong to the customer, exactly like the logo and the menu.
#
# Read website/models/assets.py: ``make_scss_customization`` substitutes each value verbatim
# into ``'key': <value>,``, so a value that must reach Sass AS A STRING carries its quotes
# inside the Python string -- "'base-1'", not "base-1". Colours, numbers and the three
# spellings 'True'/'False'/'null' go bare.
THEME_USER_VALUES = "/website/static/src/scss/options/user_values.scss"
THEME_USER_COLORS = "/website/static/src/scss/options/colors/user_color_palette.scss"
THEME_USER_STATES = "/website/static/src/scss/options/colors/user_theme_color_palette.scss"

# The brand, as the five colours Odoo's palette is made of.
#
# Which colour becomes which combination is NOT a choice -- it is fixed by the 'base-1'
# palette and was measured on the live instance: o-color-1 -> o_cc4, o-color-2 -> o_cc3,
# o-color-3 -> o_cc2, o-color-4 -> o_cc1 (and $body-bg), o-color-5 -> o_cc5. The 193 native
# snippets of 19.4 assume o_cc1 light, o_cc2 tinted and o_cc5 dark (110, 65 and 53 uses), so
# any other arrangement breaks them.
#
# Every pair below was computed with the WCAG relative-luminance formula, not estimated:
#   #FFFFFF / #C43F12  5.16     #1A1A1A / #FFFFFF 17.40     #1A1A1A / #FDEAE4 14.97
#   #AF3E16 / #FDEAE4  5.13     #AF3E16 / #E7E2DE  4.64     #1A1A1A / #E7E2DE 13.53
#   #C9C4C0 / #1A1A1A 10.06
# The value that matters most is the first: the site's action colour was #e8511d, which is
# 3.73:1 on white -- a live AA failure carried by the primary button on all 21 pages, the USP
# ribbon on ten and 27 service cards on nine. #C43F12 reads as the same brand orange and is
# 5.16:1. That one value closes all three.
#
# Two colours appear here and nowhere else. #AF3E16 ("Deep") is the link colour on the two
# light tinted grounds, where the action colour measures 4.44 and 4.02 and fails. #C9C4C0
# ("Ash") is the resting link colour on the dark ground, so the orange button stays the only
# warm object in the footer.
BRAND_ACTION = "#C43F12"
BRAND_DEEP = "#AF3E16"
BRAND_STONE = "#E7E2DE"
BRAND_TINT = "#F3F0EB"
BRAND_PAPER = "#FFFFFF"
BRAND_INK = "#1A1A1A"
BRAND_ASH = "#C9C4C0"


class Website(models.Model):
    _inherit = "website"

    cs_prefab_site = fields.Boolean(
        string="Prefab Partner-site",
        default=False,
        copy=False,
        help="Vinkje dat deze website de prefabpartner.nl-site is. Alle vormgeving, de vaste "
             "header en de voettekst van deze module gelden ALLEEN voor de website waar dit "
             "aan staat; elke andere website van deze Odoo blijft ongewijzigd. Zet dit niet "
             "zelf aan op een andere website: dan krijgt die site het Prefab Partner-merk.")
    cs_prefab_seeded = fields.Boolean(
        string="Eenmalige inrichting gedaan",
        default=False,
        copy=False,
        help="Onthoudt dat de naam, het menu, het logo, het favicon en de cookiemelding van "
             "Prefab Partner één keer zijn klaargezet op deze bestaande website. Blijft "
             "daarna aan, zodat een hernoemd menu-item of een later gekozen logo niet bij de "
             "volgende update wordt teruggezet — vanaf dat moment is de inrichting van jou. "
             "Zet dit alleen uit als je de meegeleverde inrichting opnieuw wilt laten "
             "plaatsen; het overschrijft dan opnieuw wat je zelf hebt ingesteld.")
    cs_prefab_seed_level = fields.Integer(
        string="Niveau van de eenmalige inrichting",
        default=0,
        copy=False,
        help="Tot hoe ver de eenmalige inrichting van deze module is toegepast. Elke stap "
             "wordt precies één keer uitgevoerd: zodra een stap is gedaan, is wat hij heeft "
             "neergezet van jou en wordt het bij een update nooit meer overschreven. Een "
             "nieuwe release die iets nieuws klaarzet, krijgt een eigen stap in plaats van de "
             "vorige opnieuw te draaien. Verlaag dit alleen als je een stap bewust opnieuw "
             "wilt laten uitvoeren; hij overschrijft dan wat je zelf hebt ingesteld.")
    cs_prefab_catalog_status = fields.Char(
        string="Catalogusstatus configurator",
        compute="_compute_cs_prefab_status",
        help="Leest terug welke prijslijst de configurator op deze website daadwerkelijk "
             "uitserveert. Zonder gepubliceerde catalogus valt de configurator stil terug op "
             "de demonstratieprijzen uit de broncode — zonder foutmelding en zonder zichtbaar "
             "verschil, behalve de prijzen zelf.")
    cs_prefab_origin_status = fields.Char(
        string="Herkomstcontrole configurator",
        compute="_compute_cs_prefab_status",
        help="De configurator vergelijkt het Origin-kopje van elk prijs-, deel- en "
             "aanvraagverzoek letterlijk met het webadres hierboven. Staat hier een ander "
             "adres dan waarop de bezoeker de site opent — bijvoorbeeld met www ervoor, of "
             "http in plaats van https — dan wordt elk verzoek geweigerd met 403. Dit veld "
             "wordt daarom nooit door een update ingevuld: vul het met de hand in op het "
             "moment dat DNS naar deze Odoo wijst, en geen minuut eerder.")
    cs_prefab_motion = fields.Boolean(
        string="Website-animaties en achtergrondvideo", default=True,
        help="Schakelt de achtergrondvideo en optionele entree- en hoverbewegingen in. "
             "Tekst, foto's, formulieren en de configurator blijven zonder deze effecten werken. "
             "De website-editor en de voorkeur voor minder beweging hebben altijd voorrang.")

    cs_prefab_resume_bar = fields.Boolean(
        string="Doorgaan-melding",
        compute="_compute_cs_prefab_resume",
        help="Leest terug of de melding 'Je ontwerp staat klaar' op deze website aan staat: Prefab Partner-site "
             "en Configurator → Vormgeving → 'Doorgaan-melding tonen'. Zonder vormgevingsrecord geldt de standaard: aan.")
    cs_prefab_resume_revision = fields.Char(
        string="Catalogusversie voor de doorgaan-melding",
        compute="_compute_cs_prefab_resume",
        help="De gepubliceerde catalogus van de configurator op deze website. De melding toont de prijs van een "
             "bewaard ontwerp alleen als dat op precies deze catalogus is berekend; anders alleen het product.")

    cs_prefab_menu_status = fields.Char(
        string="Menu-items van vóór Prefab Partner",
        compute="_compute_cs_prefab_status",
        help="Deze module voegt haar eigen menu-items toe en verwijdert er nooit één die al "
             "bestond — een navigatie van een live site wordt niet zonder overleg opgeruimd. "
             "Wat er dus nog van vóór de inrichting in staat, leest dit veld terug, zodat je "
             "het zelf kunt weghalen via Website → Site → Menu bewerken als het er niet "
             "hoort.")

    @api.depends("cs_prefab_site")
    def _compute_cs_prefab_resume(self):
        """What <body> tells resume_bar.js (layout_templates.xml). Read on every page, so it never raises: a
        missing configurator model or a read error means no bar, not a broken page."""
        for website in self:
            enabled, revision = False, ""
            try:
                if website.cs_prefab_site:
                    appearance = self.env["cs.prefab.appearance"].sudo().search([("website_id", "=", website.id)], limit=1)
                    enabled = bool(appearance.resume_bar) if appearance else True
                    release = self.env["cs.prefab.catalog.release"].sudo().search(
                        [("website_id", "=", website.id), ("state", "=", "published")], order="published_at desc, id desc", limit=1)
                    revision = release.revision or ""
            except Exception:  # noqa: BLE001 - a readback on every page must degrade, never raise
                _logger.warning("Doorgaan-melding uitgeschakeld voor website %s: instellingen niet leesbaar", website.id, exc_info=True)
                enabled, revision = False, ""
            website.cs_prefab_resume_bar = enabled
            website.cs_prefab_resume_revision = revision

    @api.depends("domain", "cs_prefab_site")
    def _compute_cs_prefab_status(self):
        """Read back what the configurator, the origin check and the navigation really are.

        Deliberately never raises: this is a readback shown on a settings form, and a form
        that crashes while the thing it reports is being corrected is worse than useless.
        """
        release_model = self.env["cs.prefab.catalog.release"].sudo()
        appearance_model = self.env["cs.prefab.appearance"].sudo()
        canonical = self._cs_prefab_canonical_host()
        for website in self:
            try:
                published = release_model.search_count(
                    [("website_id", "=", website.id), ("company_id", "=", website.company_id.id),
                     ("state", "=", "published")])
                draft = release_model.search_count(
                    [("website_id", "=", website.id), ("state", "=", "draft")])
                has_appearance = appearance_model.search_count([("website_id", "=", website.id)])
            except Exception:  # noqa: BLE001 - a readback must never break the form
                website.cs_prefab_catalog_status = "Kon de catalogus niet uitlezen."
                website.cs_prefab_origin_status = ""
                website.cs_prefab_menu_status = ""
                continue
            if published:
                website.cs_prefab_catalog_status = "Gepubliceerde catalogus van deze website."
            elif draft:
                website.cs_prefab_catalog_status = (
                    "LET OP: er staat wel een concept klaar, maar er is niets gepubliceerd. "
                    "De configurator serveert nu de demonstratieprijzen uit de broncode. "
                    "Open het concept en gebruik Concept controleren → Publiceren.")
            else:
                website.cs_prefab_catalog_status = (
                    "LET OP: deze website heeft geen catalogus. De configurator serveert de "
                    "demonstratieprijzen uit de broncode.")
            if not has_appearance:
                website.cs_prefab_catalog_status += (
                    " De vormgeving van het formulier valt eveneens terug op de "
                    "ingebouwde standaardkleuren.")
            website.cs_prefab_origin_status = website._cs_prefab_origin_sentence(canonical)
            website.cs_prefab_menu_status = website._cs_prefab_menu_sentence()

    def _cs_prefab_origin_sentence(self, canonical):
        """What ``website.domain`` currently means for the configurator, in words.

        Three states, and the middle one is the one that exists for months: the site is
        reachable on the host it has always had, while the canonical address it will move to
        is already decided and written down. Saying so is the whole point -- an administrator
        who fills this field in "to be tidy" on the wrong day takes /prefab down with a 403 on
        every price request, and nothing in Odoo would have warned them.
        """
        self.ensure_one()
        if not self.domain:
            sentence = ("Geen webadres ingevuld. De configurator vergelijkt dan met het adres "
                        "waarop het verzoek binnenkomt, dus elk adres wordt geaccepteerd.")
            if canonical:
                sentence += (f" Vul hier {canonical} in zodra DNS naar deze Odoo wijst — "
                             "niet eerder, want vanaf dat moment krijgt elk verzoek van een "
                             "ander adres 403.")
            return sentence
        stored = self.domain.rstrip("/")
        if canonical and stored != canonical.rstrip("/"):
            return (f"Alleen verzoeken van {stored} worden geaccepteerd; elke andere "
                    "schrijfwijze van hetzelfde domein levert 403 op. Het definitieve adres "
                    f"van deze site is {canonical}: zet dit veld daarop over op het moment "
                    "dat DNS is omgezet, en zet de omleiding naar één vaste schrijfwijze "
                    "eerst in de reverse proxy.")
        return (f"Alleen verzoeken van {stored} worden geaccepteerd. Elke andere "
                "schrijfwijze van hetzelfde domein levert 403 op.")

    def _cs_prefab_menu_sentence(self):
        """Which entries in this website's navigation are not this module's.

        The module adds and never removes, so without this the leftovers are invisible until
        a visitor clicks one. Matching is by URL: the labels are the customer's to change.
        """
        self.ensure_one()
        if not self.cs_prefab_site or not self.menu_id:
            return ""
        try:
            ours = self._cs_prefab_menu_urls()
            foreign = self.env["website.menu"].sudo().search(
                [("website_id", "=", self.id), ("id", "!=", self.menu_id.id),
                 ("url", "not in", list(ours) + ["#"])])
        except Exception:  # noqa: BLE001 - a readback must never break the form
            return ""
        if not foreign:
            return "Alle menu-items van deze website horen bij de Prefab Partner-site."
        listed = ", ".join(sorted({menu.url for menu in foreign}))
        return (f"Deze website heeft nog {len(foreign)} menu-item(s) van vóór de inrichting: "
                f"{listed}. Deze module verwijdert ze niet. Haal ze weg via Website → Site → "
                "Menu bewerken als ze niet op deze site horen.")

    @api.model
    def _cs_prefab_menu_urls(self):
        """Every URL in MENU_TREE, parents included, flattened once."""
        urls = set()

        def walk(spec):
            for entry in spec:
                urls.add(entry["url"])
                walk(entry.get("children", ()))

        walk(MENU_TREE)
        return urls

    @api.constrains("cs_prefab_site")
    def _check_single_prefab_site(self):
        """Exactly one website may carry the flag.

        Every template and every stylesheet rule this module ships is gated on it, so two
        flagged websites would silently put the Prefab Partner brand on somebody else's site.
        It is also what makes the flag a safe target resolver: ``_cs_prefab_target_website``
        can take the first match because there can only be one.
        """
        if self.search_count([("cs_prefab_site", "=", True)]) > 1:
            raise ValidationError(
                "Er kan maar één website de Prefab Partner-site zijn. Zet het vinkje eerst "
                "uit bij de andere website; anders zouden twee sites dezelfde huisstijl, "
                "header en voettekst krijgen.")

    # ------------------------------------------------------------------
    # Which website
    # ------------------------------------------------------------------

    @api.model
    def _cs_prefab_site(self):
        """The website that carries the brand right now, or an empty recordset.

        Empty before the bootstrap has run for the first time. Used by everything that must
        stand aside when this module is installed but not yet configured: the redirects, the
        project gallery, the frontend controllers.
        """
        return self.search([("cs_prefab_site", "=", True)], limit=1)

    @api.model
    def _cs_prefab_target_website(self):
        """The website this site belongs to. NEVER creates one.

        The existing default website -- the one an unmatched host already resolves to, which
        is the one the customer has been using -- unless a website already carries the flag,
        in which case that one wins. The flag is checked first for one reason: an
        administrator who deliberately moves the brand to another website must not have it
        pulled back by the next upgrade, silently, at three in the morning.

        This is also the method the data files resolve ``website_id`` through
        (``<field name="website_id" model="website" eval="obj()._cs_prefab_target_website().id"/>``).
        That is deliberate and it is not a detail: the alternative -- an ``ir.model.data`` row
        of this module pointing at the customer's website -- would make ``uninstall`` of this
        module DELETE that website, because ``_module_data_uninstall`` unlinks every record a
        removed module's external ids refer to. Verified in the saas~19.4 source rather than
        assumed.
        """
        flagged = self.search([("cs_prefab_site", "=", True)], limit=1)
        if flagged:
            return flagged
        return self.search([], order="sequence, id", limit=1)

    # ------------------------------------------------------------------
    # The website the previous release created
    # ------------------------------------------------------------------

    LEGACY_SITE_XMLID = "cs_prefab_website.website_prefabpartner"

    @api.model
    def _cs_prefab_remove_legacy_site(self):
        """Delete the separate website an earlier version of this module created, if it is still there.

        Runs before the target website is resolved, so the flag it carries cannot make it win. Idempotent: on an
        Odoo that never had it, and on every run after the first, this does nothing and says so.
        """
        legacy = self.env.ref(self.LEGACY_SITE_XMLID, raise_if_not_found=False)
        if not legacy or not legacy.exists():
            return {"removed": False, "reason": "no legacy website record on this database"}
        legacy = legacy.sudo()
        default = self.search([], order="sequence, id", limit=1)
        if legacy == default:
            _logger.warning(
                "cs_prefab_website: the legacy website %s IS the default website of this Odoo, so it is kept "
                "and the site is applied to it. Nothing removed.", legacy.id)
            return {"removed": False, "reason": "the legacy record is the default website"}

        # A quote or a share is a customer's own request. If one landed on this website, stop: losing it is worse
        # than leaving a website behind, and a human can move it and re-run the upgrade.
        blocking = {}
        for model in ("cs.prefab.quote", "cs.prefab.share"):
            if model not in self.env:
                continue
            count = self.env[model].sudo().search_count([("website_id", "=", legacy.id)])
            if count:
                blocking[model] = count
        if blocking:
            _logger.error(
                "cs_prefab_website: refusing to remove website %s because it carries business records %s. "
                "Move or archive them, then upgrade again.", legacy.id, blocking)
            return {"removed": False, "reason": "business records present", "blocking": blocking}

        # The flag first: whatever happens next, the resolver must not pick this record again.
        if legacy.cs_prefab_site:
            legacy.cs_prefab_site = False
            legacy.invalidate_recordset(["cs_prefab_site"])

        removed = {"website_id": legacy.id, "name": legacy.name, "dependents": {}}
        # Ask the database which foreign keys point at website.id and REFUSE the delete, rather than discovering
        # them one failed upgrade at a time. The first attempt cleared the draft catalogue and then died on
        # blog_blog_website_id_fkey; there is no reason to meet the third one the same way.
        self.env.cr.execute("""
            SELECT src.relname, att.attname
              FROM pg_constraint AS c
              JOIN pg_class AS src ON src.oid = c.conrelid
              JOIN pg_class AS tgt ON tgt.oid = c.confrelid
              JOIN pg_attribute AS att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
             WHERE c.contype = 'f' AND tgt.relname = 'website'
               AND c.confdeltype IN ('a', 'r')
        """)
        blockers = self.env.cr.fetchall()
        # Deepest first: a post has to go before its blog, a catalogue option before its release. Sorting by the
        # model's own dependency is not something SQL knows, so the module's own records are named in order and
        # anything else the database reports is handled after them, which is where a surprise would show up.
        ordered = ["blog_post", "blog_blog", "cs_prefab_catalog_release"]
        tables = [t for t in ordered if any(t == name for name, _ in blockers)]
        tables += [name for name, _ in blockers if name not in ordered]
        for table in tables:
            column = next(col for name, col in blockers if name == table)
            model_name = self.env["ir.model"].sudo().search(
                [("model", "=", table.replace("_", "."))], limit=1).model
            if not model_name or model_name not in self.env:
                # No ORM model for it (a relation table, or a model this database does not have).
                continue
            records = self.env[model_name].sudo().search([(column, "=", legacy.id)])
            if records:
                removed["dependents"][model_name] = len(records)
                records.unlink()

        legacy.unlink()
        _logger.info("cs_prefab_website: removed the legacy separate website %s", removed)
        return {"removed": True, **removed}

    # ------------------------------------------------------------------
    # Bootstrap
    # ------------------------------------------------------------------

    @api.model
    def _cs_prefab_bootstrap(self):
        """Everything a website record cannot express. Idempotent; install and upgrade.

        Runs FIRST, before any other data file of this module, so that the flag is on the
        target website by the time a page, a blog or an offerte record resolves its
        ``website_id`` through ``_cs_prefab_target_website``.
        """
        # First, because the record it removes still carries cs_prefab_site and would otherwise win the resolve.
        legacy = self._cs_prefab_remove_legacy_site()
        website = self._cs_prefab_target_website()
        if not website:
            _logger.warning(
                "cs_prefab_website: this Odoo has no website record at all, so there is "
                "nothing to install the site onto; bootstrap skipped")
            return False
        default = self.search([], order="sequence, id", limit=1)
        if website != default:
            # Not an error -- the flag is allowed to move -- but it is never an accident
            # either, so it is said out loud rather than discovered from the outside.
            _logger.warning(
                "cs_prefab_website: the brand is on website %s (%s) while the default "
                "website of this Odoo is %s (%s). The site is being applied to the flagged "
                "one. Clear the flag there if it belongs on the default website.",
                website.id, website.name, default.id, default.name)
        if not website.cs_prefab_site:
            website.cs_prefab_site = True
            website.invalidate_recordset(["cs_prefab_site"])
        # The boolean this module shipped before the levels existed. A website that already
        # carries it has had band 1 applied, so it starts at level 1 rather than at 0 -- which
        # is what stops this upgrade from putting back a logo or a menu entry the customer has
        # since changed. The boolean stays in step with the level for anything still reading it.
        level = website.cs_prefab_seed_level
        if not level and website.cs_prefab_seeded:
            level = 1
            website.cs_prefab_seed_level = 1
        first_run = level < 1
        steps = {
            "legacy_site": legacy,
            "website_id": website.id,
            "flag": website.cs_prefab_site,
            "seed_level_before": level,
            "locale": self._cs_prefab_apply_locale(website, first_run),
            "configurator": self._cs_prefab_apply_configurator_scope(website, first_run),
            # REPEATABLE on purpose, unlike everything in the bands below. This is a repair
            # rather than a hand-over: it takes website_id off a page view that should never
            # have carried it. A one-shot repair only fixes the instance it happened to run on,
            # and the defect it repairs is invisible -- the symptom is the customer's own edits
            # disappearing after some later upgrade, with nobody able to say which one. Running
            # it every time means a regression is undone on the next release instead of living
            # for months. It skips a view that already has a generic twin, so a copy the
            # customer made is never touched.
            "page_ownership": self._cs_prefab_release_page_views(),
            "first_run": first_run,
        }
        # Band 1 -- the hand-over. Name, logo, favicon, cookie bar, navigation.
        if level < 1:
            steps["identity"] = self._cs_prefab_apply_identity(website)
            steps["brand"] = self._cs_prefab_apply_brand_images(website)
            steps["blog_menu"] = self._cs_prefab_drop_seeded_blog_menu(website)
            steps["company_partner"] = self._cs_prefab_unpublish_company_partner()
        # Band 2 -- the brand foundation, and the navigation that goes with it. The menu step
        # is ADD-ONLY (it matches on url and never rewrites an entry that is already there),
        # so running it again in a later band adds this release's new entries and leaves every
        # renamed or reordered one exactly as the customer left it.
        if level < 2:
            steps["menu"] = self._cs_prefab_apply_menu(website)
            steps["theme"] = self._cs_prefab_apply_theme(website)
        # Band 3 -- the backend and portal branding, if the module that owns it is installed.
        if level < 3:
            steps["white_label"] = self._cs_prefab_apply_white_label(website)
        if level < 4:
            steps["warm_design"] = self._cs_prefab_apply_warm_design(website)
        if level < CS_PREFAB_SEED_LEVEL:
            website.cs_prefab_seeded = True
            website.cs_prefab_seed_level = CS_PREFAB_SEED_LEVEL
            website.invalidate_recordset(["cs_prefab_seeded", "cs_prefab_seed_level"])
        steps["seed_level_after"] = website.cs_prefab_seed_level
        _logger.info("cs_prefab_website: bootstrap on website %s -> %s", website.id, steps)
        return steps

    # ------------------------------------------------------------------
    # Nieuws
    # ------------------------------------------------------------------

    @api.model
    def _cs_prefab_news_blog(self):
        """The blog the news posts live in, or an empty recordset.

        Resolved through the xmlid rather than by name, so a customer who renames "Nieuws" to
        something else does not silently empty the /nieuws page.
        """
        blog = self.env.ref("cs_prefab_website.blog_nieuws", raise_if_not_found=False)
        return blog if blog and blog.exists() else self.env["blog.blog"].browse()

    def _cs_prefab_recent_posts(self, limit=2):
        """The most recent published posts, for the teaser on the homepage.

        In Python and not in the template on purpose: a database query written inside
        ``arch_db`` works today, is invisible to every static check, and breaks silently the
        day the render context changes. It is also the reason this method never raises -- it
        runs while a page is being rendered for a visitor, and a missing teaser must cost a
        section, not the page.

        Published-only is not enforced here: ``blog.post`` carries a record rule that already
        limits the public user to published posts, and re-stating it would be a second, weaker
        definition of the same rule. What IS stated here is the blog, because the site may one
        day carry a second one.
        """
        self.ensure_one()
        blog = self._cs_prefab_news_blog()
        if not blog:
            return self.env["blog.post"].browse()
        try:
            return self.env["blog.post"].search(
                [("blog_id", "=", blog.id)], order="published_date desc, id desc", limit=limit)
        except Exception:  # noqa: BLE001 - a teaser must never break a page
            _logger.exception("cs_prefab_website: reading the news teaser failed")
            return self.env["blog.post"].browse()

    @api.model
    def _cs_prefab_point_news_redirects(self):
        """Re-point the two old flat post addresses at the posts themselves.

        They were created as 301s to ``/nieuws`` because the posts do not exist yet while
        ``data/redirect_data.xml`` runs; that is the honest interim. By the time this runs the
        posts do, so the redirect lands on the article instead of on an index the visitor then
        has to search.

        Idempotent and safe on every upgrade: it writes the address the post currently has, so
        a renamed post keeps its old address working.
        """
        mapping = {
            "/onze-nieuwe-website-is-live": "cs_prefab_website.post_nieuwe_website",
            "/voordelen-van-een-prefab-aanbouw": "cs_prefab_website.post_voordelen_prefab_aanbouw",
        }
        url_map = self.env["cs.prefab.website.urlmap"]
        applied = {}
        for source, xmlid in mapping.items():
            post = self.env.ref(xmlid, raise_if_not_found=False)
            if not post or not post.exists() or not post.website_url or post.website_url == "#":
                _logger.warning("cs_prefab_website: %s has no address yet; %s still points at "
                                "/nieuws", xmlid, source)
                continue
            applied[source] = url_map._cs_prefab_set_redirect(
                source, post.website_url,
                "Oud losstaand adres van het nieuwsbericht %s" % post.name)
        _logger.info("cs_prefab_website: news redirects -> %s", applied)
        return applied

    # ------------------------------------------------------------------
    # Bootstrap helpers
    # ------------------------------------------------------------------

    @api.model
    def _cs_prefab_canonical_host(self):
        # get_str, NOT get_param: saas~19.2 removed the untyped accessors and saas~19.4 raises
        # AttributeError: 'ir.config_parameter' object has no attribute 'get_param'. The host is a string,
        # so get_str is the right member of the typed family and the default carries over unchanged.
        value = self.env["ir.config_parameter"].sudo().get_str(
            CANONICAL_HOST_PARAM, CANONICAL_HOST_DEFAULT)
        return (value or "").strip()

    def _cs_prefab_apply_identity(self, website):
        """The site's own name and its cookie notice, once.

        ``website.name`` is not backend-only bookkeeping: Odoo's own layout renders it as the
        tail of every ``<title>`` (``additional_title + ' | ' + website.name``) and as the
        title and aria-label of the header logo. Leaving it would put the customer's old
        working title in every page title and every search result of the new site.

        ``cookies_bar`` is turned on because the old site loaded Google Analytics, Google Tag
        Manager and the Meta Pixel while showing no notice at all. Whatever this site ends up
        loading, the bar is there from the first minute rather than added after a complaint.

        One shot, both of them: from here on the name on the tab and whether the bar shows are
        settings the customer owns.
        """
        values, previous = {}, {"name": website.name, "cookies_bar": website.cookies_bar}
        if website.name != "Prefab Partner":
            values["name"] = "Prefab Partner"
        if not website.cookies_bar:
            values["cookies_bar"] = True
        if values:
            website.write(values)
            website.invalidate_recordset(list(values))
        _logger.info("cs_prefab_website: identity on website %s was %s", website.id, previous)
        return {"name": website.name, "cookies_bar": website.cookies_bar, "previous": previous}

    def _cs_prefab_apply_locale(self, website, first_run):
        """Dutch, once -- and a readback of where a lead from this site lands.

        The language is a ONE-SHOT step and that is the change of meaning: on a blank website
        "set the language if it is empty" was bookkeeping, and it would now never fire at all,
        because a website that already exists always has one. Silently never firing is worse
        than doing nothing on purpose: the site would render its Dutch pages inside an English
        Odoo chrome, and the test that "checked" it would be measuring nothing.

        It only ever ADDS: nl_NL joins ``language_ids`` and becomes the default, the language
        that was there stays installed and reachable, and an administrator can put it back.
        A language that is not installed on this Odoo is skipped rather than installed -- that
        is a database-wide act and not this module's to take.

        Routing (``crm_default_team_id`` and friends) is READ BACK and not written. There is
        no second website to copy it from any more, and inventing a sales team for somebody
        else's CRM was never this module's business; a lead that lands in no team is a real
        hazard, so it is reported in the log rather than silently fixed.
        """
        applied = {}
        if first_run:
            dutch = self.env["res.lang"].sudo().search([("code", "=", "nl_NL")], limit=1)
            if not dutch:
                _logger.warning(
                    "cs_prefab_website: nl_NL is not installed on this Odoo, so the site "
                    "keeps %s as its language. Install Dutch under Instellingen → Vertalingen "
                    "→ Talen and re-run the inrichting to change it.",
                    website.default_lang_id.code)
            elif website.default_lang_id != dutch:
                values = {"default_lang_id": dutch.id}
                if dutch not in website.language_ids:
                    values["language_ids"] = [(4, dutch.id)]
                website.write(values)
                website.invalidate_recordset(["default_lang_id", "language_ids"])
                applied["default_lang_id"] = website.default_lang_id.code
        routing = {name: bool(website[name]) for name in
                   ("crm_default_team_id", "crm_default_user_id",
                    "salesteam_id", "salesperson_id", "theme_id")
                   if name in website._fields}
        if "crm_default_team_id" in routing and not routing["crm_default_team_id"]:
            _logger.warning(
                "cs_prefab_website: website %s has no crm_default_team_id, so a lead from the "
                "contact form lands in no sales team. Nothing errors; the lead simply waits.",
                website.id)
        applied["routing"] = routing
        applied["language"] = website.default_lang_id.code
        return applied

    def _cs_prefab_apply_brand_images(self, website):
        """Place the logo and the favicon, on the first run only -- keeping the old ones.

        This is the step whose meaning changed most. On a new website both fields hold an Odoo
        PLACEHOLDER (``_default_logo`` is a grey SVG, ``_default_favicon`` is Odoo's own
        icon), so replacing them cost nothing. Here they hold the customer's own brand, and
        ``website.logo`` is an attachment-backed Binary: writing a new value overwrites the
        stored bytes and the old image is gone.

        So the previous pair is copied into two plain attachments first, named in Dutch and
        findable under Instellingen → Technisch → Bijlagen. Nothing depends on them; they
        exist so that "put the old logo back" is a download and an upload rather than a
        conversation about backups.

        One shot, for the reason the docstring above gives twice over: comparing against the
        shipped bytes instead would overwrite whatever the customer uploads later, on every
        upgrade.
        """
        kept = self._cs_prefab_keep_previous_brand(website)
        values = {}
        media = self.env["cs.prefab.website.media"]
        logo = media._media_bytes("logo-prefab_partner.svg")
        favicon = media._media_bytes("cropped-favicon.png")
        if logo:
            values["logo"] = media._binary(logo)
        if favicon:
            values["favicon"] = media._binary(favicon)
        if values:
            website.write(values)
            website.invalidate_recordset(["logo", "favicon"])
        return {"seeded": bool(values), "logo": bool(website.logo),
                "favicon": bool(website.favicon), "kept": kept}

    def _cs_prefab_keep_previous_brand(self, website):
        """Copy the website's current logo and favicon into recoverable attachments.

        Two traps, both measured on this target rather than reasoned about:

        * the content goes into ``raw`` and NOT into ``datas``. ``ir.attachment.datas`` no
          longer exists and ``_check_contents`` pops it with only a ``warnings.warn``, so the
          ``datas`` spelling creates an attachment of zero bytes and reports success. Same
          trap, and the same fix, as ``_sync_media``.
        * **a Binary field reads back RAW BYTES here, not base64.** The reflex
          ``base64.b64decode(website.logo)`` does not raise on those bytes -- ``b64decode``
          skips characters outside its alphabet -- it silently returns a shorter, different
          file. Measured: a 76-byte SVG came back out as 48 bytes of noise with a checksum
          that matched nothing, and the attachment looked perfectly healthy in the list view.

        Which is why the write is read back: the stored checksum is compared with the sha1 of
        what went in, and a snapshot that does not match is deleted rather than left behind
        pretending to be the old logo. A backup nobody can tell is corrupt is worse than none.

        Never overwrites an earlier copy: if the inrichting is re-run after the flag was
        cleared, the FIRST snapshot is the customer's own and the second would be ours.
        """
        attachment_model = self.env["ir.attachment"].sudo()
        media = self.env["cs.prefab.website.media"]
        kept = {}
        for field, label in (("logo", "logo"), ("favicon", "favicon")):
            name = f"Vorig {label} van deze website (bewaard door Prefab Partner)"
            if attachment_model.search_count([("name", "=", name)]):
                kept[field] = "already kept"
                continue
            try:
                stored = website[field]
                if not stored:
                    continue
                content = stored.encode() if isinstance(stored, str) else bytes(stored)
                attachment = attachment_model.create({
                    "name": name,
                    "raw": media._binary(content),
                    "public": False,
                    "type": "binary",
                    "description": "Automatisch bewaard toen de Prefab Partner-inrichting het "
                                   f"{label} van deze website verving. Download dit bestand en "
                                   "upload het terug bij Website → Instellingen om het oude "
                                   f"{label} te herstellen.",
                })
                expected = hashlib.sha1(content).hexdigest()
                if attachment.checksum != expected:
                    _logger.error(
                        "cs_prefab_website: the %s snapshot stored %s where %s was written; "
                        "removing it rather than keeping a file that is not the old %s",
                        label, attachment.checksum, expected, label)
                    attachment.unlink()
                    kept[field] = False
                    continue
                kept[field] = attachment.id
            except Exception:  # noqa: BLE001 - keeping a copy must never fail an install
                _logger.exception("cs_prefab_website: could not keep the previous %s", label)
                kept[field] = False
        _logger.info("cs_prefab_website: previous brand images kept as %s", kept)
        return kept

    def _cs_prefab_apply_menu(self, website):
        """Add this site's navigation to the menu the website already has.

        ADDS ONLY. The navigation of a website that is being served right now is not something
        an upgrade gets to rewrite: a customer whose menu is rearranged overnight has no undo
        and no message explaining it. So every entry of MENU_TREE that is not there yet is
        created, matching on URL so the Home the website already has is REUSED rather than
        duplicated, and anything else that is already in the tree stays exactly where it is.
        What is left over is reported on the settings form (``cs_prefab_menu_status``) so the
        customer can remove it themselves, deliberately, with the site in front of them.

        A website.menu created without a website_id is duplicated onto every website by Odoo's
        own create() -- useful when a module adds /shop, wrong here. Every record below
        therefore carries website_id.

        Runs once. From then on the navigation belongs to the customer, so a renamed entry, a
        reordered one or a removed one stays that way.
        """
        menu_model = self.env["website.menu"].sudo()
        root = website.menu_id
        if not root:
            _logger.warning("cs_prefab_website: website %s has no root menu", website.id)
            return {"root": False}
        before = menu_model.search_count([("website_id", "=", website.id)])
        created = self._cs_prefab_create_menu_level(website, root, MENU_TREE)
        return {"entries_created": created, "entries_before": before,
                "entries_after": menu_model.search_count([("website_id", "=", website.id)])}

    def _cs_prefab_drop_seeded_blog_menu(self, website):
        """Remove the Blog entries that website_blog seeded because of THIS module.

        The justification is narrow on purpose, and it is the only removal in this file: that
        entry did not exist before this module was installed. It appeared because
        ``__manifest__.py`` depends on website_blog for the two news posts. Removing it leaves
        the navigation exactly as the customer had it, which is what this module promises;
        leaving it would put an English /blog next to the Dutch /nieuws that is in the URL
        contract.

        Both copies go: the one on this website, and the GLOBAL one (website_id NULL) that
        Odoo's ``website.menu.create`` fans out onto every website -- including any website
        created later.

        It runs once. If somebody adds a blog entry themselves afterwards, no later upgrade
        removes it.
        """
        menu_model = self.env["website.menu"].sudo()
        seeded = menu_model.search([("url", "=", BLOG_MENU_URL), "|",
                                    ("website_id", "=", website.id),
                                    ("website_id", "=", False)])
        removed = [{"id": menu.id, "url": menu.url,
                    "website_id": menu.website_id.id or None} for menu in seeded]
        seeded.unlink()
        if removed:
            _logger.info("cs_prefab_website: removed the website_blog menu entries %s", removed)
        return removed

    def _cs_prefab_unpublish_company_partner(self):
        """Put base.main_partner back to unpublished, where installing website_partner found it.

        website_blog depends on website_partner, which publishes the company partner on install so it shows in a
        public partner directory. Nobody asked for that directory, no view in this database links to /partners/,
        and the record is PRE-EXISTING -- so the release gate refuses the upgrade over it, which is the gate
        working. Restoring the value is the honest fix; teaching the gate to ignore it would not be.

        One shot. If an administrator publishes the partner deliberately later, this never runs again.
        """
        partner = self.env.ref("base.main_partner", raise_if_not_found=False)
        if not partner or "is_published" not in partner._fields:
            return {"changed": False, "reason": "website_partner is not installed"}
        partner = partner.sudo()
        if not partner.is_published:
            return {"changed": False, "reason": "already unpublished"}
        # BOTH columns, not just the flag. published_date is stamped when the record is first published and is
        # NOT cleared by flipping is_published back, so writing only the flag leaves the row still different
        # from how the upgrade found it. The release gate compares VALUES and refused the deploy over exactly
        # that: it named res_partner id 1, columns is_published and published_date, on a run where the flag
        # had already been restored.
        partner.write({"is_published": False, "published_date": False})
        _logger.info("cs_prefab_website: unpublished base.main_partner (%s), published by website_partner on install",
                     partner.id)
        return {"changed": True, "partner_id": partner.id}

    def _cs_prefab_create_menu_level(self, website, parent, spec):
        menu_model = self.env["website.menu"].sudo()
        count = 0
        for entry in spec:
            # Matching on the url alone, not on the label: the website already has a "Home"
            # at "/" and a second one would be a duplicate in the navigation. Odoo forces the
            # url of a menu that HAS children to "#" (website.menu._compute_url), so the
            # parent of a submenu is matched on its label as well -- see below.
            existing = menu_model.search(
                [("website_id", "=", website.id), ("parent_id", "=", parent.id),
                 ("url", "=", entry["url"])], limit=1)
            if not existing and entry.get("children"):
                existing = menu_model.search(
                    [("website_id", "=", website.id), ("parent_id", "=", parent.id),
                     ("name", "=", entry["name"])], limit=1)
            if not existing:
                existing = menu_model.create({
                    "name": entry["name"], "url": entry["url"], "sequence": entry["sequence"],
                    "parent_id": parent.id, "website_id": website.id,
                })
                count += 1
            if entry.get("children"):
                count += self._cs_prefab_create_menu_level(website, existing, entry["children"])
        return count

    @api.model
    def _cs_prefab_claim_homepage(self):
        """Keep this site's homepage and its native website override at "/".

        Runs LAST, from ``data/homepage_data.xml``, because it needs this module's own page to
        exist: on the first install ``data/page_data.xml`` has only just created it.

        Why it is not a no-op. ``ir.http._serve_page`` resolves a path with
        ``search_fetch(url = path, order='website_id asc', limit=1)``. Two pages at "/" on the
        SAME website are a tie that PostgreSQL breaks however it likes, so the homepage a
        visitor gets is a coin flip between this site's and the one the website had before --
        measured in the saas~19.4 source, not assumed.

        A generic template and its website-specific copy are NOT that ambiguity. Odoo's
        editor creates the latter on save and deliberately gives it the same view key.
        Both records must keep their URL/publication state on every later module upgrade.

        Why it MOVES and never deletes, which is the change of meaning. On a website that was
        created a millisecond ago, the page at "/" is Odoo's empty bootstrap placeholder and
        removing it costs nothing. Here it is the customer's own homepage, with their content
        in it. So it is moved to ``/oude-startpagina`` and unpublished; the record, its view
        and its content are all still there, and putting it back is one field.

        The order inside matters and is the subtle part: ``website.menu.url`` is a STORED
        COMPUTE over ``page_id`` (``website.menu._compute_url``), so the "Home" entry of the
        existing navigation follows whatever page it is linked to. Repoint it at this site's
        page FIRST; change the other page's url after. Reversed, the menu would quietly start
        pointing at /oude-startpagina.

        What is deliberately NOT done: nothing happens when this module's own page is absent.
        That is the state after a customer deletes it, and their homepage is then the only one
        there is.
        """
        website = self._cs_prefab_site()
        ours = self.env.ref("cs_prefab_website.page_home_record", raise_if_not_found=False)
        if not website or not ours or not ours.exists():
            _logger.info("cs_prefab_website: no site page at '/' to claim; homepage untouched")
            return {"claimed": False}
        page_model = self.env["website.page"].sudo()
        menu_model = self.env["website.menu"].sudo()
        # (False, website.id), not website.id. This module's pages are generic since the
        # copy-on-write repair, and a search scoped to the website id stops finding its own
        # homepage -- which would make this method report zero pages at "/" while one is being
        # served, and move the wrong record.
        served_here = ("website_id", "in", (False, website.id))
        root_pages = page_model.search([("url", "=", "/"), served_here])
        own_copies = root_pages.filtered(
            lambda page: page.website_id == website and page.view_id.key == ours.view_id.key)
        own_pages = ours | own_copies
        strays = root_pages - own_pages
        moved = []
        for stray in strays:
            # The menu first, or it follows the page to its new address.
            menu_model.search([("page_id", "=", stray.id)]).page_id = ours.id
            url = PREVIOUS_HOMEPAGE_URL
            if page_model.search_count([("url", "=", url), served_here]):
                url = f"{PREVIOUS_HOMEPAGE_URL}-{stray.id}"
            stray.write({"url": url, "is_published": False})
            stray.invalidate_recordset(["url", "is_published"])
            moved.append({"id": stray.id, "url": stray.url, "key": stray.view_id.key})
        # The home entry of the navigation points at our page either way: on a website whose
        # menu never had a page_id at all, "/" is only a string and is_homepage stays false.
        home = menu_model.search([
            ("website_id", "=", website.id), ("parent_id", "=", website.menu_id.id),
            ("url", "=", "/")], limit=1)
        if home and home.page_id not in own_pages:
            home.page_id = ours.id
        published_root = page_model.with_context(website_id=website.id).search([
            ("url", "=", "/"), served_here, ("is_published", "=", True)])
        at_root = len(published_root._get_most_specific_pages())
        if at_root != 1:
            _logger.warning("cs_prefab_website: %s pages still answer '/' on website %s",
                            at_root, website.id)
        result = {"claimed": ours.id, "moved": moved, "pages_at_root": at_root,
                  "page_records_at_root": len(published_root),
                  "home_menu": home.id or False}
        _logger.info("cs_prefab_website: homepage -> %s", result)
        return result

    def _cs_prefab_apply_theme(self, website):
        """Put the brand where Odoo's own editor reads it, instead of painting over it.

        THE PROBLEM THIS SOLVES. Until this release the whole appearance of the site lived in
        ``static/src/scss/prefab_site.scss``, scoped to ``.o_prefab_site`` -- a layer DOWNSTREAM
        of every choice the Theme tab writes. The customer could open Vormgeving, pick a colour,
        a font, a button radius or a footer preset, and see nothing change. That is the exact
        opposite of what was asked for, and it also meant the picker showed one set of colours
        while the page showed another: the palette in the editor was ``#e8511d`` and the
        stylesheet painted ``#C43F12``.

        WHY THE EARLIER ATTEMPT FAILED, AND WHY THIS ONE CANNOT. The previous version of this
        method was a documented no-op. It had tried to REGISTER A NEW PALETTE by merging into
        ``$o-color-palettes`` from a file in ``web._assets_primary_variables``, and Odoo's palette
        generation then raised ``Incompatible units: '%' and 'px'`` -- which took
        ``web.assets_frontend`` down for EVERY website on the instance.

        The root cause is in Odoo's own source rather than in ours.
        ``website/static/src/scss/secondary_variables.scss`` sets ``$-gray-color-palette-name``
        and ``$-theme-color-palette-name`` to the SAME string as ``color-palettes-name``, and
        then resolves each with ``map-get($o-gray-color-palettes, $name) or ()``. A name
        registered in ``$o-color-palettes`` alone therefore yields an EMPTY gray map and an
        EMPTY theme map, and the arithmetic downstream runs on nulls. Registering a palette
        requires registering it in all three maps.

        So this method does not register one. It writes the brand into the per-WEBSITE customer
        values -- ``$o-user-color-palette`` and ``$o-user-website-values`` -- which is what the
        editor itself writes when a human moves a swatch. Nothing reaches
        ``web._assets_primary_variables``; that manifest key stays empty and this module
        contributes nothing to any instance-wide bundle. ``website/models/assets.py`` stamps
        ``website_id`` on both the attachment and the ``ir.asset``, so the customer's other
        website is untouched by construction.

        The pattern is Odoo's own: ``website/models/website.py::configurator_apply`` does
        exactly these two calls, in exactly this order, with exactly this quoting.

        ORDER IS LOAD-BEARING. ``assets.py`` makes a write of ``color-palettes-name`` reset
        ``user_color_palette.scss``, ``user_gray_color_palette.scss``, the four theme colours
        and every gradient key. That reset is the clean slate we want -- but only BEFORE the
        colours are written. Sending the name after them would erase them.

        ONE-SHOT, by band. The seed runs while ``cs_prefab_seed_level`` is below the band that
        carries it; after that the theme is the customer's, exactly like the logo and the menu,
        and no upgrade touches it again. A deliberate rebrand is one constant bump.

        READ BACK. Every write here is verified by re-reading the compiled files, because a
        write into a customisation file that does not take produces no error at all -- this
        module has already shipped one silent no-op of precisely that kind.
        """
        assets = self.env["website.assets"].with_context(website_id=website.id)
        result = {}

        # 1 -- the palette NAME, first and alone. Resets the colour, gray, state and gradient
        #      customisations. 'base-1' is what the live website already carries and is the
        #      palette whose o-color-N -> o_ccN mapping the colours below are written against.
        assets.make_scss_customization(THEME_USER_VALUES, {"color-palettes-name": "'base-1'"})

        # 2 -- the five brand colours, the four chrome keys and all 35 combination values.
        #      Pinning a combination value also adds it to Odoo's auto-contrast exclusions, so
        #      Odoo stops deriving near-duplicate shades of its own: that is what removes the
        #      four stray oranges the site carries today.
        assets.make_scss_customization(THEME_USER_COLORS, self._cs_prefab_palette_values())
        result["palette"] = len(self._cs_prefab_palette_values())

        # 3 -- Bootstrap's state colours. Odoo strips 'primary'/'secondary' here, so they are
        #      deliberately absent; they come from o-color-1 and o-color-2.
        assets.make_scss_customization(THEME_USER_STATES, {
            "success": "#1B7A3E",   # 5.38:1 on white, and on it
            "info": "#1A5D8F",      # 6.99:1
            "warning": "#8A5A00",   # 5.93:1 -- a dark olive-amber, deliberately NOT a bright
                                    # amber, which would collide with the brand orange
            "danger": "#B3261E",    # 6.54:1
        })
        result["states"] = 4

        # 4 -- every other value the Theme tab owns: the type scale, the buttons, the inputs,
        #      the header, the footer and the three shadow tiers.
        values = self._cs_prefab_website_values()
        assets.make_scss_customization(THEME_USER_VALUES, values)
        result["values"] = len(values)

        # 5 -- THE FONTS ARE NOT SELF-HOSTED HERE, AND THE REASON IS WORTH THE PARAGRAPH.
        #
        # Asking Odoo to self-host Inter and Inter Tight is one line --
        # {"google-local-fonts": "('Inter': '', 'Inter Tight': '')"} -- and it is the right
        # outcome: the site currently fetches both families from fonts.googleapis.com through
        # an @import at the top of the compiled stylesheet, which happens BEFORE the visitor
        # answers the cookie bar and which Odoo's third-party blocker cannot see, because none
        # of the domains in its list is a font host. A refusal is therefore not honoured.
        #
        # What that one line also does is make a MODULE INSTALL depend on an outbound HTTPS
        # request. Odoo downloads the woff2 files inside make_scss_customization
        # (website/models/assets.py), so the call reaches the network with the upgrade
        # transaction open. Wrapping it in try/except is not enough: the exception is caught,
        # the install continues, and what is left behind is a customisation file in a state
        # nobody chose. That is the same shape of failure as the palette this module withdrew a
        # release ago -- the instance-wide frontend bundle stops compiling, for every website on
        # this Odoo, with no error at the call site.
        #
        # It is also what made this release's clone test non-deterministic: the test runner
        # blocks un-mocked outbound HTTP, so the call raises there and never in a hand-run
        # shell, which is why five rounds of bisecting the VALUES all came back green.
        #
        # So the privacy fix is deferred to its own wave, where it can be done the way it has to
        # be: download first, verify the bundle still compiles, and roll the value back if it
        # does not. What is done here is the part that is safe and that repairs a previous
        # attempt -- the key is explicitly cleared, so a half-written value cannot survive.
        assets.make_scss_customization(THEME_USER_VALUES, {"google-local-fonts": "null"})
        result["fonts"] = "remote (self-hosting deferred; see the comment)"

        # 6 -- drop the compiled bundles, so the new values are what the next visitor downloads.
        #
        # Not housekeeping. Odoo keeps each compiled bundle as an ir.attachment under
        # /web/assets/, and changing an SCSS variable does not delete it: the customisation
        # files are new and the compiled CSS is the old one, so the page keeps rendering in the
        # previous brand with no error anywhere. Worse in the other direction -- a bundle that
        # failed to compile is cached too, and then stays broken after the cause is fixed.
        # That is what made this release's clone test keep failing on a defect that had already
        # been repaired.
        stale = self.env["ir.attachment"].sudo().search([("url", "=like", "/web/assets/%")])
        result["bundles_dropped"] = len(stale)
        stale.unlink()

        # 7 -- the header and footer options, which are views rather than SCSS.
        result["views"] = self._cs_prefab_apply_chrome_views(website)

        # 7 -- read it back. A palette write that does not reach :root is a silent no-op.
        result["verified"] = self._cs_prefab_verify_theme(website)
        return result

    @api.model
    def _cs_prefab_palette_values(self):
        """The 39 keys of user_color_palette.scss: five colours, four chrome keys, 35 combinations.

        Pinned rather than derived. Odoo can compute a combination from the five colours, but
        then the contrast of a link on a tinted section is a side effect of somebody else's
        formula instead of a measured number -- and on the two light tinted grounds that formula
        produces 4.44:1 and 4.02:1, which fail.
        """
        return {
            "o-color-1": BRAND_ACTION,   # -> o_cc4 background, $primary, every .btn-primary fill
            "o-color-2": BRAND_STONE,    # -> o_cc3 background, $secondary
            "o-color-3": BRAND_TINT,     # -> o_cc2 background
            "o-color-4": BRAND_PAPER,    # -> o_cc1 background and $body-bg
            "o-color-5": BRAND_INK,      # -> o_cc5 background

            # The header sits on paper and the footer on ink. Today 'footer' is 2, which is why
            # a band of light grey hangs below the dark footer on every page.
            "menu": 1,
            "footer": 5,
            "copyright": 5,
            "breadcrumb": 1,

            # cc1 -- Paper. The default reading surface.
            "o-cc1-bg": BRAND_PAPER,
            "o-cc1-text": BRAND_INK,
            "o-cc1-headings": BRAND_INK,
            "o-cc1-link": BRAND_ACTION,
            "o-cc1-btn-primary": BRAND_ACTION,
            "o-cc1-btn-secondary": BRAND_INK,
            "o-cc1-btn-secondary-border": BRAND_INK,

            # cc2 -- Tint. The quiet band between two white sections.
            "o-cc2-bg": BRAND_TINT,
            "o-cc2-text": BRAND_INK,
            "o-cc2-headings": BRAND_INK,
            "o-cc2-link": BRAND_DEEP,    # the action colour is 4.44:1 here and fails
            "o-cc2-btn-primary": BRAND_ACTION,
            "o-cc2-btn-secondary": BRAND_INK,
            "o-cc2-btn-secondary-border": BRAND_INK,

            # cc3 -- Stone. The utility surface that has to hold a white plate: the lead forms,
            # the technical drawing, a card grid whose cards are cc1.
            "o-cc3-bg": BRAND_STONE,
            "o-cc3-text": BRAND_INK,
            "o-cc3-headings": BRAND_INK,
            "o-cc3-link": BRAND_DEEP,    # the action colour is 4.02:1 here and fails
            "o-cc3-btn-primary": BRAND_ACTION,
            "o-cc3-btn-secondary": BRAND_INK,
            "o-cc3-btn-secondary-border": BRAND_INK,

            # cc4 -- Action. At most one band per page. Ink text here is 3.37:1 and is forbidden.
            "o-cc4-bg": BRAND_ACTION,
            "o-cc4-text": BRAND_PAPER,
            "o-cc4-headings": BRAND_PAPER,
            "o-cc4-link": BRAND_PAPER,
            "o-cc4-btn-primary": BRAND_PAPER,
            "o-cc4-btn-secondary": BRAND_PAPER,
            "o-cc4-btn-secondary-border": BRAND_PAPER,

            # cc5 -- Ink. The footer, the page-title band, the dark alternative to an orange CTA.
            "o-cc5-bg": BRAND_INK,
            "o-cc5-text": BRAND_PAPER,
            "o-cc5-headings": BRAND_PAPER,
            "o-cc5-link": BRAND_ASH,     # on a dark ground the only warm object is the button
            "o-cc5-btn-primary": BRAND_ACTION,
            "o-cc5-btn-secondary": BRAND_PAPER,
            "o-cc5-btn-secondary-border": BRAND_PAPER,
        }

    @api.model
    def _cs_prefab_website_values(self):
        """user_values.scss: the type scale, the controls, the chrome and the shadows.

        Every number here was a hard-coded rule in prefab_site.scss until this release. Moving
        it up to the website value is what makes the Theme tab work: the same number, owned by
        the editor instead of by a stylesheet the customer cannot reach.

        The three spellings 'True', 'False' and 'null' are the ones Odoo converts; anything else
        reaches Sass verbatim, which is why a Sass STRING carries its quotes inside the Python
        string.
        """
        return {
            # Type. The site had six rendered heading sizes and no rule; this is the scale --
            # seven steps, average ratio 1.24, every step a whole pixel. Odoo compiles Bootstrap
            # RFS on top, so these stay fluid below 1200px for free.
            # THE FONT FAMILIES ARE DELIBERATELY NOT WRITTEN.
            #
            # Odoo's own defaults are already Inter for the body and Inter Tight for the
            # headings (website/static/src/scss/primary_variables.scss: the default website
            # values palette). Writing the same two names again changes nothing a visitor can
            # see -- and it does change something: it marks the family as CHOSEN, which puts it
            # on a different path through Odoo's font handling.
            #
            # That path is where this release first broke. The clone test compiles the frontend
            # bundle inside a runner that blocks outbound HTTP, and the bundle's font handling
            # does not survive that, while the same seed compiles cleanly in a shell with a
            # network. Five rounds of bisecting every other value came back green; this is the
            # one key whose removal is free.
            #
            # Leaving them null keeps the typeface, keeps the whole type SCALE below (the hN
            # sizes are separate keys and do land), and keeps the compile deterministic. The
            # fonts still arrive from fonts.googleapis.com, which is a real privacy defect the
            # audit records -- it is the same defect the site has today, it is not made worse
            # here, and fixing it properly means shipping the woff2 files inside this module
            # rather than asking a module install to reach the internet.
            "navbar-font": "null",
            "buttons-font": "null",
            "font-size-base": "1rem",
            "small-font-size": "0.875rem",
            "h1-font-size": "3.25rem",      # 52
            "h2-font-size": "2.625rem",     # 42
            "h3-font-size": "2.125rem",     # 34
            "h4-font-size": "1.75rem",      # 28
            "h5-font-size": "1.375rem",     # 22
            "h6-font-size": "1.125rem",     # 18
            "body-line-height": 1.6,        # Dutch runs long; 1.5 is tight
            "headings-line-height": 1.15,
            "h4-line-height": 1.25,
            "h5-line-height": 1.3,
            "h6-line-height": 1.35,
            "headings-margin-top": 0,
            "headings-margin-bottom": "1rem",
            "paragraph-margin-top": 0,
            "paragraph-margin-bottom": "1rem",
            "headings-font-weight": 700,    # was a hand-written 800, heavier than the brand needs
            "headings-font-weight-bold": 800,
            "btn-font-weight": 600,
            "lead-font-weight": 400,

            # Buttons. One component, one radius, one padding, on all five grounds. The
            # secondary is an outline so it can never be mistaken for the primary -- the site
            # has six orange buttons per page today and no visual hierarchy between them.
            "btn-padding-y": "0.75rem",
            "btn-padding-x": "1.5rem",
            "btn-font-size": "1rem",
            "btn-border-width": "1px",
            "btn-border-radius": "4px",
            "btn-padding-y-lg": "0.9375rem",
            "btn-padding-x-lg": "2rem",
            "btn-font-size-lg": "1.0625rem",
            "btn-border-radius-lg": "4px",  # native default is a 2rem pill
            "btn-padding-y-sm": "0.5rem",
            "btn-padding-x-sm": "1rem",
            "btn-font-size-sm": "0.875rem",
            "btn-border-radius-sm": "4px",
            "btn-primary-outline": "False",
            "btn-secondary-outline": "True",
            "btn-primary-flat": "False",
            "btn-secondary-flat": "False",
            "btn-primary-outline-border-width": "1px",
            "btn-secondary-outline-border-width": "1px",
            "btn-ripple": "False",
            "link-underline": "'always'",

            # Inputs, matched to the buttons so a form row lines up.
            "input-padding-y": "0.75rem",
            "input-padding-x": "1rem",
            "input-font-size": "1rem",
            "input-border-width": "1px",
            # 0.25rem, not 4px, and the difference is not cosmetic: at a 16px root they render
            # identically, and only one of them compiles. Odoo combines the input radius with a
            # rem-valued expression in the WEBSITE variant of web.assets_frontend -- the variant
            # a visitor actually downloads, and not the one a bare _get_asset_bundle() call
            # returns -- and a px value there raises "Incompatible units: rem and px", which
            # takes the frontend bundle down for every website on the instance. Bisected on the
            # clone: this one key, alone, with every other value null.
            "input-border-radius": "0.25rem",
            "input-border-radius-sm": "0.25rem",
            "input-border-radius-lg": "0.25rem",
            "input-padding-y-lg": "0.9375rem",
            "input-padding-x-lg": "1rem",

            "layout": "'full'",

            # Header. Fixed rather than Odoo's "standard" affix, because standard scrolls the
            # header away and brings it back on the way up -- two different behaviours from one
            # setting, which is what made two separate measurements of this site disagree.
            "header-template": "'default'",
            "header-links-style": "'underline'",
            "header-text-color": "null",
            "header-font-size": "null",
            "logo-height": "2.25rem",
            "fixed-logo-height": "1.875rem",
            "hamburger-position": "'left'",
            "hamburger-position-mobile": "'right'",
            "menu-border-width": 0,
            "menu-border-radius": 0,
            "menu-shadow-class": "'shadow-sm'",
            "menu-box-shadow-style": "null",

            # Footer.
            "footer-template": "'links'",
            "footer-effect": "null",
            "footer-scrolltop": "False",

            # Three shadow tiers, so no block ever needs a literal box-shadow again.
            "box-shadow-color": "rgba(0, 0, 0, 0.18)",
            "box-shadow-offset-x": "0px",
            "box-shadow-offset-y": "4px",
            "box-shadow-blur-radius": "16px",
            "box-shadow-spread-radius": "0px",
            "box-shadow-sm-color": "rgba(0, 0, 0, 0.22)",
            "box-shadow-sm-offset-x": "0px",
            "box-shadow-sm-offset-y": "2px",
            "box-shadow-sm-blur-radius": "8px",
            "box-shadow-sm-spread-radius": "0px",
            "box-shadow-lg-color": "rgba(0, 0, 0, 0.25)",
            "box-shadow-lg-offset-x": "0px",
            "box-shadow-lg-offset-y": "12px",
            "box-shadow-lg-blur-radius": "32px",
            "box-shadow-lg-spread-radius": "0px",
        }

    def _cs_prefab_apply_white_label(self, website):
        """Give cs_white_label_kit this company's brand instead of the placeholder it ships.

        THE DEFECT THIS CLOSES. cs_white_label_kit carries `data/demo_branding.xml` in its DATA
        list rather than its demo list, so merely installing it writes three parameters:

            cs_white_label_kit.brand_name       -> "Your Brand"
            cs_white_label_kit.brand_url        -> "https://example.com"
            cs_white_label_kit.powered_by_text  -> "Powered by Your Brand"

        Its own description says brand_name drives the page titles, the installed-app (PWA) name
        and the "Powered by" line on the login screen, the portal sidebar and the storefront. So
        the install alone puts placeholder text in front of real customers, on a live site, with
        nothing failing and nothing logged.

        SOFT, in both directions. There is no dependency on cs_white_label_kit -- the house rule
        is that an optional module is imported softly and never hard-depended on -- so this reads
        the parameters and does nothing at all when the module is absent. And it only replaces
        values that are still the shipped placeholders: a brand the administrator has already
        set is left exactly as it is, which is the same promise every other one-shot step here
        makes.

        The favicon is the reason this release exists. The parameter takes a URL that the layout
        template renders straight into `<link rel="shortcut icon">`, ahead of Odoo's own, on
        every backend and frontend page -- so a relative path to this site's own favicon
        attachment is both valid and the right answer.
        """
        params = self.env["ir.config_parameter"].sudo()
        if not self.env["ir.module.module"].sudo().search_count(
                [("name", "=", "cs_white_label_kit"), ("state", "=", "installed")]):
            return {"skipped": "cs_white_label_kit is not installed"}

        company = website.company_id or self.env.company
        favicon = self.env.ref(
            "cs_prefab_website.media_cropped_favicon_png_a192b36a", raise_if_not_found=False)
        wanted = {
            "cs_white_label_kit.brand_name": company.name or "Prefab Partner",
            "cs_white_label_kit.brand_url": self._cs_prefab_canonical_host(),
            "cs_white_label_kit.powered_by_text": "Prefab Partner",
        }
        if favicon:
            wanted["cs_white_label_kit.favicon_url"] = (
                "/web/image/cs_prefab_website.media_cropped_favicon_png_a192b36a/"
                "64x64/cropped-favicon.png")

        # Only these three exact strings are treated as "nobody has chosen anything yet".
        placeholders = {
            "cs_white_label_kit.brand_name": {"", "Your Brand"},
            "cs_white_label_kit.brand_url": {"", "https://example.com", "#"},
            "cs_white_label_kit.powered_by_text": {"", "Powered by Your Brand"},
            "cs_white_label_kit.favicon_url": {""},
        }
        written, kept = {}, {}
        for key, value in wanted.items():
            current = params.get_str(key) or ""
            if current in placeholders[key]:
                params.set_str(key, value)
                written[key] = value
            else:
                kept[key] = current
        if written:
            _logger.info("cs_prefab_website: white-label placeholders replaced: %s", written)
        return {"written": written, "kept": kept}

    def _cs_prefab_apply_warm_design(self, website):
        """Apply the approved visual direction once, through native website options.

        Do not reselect the palette name: doing that resets the owner's other theme values.
        All later edits belong to the Website Builder, including a different tint or scale.
        """
        assets = self.env["website.assets"].with_context(website_id=website.id)
        assets.make_scss_customization(THEME_USER_COLORS, {
            "o-color-3": BRAND_TINT, "o-cc2-bg": BRAND_TINT,
        })
        assets.make_scss_customization(THEME_USER_VALUES, {
            "h1-font-size": "3.75rem", "headings-line-height": 1.08,
            "menu-shadow-class": "'shadow-none'",
        })
        # This approved redesign consolidates the home/configurator entries into the logo
        # and header CTA. All remaining links continue to use the native menu editor.
        menu = self.env["website.menu"].sudo()
        labels = {"/": ("Home", 10), "/projecten": ("Projecten", 30),
                  "/over-ons": ("Over ons", 40), "/partner-worden": ("Voor professionals", 50),
                  "/contact": ("Contact", 60)}
        for item in menu.search([("website_id", "=", website.id),
                                 ("parent_id", "=", website.menu_id.id)]):
            if item.url in ("/", "/offerte", "/prefab") and not item.child_id:
                item.unlink()
            elif item.url in labels:
                name, sequence = labels[item.url]
                item.write({"name": name, "sequence": sequence})
            elif item.child_id and item.name == "Oplossingen":
                item.sequence = 20
        changed = []
        for xmlid, state in [
            ("website.header_search_box", False), ("portal.user_sign_in", False),
            ("website_sale.header_hide_empty_cart_link", True),
            ("website_sale.header_hide_empty_wishlist_link", True),
        ]:
            if self.env.ref(xmlid, raise_if_not_found=False):
                view = website.with_context(website_id=website.id).viewref(xmlid)
                if view.active != state:
                    view.active = state
                    changed.append(xmlid)
        self.env["ir.attachment"].sudo().search([("url", "=like", "/web/assets/%")]).unlink()
        return {"tint": BRAND_TINT, "h1": "3.75rem", "native_theme": True, "header_options": changed}

    def _cs_prefab_apply_chrome_views(self, website):
        """The header and footer options that are views rather than SCSS values.

        Odoo expresses part of its chrome as optional templates that the Header and Footer
        panels switch on and off. They are toggled here with the same mechanism the editor
        uses -- writing ``active`` under a website context, which makes Odoo copy the view for
        this website rather than flipping it for the whole instance.

        What each one is for:

        * ``header_visibility_fixed`` over ``_standard``. Odoo's "standard" effect scrolls the
          header away and re-affixes it on the way back up, so the same setting measures as
          ``static`` at the top of the page and ``fixed`` halfway down -- which is how two
          separate measurements of this site arrived at opposite answers. Fixed is one state.
        * ``header_width_full`` off. With it on, the navbar runs edge to edge while every
          section below it sits in a container, so the logo never lines up with the content.
        * ``header_text_element`` off. This is the view that carries Odoo's demonstration
          telephone number ``+1 555-555-5556``. It is rendered twice per page -- desktop and
          off-canvas -- on all 21 pages, next to a real Dutch number it outnumbers four to one.
        * ``footer_no_copyright`` on. Odoo's colophon closes every page with two rows, two
          background colours and two plain-http links to odoo.com.

        A view that is already in the wanted state is not written, so this is idempotent and
        says in its result which ones it actually changed.
        """
        wanted = [
            ("website.header_visibility_standard", False),
            ("website.header_visibility_fixed", True),
            ("website.header_width_full", False),
            ("website.header_text_element", False),
            ("website.footer_no_copyright", True),
        ]
        changed, missing = [], []
        for xmlid, state in wanted:
            if not self.env.ref(xmlid, raise_if_not_found=False):
                # Not an error: an option template belongs to a module that may not be
                # installed on every instance. Say so and carry on.
                missing.append(xmlid)
                continue
            # `viewref` resolves to the copy that belongs to THIS website if there is one, and
            # to the generic view otherwise -- which is what the builder's own option code
            # reads. `env.ref(...).with_context(website_id=...)` does not: it returns the
            # generic record with a context attached, so writing `active` on it flips the view
            # for every website on the instance, and reading it back reports the generic
            # state. Measured: the demonstration telephone number read as still active
            # immediately after being switched off.
            view = website.with_context(website_id=website.id).viewref(xmlid)
            if view.active != state:
                view.active = state
                changed.append(f"{xmlid}={state}")
        # The header's one call-to-action button. Odoo ships it pointing at /contactus -- its
        # own demonstration page, which tells Dutch visitors to take the BART to Balboa Park
        # and claims fifty thousand companies use these services. It is the single most
        # prominent link on the site.
        cta = website.contact_us_link_url
        if cta in (False, "", "/contactus"):
            website.contact_us_link_url = "/contact"
            website.invalidate_recordset(["contact_us_link_url"])
            changed.append("contact_us_link_url=/contact")
        result = {"changed": changed, "missing": missing}
        if missing:
            _logger.info("cs_prefab_website: chrome option views not present: %s", missing)
        return result

    def _cs_prefab_verify_theme(self, website):
        """Read the seed back out of the files Odoo actually compiles.

        This exists because the failure it guards against has already happened here once: a
        write into a customisation file that does not take produces no exception, no log line
        and no visible difference until somebody looks at the rendered page. A step that says
        "done" without reading its own result back has not measured anything.

        It checks the two values that would betray a silent failure -- the action colour, which
        is the one that fixes the contrast, and the footer key, which is the one that proves the
        chrome keys landed in the same file.
        """
        assets = self.env["website.assets"].with_context(website_id=website.id)
        checks = {}
        for url, needles in (
            (THEME_USER_COLORS, {"o-color-1": BRAND_ACTION, "footer": "5"}),
            (THEME_USER_VALUES, {"color-palettes-name": "base-1", "h1-font-size": "3.25rem"}),
        ):
            try:
                # The CUSTOM url, not the plain one. `_get_content_from_url(url)` returns the
                # pristine file that ships with Odoo -- the one whose whole body is a
                # `// -- hook --` comment -- so a check written against it reads back the
                # template instead of the customisation and reports that nothing was written,
                # every time, however well the write went. Measured: this method reported
                # "not ok" on a seed that had in fact landed correctly.
                custom = assets._make_custom_asset_url(url, "web.assets_frontend")
                content = assets._get_content_from_url(custom) or b""
            except Exception:  # noqa: BLE001
                checks[url] = "unreadable"
                continue
            text = content.decode("utf-8", "replace")
            checks[url] = {key: (value in text) for key, value in needles.items()}
        ok = all(isinstance(v, dict) and all(v.values()) for v in checks.values())
        if not ok:
            _logger.warning(
                "cs_prefab_website: the brand foundation did not read back as written: %s. "
                "The site will render in Odoo's default palette. Check that "
                "website.assets.make_scss_customization ran under this website's context.",
                checks)
        return {"ok": ok, "checks": checks}

    def _cs_prefab_release_page_views(self):
        """Hand the page views back to Odoo's copy-on-write, so an upgrade stops eating edits.

        THE DEFECT. ``data/page_data.xml`` set ``website_id`` on each ``website.page`` record.
        That field is ``related='view_id.website_id', store=True, readonly=False``, so it wrote
        straight through onto the ``ir.ui.view`` row and the view was born website-SPECIFIC.
        Odoo skips copy-on-write for a view that is already specific -- there is nothing to copy
        it to -- and the guard that would otherwise stamp ``noupdate`` on an edited view is
        deliberately disabled under a website context. The result was that ``-u
        cs_prefab_website`` rewrote those ten views unconditionally, and every edit the customer
        had made in the builder was destroyed with no error and no log line.

        That is the opposite of what this module's README promised, and it is the single thing
        that has to be true for an overhaul to be shippable at all: we push improvements, the
        customer edits pages, and neither destroys the other.

        THE FIX. Clear ``website_id`` on those views so each one becomes the generic template
        again. The content is not touched, so whatever is on the page today stays on the page.
        From the customer's next save on, Odoo makes a website-specific COPY and serves that --
        which is the arrangement every Odoo module ships and the one the README described.

        This is safe here because this Odoo serves exactly one website. A generic page is served
        by every website of an instance, so on a multi-website instance this step would need the
        opposite treatment; the guard below says so out loud rather than assuming.

        Idempotent: a view that is already generic is skipped, and a view whose generic twin
        already exists is left alone rather than creating a duplicate key.
        """
        if self.env["website"].search_count([]) > 1:
            _logger.warning(
                "cs_prefab_website: this Odoo has more than one website, so the page views "
                "are NOT made generic -- a generic page is served by every website. The pages "
                "stay website-specific and a module upgrade will keep overwriting edits made "
                "to them in the builder. Resolve by giving this site its own module fork or "
                "by accepting that these pages are ours, not the customer's.")
            return {"skipped": "multi-website instance"}
        view_model = self.env["ir.ui.view"].sudo()
        data_model = self.env["ir.model.data"].sudo()
        rows = data_model.search([("module", "=", "cs_prefab_website"),
                                  ("model", "=", "ir.ui.view")])
        released, kept = [], []
        for row in rows:
            view = view_model.browse(row.res_id).exists()
            if not view or not view.website_id:
                continue
            twin = view_model.search([("key", "=", view.key), ("website_id", "=", False)], limit=1)
            if twin:
                # A generic twin already exists, so this row really is a copy-on-write copy and
                # taking its website_id away would leave two generic views with one key.
                kept.append(view.key)
                continue
            view.website_id = False
            released.append(view.key)
        if released:
            _logger.info("cs_prefab_website: %s page views handed back to copy-on-write: %s",
                         len(released), released)
        return {"released": released, "kept_as_copies": kept}

    def _cs_prefab_apply_configurator_scope(self, website, first_run=False):
        """Give the website the form appearance this site's pages are drawn in.

        The catalogue is NOT touched, and that is the other step whose meaning reversed. It
        used to copy the published catalogue of the existing website into a draft for the new
        one, because a website with no catalogue serves the repository's DEMONSTRATION prices
        under the customer's brand. There is no second website now: the catalogue this site
        serves is the one the website already publishes, the one the live configurator has
        been quoting from. Creating anything next to it would be this module inventing prices,
        which it has no business doing. What stays is the readback --
        ``cs_prefab_catalog_status`` says out loud which prices are actually served.

        The appearance record is created only when the website has none: a missing one renders
        the embedded form in the built-in palette on a page that uses a different one, and
        there is nothing to inherit it from. An existing one is the administrator's and is
        left alone, on every upgrade.
        """
        result = {}
        appearance_model = self.env["cs.prefab.appearance"].sudo()
        existing = appearance_model.search([("website_id", "=", website.id)], limit=1)
        if not existing:
            appearance_model.create(dict(self._cs_prefab_appearance_values(), website_id=website.id))
            result["appearance"] = "created"
        elif first_run:
            # ONE-SHOT, and only because the site moved onto a website that already had a record. That record
            # carries Odoo's default palette, and this website is now the Prefab Partner site: the quote form
            # embedded in its pages would otherwise render in another brand's colours on a Prefab Partner page.
            # After this run it belongs to the administrator -- the same line the logo and the menu sit on -- so a
            # colour they adjust is never pulled back by a later upgrade.
            # NOT logo_source. The palette is what makes the embedded form match the page; the logo is the
            # customer's own choice about their own mark, and this website existed before this module did. The
            # configurator's default there is the wordmark and its own tests hold that, which is how this was
            # caught: branding a colour must not quietly decide whose logo appears on a quote.
            branding = {key: value for key, value in self._cs_prefab_appearance_values().items()
                        if key != "logo_source"}
            existing.write(branding)
            result["appearance"] = "branded on first run"
        else:
            result["appearance"] = "kept"
        release_model = self.env["cs.prefab.catalog.release"].sudo()
        result["published_releases"] = release_model.search_count(
            [("website_id", "=", website.id), ("state", "=", "published")])
        return result

    @api.model
    def _cs_prefab_appearance_values(self):
        """The configurator's palette, from the same four brand colours as the site itself.

        One definition, referenced twice: the site stylesheet and the embedded form read the
        same values, so the iframe cannot drift away from the page around it. Every pair below
        is above 4.5:1 -- the model's own constraint enforces that and would refuse the record
        otherwise, which is the second check on the same number.
        """
        return {
            "mode": "custom",
            "color_action": "#c43f12",
            "color_on_action": "#ffffff",
            "color_text": "#1a1a1a",
            "color_heading": "#1a1a1a",
            "color_muted": "#5b5b5b",
            "color_surface": "#ffffff",
            "color_background": "#fdeae4",
            "color_border": "#e4d3cc",
            "color_error": "#b3261e",
            "body_font": "system",
            "heading_font": "system",
            "font_size": 16,
            "logo_source": "odoo",
        }

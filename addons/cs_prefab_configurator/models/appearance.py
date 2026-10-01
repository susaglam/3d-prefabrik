"""Website-scoped form appearance and scene content, independent of catalogue publication.

Two separable concerns share this record because the browser resolves both in the one fetch that runs
before the first frame: how the form LOOKS (colours, fonts, the proposal logo) and which illustrative
extras the 3D scene OFFERS. The second lives in its own service module (services/scene_content.py),
its own payload key and its own form section; only the storage is shared.
"""
import base64
import logging

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from ..services.appearance import (COLORS, DOCUMENT_PART_FIELDS, DOCUMENT_PARTS, LOGO_MAX_BYTES, appearance_payload,
                                   logo_summary, proposal_logo)
from ..services.pdf_image import PIXEL_LIMIT_LABEL, ImageError
from ..services.svg_raster import is_svg, svg_to_png
from ..services.scene_content import EXTRAS as SCENE_EXTRAS

_logger = logging.getLogger(__name__)

# Most-used first: "Tonen" is what every website has done since the configurator shipped, so it is
# the value four admins in five will leave alone. "Uitgeschakeld" is the deliberate, rarest choice.
SCENE_MODES = [("on", "Tonen"), ("off", "Standaard uit"), ("hidden", "Uitgeschakeld")]
SCENE_FIELDS = [extra["field"] for extra in SCENE_EXTRAS]


class PrefabAppearance(models.Model):
    _name = "cs.prefab.appearance"
    # One record per website holds two separable things: how the form LOOKS (colours, fonts, logo)
    # and what the 3D scene SHOWS as an illustrative extra. They share a record and a payload
    # because the browser resolves both in the one fetch that precedes the first frame; they do
    # not share a module, a payload key or a form section.
    _description = "Prefab vormgeving en voorbeelden per website"
    _rec_name = "website_id"
    _check_company_auto = True

    website_id = fields.Many2one("website", required=True, ondelete="cascade",
        default=lambda self: self.env["website"].search([("company_id", "=", self.env.company.id)], limit=1),
        help="De website waarvoor deze vormgeving geldt. Elke website heeft één vormgeving; "
             "bezoekers van een andere website zien hun eigen instelling.")
    company_id = fields.Many2one(related="website_id.company_id", store=True, readonly=True,
        help="Het bedrijf achter de gekozen website. Bepaalt welk logo en welke aanvragen bij deze vormgeving horen.")
    mode = fields.Selection([("brand", "Prefab Partner"), ("odoo", "Odoo website-thema"), ("custom", "Eigen kleuren en lettertypen")],
                            required=True, default="brand", string="Vormgeving",
        help="Bepaalt de kleuren en lettertypen van het configuratieformulier. "
             "'Prefab Partner' houdt de meegeleverde vormgeving aan, 'Odoo website-thema' neemt de kleuren van je "
             "website over en 'Eigen kleuren en lettertypen' laat je alles zelf invullen. "
             "Deze keuze raakt alleen het uiterlijk; keuzes, prijzen en bewaarde aanvragen blijven ongewijzigd.")
    color_action = fields.Char(string="Actiekleur", required=True, default=COLORS["action"],
        help="De kleur van knoppen en actieve keuzes, als volledige hexkleur zoals #294e40.")
    color_on_action = fields.Char(string="Knoptekst", required=True, default=COLORS["on_action"],
        help="De tekstkleur óp een knop. Moet minimaal 4,5:1 contrast hebben met de actiekleur, anders is de knop onleesbaar.")
    color_text = fields.Char(string="Tekst", required=True, default=COLORS["text"],
        help="De kleur van gewone tekst in het formulier. Moet minimaal 4,5:1 contrast hebben met de formulierachtergrond.")
    color_heading = fields.Char(string="Titels", required=True, default=COLORS["heading"],
        help="De kleur van stap- en sectietitels. Meestal iets donkerder dan de gewone tekstkleur.")
    color_muted = fields.Char(string="Toelichtingen", required=True, default=COLORS["muted"],
        help="De kleur van kleine uitleg onder een keuze. Ook deze moet leesbaar blijven: minimaal 4,5:1 contrast.")
    color_surface = fields.Char(string="Formulierachtergrond", required=True, default=COLORS["surface"],
        help="De achtergrond van de kaarten waarin de keuzes staan. Alle tekstkleuren worden hiertegen gemeten.")
    color_background = fields.Char(string="Achtergrond", required=True, default=COLORS["background"],
        help="De achtergrond van de hele pagina, achter de formulierkaarten.")
    color_border = fields.Char(string="Scheidingslijnen", required=True, default=COLORS["border"],
        help="De kleur van randen en scheidingslijnen tussen onderdelen.")
    color_error = fields.Char(string="Foutmeldingen", required=True, default=COLORS["error"],
        help="De kleur van foutmeldingen bij een ingevuld veld. Moet minimaal 4,5:1 contrast hebben met de formulierachtergrond.")
    body_font = fields.Selection([("dm_sans", "DM Sans"), ("system", "Systeemlettertype"),
                                 ("arial", "Arial"), ("georgia", "Georgia")], required=True, default="dm_sans", string="Tekstlettertype",
        help="Het lettertype van gewone tekst. Alleen meegeleverde of op het apparaat aanwezige lettertypen: "
             "er wordt nooit een lettertype van een externe server geladen.")
    heading_font = fields.Selection([("dm_serif", "DM Serif Display"), ("dm_sans", "DM Sans"), ("system", "Systeemlettertype"),
                                    ("arial", "Arial"), ("georgia", "Georgia")], required=True, default="dm_sans", string="Titellettertype",
        help="Het lettertype van de titels. Kies hetzelfde als het tekstlettertype voor een rustig formulier.")
    font_size = fields.Integer(string="Basislettergrootte (px)", required=True, default=16,
        help="De basisgrootte van de tekst in het formulier, tussen 14 en 20 px. Alle andere maten schalen mee.")
    render_quality = fields.Selection([("auto", "Automatisch (aanbevolen)"), ("full", "Hoge kwaliteit"), ("compact", "Snel")],
        string="Weergavekwaliteit 3D", required=True, default="auto",
        help="Hoe de 3D-weergave standaard wordt getekend. Automatisch: de configurator kiest per apparaat — op een "
             "computer met een groot scherm hoge kwaliteit (zachte contactschaduwen, gladde randen, scherpe schaduwen "
             "en foto-texturen op ware grootte), op een telefoon of klein scherm de snelle weergave. Hoge kwaliteit en "
             "Snel dwingen die keuze af voor iedere bezoeker. De bezoeker kan het zelf nog wijzigen onder Weergave → "
             "Kwaliteit; die keuze geldt alleen op het eigen apparaat. Voorbeeld: kies Snel als veel klanten op "
             "oudere laptops werken en de weergave daar hapert.")
    garden_fence = fields.Boolean(string="Schutting in de tuin", default=True,
        help="Toont de houten schutting rond de voorbeeldtuin. Zet hem uit als hij het zicht op de aanbouw "
             "belemmert — vooral op een telefoon, waar de camera van opzij kijkt en de zijschutting voor de gevel "
             "staat. Uit verdwijnt de schutting voor iedere bezoeker en wordt het groene eiland rond de aanbouw "
             "kleiner: het houdt dan op een paar meter achter het terras in plaats van bij de achterschutting. "
             "Planten en de tuinset blijven staan; die volgen 'Tuinaankleding' hieronder.")
    # Most-used first: the modern slat fence is the default the customer asked for; the classic one is the rarest.
    garden_fence_style = fields.Selection([("modern", "Modern hout"), ("hedge", "Groene haag"), ("classic", "Klassiek hout")],
        string="Soort afscheiding", required=True, default="modern",
        help="Hoe de tuinafscheiding er standaard uitziet. Modern hout: horizontale hardhouten latten tussen antraciet "
             "palen. Groene haag: een geschoren haag. Klassiek hout: de verweerde verticale schutting van eerdere versies. "
             "De bezoeker kan onder Woning en tuin zelf een andere kiezen; die keuze geldt alleen op het eigen apparaat. "
             "Welke soort ook: een stuk afscheiding dat vanuit de camera vóór de aanbouw zou staan, verdwijnt vanzelf uit beeld.")
    camera_free_orbit = fields.Boolean(string="Vrij rondkijken", default=False,
        help="Laat de bezoeker met de muis helemaal om de aanbouw heen draaien, tot achter het bestaande huis. "
             "Uit (de standaard) draait de bezoeker van links naar rechts door de tuin en stopt hij gelijk met de "
             "gevel van het huis: alles wat daarachter ligt, is niet getekend om van dichtbij bekeken te worden. "
             "Binnen in de aanbouw stopt uitzoomen dan bij de achterwand van de kamer achter de doorbraak. "
             "Zet dit aan als je bezoekers bewust overal omheen wilt laten kijken.")
    interior_furniture = fields.Boolean(string="Meubels in de binnenweergave", default=False,
        help="Toont de voorbeeldmeubels ook wanneer de bezoeker binnen in de aanbouw staat. Uit (de standaard) "
             "blijft de kamer leeg zodra hij naar binnen kijkt: daar gaat het om de ruimte, de vloer, de wanden en "
             "de pui, niet om een bank van iemand anders die ervoor staat. Vanuit de tuin blijven de meubels wel "
             "achter het glas staan, want daar laten ze juist zien hoe de ruimte gebruikt wordt.")
    exit_url = fields.Char(string="Terug naar de website", default="/",
        help="Waar de bezoeker naartoe gaat na een tik op het logo en de bevestiging dat de configurator wordt "
             "verlaten (het ontwerp blijft op het eigen apparaat bewaard). Een pad op deze website, zoals / voor de "
             "startpagina of /aanbouw, of een volledig adres met https://. Staat de configurator via een iframe op "
             "een andere website, vul dan het adres van die website in: dan verlaat de bezoeker het hele venster, "
             "niet alleen het kader. Leeg laten zet de terugweg uit.")
    compare_enabled = fields.Boolean(string="Ontwerpen vergelijken", default=False,
        help="Toont in stap 4 het paneel om twee ontwerpen A en B naast elkaar te prijzen. "
             "Standaard uit; de opgeslagen ontwerpen blijven op het apparaat van de bezoeker.")
    document_surroundings = fields.Boolean(string="Omgeving in de voorstelbeelden", default=False,
        help="Bepaalt wat er op de drie ruimtelijke beelden van het voorstel naast de aanbouw staat — dezelfde "
             "beelden die je hier bij de aanvraag ziet en die in de PDF worden afgedrukt. "
             "Standaard uit: het voorstel toont alleen de aanbouw met het terras waarop hij staat, tegen een rustige "
             "achtergrond in dezelfde papierkleur als de plattegrond en de gevelaanzichten ernaast. Alles wat op de "
             "aanbouw zit blijft staan — de wandlampen, de stopcontacten, de buitenkraan, de spots en de radiator — "
             "want dat wordt meegeleverd en gemonteerd. "
             "Zet je hem aan, dan staat de aanbouw op die beelden weer in de voorbeeldtuin: de bestaande woning, de "
             "buurhuizen, het gras, de schutting, de tuinset en de voorbeeldinrichting. Dat helpt om de maat te laten "
             "zien, maar niets daarvan wordt geleverd en de klant kan het voor zijn eigen woning aanzien. "
             "Deze keuze verandert niets aan het beeld dat de bezoeker tijdens het samenstellen ziet, niets aan de "
             "prijs en niets aan de leveringsomvang — en al bewaarde aanvragen houden de beelden waarmee ze zijn "
             "vastgelegd, want die worden bij het versturen bevroren en nooit opnieuw getekend.")
    # Three named parts of a proposal image, beside the omgeving switch above. Each one moves exactly one group
    # in the 3D scene (static/src/preview.js DOCUMENT_PARTS) and only while a proposal image is being taken: the
    # visitor configuring the aanbouw always sees the whole picture. The defaults live in services/appearance.py
    # DOCUMENT_PARTS and are asserted equal to the browser's own copy by tests/test_appearance.py.
    document_slab = fields.Boolean(string="Betonvloer onder de aanbouw", default=DOCUMENT_PARTS["slab"],
        help="De betonplaat waarop de aanbouw in de voorstelbeelden staat, tot 27,5 cm rondom de gevels. "
             "Standaard aan: zonder die plaat lijkt de aanbouw op de beelden te zweven. "
             "Zet hem uit als je de aanbouw helemaal los wilt tonen, bijvoorbeeld omdat de klant zelf de "
             "fundering verzorgt. Dit verandert niets aan de prijs of de leveringsomvang, alleen aan het beeld.")
    document_terrace = fields.Boolean(string="Terras naar de tuin", default=DOCUMENT_PARTS["terrace"],
        help="De twee meter bestrating die vanaf de voorgevel de tuin in loopt, met de voegen tussen de tegels. "
             "Staat los van de betonvloer onder de aanbouw: je kunt de aanbouw op zijn eigen plaat laten staan "
             "en het terras weglaten, of andersom. Standaard aan. Wordt niet geleverd en heeft geen prijs.")
    document_house_room = fields.Boolean(string="Doorbraak naar de woning", default=DOCUMENT_PARTS["house_room"],
        help="Een halve meter van de bestaande woning achter de doorbraak: vloer, achterwand en de twee "
             "zijkanten van de opening. Daardoor leest de open achterkant van de aanbouw als een doorgang naar het "
             "huis, in plaats van als een gat met de achtergrond erachter. De rest van de woning — de kamer, de "
             "gevels, het dak en de buren — staat er nooit op zolang 'Omgeving in de voorstelbeelden' uit staat. "
             "Standaard aan. Zet hem uit om alleen de aanbouw zelf te tonen: je kijkt dan door de achterkant heen.")
    # --- Voorbeelden in het beeld -------------------------------------------------------------
    # Scene CONTENT, deliberately kept apart from the colours and fonts above: its own service
    # module owns the vocabulary, its own payload key carries it and its own form section shows
    # it. It lives on this record because the browser resolves the whole payload in one fetch
    # before the first frame; see services/scene_content.py.
    scene_fixtures = fields.Selection(SCENE_MODES, required=True, default="on", string="Voorbeeldapparaten",
        help="De voorbeeldapparaten in het 3D-beeld en de plattegrond: de contour van bijvoorbeeld een koelkast, "
             "een wasmachine of een radiator, die laat zien waar zo'n apparaat past zonder dat het wordt geleverd. "
             "Op 'Tonen' staan ze in beeld en kan de bezoeker ze zelf wegklikken met 'Voorbeeldapparaten tonen'; "
             "op 'Uitgeschakeld' worden ze nooit getekend en verdwijnt dat vinkje. "
             "Wat wél geleverd wordt, staat los hiervan in de leveringsomvang: deze keuze verandert geen prijs.")
    scene_garden = fields.Selection(SCENE_MODES, required=True, default="on", string="Tuinaankleding",
        help="Het gras, de schutting, de plantenbakken en de tuinset op het terras rond de aanbouw. Ze staan er om "
             "de aanbouw ergens te laten staan; niets ervan wordt geleverd. Op 'Uitgeschakeld' blijft alleen de "
             "bestrating over en verdwijnt het vinkje 'Tuinaankleding tonen' onder het beeld. "
             "Voorbeeld: zet dit uit als je klanten een kale bouwplaats moeten zien in plaats van een ingerichte tuin.")
    scene_neighbours = fields.Selection(SCENE_MODES, required=True, default="on", string="Buurhuizen",
        help="De buurwoningen links en rechts, die bij een rijwoning of twee-onder-een-kap de gevel doortrekken en "
             "laten zien dat de aanbouw tussen twee muren past. Op 'Uitgeschakeld' staat de woning altijd alleen in "
             "beeld en verdwijnt het vinkje 'Buren tonen' uit het venster 'Woning en tuin'. "
             "Bij een vrijstaande woning zijn er sowieso geen buren, dus dan verandert deze keuze niets.")
    scene_interior = fields.Selection(SCENE_MODES, required=True, default="on", string="Inrichting",
        help="De voorbeeldinrichting ín de aanbouw: een bank met salontafel, een bed of een bureau, zodat de "
             "bezoeker de maat van de ruimte kan schatten. Geen enkel meubel wordt geleverd. Op 'Tonen' begint het "
             "beeld als woonkamer en kiest de bezoeker zelf met de knoppen 'Inrichting'; op 'Standaard uit' begint "
             "het leeg maar blijven die knoppen staan; op 'Uitgeschakeld' verdwijnen ze en blijft de ruimte leeg.")
    scene_house_openings = fields.Selection(SCENE_MODES, required=True, default="on",
        string="Voorbeeldramen op de straatgevel",
        help="De voorbeeldramen en de voordeur op de straatgevel van de bestaande woning — de kant die de bezoeker "
             "ziet zodra hij om het huis heen draait. Ze zijn er zodat die gevel geen blinde muur is en zeggen niets "
             "over de werkelijke ramen van de woning van de klant. Op 'Uitgeschakeld' blijft de straatgevel dicht "
             "metselwerk en verdwijnt het vinkje uit 'Woning en tuin'. "
             "Let op: dit gaat alleen over de straatkant. De ramen aan de tuinkant zitten in de gevel waar de aanbouw "
             "tegenaan komt en horen bij de woning zelf; die blijven altijd staan, want een blinde tuingevel boven een "
             "aanbouw ziet eruit als een fout in de tekening.")
    # Most-used first: the company logo Odoo already prints on invoices is what nearly every website wants, and it
    # is the default since 2.9.7 (migrations/2.9.7 moves records still on the old default across). The built-in
    # wordmark is the rarest choice — it names "CS prefab", which is not the name any customer website sells under.
    logo_source = fields.Selection([("odoo", "Logo van het bedrijf in Odoo"),
                                    ("upload", "Eigen logo uploaden"),
                                    ("wordmark", "Ingebouwd CS prefab-woordmerk")],
        required=True, default="odoo", string="Logo in het voorstel",
        help="Het beeldmerk boven aan elke pagina van het PDF-voorstel. "
             "'Logo van het bedrijf in Odoo' gebruikt het logo uit Instellingen → Bedrijven — hetzelfde logo dat Odoo "
             "op facturen en offertes zet, zodat je het maar op één plek hoeft bij te houden. "
             "'Eigen logo uploaden' gebruikt het bestand hieronder, bijvoorbeeld een aparte versie voor drukwerk. "
             "'Ingebouwd CS prefab-woordmerk' drukt het meegeleverde CS prefab-merk af. "
             "Is het gekozen logo leeg of onbruikbaar, dan drukt het voorstel de bedrijfsnaam als tekst af: "
             "een ontbrekend logo maakt nooit een voorstel stuk.")
    logo_image = fields.Binary(string="Logobestand", attachment=True,
        help=f"Het logo dat in de kop van het voorstel wordt afgedrukt. PNG of JPEG, maximaal {LOGO_MAX_BYTES // 1024} kB en "
             f"maximaal {PIXEL_LIMIT_LABEL}. "
             "Een PNG met transparante achtergrond van ongeveer 600 px breed geeft het beste resultaat; "
             "transparantie wordt op het witte papier van het voorstel gelegd. "
             "SVG kan niet: het voorstel wordt zonder externe programma's opgebouwd en plaatst alleen pixelbeelden. "
             "De verhouding blijft altijd behouden — het logo wordt nooit uitgerekt.")
    logo_filename = fields.Char(string="Bestandsnaam",
        help="De naam van het geüploade bestand. Wordt alleen gebruikt om het bestand te herkennen bij het downloaden "
             "en in foutmeldingen; hij staat niet in het voorstel.")
    logo_preview = fields.Binary(string="Voorbeeld in het voorstel", compute="_compute_logo_preview",
        help="Het beeld zoals het nu in de kop van elk nieuw voorstel komt te staan. "
             "Blijft leeg zolang het ingebouwde woordmerk wordt gebruikt.")
    scene_note = fields.Char(string="Voorbeelden in het beeld", compute="_compute_scene_note",
        help="Leest terug wat een bezoeker van deze website werkelijk te zien krijgt: welke voorbeelden zijn "
             "uitgeschakeld en welke beginnen uit. Staat er 'Alle voorbeelden worden getoond', dan is het beeld "
             "compleet zoals de configurator het standaard tekent.")
    document_note = fields.Char(string="Voorstelbeelden", compute="_compute_document_note",
        help="Leest terug wat er op de ruimtelijke beelden van het eerstvolgende voorstel komt te staan. "
             "Aanvragen die al binnen zijn veranderen hier nooit van: hun beelden zijn bij het versturen vastgelegd.")
    logo_note = fields.Char(string="Logostatus", compute="_compute_logo_preview",
        help="Leest terug wat er daadwerkelijk wordt afgedrukt: bestandstype, afmeting en grootte, "
             "of de reden waarom het voorstel op het ingebouwde woordmerk terugvalt.")
    _website_unique = models.Constraint("UNIQUE(website_id)", "Er bestaat al een vormgeving voor deze website.")

    @staticmethod
    def _image_bytes(value):
        """The raw image behind a Binary field, however this Odoo hands it back.

        saas~19.4 returns a ``BinaryValue`` carrying the RAW content, while a value
        written or cached as base64 text still reads back encoded. Decoding blindly
        turned a valid PNG into noise, so the proposal fell back to the wordmark and an
        oversized upload was refused as "not a PNG or JPEG". Recognise the image by its
        own magic bytes first; anything else is tried as base64, and a damaged value
        reads as 'no logo'.
        """
        if not value:
            return b""
        # saas~19.4 reads a Binary field as a BinaryValue whose `content` is the raw image
        # (odoo/orm/fields_binary.py); only an RPC write is base64. Blind decoding turned a
        # valid PNG into an empty value, so the proposal silently kept the wordmark and an
        # oversized upload was accepted instead of refused.
        content = getattr(value, "content", None)
        if isinstance(content, (bytes, bytearray, memoryview)):
            return bytes(content)
        if isinstance(value, (bytes, bytearray, memoryview)):
            data = bytes(value)
            # SVG too: production's company logo is one, and base64-decoding its raw text returned nothing.
            if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff" or is_svg(data):
                return data
        else:
            data = str(value).encode("ascii", "ignore")
        try:
            return base64.b64decode(data, validate=True)
        except (ValueError, TypeError):
            return b""

    @staticmethod
    def _odoo_logo_candidates(company):
        """res.company.logo first, then Odoo's own smaller variants of the same image.

        res.company.logo, not website.logo: it is the logo an administrator already
        maintains for invoices and quotations, and it is a raster image. website.logo
        ships with a non-empty SVG placeholder, so it could neither be embedded in the
        hand-composed PDF nor ever fall back to the wordmark.

        Odoo stores that logo as the partner's image_1920, which can be far larger than a
        proposal header needs. Rather than refuse it, the resized siblings Odoo already
        computes are tried in turn: at 1024 px a 4 cm header mark still prints at ~500 dpi.
        """
        partner = company.sudo().partner_id
        return [company.sudo().logo] + ([partner.image_1024, partner.image_512, partner.image_256] if partner else [])

    @api.model
    def _company_logo(self, company):
        """The company's own Odoo logo as a proposal mark, or None. Never raises.

        A model method rather than a branch of _proposal_logo, because a website that never saved a vormgeving
        must print this same logo: that was the customer's report ("pdf logo hala odoodan almiyor") — with no
        record at all, every proposal fell back to the CS prefab wordmark.
        """
        if not company:
            return None
        candidates = [self._image_bytes(candidate) for candidate in self._odoo_logo_candidates(company)]
        for index, data in enumerate(candidates):
            mark = proposal_logo(data, filename=f"odoo-company-logo-{index}", alt=company.name or "Logo", strict=False)
            if mark:
                return mark
        # An SVG logo — which is what production has, at every size Odoo keeps — cannot be embedded as it is, so it
        # is rasterised with the wkhtmltoimage Odoo already ships (services/svg_raster.py). None if that fails.
        svg = next((data for data in candidates if is_svg(data)), None)
        if svg:
            png = svg_to_png(svg)
            mark = proposal_logo(png, filename="odoo-company-logo.png", alt=company.name or "Logo", strict=False)
            if png and not mark:
                # Never silent again: the first 2.9.8 clone run lost the logo exactly here, unlogged.
                _logger.warning("The rasterised SVG company logo (%d bytes) was refused by the proposal PDF; "
                                "the proposal prints the company name", len(png))
            return mark
        return None

    def _palette_values(self):
        """The fields proposal_palette() reads, from this record; empty when there is no record."""
        if not self:
            return {}
        self.ensure_one()
        return {"mode": self.mode, **{"color_" + key: self["color_" + key] for key in COLORS}}

    def _proposal_logo(self):
        """The one mark both proposal renderers print, or None for the built-in wordmark.

        Never raises: a proposal is a customer-facing document and must survive a
        company logo that was replaced by something unusable after this record was saved.
        """
        if not self:
            return None
        self.ensure_one()
        company = self.company_id or self.website_id.company_id
        if self.logo_source == "odoo":
            return self._company_logo(company)
        if self.logo_source == "upload":
            return proposal_logo(self._image_bytes(self.logo_image), filename=self.logo_filename or "",
                                 alt=company.name or "Logo", strict=False)
        return None

    @api.depends(*SCENE_FIELDS)
    def _compute_scene_note(self):
        """One line an administrator can read back, in the same spirit as ``logo_note``.

        A switch that silently does nothing is the failure mode this whole feature has to avoid,
        so the record says out loud what a visitor will and will not see.
        """
        labels = {extra["field"]: extra["label"] for extra in SCENE_EXTRAS}
        for record in self:
            hidden = [labels[field] for field in SCENE_FIELDS if record[field] == "hidden"]
            default_off = [labels[field] for field in SCENE_FIELDS if record[field] == "off"]
            parts = []
            if hidden:
                parts.append("Uitgeschakeld: " + ", ".join(hidden) + ".")
            if default_off:
                parts.append("Standaard uit (de bezoeker kan ze zelf aanzetten): " + ", ".join(default_off) + ".")
            record.scene_note = " ".join(parts) or "Alle voorbeelden worden getoond."

    @api.depends("document_surroundings", *DOCUMENT_PART_FIELDS)
    def _compute_document_note(self):
        """Says out loud which picture the next proposal gets, and what does not change.

        Same reason as ``scene_note``: these switches are only visible in a PDF an administrator may not
        open for weeks, so the form has to state their effect on the spot instead of promising it.
        """
        for record in self:
            if record.document_surroundings:
                record.document_note = ("De voorstelbeelden tonen de aanbouw in de voorbeeldtuin, met de bestaande "
                                        "woning, de buren, het gras en de inrichting erbij.")
                continue
            kept = [label for field, label in (("document_slab", "de betonvloer eronder"),
                                               ("document_terrace", "het terras naar de tuin"),
                                               ("document_house_room", "de doorbraak naar de woning"))
                    if record[field]]
            record.document_note = ("De voorstelbeelden tonen alleen de aanbouw en alles wat erop gemonteerd wordt"
                                    + (", met " + ", ".join(kept[:-1]) + (" en " if len(kept) > 1 else "") + kept[-1]
                                       if kept else ", zonder vloer, terras of doorbraak eromheen")
                                    + ". De woning, de tuin, de buren en de inrichting blijven eruit.")

    @api.depends("logo_source", "logo_image", "logo_filename", "company_id", "company_id.logo")
    def _compute_logo_preview(self):
        """Read back what a proposal will really print, including the reason for a fallback.

        Deliberately never raises: the form has to stay usable while a wrong file is
        being corrected, and the save-time constraint is what actually refuses it.
        """
        fallback = " Het voorstel drukt zolang de bedrijfsnaam als tekst af."
        for record in self:
            company = record.company_id.name or "Dit bedrijf"
            record.logo_preview = False
            if record.logo_source == "wordmark":
                record.logo_note = "Het voorstel gebruikt het ingebouwde CS prefab-woordmerk."
                continue
            mark = record._proposal_logo()
            if mark:
                # saas~19.4 refuses raw bytes on a Binary field; base64 text is the accepted write.
                record.logo_preview = base64.b64encode(mark["data"]).decode("ascii")
                record.logo_note = logo_summary(mark)
                continue
            if record.logo_source == "upload":
                data, missing = record._image_bytes(record.logo_image), "Er is nog geen logobestand gekozen." + fallback
            else:
                data = record._image_bytes(record.company_id.sudo().logo)
                missing = f"{company} heeft nog geen logo in Odoo (Instellingen → Bedrijven → Logo)." + fallback
            if not data:
                record.logo_note = missing
                continue
            try:
                proposal_logo(data, filename=record.logo_filename or "", strict=True)
                record.logo_note = "Dit logo kon niet in het voorstel worden gezet." + fallback
            except ImageError as exc:
                record.logo_note = str(exc) + fallback

    def _public_payload(self):
        self.ensure_one()
        keys = (["mode", "body_font", "heading_font", "font_size", "compare_enabled", "document_surroundings", "render_quality",
                 "garden_fence", "garden_fence_style", "camera_free_orbit", "interior_furniture", "exit_url"]
                + DOCUMENT_PART_FIELDS + SCENE_FIELDS + ["color_" + key for key in COLORS])
        return appearance_payload({key: self[key] for key in keys})

    @api.constrains("mode", "body_font", "heading_font", "font_size", "compare_enabled", "document_surroundings", "render_quality",
                    "garden_fence", "garden_fence_style", "camera_free_orbit", "interior_furniture", "exit_url",
                    *DOCUMENT_PART_FIELDS, *SCENE_FIELDS, *["color_" + key for key in COLORS])
    def _validate_appearance(self):
        for record in self:
            try:
                record._public_payload()
            except ValueError as exc:
                raise ValidationError(str(exc)) from exc

    @api.constrains("logo_source", "logo_image", "logo_filename")
    def _validate_logo(self):
        for record in self:
            if record.logo_source != "upload":
                continue
            if not record.logo_image:
                raise ValidationError("Kies een logobestand, of zet 'Logo in het voorstel' terug op 'Logo van het "
                                      "bedrijf in Odoo'. Zonder bestand zou elk voorstel stilzwijgend alleen de "
                                      "bedrijfsnaam tonen, terwijl de instelling een eigen logo belooft.")
            try:
                proposal_logo(record._image_bytes(record.logo_image), filename=record.logo_filename or "", strict=True)
            except ImageError as exc:
                raise ValidationError(str(exc)) from exc

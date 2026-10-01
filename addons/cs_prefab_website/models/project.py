"""De projectgalerij: de foto's van de klant, als records.

De klant heeft het zelf zo gezegd: *"Projecten heeft hij niet als naam toegevoegd, hij heeft ze
als galerij op de site gezet -- zet ze er als galerij op, met een voorbeeldweergave."* Dat is
precies wat de bron laat zien. ``/projecten/`` op de live site is één Divi-galerij met 36
foto's: geen titels, geen bijschriften, geen plaatsnamen, geen jaartallen, geen filter. De
enige tekst die er per foto bestaat, is de alt-waarde die WordPress erbij heeft gezet, en die
noemt twee keer een plaats -- "Project aanbouw in Den Haag" en "Project Zoetermeer".

Drie beslissingen, en ze zijn alle drie makkelijk verkeerd te nemen:

* **Er wordt niets verzonnen.** Een eerdere versie van dit model droeg vijf projecttitels
  ("Aanbouw met houten lattengevel", "Prefab dakkapellen op een nieuwbouwwoning", ...), vijf
  korte omschrijvingen en een indeling in soorten. Geen woord daarvan staat in de bron. Ze zijn
  weg. Wat blijft, zijn de velden: naam, plaats, jaar en verhaal bestaan op dit model, met
  uitleg die zegt wat je er in zet, en ze staan leeg tot de klant ze invult. Een leeg veld
  leest als "hier moet nog iets komen"; een aannemelijk klinkende titel leest als een feit.

* **De foto is de eenheid, de reeks is alleen de doos eromheen.** De pagina toont één raster
  van 36 foto's, in de volgorde van de bron. Een reeks (``cs.prefab.project``) groepeert de
  foto's van één bouw, zodat een plaats, een naam of een jaartal één keer wordt ingevuld en
  niet zesendertig keer. Zonder ingevulde velden is een reeks onzichtbaar voor de bezoeker --
  en dat is vandaag de situatie.

* **Geen eigen adres per reeks.** Een eerdere versie gaf elke "project" een pagina op
  ``/projecten/<webadres>``. Een adres is een naam, en er zijn geen namen; een slug die uit een
  verzonnen titel komt, is verzonnen. ``/projecten`` staat in de URL-afspraak en is het enige
  adres dat deze galerij nodig heeft. De vergroting die de klant vroeg, gebeurt op de pagina
  zelf.

* **``alt`` is verplicht op elke foto.** Vier van de 36 galerijfoto's op de live site hebben
  helemaal geen alt-attribuut (site-audit §22, axe impact *critical*). Een verplicht veld is de
  enige versie van die reparatie die niet kan verrotten: de klant kan geen foto toevoegen
  zonder te beschrijven wat erop staat. Alt-tekst is geen verzonnen inhoud -- hij beschrijft
  wat er te zien is voor wie de foto niet kan zien.
"""
import json
import logging

from odoo import api, fields, models
from odoo.tools import file_open

_logger = logging.getLogger(__name__)

MODULE = "cs_prefab_website"
PROJECTS_PATH = f"{MODULE}/data/projects.json"


class PrefabProject(models.Model):
    _name = "cs.prefab.project"
    _description = "Fotoreeks van Prefab Partner"
    _inherit = ["website.published.multi.mixin"]
    _order = "sequence, id"

    name = fields.Char(
        string="Naam van de reeks", translate=True,
        help="Hoe deze bouw heet, bijvoorbeeld 'Aanbouw aan de Laan van Meerdervoort'. Laat leeg "
             "zolang je geen naam hebt: de galerij toont dan gewoon de foto's, precies zoals nu. "
             "Zodra je hier iets invult, komt het onder elke foto van deze reeks te staan en in "
             "de vergroting — dus schrijf wat er gebouwd is, niet wat het kostte.")
    location = fields.Char(
        string="Plaats", translate=False,
        help="De plaats waar deze bouw staat, bijvoorbeeld 'Den Haag'. Laat leeg als je het niet "
             "zeker weet; een verkeerde plaats is erger dan geen plaats. Bezoekers zoeken hier "
             "wél op: 'is er bij mij in de buurt al eens iets gebouwd?'. Twee reeksen hebben deze "
             "plaats al, omdat de oude site hem in de fotobeschrijving noemde.")
    year = fields.Integer(
        string="Jaar van oplevering",
        help="Het jaartal waarin deze bouw is opgeleverd, bijvoorbeeld 2025. Laat op 0 staan als "
             "je het niet weet — dan toont de site helemaal geen jaartal. Vul nooit een geschat "
             "jaar in: een bezoeker leest het als een feit, en op de oude site staat nergens een "
             "jaartal waar dit uit af te leiden zou zijn.")
    story = fields.Text(
        string="Verhaal bij deze reeks", translate=True,
        help="Een paar zinnen over deze bouw: wat de wens was, wat er is gebouwd en wat er "
             "bijzonder aan was. De bezoeker ziet dit wanneer hij een foto van deze reeks groter "
             "opent. Dit is de tekst die een twijfelaar overtuigt, dus schrijf hem zoals je hem "
             "aan de keukentafel zou vertellen. Laat leeg als er nog geen verhaal is — een lege "
             "vergroting is beter dan een verzonnen verhaal.")
    sequence = fields.Integer(
        string="Volgorde", default=10,
        help="Bepaalt waar de foto's van deze reeks in het raster terechtkomen: een lager getal "
             "staat vooraan. De volgorde van vandaag is de volgorde van de oude site; zet de bouw "
             "waar je het meest trots op bent bovenaan als je dat wilt veranderen.")
    image_ids = fields.One2many(
        "cs.prefab.project.image", "project_id", string="Foto's", copy=True,
        help="De foto's van deze bouw, in de volgorde waarin ze in de galerij komen te staan. "
             "Sleep ze met het handvat links om de volgorde te wijzigen; de bezoeker ziet ze "
             "precies zo.")
    image_count = fields.Integer(
        string="Aantal foto's", compute="_compute_image_count", store=True,
        help="Het aantal foto's dat aan deze reeks hangt. Het is een geteld getal en geen keuze: "
             "het staat hier zodat je in de lijst in één oogopslag ziet welke bouw weinig beeld "
             "heeft.")

    # ------------------------------------------------------------------
    # Computes
    # ------------------------------------------------------------------

    @api.depends("image_ids")
    def _compute_image_count(self):
        for series in self:
            series.image_count = len(series.image_ids)

    @api.depends("name", "location", "image_count")
    def _compute_display_name(self):
        """Een label voor de ACHTERKANT, en nadrukkelijk niet voor de bezoeker.

        Een reeks zonder naam moet in Odoo toch ergens op klikbaar zijn. Odoo's eigen
        terugvalwaarde is "Unnamed", wat in een lijst van vijf regels niets onderscheidt. Deze
        terugval zegt wat de reeks is (een plaats, of een aantal foto's) en leest als een
        plaatshouder, want dat is hij: hij verschijnt nergens op de website.
        """
        for series in self:
            series.display_name = (
                series.name
                or series.location
                or (series.image_count and "Reeks van %d foto's" % series.image_count)
                or "Nieuwe reeks")

    def _compute_website_url(self):
        """Het openbare adres van een reeks: de galerij zelf.

        ``website.published.multi.mixin`` geeft elk record een ``website_url`` die standaard op
        ``#`` staat. Een reeks heeft geen eigen pagina — de knop "Bekijk op de website" hoort de
        galerij te openen en niet nergens heen te gaan.
        """
        super()._compute_website_url()
        for series in self:
            series.website_url = "/projecten"

    # ------------------------------------------------------------------
    # Website
    # ------------------------------------------------------------------

    @api.model
    def _published_domain(self, website=None):
        """Welke reeksen een bezoeker van een gegeven website mag zien.

        Eén keer geschreven en gebruikt door de galerij én de sitemap, want twee kopieën van één
        domein zijn twee kansen op een niet-gepubliceerde foto die op een pagina lekt die een
        clausule vergat.
        """
        domain = [("is_published", "=", True)]
        if website:
            domain += ["|", ("website_id", "=", False), ("website_id", "=", website.id)]
        return domain

    @api.model
    def _gallery_photos(self, website=None):
        """Alle gepubliceerde foto's, plat, in de volgorde van de galerij.

        ``mapped`` plakt de recordsets achter elkaar en houdt de volgorde aan waarin ze binnen
        komen: eerst op ``sequence`` van de reeks, daarbinnen op ``sequence`` van de foto. Dat is
        precies de volgorde waarin de 36 foto's op de oude site stonden.
        """
        series = self.search(self._published_domain(website))
        return series.mapped("image_ids")

    def _meta_line(self):
        """Naam, plaats en jaar van deze reeks — alleen de stukken die iemand heeft ingevuld."""
        self.ensure_one()
        parts = [self.name or "", self.location or "", str(self.year) if self.year else ""]
        return " · ".join(part for part in parts if part)

    # ------------------------------------------------------------------
    # Seeding
    # ------------------------------------------------------------------

    @api.model
    def _cs_prefab_seed_projects(self):
        """Zet de galerij van de oude site één keer klaar.

        Waarom een JSON-bestand en een methode in plaats van ``<record>``-elementen: de galerij
        draagt 36 foto's, en ``<field name="image" type="base64" file="..."/>`` zou ongeveer tien
        megabyte base64 in een XML-bestand zetten dat daarna iemand moet lezen. De specificatie
        blijft leesbaar, de foto's blijven waar ze al staan, en de filestore ontdubbelt ze tegen
        de bijlagen van de beeldbank, omdat allebei dezelfde bytes schrijven en Odoo de filestore
        op hun sha1 sleutelt.

        **Draait één keer per reeks.** Vanaf het moment dat ze bestaan zijn deze records van de
        klant: een herhaling mag geen reeks terugzetten die ze hebben verwijderd, geen foto's
        herschikken die ze hebben herschikt en geen naam overschrijven die ze hebben bedacht. Het
        bestaan wordt via ``ir.model.data`` gecontroleerd, dus een hernoemde reeks geldt ook als
        al gezaaid.

        Bewust NIET inschikkelijk over een ontbrekende foto: de beeldbank wordt uit dezelfde boom
        gegenereerd, dus een ontbrekend bestand betekent dat het module onvolledig is verpakt.
        Het wordt per bestand gelogd en de rest installeert gewoon door — één slechte foto mag
        geen installatie omleggen — en het aantal komt terug zodat een test op nul kan staan.
        """
        website = self.env["website"]._cs_prefab_site()
        if not website:
            _logger.warning("cs_prefab_website: no flagged website; gallery not seeded")
            return {}
        with file_open(PROJECTS_PATH, "r", filter_ext=(".json",)) as handle:
            spec = json.load(handle)
        data_model = self.env["ir.model.data"].sudo()
        media = self.env["cs.prefab.website.media"]
        created, skipped, missing = 0, 0, 0
        for entry in spec["projects"]:
            xmlid_name = entry["key"]
            existing = self.env.ref("%s.%s" % (MODULE, xmlid_name), raise_if_not_found=False)
            if existing:
                skipped += 1
                continue
            images = []
            for filename, alt in entry["images"]:
                content = media._media_bytes(filename)
                if not content:
                    missing += 1
                    continue
                images.append((0, 0, {
                    "sequence": (len(images) + 1) * 10,
                    "alt": alt,
                    "image": media._binary(content),
                }))
            series = self.create({
                # Naam, jaar en verhaal staan met opzet NIET in dit dictionary: de bron draagt ze
                # niet, dus het record wordt leeg aangemaakt en de klant vult ze in.
                "location": entry.get("location") or False,
                "sequence": entry.get("sequence", 10),
                "website_id": website.id,
                "is_published": True,
                "image_ids": images,
            })
            data_model.create({
                "module": MODULE, "name": xmlid_name,
                "model": self._name, "res_id": series.id, "noupdate": True,
            })
            created += 1
        result = {"created": created, "skipped": skipped, "missing_images": missing}
        _logger.info("cs_prefab_website: gallery seeding %s", result)
        return result


class PrefabProjectImage(models.Model):
    _name = "cs.prefab.project.image"
    _description = "Foto in de galerij van Prefab Partner"
    _order = "sequence, id"

    project_id = fields.Many2one(
        "cs.prefab.project", string="Reeks", required=True, ondelete="cascade", index=True,
        help="De bouw waar deze foto bij hoort. Verplaats een foto naar een andere bouw door hier "
             "een andere reeks te kiezen; de plaats en het jaartal van die reeks gaan dan mee.")
    sequence = fields.Integer(
        string="Volgorde", default=10,
        help="De plek van deze foto binnen de reeks. De volgorde van vandaag is de volgorde van "
             "de oude site; sleep aan het handvat links om hem te wijzigen.")
    alt = fields.Char(
        string="Beschrijving", required=True, translate=True,
        help="Beschrijf in één zin wat er op de foto te zien is, voor wie de foto niet kan zien "
             "en voor Google. Bijvoorbeeld 'Afgeronde aanbouw met een lichtstraat over de volle "
             "breedte'. Dit veld is verplicht: op de oude site hadden vier galerijfoto's helemaal "
             "geen beschrijving, en dat is precies hoe zoiets ongemerkt blijft liggen.")
    image = fields.Binary(
        string="Foto", required=True, attachment=True,
        help="De foto zelf. Upload hem zo groot als je hem hebt — de site verkleint hem zelf naar "
             "het formaat waarop hij getoond wordt, dus een grote foto kost de bezoeker geen "
             "extra laadtijd. Liggend (breder dan hoog) staat het rustigst in het raster.")

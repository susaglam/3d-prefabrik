# CS Prefab Website

Bouwt **prefabpartner.nl** OP de website die deze Odoo al heeft. Er wordt **geen** tweede
website-record aangemaakt: de bestaande website — dezelfde die de configurator op `/prefab`
serveert — wordt de site. Het webadres wordt nooit door dit module ingevuld; dat is de knop die
de configurator op 403 zet, en die zet een mens om op het moment dat de DNS verhuist.

Het module levert de hele site: het merk als Odoo-thema-waarden die de klant zelf kan
bijstellen, de header en de voettekst, de beeldbank, de menustructuur, elke pagina, de
projectgalerij als bewerkbare records, de nieuwsberichten in Odoo Blog, twee formulieren die
een lead aanmaken, en een doel voor elke oude URL.

> **Gecorrigeerd 2026-09-20.** Hier stond "een tweede website-record binnen dezelfde Odoo,
> naast de bestaande website". Dat beschrijft een ontwerp dat is verlaten: een tweede record
> zou een laag zijn met niets erachter — een tweede host om ergens heen te wijzen, een tweede
> catalogus om te publiceren, en een live configurator op de verkeerde van de twee. De
> paragraaf "Eén tweede website" hieronder draagt dezelfde correctie.

## Wat dit module doet, en waarom elk onderdeel er is

### Eén tweede website, en geen enkele wijziging aan de eerste

`Website.create()` doet drie dingen uit zichzelf: het maakt een lege homepage die aan de
nieuwe website hangt, het kopieert de **generieke** menuboom (`Home` + `Shop`, dus níet de
`/prefab`-ingang van website 1), en het schakelt de multi-website-interface in zodra er een
tweede website bestaat. Al het andere — domein, thema, talen, verkoopteam, favicon, logo,
kleurenpalet — begint leeg of op een standaardwaarde, en leeg is hier geen cosmetisch
probleem: het bepaalt welke catalogus de configurator uitserveert en of een prijsverzoek
überhaupt wordt geaccepteerd.

`_cs_prefab_bootstrap` in `models/website.py` vult die velden in. Het draait bij installatie
én bij elke upgrade en schrijft **alleen waar nog niets staat**, zodat een latere correctie van
de beheerder de volgende update overleeft.

Elke sjabloon en elke stijlregel in dit module is afhankelijk van één veld,
`website.cs_prefab_site`. Odoo's asset-bundels gelden per instantie en `ir.ui.view`-records
zijn globaal — isolatie is dus geen eigenschap van waar de bestanden staan, maar van het feit
dat álles op dat ene vinkje is afgesloten. Er kan maar één website het vinkje dragen; een
`@api.constrains` bewaakt dat.

### Het adres is een voorwaarde, geen voorkeur

De configurator vergelijkt het `Origin`-kopje van elk prijs-, deel- en aanvraagverzoek
**letterlijk** met `website.domain`. Zolang dat veld leeg is kan de vergelijking niet mislukken,
want dan valt hij terug op het adres waarop het verzoek binnenkomt. Zodra er een domein staat
wordt de vergelijking echt, en dan geldt:

* `https://prefabpartner.nl` ingevuld, bezoeker komt binnen op `www.` → **403 op elk verzoek**;
* andersom net zo;
* `http://` ingevuld terwijl de site over https loopt → net zo.

Daarom: **één canoniek adres**, en de reverse proxy stuurt elke andere schrijfwijze met een 301
daarnaartoe **vóórdat** dit veld wordt ingevuld. De keuze is `https://prefabpartner.nl` — naakt,
zonder `www` — omdat elke canonical-tag, elke Open Graph-url en de volledige XML-sitemap van de
live site naakt zijn. Het staat als systeemparameter `cs_prefab_website.canonical_host`, zodat
het vóór de DNS-omzetting kan worden bijgesteld zonder release.

Het bestaande website-record krijgt óók een expliciet adres (uit `web.base.url`). Een
onbekende host valt dan nog steeds terug op de eerste website, maar met opzet in plaats van
per ongeluk.

### De configurator draait op twee websites

Twee records van `cs_prefab_configurator` zijn per website en vallen allebei **stilzwijgend**
terug:

* **De catalogus.** Zonder gepubliceerde catalogus voor deze website serveert `/prefab` de
  demonstratieprijzen uit de broncode. Geen fout, geen waarschuwing, geen zichtbaar verschil
  behalve de prijzen zelf. Dit module maakt daarom een **concept** aan, overgenomen van de
  gepubliceerde catalogus van de eerste website, en laat het publiceren aan de mens die de
  prijzen controleert. Wat wél wordt weggenomen is de stilte: het veld *Catalogusstatus
  configurator* op het websiteformulier leest terug wat er op dít moment wordt uitgeserveerd.
* **De vormgeving.** Zonder eigen `cs.prefab.appearance` rendert het formulier in de
  ingebouwde kleuren op een pagina met een ander palet. Er wordt er één aangemaakt, met
  dezelfde actiekleur als de site zelf.

Nieuwe concepten en vormgevingsrecords kozen tot nu toe altijd de **eerste** website, ongeacht
wat de gebruiker voor ogen had. Dat kon met één website niet fout gaan. `models/configurator_scope.py`
laat ze de website volgen waar de gebruiker op dat moment in zit, en valt daarbuiten terug op
precies de oude uitdrukking — het kan dus alleen beter worden, nooit slechter.

### De offertepagina's: `/offerte` en `/offerte-prefab-opbouw`

Allebei zijn ze de configurator. De live `/offerte/` is een iframe van een gehoste widget van
een derde partij — daar valt niets van mee te nemen — en `/offerte-prefab-opbouw/` is een
Divi-formulier van achttien velden dat zijn antwoorden mailt en niets bewaart. De klant heeft
gekozen dat hun eigen offerte die van de ander vervangt.

De pagina's laden de configurator in een `iframe` naar **`/prefab/embed`**: hetzelfde bestand
als `/prefab`, zonder de eigen kop van de configurator, met dezelfde frame-headers. Het adres
is relatief, dus het frame draait op dezelfde host als de pagina eromheen. Dat ene besluit
neemt de hele rij randgevallen weg: geen CORS, geen derde-partij-cookies die door Safari of
Chrome worden afgeknepen, `enforce_origin` ziet de eigen host, en de catalogus die het frame
laadt is vanzelf die van déze website.

**De hoogte.** De configurator is geen document maar een viewport-toepassing: `body` staat op
`overflow:hidden`, de werkruimte op `height:100%` en het keuzepaneel scrolt in zichzelf. Er
valt dus geen inhoudshoogte te rapporteren — het ding vult wat het krijgt. Daarom bepaalt de
pagina de hoogte (`clamp()` in `cs_prefab_configurator/static/src/embed_host.css`) en **adviseert**
het frame alleen een ondergrens via `postMessage`. Beide kanten controleren de herkomst én het
venster, de ontvanger begrenst het getal, en als het script nooit draait houdt de pagina
gewoon de hoogte uit het stylesheet. Dat is de terugval, niet een storing.

De inhoud eromheen staat in twee `oe_structure`-blokken en is dus in de bouwer te bewerken; het
framevenster zelf staat er bewust buiten. Alles wat de bouwer kan aanraken, kan hij ook
weggooien, en een offertepagina zonder configurator ziet er af uit en levert niets op.

### De pagina's

Elke pagina van de inventaris staat er: home, over ons, oplossingen met zijn drie
dienstpagina's, projecten, partner worden, contact, nieuws, de twee offertepagina's en de twee
nieuwsberichten. De tekst is letterlijk die van de klant — er is niets herschreven en niets
"verbeterd". Wat wél is veranderd, is per geval een gemeten defect, en elk daarvan staat
hieronder.

**Alles staat in een `oe_structure`.** Dat is het blok waar de bouwer van Odoo in mag werken:
de klant kan een sectie verplaatsen, herschrijven, weggooien of er een nieuw blok in slepen.
Vanaf de eerste bewerking van een pagina serveert Odoo een kopie die aan deze website hangt en
bereiken module-updates die pagina niet meer. Dat is precies de afspraak: een release kan nog
steeds een pagina verbeteren die niemand heeft aangeraakt, en kan er nooit een overschrijven
die iemand wél heeft aangeraakt.

> **Gecorrigeerd 2026-09-20 — die afspraak was tot deze release NIET waar, en dit is wat eraan
> is gedaan.** De belofte hierboven gold voor 24 van de 34 views van dit module en niet voor de
> tien die ertoe doen: de paginaviews. `data/page_data.xml` zette `website_id` op elk
> `website.page`-record; dat veld is `related='view_id.website_id', store=True, readonly=False`,
> dus het schreef dóór op de `ir.ui.view`-rij en de view was al website-specifiek bij de eerste
> installatie. Odoo slaat copy-on-write over voor een view die al specifiek is — er valt niets
> meer te kopiëren — en de bewaking die anders `noupdate` op een bewerkte view zet, is onder een
> website-context bewust uitgeschakeld. Gemeten op de live database: precies die tien views
> droegen `website_id = 1` met `noupdate = f`, dus elke `-u cs_prefab_website` herschreef ze
> onvoorwaardelijk en vernietigde elke bewerking van de klant — zonder foutmelding en zonder
> logregel.
>
> Het veld is nu weg uit die records, en
> `models/website.py::_cs_prefab_release_page_views` haalt het weg op websites die het al
> dragen. De inhoud wordt niet aangeraakt: wat vandaag op de pagina staat, blijft staan. De
> proef staat in `addons/cs_prefab_website/tests/test_brand_foundation.py` — een bewerking
> opslaan, het meegeleverde sjabloon herschrijven, en controleren dat de bewerking er nog is.

**Wat er bewust búiten staat, en dus niet in de bouwer te bewerken is.** Gemeten in een browser
op 2026-09-17, pagina voor pagina; deze lijst is volledig:

| Pagina | Wat staat er buiten een `oe_structure` | Waarom |
|---|---|---|
| `/offerte`, `/offerte-prefab-opbouw` | het configuratorvenster (het `<iframe>`-blok) | alles wat de bouwer kan aanraken kan hij ook weggooien, en een offertepagina zonder configurator ziet er af uit en levert niets op |
| `/projecten` | het projectoverzicht zelf | het is de weergave van de projectrecords, geen tekst; bewerken doe je via **Website → Projecten**. De band erboven en de band eronder staan wél in een `oe_structure` |
| `/nieuws` | het nieuwsoverzicht zelf | idem, maar dan Odoo Blog. Boven en onder is bewerkbaar |
| elke pagina | de structured data in `<head>`, en de `FAQPage`-markering op `/contact` | alles binnen een bouwerregio gaat bij het opslaan door de sanitizer en een `<script>` overleeft dat niet — de markering zou verdwijnen op het moment dat iemand voor het eerst een zin wijzigt |
| elke pagina | de header met het menu | dat is Odoo's eigen headersjabloon en geen `oe_structure`. Hij is wél bewerkbaar, maar via de header-opties van de bouwer (menu, logo, kleur, scroll-effect) in plaats van door er blokken in te slepen |

**Gecorrigeerd 2026-09-17.** Hier stond tot vandaag een vijfde regel over
`/projecten/<webadres>` — "de titelband, het verhaal, de fotogalerij en andere projecten".
Die pagina bestaat niet meer: de galerij is één pagina, er is geen detailroute en
`/projecten/<wat-dan-ook>` antwoordt met een 404. De regel beschreef dus een scherm dat
niemand kan openen, en dat is de gevaarlijkste soort documentatie: ze klopt niet en ze valt
niet op. De regel over de header is nieuw en stond er ten onrechte niet, want de zin hieronder
("alle overige secties ... staan in een `oe_structure`") suggereert anders.

De tabel is opnieuw afgeleid uit de sjablonen zelf en niet uit het geheugen: voor elke
`<section>` in `views/` is gecontroleerd of er een `oe_structure` boven hem staat op het moment
dat de pagina rendert. De blokken die via `t-call` worden ingevoegd (`s_prefab_usp`,
`s_prefab_diensten`, `s_prefab_hotspots`, het folderblok, de nieuwsteaser) staan in hun eigen
bestand buiten een `oe_structure`, maar landen bij het renderen altijd bínnen de
`oe_structure` van de pagina die ze aanroept — ze zijn dus wél bewerkbaar, met de kanttekening
hieronder dat een wijziging aan zo'n gedeeld blok overal doorwerkt.

Alle overige secties van alle pagina's staan in een `oe_structure`, inclusief de voettekst.

**Drie blokken staan één keer en worden overal aangeroepen**, want op de live site staan ze met
exact dezelfde woorden op acht tot elf pagina's:

| Blok | Waar | Hoe |
|---|---|---|
| USP-balk (Snelle bouwtijd / Hoge kwaliteit / Transparante kosten / Ondersteuning) | 11 pagina's | eigen snippet `s_prefab_usp` |
| Dienstenrij (vier kaarten naar de oplossingen) | 8 pagina's | eigen snippet `s_prefab_diensten` |
| Interactieve afbeelding met de drie plusjes | 4 pagina's | eigen snippet `s_prefab_hotspots` |

Alle drie staan ze ook in de blokkenlade van de bouwer, met een naam en een miniatuur, dus de
klant kan ze zelf ergens anders neerzetten. Wijzig je zo'n blok, dan wijzigt het overal — dat
is de bedoeling (het telefoonnummer hoeft maar één keer te veranderen), maar het is goed om te
weten voordat je een zin aanpast.

De rest van de secties gebruikt gewone Odoo-snippets: `s_cover` voor de hero, `s_title` voor de
paginatitelband, `s_text_image` en `s_image_text` voor beeld-met-tekst, `s_cards_grid` voor
kaarten, `s_references` voor de logostrook, `s_process_steps` voor de drie stappen,
`s_faq_collapse` met `s_accordion` voor de vragenlijst, `s_website_form` voor de formulieren,
`s_call_to_action` voor de oproepen en `s_text_block` voor de kleurbanden. De klant krijgt
daarmee de opties die hij van Odoo gewend is.

### De projectgalerij

De klant heeft het zelf gezegd: hij heeft de projecten **nooit als benoemde items** op de site
gezet, hij heeft er een **galerij** van gemaakt — en hij vroeg om een voorbeeldweergave. Dat is
wat hier staat.

`/projecten` was één Divi-galerij met 36 losse foto's: geen titels, geen bijschriften, geen
plaatsnamen, geen jaartallen, geen filter. Op een telefoon is dat 16.883 px scrollen — ongeveer
twintig schermen miniaturen zonder iets om op te stoppen, en alle 36 foto's op volle resolutie
tegelijk.

Nu is het dezelfde galerij, met de dingen eromheen gerepareerd:

* **dezelfde 36 foto's, in dezelfde volgorde.** Een test vergelijkt de lijst foto voor foto met
  de inventaris van de oude site; hij valt om zodra er één verdwijnt, bijkomt of verschuift.
* **elke foto vraagt de maat op waarop hij staat** (240, 400 of 600 px breed, afhankelijk van
  het scherm) en alles onder de vouw laadt pas als je er bent. De pagina weegt volledig
  gescrold 1,2 MB op een telefoon; de oude haalde in één keer ruim tien megabyte binnen.
* **een klik vergroot de foto.** Escape sluit, de pijltjes bladeren door alle 36, Tab blijft
  binnen het venster en de focus keert terug naar de foto waar je vandaan kwam. Zonder
  JavaScript is elke miniatuur gewoon een link naar de foto zelf — geen dode klik.
* **alt-tekst is verplicht bij elke foto.** Vier van de 36 foto's op de live site hebben er
  helemaal geen; door het veld verplicht te maken kan dat niet terugkomen.

**Er staat geen woord dat niemand heeft geschreven.** Een eerdere ronde had vijf projecttitels
bedacht, vijf korte omschrijvingen en een indeling in soorten waar de galerij op filterde. Geen
daarvan staat in de bron, dus ze zijn weg. Wat er nog wel staat, staat er omdat WordPress het
zelf zei: de fotobeschrijvingen noemen twee keer een plaats — **Den Haag** en **Zoetermeer** —
en die twee staan op de foto's van die twee bouwen.

Beheren gaat via **Website → Projectfoto's**. Een *reeks* is de doos om de foto's van één bouw:
daar vul je één keer een plaats in in plaats van zesendertig keer. Elk veld heeft een uitleg
onder het vraagteken, en vier velden staan **leeg klaar** voor de klant:

| veld | wat het doet zodra je het invult |
|---|---|
| Naam van de reeks | komt onder elke foto van die reeks te staan en in de vergroting |
| Plaats | idem — twee reeksen hebben hem al |
| Jaar van oplevering | idem |
| Verhaal bij deze reeks | staat in de vergroting, onder de foto |

Leeg laten is de bedoeling zolang je het niet weet. Wat leeg is, toont de site niet; een
verkeerd jaartal leest een bezoeker als een feit.

### Het nieuws

De twee berichten staan in Odoo Blog, op de eigen adressen van de blog, met hun datum en hun
tekst. Het overzicht staat op `/nieuws`, want dat adres staat in de URL-afspraak. De oude
losstaande adressen van beide berichten wijzen met een 301 naar het bericht zelf.

Op de kaarten staat nu de datum en de rubriek. Dat is geen toevoeging maar een reparatie: de
artikelkop van het bericht zelf droeg die informatie wél ("7-mrt-2025 | Nieuws") en de kaarten
gooiden hem weg — precies op de plek waar een bezoeker besluit of hij klikt.

Een nieuw bericht schrijf je via **Website → Blog → Berichten**. Het komt vanzelf op `/nieuws`
en op de homepage te staan.

### De formulieren

Er zijn er twee, en allebei maken ze een **lead in Odoo** aan:

* het contactformulier op `/contact`, met dezelfde vijf velden als de live site;
* een **nieuw partnerformulier** op `/partner-worden`, met bedrijfsnaam en KvK-nummer.

Dat tweede formulier bestond niet. Een aannemer die partner wilde worden belandde in hetzelfde
formulier als een particulier, zonder veld voor zijn bedrijf, en in de mailbox was het verschil
niet te zien. Nu komt zo'n aanvraag binnen met het onderwerp "Partner worden".

Wat er verder is veranderd aan het formulier, allemaal gemeten defecten van de live site:

* **De aanvraag wordt bewaard.** Divi mailde het antwoord en bewaarde niets; een mail in een
  spamfilter was een lead die spoorloos verdween.
* **Zichtbare labels bóven de velden.** Op de live site staat de veldnaam alleen in de
  placeholder, en die verdwijnt zodra iemand begint te typen — schermlezers krijgen niets.
* **`autocomplete` op naam, telefoon en e-mail**, zodat een telefoon ze kan invullen.
* **De rekensom is weg.** "3 + 15 =" in een veld zonder label is een drempel die precies de
  bezoeker straft die op een telefoon snel iets wil achterlaten.
* **Een echte bevestiging.** Na het verzenden staat er wat er gebeurd is, en het
  telefoonnummer voor wie niet wil wachten. Bij een fout blijft alles staan wat er is
  ingevuld.

  **Gecorrigeerd 2026-09-17.** Hier stond "en wanneer we terugbellen". Dat klopte niet meer
  met wat er wordt uitgeserveerd: een eerdere ronde heeft de zin "We nemen binnen twee
  werkdagen contact met je op" er juist uitgehaald, met de reden erbij in het sjabloon —
  een reactietermijn staat nergens in de bron en is een belofte die alleen de klant kan
  doen. De README beloofde dus nog iets wat de pagina bewust niet meer zegt.
* **Een toestemmingsvinkje** met in één zin wat er met de gegevens gebeurt.

### Wat er nog meer is gerepareerd

Elk punt hieronder komt uit `docs/website/site-audit.md` en is in de oplevering gemeten.

| Was | Is |
|---|---|
| De knop "Ontwerp je aanbouw" onderaan het best vindbare artikel had `href="#"` en deed niets | wijst naar `/offerte`; een test faalt op elke lege link |
| Telefoonnummer en e-mailadres nergens aanklikbaar, op geen van de 14 pagina's | `tel:` en `mailto:` in de voettekst, dus op elke pagina |
| Vier `<h4>`'s vóór de `<h1>` op tien pagina's | de USP-balk is een opsomming; elke pagina heeft precies één `<h1>` en daalt netjes af |
| Geen `<main>`-landmark op 13 pagina's, geen overslaanlink | beide aanwezig op elke pagina |
| Nergens een zichtbare focusring (26 van 26 tabstops) | `:focus-visible` met 2 px in de merkkleur |
| Oranje `#E9521D` als tekstkleur: 3,69:1 waar 4,5 vereist is | `#C43F12` voor alles wat tekst draagt; op tint en grijs `#AF3E16` |
| Vier projectfoto's zonder alt | alt is een verplicht veld op het projectrecord |
| Negen van de 14 omschrijvingen waren een echo van de titel | elke pagina een eigen omschrijving van 140-160 tekens |
| Acht pagina's zonder deelafbeelding; drie dienstpagina's deelden er één | elke pagina een eigen `og:image` |
| Geen adres, telefoon of werkgebied in de structured data | `HomeAndConstructionBusiness` met adres, telefoon, werkgebied en sociale profielen |
| De FAQ zonder `FAQPage`-markering | de negen vragen staan als `FAQPage` in de paginakop |
| Een GIF van 13,0 MB op twee pagina's | een geanimeerde WebP van 640 kB |
| De hero-video stuurde 7,34 MB naar elke telefoon | posterframe van 47 kB; de video komt alleen op een breed scherm en een snelle verbinding |
| Drie projectfilms haalden samen 10,31 MB op zonder dat iemand op afspelen drukte | posterframe en `preload="none"` |
| 24 foto's werden op een fractie van hun formaat getoond | elke foto wordt op zijn weergavegrootte opgevraagd; de grote foto's hebben twee formaten |
| "Vrijblijvend advies gesprek" | "Vrijblijvend adviesgesprek" |
| `<title>` "Welkom bij PrefabPartner.nl" | de dienst staat vooraan |
| Zoomen uitgeschakeld op elke pagina | Odoo zet `user-scalable` niet; zoomen werkt |

### Vormgeving

De klant vroeg om pagina's die opvallen, "maar passend bij de sector — geen discobal". Voor een
bouwbedrijf betekent dat: de eigen foto's van opgeleverd werk krijgen ruimte, de typografie
draagt de hiërarchie, echt bouwdetail is het onderwerp, en er is veel witruimte en weinig
versiering. Het betekent niet: bewegende verlopen, parallax, oplopende tellers of ornament
zonder verwijzing.

Een randvoorwaarde die het hele ontwerp stuurt: **er is geen foto vervangen en geen zin
herschreven.** `.data/migration_diff_website.py` telt een bestand dat nergens meer wordt
aangeroepen als verlies, en de afspraak met de klant is dat zijn tekst letterlijk blijft. De
winst moest dus uit compositie, typografie, ruimte, kleur en beweging komen — niet uit ander
materiaal. Dat is een strengere opgave en een eerlijkere.

Wat er is veranderd, per stuk:

| Was | Is | Waarom |
|---|---|---|
| De hero was 380 px hoog met de kop op een egale sluier van 84% | 78 vh (520-760 px), een sluier die als vlak onder de tekst ligt en daarna afloopt zodat het beeld rechts leeft, en een insigne van 260 px | dit is het enige beeld dat élke bezoeker ziet; zie de contrastsom in de stylesheet, waar het oranje vinkje (en niet de witte tekst) de dekking afdwingt |
| De paginatitelband was 90 px hoog: een zwarte balk met een woord erin | 176-232 px met een verloop dat de foto laat leven | de foto eronder was gewicht zonder functie, op elf pagina's |
| Kopmaten sprongen op 992 px van 40 naar 52 px | `clamp()`, vloeiend, met dezelfde eindwaarden als de gemeten schaal van de live site | een tablet van 900 px kreeg een mobiele kop naast een lay-out van twee kolommen |
| `<h3 class="h5-fs">` stond overal op h3-maat | de moduleregel stapt opzij voor elke expliciete maatklasse | een rekenfout in de specificiteit; zie het blok Typografie in de stylesheet |
| Alinea's liepen over de volle 1152 px | leesbreedte 62 tekens, koppen 26 | een regel van 150 tekens wordt gescand, niet gelezen |
| De vier dienstenkaarten stonden scheef en hadden geen klikteken | gelijke onderlijn, een pijl die bij hover een halve stap opschuift, 88 px icoon | de titels zijn 13-20 tekens lang en braken verschillend af |
| De drie stappen droegen een oranje cijferschijf **en** een lijnicoon, met gecentreerde tekst | cijfer en icoon naast elkaar, tekst links uitgelijnd, haarlijnen tussen de kolommen | twee merktekens die hetzelfde zeggen, en drie kolommen zonder gemeenschappelijke linkerlijn |
| "Jouw project, jouw ontwerp" was één smalle kolom met 700 px witruimte ernaast | twee kolommen: kop en knop links, de vier beloftes met haarlijnen rechts | op vier pagina's dezelfde lege helft |
| De interactieve tekening zweefde in wit | op de grijze band, met een wit vlak eronder | het is een doorsnede op een werkblad, geen foto |
| Vier logo's op vier optische maten met 200 px lucht eromheen | één hoogte, `contain`, haarlijn boven en onder | het was geen strook maar vier losse plaatjes |
| De carrouselknoppen waren Bootstraps grijze chevrons op een foto | witte schijven van 48 px met een rand | onzichtbaar op een lichte lucht én op een donkere gevel |
| De USP-balk was vier losse woorden in een oranje vlak | vier gelijke vakken met een haarlijn ertussen | dezelfde streep als bij de stappen en de beloftelijst: één systeem |
| De uitgeknipte figuur in de voettekst eindigde met een rechte snee op de scheidingslijn | hij zakt er bewust dóórheen, en de tekst ernaast houdt 60% van de kolom | het zag eruit als een fout in plaats van als een uitsnede |
| De colofonlinks droegen een los scheidingsteken tússen de links | het teken staat vóór elke link behalve de eerste | op een telefoon bleef er een streepje aan het eind van een regel hangen |
| De korte formuliervelden waren 716 px breed | twee per rij (naam/woonplaats, telefoon/e-mail) | een naamveld van 716 px dwingt het oog de hele regel af |
| De FAQ-kop stond boven een halve schermhoogte leegte | de kop loopt mee (`position: sticky`) zolang de lijst duurt | geen beweging, geen script, en onder lg gebeurt er niets |
| Drie vierkante foto's onder de hero werden op een telefoon 1.170 px scrollen | liggende uitsnede onder md: 780 px | dezelfde drie foto's, minder lucht |
| De nieuwskaarten toonden `2025-03-07` | `7 maart 2025` | een kaart wordt gescand; de datumconverter kreeg een `format` mee |

**Eén teken keert terug en het is niet verzonnen**: de oranje caret die de live site vóór elke
paginatitel zet, hier op zijn kant als een streep van 44 px boven een sectiekop
(`.o_prefab_rule`). Het is het enige ornament in de stylesheet en het heeft dus een verwijzing.
Er is **geen** uitgespatieerde kapitalenregel bijgekomen: de live site heeft
`letter-spacing: normal` op élk element van élke pagina, en dat is precies het detail dat als
eerste niet meer als dit merk leest.

### Beweging

**Gecorrigeerd 2026-09-17.** Hier stond "de animaties van de live site blijven, en er komt er
geen bij". Dat klopt niet meer: bij de ontwerpronde van vandaag zijn er vijf bijgekomen (de
entree van de hero, de streep onder een menulink, het indrukken van een knop, het openen van de
vergroting en het inzoomen van een galerijfoto). Ze staan hieronder alle elf in één tabel, elk
met het register waarin hij valt, want dat register is wat het getal bepaalt.

De snelheden en de twee curves staan **één keer** in `static/src/scss/prefab_site.scss` en
worden overal doorverwezen — twee `cubic-bezier`-waardes in één codebase is dezelfde soort
fout als twee bronnen voor één getal. Er staat in dat bestand geen losse cubic-bezier en geen
los aantal milliseconden meer.

De snelheden zijn geen smaak maar een **frequentievraag**: hoe vaak ziet één mens dit?

* wat iemand **tientallen keren per bezoek** ziet (een hover, een menulink, de vastklikkende
  header, het openen van de vergroting) blijft **onder 300 ms**, beweegt alleen `transform` en
  `opacity`, en gebruikt een **uitloopcurve** (`--prefab-ease-ui`, `cubic-bezier(.25, 1, .5, 1)`)
  — meteen op snelheid, zacht tot stilstand, want de eerste 80 ms bepalen of het antwoord
  "direct" voelt;
* wat iemand **één keer per bezoek** ziet (de hero bij het eerste beeld, een sectie die bij het
  scrollen verschijnt) mag **500-800 ms** duren en gebruikt de curve van de live site zelf
  (`--prefab-ease-enter`, `cubic-bezier(.77, 0, .175, 1)`) — die begint traag en leest dus als
  "er komt iets aan". Op de live site duurt de onthulling 1000 ms en gebeurt hij zeventien keer
  per pagina; dat is óók voor "eenmalig" over het budget.

| # | Beweging | Register | Duur | Curve | Wat er beweegt |
|---|---|---|---|---|---|
| 1 | Knop indrukken | herhaald | 120 ms | ui | `transform` 1 px |
| 2 | Menulink + de streep eronder | herhaald | 150 ms | ui | `color`, `transform: scaleX` |
| 3 | Header die vastklikt | herhaald | 280 ms | ui | `box-shadow` |
| 4 | Knop-hover (vlak + pijl) | herhaald | 300 ms | ui | `background-color`, `transform` |
| 5 | Kaart-hover (dienstenkaart, nieuwskaart) | herhaald | 300 ms | ui | `transform: translateY(-10px)` |
| 6 | Galerijfoto: oranje waas + vergrootglas + 4% inzoomen | herhaald | 300 ms | ui | `opacity`, `transform: scale` |
| 7 | Formulierveld dat focus krijgt | herhaald | 300 ms | ui | `background-color` |
| 8 | Markering op de interactieve afbeelding | herhaald | 300 ms | ui | `opacity`, `transform: scale` |
| 9 | De vergroting die opengaat | herhaald | 180 ms | ui | `opacity`, `transform: scale(.97→1)` |
| 10 | Sectie die bij het scrollen verschijnt | eenmalig | 560 ms | enter | `opacity`, `transform: translateY(20px)` |
| 11 | De entree van de hero (4 regels, 90 ms na elkaar) | eenmalig | 720 ms | enter | `opacity`, `transform` |

Twaalfde, en de enige doorlopende: de hero-video. Die telt niet als animatie maar als
achtergrond, en hij heeft zijn eigen pauzeknop.

**Elf van de elf bewegen alleen `transform` en `opacity`** — behalve nummer 3, 4 en 7, die een
kleur of een schaduw wisselen. Er wordt nergens `width`, `height`, `top`, `left` of `padding`
geanimeerd; de knop-hover van de live site doet dat wél (`padding-right` van 27 naar 36 px,
dus layout op elke hover) en is hier een `transform` op de pijl geworden.

**Wat er bewust NIET is:** geen parallax, geen tellers die oplopen, geen bewegende verlopen,
geen scroll-gestuurde animatie, geen paginawissel-effect, geen cursoreffect, geen
automatisch doordraaiende carrousel. De live site heeft die ook geen van alle — gemeten,
nul instanties op veertien pagina's — en dat is geen gebrek maar de reden dat de site als een
bouwbedrijf leest en niet als een sjabloon.

Wie zijn besturingssysteem om minder beweging heeft gevraagd, krijgt geen enkele verplaatsing —
maar wel de hele pagina. De regel die iets verbergt, staat achter een klasse die het script pas
zet als het de onthulling ook echt kan afmaken; zonder JavaScript is er dus niets verborgen.

**Het bewegende beeldmerk op `/over-ons` is de uitzondering die apart moest worden opgelost.**
Het is een geanimeerd bestand, en daar raakt geen enkele CSS-regel aan: `animation`,
`transition` en `prefers-reduced-motion` gaan over de doos, nooit over de frames erin. Op de
live site is het een GIF van 13,0 MB (22,7% van het hele sitegewicht); een eerdere ronde maakte
er een geanimeerde WebP van 640 kB van, en die bleef draaien bij iedereen.

Drie dingen zijn eraan gedaan, en het eerste is het belangrijkste:

1. de pagina gebruikt `<picture>` met `media="(prefers-reduced-motion: no-preference)"` op de
   `<source>`. De voorkeur wordt daarmee bij de **download** afgehandeld: wie om minder
   beweging vraagt, krijgt de animatie niet binnen maar het stilstaande beeldmerk van **2,9
   kB**. Een browser die de voorwaarde niet kent, valt terug op datzelfde stilstaande beeld.
2. de animatie zelf is opnieuw gecodeerd: 480 px in plaats van 696, en 125 frames van 80 ms in
   plaats van 250 van 40 ms. De lus duurt nog precies tien seconden en draait even snel;
   hij weegt **215 kB** in plaats van 640 kB. `/over-ons` ging daarmee van 1.316 kB naar
   **892 kB**.
3. het script hangt er een **pauzeknop** onder. WCAG 2.2.2 vraagt die voor alles wat vanzelf
   begint, langer dan vijf seconden beweegt en naast andere inhoud staat; deze lus doet alle
   drie. De knop wisselt de `srcset` van de `<source>` om naar het stilstaande beeld — de enige
   manier om een geanimeerde afbeelding met JavaScript stil te zetten.

`scripts/verify-gallery.mjs` meet alle drie in een echte browser, aan het netwerkverkeer: met
de voorkeur aan hoort de animatie er **niet** te zijn en het stilstaande beeld wel, en
andersom.

### Merk, kleur en typografie

**Het merk staat waar de editor het leest.** Dat is sinds 2026-09-20 zo en het was daarvoor
het omgekeerde; de correctie staat verderop in deze paragraaf, want ze is de belangrijkste
beslissing in dit module.

`models/website.py::_cs_prefab_apply_theme` schrijft de hele vormgeving één keer per website
weg via `website.assets.make_scss_customization()` — dezelfde methode die de editor zelf
aanroept als iemand een kleurstaal verzet, en precies wat Odoo's eigen site-configurator doet
(`website/models/website.py::configurator_apply`). Er gaat drie bestanden in:

| bestand | wat erin gaat |
|---|---|
| `user_color_palette.scss` | de vijf merkkleuren, de vier chrome-sleutels en alle 35 waarden van de kleurcombinaties |
| `user_theme_color_palette.scss` | de vier statuskleuren van Bootstrap |
| `user_values.scss` | de typografische schaal, de knoppen, de invoervelden, de header, de voettekst en de drie schaduwtrappen |

Vanaf dat moment is het van de klant: **Vormgeving → Kleuren**, **Lettertypen**, **Knoppen**,
**Header**, **Voettekst** doen wat ze zeggen, en een volgende update raakt er niets meer aan —
de stap draait op `cs_prefab_seed_level`, net als het logo en het menu.

De vijf kleuren:

| sleutel | waarde | rol | wordt |
|---|---|---|---|
| `o-color-1` | `#C43F12` | actie: knoppen, links, actieve staat | `o_cc4` |
| `o-color-2` | `#E7E2DE` | steen: formulieren, kaartrasters, de technische tekening | `o_cc3` |
| `o-color-3` | `#FDEAE4` | tint: de rustige band tussen twee witte secties | `o_cc2` |
| `o-color-4` | `#FFFFFF` | papier: de leesgrond en de header | `o_cc1` |
| `o-color-5` | `#1A1A1A` | inkt: de voettekst, de titelband, de donkere CTA | `o_cc5` |

Welke kleur welke combinatie wordt, is **geen keuze**: het ligt vast in het `base-1`-palet en
is op de live instantie nagemeten. De 193 snippets van 19.4 gaan ervan uit dat `o_cc1` licht is,
`o_cc2` getint en `o_cc5` donker (110, 65 en 53 keer); elke andere indeling breekt ze.

Twee waarden bestaan hier en nergens anders. `#AF3E16` is de linkkleur op de twee lichte
getinte gronden, waar de actiekleur 4,44:1 en 4,02:1 haalt en dus zakt. `#C9C4C0` is de
linkkleur op de donkere grond, zodat de oranje knop het enige warme object in de voettekst is.

**De actiekleur is de belangrijkste van de vijf.** De site serveerde `#e8511d`: op wit 3,73:1,
terwijl 4,5:1 vereist is — en dat is de kleur van de hoofdknop op alle 21 pagina's, van de
USP-band op tien en van 27 dienstenkaarten op negen. `#C43F12` leest als hetzelfde merkoranje
en haalt 5,16:1. Die ene waarde sluit alle drie de overtredingen tegelijk.

Elke kleurcombinatie is vastgezet in plaats van afgeleid, zodat het contrast van een link op
een getinte sectie een gemeten getal is en geen bijproduct van andermans formule. Een
vastgezette sleutel belandt ook in Odoo's `$o-we-auto-contrast-exclusions`, waardoor Odoo
stopt met het zelf afleiden van bijna-gelijke tinten — dat is wat de vier zwerforanjes
(`#b53c12`, `#872d0e`, `#f4aa91`, `#f3a78c`) uit de site haalt. Een test rekent alle
combinaties opnieuw na uit de code die ze wegschrijft.

> **Gecorrigeerd 2026-09-20 — hier stond het omgekeerde, en het was onwaar.**
>
> Deze paragraaf beschreef een merkpalet in `static/src/scss/prefab_palette.scss` dat "in de
> kleurkiezers van de website-editor verschijnt". Dat bestand stond in **geen enkele
> asset-bundel**: `__manifest__.py` gaf `web._assets_primary_variables` op als een lege lijst,
> en `_cs_prefab_apply_theme` was een gedocumenteerde no-op. De hele vormgeving zat in 1857
> regels `prefab_site.scss` — een laag *onder* elke keuze die de Theme-tab wegschrijft. De
> klant kon een kleur kiezen en er gebeurde niets, en de kiezer toonde `#e8511d` terwijl de
> pagina `#C43F12` verfde. Dat is exact het defect waar de kop van dat bestand zelf voor
> waarschuwde.
>
> De no-op had een echte aanleiding. De eerste poging REGISTREERDE een palet door te mergen in
> `$o-color-palettes` vanuit die instantie-brede bundel, en Odoo's paletgeneratie wierp
> `Incompatible units: '%' and 'px'` — waarmee `web.assets_frontend` omviel voor élke website
> op deze Odoo. De oorzaak ligt in Odoo's eigen bron:
> `website/static/src/scss/secondary_variables.scss` zoekt het grijs- en het themapalet op met
> **dezelfde naam** als het kleurpalet, vindt voor een eigen naam in geen van beide iets, en
> rekent verder op lege maps. Een palet registreren vraagt om registratie in alle drie de maps.
>
> Dus registreren we er geen. De brede bundel blijft leeg, `prefab_palette.scss` is verwijderd,
> en het merk gaat per website naar de klantwaarden — waar de editor het ook heen schrijft.

### Header en voettekst

**De header blijft staan bij het scrollen — en doet dat nu met Odoo's eigen optie.**
`_cs_prefab_apply_chrome_views` zet `website.header_visibility_fixed` aan en
`website.header_visibility_standard` uit, per website, met dezelfde schrijfactie die de builder
zelf gebruikt. Het blijft dus een keuzerondje in het Header-paneel; de klant kan er een ander
effect voor in de plaats kiezen.

> **Gecorrigeerd 2026-09-20.** Hier stond dat een data-bestand die optie niet kan zetten en dat
> de regel daarom in de stylesheet van dit module staat. Die regel **heeft nooit gewerkt**:
> Odoo's altijd-actieve `website.header_visibility_standard` zet `o_header_standard` op elke
> header, en de `:not()`-keten van onze eigen regel sloot precies die klasse uit. Gemeten op de
> live site was `position` bovenaan de pagina `static`. Twee metingen van deze site kwamen
> daardoor tot tegengestelde antwoorden — "standard" scrollt de header wég en brengt hem op de
> terugweg terug, dus wie halverwege meet ziet `fixed` en wie bovenaan meet ziet `static`.
> `header_visibility_fixed` is één toestand.

Tegelijk gaan er twee stukken Odoo-demonstratiemateriaal uit de header:
`website.header_text_element` (het telefoonnummer `+1 555-555-5556`, tweemaal per pagina op alle
21 pagina's, naast het echte Nederlandse nummer dat het vier-op-één verslaat) wordt
uitgeschakeld, en `website.contact_us_link_url` — de enige oranje knop in de header — wijst niet
langer naar `/contactus`, Odoo's eigen demonstratiepagina, maar naar `/contact`.

**De voettekst is een preset, geen overlay.** Hij erft `website.footer_custom` — Odoo's eigen
"Standaard"-voettekst — en vervangt de sectie erbinnen, met een `$0`-tak die de andere website
haar eigen voettekst onveranderd teruggeeft. Het `#footer`-omhulsel zelf komt daarmee van Odoo,
inclusief zijn `oe_structure`, dus de klant kan de voettekst in de builder herschrijven en er
blokken in slepen.

> **Gecorrigeerd 2026-09-20.** Dit sjabloon erfde `website.layout` op **prioriteit 60** en
> verving `//div[@id='footer']`. Alle twaalf voettekstsjablonen van Odoo staan op de
> standaardprioriteit en vervangen diezelfde knoop — dus welke voettekst de klant ook koos in
> **Vormgeving → Voettekst**, deze verving hem daarna, en de keuzelijst deed niets. Een knop die
> stilletjes niets doet is erger dan een knop die ontbreekt: wie hem gebruikt concludeert dat de
> software stuk is en vertrouwt de rest van het paneel ook niet meer.
>
> Door `footer_custom` te erven wordt deze voettekst de **inhoud** van die ene preset in plaats
> van een laag over alle twaalf. Kiest de klant een andere preset, dan schakelt Odoo
> `footer_custom` uit, gaat deze overerving mee, en rendert de gekozen preset schoon. Kiest hij
> "Standaard" terug, dan staat deze inhoud er weer.

Odoo's eigen colofon gaat uit (`website.footer_no_copyright`): de pagina eindigde tot nu toe met
twee copyrightregels, twee achtergrondkleuren en twee `http://`-links naar odoo.com.

Twee defecten van de oude site zijn hier meteen gerepareerd, omdat de voettekst op elke pagina
staat:

* **Telefoonnummer en e-mailadres zijn aanklikbaar.** Op de live site staan ze op geen van de
  veertien pagina's als link, dus een bezoeker op een telefoon moet ze overtypen.
* **De WhatsApp-knop is een echte link.** De plugin van de live site rendert een `<div>` zonder
  `tabindex`, `role` of `aria-label`; met een toetsenbord is hij onbereikbaar.

Ook zichtbaar: een focusring. Op de live site hebben alle 26 tabstops van de homepage
`outline-style: none`, op beide breedtes.

**Bewust niet overgenomen:** de Facebook-link uit de voettekst van de live site.
`https://www.facebook.com/share/1AFjFfkSuE/?mibextid=wwXIfr` antwoordt met HTTP 400, op alle
veertien pagina's. Een kapotte link overnemen is het defect meeverhuizen. Het echte adres van
de pagina is nodig van de klant; tot die tijd staan LinkedIn en Instagram er wel.

### Beeldbank

De 91 gedownloade bestanden worden door `scripts/import_site_media.py` in het module gezet en
in `data/media_index.json` verantwoord — bestand voor bestand, met de reden waarom het is
verkleind, hercodeerd of ongewijzigd overgenomen. Dat script is het enige dat
`static/src/{media,video,pdf}` mag schrijven; met de hand repareren houdt niet, want de
volgende run overschrijft het.

Afbeeldingen en documenten worden bij installatie publieke `ir.attachment`-records, want dát is
wat de beeldkiezer van de builder toont, wat Odoo op aanvraag herschaalt via
`/web/image/<id>/<b>x<h>`, en wat de klant zonder release kan vervangen. Video's blijven
statische bestanden: de builder heeft geen widget die een eigen MP4 beheert, dus een
attachment zou niets opleveren en tien megabyte video in de filestore zetten naast de tien
megabyte die al in de modulemap staat.

`ir.attachment.datas` bestaat op dit doel **niet meer** en wordt bij het schrijven **stil
weggegooid**. Een XML-databestand met `<field name="datas" file="..."/>` zou 91 attachments
zonder inhoud aanmaken, zonder één foutmelding. De inhoud gaat daarom via `raw`, verpakt in
`BinaryBytes`, en wordt teruggelezen via de opgeslagen `checksum`.

### URL-kaart

`data/url_map.json` noemt elk adres dat de live site vandaag met een 200 beantwoordt en wat het
na de omzetting bedient. Een test vergelijkt die lijst met het onderzoeksinventaris: een URL
die in de bron stond en nergens is aangekomen, is een testfout.

Adressen met een afsluitende slash krijgen **geen** eigen 301. Odoo stuurt een pad dat op `/`
eindigt en geen pagina raakt zelf al door naar hetzelfde pad zonder slash, vóórdat de
omleidingstabel wordt geraadpleegd; en één omleidingsregel dekt sowieso beide schrijfwijzen.
Elf regels die nooit kunnen vuren zijn niet gratis — het zijn elf regels waar een latere
beheerder over moet nadenken.

## Wat dit module níet doet

* Het **publiceert geen catalogus**. Dat is een commerciële handeling.
* Het **zet geen DNS om** en configureert de reverse proxy niet. De 301 naar het canonieke
  adres is proxy-werk en is een voorwaarde vóór stap 3 hieronder.
* Het **publiceert geen privacyverklaring**. De tekst daarvan is een juridische keuze van de
  klant; het formulier legt in één zin uit wat er met de gegevens gebeurt en er is bewust geen
  link naar een pagina die nog niet geschreven is.
* Het **zet geen spamfilter aan**. Odoo heeft er twee (reCAPTCHA v3 en Cloudflare Turnstile);
  allebei hebben ze sleutels van de klant nodig. Zolang er geen provider is ingesteld, is de
  captcha-haak op de formulierroute een lege huls.

## Wat dit module aan poorten meebrengt

Er draait geen Odoo op de ontwikkelmachine, dus alles wat "het werkt" beweert, wordt zonder
Odoo gemeten en pas in de kloontest van de releasepijplijn tegen een echte database gehouden.

| poort | wat hij beantwoordt |
|---|---|
| `python -m unittest discover -s tests` | wat de bestanden ZEGGEN: sjablonen, beeldverwijzingen, de galerij tegen de inventaris van de oude site, de beeldbank |
| `python scripts/preview_website.py` | rendert de QWeb van dit module met zijn eigen SCSS tot statische pagina's |
| `node scripts/verify-website.mjs` | elke pagina in een echte browser op 1440 en 390 px: axe, koppenstructuur, alt, links, gewicht, horizontale overloop. **28 paginaweergaven** — de twaalf pagina's plus de twee nieuwsberichten, allebei op twee breedtes |
| `node scripts/verify-gallery.mjs` | wat een pagina DOET: de vergroting met muis en toetsenbord, dezelfde pagina zonder JavaScript, en het beeldmerk gemeten aan het netwerkverkeer met en zonder "minder beweging" |
| `python .data/migration_diff_website.py` | de vraag die geen andere controle stelt: wat stond er in de bron en is nergens aangekomen? |
| `addons/cs_prefab_website/tests/` | wat de pagina's DOEN tegen een echte database — draait voor het eerst in de kloontest |

`verify-gallery.mjs` bestaat omdat `verify-website.mjs` naar de PAGINA kijkt en niet naar het
GEDRAG. Een vergroting die opengaat, knoppen heeft die reageren en toetsen die werken, maar die
over de galerijsectie staat in plaats van over het scherm, komt door elke statische controle
heen — dat is precies de fout die hier één keer is gemaakt en die deze poort ving.

**Toegevoegd 2026-09-17, twee gaten in `verify-website.mjs`:**

* **De twee nieuwsberichten stonden in geen enkele poort.** Ze zijn `blog.post` en geen
  `website.page`, dus ze vielen buiten de lijst pagina's — terwijl
  `/voordelen-van-een-prefab-aanbouw` het adres is dat op "voordelen prefab aanbouw"
  binnenhaalt en de dode offerteknop droeg. `preview_website.py` rendert nu ook hun tekst, in
  de header, voettekst en stylesheet van deze site, en de poort meet ze mee. Wat daarmee
  gemeten is, is de INHOUD van het bericht; het blogsjabloon eromheen is van Odoo en blijft
  voor de kloontest.
* **Het gewichtsbudget werd wel gemeten en niet getoetst.** `site-audit.md` legt drie grenzen
  vast (pagina onder 2 MB, homepage onder 1,5 MB bij de eerste lading, geen los bestand boven
  500 kB) en dit bestand schreef de getallen netjes in het rapport zonder er ooit op te
  vallen. Ze zijn nu een bevinding. Gemeten na deze wijziging: zwaarste pagina `/projecten`
  1.563 kB, homepage bij de eerste lading 1.047-1.401 kB, geen enkel bestand boven 500 kB dat
  een pagina uit zichzelf ophaalt.

Daarnaast laat de poort de onthulling bij het scrollen nu eerst afmaken vóór de schermafdruk.
De opnames lieten anders 1.400 px wit boven de voettekst van de homepage zien: twee secties
die een bezoeker wél gewoon ziet, maar die de snelle programmatische scroll van de poort
oversloeg. De pagina was goed en het bewijsmateriaal was fout, en dat is de gevaarlijkste
combinatie — een groene poort met een foto van een kapotte pagina ernaast.

## Volgorde bij ingebruikname

1. Reverse proxy: elke andere schrijfwijze met 301 naar `https://prefabpartner.nl`, en http
   naar https. Controleer met `curl -I` per schrijfwijze.
2. Release uitrollen (verpakken → kloontest → bewaakte deploy). Het module installeert
   `website_blog` mee, en die trekt `website_partner` mee.
3. Controleer op het websiteformulier of *Herkomstcontrole configurator* het juiste adres
   noemt en of *Catalogusstatus configurator* nog over demonstratieprijzen spreekt.
4. Open het klaargezette catalogusconcept voor deze website, controleer de prijzen en
   publiceer. Lees daarna `GET /prefab/api/catalog` op **beide** hosts terug en vergelijk de
   `catalogRevision`: het middelste nummer is het website-id. Een schrijfactie die niet wordt
   teruggelezen, is geen meting.
5. `POST /prefab/api/price` op beide hosts. 200 op allebei; 403 betekent dat stap 1 of het
   domeinveld niet klopt. Een GET van `/prefab` bewijst hier niets — `enforce_origin` draait
   alleen op POST.

## Openstaande punten

* **Naam, plaats, jaar en verhaal per fotoreeks.** Alleen Den Haag en Zoetermeer zijn uit de
  bron af te leiden; namen, jaartallen en verhalen staan nergens op de oude site. De velden
  staan klaar en leeg, en ze doen iets zodra ze worden ingevuld — zie *De projectgalerij*
  hierboven. Dit is het eerste waar de klant naar gevraagd moet worden: vijf namen en vijf
  plaatsen maken de galerij meteen doorzoekbaar en vindbaar.
* **De hero-video is een tweede-generatie hercodering.** Hij is op 2026-09-17 door zijn nieuwe
  profiel gehaald (960p, crf 32, plafond 300k: 1.066 kB → 473 kB) op een machine waar de
  oorspronkelijke download niet stond, dus uitgaande van het al getranscodeerde bestand. Het
  record in `data/media_index.json` draagt daarom `"generation": 2`. Eén keer
  `python scripts/import_site_media.py --assets <download>` draaien met het geleverde bestand
  eerst verwijderd, vervangt hem door een eerste-generatie versie van hetzelfde profiel —
  dezelfde maat, iets beter beeld — en de stempel verdwijnt vanzelf. Geen haast: het verschil
  is één ronde H.264 achter een sluier van 90%.
* **"100% tevredenheidsgarantie"** stond zonder voorwaarden en zonder uitleg op `/projecten/`.
  Een onvoorwaardelijke garantiebelofte is onder art. 6:193 BW een uiting die je waar moet
  kunnen maken, dus hij is niet overgenomen. Hij komt terug zodra de klant zegt wat hij
  inhoudt — of wordt vervangen door iets verifieerbaars (aantal projecten, jaren ervaring).
* **De bouwtijd spreekt zichzelf tegen.** De homepage belooft vijf dagen voor een aanbouw,
  `/over-ons` zegt "vaak binnen één dag" over álle prefab oplossingen, en `/oplossingen/prefab-aanbouw`
  zegt "binnen enkele dagen". De teksten zijn letterlijk overgenomen, want dit is een
  inhoudelijke keuze: welk getal geldt per product? Eén cijfer per dienst, en dan overal
  hetzelfde.
* **De auteur van de twee berichten** is nu de bedrijfspartner van Odoo. Zodra de bedrijfsnaam
  in Odoo op "Prefab Partner BV" staat, klopt de naam onder de berichten vanzelf.
* **Een privacyverklaring en een cookieverklaring** als bewerkbare pagina's. De cookiebalk
  staat aan; de tekst eronder moet nog geschreven worden.
* **Spambescherming.** Zet in Instellingen → Website een reCAPTCHA- of Turnstile-sleutel; de
  formulieren pikken dat vanzelf op.
* **Een PNG van het logo van minimaal 112 px** voor Google's voorkeursformaat in de structured
  data. Nu wijst `logo` naar het vierkante beeldmerk van 512 px, wat voldoet, maar het is het
  favicon-bestand en geen logo-export.
* **Een Figtree-licentie of Google Fonts.** Zie hieronder bij Typografie.

* **Facebook-adres** van de klant, om de link in de voettekst te herstellen.
* **De achttien vragen van `/offerte-prefab-opbouw/`.** Het oude formulier vroeg naar bouwjaar,
  type opbouw, vergunning en gewenste startdatum — dingen die de configurator niet vraagt,
  omdat die een aanbouw ontwerpt. De pagina wijst nu eerst naar het maatwerkgesprek en biedt
  daarna de configurator aan. Of die achttien vragen als eigen formulier terug moeten komen, is
  een vraag voor de klant en niet iets om stilzwijgend te laten vallen.
* ~~**Alt-teksten** voor acht afbeeldingen die er in WordPress ook geen hadden.~~
  **Afgehandeld.** Ze zijn geschreven zodra de afbeeldingen een plek op een pagina hadden —
  `logo-2`, `Project-2026-1` tot en met `-4` en `video-1` tot en met `-3`. Ze staan in
  `scripts/import_site_media.py` (de generator, niet het gegenereerde bestand) en komen via
  `data/media_index.json` mee. `alt_source` heet daar nu `written`; de teller die vroeger op
  acht stond, staat op nul, en `pending` blijft bestaan voor de volgende afbeelding die de
  klant zonder beschrijving toevoegt.
* **Typografie.** De live site gebruikt Figtree via Google Fonts. Dat is hier bewust nog niet
  gezet: een lettertypenaam die geen enkele fontconfiguratie oplost laat een `null` achter in
  een Sass-fontstack, en dan compileert de hele frontend-bundel tot de bekende stub
  "A css error occured, using an old style" — voor élke website op deze instantie. Odoo's
  `google-local-fonts` kan de letter bovendien zelf binnenhalen en hosten (privacytechnisch de
  betere route), maar doet dan een uitgaand HTTP-verzoek tijdens de installatie. Allebei zijn
  in een browser te controleren en horen dus in de fase die een browser heeft. Tot dan draait
  de site op Odoo's eigen typografie.
* **`/feed/`** krijgt bewust geen 301 naar een HTML-pagina. Odoo Blog levert
  `/blog/<blog>/feed`, en dat adres bestaat pas als de blog is aangemaakt.
* **De twee nieuwsberichten** wijzen voorlopig door naar `/nieuws`. Zodra de blogberichten
  bestaan verzet `cs.prefab.website.urlmap._cs_prefab_set_redirect` ze naar het bericht zelf.

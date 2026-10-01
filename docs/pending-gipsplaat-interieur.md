# Openstaand: gipsplaat als fabrieksafwerking, op de wanden en rond de dagkant

**Gevraagd op 2026-09-17, en bewust UITGESTELD op verzoek van de klant** tot het websitewerk af en uitgerold is.
Niet beginnen voordat dat gebeurd is. Dit bestand is er zodat de eis intact blijft, niet om er nu aan te werken.

## Wat de klant zei, letterlijk

> "iceriden gorunumde sana alcipan dosenmis gorunum demistim tavanlarda biraz yapmissin ama duvarlarda yoktu. bunu
> tabi bizimkine gore cok daha gercekci bir gorunumle yapmani istemistim. stucwerk secilincede zaten bu gorunum
> degisiyor. ama fabrika cikisi bu sekilde verilir goruntusunu ozellikle gostermek istiyorum. ayrica sana oklarla
> sag sol ve ust alani ozellikle gosterdim cikintinin nasil gozuktugu ile alakali orasida dikkat edersen alcipanla
> dosenmis. musteri stucwerk secmezse bunu alacak."

## De eis, uitgeschreven

1. **De wanden missen het.** Het plafond heeft al iets van een gipsplaatpatroon; de wanden hebben het niet. Beide
   moeten het hebben.
2. **Realistischer dan wat er nu staat, maar RUSTIG.** De klant heeft dit op 2026-09-17 aangescherpt:
   *"vida izi olmasin, derz dolgu izi hafif belli olsun yeter"* -- GEEN schroefkoppen. Alleen de naad, en die
   alleen als een FLAUW spoor van de voegvulling. Dat is een andere opleveringsstaat dan mijn eerste versie hier
   beschreef: de platen zijn getapet en gevuld maar niet afgewerkt, precies wat een prefab in Nederland oplevert.
   Het beeld moet dus rustiger zijn dan een wand vol bevestigingspunten, niet drukker. Wat blijft: de platen
   liggen in een geloofwaardig verband en de wand is niet egaal.
3. **De dagkant telt mee.** De klant heeft met pijlen LINKS, RECHTS en BOVEN aangewezen: de teruglopende vlakken
   rond de pui, de zijkanten van de uitsparing. Op hun referentiebeeld zijn die net zo goed met plaat afgewerkt.
   Dat is precies de plek waar een half afgewerkt model door de mand valt.
4. **Wanneer het zichtbaar is.** Dit IS de oplevering zoals de fabriek hem levert: het is wat de klant krijgt als
   hij GEEN stucwerk kiest. Kiest hij wel stucwerk, dan verdwijnt dit beeld achter de stuclaag -- dat gedrag
   bestaat al en klopt. Het gaat er hier om dat de onafgewerkte staat expres goed te zien is.

## Waar het raakt

`addons/cs_prefab_configurator/static/src/preview.js`: `lining('gypsum')` is vandaag de afwerking wanneer
`m.plaster` onwaar is, en `makeExistingRoom`/de dagkantvlakken rond de pui zijn de plaatsen die volgens de klant
niet meedoen. Het bestaande verschil tussen `gypsum`, `plaster` en `painted` blijft zoals het is.

## Bewijs dat erbij hoort als het gedaan wordt

Renders op een echte GPU van het interieur ZONDER stucwerk, van binnen naar de pui toe, waarop de naad en de
dagkant allebei te zien zijn, naast dezelfde configuratie MET stucwerk om te laten zien dat die het netjes afdekt.
En een meting, geen oogopslag: de plaatmaat moet overeenkomen met wat er echt geleverd wordt, en het contrast van
de naad tegen het plaatvlak moet laag genoeg zijn om "hafif belli" te heten -- zichtbaar als je kijkt, niet als je
langsloopt. Een getal, vastgelegd met de andere rendermetingen, niet een indruk.


## Uitgevoerd op 2026-09-18 (release 2.10.0)

- **Waarom de wanden niets lieten zien:** elke wandnaad lag 4,5-7,5 mm van de constructiewand, en de plaat is 8 mm dik:
  de naden zaten IN de plaat. Het plafond had toevallig zijn naad onder het plaatvlak. Nu ligt elke band 0,5 mm voor
  het vlak waar hij op ligt (preview.js buildBoardJoints), getest en gemuteerd in interior_lining.test.mjs.
- **Geen schroefkoppen meer.** De InstancedMesh met koppen is weg.
- **Naad als gevulde band:** 5 cm breed, kleur #b9bab8 tegen plaat #c2c3c1, met dezelfde belichting als de plaat.
  De eerste versie gebruikte een kaal materiaal en renderde op de GPU als een WITTE lijn; nu gemeten op de render:
  **Delta E 2,78** (voegband tegen plaat, CIE76), net boven de 2,3 van een waarneembaar verschil.
- **Dagkant:** hoekprofielen links, rechts en boven de pui, gevuld op beide vlakken (6 banden).
- **Met stucwerk:** 0 naden, het stucbeeld dekt alles af. Renders: docs/verification/gipsplaat/.

# Toegankelijkheidscontrole

Gecontroleerd op 9 september 2026 met `@axe-core/playwright` 4.13.0 tegen de werkelijke lokale applicatie op `http://127.0.0.1:8078/prefab`. Gebruikte tags: WCAG 2 A, WCAG 2 AA en WCAG 2.1 AA. De browser hield de normale Content Security Policy aan. Alle netwerkverzoeken buiten de lokale server werden geblokkeerd; er zijn geen klantaanvragen opgeslagen of berichten verstuurd.

## Reproduceerbare controle

```bash
python3 scripts/serve.py --port 8078
node scripts/verify-accessibility.mjs
```

Een andere lokale server kan met `PREFAB_TEST_URL` worden ingesteld; een andere Chromium-binary met `CHROMIUM_PATH`. De runner ontdekt de lokaal geïnstalleerde Chromium en aanvullende bibliotheken waar beschikbaar. Het volledige resultaat staat in [accessibility-results.json](verification/accessibility-results.json); een eerdere afgeronde mislukte meting blijft bij een herhaling als `baseline` bewaard.

De controle omvat vijftien toestanden: alle zeven stappen op 1440×1000, de uitgeklapte binnenopties, het contactvenster, zichtbare fouten na een leeg contactformulier, de 2D-plattegrond, en op 390×844 de eerste stap, kozijn/dak, binnenopties en het contactvenster. Alleen de lege-formuliervalidatie wordt geactiveerd; er wordt geen geldig formulier verzonden.

## Eerste meting

De eerste meting vond één soort bevestigde overtreding: `color-contrast`, impact `serious`, in alle vijftien toestanden. In totaal waren er 310 voorkomens van onvoldoende contrasterende tekst; gedeelde elementen worden per toestand opnieuw geteld. Geen JavaScript-fouten en geen externe verzoeken werden geregistreerd.

| Onderdeel/selectorfamilie | Tekstkleur | Achtergrond | Gemeten verhouding |
|---|---|---|---:|
| Introductie / algemene gedempte tekst | `#797e75` | `#f6f5f1` | 3,80:1 |
| Inactieve stappen (`.step-tab`) | `#92968d` | `#f6f5f1` | 2,76:1 |
| Draaihint (`.rotate-hint`) | `#909184` | `#efeee7` | 2,74:1 |
| Voorbeeldnotitie (`.preview-bottom`) | `#8a8d7d` | `#f3f2eb` | 3,02:1 |
| Stapnummertekst (`.step-eyebrow`) | `#8b907c` | `#ffffff` | 3,29:1 |
| Maatgrenzen / eenheden | `#95998e` / `#979d8d` | `#ffffff` | 2,90 / 2,79:1 |
| Oppervlaktebijschrift (`.area-card`) | `#77896a` | `#f0f3e9` | 3,35:1 |
| Hulptekst (`.tip`) | `#8b8f81` | `#ffffff` | 3,31:1 |
| Keuze-uitleg (`.field-description`) | `#919787` | `#ffffff` | 3,00:1 |
| Prijsopbouwlink | `#a2a597` | `#fdfdfa` | 2,46:1 |
| Voettekst onder volgende stap | `#9da292` | `#fdfdfa` | 2,57:1 |
| Opslagstatus / algemene sitevoettekst | `#a0a294` / `#a1a499` | `#f6f5f1` | 2,37 / 2,32:1 |
| Binnenopties lege toestand | `#97a28b` | `#f7f9f2` | 2,51:1 |
| Samenvatting bijschriften | `#6d835d` | `#eff3e7` | 3,68:1 |
| Samenvatting labels / wijzigknoppen | `#8b9383` / `#8c9c7c` | `#ffffff` | 3,18 / 2,93:1 |
| Modal uitleg | `#7b8570` | `#ffffff` | 3,86:1 |
| Optioneel-label / formuliernotitie | `#9ba68e` / `#9ca68f` | `#ffffff` | 2,54:1 |
| Toestemmingstekst / privacylink | `#8a977b` / `#677f53` | `#ffffff` | 3,09 / 4,43:1 |

Voor deze kleine gewone teksten verwachtte axe minimaal 4,5:1. De concrete DOM-selectors, HTML en exacte berekening per voorkomen staan in de JSON. De aanbevolen correctie is een gedeelde donkerdere secundaire tekstkleur voor de betreffende families, met behoud van de actieve donkere knoppen en witte knoptekst.

## Bevindingen waarvoor beoordeling nodig is

Naast de bevestigde contrastproblemen rapporteerde axe de volgende onvolledige controles:

- `.segmented` had een `aria-label` op een `div` zonder benoembare rol. Deze knoppengroep kan met `role="group"` worden benoemd.
- De tekst `.preview-loading` bleef achter het geladen canvas bestaan. Na het laden hoort die laadmelding ook uit de toegankelijkheidsboom te verdwijnen.
- Enkele kleuren op de voorvertoning zijn automatisch niet meetbaar omdat canvas/SVG of overlappende elementen de achtergrond bepalen. De statische SVG-plattegrond heeft een titel, beschrijving en benoemd afbeeldingsdoel; dat vervangt geen handmatige beoordeling van leesbaarheid en betekenis.
- Axe classificeerde sommige enkele stapcijfers als te korte tekst voor een automatische beslissing. Ze gebruiken dezelfde kleur als de staplabels en horen dezelfde contrastcorrectie te krijgen.

Bij het uitwerken van de onvolledige SVG-controle bleek ook het label “BESTAANDE WONING” onvoldoende contrast te hebben: `#889284` op de expliciete SVG-achtergrond `#f1f0e9` gaf 2,831:1. Dit label is afzonderlijk gecorrigeerd naar `#626d59`. De runner controleert nu aanvullend alle vier SVG-teksten aan de hand van hun werkelijke `fill` en de expliciete achtergrondrechthoek; de berekeningen staan onder `explicitContrast` in de JSON.

Een geslaagde automatische herhaling is geen volledige WCAG-conformiteitsverklaring. Volledige beoordeling omvat ook het zelfstandig doorlopen met toetsenbord en schermlezer, vergroting en reflow, betekenis van de schematische beelden en begrijpelijkheid van validatiefouten. Interactie- en viewportcontroles staan afzonderlijk in de browserverificatie.

## Herhaling na correctie

De kleuren voor de betrokken tekstfamilies zijn aangepast naar de gedeelde secundaire tekstkleur `#626d59`; actieve knoppen behouden hun eigen kleuren. De weergaveknoppen hebben nu `role="group"` en de achtergebleven laadtekst is verwijderd bij het opbouwen van de preview.

De laatste herhaling op de werkelijke applicatie is afgerond: **vijftien van vijftien toestanden zonder bevestigde axe-overtredingen**, plus **vier van vier geslaagde aanvullende SVG-contrastcontroles**, geen JavaScript-fouten en geen externe netwerkverzoeken. Zowel het contactvenster met lege-formulierfouten als de mobiele binnenopties en 2D-plattegrond zijn opnieuw onderzocht. De oorspronkelijke 310 contrastvoorkomens zijn in de baseline van het JSON-rapport bewaard; de nieuwe `summary.violationCount` en `summary.explicitContrastFailures` zijn beide `0`.

De resterende `incomplete` items betreffen achtergrond-/SVG-bepaling rond de voorvertoning en de plattegrond. De vier teksten in de plattegrond zijn aanvullend op hun expliciete kleuren gecontroleerd. Voor de canvasachtergrond en overige overliggende elementen blijft automatische achtergrondbepaling een beperking, geen stilzwijgend toegekende goedkeuring. De eerder gemelde ARIA-rol en achtergebleven laadmelding komen in de herhaling niet terug.

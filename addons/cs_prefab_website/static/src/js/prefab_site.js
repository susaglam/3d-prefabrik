/**
 * Drie dingen die alleen met JavaScript kunnen, en verder niets.
 *
 * Dit bestand zit in web.assets_frontend, en die bundel is per INSTANTIE en niet per website.
 * Het wordt dus ook gedownload en uitgevoerd op de andere website van deze Odoo. Daarom is de
 * eerste regel van elke functie een controle op `.o_prefab_site`: daar valt hij meteen terug
 * en kost hij niets meer dan de paar honderd bytes die hij weegt.
 *
 * Bewust GEEN Odoo-modulemarkering bovenaan: dit bestand heeft geen enkele import nodig, en
 * een gewoon script kan niet omvallen doordat de modulegraaf ergens anders verandert. (De
 * markering staat hier ook niet als losse tekst, want de transpiler herkent hem aan het begin
 * van het bestand en zou het dan alsnog als module verpakken.)
 *
 * En één ding dat hier NIET meer staat: de onthulling bij het scrollen. Odoo 19.4 heeft die
 * zelf (`o_animate`, website.scss:2709-3055) en verbergt met CSS uit de renderblokkerende
 * bundel, dus vóór de eerste verf. De onze zette zijn klasse pas toen de lazy-bundel binnen
 * was, ruim ná de eerste verf: dertien secties werden getekend, verborgen en weer ingefade —
 * een flikkering, geen entree. En hij schreef een eigen attribuut IN de `oe_structure`, dus in
 * de inhoud die de bouwer opslaat. Welke secties een entree verdienen, is nu een keuze in de
 * bouwer en staat in de sjablonen, niet hier.
 *
 * De drie dingen:
 *
 * 1. DE HERO-VIDEO. Op de live site staat er `autoplay muted playsinline` op en GEEN poster.
 *    `preload="none"` staat er wel, maar autoplay overruled dat: Chrome haalt het hele bestand
 *    op en speelt af. Gemeten op een Pixel 7-profiel: 7,34 MB over de lijn binnen twaalf
 *    seconden, ongevraagd, bij het openen van de homepage. Hier staat er geen bron in de HTML;
 *    het script zet hem pas als het scherm breed genoeg is, de bezoeker niet om minder
 *    beweging heeft gevraagd en de telefoon niet in databesparing staat. Gebeurt dat niet, dan
 *    blijft het posterframe van 47 kB staan — en dat is de bedoelde uitkomst, geen storing.
 *    En zelfs als het wél gebeurt, gebeurt het PAS NA `load`: de video is de achtergrond van
 *    de hero en niet de hero, dus hij hoort niet mee te vechten om de bandbreedte van de
 *    eerste indruk. Zie heroVideo() voor de meting die daarachter zit.
 *
 * 1b. DE ENTREE VAN DE HERO. Eenmalig per bezoek, dus 720 ms. De stylesheet verbergt pas iets
 *    nadat dit script heeft vastgesteld dat het de entree kan afmaken — zie heroEnter().
 *
 * 2. DE VERGROTING IN DE GALERIJ. De klant vroeg erom: de projecten staan als galerij op de
 *    site en een foto moet groter te bekijken zijn. Elke miniatuur is en blijft een gewone
 *    link naar het volledige bestand — zonder dit script opent die de foto, en dat is een
 *    werkende pagina en geen kapotte knop. Mét dit script wordt de klik onderschept en opent
 *    de vergroting die al in de HTML staat: Escape sluit, de pijltjes bladeren, Tab blijft
 *    binnen het venster en de focus keert terug naar de miniatuur waar hij vandaan kwam.
 *
 * 3. DE PAUZEKNOP BIJ HET BEWEGENDE BEELDMERK. Wie om minder beweging heeft gevraagd, krijgt
 *    de animatie helemaal niet binnen — dat regelt de <picture> op /over-ons, en dat is de
 *    enige plek waar het kán, want een geanimeerde afbeelding is met geen enkele CSS-regel te
 *    stoppen. Voor alle anderen vraagt WCAG 2.2.2 om een manier om iets te stoppen dat vanzelf
 *    begint, langer dan vijf seconden beweegt en naast andere inhoud staat. Deze lus duurt
 *    tien seconden en herhaalt zich, dus die knop hoort er te zijn. Hij werkt door de `srcset`
 *    van de <source> om te wisselen naar het stilstaande beeld: een <img> in een <picture>
 *    luistert niet naar zijn eigen src, wél naar die van zijn bron.
 */
(function () {
    "use strict";

    function site() {
        return document.querySelector("body.o_prefab_site");
    }

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function motionAllowed() {
        // Drie voorwaarden die elke beweging hier stelt, één keer opgeschreven: dit is deze
        // site, het document is niet opslaanbaar, en er is niet om minder beweging gevraagd.
        // Twee kopieën van deze drie is precies de plek waar er ooit één uit elkaar gaat
        // lopen. Wat "opslaanbaar" betekent, staat bij isEditing().
        return !!site() && site().classList.contains("o_prefab_motion_enabled")
            && !isEditing() && !prefersReducedMotion();
    }

    function isEditing() {
        // De vraag die hier telt is niet "staat de bouwer open" maar "kan wat ik nu schrijf
        // straks worden OPGESLAGEN in de inhoud van de klant". Getoetst aan de 19.4-bron:
        //
        //   website/views/website_templates.xml:93-99 zet `data-editable="1"` op <html>,
        //   server-side; regel 84 doet hetzelfde met `data-edit_translations` voor de
        //   vertaalmodus. website/models/website.py:1574-1585 bepaalt die vlag en 1610-1626
        //   zet er `inherit_branding = True` op: een pagina MET dat attribuut draagt de
        //   bewerkmarkering en is precies het document dat naar arch_db terugvloeit; een
        //   pagina zonder kan nooit worden opgeslagen.
        //
        //   html_builder/static/src/builder.js:277 zet `editor_enable` op <body> — maar in
        //   `onMounted()`, dus NA DOMContentLoaded en dus na onze eerste lezing. Tweede
        //   sleutel voor aanroepen die later vallen, niet de eerste.
        //
        // Eruit: `editor_has_snippets` — nul voorkomens in de 19.4-bron, dat is Odoo 15 en
        // ouder. Hij stond hier als derde zekerheid en was er geen.
        //
        // De prijs, expliciet: een ingelogde beheerder die zijn eigen site bekijkt, krijgt
        // óók `data-editable` en ziet dus geen entree en geen vergroting. Dat is de goede
        // kant om fout te zitten — de bezoeker mist niets, de inhoud blijft schoon.
        var html = document.documentElement;
        return html.hasAttribute("data-editable")
            || html.hasAttribute("data-edit_translations")
            || document.body.classList.contains("editor_enable");
    }

    function connectionIsThin() {
        // Databesparing aan, of een verbinding die de browser zelf als traag aanmerkt. Een
        // achtergrondvideo van een megabyte is dan geen sfeer maar een rekening.
        var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!connection) {
            return false;
        }
        var slow = ["slow-2g", "2g", "3g"];
        return !!connection.saveData || slow.indexOf(connection.effectiveType) !== -1;
    }

    // ------------------------------------------------------------------
    // 1. De hero-video
    // ------------------------------------------------------------------

    function heroVideo() {
        var video = document.querySelector("body.o_prefab_site [data-prefab-hero-video]");
        if (!video) {
            return;
        }
        var source = video.getAttribute("data-prefab-hero-video");
        var wide = window.matchMedia && window.matchMedia("(min-width: 768px)").matches;
        if (!source || !wide || prefersReducedMotion() || connectionIsThin() || isEditing()) {
            return;
        }
        // `isEditing()` ontbrak hier als enige, en was de duurste. play() zet `src` en
        // `autoplay` op de <video> en hangt er een <button> bij, en de hero staat in
        // `oe_structure` — de regio die Odoo bij elke opslag naar arch_db serialiseert. Eén
        // bewerksessie op een breed scherm en die twee attributen staan voorgoed in de pagina
        // van de klant: vanaf dan krijgt iedere bezoeker die 7,34 MB alsnog. Het gebrek dat
        // dit bestand wegneemt, teruggezet door de bouwer, zonder melding.
        //
        // NA de eerste indruk, niet ervoor. De video is de ACHTERGROND van de hero; het
        // posterframe van 47 kB is wat de bezoeker als eerste ziet en het draagt de <h1>.
        // Zolang de bron meteen werd gezet, vocht een halve megabyte om dezelfde bandbreedte
        // als de foto's boven de vouw, en het gewicht van de eerste lading van de homepage
        // was 1.643 kB tegen een budget van 1.500. Uitgesteld tot na `load` en tot de browser
        // niets beters te doen heeft: dezelfde video, dezelfde lus, maar hij begint pas te
        // tellen als de pagina er al staat.
        var idle = function () {
            // Tweede sleutel, ánder faalpatroon: de controle hierboven keek op
            // DOMContentLoaded en `editor_enable` komt pas bij het monteren van de bouwer.
            // Daartussen zit hier `load` plus een idle-venster van twee seconden — ruim
            // genoeg. Dus vlak vóór de schrijf nog eens kijken; kost één attribuutlezing.
            var begin = function () {
                if (isEditing()) {
                    return;
                }
                play(video, source);
            };
            if (window.requestIdleCallback) {
                window.requestIdleCallback(begin, {timeout: 2000});
            } else {
                window.setTimeout(begin, 600);
            }
        };
        if (document.readyState === "complete") {
            idle();
        } else {
            window.addEventListener("load", idle, {once: true});
        }
    }

    function play(video, source) {
        video.setAttribute("src", source);
        video.setAttribute("autoplay", "autoplay");
        video.muted = true;
        var button = addPauseButton(video);
        var playing = video.play();
        if (playing && typeof playing.catch === "function") {
            // Een browser die weigert automatisch af te spelen is geen fout: het posterframe
            // blijft staan en de pagina is compleet. De knop moet dan wel het omgekeerde
            // zeggen — een knop die "pauzeer" zegt terwijl er niets speelt, is een leugen die
            // iemand een klik kost.
            playing.catch(function () {
                label(button, video);
            });
        }
        label(button, video);
    }

    // ------------------------------------------------------------------
    // 1b. De entree van de hero — EENMALIG PER BEZOEK
    // ------------------------------------------------------------------
    // Register: dit ziet één mens één keer per bezoek. 720 ms mag daarom, en de vier regels
    // mogen 90 ms na elkaar komen. De volgorde is de veilige: de stylesheet verbergt pas iets
    // NADAT dit script `o_prefab_hero_ready` op <body> heeft gezet, en het zet die klasse pas
    // nadat het de entree ook echt kan afmaken. Zonder JavaScript, in de bouwer, of met
    // "minder beweging" staat de hero er onmiddellijk — niet als een lege doos, maar compleet.
    // (Odoo's `o_animate` draait dit om en verbergt met CSS. Dat mag daar: die CSS en dat
    // script zitten in één bundel. Hier niet — deze klasse komt uit een bundel die uitblijft.)

    function heroEnter() {
        var hero = document.querySelector("body.o_prefab_site .o_prefab_hero");
        if (!hero || !motionAllowed()) {
            return;
        }
        // classList.add is idempotent, dus de twee wegen hieronder hebben geen vlag nodig.
        var show = function () { hero.classList.add("o_prefab_hero_entered"); };
        site().classList.add("o_prefab_hero_ready");
        // Twee frames: één om de verborgen begintoestand te laten landen, één om de overgang
        // erop te laten aangrijpen. Met één frame slaat de browser de transitie soms over.
        requestAnimationFrame(function () { requestAnimationFrame(show); });
        // En een tweede sleutel, met een ánder faalpatroon: requestAnimationFrame vuurt niet
        // in een tabblad dat op de achtergrond staat. Wie de pagina in een nieuw tabblad opent
        // en pas een minuut later kijkt, zou anders een hero zien die verborgen is gebleven —
        // de duurste fout die dit soort effect kan maken.
        window.setTimeout(show, 400);
    }

    function label(button, video) {
        if (button) {
            button.textContent = video.paused ? "Speel de video af" : "Pauzeer de video";
        }
    }

    function addPauseButton(video) {
        var hero = video.closest(".o_prefab_hero");
        if (!hero) {
            return null;
        }
        var existing = hero.querySelector(".o_prefab_hero_pause");
        if (existing) {
            return existing;
        }
        var button = document.createElement("button");
        button.type = "button";
        button.className = "o_prefab_hero_pause";
        button.textContent = "Pauzeer de video";
        button.addEventListener("click", function () {
            if (video.paused) {
                video.play();
            } else {
                video.pause();
            }
            label(button, video);
        });
        hero.appendChild(button);
        return button;
    }

    // ------------------------------------------------------------------
    // 2. De vergroting in de galerij
    // ------------------------------------------------------------------

    function lightbox() {
        var body = site();
        if (!body || isEditing()) {
            // In de bouwer niet: een klik op een foto moet daar de foto SELECTEREN.
            return;
        }
        var gallery = document.querySelector("[data-prefab-gallery]");
        var box = document.querySelector("[data-prefab-lightbox]");
        if (!gallery || !box) {
            return;
        }
        var shots = Array.prototype.slice.call(gallery.querySelectorAll("a.o_prefab_shot"));
        var image = box.querySelector(".o_prefab_lightbox_image");
        if (!shots.length || !image) {
            return;
        }
        var meta = box.querySelector(".o_prefab_lightbox_meta");
        var story = box.querySelector(".o_prefab_lightbox_story");
        var counter = box.querySelector(".o_prefab_lightbox_counter");
        var opener = null;
        var current = 0;

        function show(index) {
            // Rondlopen, niet vastlopen: wie bij de laatste foto nog een keer op het pijltje
            // drukt, verwacht de eerste en niet een dode knop.
            current = (index + shots.length) % shots.length;
            var shot = shots[current];
            var thumb = shot.querySelector("img");
            image.setAttribute("src", shot.getAttribute("href"));
            image.setAttribute("alt", (thumb && thumb.getAttribute("alt")) || "");
            meta.textContent = shot.getAttribute("data-prefab-meta") || "";
            story.textContent = shot.getAttribute("data-prefab-story") || "";
            // De teller staat in een aria-live-gebied. De alt van de foto verandert wél, maar
            // een schermlezer leest een gewijzigd alt-attribuut niet vanzelf opnieuw voor; dit
            // is wat "je bent nu bij foto 4" hoorbaar maakt.
            counter.textContent = "Foto " + (current + 1) + " van " + shots.length;
        }

        function open(index) {
            opener = shots[index];
            show(index);
            box.hidden = false;
            body.classList.add("o_prefab_lightbox_open");
            box.querySelector(".o_prefab_lightbox_close").focus();
        }

        function close() {
            box.hidden = true;
            body.classList.remove("o_prefab_lightbox_open");
            // De bron weghalen, anders houdt de browser een foto van 1600 px in het geheugen
            // voor een venster dat dicht is.
            image.removeAttribute("src");
            if (opener) {
                opener.focus();
                opener = null;
            }
        }

        function trap(event) {
            // De focus mag het venster niet verlaten zolang het open staat: daarbuiten ligt de
            // hele pagina, en wie met Tab de vergroting uit loopt komt zonder muis niet terug.
            var stops = box.querySelectorAll("button");
            var first = stops[0];
            var last = stops[stops.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        shots.forEach(function (shot, index) {
            shot.addEventListener("click", function (event) {
                // Een klik met een modificatietoets of met de middelste knop hoort de foto in
                // een nieuw tabblad te openen. Dat is precies waar de href voor staat, dus die
                // klik wordt met rust gelaten.
                if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    return;
                }
                event.preventDefault();
                open(index);
            });
        });

        box.addEventListener("click", function (event) {
            var target = event.target;
            if (!target || !target.closest) {
                return;
            }
            if (target.closest("[data-prefab-lightbox-close]")) {
                close();
                return;
            }
            var stepper = target.closest("[data-prefab-lightbox-step]");
            if (stepper) {
                show(current + Number(stepper.getAttribute("data-prefab-lightbox-step")));
            }
        });

        document.addEventListener("keydown", function (event) {
            if (box.hidden) {
                return;
            }
            if (event.key === "Escape") {
                close();
            } else if (event.key === "ArrowRight") {
                show(current + 1);
            } else if (event.key === "ArrowLeft") {
                show(current - 1);
            } else if (event.key === "Tab") {
                trap(event);
            }
        });
    }

    // ------------------------------------------------------------------
    // 3. De pauzeknop bij het bewegende beeldmerk
    // ------------------------------------------------------------------

    function brandMark() {
        var picture = document.querySelector("body.o_prefab_site [data-prefab-animation]");
        if (!picture || prefersReducedMotion() || isEditing()) {
            // Bij "minder beweging" staat er niets te bewegen: de <source> matcht dan niet en
            // de browser toont het stilstaande beeld. Een pauzeknop bij een stilstaand beeld is
            // een knop die niets doet.
            return;
        }
        var source = picture.querySelector("source");
        var still = picture.querySelector("img");
        if (!source || !still) {
            return;
        }
        var moving = source.getAttribute("srcset");
        var frozen = still.getAttribute("src");
        if (!moving || !frozen || moving === frozen) {
            return;
        }
        var button = document.createElement("button");
        button.type = "button";
        button.className = "o_prefab_animation_toggle";
        button.textContent = "Pauzeer de animatie";
        button.addEventListener("click", function () {
            var running = source.getAttribute("srcset") === moving;
            source.setAttribute("srcset", running ? frozen : moving);
            button.textContent = running ? "Speel de animatie af" : "Pauzeer de animatie";
        });
        picture.parentNode.appendChild(button);
    }

    function start() {
        if (!site()) {
            return;
        }
        heroEnter();
        heroVideo();
        lightbox();
        brandMark();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();

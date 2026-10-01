/**
 * Open every page of the rebuilt prefabpartner.nl in a real browser, at 1440 and 390 px, and
 * measure what it actually does.
 *
 * WHAT THIS GATE ANSWERS, per page and per width:
 *   - does it render, and how much does it weigh over the wire;
 *   - does axe-core report a violation (wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice);
 *   - exactly one <h1>, and no heading that skips a level on the way down;
 *   - an alt attribute on every <img> (an empty one counts: that is how you mark a decoration);
 *   - every internal href resolves to an address this site actually serves;
 *   - no <a href="#"> and no empty href -- the defect that today costs the customer leads on
 *     their best-ranking article;
 *   - the page fits at 390 px without a horizontal scrollbar;
 *   - the weight budgets the site audit wrote down are MET, not merely recorded.
 *
 * WHAT IT DOES NOT ANSWER. The pages come from scripts/preview_website.py, which renders this
 * module's own templates against this module's own stylesheet and the live web.assets_frontend
 * bundle. Odoo's theme, Odoo's editor and anything that only exists once the module is
 * installed are outside it, and that boundary is written into the preview script's docstring.
 *
 *   node scripts/verify-website.mjs              full run, writes screenshots
 *   PREFAB_NO_SCREENSHOTS=1 node ...             JSON only
 */
import {createServer} from 'node:http';
import {gzipSync} from 'node:zlib';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {AxeBuilder} from '@axe-core/playwright';

// Dezelfde vondst als in scripts/verify-browser.mjs: de geïnstalleerde build wisselt per
// machine, en de standaard van Playwright wijst hier naar een headless-shell die er niet is.
const CHROMIUM = process.env.CHROMIUM_PATH || [
    path.join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    path.join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    path.join(homedir(), '.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'),
].find(existsSync);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = path.join(ROOT, 'docs', 'verification', 'website', 'preview');
const SHOTS = path.join(ROOT, 'docs', 'verification', 'website');
const WIDTHS = [
    {name: '1440px', width: 1440, height: 960},
    {name: '390px', width: 390, height: 844},
];

// Elke route die deze site bedient, en het bestand dat hem in de voorbeeldweergave draagt.
const ROUTES = new Map([
    ['/', 'home.html'],
    ['/over-ons', 'over-ons.html'],
    ['/oplossingen', 'oplossingen.html'],
    ['/oplossingen/prefab-aanbouw', 'prefab-aanbouw.html'],
    ['/oplossingen/prefab-dakkapel', 'prefab-dakkapel.html'],
    ['/oplossingen/prefab-opbouw', 'prefab-opbouw.html'],
    ['/projecten', 'projecten.html'],
    ['/partner-worden', 'partner-worden.html'],
    ['/contact', 'contact.html'],
    ['/nieuws', 'nieuws.html'],
    ['/offerte', 'offerte.html'],
    ['/offerte-prefab-opbouw', 'offerte-prefab-opbouw.html'],
    // De twee nieuwsberichten. Ze zijn `blog.post` en geen `website.page`, en stonden daardoor
    // in geen enkele poort -- terwijl /voordelen-van-een-prefab-aanbouw het adres is dat op
    // "voordelen prefab aanbouw" binnenhaalt en de dode offerteknop droeg. Wat hier wordt
    // gemeten is de INHOUD van het bericht in de stylesheet van deze site; het blogsjabloon
    // eromheen is van Odoo en staat buiten de voorbeeldweergave (zie preview_website.py).
    ['/blog/nieuws-1/voordelen-van-een-prefab-aanbouw', 'blog-voordelen-van-een-prefab-aanbouw.html'],
    ['/blog/nieuws-1/onze-nieuwe-website-is-live', 'blog-onze-nieuwe-website-is-live.html'],
]);

// Adressen die deze site bedient maar die de voorbeeldweergave niet kan tonen: de
// configurator is een eigen toepassing en de blogberichten zijn Odoo Blog. Ze worden wél
// meegeteld als "bestaat", want dat is waar de linkcontrole naar vraagt.
const KNOWN_PREFIXES = ['/prefab', '/blog/', '/web/content/', '/web/image/',
    // De voorbeeldweergave serveert de bijlagen (de twee folders, de algemene voorwaarden)
    // vanaf /assets; in Odoo staan ze op /web/content/<xmlid>/<naam>.
    '/assets/'];

// Adressen waarvan de voorbeeldweergave niet kan bewijzen dat ze bestaan, met de reden.
// Alle drie horen bij de configurator, die een eigen module en een eigen toepassing is; de
// gate daarvoor is scripts/verify-embed.mjs.
const EXPECTED_404 = [/^\/prefab(\/|$)/, /^\/cs_prefab_configurator\//];

// Geen '/projecten/<iets>' meer: de galerij is één pagina. Een reeks foto's heeft geen eigen
// adres, want een adres is een naam en de bron draagt er geen.
const PAGES = [...ROUTES.keys()];

// De gewichtsbudgetten uit docs/website/site-audit.md (§5 en §14). Ze stonden tot nu toe
// alleen in het rapport en in de README; dit bestand MAT ze wel en TOETSTE ze niet, en een
// budget dat niets tegenhoudt is geen budget. De grenzen zijn letterlijk die van het rapport.
const BUDGET = {
    pageBytes: 2 * 1024 * 1024,          // "geen pagina boven 2 MB"
    homeFirstPaintBytes: 1.5 * 1024 * 1024, // "homepage onder 1,5 MB bij eerste lading"
    fileBytes: 500 * 1024,               // "geen los bestand boven 500 kB"
};

// De 500 kB geldt voor wat een pagina ONGEVRAAGD ophaalt, en er is bewust geen uitzonderings-
// lijst. De vier films (1,4-2,7 MB) en de twee gedrukte folders (1,9-2,0 MB) staan ruim boven
// die grens en vallen hier tóch niet op, omdat ze `preload="none"` en een posterframe dragen
// en dus pas over de lijn komen als de bezoeker zelf op afspelen of downloaden drukt. Dat is
// precies de eigenschap die deze regel bewaakt: gaat `preload="none"` ooit stuk, dan haalt de
// pagina twee megabyte binnen zonder dat iemand erom vroeg en valt de poort -- wat met een
// vrijstelling op bestandsnaam nooit zou gebeuren.

const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
    '.mp4': 'video/mp4', '.pdf': 'application/pdf',
};

function resolveRoute(pathname) {
    if (ROUTES.has(pathname)) {
        return ROUTES.get(pathname);
    }
    return null;
}

async function serve(notFound) {
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const route = resolveRoute(url.pathname);
        const relative = route || decodeURIComponent(url.pathname.replace(/^\//, ''));
        const file = path.join(PREVIEW, relative);
        if (!file.startsWith(PREVIEW) || !existsSync(file)) {
            notFound.push(url.pathname);
            response.writeHead(404, {'content-type': 'text/plain'});
            response.end('not found');
            return;
        }
        const body = await readFile(file);
        const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
        // Tekstbestanden gecomprimeerd, zoals een echte server ze uitserveert. Zonder dit is
        // elke pagina 1,1 MB zwaarder door de gedeelde Odoo-bundel alleen, en dan meet je het
        // gewicht van een situatie die niet bestaat.
        if (/text|javascript|json|svg/.test(type)) {
            const zipped = gzipSync(body);
            response.writeHead(200, {
                'content-type': type,
                'content-encoding': 'gzip',
                'content-length': zipped.length,
            });
            response.end(zipped);
            return;
        }
        response.writeHead(200, {'content-type': type, 'content-length': body.length});
        response.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {server, port: server.address().port};
}

/** Scroll the whole page so lazy images actually load, then come back to the top. */
async function scrollThrough(page) {
    await page.evaluate(async () => {
        const step = Math.max(320, window.innerHeight * 0.8);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 60));
        }
        window.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
}

/**
 * Let every scroll-reveal finish, and report any section that never arrives.
 *
 * WHY THIS IS HERE. The reveal is an IntersectionObserver effect: a section gets
 * `o_prefab_revealed` the moment it intersects, and is then unobserved. `scrollThrough()`
 * jumps in steps of about 0.8 viewport with 60 ms between them, and a section shorter than
 * one step can pass through entirely between two observer samples -- so it is never reported
 * as intersecting and stays at opacity 0. Then `fullPage` screenshots the whole document
 * with those sections still invisible.
 *
 * Measured on the homepage, 2026-09-17: `Informatiefolder` (641 px) and `Partner worden`
 * (797 px) at opacity 0 after scrollThrough, while `Laatste nieuws` (880 px) revealed. The
 * committed screenshot therefore showed 1.400 px of white above the footer -- two sections a
 * visitor really does see, because scrolling to them reveals them every time. The page was
 * fine; the EVIDENCE was wrong, which is worse than a failing check: it is a passing check
 * with a picture of a broken page next to it.
 *
 * This nudges each unrevealed section into view, waits out the 560 ms reveal, and returns
 * whatever is still not revealed. That list is a real finding: a section that stays hidden
 * even after being scrolled to is a section the visitor never reads.
 */
async function settleReveals(page) {
    return page.evaluate(async () => {
        const pending = () => [...document.querySelectorAll('[data-prefab-reveal]:not(.o_prefab_revealed)')];
        // Several passes, because one is a race. IntersectionObserver reports at frame
        // boundaries, so a section that is scrolled to and away again inside one sample can
        // be missed -- which made a single-pass version of this check report two homepage
        // sections on one run and none on the next. A gate that cries wolf gets switched off,
        // and then the real protection is gone with it, so the nudge repeats until the answer
        // stops changing. Three passes with a 200 ms dwell settled every page here; the
        // sections that survive all three are the finding.
        for (let pass = 0; pass < 3 && pending().length; pass += 1) {
            for (const section of pending()) {
                section.scrollIntoView({block: 'center'});
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }
        window.scrollTo(0, 0);
        // --prefab-dur-reveal is 560 ms; wait past it so the capture is not mid-transition.
        await new Promise((resolve) => setTimeout(resolve, 700));
        return pending()
            // A section with no layout box cannot be scrolled to and cannot intersect, so it
            // never reveals -- and that is correct rather than broken. The only one on this
            // site is the form's confirmation, which sits inside
            // `.s_website_form_end_message.d-none` until Odoo's form handler unhides it after
            // a successful submit; the observer is still watching it, so it fades in then.
            // Measured 2026-09-17 on /contact and /partner-worden: width 0, height 0, no
            // offsetParent, hidden ancestor `div.s_website_form_end_message.d-none`.
            .filter((section) => section.getBoundingClientRect().height > 0 && section.offsetParent)
            .map((section) =>
                section.getAttribute('data-name') || section.className.split(' ').slice(0, 2).join('.'));
    });
}

function headingProblems(headings) {
    const problems = [];
    const ones = headings.filter((h) => h.level === 1);
    if (ones.length !== 1) {
        problems.push(`${ones.length} maal <h1> (moet er precies één zijn): ${ones.map((h) => h.text).join(' | ')}`);
    }
    let previous = 0;
    for (const heading of headings) {
        if (previous && heading.level > previous + 1) {
            problems.push(`h${previous} -> h${heading.level} slaat een niveau over bij "${heading.text}"`);
        }
        previous = heading.level;
    }
    return problems;
}

async function main() {
    if (!existsSync(path.join(PREVIEW, 'home.html'))) {
        console.error('Geen voorbeeldweergave gevonden. Draai eerst: python scripts/preview_website.py');
        process.exit(1);
    }
    const notFound = [];
    const {server, port} = await serve(notFound);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({
        executablePath: CHROMIUM,
        headless: true,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    });
    const report = {base, pages: {}, failures: []};

    for (const {name: widthName, width, height} of WIDTHS) {
        const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1});
        for (const route of PAGES) {
            const page = await context.newPage();
            let transferred = 0;
            const requests = [];
            page.on('response', async (response) => {
                const length = Number(response.headers()['content-length'] || 0);
                transferred += length;
                requests.push({url: response.url().replace(base, ''), status: response.status(), bytes: length});
            });
            const consoleErrors = [];
            page.on('pageerror', (error) => consoleErrors.push(String(error)));

            const response = await page.goto(base + route, {waitUntil: 'load'});
            await page.waitForTimeout(400);
            // Het gewicht van de EERSTE indruk: alles wat de browser ophaalt zonder dat er is
            // gescrold. Dat is het getal waar het budget in het defectenrapport over gaat.
            const initialBytes = transferred;
            const initialRequests = requests.length;
            await scrollThrough(page);
            const unrevealed = await settleReveals(page);

            const measured = await page.evaluate(() => {
                const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => ({
                    level: Number(el.tagName.slice(1)),
                    text: (el.textContent || '').trim().slice(0, 60),
                }));
                const images = [...document.querySelectorAll('img')].map((el) => ({
                    src: el.getAttribute('src'),
                    alt: el.getAttribute('alt'),
                    natural: [el.naturalWidth, el.naturalHeight],
                    // `complete` scheidt "geprobeerd en mislukt" van "nog onderweg". Een
                    // loading="lazy"-foto die scrollThrough() net heeft aangezwengeld staat op
                    // complete=false met naturalWidth 0 -- dat is geen kapotte foto.
                    complete: el.complete,
                    rendered: [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)],
                }));
                const links = [...document.querySelectorAll('a[href]')].map((el) => ({
                    href: el.getAttribute('href'),
                    text: (el.textContent || '').trim().slice(0, 40),
                    submit: el.classList.contains('s_website_form_send'),
                }));
                // Wie veroorzaakt de horizontale overloop? Zonder die vraag te beantwoorden is
                // "de pagina is te breed" een melding waar je een halve dag op zoekt.
                const limit = window.innerWidth + 1;
                const widest = [...document.querySelectorAll('body *')]
                    .map((el) => ({el, box: el.getBoundingClientRect()}))
                    .filter((item) => item.box.right > limit || item.box.left < -1)
                    .slice(0, 6)
                    .map((item) => `${item.el.tagName.toLowerCase()}.${(item.el.className || '').toString().split(' ').slice(0, 2).join('.')} -> ${Math.round(item.box.left)}..${Math.round(item.box.right)}`);
                return {
                    headings,
                    images,
                    links,
                    widest,
                    title: document.title,
                    description: document.querySelector('meta[name="description"]')?.content || '',
                    ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
                    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                    scrollWidth: document.documentElement.scrollWidth,
                    landmarks: document.querySelectorAll('main,[role="main"]').length,
                };
            });

            const axe = await new AxeBuilder({page})
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
                .analyze();

            const key = `${route}@${widthName}`;
            const violations = axe.violations.map((v) => ({
                id: v.id, impact: v.impact, nodes: v.nodes.length,
                targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
            }));

            const brokenLinks = [];
            for (const link of measured.links) {
                const href = link.href || '';
                // De verzendknop van een Odoo-formulier IS een <a href="#"> met role="button":
                // de widget hangt eraan en er is geen native submit. Dat is Odoo's eigen
                // markup, geen dode knop, en het is de enige uitzondering hier.
                if (link.submit) {
                    continue;
                }
                if (href === '#' || href === '') {
                    brokenLinks.push(`leeg href op "${link.text}"`);
                    continue;
                }
                if (!href.startsWith('/')) {
                    continue;
                }
                const clean = href.split('?')[0].split('#')[0];
                if (resolveRoute(clean) || KNOWN_PREFIXES.some((p) => clean.startsWith(p))) {
                    continue;
                }
                brokenLinks.push(`${href} (van "${link.text}")`);
            }

            const missingAlt = measured.images.filter((i) => i.alt === null).map((i) => i.src);
            // Een SVG zonder intrinsieke afmetingen meldt naturalWidth 0 terwijl hij prima
            // geladen is; de echte bron van waarheid voor "laadt niet" is de 404-lijst van de
            // server, en die wordt apart bijgehouden.
            // Een foto in een niet-actieve carrouselslide staat op display:none en wordt nooit
            // opgehaald -- terecht. Alleen wat de bezoeker daadwerkelijk krijgt te zien telt.
            // `complete` erbij, 2026-09-17: zonder die voorwaarde meldde deze gate ongeveer één
            // run op de vier een geldige, correct gedimensioneerde WebP als "laadt niet" --
            // scrollThrough() had de lazy-foto net aangezwengeld en het verzoek was nog
            // onderweg. De 404-lijst van de server bleef leeg, wat de tegenspraak liet zien.
            // Een gate die loos alarm slaat wordt uitgezet, en dan is ook de echte bescherming
            // weg; `complete` is bij een MISLUKTE lading wél true, dus de echte controle blijft.
            const brokenImages = measured.images
                .filter((i) => i.rendered[0] > 0 && i.complete && i.natural[0] === 0
                    && !(i.src || '').endsWith('.svg'))
                .map((i) => i.src);
            // SVG's zijn vectoren: "te groot geleverd" bestaat daar niet.
            const oversized = measured.images.filter((i) =>
                i.rendered[0] > 0 && !(i.src || '').endsWith('.svg')
                && i.natural[0] > i.rendered[0] * 2.2).map((i) =>
                `${i.src} ${i.natural.join('x')} getoond op ${i.rendered.join('x')}`);

            report.pages[key] = {
                status: response.status(),
                bytesFirstPaint: initialBytes,
                requestsFirstPaint: initialRequests,
                bytes: transferred,
                requests: requests.length,
                title: measured.title,
                description: measured.description,
                descriptionLength: measured.description.length,
                ogImage: measured.ogImage,
                mainLandmarks: measured.landmarks,
                headings: measured.headings.length,
                axeViolations: violations,
                headingProblems: headingProblems(measured.headings),
                missingAlt,
                brokenImages,
                oversizedImages: oversized,
                brokenLinks,
                horizontalOverflow: measured.overflow,
                widestElements: measured.widest,
                unrevealedSections: unrevealed,
                notFound: requests.filter((r) => r.status === 404)
                    .map((r) => r.url)
                    .filter((url) => !EXPECTED_404.some((pattern) => pattern.test(url))),
                expectedMissing: requests.filter((r) => r.status === 404)
                    .map((r) => r.url)
                    .filter((url) => EXPECTED_404.some((pattern) => pattern.test(url))),
                pageErrors: consoleErrors,
            };

            const fail = (message) => report.failures.push(`${key}: ${message}`);
            if (response.status() !== 200) fail(`status ${response.status()}`);
            violations.forEach((v) => fail(`axe ${v.id} (${v.impact}) op ${v.nodes} knoop(en)`));
            report.pages[key].headingProblems.forEach(fail);
            missingAlt.forEach((src) => fail(`afbeelding zonder alt: ${src}`));
            brokenImages.forEach((src) => fail(`afbeelding laadt niet: ${src}`));
            report.pages[key].notFound.forEach((url) => fail(`404 op ${url}`));
            brokenLinks.forEach((problem) => fail(`link gaat nergens heen: ${problem}`));
            if (measured.overflow) {
                fail(`horizontale overloop (${measured.scrollWidth}px): ${measured.widest.join(' | ')}`);
            }
            if (measured.landmarks !== 1) fail(`${measured.landmarks} main-landmark(s), moet er 1 zijn`);
            consoleErrors.forEach((error) => fail(`scriptfout: ${error}`));
            unrevealed.forEach((name) =>
                fail(`sectie blijft onzichtbaar, ook na ernaartoe scrollen: ${name}`));

            // De budgetten van het defectenrapport, als poort in plaats van als notitie.
            const kB = (bytes) => `${Math.round(bytes / 1024)} kB`;
            if (transferred > BUDGET.pageBytes) {
                fail(`pagina weegt ${kB(transferred)}, budget is ${kB(BUDGET.pageBytes)} (site-audit §5)`);
            }
            if (route === '/' && initialBytes > BUDGET.homeFirstPaintBytes) {
                fail(`homepage haalt ${kB(initialBytes)} op bij de eerste lading, `
                    + `budget is ${kB(BUDGET.homeFirstPaintBytes)} (site-audit §14)`);
            }
            // Alles wat de pagina uit zichzelf ophaalt, ook wat pas bij het scrollen komt.
            // Een film die de bezoeker zelf start staat niet in deze lijst, want er is in
            // deze run niemand die op afspelen drukt -- en dat is de hele bedoeling.
            requests.filter((r) => r.bytes > BUDGET.fileBytes)
                .forEach((r) => fail(`los bestand ${kB(r.bytes)} boven het plafond van `
                    + `${kB(BUDGET.fileBytes)}: ${r.url} (site-audit §5)`));

            if (!process.env.PREFAB_NO_SCREENSHOTS) {
                const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
                await mkdir(SHOTS, {recursive: true});
                // JPEG en geen PNG: een paginavullende opname van een pagina van achtduizend
                // pixels hoog is als PNG twee tot vijf megabyte, en zesentwintig daarvan zijn
                // vierendertig megabyte bewijsmateriaal in een repository. Op kwaliteit 85 is
                // het verschil op deze opnamen niet te zien en weegt de hele set een tiende.
                await page.screenshot({
                    path: path.join(SHOTS, `${slug}-${widthName}.jpg`),
                    type: 'jpeg',
                    quality: 85,
                    fullPage: true,
                });
            }
            await page.close();
        }
        await context.close();
    }

    await browser.close();
    server.close();

    await mkdir(SHOTS, {recursive: true});
    await writeFile(path.join(SHOTS, 'website-results.json'), JSON.stringify(report, null, 2), 'utf8');

    const heaviest = Object.entries(report.pages)
        .sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 5)
        .map(([key, value]) => `${key} ${(value.bytes / 1024).toFixed(0)} kB`);
    console.log('Zwaarste pagina\'s: ' + heaviest.join(', '));
    if (report.failures.length) {
        console.error(`\n${report.failures.length} bevinding(en):`);
        report.failures.forEach((failure) => console.error('  - ' + failure));
        process.exit(1);
    }
    console.log(`\nOK: ${Object.keys(report.pages).length} paginaweergaven zonder bevindingen.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

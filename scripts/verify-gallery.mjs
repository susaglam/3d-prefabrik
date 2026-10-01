/**
 * De twee dingen aan deze site die alleen een echte browser kan beantwoorden, en die
 * scripts/verify-website.mjs niet stelt omdat het daar om de PAGINA gaat en hier om GEDRAG.
 *
 * 1. DE VERGROTING IN DE GALERIJ. De klant vroeg erom: de projecten staan als galerij op de
 *    site en een foto moet groter te bekijken zijn. Een vergroting die met de muis werkt en
 *    met het toetsenbord niet, is half af — en dat is precies de helft die niemand probeert.
 *    Hier wordt hij geopend, doorgebladerd, met Tab rondgelopen en met Escape gesloten, en
 *    daarna nog een keer met JavaScript UIT, want zonder script hoort de miniatuur een gewone
 *    link naar de foto te zijn en niet een dode klik.
 *
 * 2. HET BEWEGENDE BEELDMERK OP /over-ons. Een geanimeerde afbeelding is met geen enkele
 *    CSS-regel te stoppen; de <picture> met `media="(prefers-reduced-motion: no-preference)"`
 *    lost het bij de DOWNLOAD op. Dat is een bewering over wat de browser wel en niet ophaalt,
 *    en die is alleen te toetsen door mee te kijken met het netwerk. Beide kanten worden
 *    gemeten: met de voorkeur aan hoort de animatie van 215 kB er NIET te zijn en het
 *    stilstaande beeld van 2,9 kB wel, en andersom.
 *
 * Draait op dezelfde voorbeeldweergave als verify-website.mjs:
 *     python scripts/preview_website.py && node scripts/verify-gallery.mjs
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

// Dezelfde vondst als in scripts/verify-browser.mjs: de geïnstalleerde build wisselt per
// machine, en de standaard van Playwright wijst hier naar een headless-shell die er niet is.
const CHROMIUM = process.env.CHROMIUM_PATH || [
    path.join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    path.join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
    path.join(homedir(), '.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'),
].find(existsSync);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = path.join(ROOT, 'docs', 'verification', 'website', 'preview');

const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
    '.mp4': 'video/mp4', '.pdf': 'application/pdf',
};
const ROUTES = new Map([['/projecten', 'projecten.html'], ['/over-ons', 'over-ons.html']]);

const findings = [];
const results = [];

function check(name, ok, detail) {
    results.push(`${ok ? 'ok  ' : 'FOUT'}  ${name}${detail ? '  ::  ' + detail : ''}`);
    if (!ok) {
        findings.push(`${name}${detail ? ' :: ' + detail : ''}`);
    }
}

async function serve() {
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const relative = ROUTES.get(url.pathname)
            || decodeURIComponent(url.pathname.replace(/^\//, ''));
        const file = path.join(PREVIEW, relative);
        if (!file.startsWith(PREVIEW) || !existsSync(file)) {
            response.writeHead(404, {'content-type': 'text/plain'});
            response.end('not found');
            return;
        }
        const body = await readFile(file);
        response.writeHead(200, {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        });
        response.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {server, port: server.address().port};
}

async function theLightbox(browser, base) {
    const context = await browser.newContext({viewport: {width: 1440, height: 960}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(base + '/projecten', {waitUntil: 'load'});

    const box = page.locator('[data-prefab-lightbox]');
    const counter = page.locator('.o_prefab_lightbox_counter');
    const shots = page.locator('a.o_prefab_shot');

    check('het venster begint dicht', await box.isHidden());
    const count = await shots.count();
    check('de 36 foto\'s van de oude galerij staan er', count === 36, String(count));

    await shots.nth(10).click();
    await page.waitForTimeout(200);
    check('een klik opent het venster', await box.isVisible());
    // 🪤 De controle die de echte fout ving. `will-change: transform` op de onthullingssecties
    // maakt van elke sectie een containing block voor `position: fixed`; het venster stond
    // daardoor over de GALERIJ in plaats van over de pagina, met de foto buiten beeld. Het
    // venster was zichtbaar, de knoppen deden het, de toetsen deden het — alleen was er niets
    // te zien. Alleen een meting van de afmeting laat dat zien.
    const frame = await box.boundingBox();
    const viewport = page.viewportSize();
    check('het venster bedekt het hele scherm',
        frame && Math.round(frame.width) >= viewport.width
        && Math.round(frame.height) >= viewport.height && Math.round(frame.y) <= 0,
        JSON.stringify(frame));
    const photo = await page.locator('.o_prefab_lightbox_image').boundingBox();
    check('de vergrote foto staat in beeld',
        photo && photo.y >= 0 && photo.y + photo.height <= viewport.height
        && photo.width > 200 && photo.height > 200,
        JSON.stringify(photo));
    check('de focus springt het venster in', await page.evaluate(
        () => (document.activeElement.className || '').includes('o_prefab_lightbox_close')));
    check('de teller zegt welke foto dit is',
        (await counter.textContent()).trim() === 'Foto 11 van 36',
        (await counter.textContent()).trim());
    check('de plaats uit de bron staat in het bijschrift',
        (await page.locator('.o_prefab_lightbox_meta').textContent()).trim() === 'Den Haag');
    const alt = await page.locator('.o_prefab_lightbox_image').getAttribute('alt');
    check('de vergrote foto draagt de beschrijving van de miniatuur',
        (alt || '').length > 20, alt);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
    check('pijltje rechts bladert vooruit',
        (await counter.textContent()).trim() === 'Foto 12 van 36',
        (await counter.textContent()).trim());
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(120);
    check('pijltje links bladert terug',
        (await counter.textContent()).trim() === 'Foto 10 van 36',
        (await counter.textContent()).trim());

    // Drie knoppen: drie keer Tab hoort de focus binnen het venster te houden en niet op de
    // pagina erachter te laten weglopen.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
    const parked = await page.evaluate(() => document.activeElement.className || '');
    check('Tab loopt niet uit het venster weg', parked.includes('o_prefab_lightbox'), parked);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check('Escape sluit', await box.isHidden());
    check('de focus keert terug naar de miniatuur', await page.evaluate(
        () => document.activeElement.classList.contains('o_prefab_shot')));
    check('de vergroting laat de foto van 1600 px weer los',
        await page.locator('.o_prefab_lightbox_image').getAttribute('src') === null);

    await shots.nth(0).click();
    await page.waitForTimeout(120);
    // Met de muis in de hoek en niet in het midden: in het midden staat de foto, en daarop
    // klikken hoort NIETS te doen. Dat onderscheid is de hele waarde van deze controle.
    await page.mouse.click(20, 20);
    await page.waitForTimeout(150);
    check('een klik naast de foto sluit ook', await box.isHidden());
    await shots.nth(0).click();
    await page.waitForTimeout(120);
    await page.locator('.o_prefab_lightbox_image').click();
    await page.waitForTimeout(150);
    check('een klik OP de foto sluit niet', await box.isVisible());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);

    check('geen scriptfouten op de galerij', errors.length === 0, errors.join(' | '));
    await context.close();
}

async function withoutJavaScript(browser, base) {
    const context = await browser.newContext({
        viewport: {width: 1440, height: 960}, javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto(base + '/projecten', {waitUntil: 'load'});
    check('zonder script blijft het venster dicht',
        await page.locator('[data-prefab-lightbox]').isHidden());
    const href = await page.locator('a.o_prefab_shot').first().getAttribute('href');
    // In Odoo is dat /web/image/<id>/image/1600x1600; de voorbeeldweergave schrijft datzelfde
    // verzoek naar een bestand in /assets. Waar het om gaat is dat de link naar de GROTE foto
    // wijst en niet naar de miniatuur.
    check('zonder script is elke miniatuur een link naar de foto zelf',
        /1600x1600/.test(href || ''), href);
    await context.close();
}

async function theBrandMark(browser, base, reducedMotion) {
    const context = await browser.newContext({viewport: {width: 1440, height: 960}, reducedMotion});
    const page = await context.newPage();
    const asked = [];
    page.on('request', (request) => asked.push(request.url()));
    await page.goto(base + '/over-ons', {waitUntil: 'load'});
    // Het beeldmerk staat onder de vouw en laadt lui; zonder scrollen meet je niets.
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(700);

    const animated = asked.filter((url) => /logo-2\.webp/.test(url)).length;
    const still = asked.filter((url) => /logo-2-still\.webp/.test(url)).length;
    const button = page.locator('.o_prefab_animation_toggle');

    if (reducedMotion === 'reduce') {
        check('minder beweging: de animatie wordt NIET opgehaald', animated === 0,
            `${animated} verzoek(en)`);
        check('minder beweging: het stilstaande beeld wel', still === 1, `${still} verzoek(en)`);
        check('minder beweging: geen pauzeknop bij een stilstaand beeld',
            await button.count() === 0);
    } else {
        check('geen voorkeur: de animatie wordt opgehaald', animated === 1,
            `${animated} verzoek(en)`);
        check('geen voorkeur: het stilstaande beeld NIET', still === 0, `${still} verzoek(en)`);
        check('geen voorkeur: er staat een pauzeknop', await button.count() === 1);
        if (await button.count() === 1) {
            const before = (await button.textContent()).trim();
            await button.click();
            await page.waitForTimeout(300);
            const after = (await button.textContent()).trim();
            const srcset = await page.locator('[data-prefab-animation] source').getAttribute('srcset');
            check('de pauzeknop bevriest het beeldmerk',
                /logo-2-still/.test(srcset || '') && before !== after,
                `${before} -> ${after}  ::  ${srcset}`);
        }
    }
    await context.close();
}

async function main() {
    if (!existsSync(path.join(PREVIEW, 'projecten.html'))) {
        console.error('Geen voorbeeldweergave gevonden. Draai eerst: python scripts/preview_website.py');
        process.exit(1);
    }
    const {server, port} = await serve();
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({
        executablePath: CHROMIUM,
        headless: true,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    });
    try {
        await theLightbox(browser, base);
        await withoutJavaScript(browser, base);
        await theBrandMark(browser, base, 'no-preference');
        await theBrandMark(browser, base, 'reduce');
    } finally {
        await browser.close();
        server.close();
    }
    results.forEach((line) => console.log('  ' + line));
    if (findings.length) {
        console.error(`\n${findings.length} bevinding(en).`);
        process.exit(1);
    }
    console.log(`\nOK: ${results.length} controles op de galerij en het beeldmerk.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

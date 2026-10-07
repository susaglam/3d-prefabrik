// Browser proof of "Je ontwerp staat klaar" (2.18.0, docs/resume-card-contract.md) on the WEBSITE: with a resume
// card the bar appears on a site page with the visitor's own total, its arrow goes to the card's url, the × keeps it
// away on the next page load, the offerte page that carries the configurator never shows it, and without a card there
// is no bar. 2.18.1: it never covers the cookie notice (it waits until the notice is answered) nor the WhatsApp button
// in the same corner, on a desktop and on a phone.
// Needs the Odoo website, so it runs against an origin: PREFAB_ORIGIN=https://... node scripts/verify-resume-bar.mjs
// Before a deploy, PREFAB_CANDIDATE_CSS=<resume_bar.scss compiled by libsass> runs the same proof with the LOCAL
// resume_bar.js (or PREFAB_CANDIDATE_JS) and that CSS in place of their segments in the served bundles; the cookie
// notice, the WhatsApp button and their timing stay the live site's own.
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const origin = process.env.PREFAB_ORIGIN;
if (!origin) { console.error('Set PREFAB_ORIGIN to the website, e.g. https://prefabpartner.codesnap.nl'); process.exit(2); }
const candidate = process.env.PREFAB_CANDIDATE_CSS ? {
  css: readFileSync(process.env.PREFAB_CANDIDATE_CSS, 'utf8'),
  js: readFileSync(process.env.PREFAB_CANDIDATE_JS || 'addons/cs_prefab_website/static/src/js/resume_bar.js', 'utf8'),
} : null;
/** Replace one file's segment of an Odoo bundle (from its header comment to the next one) by `replacement`. */
function swapSegment(body, header, replacement) {
  const start = body.indexOf(header);
  if (start < 0 || body.indexOf(header, start + 1) >= 0) throw new Error(`candidate: ${header} is not in the bundle exactly once`);
  const next = body.indexOf('\n/* /', start + header.length);
  return body.slice(0, start) + replacement + (next < 0 ? '' : body.slice(next));
}
async function useCandidate(context) {
  const serve = (pattern, header, replacement) => context.route(pattern, async route => {
    const response = await route.fetch();
    const headers = Object.fromEntries(Object.entries(response.headers())
      .filter(([name]) => !['content-length', 'content-encoding', 'transfer-encoding'].includes(name.toLowerCase())));
    await route.fulfill({status: response.status(), headers, body: swapSegment(await response.text(), header, replacement)});
  });
  const js = '/* /cs_prefab_website/static/src/js/resume_bar.js */', css = '/* /cs_prefab_website/static/src/scss/resume_bar.scss */';
  // The same wrapper Odoo 19 puts around every file of a bundle (since 18 a file is a module without any marker).
  await serve(/\/web\/assets\/[^?]+\/web\.assets_frontend_lazy\.min\.js/, js,
    `${js}\nodoo.define('@cs_prefab_website/js/resume_bar',[],function(require){'use strict';let __exports={};\n${candidate.js}\nreturn __exports;});;\n`);
  await serve(/\/web\/assets\/[^?]+\/web\.assets_frontend\.min\.css/, css, `${css}\n${candidate.css}\n`);
}
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
const problems = [], facts = {};
const check = (ok, message) => { if (!ok) problems.push(message); };
const cookieShown = page => page.evaluate(() => !!document.querySelector('#website_cookies_bar .modal.show, .modal.o_cookies_discrete.show'));
async function answerCookies(page) {
  // A visitor answers the cookie notice; the bar only comes after that, so the proof answers it too.
  const buttons = page.locator('#website_cookies_bar .modal.show button, #website_cookies_bar .modal.show a.btn');
  if (await buttons.count()) { await buttons.last().click().catch(() => {}); await page.waitForTimeout(600); }
}
const rects = page => page.evaluate(() => {
  const box = el => el ? (r => ({left: r.left, top: r.top, right: r.right, bottom: r.bottom}))(el.getBoundingClientRect()) : null;
  return {bar: box(document.querySelector('.cs-resume-bar')), chat: box(document.querySelector('.o_prefab_whatsapp')), width: innerWidth, height: innerHeight};
});
const overlap = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const card = revision => ({label: 'Aanbouw', url: '/prefab', total: 7557000, revision, savedAt: new Date().toISOString()});
try {
  for (const [name, viewport] of [['desktop', {width: 1440, height: 900}], ['phone', {width: 390, height: 844}]]) {
    const context = await browser.newContext({viewport});
    if (candidate) await useCandidate(context);
    const page = await context.newPage();
    await page.goto(`${origin}/`, {waitUntil: 'networkidle', timeout: 90000});
    const body = await page.evaluate(() => ({site: document.body.classList.contains('o_prefab_site'), revision: document.body.getAttribute('data-cs-resume')}));
    facts[name] = {body};
    check(body.site, `${name}: the home page is not marked o_prefab_site`);
    check(body.revision !== null, `${name}: Vormgeving → Doorgaan-melding tonen is off or the layout lost data-cs-resume`);
    check(await page.locator('.cs-resume-bar').count() === 0, `${name}: a bar without any card`);
    await page.evaluate(card => { localStorage.removeItem('cs-resume-dismissed-v1'); localStorage.setItem('cs-resume-v1', JSON.stringify({aanbouw: card})); }, card(body.revision));
    await page.reload({waitUntil: 'networkidle'});
    await page.waitForTimeout(1800);
    if (await cookieShown(page)) {
      facts[name].barWhileCookieNotice = await page.locator('.cs-resume-bar').count();
      check(facts[name].barWhileCookieNotice === 0, `${name}: the bar came while the cookie notice was still open`);
      await answerCookies(page);
    }
    await page.waitForSelector('.cs-resume-bar.is-visible', {timeout: 8000}).catch(() => {});
    const shown = await page.evaluate(() => { const bar = document.querySelector('.cs-resume-bar'); return bar ? {text: bar.innerText.replace(/\s+/g, ' ').trim(), href: bar.querySelector('a')?.getAttribute('href'), visible: bar.classList.contains('is-visible')} : null; });
    const where = await rects(page);
    facts[name].shown = shown;
    facts[name].rects = where;
    check(shown?.visible, `${name}: with a card the bar did not appear`);
    check(shown?.text.includes('Je ontwerp staat klaar') && /Aanbouw · € 75\.570/.test(shown?.text || ''), `${name}: the bar does not read title, product and total (${shown?.text})`);
    check(shown?.href === '/prefab', `${name}: the arrow does not go to the card url`);
    check(!overlap(where.bar, where.chat), `${name}: the bar covers the WhatsApp button`);
    check(where.bar && where.bar.left >= 0 && where.bar.right <= where.width && where.bar.bottom <= where.height, `${name}: the bar leaves the screen`);
    await page.screenshot({path: join('docs', 'verification', `resume-bar-${name}.png`)});
    if (name === 'desktop') {
      // A card priced on another catalogue shows the product alone.
      await page.evaluate(card => localStorage.setItem('cs-resume-v1', JSON.stringify({aanbouw: {...card, revision: 'an-older-catalogue'}})), card(body.revision));
      await page.reload({waitUntil: 'networkidle'});
      await page.waitForSelector('.cs-resume-bar.is-visible', {timeout: 8000}).catch(() => {});
      facts.stale = await page.evaluate(() => document.querySelector('.cs-resume-bar')?.innerText.replace(/\s+/g, ' ').trim() || null);
      check(facts.stale && !facts.stale.includes('€'), `a total from another catalogue was shown (${facts.stale})`);
      // The × keeps it away on the next page.
      await page.click('.cs-resume-bar__close');
      await page.reload({waitUntil: 'networkidle'});
      await page.waitForTimeout(1500);
      facts.afterDismiss = await page.locator('.cs-resume-bar').count();
      check(facts.afterDismiss === 0, 'the × did not keep the bar away');
      // The page that carries the configurator never shows it.
      await page.evaluate(card => { localStorage.removeItem('cs-resume-dismissed-v1'); localStorage.setItem('cs-resume-v1', JSON.stringify({aanbouw: card})); }, card(body.revision));
      await page.goto(`${origin}/offerte`, {waitUntil: 'networkidle', timeout: 90000});
      await page.waitForTimeout(1500);
      facts.onOfferte = await page.locator('.cs-resume-bar').count();
      check(facts.onOfferte === 0, 'the bar appeared on the offerte page next to the configurator');
    }
    await page.evaluate(() => { localStorage.removeItem('cs-resume-v1'); localStorage.removeItem('cs-resume-dismissed-v1'); });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({candidate: candidate ? (process.env.PREFAB_CANDIDATE_JS || 'local resume_bar.js') + ' + ' + process.env.PREFAB_CANDIDATE_CSS : null, facts, problems}, null, 1));
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'resume bar: after the cookie notice, beside the WhatsApp button, with the visitor\'s own total, label only on an older catalogue, the × holds, never next to the configurator');
process.exit(problems.length ? 1 : 0);

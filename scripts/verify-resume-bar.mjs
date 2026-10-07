// Browser proof of "Je ontwerp staat klaar" (2.18.0, docs/resume-card-contract.md) on the WEBSITE: with a resume
// card the bar appears on a site page with the visitor's own total, its arrow goes to the card's url, the × keeps it
// away on the next page load, the offerte page that carries the configurator never shows it, and without a card there
// is no bar. Needs the Odoo website, so it runs against an origin: PREFAB_ORIGIN=https://... node scripts/verify-resume-bar.mjs
import {chromium} from '@playwright/test';
import {homedir} from 'node:os';
import {join} from 'node:path';

const origin = process.env.PREFAB_ORIGIN;
if (!origin) { console.error('Set PREFAB_ORIGIN to the website, e.g. https://prefabpartner.codesnap.nl'); process.exit(2); }
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
const problems = [], facts = {};
const check = (ok, message) => { if (!ok) problems.push(message); };
async function answerCookies(page) {
  // The bar waits for the cookie notice (resume_bar.js); a visitor answers it, so the proof does too.
  const buttons = page.locator('#website_cookies_bar button, #website_cookies_bar a.btn');
  if (await buttons.count()) { await buttons.last().click().catch(() => {}); await page.waitForTimeout(400); }
}
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  const page = await context.newPage();
  await page.goto(`${origin}/`, {waitUntil: 'networkidle', timeout: 90000});
  await answerCookies(page);
  const body = await page.evaluate(() => ({site: document.body.classList.contains('o_prefab_site'), revision: document.body.getAttribute('data-cs-resume')}));
  facts.body = body;
  check(body.site, 'the home page is not marked o_prefab_site');
  check(body.revision !== null, 'Vormgeving → Doorgaan-melding tonen is off or the layout lost data-cs-resume');
  check(await page.locator('.cs-resume-bar').count() === 0, 'a bar without any card');
  const card = {label: 'Aanbouw', url: '/prefab', total: 7557000, revision: body.revision, savedAt: new Date().toISOString()};
  await page.evaluate(card => { localStorage.removeItem('cs-resume-dismissed-v1'); localStorage.setItem('cs-resume-v1', JSON.stringify({aanbouw: card})); }, card);
  await page.reload({waitUntil: 'networkidle'});
  await page.waitForSelector('.cs-resume-bar.is-visible', {timeout: 8000}).catch(() => {});
  const shown = await page.evaluate(() => { const bar = document.querySelector('.cs-resume-bar'); return bar ? {text: bar.innerText.replace(/\s+/g, ' ').trim(), href: bar.querySelector('a')?.getAttribute('href'), visible: bar.classList.contains('is-visible')} : null; });
  facts.shown = shown;
  check(shown?.visible, 'with a card the bar did not appear');
  check(shown?.text.includes('Je ontwerp staat klaar') && /Aanbouw · € 75\.570/.test(shown?.text || ''), `the bar does not read title, product and total (${shown?.text})`);
  check(shown?.href === '/prefab', 'the arrow does not go to the card url');
  await page.screenshot({path: join('docs', 'verification', 'resume-bar.png')});
  // A card priced on another catalogue shows the product alone.
  await page.evaluate(card => localStorage.setItem('cs-resume-v1', JSON.stringify({aanbouw: {...card, revision: 'an-older-catalogue'}})), card);
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
  await page.evaluate(card => { localStorage.removeItem('cs-resume-dismissed-v1'); localStorage.setItem('cs-resume-v1', JSON.stringify({aanbouw: card})); }, card);
  await page.goto(`${origin}/offerte`, {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForTimeout(1500);
  facts.onOfferte = await page.locator('.cs-resume-bar').count();
  check(facts.onOfferte === 0, 'the bar appeared on the offerte page next to the configurator');
  await page.evaluate(() => { localStorage.removeItem('cs-resume-v1'); localStorage.removeItem('cs-resume-dismissed-v1'); });
  await context.close();
} finally { await browser.close(); }
console.log(JSON.stringify({facts, problems}, null, 1));
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'resume bar: shown with the visitor\'s own total, label only on an older catalogue, the × holds, never next to the configurator');
process.exit(problems.length ? 1 : 0);

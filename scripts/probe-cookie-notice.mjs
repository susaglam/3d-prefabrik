// Probe (2.18.1): WHEN does Odoo's cookie notice open, and WHERE does it keep the visitor's answer? The resume bar
// must wait for it, and a check at DOMContentLoaded only works if the notice is already open then. Read-only on the
// site: a throwaway browser context answers the notice in its own cookie jar, nothing else is touched.
// PREFAB_ORIGIN=https://... node scripts/probe-cookie-notice.mjs
import {chromium} from '@playwright/test';
import {homedir} from 'node:os';
import {join} from 'node:path';

const origin = process.env.PREFAB_ORIGIN;
if (!origin) { console.error('Set PREFAB_ORIGIN to the website, e.g. https://prefabpartner.codesnap.nl'); process.exit(2); }
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
const facts = {};
const state = page => page.evaluate(() => {
  const modal = document.querySelector('#website_cookies_bar .modal');
  const wrapper = document.getElementById('website_cookies_bar');
  return {
    probe: window.__probe,
    cookies: document.cookie.split(/;\s*/).filter(Boolean).map(pair => pair.split('=')[0]),
    storage: Object.keys(localStorage),
    wrapper: wrapper && {className: wrapper.className, data: {...wrapper.dataset}},
    modal: modal && {className: modal.className, data: {...modal.dataset}, display: getComputedStyle(modal).display, zIndex: getComputedStyle(modal).zIndex},
    buttons: [...document.querySelectorAll('#website_cookies_bar .modal button, #website_cookies_bar .modal a.btn')]
      .map(button => ({text: button.innerText.trim(), id: button.id, className: button.className})),
  };
});
try {
  for (const [name, viewport] of [['desktop', {width: 1440, height: 900}], ['phone', {width: 390, height: 844}]]) {
    const context = await browser.newContext({viewport});
    await context.addInitScript(() => {
      window.__probe = {events: []};
      const note = what => window.__probe.events.push([what, Math.round(performance.now())]);
      document.addEventListener('DOMContentLoaded', () => {
        const modal = document.querySelector('#website_cookies_bar .modal');
        window.__probe.atDomContentLoaded = {t: Math.round(performance.now()), modalPresent: !!modal, modalShown: !!modal?.classList.contains('show')};
        new MutationObserver(() => {
          const now = document.querySelector('#website_cookies_bar .modal');
          const shown = !!now?.classList.contains('show');
          if (shown !== window.__probe.lastShown) { note(shown ? 'notice shown' : 'notice hidden'); window.__probe.lastShown = shown; }
        }).observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ['class'], childList: true});
      });
      addEventListener('load', () => note('load'));
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`, {waitUntil: 'networkidle', timeout: 90000});
    await page.waitForTimeout(4000);
    facts[name] = {first: await state(page)};
    const buttons = page.locator('#website_cookies_bar .modal.show button, #website_cookies_bar .modal.show a.btn');
    if (await buttons.count()) {
      await buttons.last().click();
      await page.waitForTimeout(1000);
      facts[name].afterAnswer = await state(page);
      const jar = await context.cookies();
      facts[name].jar = jar.map(cookie => ({name: cookie.name, value: decodeURIComponent(cookie.value).slice(0, 120), expires: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : 'session', httpOnly: cookie.httpOnly}));
      await page.reload({waitUntil: 'networkidle'});
      await page.waitForTimeout(3000);
      facts[name].reload = await state(page);
    }
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(facts, null, 1));

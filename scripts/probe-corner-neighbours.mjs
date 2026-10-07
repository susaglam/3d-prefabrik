// Diagnostic (2.18.0): the WhatsApp button's placement and the cookie notice's identity on the live website, at a
// desktop and a phone width, with a resume card present. Usage: node scripts/probe-corner-neighbours.mjs
import {chromium} from '@playwright/test';
import {homedir} from 'node:os';
import {join} from 'node:path';

const origin = process.env.PREFAB_ORIGIN || 'https://prefabpartner.codesnap.nl';
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
try {
  for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}]) {
    const context = await browser.newContext({viewport});
    const page = await context.newPage();
    await page.goto(`${origin}/`, {waitUntil: 'networkidle', timeout: 90000});
    const revision = await page.evaluate(() => document.body.getAttribute('data-cs-resume'));
    await page.evaluate(revision => localStorage.setItem('cs-resume-v1', JSON.stringify({aanbouw: {label: 'Aanbouw', url: '/prefab', total: 7557000, revision, savedAt: new Date().toISOString()}})), revision);
    await page.reload({waitUntil: 'networkidle'});
    await page.waitForTimeout(2500);
    const facts = await page.evaluate(() => {
      const rect = el => el ? (r => ({left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom)}))(el.getBoundingClientRect()) : null;
      const chat = document.querySelector('.o_prefab_whatsapp'), style = chat && getComputedStyle(chat);
      const cookie = document.querySelector('.o_cookies_discrete, #website_cookies_bar');
      const dialog = cookie?.querySelector('.modal-dialog, .modal-content') || cookie;
      return {chat: chat && {rect: rect(chat), right: style.right, bottom: style.bottom, z: style.zIndex},
        cookie: cookie && {id: cookie.id, parentId: cookie.parentElement?.id, cls: String(cookie.className), shown: cookie.classList.contains('show'), dialog: rect(dialog)},
        websiteCookiesBar: !!document.getElementById('website_cookies_bar'),
        bar: rect(document.querySelector('.cs-resume-bar')), barVisible: !!document.querySelector('.cs-resume-bar.is-visible')};
    });
    console.log(viewport.width, JSON.stringify(facts, null, 1));
    await page.screenshot({path: join('docs', 'verification', `resume-corner-${viewport.width}.png`)});
    await context.close();
  }
} finally { await browser.close(); }

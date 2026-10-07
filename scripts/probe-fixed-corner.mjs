// Diagnostic (2.18.0): which fixed elements sit in the bottom-right corner of the live website, where the resume bar
// goes. Usage: PREFAB_ORIGIN=https://... node scripts/probe-fixed-corner.mjs
import {chromium} from '@playwright/test';
import {homedir} from 'node:os';
import {join} from 'node:path';

const origin = process.env.PREFAB_ORIGIN || 'https://prefabpartner.codesnap.nl';
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
try {
  for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}]) {
    const page = await browser.newPage({viewport});
    await page.goto(`${origin}/`, {waitUntil: 'networkidle', timeout: 90000});
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(800);
    const fixed = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > innerHeight - 160 && r.right > innerWidth - 220;
    }).map(el => ({tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.className).slice(0, 80), text: el.innerText?.trim().slice(0, 40),
      rect: (r => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)])(el.getBoundingClientRect()), z: getComputedStyle(el).zIndex})));
    console.log(viewport.width, JSON.stringify(fixed, null, 1));
    await page.close();
  }
} finally { await browser.close(); }

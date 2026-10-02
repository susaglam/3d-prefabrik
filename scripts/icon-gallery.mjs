// A gallery of the drawn icons (standpoints, camera tools, Weergave scenes/qualities, rooflights for comparison), each at
// its real size and enlarged, so a new drawing is judged in a picture before it reaches a button. Writes
// docs/verification/icons/gallery.png.
import {chromium} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {viewpointIcon, toolIcon, TOOL_DRAWINGS, STANDPOINT_VIEWS} from '../addons/cs_prefab_configurator/static/src/scene_icons.js';
import {scenarioIcon, qualityIcon} from '../addons/cs_prefab_configurator/static/src/view_icons.js';
import {rooflightIcon} from '../addons/cs_prefab_configurator/static/src/rooflight_icons.js';
import {openingIcon} from '../addons/cs_prefab_configurator/static/src/opening_icons.js';

const out = join('docs', 'verification', 'icons'); await mkdir(out, {recursive: true});
// `zoom` (not transform) so the enlarged drawing also takes its enlarged room and the caption sits under it.
const cell = (svg, label, scale) => `<figure><div style="zoom:${scale}">${svg}</div><figcaption>${label}</figcaption></figure>`;
const row = (title, items, scale) => `<h2>${title}</h2><div class="row">${items.map(([svg, label]) => cell(svg, label, scale)).join('')}</div>`;
const html = `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;background:#fff;margin:16px;color:#333}h2{font-size:14px;margin:16px 0 4px}
.row{display:flex;flex-wrap:wrap;gap:18px}figure{margin:0;min-height:120px}figcaption{margin-top:4px;color:#666}</style>` +
  row('Standpunten (2×)', STANDPOINT_VIEWS.map(view => [viewpointIcon(view), view]), 2) +
  row('Camera tools (2×)', TOOL_DRAWINGS.map(action => [toolIcon(action), action]), 2) +
  row('Camera tools (real size)', TOOL_DRAWINGS.map(action => [toolIcon(action).replace('width="40" height="32"', 'width="30" height="24"'), action]), 1) +
  row('Inrichting (1.5×)', ['none', 'living', 'bedroom', 'youth'].map(id => [scenarioIcon(id), id]), 1.5) +
  row('Kwaliteit (1.5×)', ['auto', 'full', 'compact'].map(id => [qualityIcon(id), id]), 1.5) +
  row('Daklicht, for comparison (1×)', ['lean-3', 'gable-4'].map(id => [rooflightIcon(id), id]), 1) +
  // 2.16.0: the kozijn icons are front elevations with opening symbols; both colours, at the size a button uses
  // and enlarged, because what has to be readable at 120 px is which way each leaf opens.
  row('Kozijn (1×)', ['none', 'french-black', 'french-bars-black', 'sliding-2-black', 'sliding-4-black', 'folding-black'].map(id => [openingIcon(id), id]), 1) +
  row('Kozijn wit (1×)', ['french-white', 'french-bars-white', 'sliding-2-white', 'sliding-4-white', 'folding-white'].map(id => [openingIcon(id), id]), 1) +
  row('Kozijn (2×)', ['french-black', 'sliding-2-black', 'sliding-4-white', 'folding-black'].map(id => [openingIcon(id), id]), 2);
await writeFile(join(out, 'gallery.html'), html);
const browser = await chromium.launch({headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe')});
try { const page = await browser.newPage({viewport: {width: 1300, height: 900}}); await page.setContent(html); await page.screenshot({path: join(out, 'gallery.png'), fullPage: true}); }
finally { await browser.close(); }
console.log('wrote', join(out, 'gallery.png'));

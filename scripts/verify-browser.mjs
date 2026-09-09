import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.PREFAB_TEST_OUTPUT||join(root,'docs/verification');
await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'cs-prefab-browser-'));
const results={startedAt:new Date().toISOString(),checks:[],viewports:[],errors:[],productionWrites:false};
let server,browser;
function record(name,detail={}){results.checks.push({name,passed:true,...detail});console.log(`PASS ${name}`);}
try{
 let base=process.env.PREFAB_TEST_URL;
 if(!base){
 server=spawn(process.env.PYTHON||'python3',['scripts/serve.py','--port','0','--db',join(temporary,'browser.sqlite3')],{cwd:root,stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Test server start timed out')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match){clearTimeout(timer);resolve(match[1]);}});server.on('exit',code=>reject(new Error(`Server exited ${code}`)));server.stderr.on('data',chunk=>{if(String(chunk).includes('Traceback'))console.error(String(chunk));});});
 }
 const discovered=[join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),join(homedir(),'.cache/ms-playwright/chromium-1217/chrome-linux64/chrome')].find(existsSync);
 const extraLib='/tmp/cs-psk-browser-libs/extracted/usr/lib/x86_64-linux-gnu';
 const env={...process.env};if(existsSync(extraLib))env.LD_LIBRARY_PATH=[env.LD_LIBRARY_PATH,extraLib].filter(Boolean).join(':');
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||discovered,args:['--no-sandbox','--enable-unsafe-swiftshader'],env});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage();
 page.on('pageerror',error=>results.errors.push(error.message));
 page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('status of 422'))results.errors.push(msg.text());});
 await page.goto(`${base}/prefab`);
 await page.waitForFunction(()=>window.__prefabPreview);
 await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 expect(await page.evaluate(()=>window.__prefabPreview.getSceneInfo().webglAvailable)).toBe(true);
 await page.screenshot({path:join(output,'browser-desktop.png'),fullPage:true});
 record('Initial WebGL scene, catalogue and server price load without script errors');
 const select=async(key,value)=>{const input=page.locator(`input[name="${key}"][value="${value}"]`);await input.locator('..').click();await expect(input).toBeChecked();};
 const tab=async(n)=>page.locator(`.step-tab[data-step="${n}"]`).click();
 await page.locator('#width').fill('150');await page.locator('#depth').click();
 await page.locator('#depth').fill('100');await page.locator('#step-title').click();
 await expect.poll(()=>page.evaluate(()=>window.__prefabPreview.getSceneInfo().area)).toBe(1.5);
 record('Minimum 150 × 100 cm remains exact in 3D');
 await page.locator('#width').fill('751');await page.locator('#step-title').click();
 await expect(page.locator('#width-error')).toContainText('150');
 expect(await page.evaluate(()=>window.__prefabPreview.getSceneInfo().width)).toBe(1.5);
 record('Out-of-range dimension rejected without changing canonical preview');
 await page.locator('#width').fill('600');await page.locator('#step-title').click();
 await page.locator('#depth').fill('320');await page.locator('#step-title').click();
 await tab(1);await select('facade','wood-vertical');await select('rollaag','panel-black');
 await tab(2);await select('frontOpening','french-bars-white');await select('rooflight','gable-8');
 await select('roofEdge','aluminium');
 let info=await page.evaluate(()=>window.__prefabPreview.getSceneInfo());
 expect(info.width).toBe(6);expect(info.depth).toBe(3.2);expect(info.facade).toBe('wood-vertical');expect(info.opening.bars).toBe(true);expect(info.rooflight.panelCount).toBe(8);
 record('Facade, white barred doors and eight-panel gable rooflight drive actual scene geometry');
 await page.screenshot({path:join(output,'browser-custom-design.png'),fullPage:true});
 await tab(3);await select('outsideLight','both');await select('outsideSocket','left');await select('outsideTap','right');await select('drainMaterial','zinc');await select('drainSide','left');
 info=await page.evaluate(()=>window.__prefabPreview.getSceneInfo());expect(info.drain.side).toBe('left');expect(info.drain.material).toBe('zinc');
 record('Outside connections and drain selections propagate');
 await tab(4);await expect(page.locator('input[name="plaster"]')).toHaveCount(0);
 await select('interior','true');await select('plaster','true');await select('screed','true');await select('underfloorHeating','true');await select('heating','both');
 await page.locator('[data-count="spotlights"][data-delta="1"]').click();await page.locator('[data-count="spotlights"][data-delta="1"]').click();
 await select('interior','false');await expect(page.locator('#spotlights')).toHaveCount(0);
 await select('interior','true');await expect(page.locator('#spotlights')).toHaveValue('0');await expect(page.locator('input[name="plaster"][value="false"]')).toBeChecked();
 await select('plaster','true');await select('screed','true');await page.locator('[data-count="ceilingLights"][data-delta="1"]').click();
 record('Interior branch hides and clears previous optional costs');
 await tab(5);await select('demolition','true');await select('access','restricted');await select('piles','4');
 await tab(6);await expect(page.locator('.summary-hero')).toContainText('6,00 × 3,20');
 await page.locator('.summary-section [data-step="1"]').click();await expect(page.locator('#step-title')).toContainText('buitenkant');await tab(6);
 record('Summary edit links reopen the correct completed step');
 await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 await page.locator('[data-action="pricing"]').click();await expect(page.locator('#modal')).toBeVisible();await expect(page.locator('.breakdown-total')).toContainText('incl. btw');await expect(page.locator('.notice').first()).toContainText('demonstratie');await page.locator('[data-action="close-modal"]').click();
 record('Itemized net/VAT/total explanation marks demonstration pricing');
 await page.locator('[data-mode="2d"]').click();await expect.poll(()=>page.evaluate(()=>window.__prefabPreview.getSceneInfo().mode)).toBe('2d');
 await page.screenshot({path:join(output,'browser-plan.png'),fullPage:true});
 await page.locator('[data-mode="3d"]').click();await page.locator('[data-action="roof"]').click();expect(await page.evaluate(()=>window.__prefabPreview.getSceneInfo().roofVisible)).toBe(false);await page.locator('[data-action="roof"]').click();
 record('Scale floor plan and roof visibility controls work');
 await page.locator('[data-action="share"]').click();await expect(page.locator('#share-url')).toBeVisible();const sharedURL=await page.locator('#share-url').inputValue();expect(sharedURL).toContain('share=');await page.locator('[data-action="close-modal"]').click();
 const sharedContext=await browser.newContext();const shared=await sharedContext.newPage();await shared.goto(sharedURL);await shared.waitForFunction(()=>window.__prefabPreview);expect(await shared.evaluate(()=>window.__prefabPreview.getSceneInfo().width)).toBe(6);await sharedContext.close();
 record('Share link restores design in a fresh browser without contact data');
 await page.reload();await page.waitForFunction(()=>window.__prefabPreview);expect(await page.locator('#width').inputValue()).toBe('600');record('Local draft survives reload');
 await tab(6);await expect(page.locator('.price-value')).not.toHaveClass(/pending/);await page.locator('[data-action="contact"]').click();
 await page.locator('.submit-button').click();await expect(page.locator('#contact-error-firstName')).not.toBeEmpty();
 const customer={firstName:'Test',lastName:'Voorbeeld',email:'test@example.invalid',phone:'0612345678',address:'Voorbeeldstraat',houseNumber:'12 A',postcode:'1234 AB',city:'Utrecht',message:'Uitsluitend lokale browsercontrole. Geen verzending.'};
 for(const[key,value]of Object.entries(customer))await page.locator(`#contact-${key}`).fill(value);
 await page.locator('input[name="consent"]').check();await page.locator('.submit-button').click();await expect(page.locator('.success-state')).toBeVisible({timeout:15000});
 const downloadPromise=page.waitForEvent('download');await page.locator('.success-state a[download]').click();const download=await downloadPromise;const pdfPath=join(output,'browser-example-quote.pdf');await download.saveAs(pdfPath);expect((await readFile(pdfPath)).subarray(0,5).toString()).toBe('%PDF-');
 await expect(page.locator('.success-state .notice')).toContainText('geen e-mail');
 await page.screenshot({path:join(output,'browser-quote-success.png'),fullPage:true});
 record('Required-field validation, persistent quotation and real PDF download complete');
 await page.locator('.modal-head [data-action="close-modal"]').click();
 for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});await tab(0);
   const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(width);results.viewports.push({...overflow,passed:true});
   await tab(1);await select('facade','pvc-green');await tab(4);await select('interior','true');await tab(6);await page.locator('[data-action="contact"]').click();
   // A saved result modal is expected; the page itself remains within the viewport.
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await page.locator('.modal-head [data-action="close-modal"]').click();await tab(0);
   await page.screenshot({path:join(output,`browser-${width}px.png`),fullPage:true});
 }
 record('360, 390, 768 and 1440 px viewports: no overflow and controls remain usable');
 // Deliver an old server calculation after a newer one: the current price must win.
 let routeCount=0,latestPrice,releaseFirst,signalFirst,finishFirst;
 const firstArrived=new Promise(resolve=>signalFirst=resolve),release=new Promise(resolve=>releaseFirst=resolve),firstFinished=new Promise(resolve=>finishFirst=resolve);
 await page.route('**/prefab/api/price',async route=>{const response=await route.fetch();if(++routeCount===1){signalFirst();await release;await route.fulfill({response});finishFirst();}else{latestPrice=await response.json();await route.fulfill({response});}});
 await page.locator('[data-adjust="width"][data-delta="10"]').click();await firstArrived;await page.locator('[data-adjust="width"][data-delta="10"]').click();
 await expect.poll(()=>latestPrice?.total).toBeTruthy();await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 const expectedTotal=new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(latestPrice.total/100);
 await expect(page.locator('.price-value')).toHaveText(expectedTotal);releaseFirst();await firstFinished;await page.waitForTimeout(100);await expect(page.locator('.price-value')).toHaveText(expectedTotal);await page.unroute('**/prefab/api/price');
 record('A late outdated price response cannot overwrite a newer configuration total');
 // Force an offline API failure without interrupting static assets or showing a stale total.
 await page.route('**/prefab/api/price',route=>route.abort());await page.locator('[data-adjust="width"][data-delta="10"]').click();await expect(page.locator('.price-value')).toHaveText('Niet beschikbaar');await expect(page.locator('[data-action="retry-price"]')).toBeVisible();await page.unroute('**/prefab/api/price');await page.locator('[data-action="retry-price"]').click();await expect(page.locator('.price-value')).not.toHaveText('Niet beschikbaar');await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 record('Offline price hides stale total and recovers with explicit retry');
 // Navigation, local storage and 2D stay usable when WebGL cannot be created.
 const fallbackContext=await browser.newContext({viewport:{width:390,height:844}});const fallback=await fallbackContext.newPage();await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).includes('webgl'))return null;return original.call(this,type,...args);};});await fallback.goto(`${base}/prefab`);await fallback.waitForFunction(()=>window.__prefabPreview);expect(await fallback.evaluate(()=>window.__prefabPreview.getSceneInfo().webglAvailable)).toBe(false);await expect(fallback.locator('#preview-scene svg')).toBeVisible();await fallbackContext.close();record('Unavailable WebGL falls back to usable SVG plan');
 const restrictedContext=await browser.newContext();const restricted=await restrictedContext.newPage();await restricted.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Blocked storage','SecurityError');};});await restricted.goto(`${base}/prefab`);await restricted.locator('.step-tab').first().waitFor();await restricted.locator('[data-action="save"]').click();await expect(restricted.locator('#toast')).toContainText('niet beschikbaar');await restrictedContext.close();record('Blocked browser storage never reports a false successful save');
 const unexpected=results.errors.filter(x=>!x.includes('net::ERR_FAILED'));
 expect(unexpected).toEqual([]);
 record('No unexpected browser runtime or resource errors');
 results.passed=true;
}catch(error){results.passed=false;results.failure=error.stack;console.error(error);process.exitCode=1;}
finally{results.finishedAt=new Date().toISOString();await writeFile(join(output,'browser-results.json'),JSON.stringify(results,null,2)+'\n');await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await stopped;}await rm(temporary,{recursive:true,force:true});}

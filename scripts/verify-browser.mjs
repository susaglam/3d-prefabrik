/**
 * 2.8 end-to-end browser acceptance: dimensions (230 cm sliding-door minimum, 150 cm without opening), materials,
 * the three rollaag finishes, roof, outside services, interior branch, summary, pricing, share and quote flows,
 * viewports, price races, offline recovery, WebGL fallback and blocked storage.
 *
 * Runs against a temporary local server with its own sqlite database, so the quote and share writes stay local.
 * With PREFAB_TEST_URL the target is external: quote/share writes are then blocked and those two flows are skipped
 * unless PREFAB_ALLOW_WRITES=1 (only for a disposable installation). PREFAB_TEST_OUTPUT (default
 * docs/verification/2.8) receives browser.json plus screenshots; PREFAB_NO_SCREENSHOTS=1 writes only the JSON.
 */
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {waitAssetsReady} from './wait-assets-ready.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.PREFAB_TEST_OUTPUT||join(root,'docs/verification/2.8');
await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'cs-prefab-browser-'));
const liveTarget=!!process.env.PREFAB_TEST_URL,allowWrites=!liveTarget||process.env.PREFAB_ALLOW_WRITES==='1';
const results={release:'2.17.0',startedAt:new Date().toISOString(),liveTarget,writesAllowed:allowWrites,checks:[],viewports:[],screenshots:[],errors:[],failedRequests:[],writes:[],blockedWrites:[],productionWrites:false};
let server,browser;
const record=(name,detail={})=>{results.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
const skip=(name,reason)=>{results.checks.push({name,passed:true,skipped:true,reason});console.log('SKIP '+name+' ('+reason+')');};
try{
 let base=process.env.PREFAB_TEST_URL;
 if(!base){
  server=spawn(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),['scripts/serve.py','--port','0','--db',join(temporary,'browser.sqlite3')],{cwd:root,stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolveBase,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Test server start timed out')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match){clearTimeout(timer);resolveBase(match[1]);}});server.on('exit',code=>reject(new Error('Server exited '+code)));server.stderr.on('data',chunk=>{if(String(chunk).includes('Traceback'))console.error(String(chunk));});});
 }
 results.origin=base;
 const executablePath=process.env.CHROMIUM_PATH||[join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),join(homedir(),'.cache/ms-playwright/chromium-1217/chrome-linux64/chrome')].find(existsSync);
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const watch=(target,{webglExpectedToFail=false}={})=>{
  target.on('pageerror',error=>results.errors.push(error.message));
  target.on('console',msg=>{if(msg.type()!=='error'||msg.text().includes('status of 422'))return;if(webglExpectedToFail&&msg.text().includes('Error creating WebGL context'))return;results.errors.push(msg.text());});
  target.on('response',response=>{if(response.status()>=400)results.failedRequests.push({url:new URL(response.url()).pathname,status:response.status()});});
  target.on('request',request=>{if(request.method()==='POST'&&/\/prefab\/api\/(quote|share)$/.test(new URL(request.url()).pathname))results.writes.push(new URL(request.url()).pathname);});
  if(!allowWrites)target.route(/\/prefab\/api\/(quote|share)$/,route=>{results.blockedWrites.push(new URL(route.request().url()).pathname);return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Schrijven naar een extern doel is in deze controle geblokkeerd.'}})});});
 };
 watch(page);
 const noShots=!!process.env.PREFAB_NO_SCREENSHOTS;
 const shot=async(name,target=page)=>{if(noShots)return;await target.screenshot({path:join(output,name),fullPage:true});results.screenshots.push(name);};
 const priced=()=>expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 const ready=async(target=page)=>{await target.waitForFunction(()=>window.__prefabPreview);await waitAssetsReady(target);await expect(target.locator('.price-value')).not.toHaveClass(/pending/);};
 const scene=(target=page)=>target.evaluate(()=>window.__prefabPreview.getSceneInfo());
 const option=(key,id)=>page.locator('input[name="'+key+'"][value="'+id+'"]');
 // Sections are <details class="choice-group section-card" data-group=...> with a direct <summary>; the option input sits inside label.option-card.
 const select=async(key,id)=>{const input=option(key,id),group=input.locator('xpath=ancestor::details[1]');if(await group.count()&&(await group.getAttribute('open'))===null)await group.locator(':scope > summary').click();await input.locator('..').click();await expect(input).toBeChecked();await priced();};
 const tab=async index=>{await page.locator('nav [data-step="'+index+'"]').click();await expect(page.locator('nav [aria-current=step]')).toHaveAttribute('data-step',String(index));};
 const typeDimension=async(key,value)=>{const input=page.locator('#'+key);await input.fill(String(value));await input.dispatchEvent('change');await priced();};
 const viewpoint=async view=>{await tool('viewpoints');await page.locator('[data-view="'+view+'"]').click();await expect.poll(async()=>(await scene()).view).toBe(view);};
 const rollaagPanels=()=>page.evaluate(()=>{const found=[];window.__prefabPreview.scene.traverse(object=>{if(object.userData?.surface==='rollaag')found.push(object.material?.color?.getHexString?.()||null);});return found;});

 await page.goto(base+'/prefab');await ready();
 expect((await scene()).webglAvailable).toBe(true);
 const moduleRequests=await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.name).filter(url=>url.includes('/static/src/')&&/\.js(?:\?|$)/.test(url)));
 expect(moduleRequests.length).toBeGreaterThan(0);expect(moduleRequests.filter(url=>new URL(url).searchParams.get('v')!=='2.17.0')).toEqual([]);
 await shot('browser-desktop.png');
 await page.setViewportSize({width:390,height:844});await shot('browser-mobile-initial.png');await page.setViewportSize({width:1440,height:1000});
 record(`Initial WebGL scene, ${results.release} modules, catalogue and server price load without script errors`,{modules:moduleRequests.length});

 // Since 2.4 the default sliding door needs 230 cm; typed values snap to the allowed range instead of showing a field error.
 await expect(page.locator('#width')).toHaveAttribute('min','230');await expect(page.locator('[data-range=width]')).toHaveAttribute('min','230');
 await typeDimension('width',200);
 await expect(page.locator('#width')).toHaveValue('230');await expect(page.locator('#toast')).toContainText('230');
 expect((await scene()).width).toBe(2.3);
 await page.locator('#width').fill('');await page.locator('#width').dispatchEvent('change');
 await expect(page.locator('#toast')).toContainText('Vul een maat in');await expect(page.locator('#width')).toHaveValue('230');
 expect((await scene()).width).toBe(2.3);
 record('Default sliding door keeps the 230 cm catalogue minimum: 200 cm snaps to 230 with an explanation and a blank value is refused without changing the preview');

 await select('frontOpening','none');await expect(page.locator('[data-range=width]')).toHaveAttribute('min','150');
 await typeDimension('width',150);await typeDimension('depth',100);
 await expect.poll(async()=>(await scene()).area).toBe(1.5);
 await typeDimension('width',751);
 await expect(page.locator('#width')).toHaveValue('750');await expect(page.locator('#toast')).toContainText('750');
 expect((await scene()).width).toBe(7.5);
 record('Without a front opening the 150 × 100 cm minimum is exact in 3D and 751 cm snaps to the 750 cm maximum');

 await typeDimension('width',600);await typeDimension('depth',320);
 await select('facade','wood-vertical');await select('frontOpening','french-bars-white');await select('rooflight','gable-8');await select('roofEdge','aluminium');
 let info=await scene();
 expect(info.width).toBe(6);expect(info.depth).toBe(3.2);expect(info.facade).toBe('wood-vertical');expect(info.roofEdge).toBe('aluminium');expect(info.opening.bars).toBe(true);expect(info.rooflight.panelCount).toBe(8);
 record('Facade, white barred doors, aluminium roof edge and eight-panel gable rooflight drive actual scene geometry');

 // The separate rollaag toggle was retired in 2.7.1: the three finishes are the whole choice and each one is priced.
 await expect(page.locator('input[name=rollaagEnabled]')).toHaveCount(0);await expect(page.locator('input[name=rollaag]')).toHaveCount(3);
 const finishes={};
 for(const [id,label] of [['masonry','Rollaag'],['panel-white','Geen rollaag wit'],['panel-black','Geen rollaag zwart']]){
  await select('rollaag',id);
  await expect.poll(async()=>(await scene()).rollaag).toBe(id);
  const panels=await rollaagPanels(),entry=(await scene()).scope.find(item=>item.key==='rollaag');
  expect(entry).toBeTruthy();expect(entry.value).toBe(label);expect(entry.quantity).toBe(1);
  if(id==='masonry')expect(panels).toEqual([]);else expect(panels.length).toBeGreaterThan(0);
  finishes[id]={panels:panels.length,colour:panels[0]||null,scopeValue:entry.value,productStatus:entry.components.find(part=>part.role==='product')?.status};
 }
 expect(finishes['panel-white'].colour).not.toBe(finishes['panel-black'].colour);
 await expect(page.locator('input[name=rollaag][value=panel-black]')).toBeChecked();
 record('Each of the three rollaag finishes changes the scene and keeps its rollaag price scope entry',{finishes});

 await select('outsideLight','both');await select('outsideSocket','left');await select('outsideTap','right');await select('drainMaterial','zinc');await select('drainSide','left');
 info=await scene();
 expect(info.drain.side).toBe('left');expect(info.drain.material).toBe('zinc');expect(info.drains).toHaveLength(1);
 for(const id of ['outsideLight-left','outsideLight-right','outsideSocket-left','outsideTap-right'])expect(info.fixtures.some(fixture=>fixture.id===id)).toBe(true);
 record('Outside connections and drain selections propagate');
 await shot('browser-custom-design.png');

 const commercialBefore=await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1'));
 const totalBefore=await page.locator('.price-value').innerText();
 // Since 2.10.7 Weergave is a dialog, not a strip: open it, act inside it, and close it again before the page behind it
 // is touched. A phone folds the camera tools behind one menu button, so tool() opens that first when it shows.
 const inWeergave=async act=>{await page.locator('[data-action=view-strip]').click();await expect(page.locator('#modal .view-panel')).toBeVisible();await act();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#modal').open);};
 const tool=async action=>{const menu=page.locator('[data-action=tools-menu]');if(await menu.isVisible()&&(await menu.getAttribute('aria-expanded'))!=='true')await menu.click();await page.locator('[data-action='+action+']').first().click();};
 await inWeergave(()=>page.locator('[data-view-setting="examples"]').uncheck());
 const hiddenFixtures=(await scene()).fixtureStates;
 expect(hiddenFixtures.some(item=>item.mode==='representative')).toBe(true);
 expect(hiddenFixtures.filter(item=>item.mode==='representative').every(item=>item.visible===false)).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1'))).toBe(commercialBefore);
 expect(await page.locator('.price-value').innerText()).toBe(totalBefore);
 await inWeergave(()=>page.locator('[data-view-setting="examples"]').check());
 record('Representative fixture visibility never changes persisted design or price');

 await tab(1);await expect(page.locator('input[name="plaster"]')).toHaveCount(0);
 await select('interior','true');await select('plaster','true');await select('screed','true');await select('underfloorHeating','true');await select('heating','both');
 await select('spotPositions','r1c1');await select('spotPositions','r3c5');
 await select('interior','false');await expect(page.locator('input[name="spotPositions"]')).toHaveCount(0);
 await select('interior','true');await expect(page.locator('input[name="spotPositions"]:checked')).toHaveCount(0);await expect(page.locator('input[name="plaster"][value="false"]')).toBeChecked();
 await select('plaster','true');await select('screed','true');await select('ceilingPositions','left');
 record('Interior branch hides and clears previous optional costs');

 await tab(2);await select('demolition','true');await select('access','restricted');await select('piles','4');
 await tab(3);await expect(page.locator('.summary-dimensions')).toContainText('6,00 × 3,20');
 await page.locator('.summary-section [data-step="0"]').click();await expect(page.locator('#step-title')).toContainText('aanbouw');await tab(3);
 record('Summary edit links reopen the correct completed step');

 await priced();
 await page.locator('[data-action="pricing"]').click();await expect(page.locator('#modal')).toBeVisible();
 await expect(page.locator('.breakdown-total')).toContainText('incl. btw');await expect(page.locator('#modal .notice').first()).toContainText(/demonstratie/i);
 await page.locator('#modal [data-action="close-modal"]').first().click();
 record('Itemized net/VAT/total explanation marks demonstration pricing');

 await page.locator('[data-mode="2d"]').click();await expect.poll(async()=>(await scene()).mode).toBe('2d');
 await expect(page.locator('.prefab-plan')).toBeVisible();await shot('browser-plan.png');
 await page.locator('[data-scene-view="perspective"]').click();await expect.poll(async()=>(await scene()).mode).toBe('3d');
 await viewpoint('front');
 await page.locator('[data-action="roof"]').click();expect((await scene()).roofVisible).toBe(false);await page.locator('[data-action="roof"]').click();expect((await scene()).roofVisible).toBe(true);
 record('Scale floor plan, viewpoint menu and roof visibility controls work');

 // Floor finish and scenario chips in the bottom bar only change the picture (device setting), never the design or price.
 const draftBefore=await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1')),priceBefore=await page.locator('.price-value').innerText();
 await viewpoint('interior');
 await inWeergave(async()=>{
  await page.locator('[data-floor-finish="herringbone"]').click();await expect.poll(async()=>(await scene()).floorFinish).toBe('herringbone');
  await page.locator('[data-scenario="bedroom"]').click();await expect.poll(async()=>(await scene()).scenario,{timeout:60000}).toBe('bedroom');
  await expect(page.locator('[data-scenario="bedroom"]')).toHaveAttribute('aria-pressed','true');
 });
 expect(await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1'))).toBe(draftBefore);expect(await page.locator('.price-value').innerText()).toBe(priceBefore);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('cs-prefab-environment-v1')))).toMatchObject({floorFinish:'herringbone',scenario:'bedroom'});
 await shot('browser-interior-bedroom.png');
 await inWeergave(async()=>{await page.locator('[data-floor-finish="laminate"]').click();await page.locator('[data-scenario="living"]').click();});await expect.poll(async()=>(await scene()).scenario,{timeout:60000}).toBe('living');
 await viewpoint('perspective');
 record('Floor finish and scenario chips change the scene and the device setting only; design and price stay untouched');

 if(allowWrites){
  await page.locator('.header-actions [data-action="share"]').click();await expect(page.locator('#share-url')).toBeVisible();
  const sharedURL=await page.locator('#share-url').inputValue();expect(sharedURL).toContain('share=');await page.locator('#modal [data-action="close-modal"]').first().click();
  const sharedContext=await browser.newContext();const shared=await sharedContext.newPage();watch(shared);
  await shared.goto(sharedURL);await ready(shared);
  expect((await scene(shared)).width).toBe(6);expect((await scene(shared)).rollaag).toBe('panel-black');
  await expect(shared.locator('#toast')).toContainText('Gedeeld ontwerp geladen');
  // The share payload carries the design only: no contact fields, and the fresh browser holds no draft until it edits.
  const token=new URL(sharedURL).searchParams.get('share');
  const payload=await(await shared.request.get(base+'/prefab/api/share/'+encodeURIComponent(token))).json();
  expect(payload.config?.width).toBe(600);expect(JSON.stringify(payload)).not.toMatch(/firstName|lastName|email|phone|houseNumber/);
  expect(await shared.evaluate(()=>localStorage.getItem('cs-prefab-design-v1'))).toBeNull();
  await sharedContext.close();
  record('Share link restores design in a fresh browser without contact data');
 } else skip('Share link restores design in a fresh browser without contact data','external target: share writes are blocked');

 await page.reload();await ready();await expect(page.locator('#width')).toHaveValue('600');record('Local draft survives reload');

 if(allowWrites){
  await tab(3);await priced();await page.locator('[data-action="contact"]').click();
  await page.locator('.submit-button').click();await expect(page.locator('#contact-error-firstName')).not.toBeEmpty();
  const customer={firstName:'Test',lastName:'Voorbeeld',email:'test@example.invalid',phone:'0612345678',address:'Voorbeeldstraat',houseNumber:'12 A',postcode:'1234 AB',city:'Utrecht',message:'Uitsluitend lokale browsercontrole. Geen verzending.'};
  for(const [key,value] of Object.entries(customer))await page.locator('#contact-'+key).fill(value);
  await page.locator('input[name="consent"]').check();await page.locator('.submit-button').click();await expect(page.locator('.success-state')).toBeVisible({timeout:120000});
  const downloadPromise=page.waitForEvent('download');await page.locator('.success-state a[download]').click();const download=await downloadPromise;
  const pdfPath=join(temporary,'browser-example-quote.pdf');await download.saveAs(pdfPath);expect((await readFile(pdfPath)).subarray(0,5).toString()).toBe('%PDF-');
  if(!noShots){await copyFile(pdfPath,join(output,'browser-example-quote.pdf'));results.screenshots.push('browser-example-quote.pdf');}
  await expect(page.locator('.success-state .notice')).toContainText('geen e-mail');
  await shot('browser-quote-success.png');
  record('Required-field validation, persistent quotation and real PDF download complete',{documentStatus:await page.locator('.success-state .document-status').textContent().catch(()=>null)});
  await page.locator('.modal-head [data-action="close-modal"]').click();
 } else skip('Required-field validation, persistent quotation and real PDF download complete','external target: quote writes are blocked');

 for(const width of [360,390,768,1440]){
  await page.setViewportSize({width,height:900});await tab(0);
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));expect(overflow.document).toBeLessThanOrEqual(width);results.viewports.push({...overflow,passed:true});
  if(width<=768){await expect(page.locator('#width')).toBeInViewport();await expect(page.locator('.next-button')).toBeInViewport();await expect(page.locator('#preview-scene')).toBeInViewport();}
  await select('facade','pvc-green');await tab(1);await select('interior','true');await tab(3);await priced();await page.locator('[data-action="contact"]').click();
  // The saved-result modal (or the contact form on an external target) opens; the page itself stays within the viewport.
  await expect(page.locator('#modal')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.locator('.modal-head [data-action="close-modal"]').click();await tab(0);
  await shot('browser-'+width+'px.png');
 }
 record('360, 390, 768 and 1440 px viewports: no overflow and controls remain usable');

 // Deliver an old server calculation after a newer one: the current price must win.
 let routeCount=0,latestPrice,releaseFirst,signalFirst,finishFirst;
 const firstArrived=new Promise(resolveFirst=>signalFirst=resolveFirst),release=new Promise(resolveRelease=>releaseFirst=resolveRelease),firstFinished=new Promise(resolveFinish=>finishFirst=resolveFinish);
 await page.route('**/prefab/api/price',async route=>{const response=await route.fetch();if(++routeCount===1){signalFirst();await release;await route.fulfill({response});finishFirst();}else{latestPrice=await response.json();await route.fulfill({response});}});
 await page.locator('[data-adjust="width"][data-delta="10"]').click();await firstArrived;await page.locator('[data-adjust="width"][data-delta="10"]').click();
 await expect.poll(()=>latestPrice?.total).toBeTruthy();await priced();
 const expectedTotal=new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(latestPrice.total/100);
 await expect(page.locator('.price-value')).toHaveText(expectedTotal);releaseFirst();await firstFinished;await page.waitForTimeout(100);await expect(page.locator('.price-value')).toHaveText(expectedTotal);await page.unroute('**/prefab/api/price');
 record('A late outdated price response cannot overwrite a newer configuration total');

 // Force an offline API failure without interrupting static assets or showing a stale total.
 await page.route('**/prefab/api/price',route=>route.abort());await page.locator('[data-adjust="width"][data-delta="10"]').click();
 await expect(page.locator('.price-value')).toHaveText('Niet beschikbaar');await expect(page.locator('[data-action="retry-price"]')).toBeVisible();
 await page.unroute('**/prefab/api/price');await page.locator('[data-action="retry-price"]').click();
 await expect(page.locator('.price-value')).not.toHaveText('Niet beschikbaar');await priced();
 record('Offline price hides stale total and recovers with explicit retry');

 // Navigation, local storage and 2D stay usable when WebGL cannot be created.
 const fallbackContext=await browser.newContext({viewport:{width:390,height:844}});const fallback=await fallbackContext.newPage();watch(fallback,{webglExpectedToFail:true});
 await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).includes('webgl'))return null;return original.call(this,type,...args);};});
 await fallback.goto(base+'/prefab');await fallback.waitForFunction(()=>window.__prefabPreview);
 expect((await scene(fallback)).webglAvailable).toBe(false);await expect(fallback.locator('.prefab-plan')).toBeVisible();await expect(fallback.locator('#width')).toBeVisible();
 await fallbackContext.close();record('Unavailable WebGL falls back to usable SVG plan');

 const restrictedContext=await browser.newContext();const restricted=await restrictedContext.newPage();watch(restricted);
 await restricted.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Blocked storage','SecurityError');};});
 await restricted.goto(base+'/prefab');await restricted.locator('.step-tab').first().waitFor();
 await restricted.locator('.header-actions [data-action="save"]').click();await expect(restricted.locator('#toast')).toContainText('niet beschikbaar');
 await restrictedContext.close();record('Blocked browser storage never reports a false successful save');

 const unexpected=results.errors.filter(text=>!text.includes('net::ERR_FAILED'));
 expect(unexpected).toEqual([]);
 const unexpectedRequests=results.failedRequests.filter(item=>!(item.url.endsWith('/prefab/api/price')&&item.status===422));
 expect(unexpectedRequests).toEqual([]);
 if(!allowWrites)expect(results.writes).toEqual([]);
 record('No unexpected browser runtime, resource or API errors');
 results.passed=true;
}catch(error){results.passed=false;results.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
 results.finishedAt=new Date().toISOString();
 await writeFile(join(output,'browser.json'),JSON.stringify(results,null,2)+'\n');
 await browser?.close();
 if(server&&server.exitCode===null){const stopped=new Promise(resolveStop=>server.once('exit',resolveStop));server.kill('SIGTERM');await stopped;}
 // Remove only this verified mkdtemp workspace; never a supplied or computed broad directory.
 if(dirname(resolve(temporary))!==resolve(tmpdir())||!basename(temporary).startsWith('cs-prefab-browser-'))throw new Error('Unexpected temporary workspace');
 await rm(temporary,{recursive:true,force:true});
}

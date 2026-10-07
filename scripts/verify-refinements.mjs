/** 2.3 browser acceptance. Public target is read-only; all design changes are browser-local. */
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {verifyRefinementUI} from './refinement-ui-checks.mjs';
import {waitAssetsReady} from './wait-assets-ready.mjs';

const temporary=await mkdtemp(join(tmpdir(),'prefab-refinements-'));
const output=process.env.PREFAB_TEST_OUTPUT||'docs/verification/2.3';await mkdir(output,{recursive:true});
const result={startedAt:new Date().toISOString(),checks:[],errors:[],writes:[],attemptedWrites:[],screenshots:[],productionWrites:false};
const record=(name,details={})=>{result.checks.push({name,passed:true,...details});console.log('PASS '+name);};
let server,browser;
try{
 let origin=process.env.PREFAB_TEST_ORIGIN;
 if(!origin){server=spawn(process.platform==='win32'?'python':'python3',['scripts/serve.py','--port','0','--db',join(temporary,'qa.sqlite3')],{stdio:['ignore','pipe','pipe'],env:{...process.env,PREFAB_COMPARE:'1'}});origin=await new Promise((resolve,reject)=>{let stdout='';const timer=setTimeout(()=>reject(new Error('Local server start timed out')),15000);server.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('exit',code=>reject(new Error('Server exited '+code)));
  // Drain stderr for the process lifetime: an unread Windows pipe fills after a handful of requests, and the next
  // write then blocks inside Python's logging module while holding its global lock - every later request's
  // response logs a line too, so it blocks behind the same lock and the server goes permanently deaf. Confirmed by
  // reproduction (scripts/verify-usability.mjs carries the full note); this drain is the fix, not a timeout.
  server.stderr.on('data',chunk=>{if(String(chunk).includes('Traceback'))console.error(String(chunk));});
 });}
 result.origin=origin;result.liveTarget=!!process.env.PREFAB_TEST_ORIGIN;
 const executablePath=process.env.CHROMIUM_PATH||[join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome')].find(existsSync);
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',error=>result.errors.push(error.message));
 page.on('request',request=>{if(request.method()==='POST'&&/\/prefab\/api\/(quote|share)$/.test(new URL(request.url()).pathname))result.attemptedWrites.push(new URL(request.url()).pathname);});
 await page.route(/\/prefab\/api\/(quote|share)$/,route=>{result.writes.push(new URL(route.request().url()).pathname);return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Unexpected test submission blocked.'}})});});
 const catalog=await(await context.request.get(origin+'/prefab/api/catalog')).json();
 const quotePrice=async config=>{const response=await context.request.post(origin+'/prefab/api/price',{headers:{Origin:origin},data:{config:{...catalog.defaults,...config},catalogRevision:catalog.catalogRevision}});expect(response.status()).toBe(200);return response.json();};
 const load=async config=>{
  await page.goto(origin+'/prefab');
  await page.evaluate(({config,version})=>{localStorage.setItem('cs-prefab-design-v1',JSON.stringify({version,config}));localStorage.removeItem('cs-prefab-comparison-v1');},{config,version:catalog.schemaVersion});
  await page.reload();await page.waitForFunction(()=>window.__prefabPreview);
  await waitAssetsReady(page);
  await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
  await page.evaluate(()=>document.fonts.ready);
 };
 const scene=()=>page.evaluate(()=>window.__prefabPreview.getSceneInfo());
 const shot=async name=>{if(process.env.PREFAB_NO_SCREENSHOTS)return;await page.screenshot({path:join(output,name)});result.screenshots.push(name);};
 const step=async index=>page.locator('nav [data-step="'+index+'"]').click();
 const select=async(key,value)=>{const input=page.locator('input[name="'+key+'"][value="'+value+'"]');const group=input.locator('xpath=ancestor::details[1]');if(await group.count()&&(await group.getAttribute('open'))===null)await group.locator(':scope > summary').click();await input.check();await expect(page.locator('.price-value')).not.toHaveClass(/pending/);};

 if(!process.env.PREFAB_UI_ONLY){
 const dense=await quotePrice({width:750,depth:340,frontOpening:'french-black',facade:'pvc-green',outsideLight:'both',outsideSocket:'double-both',outsideTap:'both',drainSide:'both',interior:true,plaster:true,screed:true,underfloorHeating:true,heating:'both',ceilingPositions:['left','center','right'],spotPositions:Array.from({length:15},(_,i)=>`r${Math.floor(i/5)+1}c${i%5+1}`),socketPositions:['L1','L2','L3','R1','R2','R3'],wallLights:['L1','L2','L3','R1','R2','R3']});
 await load(dense.config);
 expect((await scene()).webglAvailable).toBe(true);
 const modules=await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.name).filter(url=>url.includes('/static/src/')&&/\.js(?:\?|$)/.test(url)));
 expect(modules.filter(url=>new URL(url).searchParams.get('v')!=='2.18.1')).toEqual([]);
 record('Release 2.3 source modules, real WebGL, catalogue and price load');
 const assertExterior=info=>{
  for(const side of ['left','right']){
   const lamp=info.fixtures.find(f=>f.id==='outsideLight-'+side),socket=info.fixtures.find(f=>f.id==='outsideSocket-'+side),tap=info.fixtures.find(f=>f.id==='outsideTap-'+side);
   expect(lamp).toBeTruthy();expect(socket).toBeTruthy();expect(tap).toBeTruthy();
   expect(lamp.position[0]).toBeCloseTo(socket.position[0],6);expect(lamp.position[2]).toBeCloseTo(socket.position[2],6);
   // Two front axes keep 29 cm between tap and socket; a stacked front axis separates them vertically instead.
   // Since 2.10.0 the socket sits ABOVE the tap at fixed heights, so the gap is measured without a direction: this
   // check still asked for the tap on top and failed on every release since (found 2026-09-19, live 2.10.9: -0.40 m).
   const stacked=tap.surface==='front'&&Math.abs(tap.position[0]-socket.position[0])<1e-6;
   if(stacked)expect(Math.abs(tap.position[1]-socket.position[1])).toBeGreaterThanOrEqual(.35);
   else expect(Math.hypot(tap.position[0]-socket.position[0],tap.position[2]-socket.position[2])).toBeGreaterThanOrEqual(.29);
   const drain=info.drains.find(d=>d.side===side);
   for(const item of [lamp,socket,tap])expect(Math.hypot(item.position[0]-drain.x,item.position[2]-drain.z)).toBeGreaterThan(.11);
  }
 };
 // Since 2.10.7 Weergave is a dialog, not a strip: open it, act inside it, and close it again before the page behind it
 // is touched. A phone folds the camera tools behind one menu button, so tool() opens that first when it shows.
 const inWeergave=async act=>{await page.locator('[data-action=view-strip]').click();await expect(page.locator('#modal .view-panel')).toBeVisible();await act();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#modal').open);};
 const tool=async action=>{const menu=page.locator('[data-action=tools-menu]');if(await menu.isVisible()&&(await menu.getAttribute('aria-expanded'))!=='true')await menu.click();await page.locator('[data-action='+action+']').first().click();};
 assertExterior(await scene());await tool('viewpoints');await page.locator('[data-view=front]').click();await shot('exterior-aligned-services.png');
 record('Both exterior sides separate tap, aligned lamp/socket and rainwater pipe');

 await step(1);await tool('viewpoints');await page.locator('[data-view=ceiling]').click();
 const info=await scene(),fittings=info.fixtures;
 for(const socket of fittings.filter(f=>f.key==='sockets'))for(const radiator of fittings.filter(f=>f.key==='heating')){
  if(Math.sign(socket.position[0])!==Math.sign(radiator.position[0]))continue;
  expect(Math.abs(socket.position[2]-radiator.position[2])).toBeGreaterThan(.35);
 }
 const pendants=fittings.filter(f=>f.kind==='pendant'),spots=fittings.filter(f=>f.key==='spotlights');
 for(const spot of spots)for(const pendant of pendants)expect(Math.hypot(spot.position[0]-pendant.position[0],spot.position[2]-pendant.position[2])).toBeGreaterThanOrEqual(.244);
 await shot('ceiling-lights.png');
 record('Resolved radiator/socket and pendant/spot bodies have independent physical clearance',{pendants:pendants.length,spots:spots.length,cleared:dense.clearedSelections?.length});
 await tool('viewpoints');await page.locator('[data-view=cutaway]').click();
 let floor=(await scene()).floorHeatingState;expect(floor.visible).toBe(true);expect(floor.loopCount).toBeGreaterThan(0);expect(floor.mode).toBe('representative');
 await shot('underfloor-representative.png');
 const saved=await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1')),total=await page.locator('.price-value').innerText();
 await inWeergave(()=>page.locator('[data-view-setting=examples]').uncheck());expect((await scene()).floorHeatingState.visible).toBe(false);
 expect(await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1'))).toBe(saved);expect(await page.locator('.price-value').innerText()).toBe(total);
 await inWeergave(()=>page.locator('[data-view-setting=examples]').check());
 // Since 2.8 the loops inside the finished room appear only while being laid; open-roof views keep the supplied product.
 const effects=await page.evaluate(()=>{const p=window.__prefabPreview;window.__savedScope=structuredClone(p.getSceneInfo().scope);p.setScope(window.__savedScope.map(row=>['underfloorHeating','ceilingLights','spotlights'].includes(row.key)?{...row,visualMode:'product',productIncluded:true,components:row.components.map(c=>c.role==='product'?{...c,status:'included'}:c)}:row));p.setExamplesVisible(false);p.setView('interior');const inside=p.getSceneInfo();p.setView('cutaway');const open=p.getSceneInfo();return {inside,open};});
 expect(effects.inside.floorHeatingState.visible).toBe(false);expect(effects.inside.rendererInfo.lightEffectCount).toBeGreaterThan(0);
 expect(effects.open.floorHeatingState.visible).toBe(true);expect(effects.open.floorHeatingState.mode).toBe('included');
 await page.evaluate(()=>{const p=window.__prefabPreview;p.setScope(window.__savedScope);p.setExamplesVisible(true);p.setView('cutaway');});
 record('Floor loops and light effects respect illustrative/included visibility without altering price',{floorLoops:floor.loopCount,lightEffects:effects.inside.rendererInfo.lightEffectCount,scopeOverride:'Renderer-only visibility check; no catalogue or commercial changes'});

 await step(0);await select('rooflight','gable-8');await step(1);
 await expect.poll(async()=>(await scene()).rooflight.panelCount).toBe(8);
 await expect(page.locator('input[name=spotPositions]')).toHaveCount(15);
 const ceilingGroup=page.locator('details[data-group=ceiling]');if((await ceilingGroup.getAttribute('open'))===null)await ceilingGroup.locator(':scope > summary').click();
 const blocked=page.locator('input[name=spotPositions]:disabled');await expect.poll(()=>blocked.count()).toBeGreaterThan(0);
 const blockedLabel=await blocked.first().locator('..').innerText();expect(blockedLabel.length).toBeGreaterThan(0);
 record('Roof aperture blocks conflicting spot selections with a visible explanation');
 await step(0);const roofGroup=page.locator('details[data-group=roof]');if((await roofGroup.getAttribute('open'))===null)await roofGroup.locator(':scope > summary').click();await page.locator('[data-field=rooflight]').scrollIntoViewIfNeeded();await shot('rooflight-icons.png');

 const narrow=await quotePrice({width:150,depth:100,frontOpening:'none',outsideLight:'both',outsideSocket:'double-both',outsideTap:'both',drainSide:'both'});
 await load(narrow.config);assertExterior(await scene());record('150 × 100 cm uses a bounded exterior layout without crowding pipes or door openings');
 }else await load({...catalog.defaults});
 await verifyRefinementUI({page,expect,record,origin,catalog});
 for(const width of [360,390,768]){
  await page.setViewportSize({width,height:844});await step(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  // The header's action row (reset since 2.11.0 only after a change) stays reachable at every width.
  await expect(page.locator('.header-actions')).toBeInViewport();await expect(page.locator('#width')).toBeInViewport();await expect(page.locator('.next-button')).toBeInViewport();
  if(width===390)await shot('mobile-clear-selections.png');
 }
 const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(accessibility.violations).toEqual([]);
 record('360, 390 and 768 px retain reset, dimensions and next action without overflow; WCAG checks pass');
 expect(result.writes).toEqual([]);expect(result.errors).toEqual([]);result.passed=true;
}catch(error){result.passed=false;result.errors.push(error.message);result.failureStack=error.stack;console.error(error.stack);process.exitCode=1;}
finally{
 await browser?.close();if(server)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
 // Remove only this verified mkdtemp workspace; never a supplied or computed broad directory.
 if(dirname(resolve(temporary))!==resolve(tmpdir())||!basename(temporary).startsWith('prefab-refinements-'))throw new Error('Unexpected temporary workspace');
 await rm(temporary,{recursive:true,force:true});result.finishedAt=new Date().toISOString();await writeFile(join(output,'browser.json'),JSON.stringify(result,null,2)+'\n');
}

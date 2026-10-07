/** End-to-end checks for inspection, comparison and read-only catalogue preview. No quote or share is submitted. */
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {waitAssetsReady} from './wait-assets-ready.mjs';

const temporary=await mkdtemp(join(tmpdir(),'prefab-workspace-'));
const output='docs/verification/workspace';await mkdir(output,{recursive:true});
let server,browser;
const checks=[],errors=[];
const record=(name,details={})=>{checks.push({name,passed:true,...details});console.log('PASS '+name);};
try{
 let origin=process.env.PREFAB_TEST_ORIGIN;
 if(!origin){server=spawn(process.platform==='win32'?'python':'python3',['scripts/serve.py','--port','0','--db',join(temporary,'qa.sqlite3')],{stdio:['ignore','pipe','pipe'],env:{...process.env,PREFAB_COMPARE:'1'}});origin=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match)resolve(match[1]);});server.once('exit',code=>reject(new Error('Server exited '+code)));
  // Drain stderr for the process lifetime: an unread Windows pipe fills after a handful of requests, and the next
  // write then blocks inside Python's logging module while holding its global lock - every later request's
  // response logs a line too, so it blocks behind the same lock and the server goes permanently deaf. Confirmed by
  // reproduction (scripts/verify-usability.mjs carries the full note); this drain is the fix, not a timeout.
  server.stderr.on('data',chunk=>{if(String(chunk).includes('Traceback'))console.error(String(chunk));});
 });}
 const executablePath=process.env.CHROMIUM_PATH||[join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome')].find(existsSync);
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const writes=[];page.on('request',request=>{if(/\/api\/(quote|share)$/.test(new URL(request.url()).pathname)&&request.method()==='POST')writes.push(request.url());});
 const load=async()=>{await page.goto(origin+'/prefab');await page.waitForFunction(()=>window.__prefabPreview);await waitAssetsReady(page);await expect(page.locator('.price-value')).not.toHaveClass(/pending/);};
 const select=async(key,value)=>{const input=page.locator(`input[name="${key}"][value="${value}"]`),group=input.locator('xpath=ancestor::details[1]');if(await group.count()&&(await group.getAttribute('open'))===null)await group.locator(':scope > summary').click();await input.check();};
 const step=async value=>page.locator(`nav [data-step="${value}"]`).click();
 await load();
 const moduleRequests=await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.name).filter(url=>url.includes('/static/src/')&&/\.js(?:\?|$)/.test(url)));
 expect(moduleRequests.filter(url=>new URL(url).searchParams.get('v')!=='2.18.2')).toEqual([]);
 record('Every loaded source module uses the current release cache version');

 await select('outsideTap','left');await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 const draftBefore=await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1')),priceBefore=await page.locator('.price-value').innerText();
 // Since 2.10.7 Weergave is a dialog, not a strip: open it, act inside it, and close it again before the page behind it
 // is touched. A phone folds the camera tools behind one menu button, so tool() opens that first when it shows.
 const inWeergave=async act=>{await page.locator('[data-action=view-strip]').click();await expect(page.locator('#modal .view-panel')).toBeVisible();await act();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#modal').open);};
 const tool=async action=>{const menu=page.locator('[data-action=tools-menu]');if(await menu.isVisible()&&(await menu.getAttribute('aria-expanded'))!=='true')await menu.click();await page.locator('[data-action='+action+']').first().click();};
 await inWeergave(()=>page.locator('[data-view-setting=decor]').uncheck());
 expect(await page.evaluate(()=>window.__prefabPreview.getSceneInfo().decorVisible)).toBe(false);
 await tool('material-detail');
 expect(await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1'))).toBe(draftBefore);
 expect(await page.locator('.price-value').innerText()).toBe(priceBefore);
 await inWeergave(()=>page.locator('[data-view-setting=decor]').check());
 record('Garden visibility and material inspection leave the configuration and price unchanged');

 await tool('viewpoints');await page.locator('[data-view=front]').click();await step(2);
 const point=await page.evaluate(async()=>{const preview=window.__prefabPreview,{Vector3}=await import('/cs_prefab_configurator/static/vendor/three.module.js');const fixture=preview.getSceneInfo().fixtures.find(item=>item.key==='outsideTap');const p=new Vector3(...fixture.position);p.z+=.075;p.project(preview.camera);const bounds=preview.renderer.domElement.getBoundingClientRect();return {x:bounds.left+(p.x+1)*bounds.width/2,y:bounds.top+(1-p.y)*bounds.height/2};});
 await page.mouse.click(point.x,point.y);
 await expect(page.locator('nav [aria-current=step]')).toHaveAttribute('data-step','0');
 await expect(page.locator('details[data-group=outside]')).toHaveAttribute('open','');
 await expect(page.locator('[data-field=outsideTap]')).toBeInViewport();
 expect(await page.evaluate(()=>document.activeElement.name)).toBe('outsideTap');
 await page.locator('[data-focus-option=outsideTap]').click();
 record('A real canvas fixture click opens and focuses its option; its field can inspect it in 3D');

 /**
  * Stage 1 of 2.9.3: structural parts must reach the form exactly like a fixture does. Aims at a part by its own
  * scopeKey — it projects the part, then repeats the walk-up selectAt() performs and only returns a point where that
  * part really is the nearest pickable hit, so a click that lands on a neighbour fails here instead of passing by
  * accident. Audit of every priced field: docs/verification/2.9/scene-links.json.
  */
 const aimAt=async(key,views=['perspective','perspective-right','front','top'])=>page.evaluate(async({key,views})=>{
  const preview=window.__prefabPreview,THREE=await import('/cs_prefab_configurator/static/vendor/three.module.js');
  const raycaster=new THREE.Raycaster();raycaster.params.Line.threshold=.035;
  const box=new THREE.Box3(),centre=new THREE.Vector3(),point=new THREE.Vector3();
  const resolve=(nx,ny)=>{
   raycaster.setFromCamera(new THREE.Vector2(nx*2-1,-(ny*2-1)),preview.camera);
   for(const hit of raycaster.intersectObject(preview.root,true)){
    let node=hit.object,visible=true,pickable=true,found=null;
    while(node){if(!node.visible)visible=false;if(node.userData.noPick)pickable=false;if(!found&&node.userData.scopeKey)found=node.userData.scopeKey;node=node.parent;}
    if(!visible||!pickable)continue;
    return found;
   }
   return null;
  };
  for(const view of views){
   preview.setView(view);
   const rect=preview.renderer.domElement.getBoundingClientRect(),carriers=[];
   preview.root.traverse(object=>{if(object.userData.scopeKey===key)carriers.push(object);});
   for(const carrier of carriers){
    box.setFromObject(carrier);if(box.isEmpty())continue;
    box.getCenter(centre);const size=box.getSize(new THREE.Vector3());
    for(const [fx,fy,fz] of [[0,0,0],[.3,0,0],[-.3,0,0],[0,.3,0],[0,-.3,0],[0,0,.3],[0,0,-.3]]){
     point.set(centre.x+size.x*fx,centre.y+size.y*fy,centre.z+size.z*fz).project(preview.camera);
     if(Math.abs(point.x)>.97||Math.abs(point.y)>.97||point.z>1)continue;
     const nx=(point.x+1)/2,ny=(1-point.y)/2;
     if(resolve(nx,ny)===key)return {x:rect.left+nx*rect.width,y:rect.top+ny*rect.height,view,mesh:carrier.name||carrier.type};
    }
   }
  }
  return null;
 },{key,views});
 await select('overhang','pvc-white');await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 const structuralClicks=[];
 for(const [key,field,group] of [['roofEdge','roofEdge','roof'],['drainMaterial','drainMaterial','outside'],['overhang','overhang','roof']]){
  const point=await aimAt(key);
  expect(point,'No pickable point found for '+key).not.toBeNull();
  await page.mouse.click(point.x,point.y);
  await expect(page.locator('nav [aria-current=step]')).toHaveAttribute('data-step','0');
  await expect(page.locator('details[data-group='+group+']')).toHaveAttribute('open','');
  await expect(page.locator('[data-field='+field+']')).toBeInViewport();
  expect(await page.evaluate(()=>document.activeElement.name)).toBe(field);
  structuralClicks.push({key,field,view:point.view,mesh:point.mesh});
 }
 record('Daktrim, regenpijp and overstek each open and focus their own field from a real canvas click',{clicks:structuralClicks});

 // Hover teaches that the model is clickable: pointer cursor plus a soft outline, one throttled raycast at a time.
 const hover=await page.evaluate(async()=>{
  const preview=window.__prefabPreview,canvas=preview.renderer.domElement,rect=canvas.getBoundingClientRect();
  preview.setView('perspective');
  const fire=(x,y)=>canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerType:'mouse',bubbles:true}));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const centre={x:rect.left+rect.width/2,y:rect.top+rect.height*.62},sky={x:rect.left+8,y:rect.top+8};
  const count=()=>preview.getSceneInfo().selection.hoverCost?.count||0;
  // A burst of moves inside one throttle window must cost exactly one raycast.
  await wait(220);const baseline=count();
  for(let i=0;i<40;i++)fire(centre.x+i%5,centre.y);
  await wait(220);
  const burst=count()-baseline;
  const onPart={cursor:canvas.style.cursor,key:preview.getSceneInfo().selection.hoverKey,outlined:preview.getSceneInfo().selection.highlighted};
  fire(sky.x,sky.y);await wait(220);
  const onSky={cursor:canvas.style.cursor,key:preview.getSceneInfo().selection.hoverKey,outlined:preview.getSceneInfo().selection.highlighted};
  const sweepFrom=count(),started=performance.now();
  for(let i=0;i<24;i++){fire(centre.x+i*3,centre.y+i);await wait(35);}
  await wait(220);
  return {burst,onPart,onSky,sweep:count()-sweepFrom,sweepMs:Math.round(performance.now()-started),
   cost:preview.getSceneInfo().selection.hoverCost,intervalMs:preview.getSceneInfo().selection.intervalMs};
 });
 expect(hover.burst).toBeLessThanOrEqual(1);
 expect(hover.onPart.cursor).toBe('pointer');expect(hover.onPart.outlined).toBe(true);expect(hover.onPart.key).toBeTruthy();
 expect(hover.onSky.cursor).toBe('');expect(hover.onSky.outlined).toBe(false);expect(hover.onSky.key).toBe(null);
 // A continuous sweep may not cost more than one raycast per throttle window (plus the trailing one).
 expect(hover.sweep).toBeLessThanOrEqual(Math.ceil(hover.sweepMs/hover.intervalMs)+2);
 expect(hover.cost.meanMs).toBeLessThan(12);
 record('Hovering a pickable part shows the pointer and a soft outline, at one throttled raycast per window',{hover});
 await select('overhang','none');await expect(page.locator('.price-value')).not.toHaveClass(/pending/);

 await step(3);await page.locator('.comparison-panel>summary').click();await page.locator('[data-comparison-save=A]').click();
 await step(0);await page.locator('#width').fill('620');await page.locator('#depth').focus();await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 await step(3);await page.locator('[data-comparison-save=B]').click();await page.locator('[data-action=compare-refresh]').click();
 await expect(page.locator('.comparison-outcome')).toBeVisible();await expect(page.locator('.comparison-table').first()).toContainText('620 cm');await expect(page.locator('.comparison-table').first()).toContainText('500 cm');
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('cs-prefab-comparison-v1')));
 expect(stored.A.config.width).toBe(500);expect(stored.B.config.width).toBe(620);expect(JSON.stringify(stored)).not.toContain('"scope"');expect(JSON.stringify(stored)).not.toContain('"total"');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);

 if(!process.env.PREFAB_NO_SCREENSHOTS)await page.screenshot({path:join(output,'desktop-comparison.png')});
 await load();await step(3);await page.locator('.comparison-panel>summary').click();await page.locator('[data-action=compare-refresh]').click();await expect(page.locator('.comparison-outcome')).toBeVisible();
 await page.locator('[data-comparison-use=A]').click();await step(0);await expect(page.locator('#width')).toHaveValue('500');
 record('A and B restore locally, receive current server prices and scope, and can become the current design');

 await step(3);await page.route('**/prefab/api/price',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'catalog_changed',message:'Catalogue changed during comparison'}})}));
 await page.locator('[data-action=compare-refresh]').click();await expect(page.locator('.comparison-panel .api-error')).toContainText('catalogus is gewijzigd');await expect(page.locator('.comparison-outcome')).toHaveCount(0);
 await page.unroute('**/prefab/api/price');await page.locator('[data-action=compare-refresh]').click();await expect(page.locator('.comparison-outcome')).toBeVisible();
 record('A catalogue revision race removes stale comparison totals and offers a successful retry');

 await step(0);await page.route('**/prefab/api/price',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'catalog_changed',message:'Catalogue changed'}})}));
 await page.locator('#width').fill('520');await page.locator('#depth').focus();await expect(page.locator('[data-action=reload-catalog]')).toBeVisible();
 await step(3);await expect(page.locator('.comparison-outcome')).toHaveCount(0);await step(0);await page.unroute('**/prefab/api/price');
 let releaseCatalog,requestedCatalog;const catalogGate=new Promise(resolve=>releaseCatalog=resolve),catalogStarted=new Promise(resolve=>requestedCatalog=resolve);
 await page.route('**/prefab/api/catalog',async route=>{requestedCatalog();await catalogGate;await route.continue();});
 await page.locator('[data-action=reload-catalog]').click();await catalogStarted;
 await page.locator('#width').fill('550');await page.locator('#depth').focus();releaseCatalog();
 await expect(page.locator('#toast')).toContainText('catalogus is bijgewerkt');await expect(page.locator('#width')).toHaveValue('550');await page.unroute('**/prefab/api/catalog');
 record('Normal stale-price errors invalidate comparison totals; catalog refresh preserves edits made while waiting');

 await step(0);await page.evaluate(()=>{window.__contextLoss=window.__prefabPreview.renderer.getContext().getExtension('WEBGL_lose_context');window.__contextLoss.loseContext();});
 await expect.poll(()=>page.evaluate(()=>window.__prefabPreview.getSceneInfo().webglAvailable)).toBe(false);
 await expect(page.locator('.prefab-plan')).toBeVisible();await expect(page.locator('#preview-status')).toContainText('2D');
 await step(2);await page.locator('.prefab-plan [data-option-key=outsideTap]').focus();await page.keyboard.press('Enter');await expect(page.locator('nav [aria-current=step]')).toHaveAttribute('data-step','0');expect(await page.evaluate(()=>document.activeElement.name)).toBe('outsideTap');
 await page.locator('#width').fill('530');await page.locator('#depth').focus();await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 await page.evaluate(()=>window.__contextLoss.restoreContext());await expect.poll(()=>page.evaluate(()=>window.__prefabPreview.getSceneInfo().webglAvailable)).toBe(true);
 await page.locator('[data-scene-view=perspective]').first().click();await expect(page.locator('.prefab-plan')).toBeHidden();await expect(page.locator('#width')).toHaveValue('530');
 record('Real WebGL context loss falls back to editable 2D and recovers the current design');

 await step(1);await select('interior','true');await select('plaster','true');await select('heating','both');await select('ceilingPositions','center');await select('spotPositions','r1c1');await select('spotPositions','r3c5');await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 await page.locator('details[data-group=ceiling]>summary').scrollIntoViewIfNeeded();
 if(!process.env.PREFAB_NO_SCREENSHOTS)await page.screenshot({path:join(output,'interior-eye-level.png')});
 await tool('viewpoints');await page.locator('[data-view=ceiling]').click();if(!process.env.PREFAB_NO_SCREENSHOTS)await page.screenshot({path:join(output,'interior-ceiling.png')});
 const variants=await page.evaluate(()=>{const preview=window.__prefabPreview;window.__verifiedScope=structuredClone(preview.getSceneInfo().scope);const models={heating:'heating-panel',ceilingLights:'ceiling-dome'};preview.setScope(window.__verifiedScope.map(row=>models[row.key]?{...row,assetKey:models[row.key]}:row));preview.setView('interior');return preview.getSceneInfo().fixtureStates.filter(row=>models[row.key]);});
 if(!process.env.PREFAB_NO_SCREENSHOTS)await page.screenshot({path:join(output,'interior-model-variants.png')});
 await page.evaluate(()=>window.__prefabPreview.setScope(window.__verifiedScope));
 record('Panel radiator and ceiling dome assets are inspectable',{variants,scopeOverride:'Renderer-only assetKey test; actual public scope and inclusion states unchanged. No quote or share submitted.'});

 for(const width of [360,390,768]){await page.setViewportSize({width,height:844});await step(0);await expect(page.locator('#width')).toBeInViewport();await expect(page.locator('.next-button')).toBeInViewport();await expect(page.locator('#preview-scene')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);if(width===390&&!process.env.PREFAB_NO_SCREENSHOTS)await page.screenshot({path:join(output,'mobile-workspace.png')});}
 record('360, 390 and 768 px retain the first input, scene and next action without overflow');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);

 await step(0);await select('frontOpening','none');await page.locator('#width').fill('150');await page.locator('#depth').fill('100');await page.locator('#step-title').click();
 await page.locator('details[data-group=roof] > summary').click();await expect(page.locator('input[name=rooflight][value=lean-1]')).toBeDisabled();await expect(page.locator('input[name=rooflight][value=gable-10]')).toBeDisabled();
 record('Rooflight choices expose the catalogue minimum profile instead of accepting a physically undersized roof');

 const catalog=await(await page.request.get(origin+'/prefab/api/catalog')).json();const previewCatalog={...catalog,catalogRevision:'draft-42-test',preview:{enabled:true,releaseId:42,state:'draft',canSubmit:false}};
 const admin=await browser.newPage();admin.on('pageerror',error=>errors.push(error.message));const adminRequests=[];admin.on('request',request=>{if(request.url().includes('/prefab/api/')&&!request.url().endsWith('/prefab/api/appearance'))adminRequests.push(request.url());});
 await admin.addInitScript(()=>{localStorage.setItem('cs-prefab-design-v1',JSON.stringify({config:{width:690}}));localStorage.setItem('cs-prefab-comparison-v1',JSON.stringify({A:{config:{width:690}}}));});
 await admin.route('**/prefab/admin-preview/42/catalog',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(previewCatalog)}));
 await admin.route('**/prefab/admin-preview/42/price',async route=>{const body=route.request().postDataJSON();const response=await admin.request.post(origin+'/prefab/api/price',{data:{config:body.config,catalogRevision:catalog.catalogRevision}});const value=await response.json();await route.fulfill({contentType:'application/json',body:JSON.stringify({...value,catalogRevision:previewCatalog.catalogRevision,preview:previewCatalog.preview,priceMode:'commercial',priceStatusLabel:'Catalogusprijs incl. btw',disclaimer:'Gecontroleerde catalogusprijs voor dit concept.'})});});
 await admin.goto(origin+'/prefab?catalog_preview=42');await expect(admin.locator('.admin-preview-bar')).toBeVisible();await expect(admin.locator('.price-value')).not.toHaveClass(/pending/);await expect(admin.locator('#width')).toHaveValue(String(catalog.defaults.width));
 await admin.locator('#width').fill('610');await admin.locator('#depth').focus();await expect(admin.locator('.price-value')).not.toHaveClass(/pending/);
 await admin.locator('nav [data-step="3"]').click();await expect(admin.locator('[data-action=contact]')).toBeDisabled();await expect(admin.locator('.comparison-panel')).toHaveCount(0);await expect(admin.locator('.summary-sharing')).toHaveCount(0);
 await expect(admin.locator('.price-caption')).toHaveText('Catalogusprijs incl. btw');await expect(admin.locator('.notice')).toHaveText('Gecontroleerde catalogusprijs voor dit concept.');
 expect(await admin.evaluate(()=>JSON.parse(localStorage.getItem('cs-prefab-design-v1')).config.width)).toBe(690);expect(adminRequests).toEqual([]);await admin.close();
 record('Admin draft preview uses only its read-only endpoints and never imports or overwrites a customer draft',{previewEndpointsMocked:true,realPriceEngine:true});
 expect(writes).toEqual([]);expect(errors).toEqual([]);
}catch(error){errors.push(error.message);console.error(error);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});await rm(temporary,{recursive:true,force:true});await writeFile(join(output,'results.json'),JSON.stringify({ok:errors.length===0,checks,errors,productionWrites:false},null,2)+'\n');}

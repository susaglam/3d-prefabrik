/** Local browser acceptance: real persisted quote images, retry identity and immutable live design. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {waitAssetsReady} from './wait-assets-ready.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.PREFAB_TEST_OUTPUT||join(root,'docs/verification/pdf-redesign');await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'prefab-document-proof-')),database=join(temporary,'quotes.sqlite3');
let server,browser;
const checks=[],runtimeErrors=[];
const failureOnly=process.env.PREFAB_CAPTURE_FAILURE_ONLY==='1';
const customer={firstName:'Document',lastName:'Voorbeeld',email:'document@example.invalid',phone:'0612345678',address:'Voorbeeldstraat',houseNumber:'12',postcode:'1234 AB',city:'Utrecht'};
try {
 server=spawn(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),['scripts/serve.py','--port','0','--db',database],{cwd:root,stdio:['ignore','pipe','pipe']});
 const origin=await new Promise((resolve,reject)=>{let stdout='';const timer=setTimeout(()=>reject(new Error('Local test server did not start')),15000);server.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match){clearTimeout(timer);resolve(match[1]);}});server.on('exit',code=>reject(new Error(`Local server exited ${code}`)));server.stderr.on('data',chunk=>process.stderr.write(chunk));});
 const executablePath=process.env.CHROMIUM_PATH||(existsSync(join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'))?join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'):null)||[1234,1217].map(version=>join(homedir(),`.cache/ms-playwright/chromium-${version}/chrome-linux64/chrome`)).find(existsSync);
 const browserEnv={...process.env};
 const libs=['/tmp/prefab-browser-libs/extracted/usr/lib/x86_64-linux-gnu','/tmp/cs-psk-browser-libs/extracted/usr/lib/x86_64-linux-gnu'].find(existsSync);
 if(libs)browserEnv.LD_LIBRARY_PATH=[browserEnv.LD_LIBRARY_PATH,libs].filter(Boolean).join(':');
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],env:browserEnv});
 const catalog=JSON.parse(await readFile(join(root,'addons/cs_prefab_configurator/data/catalog.json'),'utf8'));
 const anonymous={...catalog.defaults,width:620,depth:320,facade:'pvc-green',frontOpening:'sliding-4-white',rooflight:'gable-8',interior:true,plaster:true,screed:true,underfloorHeating:true,heating:'both',outsideLight:'both',outsideSocket:'double-both',outsideTap:'both',postcode:''};
 const schemaVersion=catalog.schemaVersion;
 async function fresh({fallback=false,surroundings=false}={}) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  // The omgeving in the proposal images is an admin setting on cs.prefab.appearance and reaches the browser in the
  // appearance payload. Rewriting that payload is the real path an Odoo with the box ticked would take; the
  // standalone server has the same switch behind PREFAB_DOCUMENT_SURROUNDINGS, but it is fixed at server start.
  if(surroundings)await context.route('**/prefab/api/appearance',async route=>{
   const response=await route.fetch();
   await route.fulfill({json:{...await response.json(),documentSurroundings:true}});
  });
  await context.addInitScript(({config,version,fallback})=>{
   localStorage.setItem('cs-prefab-design-v1',JSON.stringify({version,config}));
   window.__documentCaptureStarts=0;
   new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement&&node.dataset.documentCapture)window.__documentCaptureStarts++;}).observe(document,{subtree:true,childList:true});
   if(fallback){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args);};}
  },{config:anonymous,version:schemaVersion,fallback});
  const page=await context.newPage();page.on('pageerror',error=>runtimeErrors.push(error.message));
  await page.goto(`${origin}/prefab`);await page.waitForFunction(()=>window.__prefabPreview);
  await expect(page.locator('.price-value')).not.toHaveClass(/pending/);await waitAssetsReady(page);
  // The CC0 garden set swaps in asynchronously after assetsReady; without this a scene-state snapshot can
  // catch the procedural stand-in mid-swap, producing a spurious geometries/gardenSetLoaded mismatch later.
  await page.evaluate(()=>window.__prefabPreview.gardenSetReady);
  return {context,page};
 }
 async function fillForm(page){
  await page.locator('nav [data-step="3"]').click();await page.locator('[data-action="contact"]:not([disabled])').click();
  for(const[key,value]of Object.entries(customer))await page.locator(`#contact-${key}`).fill(value);
  await page.locator('input[name="consent"]').check();
 }
 const sceneState=()=>{const p=window.__prefabPreview;return {scene:p.getSceneInfo(),camera:p.camera?.position.toArray(),target:p.controls?.target.toArray()};};

 // The server saves the first request, but its response is lost. Retrying must reuse the exact image bundle.
 if(!failureOnly){
  const {context,page}=await fresh();const requests=[];let savedResult;
  await page.evaluate(()=>{const p=window.__prefabPreview;p.setView('top');p.setDimensions(false);p.setRoofVisible(false);p.setMode('2d');});
  const before=await page.evaluate(sceneState);
  await page.route('**/prefab/api/quote',async route=>{
   requests.push(route.request().postDataJSON());
   if(requests.length===1){const response=await route.fetch();savedResult=await response.json();assert.equal(response.status(),201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Test: bevestiging onderweg onderbroken.'}})});}
   else await route.continue();
  });
  await fillForm(page);await page.locator('#quote-form [type="submit"]').click();
  await expect(page.locator('#quote-error')).toContainText('onderbroken',{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__documentCaptureStarts),1);
  await page.locator('#quote-form [type="submit"]').click();await expect(page.locator('.success-state')).toBeVisible({timeout:30000});
  assert.equal(requests.length,2);assert.equal(requests[0].idempotencyKey,requests[1].idempotencyKey);
  assert.deepEqual(requests[0].visuals,requests[1].visuals);assert.equal(requests[0].visuals.views.length,6);
  assert.equal(await page.evaluate(()=>window.__documentCaptureStarts),1);
  assert.deepEqual(before,await page.evaluate(sceneState));assert.equal(await page.locator('[data-document-capture]').count(),0);
  await expect(page.locator('.success-state')).toContainText(savedResult.reference);
  const pdf=await page.request.get(`${origin}${savedResult.pdfUrl}`);assert.equal(pdf.status(),200);assert.equal((await pdf.body()).subarray(0,5).toString(),'%PDF-');
  if(!process.env.PREFAB_NO_SCREENSHOTS)await page.screenshot({path:join(output,'browser-document-success.png'),fullPage:true});
  checks.push({name:'Six actual JPEG views persist; lost-response retry reuses one capture and one quote; live preview unchanged',passed:true,captureCount:1,views:requests[0].visuals.views.map(({id,width,height})=>({id,width,height}))});
  await context.close();
 }

 // Hold canonical validation, then edit the live design. The submitted document must retain its original geometry.
 if(!failureOnly){
  const {context,page}=await fresh();let hold=false,releaseValidation,validationArrived;
  const arrived=new Promise(resolve=>validationArrived=resolve),gate=new Promise(resolve=>releaseValidation=resolve);let payload;
  await page.route('**/prefab/api/price',async route=>{if(hold){hold=false;validationArrived();await gate;}await route.continue();});
  await page.route('**/prefab/api/quote',async route=>{payload=route.request().postDataJSON();await route.continue();});
  await fillForm(page);hold=true;await page.locator('#quote-form [type="submit"]').click();await arrived;
  await page.locator('.modal-head [data-action="close-modal"]').click();await page.locator('nav [data-step="0"]').click();
  await page.locator('#width').fill('630');await page.locator('#depth').focus();releaseValidation();
  await expect(page.locator('.success-state')).toBeVisible({timeout:30000});
  assert.equal(payload.config.width,620);assert.equal(JSON.parse(payload.visuals.configKey).width,620);
  assert.equal(await page.evaluate(()=>window.__prefabPreview.getSceneInfo().width),6.3);
  await page.locator('.modal-head [data-action="close-modal"]').click();await page.locator('nav [data-step="3"]').click();
  await page.locator('[data-action="contact"]:not([disabled])').click();await expect(page.locator('#quote-form')).toBeVisible();
  checks.push({name:'Editing during validation preserves submitted 620 cm snapshot and current 630 cm draft independently',passed:true});await context.close();
 }

 if(!failureOnly){
  const {context,page}=await fresh({fallback:true});let payload;
  await page.route('**/prefab/api/quote',async route=>{payload=route.request().postDataJSON();await route.continue();});
  await fillForm(page);await page.locator('#quote-form [type="submit"]').click();
  await expect(page.locator('.success-state')).toBeVisible({timeout:30000});
  assert.deepEqual(payload.visuals.views.map(view=>view.id),['plan','front','side']);
  assert.deepEqual(payload.visuals.missingViews,['perspective-left','perspective-right','interior']);
  await expect(page.locator('.document-status')).toContainText('kon de 3D-aanzichten niet vastleggen');
  checks.push({name:'Actual WebGL failure still saves three technical drawings with explicit fallback notice',passed:true});await context.close();
 }
 {
  const {context,page}=await fresh();const requests=[];
  await page.route('**/prefab/api/quote',async route=>{requests.push(route.request().postDataJSON());await route.continue();});
  await page.evaluate(()=>{
   const original=CanvasRenderingContext2D.prototype.drawImage;
   window.__restoreDocumentDrawing=()=>CanvasRenderingContext2D.prototype.drawImage=original;
   CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
    if(source instanceof HTMLImageElement&&++window.__technicalImageCount===window.__failedTechnicalImage)throw new Error('Deliberate technical rasterization failure');
    return original.call(this,source,...args);
   };
  });
  await fillForm(page);
  for(const [index,id] of ['plan','front','side'].entries()) {
   await page.evaluate(index=>{window.__technicalImageCount=0;window.__failedTechnicalImage=index+1;},index);
   await page.locator('#quote-form [type="submit"]').click();
   await expect(page.locator('#quote-error')).toContainText('technische tekeningen konden niet volledig',{timeout:30000});
   assert.equal(requests.length,0,`Missing ${id} must not save an incomplete proposal`);
   await expect(page.locator('#quote-form [type="submit"]')).toBeEnabled();
   assert.equal(await page.locator('#contact-email').inputValue(),customer.email);
  }
  await page.evaluate(()=>window.__restoreDocumentDrawing());await page.locator('#quote-form [type="submit"]').click();
  await expect(page.locator('.success-state')).toBeVisible({timeout:30000});
  assert.equal(requests.length,1);assert.equal(requests[0].visuals.views.length,6);
  assert.equal(await page.evaluate(()=>window.__documentCaptureStarts),4);
  checks.push({name:'Missing plan, front or side drawing blocks submission; retry recaptures successfully without losing contact data',passed:true});
  await context.close();
 }
 /**
  * What is IN a proposal image, read off the captured JPEG itself.
  *
  * The customer's report was about the pictures, so the assertions are about the pictures: a flag that is set and a
  * group whose `.visible` is false are both one step short of the thing they were reported about. Everything below
  * comes out of `captureDocumentViews` — the same function the submit path calls, with the same isolated renderer —
  * and is then decoded and counted pixel by pixel.
  *
  *   green     the lawn, the beplanting and the schutting foliage. Measured 0,000 % in 9 of 9 proposal images with
  *             the omgeving off, and 0,384 % on the interior beeld with it on, so the check can also fail.
  *   span      how far the subject's silhouette reaches across the frame, the silhouette being whatever the studio
  *             flood could not reach from the edge. The camera fits the aanbouw's own volume and then touches the
  *             frame with it, so this is ~1 — measured 0,981 at worst across the catalogue's extremes.
  *   topMean   the average brightness of the top 8 % of the frame. Paper above the roof reads 222-243; the brick of
  *             the bestaande woning reads 99-102. It is the single number that says whether a house is standing
  *             behind the aanbouw, and the two populations are 120 levels apart.
  *   share     who occupies the frame, by ray per cell through the capture's own camera. With the omgeving off the
  *             omgeving is 0,00 % of every image; the aanbouw, its terras and the kamer erachter take 72,7-79,6 %
  *             on a 620 and a 750 and 36,4-53,7 % on a 150 cm unit. Before this change the same 620 × 320
  *             tuinperspectief gave the aanbouw 49,1 % and spent 27,3 % on de woning en het gras.
  */
 if(!failureOnly) {
  const pixelsOf=async (page,views)=>page.evaluate(async views=>{
   const out={};
   for(const view of views) {
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=view.dataUrl;});
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    const {data}=context.getImageData(0,0,canvas.width,canvas.height),W=canvas.width,H=canvas.height;
    const lum=new Float32Array(W*H);
    let green=0,total=0,topSum=0,topCount=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
     const p=y*W+x,i=p*4,r=data[i],g=data[i+1],b=data[i+2];total++;
     if(g>r*1.12&&g>b*1.32&&g>85)green++;
     lum[p]=.2126*r+.7152*g+.0722*b;
     if(y<Math.round(H*.08)){topSum+=lum[p];topCount++;}
    }
    // The subject's silhouette, found by flooding the studio in from the frame edge instead of guessing at the
    // product's own colours: a dark-pixel box measures baksteen zwart and stucwerk wit as two different buildings.
    // The studio is the only smooth, bright surface touching the border; the terras is darker than any seed.
    const background=new Uint8Array(W*H),queue=[];
    const seed=p=>{if(!background[p]&&lum[p]>190){background[p]=1;queue.push(p);}};
    for(let x=0;x<W;x++){seed(x);seed((H-1)*W+x);}
    for(let y=0;y<H;y++){seed(y*W);seed(y*W+W-1);}
    for(let head=0;head<queue.length;head++) {
     const p=queue[head],x=p%W,y=(p-x)/W;
     for(const q of [x>0?p-1:-1,x<W-1?p+1:-1,y>0?p-W:-1,y<H-1?p+W:-1])
      if(q>=0&&!background[q]&&lum[q]>190&&Math.abs(lum[q]-lum[p])<8){background[q]=1;queue.push(q);}
    }
    let minX=W,maxX=-1,minY=H,maxY=-1,studio=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
     const p=y*W+x;
     if(background[p]){studio++;continue;}
     if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
    out[view.id]={green:+(green/total*100).toFixed(3),
     span:maxX<0?0:+Math.max((maxX-minX+1)/W,(maxY-minY+1)/H).toFixed(3),
     subject:+((total-studio)/total*100).toFixed(2),
     topMean:+(topSum/topCount).toFixed(1)};
   }
   return out;
  },views);
  const capture=async (page,config)=>page.evaluate(async config=>{
   const {captureDocumentViews}=await import('/cs_prefab_configurator/static/src/document_capture.js');
   const {getFeatures}=await import('/cs_prefab_configurator/static/src/theme.js');
   const bundle=await captureDocumentViews({...window.__prefabPreview.config,...config},{width:720,height:480});
   return {setting:getFeatures().documentSurroundings,missing:bundle.missingViews,
    views:bundle.views.filter(view=>['perspective-left','perspective-right','interior'].includes(view.id))
     .map(({id,dataUrl})=>({id,dataUrl}))};
  },config);
  const spatial=['perspective-left','perspective-right','interior'];
  // The catalogue's default and its two extremes: a 150 × 100 unit is taller than it is wide and frames nothing
  // like a 750 × 340 one, so a framing budget that only ever saw one size would prove nothing.
  // Baksteen rood, not this file's pvc-groen: a green product would make the grass counter ambiguous, and an
  // ambiguous counter is one somebody quietly loosens later. Measured, pvc-groen leaks 0,001 % into it.
  const designs=[['620 × 320 cm',{width:620,depth:320,facade:'brick-red'}],
   ['150 × 100 cm',{width:150,depth:100,facade:'brick-red'}],
   ['750 × 340 cm',{width:750,depth:340,facade:'brick-red'}]];
  const {context,page}=await fresh();
  await page.evaluate(()=>window.__prefabPreview.gardenSetReady);
  const plain={};
  for(const [label,config] of designs) {
   const bundle=await capture(page,config);
   assert.equal(bundle.setting,false,'a website that never chose shows the aanbouw alone');
   assert.deepEqual(bundle.missing,[],`${label}: every proposal image was captured`);
   assert.deepEqual(bundle.views.map(view=>view.id),spatial,label);
   const pixels=await pixelsOf(page,bundle.views);
   for(const id of spatial) {
    assert.ok(pixels[id].green<=.02,`${label} ${id}: no grass, no beplanting and no schutting in a proposal image (${pixels[id].green} %)`);
    assert.ok(pixels[id].span>=.95,`${label} ${id}: the aanbouw reaches the frame edge (${pixels[id].span})`);
    assert.ok(pixels[id].topMean>=125,`${label} ${id}: paper above the roof, not a house (${pixels[id].topMean})`);
   }
   plain[label]={views:bundle.views,pixels};
  }
  // And the share of the frame each thing occupies, sampled by shooting a ray per cell through the SAME camera
  // setDocumentView gives the capture. The flood above cannot answer this — it measures one silhouette, not who is
  // in it — and the answer is the whole point of the customer's report: how much of the picture was the woning,
  // the tuin and het gras, and how much was the aanbouw they are being asked to buy.
  for(const [label,config] of designs) {
   const shares=await page.evaluate(async config=>{
    const THREE=await import('/cs_prefab_configurator/static/vendor/three.module.js');
    const p=window.__prefabPreview;
    p.update({...p.config,...config});await p.assetsReady;
    /**
     * One bucket per THING, not per group, and the woning gets its own.
     *
     * The version this replaces had four buckets and folded `existing-room-*` into a bucket called `kamer` which
     * was then ADDED to the aanbouw and the terras to make one "product" number. So the bestaande woning's living
     * room counted as product, and the only equality the gate asserted — `omgeving === 0` — was about a GROUP the
     * room did not hang from. The gate therefore passed at full green while the woning's rear lining stood above
     * the daktrim in both tuinperspectieven (3,36 % of the frame) and its floor was 22,08 % of het beeld zonder
     * dak. That is the defect the customer reported, measured by the gate that was supposed to prevent it, and
     * reported as a pass. A bucket that is summed with the product can never fail for containing the woning.
     *
     * So: `woning` is every surface of the bestaande woning that is NOT inside the omgeving group, and it is
     * asserted at zero on its own. `doorbraak` is the half metre of opening that legitimately stays
     * (DOORBRAAK_REVEAL in preview.js) and is asserted under a ceiling of its own, so it can never grow back into
     * a room. Neither is ever added to the product number again.
     */
    const bucketOf=object=>{
     const names=[];for(let node=object;node&&node!==p.root;node=node.parent)if(node.name)names.unshift(node.name);
     const path=names.join('/');
     if(path.startsWith('surroundings'))return 'omgeving';
     if(path.startsWith('studio-ground'))return 'studio';
     // Before `woning`: the opening's own five surfaces, and the strip of vloerafwerking that runs through it.
     if(/doorbraak/.test(path))return 'doorbraak';
     // The woning wherever it hangs. `existing-` is the room, `house-` its walls and roof, `neighbour` de buren,
     // and `floor-finish-house` the laminaat laid over the room's floor by buildFloorFinish.
     if(/(^|\/)(existing-|house-|neighbour)|floor-finish-house/.test(path))return 'woning';
     if(/(^|\/)terrace/.test(path))return 'terras';
     return 'aanbouw';
    };
    const out={};let doorbraakDepth=0;
    for(const view of ['perspective-left','perspective-right','interior']) {
     p.setDocumentView(view);
     const raycaster=new THREE.Raycaster(),point=new THREE.Vector2(),counts={},cols=48,rows=32;
     for(let y=0;y<rows;y++)for(let x=0;x<cols;x++) {
      point.set((x+.5)/cols*2-1,-((y+.5)/rows*2-1));
      raycaster.setFromCamera(point,p.camera);
      const hit=raycaster.intersectObject(p.root,true).find(candidate=>{
       for(let node=candidate.object;node;node=node.parent)if(!node.visible)return false;
       return !candidate.object.material?.userData?.glazing;
      });
      const bucket=hit?bucketOf(hit.object):'lucht';
      counts[bucket]=(counts[bucket]||0)+1;
     }
     out[view]=Object.fromEntries(Object.entries(counts).map(([key,n])=>[key,+(n/(cols*rows)*100).toFixed(2)]));
     // How far the drawn doorbraak reaches behind the house wall, in the view without a roof.
     if(view==='interior')p.root.traverse(object=>{
      if(!object.isMesh)return;
      const names=[];let drawn=true;for(let node=object;node&&node!==p.root;node=node.parent){if(node.name)names.unshift(node.name);if(!node.visible)drawn=false;}
      if(drawn&&/doorbraak/.test(names.join('/')))doorbraakDepth=Math.max(doorbraakDepth,p.model.bounds.back-new THREE.Box3().setFromObject(object).min.z);
     });
    }
    return {views:out,doorbraakDepth};
   },config);
   for(const [view,share] of Object.entries(shares.views)) {
    // The customer's request, exactly: not one cell of a proposal image is de woning, de buren, het gras, de
    // schutting, de tuinset or de inrichting. Two equalities, not a budget, because a budget is a number somebody
    // loosens. The first covers everything inside the omgeving group; the second covers the woning wherever else
    // it may be hanging, which is precisely how the room came to be in the picture while the first one passed.
    assert.equal(share.omgeving||0,0,`${label} ${view}: no woning, buren, gras, schutting or inrichting in the frame`);
    assert.equal(share.woning||0,0,`${label} ${view}: no surface of the bestaande woning outside that group either (${share.woning||0} %)`);
    // The doorbraak is not the woning and it is not the product: it is the opening in between, kept so a full-width
    // hole reads as an opening (DOORBRAAK_REVEAL, 55 cm). Half a metre of it is architecture; a room of it is the
    // defect. In the two tuinperspectieven its share of the frame says which: measured 0-8,66 % across this sweep
    // and every corner of the catalogue (2.18.4), under a ceiling of 12 %.
    // Not in "Een blik naar binnen". Until 2.18.4 that image was a close-up of the floor (the room limit of the
    // binnenweergave pulled the document camera into the room, see preview.js clampCamera), and the 12 % was set
    // against it: its "0,20 %" is what a floor close-up shows. Framed again, from above with the roof off, the
    // reveal's closing face stands square to the camera and takes 5,5-20,6 % of the frame (probe, 2.18.4) — the
    // full room took 22,08 %. A pixel share cannot tell those apart there, so that view holds the doorbraak by what
    // "not a second room" means: it reaches no further than 0,60 m behind the house wall, where a room is metres.
    if(view==='interior')assert.ok(shares.doorbraakDepth<=.6,`${label} interior: the doorbraak is an opening, not a second room (${shares.doorbraakDepth.toFixed(2)} m deep)`);
    else assert.ok((share.doorbraak||0)<=12,`${label} ${view}: the doorbraak is an opening, not a second room (${share.doorbraak||0} %)`);
    // A loose floor under the product itself, to catch a camera that starts pulling back again. The doorbraak and
    // the woning are deliberately NOT in this sum — a product number that a non-product can lift is not a product
    // number. It is deliberately low: what sets the ceiling here is the aanbouw's own proportions against a 3:2
    // frame, not the framing. The framing itself is pinned exactly, and size-independently, in
    // tests/frontend/document_views.test.mjs: the aanbouw's own volume is contained in the frame AND touches its
    // edge, so no distance is ever spent on anything else.
    const product=(share.aanbouw||0)+(share.terras||0);
    assert.ok(product>=30,`${label} ${view}: the aanbouw and its terras fill the frame (${product.toFixed(1)} %)`);
    plain[label].pixels[view].share=share;
   }
  }
  await context.close();

  const withGarden=await fresh({surroundings:true});
  await withGarden.page.evaluate(()=>window.__prefabPreview.gardenSetReady);
  const garden=await capture(withGarden.page,designs[0][1]);
  assert.equal(garden.setting,true,'the appearance payload carries the administrator\'s choice to the capture');
  const gardenPixels=await pixelsOf(withGarden.page,garden.views);
  assert.ok(gardenPixels.interior.green>.1,`the omgeving really is back (${gardenPixels.interior.green} % groen)`);
  for(const id of spatial)assert.ok(gardenPixels[id].topMean<=120,`${id}: the bestaande woning is back above the roof (${gardenPixels[id].topMean})`);
  // Same design, same views, two settings: the images must actually differ, or the switch changed nothing.
  const changed=await withGarden.page.evaluate(async ({a,b})=>{
   const load=async url=>{
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    canvas.getContext('2d').drawImage(image,0,0);
    return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   };
   const out={};
   for(const id of Object.keys(a)) {
    const [x,y]=await Promise.all([load(a[id]),load(b[id])]);
    let differ=0,total=0;
    for(let i=0;i<x.length;i+=4){total++;if(Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2])>36)differ++;}
    out[id]=+(differ/total*100).toFixed(2);
   }
   return out;
  },{a:Object.fromEntries(plain['620 × 320 cm'].views.map(v=>[v.id,v.dataUrl])),
     b:Object.fromEntries(garden.views.map(v=>[v.id,v.dataUrl]))});
  for(const id of spatial)assert.ok(changed[id]>15,`${id}: the setting changes the picture (${changed[id]} % of pixels)`);
  await withGarden.context.close();
  checks.push({name:'Captured proposal images contain no omgeving by default, fill the frame at every catalogue size, and the admin setting brings the omgeving back',
   passed:true,defaultOff:Object.fromEntries(Object.entries(plain).map(([label,{pixels}])=>[label,pixels])),
   withSurroundings:gardenPixels,changedPixelsPct:changed});
 }

 const queried=spawnSync(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),['-c','import json,sqlite3,sys; db=sqlite3.connect(sys.argv[1]); print(json.dumps([{"width":s["config"]["width"],"views":len(s.get("visuals",{}).get("views",[]))} for (raw,) in db.execute("SELECT snapshot_json FROM quotes ORDER BY id") for s in [json.loads(raw)]]))',database],{encoding:'utf8'});
 assert.equal(queried.status,0,queried.stderr);const saved=JSON.parse(queried.stdout);
 assert.deepEqual(saved,failureOnly?[{width:620,views:6}]:[{width:620,views:6},{width:620,views:6},{width:620,views:3},{width:620,views:6}]);
 assert.deepEqual(runtimeErrors,[]);
 checks.push({name:'SQLite proves immutable snapshots and no duplicate row after retry',passed:true,saved});
 await writeFile(join(output,failureOnly?'browser-document-failure-checks.json':'browser-document-checks.json'),JSON.stringify({ok:true,checks,runtimeErrors,productionWrites:false},null,2)+'\n');
 console.log(JSON.stringify({ok:true,checks:checks.map(check=>check.name),runtimeErrors},null,2));
} finally {
 await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;}await rm(temporary,{recursive:true,force:true});
}

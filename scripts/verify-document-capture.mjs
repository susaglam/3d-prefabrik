/** Local browser acceptance: real persisted quote images, retry identity and immutable live design. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'docs/verification/pdf-redesign');await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'prefab-document-proof-')),database=join(temporary,'quotes.sqlite3');
let server,browser;
const checks=[],runtimeErrors=[];
const failureOnly=process.env.PREFAB_CAPTURE_FAILURE_ONLY==='1';
const customer={firstName:'Document',lastName:'Voorbeeld',email:'document@example.invalid',phone:'0612345678',address:'Voorbeeldstraat',houseNumber:'12',postcode:'1234 AB',city:'Utrecht'};
try {
 server=spawn('python3',['scripts/serve.py','--port','0','--db',database],{cwd:root,stdio:['ignore','pipe','pipe']});
 const origin=await new Promise((resolve,reject)=>{let stdout='';const timer=setTimeout(()=>reject(new Error('Local test server did not start')),15000);server.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match){clearTimeout(timer);resolve(match[1]);}});server.on('exit',code=>reject(new Error(`Local server exited ${code}`)));server.stderr.on('data',chunk=>process.stderr.write(chunk));});
 const executablePath=process.env.CHROMIUM_PATH||[1234,1217].map(version=>join(homedir(),`.cache/ms-playwright/chromium-${version}/chrome-linux64/chrome`)).find(existsSync);
 const browserEnv={...process.env};
 const libs=['/tmp/prefab-browser-libs/extracted/usr/lib/x86_64-linux-gnu','/tmp/cs-psk-browser-libs/extracted/usr/lib/x86_64-linux-gnu'].find(existsSync);
 if(libs)browserEnv.LD_LIBRARY_PATH=[browserEnv.LD_LIBRARY_PATH,libs].filter(Boolean).join(':');
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],env:browserEnv});
 const catalog=JSON.parse(await readFile(join(root,'addons/cs_prefab_configurator/data/catalog.json'),'utf8'));
 const anonymous={...catalog.defaults,width:620,depth:320,facade:'pvc-green',frontOpening:'sliding-4-white',rooflight:'gable-8',interior:true,plaster:true,screed:true,postcode:''};
 const schemaVersion=catalog.schemaVersion;
 async function fresh({fallback=false}={}) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(({config,version,fallback})=>{
   localStorage.setItem('cs-prefab-design-v1',JSON.stringify({version,config}));
   window.__documentCaptureStarts=0;
   new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLElement&&node.dataset.documentCapture)window.__documentCaptureStarts++;}).observe(document,{subtree:true,childList:true});
   if(fallback){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:original.call(this,type,...args);};}
  },{config:anonymous,version:schemaVersion,fallback});
  const page=await context.newPage();page.on('pageerror',error=>runtimeErrors.push(error.message));
  await page.goto(`${origin}/prefab`);await page.waitForFunction(()=>window.__prefabPreview);
  await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
  return {context,page};
 }
 async function fillForm(page){
  await page.locator('nav [data-step="6"]').click();await page.locator('[data-action="contact"]:not([disabled])').click();
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
  await page.screenshot({path:join(output,'browser-document-success.png'),fullPage:true});
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
  await page.locator('.modal-head [data-action="close-modal"]').click();await page.locator('nav [data-step="6"]').click();
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
 const queried=spawnSync('python3',['-c','import json,sqlite3,sys; db=sqlite3.connect(sys.argv[1]); print(json.dumps([{"width":s["config"]["width"],"views":len(s.get("visuals",{}).get("views",[]))} for (raw,) in db.execute("SELECT snapshot_json FROM quotes ORDER BY id") for s in [json.loads(raw)]]))',database],{encoding:'utf8'});
 assert.equal(queried.status,0,queried.stderr);const saved=JSON.parse(queried.stdout);
 assert.deepEqual(saved,failureOnly?[{width:620,views:6}]:[{width:620,views:6},{width:620,views:6},{width:620,views:3},{width:620,views:6}]);
 assert.deepEqual(runtimeErrors,[]);
 checks.push({name:'SQLite proves immutable snapshots and no duplicate row after retry',passed:true,saved});
 await writeFile(join(output,failureOnly?'browser-document-failure-checks.json':'browser-document-checks.json'),JSON.stringify({ok:true,checks,runtimeErrors,productionWrites:false},null,2)+'\n');
 console.log(JSON.stringify({ok:true,checks:checks.map(check=>check.name),runtimeErrors},null,2));
} finally {
 await browser?.close();server?.kill();await rm(temporary,{recursive:true,force:true});
}

/** Independent interaction regressions. Quote requests are intercepted; no quote/email is sent. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const origin=process.env.PREFAB_TEST_ORIGIN||'http://127.0.0.1:8078';
const executablePath=process.env.CHROMIUM_PATH||process.env.PREFAB_CHROMIUM||[join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),join(homedir(),'.cache/ms-playwright/chromium-1217/chrome-linux64/chrome')].find(existsSync);
const output=new URL('../docs/verification/',import.meta.url);await mkdir(output,{recursive:true});
const sourceFiles=['app.js','model.js','geometry.js'];
async function hashes(){return Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,createHash('sha256').update(await readFile(new URL(`../addons/cs_prefab_configurator/static/src/${name}`,import.meta.url))).digest('hex')])));}
const before=await hashes();
const browserEnv={...process.env},localLib='/tmp/cs-psk-browser-libs/extracted/usr/lib/x86_64-linux-gnu';
if(existsSync(localLib))browserEnv.LD_LIBRARY_PATH=[browserEnv.LD_LIBRARY_PATH,localLib].filter(Boolean).join(':');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],env:browserEnv});
const checks=[];
const schemaVersion=JSON.parse(await readFile(new URL('../addons/cs_prefab_configurator/data/catalog.json',import.meta.url))).schemaVersion;
async function check(name,fn) {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 try{const details=await fn(page,context);assert.deepEqual(pageErrors,[],'No browser runtime errors');checks.push({name,ok:true,details});console.log(`PASS ${name}`);}
 catch(error){checks.push({name,ok:false,error:error.message,pageErrors});console.error(`FAIL ${name}: ${error.message}`);}
 finally{await context.close();}
}
async function loaded(page,path='/prefab') {
 await page.goto(`${origin}${path}`);await page.waitForFunction(()=>window.__prefabPreview,{timeout:20000});
 await page.locator('.price-value:not(.pending)').waitFor({timeout:15000});
}
async function contactForm(page){await page.locator('nav [data-step="3"]').click();await page.locator('[data-action="contact"]:not([disabled])').click();}
async function fillContact(page) {
 const values={firstName:'Audit',lastName:'Review',email:'audit@example.test',phone:'+31612345678',address:'Voorbeeldstraat',houseNumber:'12',postcode:'1234 AB',city:'Utrecht'};
 for(const[key,value]of Object.entries(values))await page.locator(`#contact-${key}`).fill(value);
 await page.locator('input[name=consent]').check();
}
try{
 await check('native radio arrows and counters keep focus after rerender',async page=>{
  await loaded(page);await page.locator('nav [data-step="0"]').click();
  await page.locator('input[name=facade]').first().focus();await page.keyboard.press('ArrowRight');
  let focus=await page.evaluate(()=>({name:document.activeElement.name,value:document.activeElement.value}));assert.deepEqual(focus,{name:'facade',value:'brick-black'});
  await page.keyboard.press('ArrowRight');focus=await page.evaluate(()=>({name:document.activeElement.name,value:document.activeElement.value}));assert.deepEqual(focus,{name:'facade',value:'brick-white'});
  await page.locator('nav [data-step="1"]').click();await page.locator('input[name=interior][value=true]').check();
  await page.locator('details[data-group=wall] > summary').click();await page.locator('[data-count=switches][data-delta="1"]').click();assert.equal(await page.locator('#switches').inputValue(),'1');
  const counter=await page.evaluate(()=>({key:document.activeElement.dataset.count,delta:document.activeElement.dataset.delta}));assert.deepEqual(counter,{key:'switches',delta:'1'});
  await page.keyboard.press('Enter');assert.equal(await page.locator('#switches').inputValue(),'2');
  return {radio:focus,counter,switches:2};
 });
 await check('edited shared design survives reload as a private local draft',async page=>{
  await loaded(page);
  const shared=await page.evaluate(async()=>{const catalog=await(await fetch('/prefab/api/catalog')).json();return await(await fetch('/prefab/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{...catalog.defaults,width:430}})})).json();});
  assert.ok(shared.url);await loaded(page,shared.url);assert.equal(await page.locator('#width').inputValue(),'430');
  await page.locator('#width').fill('610');await page.locator('#depth').focus();
  assert.equal(new URL(page.url()).searchParams.has('share'),false);
  await loaded(page);assert.equal(await page.locator('#width').inputValue(),'610');
  return {sharedWidth:430,editedWidth:610,restoredWidth:610,queryDetached:true};
 });
 await check('closed or replaced quote dialog tolerates an asynchronous API failure',async page=>{
  await loaded(page);await contactForm(page);await fillContact(page);
  let pending;const gate=new Promise(resolve=>pending=resolve);
  await page.route('**/prefab/api/quote',async route=>{pending();await new Promise(resolve=>setTimeout(resolve,1000));await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Deliberate offline review'}})});});
  await page.locator('#quote-form [type=submit]').click();await gate;
  await page.locator('[data-action=close-modal]').first().click();await page.locator('[data-action=privacy]').first().click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Deliberate offline review'));
  assert.equal(await page.locator('#modal-title').innerText(),'Over je gegevens');
  const saved=await page.evaluate(()=>localStorage.getItem('cs-prefab-design-v1'));assert.ok(!saved?.includes('audit@example.test'));
  return {quoteRequestIntercepted:true,privacyDialogPreserved:true,contactAbsentFromLocalDraft:true};
 });
 await check('a failed price connection recovers on the next edit',async page=>{
  await page.route('**/prefab/api/price',route=>route.abort('failed'));
  await loaded(page);assert.equal(await page.locator('.price-value').innerText(),'Niet beschikbaar');
  await page.unroute('**/prefab/api/price');await page.locator('#width').fill('620');await page.locator('#depth').focus();
  await page.waitForFunction(()=>document.querySelector('.price-value')?.textContent.includes('€'));
  assert.equal(await page.locator('#width').inputValue(),'620');
  assert.equal(await page.evaluate(()=>window.__prefabPreview.getSceneInfo().width),6.2);
  return {failedStateVisible:true,recoveredWidth:620,priceRestored:true};
 });
 await check('review summary edit links return to the selected section',async page=>{
  await loaded(page);await page.locator('nav [data-step="3"]').click();
  await page.locator('.summary-section [data-step="0"]').click();
  assert.equal(await page.locator('nav [aria-current=step]').getAttribute('data-step'),'0');
  assert.ok(await page.locator('input[name=facade]').count()>0);
  return {targetStep:0,facadeChoicesVisible:true};
 });
 await check('malformed draft is sanitized and smallest valid geometry matches the price dimensions',async(page,context)=>{
  await context.addInitScript(version=>localStorage.setItem('cs-prefab-design-v1',JSON.stringify({version,config:{width:150,depth:100,frontOpening:'none',piles:5,postcode:'1234 AB',contact:{email:'hidden@example.test'},facade:'<img src=x>'}})),schemaVersion);
  await loaded(page);assert.equal(await page.locator('#width').inputValue(),'150');assert.equal(await page.locator('#depth').inputValue(),'100');
  const geometry=await page.evaluate(()=>window.__prefabPreview.getSceneInfo());assert.equal(geometry.width,1.5);assert.equal(geometry.depth,1);assert.equal(geometry.area,1.5);
  await page.locator('nav [data-step="2"]').click();assert.equal(await page.locator('input[name=piles]:checked').inputValue(),'3');
  assert.match(await page.locator('.price-value').innerText(),/€/);
  return {width:1.5,depth:1,area:1.5,invalidPilesRestoredToDefault:3};
 });
}finally{await browser.close();}
const after=await hashes();const outcome={ok:checks.every(check=>check.ok),origin,sourceHashesBefore:before,sourceHashesAfter:after,sourceStable:JSON.stringify(before)===JSON.stringify(after),checks,realQuoteRequests:0,realShareRecordsCreated:1};
await writeFile(new URL('interactions-review.json',output),JSON.stringify(outcome,null,2)+'\n');
if(!outcome.ok)process.exitCode=1;

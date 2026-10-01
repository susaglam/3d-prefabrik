/** 2.4 acceptance; all public quote/share writes are blocked, isolated local data only. */
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {verifyCameraUI} from './camera-ui-checks.mjs';
import {waitAssetsReady} from './wait-assets-ready.mjs';
const output=process.env.PREFAB_TEST_OUTPUT||'docs/verification/2.4';await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'prefab-usability-'));
const result={at:new Date().toISOString(),checks:[],errors:[],writes:[],screenshots:[]};
const record=(name,detail={})=>{result.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
let browser,server;
try{
 let origin=process.env.PREFAB_TEST_ORIGIN;
 if(!origin){server=spawn(process.platform==='win32'?'python':'python3',['scripts/serve.py','--port','0','--db',join(temporary,'qa.sqlite3')],{stdio:['ignore','pipe','pipe']});origin=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Server start timed out')),15000);server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('exit',code=>reject(new Error('Server exited '+code)));
  // Every request logs a line to stderr; on Windows the pipe is small (~64KB) and unread bytes never drain on their
  // own. Once it fills, the write blocks INSIDE Python's logging module while it holds that module's global lock,
  // so every other thread's next log call (i.e. its next response) blocks behind it too - the server goes
  // permanently deaf to all requests, not just slow. Confirmed by reproduction: a plain `http.get()` from an
  // unrelated connection also hung, and the process's own threads sat at ~0% CPU in Wait state, not spinning -
  // this is that pipe/lock deadlock, not a browser, WebGL or asset problem. Draining stderr here is the fix.
  server.stderr.on('data',chunk=>{if(String(chunk).includes('Traceback'))console.error(String(chunk));});
 });}
 result.origin=origin;
 const executablePath=process.env.CHROMIUM_PATH||[join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome')].find(existsSync);
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',error=>result.errors.push(error.message));
 await page.route(/\/prefab\/api\/(quote|share)$/,route=>{result.writes.push(route.request().url());return route.abort();});
 const catalog=await(await context.request.get(origin+'/prefab/api/catalog')).json();
 const priced=async config=>{const response=await context.request.post(origin+'/prefab/api/price',{headers:{Origin:origin},data:{config:{...catalog.defaults,...config},catalogRevision:catalog.catalogRevision}});expect(response.status()).toBe(200);return response.json();};
 const ready=async()=>{await page.waitForFunction(()=>window.__prefabPreview);await waitAssetsReady(page);await expect(page.locator('.price-value')).not.toHaveClass(/pending/);await expect(page.locator('#panel-footer .api-error')).toHaveCount(0);};
 const load=async config=>{await page.goto(origin+'/prefab');await page.evaluate(({config,version})=>{localStorage.setItem('cs-prefab-design-v1',JSON.stringify({version,config}));localStorage.removeItem('cs-prefab-comparison-v1');},{config,version:catalog.schemaVersion});await page.reload();await ready();};
 const open=async key=>{const group=page.locator('details[data-group="'+key+'"]');if(await group.count()&&await group.getAttribute('open')===null)await group.locator(':scope > summary').click();};
 const option=(key,id)=>page.locator('input[name="'+key+'"][value="'+id+'"]');
 const select=async(key,id)=>{const input=option(key,id),details=input.locator('xpath=ancestor::details[1]');if(await details.count()&&await details.getAttribute('open')===null)await details.locator(':scope > summary').click();await input.locator('..').click();await ready();};
 const shot=async name=>{if(!process.env.PREFAB_NO_SCREENSHOTS){if(name!=='mobile-spot-controls.png')await expect(page.locator('#toast')).not.toHaveClass(/visible/,{timeout:8000});await page.screenshot({path:join(output,name),animations:'disabled'});result.screenshots.push(name);}};

 await load((await priced({frontOpening:'sliding-2-black',rooflight:'none'})).config);
 expect(await page.locator('#width').getAttribute('min')).toBe('230');expect(await page.locator('[data-range=width]').getAttribute('min')).toBe('230');
 await page.locator('[data-range=width]').evaluate(el=>{el.value='150';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await ready();await expect(page.locator('#width')).toHaveValue('230');await expect(option('frontOpening','sliding-4-black')).toBeDisabled();
 await page.locator('#width').fill('200');await page.locator('#width').dispatchEvent('change');await ready();await expect(page.locator('#width')).toHaveValue('230');await expect(page.locator('#toast')).toContainText('230');
 await expect(page.locator('[data-adjust=width][data-delta="-10"]')).toBeDisabled();
 await select('frontOpening','none');await expect(page.locator('[data-range=width]')).toHaveAttribute('min','150');
 await page.locator('[data-range=width]').evaluate(el=>{el.value='180';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(option('frontOpening','french-black')).toBeDisabled();await expect(option('frontOpening','sliding-2-black')).toBeDisabled();await ready();
 record('Slider, typed dimensions and +/- obey the selected 230 cm minimum; smaller choices unlock the full range and dependent cards update immediately');

 let rejectNext=true;
 await page.route(/\/prefab\/api\/price$/,route=>{if(rejectNext){rejectNext=false;return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{message:'Controleer de gekozen breedte.',fields:{width:'Kies een passende breedte.'}}})});}return route.continue();});
 await page.locator('[data-range=width]').evaluate(el=>{el.value='190';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(page.locator('#width-error')).not.toBeEmpty();await expect(page.locator('#width')).toHaveAttribute('aria-invalid','true');
 await page.locator('[data-range=width]').evaluate(el=>{el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(page.locator('#width-error')).toBeEmpty();await ready();await expect(page.locator('#width')).not.toHaveAttribute('aria-invalid','true');
 await page.unroute(/\/prefab\/api\/price$/);
 record('Correcting a dimension removes stale field text, invalid state and API warning, including a previous failed calculation');

 const dense=(await priced({width:750,depth:340,frontOpening:'french-black',rooflight:'gable-8',interior:true,plaster:true,screed:true,underfloorHeating:true,heating:'both',outsideLight:'both',outsideSocket:'both',outsideTap:'both',drainSide:'both',ceilingPositions:[],spotPositions:[],socketPositions:[],wallLights:[]})).config;
 await load(dense);await page.locator('[data-step="1"]').click();await open('ceiling');
 const blocked=page.locator('[data-field=spotPositions] .unavailable');await expect(blocked.first()).toBeVisible();
 await expect(page.locator('[data-field=spotPositions] .availability-note')).toHaveCount(1);
 await expect(blocked.locator('.option-title small')).toHaveCount(0);
 const reason=await blocked.first().getAttribute('data-unavailable');await blocked.first().scrollIntoViewIfNeeded();await blocked.first().click({force:true});await expect(page.locator('#toast')).toHaveText(reason);
 await blocked.first().focus();await blocked.first().press('Enter');await expect(page.locator('#toast')).toHaveText(reason);
 expect(await page.locator('input[name=spotPositions]:checked').count()).toBe(0);
 record('Unavailable spots use one group explanation; pointer and keyboard reveal the reason without selecting or repeating paragraphs in tiles');
 await page.locator('[data-field=spotPositions]').evaluate(el=>{const p=document.querySelector('#panel-content');p.scrollTop+=el.getBoundingClientRect().top-p.getBoundingClientRect().top-12;});
 await shot('desktop-spot-controls.png');

 for(const width of [360,390,768]){
  await page.setViewportSize({width,height:844});
  const checkbox=page.locator('input[name=spotPositions]:not(:disabled):not(:checked)').first();
  const value=await checkbox.getAttribute('value');await checkbox.locator('..').scrollIntoViewIfNeeded();
  const before=await checkbox.locator('..').boundingBox();
  await checkbox.locator('..').click();await ready();
  const after=await option('spotPositions',value).locator('..').boundingBox();
  expect(Math.abs(after.y-before.y)).toBeLessThan(8);
  await expect(option('spotPositions',value)).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await page.locator('[data-field=spotPositions] .position-option').evaluateAll(els=>Math.max(...els.map(el=>el.getBoundingClientRect().height)))).toBeLessThan(90);
  const button=page.locator('[data-field=spotPositions] .field-preview');await expect(button).toBeVisible();
  const head=await page.locator('[data-field=spotPositions] legend').boundingBox(),inspect=await button.boundingBox();expect(inspect.y-head.y).toBeLessThan(5);
  if(width===390){
   await page.locator('[data-field=spotPositions] .placement-board').evaluate(el=>{const p=document.querySelector('#panel-content');p.scrollTop+=el.getBoundingClientRect().top-p.getBoundingClientRect().top-12;});
   await blocked.first().click({force:true});await expect(page.locator('#toast')).toHaveText(reason);
   const notice=await page.locator('#toast').boundingBox(),panel=await page.locator('#panel-content').boundingBox();expect(notice.y+notice.height).toBeLessThan(panel.y);
   await shot('mobile-spot-controls.png');
  }
 }
 record('360/390/768 px multi-selection preserves the clicked point, keeps inspection beside its title and has no horizontal overflow');
 await page.setViewportSize({width:1440,height:1000});await verifyCameraUI({page,expect,record,inspect:shot});

 await page.setViewportSize({width:1440,height:1000});await load({...catalog.defaults});
 await shot('desktop-form.png');
 await page.setViewportSize({width:390,height:844});await shot('mobile-form.png');
 for(const width of [390,1440]){await page.setViewportSize({width,height:width===390?844:1000});await page.waitForTimeout(300);const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(report.violations).toEqual([]);}
 record('Desktop and mobile form accessibility checks pass after the actual interaction flow');
 expect(result.writes).toEqual([]);expect(result.errors).toEqual([]);result.passed=true;
}catch(error){result.passed=false;result.errors.push(error.message);result.failureStack=error.stack;console.error(error.stack);process.exitCode=1;}
finally{
 await browser?.close();if(server)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
 if(dirname(resolve(temporary))!==resolve(tmpdir())||!basename(temporary).startsWith('prefab-usability-'))throw new Error('Unexpected temporary workspace');
 await rm(temporary,{recursive:true,force:true});result.finishedAt=new Date().toISOString();await writeFile(join(output,'usability.json'),JSON.stringify(result,null,2)+'\n');
}

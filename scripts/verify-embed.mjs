/**
 * Browser acceptance for the embedded configurator.
 *
 * What it proves, in one real Chromium, against a real server:
 *   1. /prefab standalone still renders its own header and is NOT in embed mode.
 *   2. /prefab/embed serves the same bytes, drops the site chrome, and renders the 3D scene
 *      inside a frame on a page of the site.
 *   3. The frame is sized by the host page and advised by the frame: the postMessage handshake
 *      raises min-height, and it raises a DIFFERENT one at 1440px and at 375px.
 *   4. The frame keeps the permission its fullscreen button needs.
 *   5. A quote submitted from inside the frame produces the same proposal as the same design
 *      submitted standalone -- compared document against document, not "both returned 201".
 *   6. A third-party page cannot frame the configurator at all.
 *
 * The host page is not written here. It is the block cs_prefab_website ships
 * (views/offerte_templates.xml, template `offerte_frame`), lifted verbatim and served at the
 * server's own origin, so the same-origin arrangement and the exact markup under test are the
 * ones the site will serve. A repository test asserts that block contains no QWeb, which is what
 * makes lifting it honest -- see tests/test_website_foundation.py::OfferteEmbedTests.
 *
 * PREFAB_TEST_OUTPUT (default docs/verification/embed) receives embed.json plus screenshots;
 * PREFAB_NO_SCREENSHOTS=1 writes only the JSON.
 */
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {waitAssetsReady} from './wait-assets-ready.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.PREFAB_TEST_OUTPUT||join(root,'docs/verification/embed');
await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'cs-prefab-embed-'));
const noShots=!!process.env.PREFAB_NO_SCREENSHOTS;
const results={startedAt:new Date().toISOString(),checks:[],headers:{},errors:[],screenshots:[]};
const record=(name,detail={})=>{results.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
let server,browser;

/** The customer's page, assembled from the block the module ships. Nothing here is invented markup. */
async function hostDocument(){
 const xml=await readFile(join(root,'addons/cs_prefab_website/views/offerte_templates.xml'),'utf8');
 const template=xml.slice(xml.indexOf('<template id="offerte_frame"'));
 const block=template.slice(template.indexOf('<div class="o_prefab_embed"'),template.indexOf('</template>')).trimEnd();
 if(!block.includes('<iframe'))throw new Error('offerte_frame no longer contains the frame block');
 if(/\st-[a-z-]+=/.test(block))throw new Error('offerte_frame carries QWeb; it can no longer be lifted verbatim');
 return {block,html:'<!doctype html><html lang="nl"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Ontwerp je aanbouw</title>'+
  '<style>body{margin:0;font-family:system-ui,sans-serif}header{height:96px;display:flex;align-items:center;padding:0 24px;border-bottom:1px solid #ddd}main{padding:0 24px}</style>'+
  '</head><body class="o_prefab_site"><header>Prefab Partner</header><main>'+
  '<h1>Configureer binnen 3 minuten</h1>'+block+'</main></body></html>'};
}

try{
 server=spawn(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),
  ['scripts/serve.py','--port','0','--db',join(temporary,'embed.sqlite3')],{cwd:root,stdio:['ignore','pipe','pipe']});
 const base=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Test server start timed out')),15000);
  server.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/running at (http:\/\/[^\s]+)\/prefab/);if(match){clearTimeout(timer);resolve(match[1]);}});
  server.on('exit',code=>reject(new Error('Server exited '+code)));
  server.stderr.on('data',chunk=>{if(String(chunk).includes('Traceback'))console.error(String(chunk));});});
 results.origin=base;

 const executablePath=process.env.CHROMIUM_PATH||[
  join(homedir(),'AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
  join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
  join(homedir(),'.cache/ms-playwright/chromium-1217/chrome-linux64/chrome')].find(existsSync);
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 page.setDefaultTimeout(20000);
 page.on('pageerror',error=>results.errors.push(error.message));

 const {block,html}=await hostDocument();
 await page.route(base+'/offerte',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
 const shot=async(name,target=page)=>{if(noShots)return;await target.screenshot({path:join(output,name)});results.screenshots.push(name);};

 // ------------------------------------------------------------------
 // 1. The headers, read without a browser in the way
 // ------------------------------------------------------------------
 for(const path of ['/prefab','/prefab/embed']){
  const response=await page.request.get(base+path);
  const headers=response.headers();
  results.headers[path]={'x-frame-options':headers['x-frame-options']||null,
   'content-security-policy':headers['content-security-policy']||null,
   'referrer-policy':headers['referrer-policy']||null,
   'x-content-type-options':headers['x-content-type-options']||null};
  expect(response.status(),path).toBe(200);
  expect(headers['x-frame-options'],path).toBe('SAMEORIGIN');
  expect(headers['content-security-policy'],path).toContain("frame-ancestors 'self'");
  expect(headers['content-security-policy'],path).not.toContain('frame-ancestors *');
 }
 const standaloneBytes=(await (await page.request.get(base+'/prefab')).body()).length;
 const embedBytes=(await (await page.request.get(base+'/prefab/embed')).body()).length;
 expect(embedBytes).toBe(standaloneBytes);
 record('Both addresses serve the same page and both refuse every frame ancestor but their own origin',
  {bytes:embedBytes,headers:results.headers});

 // ------------------------------------------------------------------
 // 2. Standalone is unchanged
 // ------------------------------------------------------------------
 await page.goto(base+'/prefab');
 await page.waitForFunction(()=>window.__prefabPreview);
 await waitAssetsReady(page);
 await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 await expect(page.locator('.site-header .brand')).toBeVisible();
 expect(await page.evaluate(()=>document.body.classList.contains('embedded'))).toBe(false);
 const standaloneScene=await page.evaluate(()=>window.__prefabPreview.getSceneInfo());
 expect(standaloneScene.webglAvailable).toBe(true);
 await shot('embed-standalone-1440.png');
 record('Standalone /prefab keeps its own header and is not in embed mode',{webgl:true});

 // ------------------------------------------------------------------
 // 3. The page of the site, with the configurator inside it
 // ------------------------------------------------------------------
 await page.addInitScript(()=>{window.__embedAdvice=[];window.addEventListener('message',event=>{
  if(event.data&&event.data.source==='cs-prefab')window.__embedAdvice.push({type:event.data.type,origin:event.origin});});});
 await page.goto(base+'/offerte');
 const frameElement=page.locator('iframe[data-prefab-embed]');
 await expect(frameElement).toHaveCount(1);
 expect(await frameElement.getAttribute('src')).toBe('/prefab/embed');
 const frame=page.frameLocator('iframe[data-prefab-embed]');
 const inner=await (await frameElement.elementHandle()).contentFrame();
 await inner.waitForFunction(()=>window.__prefabPreview);
 await waitAssetsReady(inner);
 await expect(frame.locator('.price-value')).not.toHaveClass(/pending/);
 expect(await inner.evaluate(()=>document.body.classList.contains('embedded'))).toBe(true);
 // The site's own header is 96px above; repeating the configurator's would be the duplicate the
 // embed exists to avoid. The action row stays, so nothing became unreachable.
 await expect(frame.locator('.site-header .brand')).toBeHidden();
 // The action row stays. Since 2.11.0 it opens with the way back to the website (the hidden logo's job), and
 // "Opnieuw beginnen" joins it only once the design differs from the defaults.
 await expect(frame.locator('.header-actions .exit-header')).toBeVisible();
 await expect(frame.locator('.header-actions .reset-header')).toBeHidden();
 // "Hoe werkt het?" lives in the header nav that embed mode hides, so the tool button the phone
 // layout already uses for it is shown at every width instead. Nothing lost its only route.
 await expect(frame.locator('.header-nav')).toBeHidden();
 // Since 2.10.7 a narrow frame folds the camera tools behind one menu button; the help button is in that list.
 if(await frame.locator('[data-action=tools-menu]').isVisible())await frame.locator('[data-action=tools-menu]').click();
 await expect(frame.locator('.tool-button.mobile-help')).toBeVisible();
 const embeddedScene=await inner.evaluate(()=>window.__prefabPreview.getSceneInfo());
 expect(embeddedScene.webglAvailable,'WebGL inside a frame is a real failure mode; this is which path ran').toBe(true);
 await shot('embed-hosted-1440.png');
 record('The offerte page frames the configurator and the 3D scene really runs inside it',
  {webgl:embeddedScene.webglAvailable,geometries:embeddedScene.geometries??null});

 // ------------------------------------------------------------------
 // 4. Height: the host sizes, the frame advises, the parent clamps
 // ------------------------------------------------------------------
 const advice=async()=>page.evaluate(()=>window.__embedAdvice.map(item=>item.type));
 expect(await advice()).toContain('ready');
 const origins=new Set(await page.evaluate(()=>window.__embedAdvice.map(item=>item.origin)));
 expect([...origins]).toEqual([new URL(base).origin]);
 const frameBox=async()=>frameElement.evaluate(node=>({
  minHeight:node.style.minHeight,height:Math.round(node.getBoundingClientRect().height),
  scrollWidth:node.ownerDocument.documentElement.scrollWidth,
  clientWidth:node.ownerDocument.documentElement.clientWidth}));
 await expect.poll(async()=>(await frameBox()).minHeight).toBe('620px');
 const wide=await frameBox();
 // The frame document itself must not scroll: the configurator is a viewport application and
 // the panel scrolls inside it, exactly as it does standalone.
 const innerScroll=await inner.evaluate(()=>({
  body:getComputedStyle(document.body).overflow,
  overflow:document.documentElement.scrollHeight-document.documentElement.clientHeight}));
 expect(innerScroll.body).toBe('hidden');
 expect(innerScroll.overflow).toBeLessThanOrEqual(1);
 expect(wide.height).toBeGreaterThanOrEqual(620);
 // And the workspace really got that height: both columns present, nothing clipped away.
 await expect(frame.locator('.workspace .preview-card')).toBeVisible();
 await expect(frame.locator('#panel-content')).toBeVisible();

 // The CC0 garden set swaps in asynchronously after assetsReady and keeps the frame's main thread
 // busy; without waiting for it the layout advice can arrive seconds after the resize. Harmless in
 // production -- the stylesheet's height is already correct and the advice only raises a floor --
 // but it makes a timed check flap, so the known load is waited out rather than the deadline
 // stretched until it happens to fit.
 await inner.evaluate(()=>window.__prefabPreview.gardenSetReady);
 await page.setViewportSize({width:375,height:812});
 // A plain poll would report only "expected 560px, received 620px", which says nothing about
 // whether the frame never advised or the host never applied. Both sides are read on failure.
 const advisedNarrow=async()=>{
  const deadline=Date.now()+15000;
  for(;;){
   const box=await frameBox();
   if(box.minHeight==='560px')return box;
   if(Date.now()>deadline)throw new Error('The frame never advised the phone minimum. Host saw '+
    JSON.stringify(await page.evaluate(()=>window.__embedAdvice))+'; frame reports '+
    JSON.stringify(await inner.evaluate(()=>({innerWidth:window.innerWidth,innerHeight:window.innerHeight,
     narrow:window.matchMedia('(max-width: 900px)').matches,bodyWidth:document.body.clientWidth})))+
    '; iframe min-height '+box.minHeight);
   await page.waitForTimeout(150);
  }
 };
 const narrow=await advisedNarrow();
 expect(narrow.scrollWidth,'the host page must not scroll sideways at 375px').toBeLessThanOrEqual(narrow.clientWidth);
 expect(narrow.height).toBeGreaterThanOrEqual(560);
 await expect(frame.locator('.workspace')).toBeVisible();
 await shot('embed-hosted-375.png');
 record('The frame advises a different minimum for each layout and the host applies it clamped',
  {wide:wide.minHeight,narrow:narrow.minHeight,wideHeight:wide.height,narrowHeight:narrow.height});
 await page.setViewportSize({width:1440,height:1000});

 // Nothing outside the contract gets through, and a number outside the clamp does not either.
 const rejected=await page.evaluate(()=>{
  const node=document.querySelector('iframe[data-prefab-embed]'),before=node.style.minHeight;
  window.postMessage({source:'cs-prefab',type:'size',minHeight:99999},location.origin);
  window.postMessage({source:'anders',type:'size',minHeight:1000},location.origin);
  return new Promise(resolve=>setTimeout(()=>resolve({before,after:node.style.minHeight}),200));});
 // The messages came from the page itself, not from the frame, so the source-window check drops
 // both -- which is the gate that origin alone would not give you.
 expect(rejected.after).toBe(rejected.before);
 record('A same-origin message that is not from this frame changes nothing',rejected);

 // ------------------------------------------------------------------
 // 5. Fullscreen permission
 // ------------------------------------------------------------------
 // document.fullscreenEnabled is false in a frame without allowfullscreen, and that is precisely
 // the condition under which app.js's requestFullscreen() rejects and falls back to a fixed-inset
 // overlay the frame's own box clips -- "volledig scherm" appearing to do nothing.
 expect(await inner.evaluate(()=>document.fullscreenEnabled)).toBe(true);
 record('The frame carries the permission the volledig-scherm button needs');

 // ------------------------------------------------------------------
 // 6. A quote, end to end, from inside the frame
 // ------------------------------------------------------------------
 const customer={firstName:'Ingesloten',lastName:'Voorbeeld',email:'embed@example.invalid',phone:'0612345678',
  address:'Voorbeeldstraat',houseNumber:'12',postcode:'1234 AB',city:'Utrecht'};
 async function submit(scope,target){
  await scope.locator('nav [data-step="3"]').click();
  await scope.locator('[data-action="contact"]:not([disabled])').click();
  for(const[key,value]of Object.entries(customer))await scope.locator('#contact-'+key).fill(value);
  await scope.locator('input[name="consent"]').check();
  await scope.locator('.submit-button').click();
  await expect(scope.locator('.success-state')).toBeVisible({timeout:60000});
  const href=await scope.locator('.success-state a.button.primary').getAttribute('href');
  const token=href.split('/')[4];
  const pdf=await target.request.get(base+href);
  expect(pdf.status()).toBe(200);
  const bytes=await pdf.body();
  expect(bytes.subarray(0,4).toString('latin1')).toBe('%PDF');
  const document_=await (await target.request.get(base+'/prefab/api/quote/'+token+'/html')).text();
  const images=[...document_.matchAll(/data:image\/[a-z+]+;base64,([^"']+)/g)].map(match=>match[1].length);
  return {token,pdfBytes:bytes.length,images,document:document_,
   pages:(bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length};
 }
 const embedded=await submit(frame,page);
 await shot('embed-hosted-quote.png');
 record('A proposal submitted from inside the frame is saved and its pdf downloads',
  {reference:embedded.token.slice(0,4)+'…',pdfBytes:embedded.pdfBytes,pages:embedded.pages});

 // The same design, standalone, on a page of its own. Same defaults, same steps, same customer.
 const solo=await context.newPage();
 solo.on('pageerror',error=>results.errors.push(error.message));
 await solo.goto(base+'/prefab');
 await solo.waitForFunction(()=>window.__prefabPreview);
 await waitAssetsReady(solo);
 await expect(solo.locator('.price-value')).not.toHaveClass(/pending/);
 const standalone=await submit(solo,solo);
 await solo.close();

 // Two documents, compared character for character after three substitutions, each of which is a
 // thing that MUST differ rather than a thing being excused:
 //   - the reference and the timestamp, because they identify two different requests;
 //   - the base64 payload of each captured view, because a WebGL scene rendered into a 1392px
 //     frame is not the same pixels as one rendered into a 1440px window. The design is the same,
 //     the photograph of it is not, and pretending otherwise would be the dishonest version of
 //     this check. What IS compared is that both proposals carry the SAME NUMBER of views, each
 //     of a plausible size -- a frame that silently produced fewer visuals, or an empty canvas,
 //     fails here.
 // Everything else -- every label, every dimension, the scope list, the price, the disclaimer --
 // must match exactly. That is the claim: the same design submitted from the frame produces the
 // same proposal, which is the failure two 201s would never show you.
 const scrub=text=>text.replace(/CS-\d{8}-[0-9A-F]{8}/g,'CS-REFERENTIE')
  .replace(/\d{1,2}[-/ ][a-zA-Z0-9]+[-/ ]\d{4}(,? \d{2}:\d{2})?/g,'DATUM')
  .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z?/g,'DATUM')
  .replace(/(data:image\/[a-z+]+;base64,)[^"']+/g,'$1BEELD');
 if(scrub(embedded.document)!==scrub(standalone.document)){
  await writeFile(join(output,'embed-document.html'),embedded.document);
  await writeFile(join(output,'standalone-document.html'),standalone.document);
  throw new Error('The embedded proposal differs from the standalone one; both written to '+output);
 }
 expect(embedded.images.length,'the frame must capture as many views as the standalone page').toBe(standalone.images.length);
 expect(embedded.images.length).toBeGreaterThan(0);
 expect(Math.min(...embedded.images),'a captured view that small is an empty canvas').toBeGreaterThan(2000);
 expect(embedded.pages).toBe(standalone.pages);
 record('The embedded proposal is the same document as the standalone one, view for view',
  {pages:embedded.pages,views:embedded.images.length,
   embeddedPdfBytes:embedded.pdfBytes,standalonePdfBytes:standalone.pdfBytes,
   embeddedViewBytes:embedded.images,standaloneViewBytes:standalone.images});

 // ------------------------------------------------------------------
 // 7. A third party cannot frame it
 // ------------------------------------------------------------------
 // A matched pair, and the pair is the point. Both pages carry the SAME markup and the SAME
 // ABSOLUTE frame address; the only difference between them is the origin the parent is served
 // from. One renders the configurator and one does not, and nothing but the frame policy can
 // account for the difference.
 //
 // Deliberately not asserted on a console message: Chromium moved X-Frame-Options and
 // frame-ancestors refusals out of the console and into the Issues panel, so "no console error"
 // would have read as "not refused" and been wrong. The message is recorded when it appears, as
 // evidence; the pair is the proof.
 const framePage='<!doctype html><html lang="nl"><body><h1>Een pagina</h1>'+
  '<iframe id="onder-test" src="'+base+'/prefab/embed" width="900" height="700"></iframe></body></html>';
 async function framedConfigurator(origin,route){
  const probe=await context.newPage();
  const noticed=[];
  probe.on('console',message=>{const text=message.text();
   if(/frame-ancestors|X-Frame-Options|Refused to (display|frame)/i.test(text))noticed.push(text);});
  await probe.route(route,handler=>handler.fulfill({status:200,contentType:'text/html; charset=utf-8',body:framePage}));
  await probe.goto(origin);
  const frameHandle=await probe.waitForSelector('#onder-test');
  await probe.waitForTimeout(3000);
  const child=await frameHandle.contentFrame();
  const rendered=child?await child.evaluate(()=>!!document.querySelector('#app .workspace')).catch(()=>false):false;
  return {probe,rendered,noticed,url:child?child.url():null};
 }
 const control=await framedConfigurator(base+'/embed-control',base+'/embed-control');
 expect(control.rendered,'the control must render, or the pair proves nothing').toBe(true);
 await control.probe.close();

 const hostile=await framedConfigurator('http://derde-partij.test/','http://derde-partij.test/**');
 expect(hostile.rendered,'a third-party page must not be able to render the configurator').toBe(false);
 await shot('embed-cross-origin-refused.png',hostile.probe);
 results.crossOrigin={sameOriginParent:base+'/embed-control',sameOriginRendered:control.rendered,
  thirdPartyParent:'http://derde-partij.test/',thirdPartyRendered:hostile.rendered,
  frameSrc:base+'/prefab/embed',browserMessage:hostile.noticed[0]||null};
 await hostile.probe.close();
 record('The same frame address renders for a same-origin parent and is refused to a third party',
  results.crossOrigin);

 if(results.errors.length)throw new Error('Script errors during the run: '+results.errors.join(' | '));
 results.finishedAt=new Date().toISOString();
 results.passed=true;
 await writeFile(join(output,'embed.json'),JSON.stringify(results,null,2));
 console.log('\n'+results.checks.length+' embed checks passed. Evidence: '+join(output,'embed.json'));
}catch(error){
 results.passed=false;
 results.failure=error.message;
 await writeFile(join(output,'embed.json'),JSON.stringify(results,null,2)).catch(()=>{});
 console.error('FAIL '+error.message);
 process.exitCode=1;
}finally{
 await browser?.close().catch(()=>{});
 server?.kill();
 await rm(temporary,{recursive:true,force:true}).catch(()=>{});
}

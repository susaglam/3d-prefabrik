/** UI acceptance used by the shared 2.3 runner. No browser launch or screenshots. */
export async function verifyRefinementUI({page,expect,record,origin,catalog}) {
 const step=async index=>page.locator('nav [data-step="'+index+'"]').click();
 const priced=async()=>expect(page.locator('.price-value')).not.toHaveClass(/pending/);
 const width=async value=>{await step(0);await page.locator('#width').fill(String(value));await page.locator('#depth').focus();await priced();};
 const reset=async confirm=>{await page.locator('.header-actions [data-action=reset]').click();await expect(page.locator('#modal')).toContainText('Eerder gemaakte voorstellen en deellinks blijven bestaan.');await page.locator('#modal .modal-actions [data-action="'+(confirm?'confirm-reset':'close-modal')+'"]').click();if(confirm)await priced();};
 const config=()=>page.evaluate(()=>structuredClone(window.__prefabPreview.config));
 // Since 2.11.0 "Opnieuw beginnen" only shows once the design differs from the defaults: make it differ first.
 if(await page.locator('.reset-header').isHidden())await width(catalog.defaults.width+10);
 await expect(page.locator('.reset-header')).toBeInViewport();await expect(page.locator('.reset-header')).toHaveAccessibleName('Opnieuw beginnen');
 const original=await config();await reset(false);expect(await config()).toEqual(original);
 await reset(true);expect(await config()).toEqual(catalog.defaults);
 await expect(page.locator('.reset-header')).toBeHidden(); // back at the defaults there is nothing to start over from
 record('Visible reset has a clear confirmation; cancel preserves the current design');

 const wood=page.locator('[data-group=facade] input[name=facade][value=wood-vertical]');await wood.locator('..').click();await expect(wood).toBeChecked();await priced();
 await expect(page.locator('[data-field=facade] .current-choice strong')).toHaveText(catalog.groups.flatMap(group=>group.fields).find(field=>field.key==='facade').options.find(option=>option.id==='wood-vertical').label);
 await expect(page.locator('[data-field=facade] .selected input')).toHaveValue('wood-vertical');
 const roofGroup=page.locator('details[data-group=roof]');if((await roofGroup.getAttribute('open'))===null)await roofGroup.locator(':scope > summary').click();
 const roofOptions=catalog.groups.flatMap(group=>group.fields).find(field=>field.key==='rooflight').options;
 for(const option of roofOptions){
  // Isometric icons: one glass quad per bay; a gable shows half its bays on the back slope, a lean-to none.
  const diagram=page.locator('input[name=rooflight][value="'+option.id+'"]').locator('..').locator('svg.rooflight-icon');
  const count=Number(option.id.split('-')[1]||0);await expect(diagram.locator('[data-bay]')).toHaveCount(count);
  await expect(diagram.locator('[data-slope="back"]')).toHaveCount(option.id.startsWith('gable-')?count/2:0);
  await expect(diagram).toHaveAttribute('data-profile',option.id==='none'?'none':option.id.split('-')[0]);
 }
 expect(await page.locator('[data-field=rooflight] .option-family-title').allTextContents()).toEqual(['Lessenaar','Zadeldak']);
 record('Material selection is explicit; roof families distinguish one slope, a ridge and the exact pane count');

 await width(catalog.defaults.width+10);await step(3);await page.locator('.comparison-panel > summary').click();await page.locator('[data-comparison-save=A]').click();
 await width(catalog.defaults.width+20);await step(3);await page.locator('[data-comparison-save=B]').click();
 await page.locator('[data-action=contact]').click();await page.locator('#contact-firstName').fill('Vergeten testnaam');await page.locator('#modal [data-action=close-modal]').first().click();
 // Since 2.10.7 Weergave is a dialog, not a strip: open it, act inside it, and close it again before the page behind it
 // is touched. A phone folds the camera tools behind one menu button, so tool() opens that first when it shows.
 const inWeergave=async act=>{await page.locator('[data-action=view-strip]').click();await expect(page.locator('#modal .view-panel')).toBeVisible();await act();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#modal').open);};
 const tool=async action=>{const menu=page.locator('[data-action=tools-menu]');if(await menu.isVisible()&&(await menu.getAttribute('aria-expanded'))!=='true')await menu.click();await page.locator('[data-action='+action+']').first().click();};
 await tool('dimensions');await tool('roof');
 await inWeergave(async()=>{await page.locator('[data-view-setting=examples]').uncheck();await page.locator('[data-view-setting=decor]').uncheck();});await tool('viewpoints');await page.locator('[data-view=ceiling]').click();

 const staleWidth=catalog.defaults.width+30;
 let releasePrice,releaseCatalog,releaseShare,seenPrice=false,seenCatalog=false,seenShare=false,catalogHeld=false;
 const priceGate=new Promise(resolve=>releasePrice=resolve),catalogGate=new Promise(resolve=>releaseCatalog=resolve),shareGate=new Promise(resolve=>releaseShare=resolve);
 const pricePattern='**/prefab/api/price',catalogPattern='**/prefab/api/catalog',sharePattern='**/prefab/api/share';
 const priceHandler=async route=>{if(route.request().postDataJSON()?.config?.width!==staleWidth)return route.fallback();const response=await route.fetch();seenPrice=true;await priceGate;await route.fulfill({response});};
 const catalogHandler=async route=>{if(catalogHeld)return route.fallback();catalogHeld=true;const response=await route.fetch();seenCatalog=true;await catalogGate;await route.fulfill({response});};
 const shareHandler=async route=>{seenShare=true;await shareGate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:'/prefab?share=mock-old-design'})});};
 await page.route(pricePattern,priceHandler);await page.route(catalogPattern,catalogHandler);await page.route(sharePattern,shareHandler);
 // Simulate a response already in transit: cancellation alone cannot protect the new design.
 await page.evaluate(staleWidth=>{window.__qaResetFetch=window.fetch;window.__qaResetReplies=0;window.fetch=async(input,options)=>{const path=new URL(input,location.href).pathname,hold=path.endsWith('/catalog')||path.endsWith('/share')||(path.endsWith('/price')&&JSON.parse(options?.body||'{}').config?.width===staleWidth);const response=await window.__qaResetFetch(input,hold?{...options,signal:undefined}:options);if(hold){await response.clone().text();window.__qaResetReplies++;}return response;};},staleWidth);
 try{
  await page.locator('[data-action=compare-refresh]').click();await expect.poll(()=>seenCatalog).toBe(true);
  await page.locator('.header-actions [data-action=share]').click();await expect.poll(()=>seenShare).toBe(true);
  await step(0);await page.locator('#width').fill(String(staleWidth));await page.locator('#depth').focus();await expect.poll(()=>seenPrice).toBe(true);
  await page.evaluate(()=>history.replaceState({},'',location.pathname+'?share=qa-old-link'));
  await reset(true);
  releasePrice();releaseCatalog();releaseShare();
  await expect.poll(()=>page.evaluate(()=>window.__qaResetReplies)).toBe(3);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await config()).toEqual(catalog.defaults);
  const scene=await page.evaluate(()=>window.__prefabPreview.getSceneInfo());expect(scene.view).toBe('perspective');expect(scene.mode).toBe('3d');expect(scene.dimensionsVisible).toBe(false);expect(scene.roofVisible).toBe(true);expect(scene.examplesVisible).toBe(true);expect(scene.decorVisible).toBe(true);
  await expect(page.locator('nav [aria-current=step]')).toHaveAttribute('data-step','0');await expect(page.locator('#modal')).not.toBeVisible();
  expect(new URL(page.url()).searchParams.has('share')).toBe(false);
  expect(await page.evaluate(()=>[localStorage.getItem('cs-prefab-design-v1'),localStorage.getItem('cs-prefab-comparison-v1')])).toEqual([null,null]);
  await step(3);await expect(page.locator('.comparison-table')).toHaveCount(0);expect(await page.locator('.comparison-slots small').allTextContents()).toEqual(['Nog geen ontwerp','Nog geen ontwerp']);
  await page.locator('[data-action=contact]').click();await expect(page.locator('#contact-firstName')).toHaveValue('');await expect(page.locator('#quote-error')).toBeEmpty();await page.locator('#modal [data-action=close-modal]').first().click();
  record('Full reset clears contact, comparisons, saved draft, share URL and camera settings; late price/catalog/share replies cannot restore old state',{mockedShare:true,serverQuoteOrShareWrites:0});
 }finally{
  releasePrice();releaseCatalog();releaseShare();
  await page.evaluate(()=>{window.fetch=window.__qaResetFetch;delete window.__qaResetFetch;delete window.__qaResetReplies;});
  await page.unroute(pricePattern,priceHandler);await page.unroute(catalogPattern,catalogHandler);await page.unroute(sharePattern,shareHandler);
 }

 let releaseValidation,validationSeen=false;
 const validationGate=new Promise(resolve=>releaseValidation=resolve);
 const validationHandler=async route=>{const response=await route.fetch();validationSeen=true;await validationGate;await route.fulfill({response});};
 // Since 2.11.0 "Opnieuw beginnen" shows only once the design differs from the defaults: differ first, then go back.
 if(await page.locator('.reset-header').isHidden()){await width(catalog.defaults.width+10);await step(3);await priced();}
 await page.locator('[data-action=contact]').click();
 for(const [key,value] of Object.entries({firstName:'Reset',lastName:'Controle',email:'reset@example.test',phone:'0612345678',address:'Teststraat',houseNumber:'12',postcode:'1234 AB',city:'Utrecht'}))await page.locator('#contact-'+key).fill(value);
 await page.locator('input[name=consent]').check();
 await page.route(pricePattern,validationHandler);
 await page.evaluate(()=>{window.__qaValidationFetch=window.fetch;window.fetch=(input,options)=>window.__qaValidationFetch(input,new URL(input,location.href).pathname.endsWith('/price')?{...options,signal:undefined}:options);});
 try{
  await page.locator('#quote-form button[type=submit]').click();await expect.poll(()=>validationSeen).toBe(true);
  await page.locator('#modal [data-action=close-modal]').first().click();
  await page.locator('.reset-header').click();await page.locator('[data-action=confirm-reset]').click();
  // New default pricing must run normally; only the already held validation is released late.
  await page.unroute(pricePattern,validationHandler);releaseValidation();await priced();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#modal')).not.toBeVisible();expect(await config()).toEqual(catalog.defaults);
  await step(3);await page.locator('[data-action=contact]').click();await expect(page.locator('#contact-email')).toHaveValue('');await expect(page.locator('.submit-button')).toBeEnabled();await page.locator('#modal [data-action=close-modal]').first().click();
  await step(0);
  record('Reset during proposal validation stops the old capture/submission and leaves a fresh contact form',{syntheticContact:true,serverQuoteWrites:0});
 }finally{releaseValidation();await page.unroute(pricePattern,validationHandler);await page.evaluate(()=>{window.fetch=window.__qaValidationFetch;delete window.__qaValidationFetch;});}
}

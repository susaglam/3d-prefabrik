/** Camera acceptance for the shared 2.4 runner. No browser launch, screenshots or proposal writes. */
import {waitAssetsReady} from './wait-assets-ready.mjs';
export async function verifyCameraUI({page,expect,record,inspect=async()=>{}}) {
 const original={url:page.url(),viewport:page.viewportSize(),storage:await page.evaluate(()=>({design:localStorage.getItem('cs-prefab-design-v1'),comparison:localStorage.getItem('cs-prefab-comparison-v1')}))};
 const settled=async()=>{
  await page.waitForFunction(()=>window.__prefabPreview);
  await waitAssetsReady(page);
  await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 };
 const pose=()=>page.evaluate(()=>{const p=window.__prefabPreview;return {position:p.camera.position.toArray(),target:p.controls.target.toArray(),fov:p.camera.fov,view:p.view};});
 const step=async index=>page.locator('nav [data-step="'+index+'"]').click();
 const open=async name=>{const group=page.locator('details[data-group="'+name+'"]');if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();};
 const choose=async(key,value)=>{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/prefab/api/price')&&r.request().method()==='POST');
  const input=page.locator('input[name="'+key+'"][value="'+value+'"]');
  await input.locator('..').click();expect((await response).status()).toBe(200);await settled();
 };
 const load=async overrides=>{
  const prepared=await page.evaluate(async overrides=>{
   const catalogResponse=await fetch('/prefab/api/catalog');if(!catalogResponse.ok)throw new Error('Camera check catalogue request failed');
   const catalog=await catalogResponse.json();
   const priceResponse=await fetch('/prefab/api/price',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{...catalog.defaults,...overrides},catalogRevision:catalog.catalogRevision})});
   if(!priceResponse.ok)throw new Error('Camera check price request failed: '+priceResponse.status);
   const price=await priceResponse.json();
   localStorage.setItem('cs-prefab-design-v1',JSON.stringify({version:catalog.schemaVersion,config:price.config}));
   return {width:price.config.width,depth:price.config.depth};
  },overrides);
  await page.goto(new URL('/prefab',original.url).href);await settled();
  expect(await page.evaluate(()=>window.__prefabPreview.getSceneInfo().webglAvailable)).toBe(true);
  return prepared;
 };
 const dense={width:750,depth:340,height:280,frontOpening:'french-black',rooflight:'none',facade:'pvc-green',interior:true,plaster:true,heating:'none',ceilingPositions:['left'],spotPositions:[],socketPositions:[],wallLights:[],outsideLight:'both',outsideSocket:'double-both',outsideTap:'both',drainSide:'both'};
 try {
  await load(dense);await step(1);await open('ceiling');
  const before=await pose();
  for(const id of ['center','right']){
   await choose('ceilingPositions',id);await expect(page.locator('input[name=ceilingPositions][value="'+id+'"]')).toBeChecked();
   expect(await pose()).toEqual(before);
  }
  record('Adding multiple ceiling positions preserves the active camera instead of moving between unfinished choices');

  await page.locator('[data-focus-option=ceilingLights]').click();
  const groupFrame=await page.evaluate(()=>{
   const p=window.__prefabPreview;p.camera.updateMatrixWorld(true);
   return {height:p.camera.position.y,distance:p.camera.position.distanceTo(p.controls.target),points:p.model.fixtures.filter(f=>f.key==='ceilingLights').map(f=>({id:f.id,point:p.camera.position.clone().set(...f.position).project(p.camera).toArray()}))};
  });
  expect(groupFrame.height).toBeGreaterThan(.25);expect(groupFrame.distance).toBeGreaterThan(1.5);expect(groupFrame.distance).toBeLessThan(30);expect(groupFrame.points).toHaveLength(3);
  for(const {point}of groupFrame.points){expect(Math.abs(point[0])).toBeLessThan(1);expect(Math.abs(point[1])).toBeLessThan(1);expect(point[2]).toBeGreaterThan(-1);expect(point[2]).toBeLessThan(1);}
  record('Explicit 3D inspection frames all selected ceiling fittings with useful context above the floor',{selected:groupFrame.points.length,distance:groupFrame.distance});
  await inspect('ceiling-focus.png');

  await page.evaluate(()=>{
   const p=window.__prefabPreview;p.controls.dispatchEvent({type:'start'});
   p.camera.position.set(3.2,2,4);p.controls.target.set(.3,1,.2);p.controls.update();p.render();
  });
  const manual=await pose();
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>{const p=window.__prefabPreview;return p.lastWidth===p.container.clientWidth&&p.lastHeight===p.container.clientHeight;});
  expect(await pose()).toEqual(manual);
  await choose('ceilingPositions','center');await expect(page.locator('input[name=ceilingPositions][value=center]')).not.toBeChecked();
  expect(await pose()).toEqual(manual);
  record('A manually orbited camera survives phone resizing, multi-selection and its accepted placement response');

  await load({...dense,width:230,ceilingPositions:[]});
  const sideFrame=await page.evaluate(()=>{
   const p=window.__prefabPreview,f=p.model.fixtures.find(f=>f.id==='outsideTap-left');
   if(!f)return {missing:true};
   p.focusOption(f.id);p.camera.updateMatrixWorld(true);
   const delta=p.camera.position.clone().sub(p.controls.target);
   return {surface:f.surface,normalDistance:delta.x*Math.sin(f.rotation)+delta.z*Math.cos(f.rotation),distance:delta.length(),point:p.camera.position.clone().set(...f.position).project(p.camera).toArray()};
  });
  // Since 2.7.1 even the narrowest pier keeps its fittings on the garden side; the camera faces that front wall.
  expect(sideFrame.missing).toBeUndefined();expect(sideFrame.surface).toBe('front');expect(sideFrame.normalDistance).toBeGreaterThan(1.5);expect(sideFrame.distance).toBeGreaterThan(1.5);expect(sideFrame.distance).toBeLessThan(15);
  expect(Math.abs(sideFrame.point[0])).toBeLessThan(.5);expect(Math.abs(sideFrame.point[1])).toBeLessThan(.5);
  record('Narrow-front exterior tap stays on the garden side; inspection faces that wall with a bounded viewing distance',{surface:sideFrame.surface,distance:sideFrame.distance});
  await inspect('mobile-side-focus.png');

  await load({...dense,rooflight:'gable-8'});await step(0);await open('roof');
  await choose('rooflight','lean-4');
  const roof=await page.evaluate(()=>{const p=window.__prefabPreview;return {view:p.view,roofVisible:p.roofGroup.visible,cameraHeight:p.camera.position.y,buildingHeight:p.model.height};});
  expect(roof.view).toBe('perspective');expect(roof.roofVisible).toBe(true);expect(roof.cameraHeight).toBeGreaterThan(roof.buildingHeight);
  record('Changing a rooflight shows it from above while leaving the inspected roof visible');
  await inspect('rooflight-focus.png');
 } finally {
  await page.evaluate(storage=>{
   for(const [key,value]of [['cs-prefab-design-v1',storage.design],['cs-prefab-comparison-v1',storage.comparison]])value===null?localStorage.removeItem(key):localStorage.setItem(key,value);
  },original.storage);
  if(original.viewport)await page.setViewportSize(original.viewport);
  await page.goto(original.url);await settled();
 }
}

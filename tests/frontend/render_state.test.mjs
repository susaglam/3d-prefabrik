import test from 'node:test';import assert from 'node:assert/strict';
import {sceneChange,visibleLightEffectCount} from '../../addons/cs_prefab_configurator/static/src/render_state.js';
import {profileGeometry,metricUVs} from '../../addons/cs_prefab_configurator/static/src/architectural_details.js';
import {buildGeometry,planSvg} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {fixtureAppearance,buildFixture} from '../../addons/cs_prefab_configurator/static/src/fixtures.js';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

test('commercial or position changes preserve the structural scene; facade selects its material layer',()=>{
 const config={width:500,depth:300,facade:'brick-red',heating:'left'};
 assert.equal(sceneChange(config,{...config,postcode:'1234 AB'}),'none');
 assert.equal(sceneChange(config,{...config,heating:'both'}),'fixtures');
 // A swap between two finishes that are not brick only re-skins the walls.
 assert.equal(sceneChange({...config,facade:'pvc-black'},{...config,facade:'wood-vertical',heating:'both'}),'material');
 assert.equal(sceneChange(config,{...config,width:600,facade:'wood-vertical'}),'structure');
});

test('a facade change that involves brick rebuilds, because the masonry rollaag is a course of THAT brick',()=>{
 // 2.17.0, measured on the live 2.16.2 site while chasing "rollaag ayarları ilk seçtiğim yerde güncellenmiyor": the
 // soldier course over the opening exists on a brick facade only and wears that facade's own brick (2.16.0). A
 // facade swap took the material-only path, which re-skins surface 'facade' and never touches the course, so red ->
 // black left a RED course over the opening, yellow -> wood left a yellow-brick course on a timber wall, and render ->
 // brick had no course at all — until some later click happened to rebuild the scene.
 const config={width:500,depth:300,facade:'brick-red',rollaag:'masonry'};
 for(const [from,to] of [['brick-red','brick-black'],['brick-red','brick-yellow'],['brick-yellow','wood-horizontal'],['render','brick-black'],['pvc-cream','brick-white']])
  assert.equal(sceneChange({...config,facade:from},{...config,facade:to}),'structure',`${from} -> ${to}`);
 for(const [from,to] of [['wood-vertical','pvc-green'],['render','open-horizontal']])
  assert.equal(sceneChange({...config,facade:from},{...config,facade:to}),'material',`${from} -> ${to}: no brick on either side, the fast path stays`);
});

function sceneHarness(config,scope=[]){
 const preview=Object.create(Preview.prototype);
 Object.assign(preview,{config:structuredClone(config),scope:structuredClone(scope),placement:null,model:buildGeometry(config,{scope}),examplesVisible:true,roofVisible:true,view:'interior',mode:'3d',materials:new Map(),buildCounts:{structure:0,material:0,fixtures:0},root:new THREE.Group(),ceilingGroup:new THREE.Group(),roofGroup:new THREE.Group(),renderer:{shadowMap:{}},updatePlan(){},render(){}});
 preview.root.add(preview.ceilingGroup,preview.roofGroup);preview.buildFixtures();return preview;
}
test('example devices outside and inside use real device materials on every facade, identical to supplied ones',()=>{
 const p=sceneHarness({interior:true,heating:'left',outsideLight:'left',outsideSocket:'left',outsideTap:'left'});
 const socket=()=>{const parts=[];p.fixtureGroup.getObjectByName('outsideSocket-left').traverse(part=>{if(part.isMesh&&!part.userData.lightEffect)parts.push([part.material.type,part.material.color.getHexString(),part.material.roughness,part.material.metalness]);});return parts;};
 const example=socket();
 for(const facade of ['pvc-green','pvc-black','pvc-cream','render','wood-vertical','brick-red']){
  p.model.facade=facade;p.buildFixtures();
  let outside=0,inside=0,strokes=0;
  p.fixtureGroup.traverse(part=>{
   if(part.isLineSegments||part.userData.contourSilhouette)strokes++;
   if(!part.isMesh||part.userData.lightEffect)return;
   let group=part;while(group.parent&&!group.userData.room)group=group.parent;
   assert.ok(part.material.colorWrite!==false&&part.castShadow,`${facade}: ${group.name} is a lit surface`);
   if(group.userData.room==='outside')outside++;else if(group.userData.room==='interior')inside++;
  });
  assert.ok(outside>0&&inside>0);assert.equal(strokes,0,`${facade}: no contour strokes remain`);
  assert.deepEqual(socket(),example,`${facade}: the example device does not change with the facade`);
 }
 p.setScope([{key:'outsideSocket',productIncluded:true}]);
 assert.deepEqual(socket(),example,'a supplied device looks exactly like the example device');
});
test('example and roof view changes hide floor illustrations and optical effects without hiding real preparation',()=>{
 const config={interior:true,underfloorHeating:true,heating:'left',ceilingPositions:['center']};
 const scope=[{key:'heating',components:[{role:'preparation',status:'included'}]},{key:'underfloorHeating',visualMode:'preparation',components:[{role:'preparation',status:'included'}]}];
 const p=sceneHarness(config,scope),before=JSON.stringify(scope);
 // Inside the room the loops show only while they are being laid; open-roof views always keep them.
 assert.equal(p.floorHeatingGroup.visible,false);assert.ok(visibleLightEffectCount(p.root)>0);
 p.underfloorAnimation={cancel(){}};p.applyUnderfloorVisibility();assert.equal(p.floorHeatingGroup.visible,true);
 p.setExamplesVisible(false);
 assert.equal(p.floorHeatingGroup.visible,false);assert.equal(visibleLightEffectCount(p.root),0);
 assert.equal(p.root.getObjectByName('heating-left-preparation')?.visible,true);
 p.setExamplesVisible(true);assert.equal(p.floorHeatingGroup.visible,true);
 p.underfloorAnimation=null;
 for(const [view,roofVisible,visible]of [['perspective',true,false],['top',true,true],['cutaway',true,true],['ceiling',false,false],['perspective',false,true]]){
  Object.assign(p,{view,roofVisible});p.applyRoofVisibility();assert.equal(p.floorHeatingGroup.visible,visible,view);
  if(['top','cutaway'].includes(view))assert.equal(visibleLightEffectCount(p.root),0,'ceiling effects hide with the roof');
 }
 p.setScope([{key:'underfloorHeating',productIncluded:true,visualMode:'product'}]);p.setExamplesVisible(false);
 assert.equal(p.floorHeatingGroup.visible,true,'a supplied product persists with examples off');
 p.setScope([{key:'underfloorHeating',productIncluded:true,visualMode:'none'}]);assert.equal(p.floorHeatingGroup.visible,false);
 assert.equal(JSON.stringify(scope),before);assert.equal(p.buildCounts.structure,0);
});

test('accepted placement updates existing fittings without changing selections or rebuilding the structure',()=>{
 const config={width:500,depth:300,height:280,interior:true,ceilingPositions:['center'],frontOpening:'french-black',rooflight:'none',drainSide:'right'};
 const p=sceneHarness(config),before=JSON.stringify(p.config),layout=structuredClone(p.model.fixtureLayout);
 layout.ceilingPositions.center=[12,271,91];
 p.setPlacement(layout);
 assert.deepEqual(p.model.fixtures.find(f=>f.key==='ceilingLights').position,[.12,2.71,.91]);
 assert.deepEqual(p.ceilingFixtures.children.find(f=>f.userData.scopeKey==='ceilingLights').position.toArray(),[.12,2.71,.91]);
 layout.ceilingPositions.center[0]=99;
 assert.equal(p.placement.ceilingPositions.center[0],12,'caller mutation cannot change accepted layout');
 p.setPlacement(null);assert.notEqual(p.model.fixtures.find(f=>f.key==='ceilingLights').position[0],.12);
 assert.equal(JSON.stringify(p.config),before);assert.equal(p.buildCounts.structure,0);
});
test('profile bevels preserve the declared opening dimensions',()=>{
 const geometry=profileGeometry(.055,2.3,.11);geometry.computeBoundingBox();const size=geometry.boundingBox.getSize(new THREE.Vector3());
 for(const [i,v]of [.055,2.3,.11].entries())assert.ok(Math.abs(size.getComponent(i)-v)<1e-6);geometry.dispose();
});
test('adjacent wall segments share metric texture courses',()=>{
 const a=metricUVs(new THREE.BoxGeometry(1,2,.22),[0,1,0],.88,.88),b=metricUVs(new THREE.BoxGeometry(1,2,.22),[1,1,0],.88,.88);
 function edge(geometry,x){const p=geometry.attributes.position,n=geometry.attributes.normal,u=geometry.attributes.uv;const values=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<1e-8&&n.getZ(i)===1)values.push([u.getX(i),u.getY(i)]);return values.sort();}
 assert.deepEqual(edge(a,.5),edge(b,-.5));a.dispose();b.dispose();
});
test('plan selection offers keyboard controls and preserves included fittings with examples off',()=>{
 const model=buildGeometry({interior:true,heating:'left',ceilingPositions:['center']});
 const scope=[{key:'heating',productIncluded:true,visualMode:'product'}];
 const svg=planSvg(model,true,{scope,examplesVisible:false,interactive:true});
 assert.match(svg,/data-option-key="heating" tabindex="0" role="button"/);assert.match(svg,/Radiator · inbegrepen/);assert.doesNotMatch(svg,/data-option-key="ceilingPositions"/);
 assert.doesNotMatch(planSvg(model,true,{scope}),/tabindex=/);
});
test('approved generic model variants retain their physical envelope in included and representative states',()=>{
 const material=(_key,options,type)=>type==='line'?new THREE.LineBasicMaterial(options):type==='flat'?new THREE.MeshBasicMaterial(options):new THREE.MeshStandardMaterial(options);
 for(const [key,assetKey,kind]of [['heating','heating-panel','radiator'],['ceilingLights','ceiling-dome','pendant']]){
  const models=[false,true].map(productIncluded=>buildFixture({id:key,key,kind,position:[0,0,0],rotation:0},fixtureAppearance([{key,assetKey,productIncluded}],key),material));
  const sizes=models.map(object=>new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()));
  assert.ok(sizes[0].distanceTo(sizes[1])<.012);
  if(kind==='radiator'){assert.ok(sizes[1].x>=.90&&sizes[1].x<=.94);assert.ok(sizes[1].y>=.60&&sizes[1].y<=.64);}
 }
});

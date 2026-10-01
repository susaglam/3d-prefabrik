import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';
import {FENCE_STYLE_IDS,DEFAULT_FENCE_STYLE,PANEL_MAX,FENCE_HEIGHT,MODERN,fencePanels,mergedBoxes,modernPanelParts,hedgeLeaves,occludingPanels} from '../../addons/cs_prefab_configurator/static/src/garden_fence.js';
import {FENCE_STYLES,normalizeEnvironment} from '../../addons/cs_prefab_configurator/static/src/environment.js';
import {fenceIcon} from '../../addons/cs_prefab_configurator/static/src/house_type_icons.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';

/** The same bare Preview environment.test.mjs builds: the house, the buren and the garden, no WebGL. */
function sceneHarness(config,environment,{fence=true}={}){
 const preview=Object.create(Preview.prototype);
 Object.assign(preview,{config:structuredClone(config),scope:[],placement:null,model:buildGeometry(config),examplesVisible:true,decorVisible:true,roofVisible:true,view:'perspective',mode:'3d',materials:new Map(),textures:new Set(),maps:{},buildCounts:{structure:0,material:0,fixtures:0},root:new THREE.Group(),renderer:{shadowMap:{}},environment:normalizeEnvironment(environment),gardenFence:fence,updatePlan(){},render(){}});
 preview.facade=code=>preview.material(`facade:${code}`,{color:'#ffffff'});
 preview.surroundingsGroup=new THREE.Group();preview.root.add(preview.surroundingsGroup);
 preview.makeExistingHouse(preview.model,preview.material('plaster',{color:'#dfdcd4'}),null,preview.material('dark',{color:'#353b38'}));
 preview.decorGroup=new THREE.Group();preview.surroundingsGroup.add(preview.decorGroup);
 preview.makeGarden(preview.model);
 return preview;
}
const panelsOf=p=>p.fencePanels||[];
const hiddenFrom=(p,eye)=>{p.camera={position:new THREE.Vector3(...eye)};p.fenceOcclusionKey='';p.updateFenceOcclusion();return panelsOf(p).filter(node=>!node.visible);};

test('one list of styles, modern first, shared by the form, the scene and the default',()=>{
 assert.deepEqual([...FENCE_STYLE_IDS],FENCE_STYLES.map(style=>style.id));
 assert.equal(FENCE_STYLE_IDS[0],'modern');assert.equal(DEFAULT_FENCE_STYLE,'modern');
 assert.equal(normalizeEnvironment({fenceStyle:'hedge'}).fenceStyle,'hedge');
 assert.equal(normalizeEnvironment({fenceStyle:'barbed'}).fenceStyle,'modern','an unknown style falls back to the default');
 for(const id of FENCE_STYLE_IDS)assert.match(fenceIcon(id),new RegExp('data-fence="'+id+'"'));
 assert.match(fenceIcon('barbed'),/data-fence="modern"/);
});

test('a run is split into equal panels of at most 1,8 m, each turned along its run',()=>{
 const panels=fencePanels([{kind:'side',start:[2,0],end:[2,10.3]},{kind:'back',start:[-3,10.3],end:[3,10.3]}]);
 const side=panels.filter(p=>p.kind==='side'),back=panels.filter(p=>p.kind==='back');
 assert.equal(side.length,Math.ceil(10.3/PANEL_MAX));assert.equal(back.length,Math.ceil(6/PANEL_MAX));
 assert.ok(Math.abs(side.reduce((sum,p)=>sum+p.length,0)-10.3)<1e-9,'the panels cover the whole run');
 for(const p of panels)assert.ok(p.length<=PANEL_MAX+1e-9);
 // Local +x must run along the run: a side run goes +z, the back run +x.
 const along=p=>new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),p.yaw);
 assert.ok(along(side[0]).distanceTo(new THREE.Vector3(0,0,1))<1e-9);assert.ok(along(back[0]).distanceTo(new THREE.Vector3(1,0,0))<1e-9);
 assert.ok(side[0].first&&!side[0].last&&side.at(-1).last);
});

test('merged boxes are one geometry with each box’s own uv rule; modern slats each show one scanned board',()=>{
 const geometry=mergedBoxes([{size:[1,1,1],position:[0,0,0]},{size:[1,1,1],position:[2,0,0],uv:()=>[.5,.5]}]);
 assert.equal(geometry.attributes.position.count,48);assert.equal(geometry.index.count,72);
 assert.deepEqual([...geometry.attributes.uv.array.slice(48,50)],[.5,.5],'the second box took its own uv rule');
 const parts=modernPanelParts(1.7,3);
 assert.ok(parts.slats.length>=12,'a full-height slat fence');assert.ok(parts.top<=FENCE_HEIGHT);
 const slats=mergedBoxes(parts.slats),uv=slats.attributes.uv,pos=slats.attributes.position;
 // Per slat (24 vertices) the v range is exactly one board band of the twelve on the scan.
 for(let s=0;s<parts.slats.length;s++){
  const vs=[];for(let i=s*24;i<(s+1)*24;i++)vs.push(uv.getY(i));
  assert.ok(Math.max(...vs)-Math.min(...vs)<=1/MODERN.boardsPerTile+1e-6,`slat ${s} stays on one board`);
 }
 assert.ok(pos.count>0);
});

test('a hedge panel softens its top edge with deterministic leaf clusters',()=>{
 // The faces carry the generated leaf texture (preview.js hedgeMap); the clusters only break the straight top line.
 const a=hedgeLeaves(1.8,2),b=hedgeLeaves(1.8,2);
 assert.ok(a.length>=60);assert.deepEqual(a,b,'the same garden on every visit');
 for(const leaf of a)assert.ok(leaf.position[1]>=1.5,'every cluster sits on or near the top');
});

test('every style builds panels; the admin switch removes them all',()=>{
 for(const style of FENCE_STYLE_IDS){
  const p=sceneHarness({width:500,depth:300},{fenceStyle:style});
  assert.ok(panelsOf(p).length>=10,`${style}: side and back runs in panels`);
  const names=new Set();for(const node of panelsOf(p))node.traverse(o=>{if(o.name)names.add(o.name);});
  const expected={modern:'garden-fence-slats',hedge:'garden-hedge-leaves',classic:'garden-fence-planks'}[style];
  assert.ok(names.has(expected),`${style} draws its own material (${expected})`);
 }
 assert.equal(panelsOf(sceneHarness({width:500,depth:300},{},{fence:false})).length,0);
});

test('the panel in front of the aanbouw steps aside for the camera; square on, nothing does',()=>{
 // "hangi açıdan bakarsak o taraftaki çitin kesişen blok gözükmesin. düz baktığımızda gözükebilir."
 for(const houseType of ['terraced','detached']){
  const p=sceneHarness({width:500,depth:300},{houseType}),b=p.model.bounds;
  const fromRight=hiddenFrom(p,[b.right+6,2.2,b.front+5.5]);
  assert.ok(fromRight.length>=1,`${houseType}: from the right something stood in the way`);
  for(const node of fromRight)assert.ok(node.userData.box.min.x>=b.right-.3,`${houseType}: only right-hand panels step aside`);
  const fromLeft=hiddenFrom(p,[b.left-6,2.2,b.front+5.5]);
  for(const node of fromLeft)assert.ok(node.userData.box.max.x<=b.left+.3,`${houseType}: only left-hand panels step aside`);
  assert.equal(hiddenFrom(p,[0,1.6,b.front+7]).length,0,`${houseType}: square on, every panel stays`);
  assert.equal(hiddenFrom(p,[0,1.6,b.front+7]).length,0,'and the hidden ones come back');
 }
});

test('occludingPanels ignores a camera standing inside a panel box and panels behind the target',()=>{
 const bounds={left:-2.5,right:2.5,back:-1.5,front:1.5},box=(min,max)=>({box:new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max))});
 const inFront=box([4,0,0],[4.05,1.8,5]),behind=box([-4.05,0,-5],[-4,1.8,5]);
 const hidden=occludingPanels(new THREE.Vector3(8,1.8,3),bounds,2.8,[inFront,behind]);
 assert.ok(hidden.has(inFront));assert.ok(!hidden.has(behind));
 assert.equal(occludingPanels(new THREE.Vector3(4.02,1,1),bounds,2.8,[inFront]).size,0);
});

/**
 * The three ruimtelijke beelden of a proposal: what is in them, what is not, and how tightly the aanbouw is framed.
 *
 * The customer's report was that the beelden showed the buurhuizen, the bestaande woning, het gras, de schutting,
 * de tuinmeubels and de binneninrichting, and that the aanbouw itself was a fifth of the picture with the rest
 * spent on fitting a house in behind it. These tests build a REAL scene (no renderer needed) and read back the
 * scene the document camera is pointed at, plus the geometry of the framing itself.
 *
 * What a captured JPEG really contains is asserted in scripts/verify-document-capture.mjs, which runs the whole
 * pipeline in a browser; this file pins the scene and the camera maths, which are deterministic and need no GPU.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {normalizeEnvironment} from '../../addons/cs_prefab_configurator/static/src/environment.js';
import {DOCUMENT_PARTS} from '../../addons/cs_prefab_configurator/static/src/scene_content.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

/** A Preview with a real built scene and a real camera, but no WebGL: everything under test is CPU-side. */
function documentHarness(config,{environment,documentSurroundings=false,documentParts,aspect=1440/960}={}) {
 const preview=Object.create(Preview.prototype);
 const camera=new THREE.PerspectiveCamera(40,aspect,.035,150);
 Object.assign(preview,{config:structuredClone(config),model:buildGeometry(config),scope:[],placement:null,
  mode:'3d',view:'perspective',camera,cameraFocus:null,cameraTouched:false,dimensionsVisible:false,roofVisible:true,
  examplesVisible:true,decorVisible:true,illustrativeOff:{},surroundingsVisible:true,documentSurroundings,
  // Set by the constructor this harness deliberately bypasses; buildScene hangs the named document parts off them.
  // Set by the constructor this harness deliberately bypasses. The defaults come from the SHIPPED constant, not
  // from a copy typed here: a harness that restates the default it is about to assert on can only ever agree with
  // itself — mutating DOCUMENT_PARTS to houseRoom:true left all nine tests green until this line read it instead.
  documentParts:{...DOCUMENT_PARTS,...documentParts},partGroups:{},documentMode:false,
  materials:new Map(),textures:new Set(),maps:{},buildCounts:{structure:0,material:0,fixtures:0},
  environment:normalizeEnvironment(environment),scenario:'none',floorFinish:'laminate',
  scene:new THREE.Scene(),renderer:{shadowMap:{}},plan:{style:{}},host:{style:{}},
  container:{clientWidth:1440,clientHeight:960},
  // update() does what the real OrbitControls does on a moved camera: it fires 'change', and the Preview's 'change'
  // listener is clampCamera (preview.js _clampToGround). Without that this harness passed the proposal's "Een blik naar
  // binnen" while every real PDF showed a close-up of the floor (2.18.4): the room limit of the inside views pulled the
  // document camera, whose view is also called 'interior', down into the room.
  controls:{target:new THREE.Vector3(),maxDistance:27,update(){camera.updateMatrixWorld(true);preview.clampCamera();camera.updateMatrixWorld(true);}},
  updatePlan(){},render(){},applyMode(){},setHighlight(){},buildFixtures(){},updateFacade(){}});
 preview.scene.fog=new THREE.Fog('#e7e9e5',27,60);
 preview.scene.add(preview.camera);
 // The scanned facade and the dimension labels draw on a <canvas>; node has none and neither is under test here.
 preview.facade=code=>preview.material(`facade:${code}`,{color:'#ffffff'});
 preview.makeDimensions=()=>{};
 preview.buildScene();
 return preview;
}
const named=(root,name)=>{const found=[];root.traverse(object=>{if(object.name===name)found.push(object);});return found;};
/** Whether an object is really drawn: three hides a child of a hidden parent, so the whole chain has to be walked. */
const drawn=object=>{for(let node=object;node;node=node.parent)if(!node.visible)return false;return true;};
const path=object=>{const names=[];for(let node=object;node;node=node.parent)if(node.name)names.unshift(node.name);return names.join('/');};

test('the omgeving is one named group, and it holds everything that is not being sold',()=>{
 const p=documentHarness({width:620,depth:320});
 assert.equal(p.surroundingsGroup.name,'surroundings');
 assert.equal(p.surroundingsGroup.parent,p.root);
 // The families the customer listed, each hanging from that one group: the lawn, the existing house, the
 // buurhuizen and de tuinaankleding. The voorbeeldinrichting joins them when a scenario is loaded (applyScenario).
 // `existing-room-shell` is the ceiling and the two flanks of the room behind the doorbraak: house structure that
 // is buried inside the house while it is drawn, and a white box behind the product the moment it is not.
 // `horizon-mist` (2.10.5) is the haze ring round the plot island: part of the garden picture, so the studio drops it.
 assert.deepEqual(p.surroundingsState().covers.sort(),
  ['existing-house','existing-room-shell','garden','ground-grass','horizon-mist','neighbours']);
 assert.equal(p.houseGroup.parent,p.surroundingsGroup);
 assert.equal(p.neighbourGroup.parent,p.surroundingsGroup);
 assert.equal(p.decorGroup.parent,p.surroundingsGroup);
 // And its counterpart, which is shown exactly when the omgeving is not.
 assert.equal(p.studioGroup.name,'studio-ground');
 assert.equal(p.studioGroup.visible,false,'a visitor configuring an aanbouw stands in a garden, not in a studio');
});

test('a proposal image drops the omgeving and keeps the terras and everything mounted on the product',()=>{
 const p=documentHarness({width:620,depth:320,outsideLight:'both',outsideSocket:'double-both',outsideTap:'both',
  heating:'both',rooflight:'gable-8'});
 p.buildFixtures=Preview.prototype.buildFixtures;p.buildFixtures();
 for(const view of ['perspective-left','perspective-right','interior']) {
  assert.equal(p.setDocumentView(view),true,view);
  // Gone: the bestaande woning, de buurhuizen, het gras en de tuinaankleding — in one move, by their shared parent.
  assert.equal(p.surroundingsGroup.visible,false,view);
  for(const group of [p.houseGroup,p.neighbourGroup,p.decorGroup])assert.equal(drawn(group),false,`${view}: ${path(group)}`);
  // `drawn(undefined)` would answer "yes", so every lookup is proved to have found something first.
  for(const name of ['ground-grass','garden-set','existing-house','neighbours']) {
   const found=named(p.root,name);
   assert.equal(found.length,1,`${view}: ${name} is in the scene to be hidden`);
   assert.equal(drawn(found[0]),false,`${view}: ${name}`);
  }
  // Kept: het terras the aanbouw stands on, with its voegen.
  const terrace=named(p.root,'terrace');
  assert.equal(terrace.length,1,`${view}: het terras`);
  assert.equal(drawn(terrace[0]),true,`${view}: het terras stays under the aanbouw`);
  assert.ok(named(p.root,'terrace-joint').length>3,`${view}: and so do its voegen`);
  // Gone: the whole room behind the doorbraak. It is the bestaande woning's living room — eight metres of it —
  // and with the house switched off it stood in the studio beside the product: its rear lining above the daktrim,
  // its floor past the rear corner, and roofless from above on the beeld zonder dak. See DOORBRAAK_REVEAL.
  for(const name of ['existing-room-floor','existing-room-rear','existing-room-ceiling','existing-room-flank']) {
   const found=named(p.root,name);
   assert.ok(found.length>=1,`${view}: ${name} is in the scene to be hidden`);
   for(const mesh of found)assert.equal(drawn(mesh),false,`${view}: ${name} is the woning, not the product`);
  }
  // Kept, by default: the half metre of it that stands in for the opening (DOORBRAAK_REVEAL), so the doorbraak
  // reads as an opening and not as a view onto the studio's horizon. Whether it is drawn is the administrator's
  // `houseRoom` switch; scene_content.js records the measurement the default was decided on. The soffit is
  // plafond and goes with the dak on het beeld zonder dak.
  for(const name of ['doorbraak-floor','doorbraak-rear','doorbraak-flank','doorbraak-soffit']) {
   const found=named(p.root,name);
   assert.ok(found.length>=1,`${view}: ${name} is built`);
   const expected=name==='doorbraak-soffit'?view!=='interior':true;
   for(const mesh of found)assert.equal(drawn(mesh),expected,`${view}: ${name} stands in for the opening`);
  }
  assert.equal(p.studioGroup.visible,true,`${view}: the studio floor takes the lawn's place`);
  // Kept: everything MOUNTED on the product. The customer named these: lampen, stopcontacten, kraan, radiator.
  // fixtures.js puts `fixtureId` on the group it builds, so that is what is looked up — and the count is asserted
  // first, because a filter that silently matches nothing would make every line below it pass.
  const mounted=new Map();
  p.root.traverse(object=>{if(object.userData.fixtureId)mounted.set(object.userData.fixtureId,object);});
  const wanted=['outsideLight','outsideSocket','outsideTap','radiator','heating'];
  const present=[...mounted.values()].filter(group=>wanted.includes(group.userData.scopeKey));
  assert.ok(present.length>=4,`${view}: the test design really carries mounted products (${present.length})`);
  for(const group of present) {
   assert.equal(drawn(group),true,`${view}: ${group.userData.fixtureId} stays in the picture`);
   const meshes=[];group.traverse(o=>{if(o.isMesh)meshes.push(o);});
   assert.ok(meshes.length>0,`${view}: ${group.userData.fixtureId} is really geometry, not an empty group`);
  }
 }
});

test('the admin setting puts the omgeving back, and only that setting does',()=>{
 const p=documentHarness({width:620,depth:320},{documentSurroundings:true});
 p.setDocumentView('perspective-left');
 assert.equal(p.surroundingsGroup.visible,true,'an administrator who asked for the tuin gets the tuin');
 assert.equal(p.studioGroup.visible,false);
 assert.equal(drawn(named(p.root,'ground-grass')[0]),true);
 assert.deepEqual(p.surroundingsState().documentSurroundings,true);
 // And back again without a rebuild, the same way the capture pipeline sets it.
 p.setDocumentSurroundings(false);p.setDocumentView('perspective-left');
 assert.equal(p.surroundingsGroup.visible,false);
 assert.equal(p.studioGroup.visible,true);
 // A visitor who switched the tuinaankleding off keeps that choice through both flips: the switch never rewrites it.
 const q=documentHarness({width:620,depth:320});
 q.setDecorVisible(false);q.setDocumentView('perspective-left');q.setDocumentSurroundings(true);q.setDocumentView('perspective-left');
 assert.equal(q.decorGroup.visible,false,'the omgeving came back; the visitor own tuinaankleding did not');
});

/**
 * Framing. `setDocumentView` fits the aanbouw's own volume — daktrim, overstek and lichtkoepel included — and
 * nothing else. Two properties say whether that worked, and they hold at every size the catalogue allows:
 *
 *   contained — every corner of that volume is inside the frame (nothing of the product is cut off), and
 *   touching  — at least one corner sits ON the frame edge (no distance was spent on something else).
 *
 * "Touching" is the half the old code was missing: it fitted honestly and then aimed at a fixed guess, so one
 * edge kept its margin while the opposite corner touched, and the aanbouw filled a fifth of the picture.
 */
const frameBox=(m,view)=>{
 const slabTop=m.height+m.roofThickness/2;
 const roofed=m.rooflight?.panelCount?Math.max(slabTop,m.rooflight.baseY+m.rooflight.rise):slabTop;
 // The beeld zonder dak is framed without one; every other view takes the daktrim and any lichtkoepel with it.
 const crown=view==='interior'?m.height:roofed;
 const frontFace=m.bounds.front+(m.overhangDepth||0);
 const margin=extent=>Math.max(.06,extent*.02);
 return {left:-m.width/2-margin(m.width),right:m.width/2+margin(m.width),bottom:-.05,top:crown+margin(crown),
  back:m.bounds.back,front:frontFace+margin(frontFace-m.bounds.back)};
};
const framing=p=>{
 const box=frameBox(p.model,p.view);let maxX=0,maxY=0;
 for(const x of [box.left,box.right])for(const y of [box.bottom,box.top])for(const z of [box.back,box.front]) {
  const point=new THREE.Vector3(x,y,z).project(p.camera);
  maxX=Math.max(maxX,Math.abs(point.x));maxY=Math.max(maxY,Math.abs(point.y));
 }
 return {maxX,maxY};
};

test('the doorbraak switch shows the opening and never a second building',()=>{
 // What the administrator gets by ticking `houseRoom`: the first half metre of the room, and NOT the room. The
 // whole eight-metre living room used to stand there — measured on the 620x320, its rear lining rose 3,36 % of
 // the frame above the daktrim, its floor ran 2,55 % past the rear corner, and on het beeld zonder dak that floor
 // was 22,08 % of the picture, a laminate plain wider than the product.
 //
 // The property asserted here is a property of the SCENE, in world metres: the recess never reaches wider than
 // the aanbouw, never higher, and never deeper than DOORBRAAK_REVEAL behind the house wall. Deliberately not a
 // screen-rectangle containment: a first version of this test projected both bounding boxes and demanded the
 // opening's rectangle sit inside the product's, and that fails on geometry that is perfectly correct — the
 // recess stands 0,55 m FURTHER from the camera, so in a view that looks down into it (interior) its top corner
 // lands higher on screen than the aanbouw's own rear edge, by a measured 4,1 % of the frame on the 750x340 and
 // 11,5 % on the 150x100. Those TOP corners are open air rather than pixels — the soffit is off in that view
 // precisely so the camera can look down into the alcove — and a bounding box in NDC cannot tell open air from a
 // wall. The SIDES were a different matter and really were pixels: at the full m.width the recess's outer faces
 // were coplanar with the aanbouw's own, 0,55 m behind where those walls stop, and rays landed on the far leaf for
 // 3,44 % of the frame on the 150x100 — a white panel standing beside the product. That is fixed in makeDoorbraak
 // by insetting the recess to the clear opening, which is why the width assertion below is worth its line.
 // Counting pixels stays with scripts/verify-document-capture.mjs, where rays hit named meshes and the doorbraak
 // has a bucket and a ceiling of its own; this file keeps the scene and the camera maths, as its header says.
 const designs=[{width:620,depth:320},{width:150,depth:100},{width:150,depth:340},{width:750,depth:100},
  {width:750,depth:340},{width:750,depth:340,overhang:'full',rooflight:'gable-8'}];
 for(const design of designs) {
  const p=documentHarness(design,{documentParts:{houseRoom:true}});
  for(const view of ['perspective-left','perspective-right','interior']) {
   p.setDocumentView(view);
   const label=`${design.width}x${design.depth} ${view}`;
   for(const name of ['doorbraak-floor','doorbraak-rear','doorbraak-flank']) {
    const found=named(p.root,name);
    assert.ok(found.length>=1,`${label}: ${name} exists`);
    for(const mesh of found)assert.equal(drawn(mesh),true,`${label}: ${name} closes the view through the doorbraak`);
   }
   // The soffit is plafond, so it goes with the dak that "Ruimtelijk overzicht zonder dak" takes off.
   assert.equal(drawn(named(p.root,'doorbraak-soffit')[0]),view!=='interior',`${label}: de soffit volgt het dak`);
   const m=p.model,opening=new THREE.Box3().setFromObject(named(p.root,'doorbraak')[0]);
   // Inside the aanbouw's INNER faces, not merely inside its outer ones: that is what puts the building's own
   // 22 cm side walls between every forward camera and the recess. The tolerance is one millimetre, not a margin.
   const inner=m.width/2-m.wall+.001;
   assert.ok(opening.min.x>=-inner&&opening.max.x<=inner,
    `${label}: de doorbraak blijft binnen de binnenmaat van de aanbouw (${opening.min.x.toFixed(3)}..${opening.max.x.toFixed(3)} in ${(-inner).toFixed(3)}..${inner.toFixed(3)})`);
   assert.ok(opening.max.y<=m.height+1e-6,`${label}: en nooit hoger (${opening.max.y.toFixed(3)} > ${m.height.toFixed(3)})`);
   // The whole point: what is left of the woning is a recess, not a room. 0,55 m is DOORBRAAK_REVEAL; the room it
   // replaced was 7,88 m deep on this house type, which is the number that made it a second building.
   const depth=m.bounds.back-opening.min.z;
   assert.ok(depth>.2&&depth<=.56,`${label}: de doorbraak is een nis van ${depth.toFixed(3)} m, geen kamer`);
  }
 }
});

/** Every drawn mesh whose path names a part of the woning, split into the recess and everything else. */
const woningOnScreen=p=>{
 const found={doorbraak:[],woning:[]};
 p.root.traverse(object=>{
  if(!object.isMesh||!drawn(object))return;
  const name=path(object);
  if(/doorbraak/.test(name))found.doorbraak.push(name);
  else if(/existing-|house-|neighbour|floor-finish-house/.test(name))found.woning.push(name);
 });
 return found;
};

test('by default a proposal image shows the doorbraak and nothing else of the woning',()=>{
 // The customer's rule, in their own words: "sadece prefabrik alani gozuksun … bu resimde kalan parcalarida evin
 // kendisine dahil et, prefabrik yapiya degil". The default is what an administrator who has never opened the
 // vormgeving gets, so it is read from the shipped constant, not restated here.
 //
 // Asserted by NAME, over the whole scene, rather than by group: every earlier version of this promise was made
 // about a group, and what escaped it was the meshes that did not hang from that group.
 const p=documentHarness({width:620,depth:320});
 assert.deepEqual({...p.documentParts},{...DOCUMENT_PARTS},'the harness runs on the shipped default');
 assert.equal(DOCUMENT_PARTS.houseRoom,true,'de doorbraak staat standaard in beeld (gemeten, zie scene_content.js)');
 for(const view of ['perspective-left','perspective-right','interior']) {
  p.setDocumentView(view);
  const {doorbraak,woning}=woningOnScreen(p);
  assert.deepEqual(woning,[],`${view}: van de woning zelf is niets meer in beeld`);
  assert.ok(doorbraak.length>=3,`${view}: de nis achter de doorbraak wel (${doorbraak.length})`);
  // And the aanbouw is still standing on something: the slab is the default, the apron with it.
  assert.equal(drawn(named(p.root,'terrace')[0]),true,`${view}: de betonvloer onder de aanbouw`);
  assert.equal(drawn(named(p.root,'terrace-reach')[0]),true,`${view}: en het terras naar de tuin`);
 }
});

test('with the doorbraak switched off a proposal image carries no part of the woning at all',()=>{
 const p=documentHarness({width:620,depth:320},{documentParts:{houseRoom:false}});
 for(const view of ['perspective-left','perspective-right','interior']) {
  p.setDocumentView(view);
  assert.deepEqual(woningOnScreen(p),{doorbraak:[],woning:[]},`${view}: kaal product`);
 }
 // Only the PROPOSAL obeys it: a visitor configuring the aanbouw keeps the whole garden, house and all.
 const live=documentHarness({width:620,depth:320},{documentParts:{houseRoom:false,slab:false,terrace:false}});
 assert.ok(woningOnScreen(live).woning.length>0,'de bezoeker ziet de woning nog gewoon');
 for(const name of ['terrace','terrace-reach'])assert.equal(drawn(named(live.root,name)[0]),true,`de bezoeker ziet ${name}`);
});

test('the slab and the terras are two switches, and each one really moves its own concrete',()=>{
 // "bahceye uzanan beton zemin kalabilir … prefabrik beton altindaki ayri bir secenekle olsun" — one mesh could
 // not answer both, so there are two, and this pins that each switch moves exactly one of them.
 const cases=[
  [{slab:true,terrace:true},{terrace:true,'terrace-reach':true,'terrace-joint':true}],
  [{slab:true,terrace:false},{terrace:true,'terrace-reach':false,'terrace-joint':false}],
  [{slab:false,terrace:true},{terrace:false,'terrace-reach':true,'terrace-joint':true}],
  [{slab:false,terrace:false},{terrace:false,'terrace-reach':false,'terrace-joint':false}],
 ];
 for(const [parts,expected] of cases) {
  const p=documentHarness({width:620,depth:320},{documentParts:parts});
  // While the visitor is configuring, every switch is off duty: they govern the PDF, not the live picture.
  for(const [name,] of Object.entries(expected))
   assert.equal(drawn(named(p.root,name)[0]),true,`${JSON.stringify(parts)}: ${name} staat er voor de bezoeker`);
  p.setDocumentView('perspective-left');
  for(const [name,shown] of Object.entries(expected))
   assert.equal(drawn(named(p.root,name)[0]),shown,`${JSON.stringify(parts)}: ${name} in het voorstelbeeld`);
  // Read back from the scene graph, not from the flags that asked for it.
  const state=p.documentPartsState();
  assert.equal(state.documentMode,true);
  assert.equal(state.inScene.slab,parts.slab!==false);
  assert.equal(state.inScene.terrace,parts.terrace!==false);
 }
});

test('the two pieces of paving cover exactly the plane the one piece covered',()=>{
 // A split is only allowed to change what can be switched, never what is drawn. The single mesh reached from
 // 0,275 m behind the back wall to 2,00 m into the garden; these two together must still do that, and must still
 // carry ONE continuous tile pattern across the joint (metricUVs writes uv from world coordinates, so the seam is
 // invisible only as long as both pieces keep their own world origin).
 const p=documentHarness({width:620,depth:320});
 const m=p.model,slab=named(p.root,'terrace')[0],reach=named(p.root,'terrace-reach')[0];
 const box=mesh=>new THREE.Box3().setFromObject(mesh);
 const a=box(slab),b=box(reach);
 assert.ok(Math.abs(a.min.z-(m.bounds.back-.275))<1e-6,`de plaat begint achter de achtergevel (${a.min.z.toFixed(4)})`);
 // 3,20 m since 2.13.1: the customer asked for a longer terras so the tuinset could stand clear of the aanbouw.
 assert.ok(Math.abs(b.max.z-(m.bounds.front+3.2))<1e-6,`het terras eindigt 3,20 m in de tuin (${b.max.z.toFixed(4)})`);
 assert.ok(b.min.z<=a.max.z+1e-9&&a.max.z-b.min.z<.011,'ze raken elkaar en overlappen 5 mm, nooit vlak op vlak');
 for(const side of ['min','max'])for(const axis of ['x','y'])
  assert.ok(Math.abs(a[side][axis]-b[side][axis])<1e-6,`${side}.${axis}: even breed en even dik`);
 // The seam itself: a vertex of each piece at the same world x must carry the same u, or the tiles jump.
 const u=mesh=>{
  const position=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv,found=[];
  for(let i=0;i<position.count;i++)if(Math.abs(position.getY(i))>.05&&position.getY(i)>0)
   found.push([+(position.getX(i)+mesh.position.x).toFixed(4),+uv.getX(i).toFixed(6)]);
  return new Map(found);
 };
 const left=u(slab),right=u(reach);let compared=0;
 for(const [x,value] of left)if(right.has(x)){assert.equal(right.get(x),value,`u springt bij x=${x}`);compared++;}
 assert.ok(compared>=2,`er zijn echt gedeelde randen vergeleken (${compared})`);
});

test('every proposal camera contains the aanbouw and spends no distance on anything else',()=>{
 // The four corners of the catalogue plus the two options that grow the volume: overstek forward, koepel upward.
 const designs=[
  ['smalst en ondiepst',{width:150,depth:100}],
  ['smalst en diepst',{width:150,depth:340}],
  ['breedst en ondiepst',{width:750,depth:100}],
  ['breedst en diepst',{width:750,depth:340}],
  ['met overstek',{width:620,depth:320,overhang:'pvc-white'}],
  ['met overstek en lichtkoepel',{width:750,depth:340,overhang:'pvc-white',rooflight:'gable-8'}],
  ['zonder pui',{width:400,depth:240,frontOpening:'none'}],
 ];
 for(const [label,config] of designs) {
  const p=documentHarness(config);
  for(const view of ['perspective-left','perspective-right','interior']) {
   p.setDocumentView(view);
   const {maxX,maxY}=framing(p);
   assert.ok(maxX<=1.0005&&maxY<=1.0005,`${label} ${view}: the aanbouw is cut off (${maxX.toFixed(3)}, ${maxY.toFixed(3)})`);
   assert.ok(Math.max(maxX,maxY)>=.995,`${label} ${view}: the frame is not filled (${maxX.toFixed(3)}, ${maxY.toFixed(3)})`);
  }
  // Left and right are mirror images: the same aanbouw at the same size, so the same framing.
  p.setDocumentView('perspective-left');const left=framing(p);
  p.setDocumentView('perspective-right');const right=framing(p);
  assert.ok(Math.abs(left.maxX-right.maxX)<1e-6&&Math.abs(left.maxY-right.maxY)<1e-6,`${label}: the two tuinperspectieven frame alike`);
 }
});

test('the dimension overlay stays out of the AO G-buffer, so no black slab stands next to a label',()=>{
 // GTAO draws the scene with an override material, which renders a label sprite as a fixed 1.9 × 0.48 m plate and
 // shades around it (2026-09-19). The pass skips anything flagged excludeFromAO; the whole overlay group carries it.
 // The pixels themselves are measured in scripts/verify-dimensions.mjs.
 const p=documentHarness({width:750,depth:300});
 assert.equal(p.dimensionGroup.name,'dimensions');
 assert.equal(p.dimensionGroup.parent,p.root);
 assert.equal(p.dimensionGroup.userData.excludeFromAO,true);
});

test('grass only on the plot: the island covers the house, the buren while shown and the garden, and no more',()=>{
 // "çimler her yerde gözükmese … odak prefabrik kısımda olmalı" (2026-09-19). The lawn plane keeps its 400 m, but
 // its shader dissolves it into the haze outside this rectangle; the numbers are what the fade is given.
 const detached=documentHarness({width:661,depth:302},{environment:{houseType:'detached'}});
 const b=detached.model.bounds,plot=detached.updatePlotFade();
 assert.ok(plot.x0<b.left-1&&plot.x1>b.right+1,'the side gardens are on the island');
 assert.ok(plot.z1>=b.front+10.3,'the garden up to the back schutting is on the island');
 assert.ok(plot.z0<b.back-5,'the house behind the aanbouw is on the island');
 assert.ok(plot.x1-plot.x0<16&&plot.z1-plot.z0<24,'and the lawn stops there instead of running to the horizon');
 const rect=detached.plotUniforms.plotRect.value;
 assert.deepEqual([rect.x,rect.y,rect.z,rect.w].map(v=>+v.toFixed(3)),[(plot.x0+plot.x1)/2,(plot.z0+plot.z1)/2,(plot.x1-plot.x0)/2,(plot.z1-plot.z0)/2].map(v=>+v.toFixed(3)));
 // Shown on purpose: since 2.16.0 the buurhuizen start hidden, and this is the case where they are switched on.
 const terraced=documentHarness({width:661,depth:302},{environment:{houseType:'terraced',renderNeighbours:true}});
 const wide=terraced.updatePlotFade();
 assert.ok(wide.x1-wide.x0>plot.x1-plot.x0+8,'shown buren widen the island so they never stand in the haze');
 terraced.environment={...terraced.environment,renderNeighbours:false};
 const alone=terraced.updatePlotFade();
 assert.ok(alone.x1-alone.x0<wide.x1-wide.x0,'hidden buren take their share of lawn with them');
 const [lawn]=named(detached.root,'ground-grass'),[mist]=named(detached.root,'horizon-mist');
 assert.equal(lawn.material.userData.plotFade,true,'the lawn material carries the fade');
 assert.equal(lawn.userData.excludeFromAO,true,'the far plane stays out of GTAO (it drew a line on the horizon)');
 assert.ok(mist&&mist.userData.excludeFromAO&&mist.material.transparent&&!mist.material.depthWrite,'a soft mist ring hides the horizon seam');
 assert.equal(path(mist),path(lawn).replace(/\/ground-grass$/,'')+'/horizon-mist','the mist hangs with the lawn under the omgeving, so the studio drops it too');
});

test('a proposal camera never inherits the state of the view before it',()=>{
 const p=documentHarness({width:500,depth:300,rooflight:'gable-8'});
 // Everything a visitor can leave behind: an orbited camera, a hidden roof, dimensions on, a hover outline, a 2D tab.
 p.camera.fov=64;p.camera.position.set(9,.4,-7);p.controls.target.set(2,2,2);
 p.mode='2d';p.dimensionsVisible=true;p.cameraTouched=true;p.cameraFocus={kind:'option',key:'rooflight'};
 p.setDocumentView('perspective-left');
 const pose=[p.camera.position.toArray(),p.controls.target.toArray(),p.camera.fov];
 assert.equal(p.mode,'3d');assert.equal(p.camera.fov,40);assert.equal(p.dimensionsVisible,false);
 assert.equal(p.cameraFocus,null);assert.equal(p.cameraTouched,false);
 assert.equal(p.dimensionGroup.visible,false);
 const q=documentHarness({width:500,depth:300,rooflight:'gable-8'});
 q.setDocumentView('perspective-left');
 assert.deepEqual([q.camera.position.toArray(),q.controls.target.toArray(),q.camera.fov],pose,
  'the same design gives the same frame whatever happened before it');
 assert.throws(()=>q.setDocumentView('back'),/Unknown document view/);
});

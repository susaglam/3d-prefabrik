import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeEnvironment,houseLayout,FACADE_FINISHES} from '../../addons/cs_prefab_configurator/static/src/environment.js';
import {finishColor,shadeHex} from '../../addons/cs_prefab_configurator/static/src/finishes.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

/** Same shape as environment.test.mjs: a prototype-backed Preview without a renderer, only the existing house built. */
function houseHarness(config,environment,extra={}){
 const preview=Object.create(Preview.prototype);
 Object.assign(preview,{config:structuredClone(config),scope:[],placement:null,model:buildGeometry(config),examplesVisible:true,decorVisible:true,roofVisible:true,view:'perspective',mode:'3d',materials:new Map(),textures:new Set(),maps:{},buildCounts:{structure:0,material:0,fixtures:0},root:new THREE.Group(),renderer:{shadowMap:{}},environment:normalizeEnvironment(environment),updatePlan(){},render(){}});
 Object.assign(preview,extra);
 preview.facade=code=>preview.material(`facade:${code}`,{color:'#ffffff'});
 preview.makeExistingHouse(preview.model,preview.material('dark',{color:'#353b38'}));
 return preview;
}
const meshes=(group,filter=()=>true)=>{const found=[];group.traverse(object=>{if(object.isMesh&&filter(object))found.push(object);});return found;};
const bounds=mesh=>new THREE.Box3().setFromObject(mesh);
const top=list=>Math.max(...list.map(mesh=>bounds(mesh).max.y)),bottom=list=>Math.min(...list.map(mesh=>bounds(mesh).min.y));

test('the own house and the neighbours live in their own groups under the scene root',()=>{
 for(const [houseType,neighbourCount] of [['terraced',2],['semi',1],['detached',0]]){
  const p=houseHarness({width:500,depth:300},{houseType});
  assert.equal(p.houseGroup.parent,p.root,houseType);assert.equal(p.neighbourGroup.parent,p.root,houseType);
  assert.equal(meshes(p.neighbourGroup,mesh=>mesh.name==='neighbour-wall').length,neighbourCount,`${houseType}: neighbour walls`);
  assert.equal(meshes(p.neighbourGroup).length>0,neighbourCount>0,`${houseType}: a detached house has no neighbour meshes at all`);
  assert.ok(meshes(p.houseGroup,mesh=>mesh.name==='house-wall').length>=1);
  // The room behind the doorbraak hangs from its own `existing-room-shell`, outside both groups: it is the woning,
  // and it leaves with the omgeving (makeExistingRoom). Compared by NAME, never as objects — a failed
  // assert.equal between two three.js nodes makes node render a diff of both whole scene graphs, and that is what
  // drove this file to 20 GB and froze the machine when the room moved out of the root.
  const floor=meshes(p.root,mesh=>mesh.material===p.materials.get('surface:existing-floor'))[0];
  assert.ok(floor,'the room floor exists');
  assert.equal(floor.parent?.name,'existing-room-shell',houseType);
  assert.ok(Math.abs(floor.geometry.parameters.width-5)<1e-9);
 }
});

test('pitched tiled roofs rise from the eaves to a ridge over the house and the neighbours; facades stop at the eaves',()=>{
 const config={width:500,depth:300},m=buildGeometry(config),eaves=m.height+3;
 const p=houseHarness(config,{}),tiles=p.materials.get('surface:roof-tiles'),brick=p.materials.get('facade:brick-red');
 assert.ok(tiles&&tiles!==brick,'the roof has its own tile material, never the facade finish');
 const roofs=meshes(p.root,mesh=>mesh.name.endsWith('-roof'));
 assert.equal(roofs.length,6,'two slopes for the house and for each neighbour');
 for(const roof of roofs){assert.equal(roof.material,tiles);const box=bounds(roof);assert.ok(box.min.y>eaves-.01&&box.max.y>eaves+2.5,'from the eaves up to the ridge');}
 const walls=meshes(p.root,mesh=>mesh.name.endsWith('-wall'));
 assert.equal(walls.length,3);for(const wall of walls){assert.equal(wall.material,brick);assert.ok(Math.abs(bounds(wall).max.y-eaves)<1e-6,'a wall ends at the eaves');}
 assert.ok(meshes(p.root,mesh=>mesh.material===brick&&mesh.name==='house-chimney').length===1);
 const lay=houseLayout(p.environment,m),span=new THREE.Box3();for(const roof of roofs)span.union(bounds(roof));
 assert.ok(Math.abs(span.min.x-lay.roofLeft)<1e-6&&Math.abs(span.max.x-lay.roofRight)<1e-6,'one continuous roof across the terrace');
 assert.ok(span.min.z<m.bounds.back-lay.houseDepth&&span.max.z>m.bounds.back+.3,'eaves overhang the facade on both sides');
});

test('gable ends are closed in the facade finish where a house stands free; no roof or gable ever uses the facade material for a roof',()=>{
 const config={width:500,depth:300};
 const semi=houseHarness(config,{houseType:'semi',facadeFinish:'render-grey'}),detached=houseHarness(config,{houseType:'detached',facadeFinish:'brick-yellow'}),terraced=houseHarness(config,{});
 const gables=p=>meshes(p.root,mesh=>mesh.name.endsWith('-gable'));
 assert.equal(gables(terraced).length,4,'own gables sit inside the neighbours, one outer gable per neighbour');
 assert.equal(gables(semi).length,3);assert.equal(gables(detached).length,2);
 for(const gable of gables(detached))assert.equal(gable.material,detached.materials.get('facade:brick-yellow'));
 for(const gable of meshes(semi.neighbourGroup,mesh=>mesh.name==='neighbour-gable'))assert.equal(gable.material,semi.materials.get('surface:existing-neighbour:render-grey'));
 for(const gable of meshes(semi.houseGroup,mesh=>mesh.name==='house-gable'))assert.equal(gable.material,semi.materials.get('surface:existing-house:render-grey'));
 for(const p of [semi,detached,terraced])for(const roof of meshes(p.root,mesh=>mesh.name.endsWith('-roof')))assert.equal(roof.material,p.materials.get('surface:roof-tiles'));
 // A gable reaches from the eaves to the ridge and its UVs continue the wall courses (metric, not per-face).
 const gable=gables(detached)[0],m=buildGeometry(config);
 assert.ok(Math.abs(bottom([gable])-(m.height+3))<1e-6&&top([gable])>m.height+5.5);
 assert.ok(gable.geometry.attributes.uv&&gable.geometry.attributes.uv.count===gable.geometry.attributes.position.count);
});

/**
 * The customer's request as a test: "zorg dat de woning zelf ook alle baksteenpatronen kan krijgen." Every finish
 * the "Woning & tuin" form offers — since 2.9.6 all four scanned bricks plus the two stucwerken — has to dress the
 * WHOLE house: the upper wall, the flanks beside the extension, the closed gables, the chimney and the neighbours.
 * A finish that only reaches three of the five is the half-brick house nobody would report as a bug, they would
 * just quietly not buy it.
 */
test('every finish the house can be given dresses all of it: walls, flanks, gables, chimney and the neighbours',()=>{
 const config={width:500,depth:300};
 assert.equal(FACADE_FINISHES.length,6,'four bricks and two stucwerken');
 for(const item of FACADE_FINISHES){
  const brick=item.id.startsWith('brick'),p=houseHarness(config,{facadeFinish:item.id});
  const house=p.materials.get(brick?`facade:${item.id}`:`surface:existing-house:${item.id}`);
  assert.ok(house,`${item.id}: the house has a wall material of its own`);
  const dressed=meshes(p.root,mesh=>['house-wall','house-rear','house-flank','house-gable','house-chimney'].includes(mesh.name));
  assert.equal(dressed.filter(mesh=>mesh.name==='house-rear').length,1,`${item.id}: street elevation`);
  assert.equal(dressed.filter(mesh=>mesh.name==='house-chimney').length,1,`${item.id}: chimney`);
  assert.equal(dressed.filter(mesh=>mesh.name==='house-gable').length,2,`${item.id}: two closed gables`);
  assert.ok(dressed.length>=5,`${item.id}: ${dressed.length} dressed parts`);
  for(const mesh of dressed)assert.equal(mesh.material,house,`${item.id}: ${mesh.name} wears the chosen finish`);
  // Brick neighbours share the owner's material outright; stucwerk neighbours are the same colour one shade darker.
  const neighbour=brick?house:p.materials.get(`surface:existing-neighbour:${item.id}`);
  const neighbourParts=meshes(p.neighbourGroup,mesh=>['neighbour-wall','neighbour-gable'].includes(mesh.name));
  assert.equal(neighbourParts.length,4,`${item.id}: a wall and a gable per neighbour on a rijwoning`);
  for(const mesh of neighbourParts)assert.equal(mesh.material,neighbour,`${item.id}: ${mesh.name}`);
  for(const roof of meshes(p.root,mesh=>mesh.name.endsWith('-roof')))assert.notEqual(roof.material,house,`${item.id}: a roof is never the facade`);
  if(brick)continue;
  // Stucwerk carries no colour scan, so the tint IS the chip colour: the picker cannot lie about these two at all.
  assert.equal('#'+house.color.getHexString(),finishColor(item.id),`${item.id}: the wall tint is the chip colour`);
  assert.equal('#'+neighbour.color.getHexString(),shadeHex(finishColor(item.id),8),`${item.id}: the neighbour is one shade darker`);
 }
});

test('wings beyond the extension wear the facade finish from below grade to the eaves and get windows on both floors',()=>{
 const config={width:500,depth:300},m=buildGeometry(config);
 const p=houseHarness(config,{houseType:'detached',facadeWidth:900,alignment:'center',facadeFinish:'render-white'}),house=p.materials.get('surface:existing-house:render-white');
 const walls=meshes(p.houseGroup,mesh=>mesh.name==='house-wall');
 assert.equal(walls.length,3,'upper part above the extension plus two wings');
 for(const wall of walls)assert.equal(wall.material,house);
 const wings=walls.filter(wall=>bounds(wall).min.y<0);assert.equal(wings.length,2);
 // Panes on BOTH elevations carry this material since 2.9.6, so the garden side is counted by its own z plane.
 const panes=meshes(p.houseGroup,mesh=>mesh.material===p.materials.get('existing-window')).filter(pane=>pane.position.z>m.bounds.back-1);
 const ground=panes.filter(pane=>pane.position.y<m.height),first=panes.filter(pane=>pane.position.y>m.height);
 assert.equal(ground.length,2,'one ground-floor window per wing');assert.equal(first.length,4,'two first-floor windows above the extension, one per wing');
 for(const pane of first)assert.ok(pane.position.y>m.height+.9&&pane.position.y<m.height+2.3);
});

/**
 * The customer's 2.9.6 report: "de buitengevel is hier niet toegepast". The house's ground floor had no street
 * elevation at all over the extension's width — what stood there was `makeExistingRoom`'s painted lining, the inside
 * of the room seen from outside, 20-31% of the frame at 180 degrees (.data/back_probe.mjs).
 */
test('the house has a street elevation in the chosen finish, flush with the wall above it, on the same courses',()=>{
 const config={width:500,depth:300},m=buildGeometry(config);
 for(const item of FACADE_FINISHES)for(const houseType of ['terraced','semi','detached']){
  const p=houseHarness(config,{houseType,facadeFinish:item.id}),lay=houseLayout(p.environment,m);
  const brick=item.id.startsWith('brick'),house=p.materials.get(brick?`facade:${item.id}`:`surface:existing-house:${item.id}`);
  const rear=meshes(p.houseGroup,mesh=>mesh.name==='house-rear');
  assert.equal(rear.length,1,`${item.id}/${houseType}: one street elevation`);
  assert.equal(rear[0].material,house,`${item.id}/${houseType}: it wears the chosen finish`);
  // 0,1 mm: geometry positions are float32, so "the same plane" cannot be tested to the last double bit.
  const box=bounds(rear[0]),wall=bounds(meshes(p.houseGroup,mesh=>mesh.name==='house-wall')[0]);
  assert.ok(Math.abs(box.min.z-wall.min.z)<1e-4,'flush with the wall above it, not proud of it and not behind it');
  assert.ok(Math.abs(box.min.z-(m.bounds.back-lay.houseDepth))<1e-4,'on the street plane of the house block');
  assert.ok(box.min.y<-.205,'starts below the ground slab, so there is no sliver of daylight at grade');
  assert.ok(Math.abs(box.max.y-wall.min.y)<1e-4,'abuts the underside of the upper wall: no overlap to flicker');
  assert.ok(Math.abs(box.min.x-m.bounds.left)<1e-4&&Math.abs(box.max.x-m.bounds.right)<1e-4,'exactly the width the room stands in, abutting what is beside it');
 }
 // Nothing of the room reaches the street plane any more: it is masonry out there now, in every house type.
 for(const houseType of ['terraced','semi','detached']){
  const p=houseHarness(config,{houseType}),lay=houseLayout(p.environment,m),street=m.bounds.back-lay.houseDepth;
  const lining=[p.materials.get('surface:painted'),p.materials.get('surface:existing-floor')].filter(Boolean);
  for(const mesh of meshes(p.root,mesh=>lining.includes(mesh.material)))
   assert.ok(bounds(mesh).min.z>street+1e-6,`${houseType}: ${mesh.name||'a room part'} stops short of the street plane`);
 }
});

/**
 * UV continuity across the joint, the same proof `scripts/check-floor-junction.mjs` gives the floor: metricUVs maps
 * a wall face to uv = (worldX/periodX, worldY/periodY), so on EVERY vertex of the street elevation and of the wall
 * above it, u*periodX must be the vertex's own world x and v*periodY its world y — against one period and one origin
 * at world (0,0). A brick that restarted its bond at the joint would show up here as a residual in millimetres.
 */
test('the street elevation and the wall above it share one metric UV origin: the courses cross the joint',()=>{
 const config={width:500,depth:300};
 for(const finish of ['brick-red','brick-yellow','render-white']){
  const p=houseHarness(config,{facadeFinish:finish}),{periodX,periodY}=Preview.prototype.facadePeriods.call(p,finish);
  const period=finish.startsWith('brick')?[periodX,periodY]:[2.4,2.4];
  let worst=0,checked=0;
  for(const mesh of meshes(p.houseGroup,mesh=>['house-rear','house-wall','house-flank'].includes(mesh.name))){
   const points=mesh.geometry.attributes.position,normals=mesh.geometry.attributes.normal,uv=mesh.geometry.attributes.uv;
   for(let i=0;i<points.count;i++){
    if(Math.abs(normals.getZ(i))<.5)continue;                      // the street and garden faces only
    const x=points.getX(i)+mesh.position.x,y=points.getY(i)+mesh.position.y;
    worst=Math.max(worst,Math.abs(uv.getX(i)*period[0]-x),Math.abs(uv.getY(i)*period[1]-y));checked++;
   }
  }
  assert.ok(checked>=24,`${finish}: ${checked} vertices checked`);
  // Budget 0,005 mm: uv is stored as float32, so a perfect metric mapping still carries ~1e-7 of relative rounding.
  // A bond that restarted at the joint would land at half a brick, 44 mm — seven orders of magnitude away from this.
  assert.ok(worst*1000<.005,`${finish}: worst UV residual ${(worst*1000).toFixed(6)} mm`);
 }
});

/**
 * The example openings the customer asked for, and the contract that keeps them honest: they are scenery. They can
 * be switched off, a click can never turn one into a form field, and no price or dimension knows they exist.
 */
test('example windows and a door dress the street elevation, tagged illustrative and switchable',()=>{
 // 2.14.1: that elevation is only built when the camera may leave the garden side (Vormgeving → Vrij rondkijken),
 // so these harnesses ask for the scene such a visitor gets; the limited scene is checked in environment.test.mjs.
 const config={width:500,depth:300},m=buildGeometry(config),street=m.bounds.back-5.2,free={cameraLimit:false};
 const p=houseHarness(config,{houseType:'terraced'},free);
 const groups=[];p.root.traverse(object=>{if(object.userData.illustrative)groups.push(object);});
 assert.equal(groups.length,3,'one for the house, one per neighbour');
 assert.equal(groups.filter(group=>group.name==='house-rear-openings').length,1);
 for(const group of groups){
  assert.equal(group.userData.illustrative,'houseOpenings');
  assert.equal(group.userData.noPick,true,'a click passes through: these are not form fields');
  assert.ok(group.children.length>0,`${group.name} is not empty`);
  group.traverse(object=>{
   assert.equal(object.userData.scopeKey,undefined,`${group.name}: nothing in here opens a field`);
   if(object.isMesh)assert.ok(bounds(object).min.z<street+.001,`${group.name}: every part sits on the street elevation`);
  });
 }
 const house=groups.find(group=>group.name==='house-rear-openings');
 assert.equal(house.parent,p.houseGroup,'the house keeps its own openings; the neighbours keep theirs');
 assert.equal(meshes(house,mesh=>mesh.material===p.materials.get('existing-door')).length,1,'one painted leaf');
 assert.equal(meshes(house,mesh=>mesh.material===p.materials.get('existing-window')).length,4,'the bovenlicht, the living-room window and two above');
 assert.ok(meshes(house,mesh=>mesh.material===p.materials.get('existing-joinery')).length>=8,'kozijnen in painted timber, never the aanbouw lining');
 // A narrow extension gets the door and drops the window rather than squeezing both onto 1,50 m of wall.
 const narrow=houseHarness({width:150,depth:300},{houseType:'terraced'},free);
 const narrowHouse=meshes(narrow.houseGroup,mesh=>mesh.parent?.name==='house-rear-openings'||mesh.parent?.parent?.name==='house-rear-openings');
 assert.equal(narrowHouse.filter(mesh=>mesh.material===narrow.materials.get('existing-door')).length,1,'the door still fits');
 assert.equal(narrowHouse.filter(mesh=>mesh.material===narrow.materials.get('existing-window')).length,3,'bovenlicht plus the two upstairs; no living-room window');
 // The switch: off hides every family member and nothing else, on brings them back.
 assert.equal(p.setIllustrativeVisible('houseOpenings',false),3);
 assert.deepEqual(p.illustrativeState(),{houseOpenings:false});
 for(const group of groups)assert.equal(group.visible,false);
 assert.equal(meshes(p.houseGroup,mesh=>mesh.name==='house-rear')[0].visible,true,'the wall itself is not scenery');
 p.setIllustrativeVisible('houseOpenings',true);
 for(const group of groups)assert.equal(group.visible,true);
});

/**
 * The joinery of the existing house used to be the EXTENSION's interior lining material, passed in as `wall`: an
 * inside material worn outside on some fifty meshes, which also meant ticking "schilderwerk" on the aanbouw's inside
 * repainted every window frame on the house and on both neighbours.
 */
test('the existing house wears only outdoor materials: no interior lining anywhere on it',()=>{
 for(const painting of [false,true]){
  const p=houseHarness({width:500,depth:300,interior:true,plaster:true,painting},{houseType:'terraced'});
  const lining=['surface:painted','surface:plaster','surface:gypsum-board'].map(key=>p.materials.get(key)).filter(Boolean);
  for(const group of [p.houseGroup,p.neighbourGroup])
   for(const mesh of meshes(group))
    assert.ok(!lining.includes(mesh.material),`schilderwerk=${painting}: ${mesh.name||'a part'} of the house wears an interior lining`);
  assert.ok(p.materials.get('existing-joinery'),'the house has joinery of its own');
 }
});

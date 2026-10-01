import test from 'node:test';import assert from 'node:assert/strict';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

// The customer's complaint about "Sedumdak" was that it RAISES the roof: the build-up used to be stacked on the
// membrane, so the mat sat 82 mm proud of the daktrim and the whole roof read taller with the option than without it.
// These checks hold the fix in place from the geometry side; scripts/measure-roof-edge.py holds it from the pixels, which
// is a different failure pattern - it also catches a change in the trim profile or the fascia band that the numbers
// below would not see. Same shape of harness as house.test.mjs: a prototype-backed Preview without a renderer.
function roofHarness(config){
 const preview=Object.create(Preview.prototype);
 Object.assign(preview,{config:structuredClone(config),scope:[],placement:null,model:buildGeometry(config),examplesVisible:true,decorVisible:true,roofVisible:true,view:'perspective',mode:'3d',materials:new Map(),textures:new Set(),maps:{},buildCounts:{structure:0,material:0,fixtures:0},root:new THREE.Group(),renderer:{shadowMap:{}},updatePlan(){},render(){}});
 preview.roofGroup=new THREE.Group();preview.root.add(preview.roofGroup);
 const m=preview.model,facade=preview.material('facade:brick-red',{color:'#ffffff'});
 // Same order as buildScene: the roof slabs, then the build-up, then the roof edge.
 for(const part of m.roof)preview.box(preview.roofGroup,part.size,part.center,preview.material('roof-membrane',{color:'#8d918e'})).userData.scopeKey='rooflight';
 if(m.greenRoof)preview.makeGreenRoof(m);
 preview.buildRoofEdge(m,facade);
 return preview;
}
const meshes=(group,filter=()=>true)=>{const found=[];group.traverse(object=>{if(object.isMesh&&filter(object))found.push(object);});return found;};
const build=preview=>meshes(preview.roofGroup,mesh=>mesh.userData.scopeKey==='greenRoof');
const rest=preview=>meshes(preview.roofGroup,mesh=>mesh.userData.scopeKey!=='greenRoof');
const boxOf=list=>{const box=new THREE.Box3();for(const mesh of list)box.expandByObject(mesh);return box;};
const round=value=>Math.round(value*1e6)/1e6;

test('the sedum build-up never rises above the daktrim, for every roof edge in the catalogue',()=>{
 for(const roofEdge of ['anthracite','white','zinc']){
  const green=roofHarness({width:500,depth:300,greenRoof:true,roofEdge});
  // The daktrim itself, not the membrane opstand against the house (2.14.1), which stands higher on purpose.
  const trim=boxOf(meshes(green.roofGroup,mesh=>mesh.userData.scopeKey==='roofEdge'&&!/upstand/.test(mesh.name))).max.y,mat=boxOf(build(green)).max.y;
  assert.ok(build(green).length>0,`${roofEdge}: the build-up is built at all`);
  assert.ok(mat<=trim,`${roofEdge}: the finished sedum surface (${mat}) must not stand above the daktrim (${trim})`);
  // "at or just below": far enough under the cap to be covered, close enough to still be a finished roof surface.
  assert.ok(trim-mat<=.035,`${roofEdge}: the mat sits ${round(trim-mat)} m under the trim, more than the 35 mm budget`);
 }
});

test('the roof silhouette, the fascia band and the daktrim are identical with and without the option',()=>{
 const plain=roofHarness({width:500,depth:300,greenRoof:false,overhang:'none'});
 const green=roofHarness({width:500,depth:300,greenRoof:true,overhang:'none'});
 assert.equal(build(plain).length,0,'no build-up without the option');
 const a=boxOf(rest(plain)),b=boxOf(rest(green));
 for(const key of ['min','max'])for(const axis of ['x','y','z'])
  assert.equal(round(a[key][axis]),round(b[key][axis]),`${key}.${axis} of everything but the build-up`);
 // And the whole roof group, build-up included, stays inside the plain roof's silhouette.
 const whole=boxOf(meshes(green.roofGroup));
 assert.ok(whole.max.y<=a.max.y+1e-9,`the option must not raise the roof (${round(whole.max.y)} vs ${round(a.max.y)})`);
 assert.equal(round(whole.max.y),round(a.max.y),'the highest point of the roof is the daktrim in both cases');
});

test('an overstek changes nothing about where the build-up sits',()=>{
 const flat=roofHarness({width:500,depth:300,greenRoof:true,overhang:'none'});
 const eaves=roofHarness({width:500,depth:300,greenRoof:true,overhang:'wood-white'});
 assert.equal(round(boxOf(build(flat)).max.y),round(boxOf(build(eaves)).max.y),'same finished level');
 for(const preview of [flat,eaves])assert.ok(boxOf(build(preview)).max.y<=boxOf(rest(preview)).max.y);
});

test('the build-up stays clear of the daktrim flashing: at least 80 mm inside the roof slab on every side',()=>{
 const green=roofHarness({width:500,depth:300,greenRoof:true});
 const slab=boxOf(meshes(green.roofGroup,mesh=>mesh.userData.scopeKey==='rooflight'));
 const layers=boxOf(build(green));
 for(const [axis,inset] of [['x',layers.min.x-slab.min.x],['x',slab.max.x-layers.max.x],
  ['z',layers.min.z-slab.min.z],['z',slab.max.z-layers.max.z]])
  assert.ok(inset>=.08,`${axis}: the build-up starts ${round(inset)} m inside the slab, under the 80 mm the flashing needs`);
});

test('every build-up mesh carries scopeKey greenRoof, so scope highlighting and the price line keep working',()=>{
 const green=roofHarness({width:500,depth:300,greenRoof:true,rooflight:'lean-2'});
 const layers=build(green);
 assert.ok(layers.length>=8,`the mat is laid around the rooflight in bands (${layers.length} pieces)`);
 for(const mesh of layers)assert.equal(mesh.userData.scopeKey,'greenRoof');
 // Two materials and no more: the planted mat and the ballast strip. No substrate band, no instanced cushions.
 const used=new Set(layers.map(mesh=>mesh.material));
 assert.equal(used.size,2,'the build-up is the mat plus the ballast, nothing else');
 assert.ok(meshes(green.roofGroup,mesh=>mesh.isInstancedMesh).length===0,'no instanced cushions - they read as blobs');
});

test('a rooflight keeps its hole: no build-up over the opening, and a ballast ring around the kerb',()=>{
 const green=roofHarness({width:500,depth:300,greenRoof:true,rooflight:'lean-2'});
 const opening=green.model.rooflight.opening;
 assert.ok(opening,'the design has a rooflight opening');
 for(const mesh of build(green)){
  const box=new THREE.Box3().setFromObject(mesh);
  const overlaps=box.min.x<opening.right-1e-6&&box.max.x>opening.left+1e-6&&box.min.z<opening.front-1e-6&&box.max.z>opening.back+1e-6;
  assert.ok(!overlaps,`a build-up layer overlaps the rooflight opening: ${JSON.stringify(box.min)} ${JSON.stringify(box.max)}`);
 }
 // The pieces that touch the kerb are ballast, never planting.
 const mat=green.materials.get('surface:sedum-mat');
 for(const mesh of build(green).filter(mesh=>mesh.material===mat)){
  const box=new THREE.Box3().setFromObject(mesh);
  const nearKerb=box.min.x<opening.right+.29&&box.max.x>opening.left-.29&&box.min.z<opening.front+.29&&box.max.z>opening.back-.29;
  assert.ok(!nearKerb,'the planting keeps its distance from the rooflight kerb; the ring around it is ballast');
 }
});

test('the sedum maps are turned off the roof axes so the 0.90 m tile does not read as a grid',()=>{
 const green=roofHarness({width:500,depth:300,greenRoof:true});
 // The harness has no loaded scans, so nothing to rotate; rerun with stand-ins to prove the rotation is applied.
 const fake=()=>({center:{set(x,y){this.x=x;this.y=y;}},rotation:0,needsUpdate:false});
 green.maps={sedumColor:fake(),sedumNormal:fake(),sedumRough:fake(),sedumAo:fake()};
 green.materials.delete('surface:sedum-mat');green.materials.delete('surface:roof-ballast');
 green.makeGreenRoof(green.model);
 for(const key of ['sedumColor','sedumNormal','sedumRough','sedumAo']){
  const texture=green.maps[key];
  assert.ok(texture.rotation>.2&&texture.rotation<.9,`${key}: rotated off the roof axes (${texture.rotation})`);
  assert.equal(texture.center.x,.5);assert.equal(texture.center.y,.5);
  assert.equal(texture.needsUpdate,true,`${key}: the change is pushed to the GPU`);
 }
});

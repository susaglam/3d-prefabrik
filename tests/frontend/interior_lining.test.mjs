import test from 'node:test';import assert from 'node:assert/strict';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {Preview,BOARD_JOINT} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

// Three interior states, and the rule the customer gave for them: the prefab's OWN lining in unpainted gipsplaat is
// the grey of the bare floor slab, and the parts belonging to the existing HOUSE are never painted in that grey.
// docs/verification/2.9/interior-grey.json carries the measured sRGB off real renders; these checks hold the two
// things a render cannot state - which material each surface gets, and that the tint is neutral rather than cream.
function harness(config){
 const preview=Object.create(Preview.prototype);
 Object.assign(preview,{config:structuredClone(config),scope:[],placement:null,model:buildGeometry(config),examplesVisible:true,decorVisible:true,roofVisible:true,view:'interior',mode:'3d',materials:new Map(),textures:new Set(),maps:{},buildCounts:{structure:0,material:0,fixtures:0},root:new THREE.Group(),renderer:{shadowMap:{}},updatePlan(){},render(){}});
 return preview;
}
// THREE.Color keeps its working value in linear light; the tint as written in preview.js is the sRGB one.
const channels=material=>material.color.getHexString(THREE.SRGBColorSpace).match(/../g).map(pair=>parseInt(pair,16));
const spread=rgb=>Math.max(...rgb)-Math.min(...rgb);

test('unpainted gipsplaat is a neutral grey, not a cream: no channel more than 3/255 from another',()=>{
 const rgb=channels(harness({}).lining('gypsum'));
 assert.ok(spread(rgb)<=3,`the gipsplaat tint ${rgb} still carries a colour cast`);
 assert.ok(rgb[0]-rgb[2]<=2,`red over blue is a warm cast: ${rgb}`);
 // Light enough to read as a board wall over the darker floor slab, dark enough not to read as paint.
 assert.ok(rgb[1]>=180&&rgb[1]<=210,`the gipsplaat tint is ${rgb}, outside the board range`);
});

test('the painted and the unpainted stucwerk finishes keep their own warm off-white',()=>{
 const preview=harness({});
 // Pinned on purpose: this is the colour card of the house's room. Greying it would "paint the house" in the
 // prefab's grey, which is the thing the customer asked NOT to happen.
 assert.deepEqual(channels(preview.lining('painted')),[244,242,237]);
 assert.deepEqual(channels(preview.lining('plaster')),[223,220,212]);
 for(const kind of ['painted','plaster'])assert.ok(spread(channels(preview.lining(kind)))>=5,`${kind} is a warm off-white, not a grey`);
});

test('the three linings are three different materials, and gipsplaat is the coolest of them',()=>{
 const preview=harness({});
 const [painted,plaster,gypsum]=['painted','plaster','gypsum'].map(kind=>preview.lining(kind));
 assert.equal(new Set([painted,plaster,gypsum]).size,3);
 for(const warm of [painted,plaster])assert.ok(spread(channels(warm))>spread(channels(gypsum)),'gipsplaat is the neutral one');
 // Calling twice returns the same instance, so the extension and the house share one material per finish.
 assert.equal(preview.lining('painted'),painted);
});

test('the house room is lined and floored with the painted finish, never with the gipsplaat grey',()=>{
 for(const config of [{width:500,depth:300},{width:360,depth:250,plaster:false}]){
  const preview=harness(config);
  const gypsum=preview.lining('gypsum'),painted=preview.lining('painted');
  preview.makeExistingRoom(preview.model,0,5.2);
  const room=[];preview.root.traverse(object=>{if(object.isMesh&&object.userData.existing)room.push(object);});
  assert.ok(room.length>=4,'the room has a floor, a ceiling, a back wall and two flanks');
  for(const mesh of room)assert.notEqual(mesh.material,gypsum,'a house surface was painted in the prefab grey');
  // Two floors since the doorbraak recess (makeDoorbraak) joined the room: the room's own and the recess's, both
  // the screed. Everything else — both linings, the flanks, the soffits — is the shared painted finish.
  const floors=room.filter(mesh=>/floor/.test(mesh.name));
  assert.deepEqual(floors.map(mesh=>mesh.name).sort(),['doorbraak-floor','existing-room-floor']);
  const walls=room.filter(mesh=>mesh.material===painted);
  assert.equal(walls.length,room.length-floors.length,'everything but the floors is the shared painted finish');
 }
});

/** CIELAB of an sRGB triple, for a colour difference a person would recognise (CIE76, D65). */
const lab=([r,g,b])=>{
 const lin=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
 const [R,G,B]=[r,g,b].map(lin);
 const xyz=[(R*.4124+G*.3576+B*.1805)/.95047,(R*.2126+G*.7152+B*.0722),(R*.0193+G*.1192+B*.9505)/1.08883];
 const f=t=>t>216/24389?Math.cbrt(t):(24389/27*t+16)/116;
 const [fx,fy,fz]=xyz.map(f);
 return [116*fy-16,500*(fx-fy),200*(fy-fz)];
};
const deltaE=(a,b)=>Math.hypot(...lab(a).map((v,i)=>v-lab(b)[i]));

test('the filled joints are a faint step darker than the board: seen when you look, not when you pass',()=>{
 // "derz dolgu izi hafif belli olsun yeter". 2,3 is the textbook just-noticeable difference; the old 14 mm seam at
 // #adaeac was 8 — a drawn grid. The band sits between the two, and it stays neutral and never lighter than the
 // board (a light joint is the white-line bug the 2.9 notes recorded).
 const preview=harness({});
 const board=channels(preview.lining('gypsum')),joint=channels(preview.boardJoint());
 const difference=deltaE(joint,board);
 assert.ok(difference>=2.3&&difference<=5,`joint ${joint} against board ${board}: ΔE ${difference.toFixed(2)}`);
 assert.ok(spread(joint)<=3,`the joint tint ${joint} carries a colour cast`);
 assert.ok(Math.max(...joint)<Math.min(...board),`joint ${joint} must stay under board ${board}`);
});

test('the walls carry the joints IN FRONT of the board, the dagkant has its corner beads, and no screw heads',()=>{
 for(const config of [{width:500,depth:300,frontOpening:'sliding-2-black'},{width:620,depth:340,frontOpening:'folding-white'}]){
  const preview=harness({...config,interior:true,plaster:false});
  preview.root=new THREE.Group();
  const m=preview.model;
  preview.buildBoardJoints(m);
  const named=name=>preview.root.children.filter(mesh=>mesh.name===name);
  const walls=named('board-joint-wall'),front=named('board-joint-front'),dagkant=named('board-joint-dagkant');
  assert.ok(walls.length>=4,`${config.width}: joints on both side walls (${walls.length})`);
  assert.ok(front.length>=2,`${config.width}: joints on the front wall (${front.length})`);
  assert.equal(dagkant.length,6,`${config.width}: corner beads left, right and above the opening, on both faces`);
  // THE bug: the wall joints used to sit inside the 8 mm lining. Every band must be room-side of its board face.
  const sideFace=m.width/2-m.wall-.008;
  for(const band of walls){
   const box=new THREE.Box3().setFromObject(band);
   assert.ok(Math.max(Math.abs(box.min.x),Math.abs(box.max.x))<=sideFace+1e-9,`${config.width}: a wall joint is buried in the board (${box.min.x.toFixed(4)}..${box.max.x.toFixed(4)} vs face ${sideFace.toFixed(4)})`);
   assert.ok(Math.min(Math.abs(box.min.x),Math.abs(box.max.x))>=sideFace-.002,`${config.width}: and it still lies on the board, not floating in the room`);
  }
  const pierFace=m.bounds.front-m.wall-.015;
  for(const band of front){const box=new THREE.Box3().setFromObject(band);assert.ok(box.max.z<=pierFace+1e-9,`${config.width}: a front joint is buried in the board`);}
  // No screw heads anywhere, and every joint answers to the stucwerk field.
  preview.root.traverse(object=>{assert.ok(!object.isInstancedMesh,'no screw-head instances');});
  for(const band of [...walls,...front,...dagkant])assert.equal(band.userData.scopeKey,'plaster');
 }
});

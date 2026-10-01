import test from 'node:test';
import assert from 'node:assert/strict';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

function cameraHarness(config,aspect=1.5,geometryRules={}){
 const p=Object.create(Preview.prototype),camera=new THREE.PerspectiveCamera(40,aspect,.035,150);
 Object.assign(p,{config:structuredClone(config),model:buildGeometry(config,{geometryRules}),scope:[],placement:null,mode:'3d',view:'perspective',camera,cameraFocus:null,cameraTouched:false,cameraInitialized:true,
  container:{clientWidth:750,clientHeight:500},lastWidth:750,lastHeight:500,
  renderer:{shadowMap:{},domElement:{style:{}},setSize(){}},plan:{style:{}},
  controls:{target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld(true);}},
  render(){},updatePlan(){},buildFixtures(){},buildScene(){},updateFacade(){}});
 return p;
}
const pose=p=>({position:p.camera.position.toArray(),target:p.controls.target.toArray(),view:p.view,fov:p.camera.fov});
const assertVisible=(p,fixtures)=>{
 for(const f of fixtures){
  const point=new THREE.Vector3(...f.position).project(p.camera);
  assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1&&point.z>-1&&point.z<1,`${f.id} remains within the camera frame: ${point.toArray()}`);
 }
};

test('focus respects side-wall mounting and keeps a contextual distance from small fittings',()=>{
 for(const side of ['left','right']){
  // With the standard clearances every pier keeps its services on the front; only an oversized administrative
  // wall-edge clearance still relocates them to a side wall.
  const p=cameraHarness({width:230,depth:300,height:280,frontOpening:'french-black',outsideSocket:side,drainSide:'both'},1.5,{clearanceCm:{wallEdge:20}});
  const fixture=p.model.fixtures.find(f=>f.key==='outsideSocket');
  assert.equal(fixture.surface,side,'an oversized wall-edge clearance relocates the services to a side wall');
  p.focusOption(fixture.id);assertVisible(p,[fixture]);
  const delta=p.camera.position.clone().sub(new THREE.Vector3(...fixture.position));
  assert.ok(delta.dot(new THREE.Vector3(Math.sin(fixture.rotation),0,Math.cos(fixture.rotation)))>1.5,'camera approaches the visible mounting face');
  const detail=p.camera.position.distanceTo(p.controls.target);
  p.focusOption(fixture.id,{automatic:true});
  assert.ok(p.camera.position.distanceTo(p.controls.target)>detail,'automatic selection keeps more context than an explicit detail request');
 }
});

test('small-room radiators and wide groups of ceiling lights stay above the floor and inside the frame',()=>{
 for(const [width,depth]of [[150,100],[750,340],[1200,600]]){
  const p=cameraHarness({width,depth,height:280,interior:true,heating:'both',ceilingPositions:['left','center','right']},1.25);
  for(const key of ['heating','ceilingPositions']){
   p.focusOption(key);assert.ok(p.camera.position.y>.25,`${width} cm ${key}: camera is above the floor`);
   assertVisible(p,p.model.fixtures.filter(f=>f.key===(key==='ceilingPositions'?'ceilingLights':key)));
  }
  p.focusOption('heating-left');
  assert.ok(p.camera.position.z<p.model.bounds.back||(p.camera.position.x>p.model.bounds.left+p.model.wall&&p.camera.position.x<p.model.bounds.right-p.model.wall),'small-room detail does not cross the opposite wall');
 }
});

test('accepted server placement follows the original focused fittings without expanding the view to new selections',()=>{
 const p=cameraHarness({width:750,depth:340,height:280,interior:true,ceilingPositions:['left']});
 p.focusOption('ceilingPositions');const before=pose(p);
 p.update({...p.config,ceilingPositions:['left','right']});
 assert.deepEqual(pose(p),before,'adding a selection does not move a completed focus');
 const layout=structuredClone(p.model.fixtureLayout);layout.ceilingPositions.left[0]+=15;
 p.setPlacement(layout);
 assert.ok(Math.abs(p.controls.target.x-before.target[0]-.15)<1e-9,'accepted position adjusts the same target');
 assert.deepEqual(p.cameraFocus.fixtureIds,['ceiling-left']);
});

test('resize and asynchronous geometry changes preserve a manually orbited camera',()=>{
 const p=cameraHarness({width:500,depth:300,height:280,interior:true,ceilingPositions:['center']});
 p.focusOption('ceilingPositions');
 // OrbitControls start gives camera ownership back to the user.
 p.cameraFocus=null;p.cameraTouched=true;p.camera.position.set(3,2,4);p.controls.target.set(.3,1,.2);p.controls.update();
 const before=pose(p);
 p.container.clientHeight=280;p.resize();
 p.setPlacement(structuredClone(p.model.fixtureLayout));
 p.update({...p.config,width:620});
 assert.deepEqual(pose(p),before);
 assert.equal(p.camera.aspect,750/280,'projection follows the new viewport without resetting its pose');
});

test('focused resize keeps its target and a 2D plan is never reopened by a late placement response',()=>{
 const p=cameraHarness({width:750,depth:340,height:280,interior:true,ceilingPositions:['left','right']});
 p.focusOption('ceilingPositions');const target=p.controls.target.toArray();
 p.container.clientWidth=360;p.container.clientHeight=340;p.resize();
 assert.deepEqual(p.controls.target.toArray(),target);assertVisible(p,p.model.fixtures.filter(f=>f.key==='ceilingLights'));
 p.setMode('2d');const before=pose(p),layout=structuredClone(p.model.fixtureLayout);layout.ceilingPositions.left[0]+=15;
 p.setPlacement(layout);p.container.clientHeight=320;p.resize();
 assert.equal(p.mode,'2d');assert.equal(p.plan.style.display,'block');assert.deepEqual(pose(p),before);
});

test('rooflight and overhang inspection keeps the inspected roof visible',()=>{
 const p=cameraHarness({width:750,depth:340,height:280,rooflight:'gable-8',overhang:'pvc-white'});
 p.roofGroup=new THREE.Group();p.ceilingGroup=new THREE.Group();
 for(const key of ['rooflight','overhang']){
  p.focusOption(key,{automatic:true});
  assert.equal(p.roofGroup.visible,true);assert.equal(p.view,'perspective');
  assert.ok(p.camera.position.y>p.model.height,'an elevated exterior view looks down onto the roof');
  if(key==='rooflight')assertVisible(p,p.model.rooflight.panels.flatMap(panel=>panel.points.map(position=>({id:'rooflight-pane',position}))));
 }
});

test('the interior view stands far enough back to show both corners where the walls meet the house',()=>{
 // "iç mekanda kamera konumunu daha geriye al, duvarların kesişme noktası bu şekilde görülmeli" — both vertical
 // corners at the back of the side walls must be inside the frame, with a margin, at every width the catalogue sells.
 for(const width of [300,420,500,620,750])for(const aspect of [1.25,1.6,2]){
  const p=cameraHarness({width,depth:300,height:280,interior:true},aspect);
  p.environment={houseType:'terraced',facadeWidth:null,alignment:'center',facadeFinish:'brick-red',floorFinish:'laminate',scenario:'none',renderNeighbours:true,showHouseOpenings:true};
  p.view='interior';p.camera.aspect=aspect;p.fitCamera();p.camera.updateMatrixWorld(true);
  const m=p.model,corner=m.width/2-m.wall;
  for(const side of [-1,1]){
   const point=new THREE.Vector3(side*corner,1.3,m.bounds.back).project(p.camera);
   assert.ok(Math.abs(point.x)<.97&&point.z<1,`${width} cm @${aspect}: the ${side<0?'left':'right'} corner is in frame (${point.x.toFixed(3)})`);
  }
  assert.ok(p.camera.position.z<m.bounds.back,'the camera stands in the house, behind the doorbraak');
 }
});

const environment={houseType:'terraced',facadeWidth:null,alignment:'center',facadeFinish:'brick-red',floorFinish:'laminate',scenario:'none',renderNeighbours:true,showHouseOpenings:true,fenceStyle:'modern'};

test('the camera never goes below the ground, whatever moved it',()=>{
 // "3d alanda zeminden aşağı inilemesin": an orbit is already limited by maxPolarAngle, but a pan drags the target
 // below grade and the interior views allow looking up from below, so the clamp sits on the eye and the orbit point.
 for(const view of ['perspective','interior','ceiling']){
  const p=cameraHarness({width:500,depth:300,height:280});p.view=view;
  for(const [eye,target] of [[-3,-2],[-.4,.9],[.1,-1],[.24,.5]]){
   p.camera.position.set(2,eye,4);p.controls.target.set(0,target,0);
   assert.equal(p.clampCamera(),true,`${view}: eye ${eye} / target ${target} is corrected`);
   assert.ok(p.camera.position.y>=.25-1e-12,`${view}: the eye stays above every walkable surface (${p.camera.position.y})`);
   assert.ok(p.controls.target.y>=0,`${view}: the orbit point stays at or above grade`);
   // Corrected, it still looks at what it orbits: the view does not snap to some unrelated direction.
   const ahead=new THREE.Vector3(0,0,-1).applyQuaternion(p.camera.quaternion);
   const wanted=p.controls.target.clone().sub(p.camera.position).normalize();
   assert.ok(ahead.dot(wanted)>.9999,`${view}: the camera still faces its target`);
  }
  // A camera that is already where that view allows it is left exactly where it is. Indoors that is in the room
  // (2.14.1: the side walls hold as well as the back wall), outside it is anywhere in the garden.
  p.environment=environment;
  const [x,y,z]=['interior','ceiling'].includes(view)?[.4,1.6,-1.2]:[3,1.6,5];
  p.camera.position.set(x,y,z);p.controls.target.set(0,1,0);
  assert.equal(p.clampCamera(),false,`${view}: an allowed camera is not moved`);
  assert.deepEqual(p.camera.position.toArray(),[x,y,z]);
 }
});

test('outside, the visitor swings around the aanbouw and stops level with the wall of the house',()=>{
 // 2.14.0, the customer: "prefabriğin etrafında tam tur atabiliyor... ana binanın duvar hizasına kadar yaklaşması
 // yeterli". The swing keeps its distance and its height: the camera slides along the gevel line, it does not dive in.
 for(const width of [300,500,750]){
  const p=cameraHarness({width,depth:300,height:280});p.environment=environment;
  const limit=p.model.bounds.back+.02;
  assert.ok(Math.abs(p.cameraBackLimit()-limit)<1e-12,'the limit is the front wall of the house');
  for(const angle of [100,140,179,-100,-140,-179]){
   const radius=7.4,theta=THREE.MathUtils.degToRad(angle),target=new THREE.Vector3(0,1.34,-.2);
   p.controls.target.copy(target);
   p.camera.position.set(target.x+radius*Math.sin(theta),3.4,target.z+radius*Math.cos(theta));
   const before=p.camera.position.clone();
   assert.equal(p.clampCamera(),true,`${width} @${angle}°: a camera behind the house is brought back`);
   assert.ok(p.camera.position.z>=limit-1e-9,`${width} @${angle}°: it stops at the wall (${p.camera.position.z.toFixed(3)})`);
   assert.ok(Math.abs(p.camera.position.y-before.y)<1e-9,`${width} @${angle}°: the height is kept`);
   const flat=v=>Math.hypot(v.x-target.x,v.z-target.z);
   assert.ok(Math.abs(flat(p.camera.position)-flat(before))<1e-9,`${width} @${angle}°: the distance is kept, the swing only stops`);
   assert.equal(Math.sign(p.camera.position.x),Math.sign(before.x),`${width} @${angle}°: it stops on the side it came from`);
   const ahead=new THREE.Vector3(0,0,-1).applyQuaternion(p.camera.quaternion);
   assert.ok(ahead.dot(p.controls.target.clone().sub(p.camera.position).normalize())>.9999,'and still looks at what it orbits');
  }
  // In the garden itself nothing is touched.
  p.camera.position.set(3.4,3.4,5.1);p.controls.target.set(0,1.34,-.2);
  assert.equal(p.clampCamera(),false);
 }
});

test('inside, wheeling backwards stops at the wall of the room behind the doorbraak',()=>{
 for(const view of ['interior','ceiling']){
  const p=cameraHarness({width:500,depth:300,height:280,interior:true});p.environment=environment;p.view=view;
  const limit=p.cameraBackLimit(),b=p.model.bounds;
  assert.ok(limit<b.back-3,`${view}: the room's own back wall, metres behind the gevel (${limit.toFixed(2)})`);
  const target=new THREE.Vector3(0,1.3,b.front-.5);p.controls.target.copy(target);
  const far=new THREE.Vector3(0,1.5,limit-4);
  p.camera.position.copy(far);
  const wanted=far.clone().sub(target).normalize();
  assert.equal(p.clampCamera(),true,`${view}: backing out through the wall is stopped`);
  assert.ok(Math.abs(p.camera.position.z-limit)<1e-9,`${view}: it stops exactly at the wall`);
  const kept=p.camera.position.clone().sub(target).normalize();
  assert.ok(kept.dot(wanted)>.999999,`${view}: only the distance changed, not the direction`);
  // The view the visitor is given is inside the limit to begin with.
  p.camera.aspect=1.5;p.fitCamera();
  assert.equal(p.clampCamera(),false,`${view}: the framed view needs no correction`);
 }
});

test('inside, the visitor stays between the side walls and under the ceiling as well',()=>{
 // 2.14.1, the customer: "yan duvarlarının da dışına çıkamasın". The eye is drawn back along its own line of sight,
 // so a swing against a wall loses distance and never turns into a view of something else.
 for(const width of [230,500,750]){
  const p=cameraHarness({width,depth:300,height:280,interior:true});p.environment=environment;p.view='interior';
  const m=p.model,b=m.bounds,room=p.cameraRoomBox(),target=new THREE.Vector3(0,1.3,b.front-.5);
  assert.ok(room.left>=b.left+m.wall&&room.right<=b.right-m.wall,`${width}: the box keeps clear of the walls`);
  for(const [x,y,z] of [[b.right+3,1.5,b.back-1],[b.left-3,1.5,b.back-1],[0,4.2,b.back-1],[b.right+2,1.5,b.front+3]]){
   p.controls.target.copy(target);p.camera.position.set(x,y,z);
   const wanted=new THREE.Vector3(x,y,z).sub(target).normalize();
   assert.equal(p.clampCamera(),true,`${width}: a camera outside the room is brought back (${[x,y,z]})`);
   const eye=p.camera.position;
   assert.ok(eye.x>=room.left-1e-9&&eye.x<=room.right+1e-9,`${width}: between the side walls (${eye.x.toFixed(2)})`);
   assert.ok(eye.z>=room.back-1e-9&&eye.z<=room.front+1e-9,`${width}: between the back wall and the pui (${eye.z.toFixed(2)})`);
   assert.ok(eye.y<=room.ceiling+1e-9||eye.y===.25,`${width}: under the ceiling (${eye.y.toFixed(2)})`);
   if(eye.y>.25)assert.ok(eye.clone().sub(target).normalize().dot(wanted)>.999999,`${width}: only the distance changed`);
  }
  // The view the visitor is given needs no correction, and free rondkijken lifts the box.
  p.camera.aspect=1.5;p.fitCamera();
  assert.equal(p.clampCamera(),false,`${width}: the framed binnenweergave is inside the room`);
  p.setCameraLimit(false);
  assert.equal(p.cameraRoomBox(),null,`${width}: free rondkijken has no room box`);
 }
});

test('every standpoint the visitor can pick stays inside the limits, and free rondkijken lifts them',()=>{
 const p=cameraHarness({width:620,depth:340,height:280,interior:true});p.environment=environment;
 for(const view of ['perspective','perspective-left','front','top','cutaway','interior','ceiling']){
  p.view=view;p.fitCamera();
  assert.equal(p.clampCamera(),false,`${view}: the standpoint itself is within the limits`);
 }
 // Vormgeving → Vrij rondkijken: nothing but the ground is clamped any more.
 p.view='perspective';p.controls.target.set(0,1.34,-.2);p.camera.position.set(0,3.4,-9);
 assert.equal(p.clampCamera(),true,'limited: the camera behind the house is brought back');
 assert.equal(p.setCameraLimit(false),true,'the switch reports the change');
 p.camera.position.set(0,3.4,-9);
 assert.equal(p.clampCamera(),false,'free: it may stand behind the house');
 assert.equal(p.cameraBackLimit(),null,'and there is no limit to report');
 assert.equal(p.camera.position.y,3.4,'the ground clamp still applies to the height it was given');
 p.camera.position.set(0,-2,-9);
 assert.equal(p.clampCamera(),true,'free never means below the ground');
 assert.ok(p.camera.position.y>=.25-1e-12);
 assert.equal(p.setCameraLimit(true),true);assert.equal(p.setCameraLimit(true),false,'no change, no work');
});

test('the example furniture leaves the room as soon as the visitor steps inside, unless Vormgeving says otherwise',()=>{
 // 2.14.1, the customer: "iç görünümde iken odanın ortasındaki mobilyalar gözükmesin", default off. From the garden
 // they stay: behind the glass they read as a room in use, not as something being delivered.
 const p=cameraHarness({width:500,depth:300,height:280,interior:true});
 p.sceneryGroup=new THREE.Group();p.shadowsDirty=false;
 assert.equal(p.interiorFurniture,undefined,'a bare instance carries no switch; applyScenery reads it as off');
 for(const [view,shown] of [['perspective',true],['perspective-left',true],['front',true],['top',true],['cutaway',true],['interior',false],['ceiling',false]]){
  p.view=view;p.applyScenery();
  assert.equal(p.sceneryGroup.visible,shown,`${view}: furniture ${shown?'stays':'goes'}`);
 }
 // Switched on, it is back everywhere except under the ceiling camera, which stands on the floor between the fittings.
 assert.equal(p.setInteriorFurniture(true),true);
 for(const [view,shown] of [['interior',true],['ceiling',false],['perspective',true]]){
  p.view=view;p.applyScenery();
  assert.equal(p.sceneryGroup.visible,shown,`${view} with the switch on: furniture ${shown?'stays':'goes'}`);
 }
 assert.equal(p.setInteriorFurniture(true),false,'no change, no work');
 assert.equal(p.setInteriorFurniture(false),true);
 p.view='interior';p.applyScenery();
 assert.equal(p.sceneryGroup.visible,false,'and off again empties the room');
});

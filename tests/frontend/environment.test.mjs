import test from 'node:test';import assert from 'node:assert/strict';
import {ENVIRONMENT_STORAGE_KEY,HOUSE_TYPES,FACADE_FINISHES,FLOOR_FINISHES,ALIGNMENTS,SCENARIOS,NEIGHBOUR_TOGGLE,defaultEnvironment,normalizeEnvironment,sceneEnvironmentKey,facadeWidthCm,houseLayout,loadEnvironment,saveEnvironment} from '../../addons/cs_prefab_configurator/static/src/environment.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

const ids=list=>list.map(item=>item.id);

test('defaults describe the terraced house with red brick, laminate, the living-room scenario and the neighbours hidden',()=>{
 // showHouseOpenings joined in 2.9.6: the example windows and door on the street elevation are the visitor's to
 // switch, exactly like the neighbours, and the same store carries both.
 assert.deepEqual(defaultEnvironment(),{houseType:'terraced',facadeWidth:null,alignment:'center',facadeFinish:'brick-red',floorFinish:'laminate',scenario:'living',renderNeighbours:false,showHouseOpenings:true,fenceStyle:'modern'});
 assert.deepEqual(ids(HOUSE_TYPES),['terraced','semi','detached']);
 // Since 2.9.6 the existing house is offered ALL FOUR scanned bricks, not just red and yellow: the customer asked
 // for it and preview.js could already build any of them (see finishes.test.mjs for the colour side of the same move).
 assert.deepEqual(ids(FACADE_FINISHES),['brick-red','brick-black','brick-white','brick-yellow','render-white','render-grey']);
 assert.deepEqual(ids(FLOOR_FINISHES),['laminate','herringbone','concrete']);assert.deepEqual(ids(ALIGNMENTS),['left','center','right']);assert.deepEqual(ids(SCENARIOS),['none','living','bedroom','youth']);
 for(const list of [HOUSE_TYPES,FACADE_FINISHES,FLOOR_FINISHES,SCENARIOS])for(const item of list)assert.ok(item.label.length>2);
 assert.equal(ENVIRONMENT_STORAGE_KEY,'cs-prefab-environment-v1');
});

test('the neighbour toggle is a live-view setting: "Buren tonen", default OFF since 2.16.0',()=>{
 // The customer asked for the street out of the picture; the visitor can still put it back under Woning en tuin.
 assert.deepEqual(NEIGHBOUR_TOGGLE,{name:'renderNeighbours',label:'Buren tonen',help:'Zet aan om de buurhuizen erbij te tekenen. Uit staat de aanbouw tegen je eigen woning, zonder de straat eromheen.',defaultOn:false});
 assert.ok(Object.isFrozen(NEIGHBOUR_TOGGLE));
 assert.equal(defaultEnvironment()[NEIGHBOUR_TOGGLE.name],NEIGHBOUR_TOGGLE.defaultOn,'the default follows the declared copy');
 assert.doesNotMatch(NEIGHBOUR_TOGGLE.label+NEIGHBOUR_TOGGLE.help,/realistisch|path|berekening/i,'no wording left over from the removed render step');
});

test('normalisation drops unknown keys, replaces invalid values and validates the facade width',()=>{
 const full={houseType:'detached',facadeWidth:640,alignment:'right',facadeFinish:'render-grey',floorFinish:'concrete',scenario:'bedroom',renderNeighbours:false,showHouseOpenings:false,fenceStyle:'hedge'};
 assert.deepEqual(normalizeEnvironment({...full,extra:'x',postcode:'1234 AB'}),full);
 assert.deepEqual(normalizeEnvironment({houseType:'castle',alignment:'middle',facadeFinish:'gold',floorFinish:'marble',scenario:'office',renderNeighbours:'no',showHouseOpenings:'no',fenceStyle:'barbed-wire'}),defaultEnvironment());
 for(const flag of ['renderNeighbours','showHouseOpenings']){
  const fallback=flag==='renderNeighbours'?false:true;   // 2.16.0: the buurhuizen start hidden
  for(const [raw,expected] of [[true,true],[false,false],[undefined,fallback],[null,fallback],['false',fallback],[0,fallback],[1,fallback]])assert.equal(normalizeEnvironment({[flag]:raw})[flag],expected,`${flag} ${raw}`);
 }
 for(const input of [null,undefined,'semi',42,['semi'],()=>{}])assert.deepEqual(normalizeEnvironment(input),defaultEnvironment(),String(input));
 for(const [raw,expected] of [[null,null],[undefined,null],['',null],[400,400],[1500,1500],['450',450],[399,null],[1501,null],[450.5,null],['abc',null],[NaN,null],[Infinity,null],[-500,null]])
  assert.equal(normalizeEnvironment({facadeWidth:raw}).facadeWidth,expected,`facadeWidth ${raw}`);
 assert.notEqual(normalizeEnvironment(full),full,'a fresh object is returned');
});

test('the scene key only changes for the house and garden part',()=>{
 const base=defaultEnvironment();
 assert.equal(sceneEnvironmentKey({...base,floorFinish:'concrete',scenario:'none',renderNeighbours:false}),sceneEnvironmentKey(base),'the neighbour toggle only hides the neighbour group in the live view, never a rebuild');
 for(const change of [{houseType:'semi'},{facadeWidth:800},{alignment:'left'},{facadeFinish:'render-white'},{fenceStyle:'hedge'}])assert.notEqual(sceneEnvironmentKey({...base,...change}),sceneEnvironmentKey(base),JSON.stringify(change));
 assert.equal(sceneEnvironmentKey({...base,facadeWidth:300}),sceneEnvironmentKey(base),'an invalid width normalises to the default');
});

test('storage round-trips through a fake localStorage and never throws without one',()=>{
 const store=new Map(),fake={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value))};
 assert.deepEqual(loadEnvironment(fake),defaultEnvironment(),'empty store');
 const env={houseType:'semi',facadeWidth:720,alignment:'left',facadeFinish:'brick-yellow',floorFinish:'herringbone',scenario:'youth',renderNeighbours:false,showHouseOpenings:false,fenceStyle:'classic'};
 assert.equal(saveEnvironment({...env,junk:1},fake),true);
 assert.deepEqual(JSON.parse(store.get(ENVIRONMENT_STORAGE_KEY)),env,'only known keys are written');
 assert.deepEqual(loadEnvironment(fake),env);
 store.set(ENVIRONMENT_STORAGE_KEY,'{not json');assert.deepEqual(loadEnvironment(fake),defaultEnvironment(),'corrupt json');
 store.set(ENVIRONMENT_STORAGE_KEY,JSON.stringify({houseType:'detached',facadeWidth:'99999'}));assert.deepEqual(loadEnvironment(fake),{...defaultEnvironment(),houseType:'detached'},'partially valid store');
 const broken={getItem(){throw new Error('SecurityError');},setItem(){throw new Error('QuotaExceededError');}};
 assert.deepEqual(loadEnvironment(broken),defaultEnvironment());assert.equal(saveEnvironment(env,broken),false);
 assert.deepEqual(loadEnvironment(null),defaultEnvironment());assert.equal(saveEnvironment(env,null),false);
 assert.equal(typeof globalThis.localStorage,'undefined');assert.deepEqual(loadEnvironment(),defaultEnvironment(),'node has no storage');assert.equal(saveEnvironment(env),false);
});

test('facade width: terraced follows the extension; other types default to +110 cm and never go narrower than the extension',()=>{
 assert.equal(facadeWidthCm({houseType:'terraced',facadeWidth:900},500),500);
 assert.equal(facadeWidthCm({houseType:'semi'},500),610);
 assert.equal(facadeWidthCm({houseType:'detached',facadeWidth:800},500),800);
 assert.equal(facadeWidthCm({houseType:'detached',facadeWidth:400},650),650,'clamped to the extension');
});

test('house layout: neighbours, boundaries and alignment per house type',()=>{
 const m=buildGeometry({width:500,depth:300}),b=m.bounds;
 const terraced=houseLayout(defaultEnvironment(),m);
 assert.deepEqual(terraced.neighbours,[-1,1]);assert.equal(terraced.left,b.left);assert.equal(terraced.right,b.right);
 assert.ok(Math.abs(terraced.boundaryLeft-(b.left-.05))<1e-9&&Math.abs(terraced.boundaryRight-(b.right+.05))<1e-9);
 assert.ok(Math.abs(terraced.roofLeft-(b.left-5.5))<1e-9&&Math.abs(terraced.roofRight-(b.right+5.5))<1e-9);
 const semi=houseLayout({houseType:'semi'},m);
 assert.deepEqual(semi.neighbours,[-1]);assert.ok(Math.abs(semi.width-6.1)<1e-9);assert.ok(Math.abs(semi.left-(b.left-.55))<1e-9,'centred by default');
 assert.ok(Math.abs(semi.boundaryLeft-(semi.left-.05))<1e-9,'party line on the left');assert.ok(Math.abs(semi.boundaryRight-(b.right+1.2))<1e-9,'free side 1,2 m beside the extension');
 assert.ok(Math.abs(semi.roofLeft-(semi.left-5.5))<1e-9&&Math.abs(semi.roofRight-semi.right)<1e-9);
 const wide=houseLayout({houseType:'semi',facadeWidth:900,alignment:'left'},m);
 assert.equal(wide.left,b.left);assert.ok(Math.abs(wide.right-(b.left+9))<1e-9);assert.ok(Math.abs(wide.boundaryRight-(wide.right+.05))<1e-9,'a wide house pushes the boundary out');
 for(const [alignment,left] of [['left',b.left],['center',b.left-.55],['right',b.right-6.1]]){
  const lay=houseLayout({houseType:'detached',alignment},m);
  assert.deepEqual(lay.neighbours,[]);assert.ok(Math.abs(lay.left-left)<1e-9,alignment);assert.ok(Math.abs(lay.right-(left+6.1))<1e-9);
  assert.ok(lay.boundaryLeft<=b.left-1.2&&lay.boundaryLeft<=lay.left-.05);assert.ok(lay.boundaryRight>=b.right+1.2&&lay.boundaryRight>=lay.right+.05);
  assert.equal(lay.roofLeft,lay.left);assert.equal(lay.roofRight,lay.right);
 }
});

/** Same shape as render_state.test.mjs: a prototype-backed Preview without a renderer; brick facades skip the canvas texture. */
function sceneHarness(config,environment,extra={}){
 const preview=Object.create(Preview.prototype);
 Object.assign(preview,{config:structuredClone(config),scope:[],placement:null,model:buildGeometry(config),examplesVisible:true,decorVisible:true,roofVisible:true,view:'perspective',mode:'3d',materials:new Map(),textures:new Set(),maps:{},buildCounts:{structure:0,material:0,fixtures:0},root:new THREE.Group(),renderer:{shadowMap:{}},environment:normalizeEnvironment(environment),updatePlan(){},render(){}});
 Object.assign(preview,extra);
 preview.facade=code=>preview.material(`facade:${code}`,{color:'#ffffff'});
 // Same structure buildScene makes: the house, the buren and the tuin hang from one `surroundings` group.
 preview.surroundingsGroup=new THREE.Group();preview.surroundingsGroup.name='surroundings';preview.root.add(preview.surroundingsGroup);
 preview.surroundingsVisible=true;
 preview.makeExistingHouse(preview.model,preview.material('plaster',{color:'#dfdcd4'}),null,preview.material('dark',{color:'#353b38'}));
 preview.decorGroup=new THREE.Group();preview.decorGroup.name='garden';preview.surroundingsGroup.add(preview.decorGroup);
 const before=preview.root.children.length;preview.makeGarden(preview.model);
 assert.equal(preview.root.children.length,before,'every garden item lives inside decorGroup');
 return preview;
}
const meshesWith=(group,material)=>{const found=[];group.traverse(object=>{if(object.isMesh&&object.material===material)found.push(object);});return found;};

test('house types in the scene: party walls, neighbours, boundary fences and finishes',()=>{
 const config={width:500,depth:300,facade:'wood-vertical'};
 const b=buildGeometry(config).bounds;
 const terraced=sceneHarness(config,{}),semi=sceneHarness(config,{houseType:'semi',facadeFinish:'render-grey'}),detached=sceneHarness(config,{houseType:'detached',alignment:'left',facadeFinish:'brick-yellow'});
 // A neighbour on each shared side, and nothing light drawn on the party line (2.13.0: the 2 cm strip down the facade
 // and the lead flashing over the roof read as white lines across the houses).
 const neighbours=p=>{let n=0;p.root.traverse(o=>{if(o.isMesh&&o.name==='neighbour-wall')n++;});return n;};
 assert.equal(neighbours(terraced),2);assert.equal(neighbours(semi),1);assert.equal(neighbours(detached),0);
 for(const p of [terraced,semi,detached])assert.ok(!p.materials.has('party-wall')&&!p.materials.has('roof-flashing'),'no party-line strip or flashing');
 assert.ok(meshesWith(terraced.root,terraced.materials.get('facade:brick-red')).length>=3,'default red brick house and neighbours');
 assert.ok(meshesWith(semi.root,semi.materials.get('surface:existing-house:render-grey')).length>=2&&meshesWith(semi.root,semi.materials.get('surface:existing-neighbour:render-grey')).length>=1);
 assert.ok(meshesWith(detached.root,detached.materials.get('facade:brick-yellow')).length>=2);assert.equal(detached.materials.has('facade:brick-red'),false);
 const sidePosts=p=>{const found=[];p.decorGroup.traverse(o=>{if(o.isMesh&&o.userData.fencePost&&o.userData.run==='side')found.push(o.getWorldPosition(new THREE.Vector3()));});return found;};
 const postsX=p=>[...new Set(sidePosts(p).map(v=>+v.x.toFixed(2)))].sort((x,y)=>x-y);
 assert.deepEqual(postsX(terraced),[+(b.left-.05).toFixed(2),+(b.right+.05).toFixed(2)]);
 assert.deepEqual(postsX(semi),[+(b.left-.55-.05).toFixed(2),+(b.right+1.2).toFixed(2)]);
 assert.deepEqual(postsX(detached),[+(b.left-1.2).toFixed(2),+(b.right+1.2).toFixed(2)]);
 const backFenceZ=p=>Math.min(...sidePosts(p).map(v=>v.z));
 assert.ok(backFenceZ(terraced)>b.front,'terraced schutting starts at the terrace');assert.ok(backFenceZ(detached)<b.back,'a free boundary fence runs past the house');
 // The existing room always spans the extension width, whatever the facade is.
 for(const p of [terraced,semi,detached]){const floor=meshesWith(p.root,p.materials.get('surface:existing-floor'))[0];assert.ok(Math.abs(floor.geometry.parameters.width-5)<1e-9);}
});

test('the garden set stands on the paving, inside decorGroup, at every width the configurator allows',()=>{
 // The terrace reaches m.width+0.55 wide and exactly 3.20 m past the building line (makeGarden / buildScene; 2,00 m
 // until 2.13.1, when the customer asked for the set to move away from the aanbouw on a longer terras). The
 // set is anchored relative to the RIGHT wall, so a narrow extension slides it toward the middle and a wide one
 // toward the corner — and a chair half on the grass is the kind of thing that only ever shows up in a render
 // somebody happens to take from the garden. Measured here on the procedural stand-in, which is built at the same
 // ring and the same chair footprint as the CC0 set that replaces it.
 for(const width of [230,300,500,620,750])for(const depth of [200,300,340]){
  const p=sceneHarness({width,depth},{});
  const model=p.model,b=model.bounds;
  const set=p.decorGroup.getObjectByName('garden-set');
  assert.ok(set,`${width}x${depth}: the garden set is in decorGroup`);
  set.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(set);
  const paving={x0:-(model.width+.55)/2,x1:(model.width+.55)/2,z1:b.front+3.2};
  assert.ok(box.min.x>=paving.x0,`${width}x${depth}: set stays off the left edge (${box.min.x.toFixed(3)} >= ${paving.x0.toFixed(3)})`);
  assert.ok(box.max.x<=paving.x1,`${width}x${depth}: set stays off the right edge (${box.max.x.toFixed(3)} <= ${paving.x1.toFixed(3)})`);
  assert.ok(box.max.z<=paving.z1,`${width}x${depth}: set stays off the grass (${box.max.z.toFixed(3)} <= ${paving.z1.toFixed(3)})`);
  // "Prefabrik görünümüne engel olmasın": the nearest chair or table edge stands at least 1,5 m out from the facade.
  assert.ok(box.min.z>=b.front+1.5,`${width}x${depth}: set keeps well clear of the facade (${box.min.z.toFixed(3)})`);
  // A table and three chairs, and the whole thing hides with "Tuinaankleding tonen".
  assert.equal(set.children.filter(child=>child.name==='garden-chair').length,3,`${width}x${depth}: three chairs`);
  assert.equal(set.children.filter(child=>child.name==='garden-table').length,1,`${width}x${depth}: one table`);
  p.setDecorVisible(false);assert.equal(set.parent.visible,false,'hidden with the decor toggle');
 }
});

test('the garden set stays in the opening view and steps aside where it would stand in front of the aanbouw',()=>{
 // 2.13.1. Seen from the opening camera (garden right, looking down), the set on the longer terras falls on the paving
 // in front of the building and stays; seen square on at eye height it covers the pui and is hidden, like a fence
 // panel (updateFenceOcclusion). The eyes are the frameCamera directions at the distances the browser measures.
 for(const width of [300,500,620]){
  const p=sceneHarness({width,depth:300},{});
  const target=new THREE.Vector3(0,p.model.height*.48,-.2);
  const eye=(direction,distance)=>target.clone().addScaledVector(new THREE.Vector3(...direction).normalize(),distance);
  const visibleFrom=position=>{p.camera={position};p.fenceOcclusionKey='';p.updateFenceOcclusion();return p.gardenSet.visible;};
  assert.equal(visibleFrom(eye([1,.55,1.5],7.2)),true,`${width}: in the opening view the set stays`);
  assert.equal(visibleFrom(eye([0,.06,1],6.4)),false,`${width}: square on it would cover the pui, so it steps aside`);
  assert.equal(visibleFrom(eye([1,.55,1.5],7.2)),true,`${width}: and comes back when the camera moves on`);
 }
});

test('the street elevations are only drawn for a visitor who is allowed to walk round the house',()=>{
 // 2.14.1. With the camera held on the garden side (preview.js CAMERA_LIMIT) the doors and windows on the street
 // side can never be in frame, so they are not built: measured on this default scene, some 60 meshes for nothing.
 // Vormgeving -> Vrij rondkijken builds them again, because then the visitor really can stand in front of them.
 const openings=(p,name)=>{const group=p.root.getObjectByName(name);let n=0;group?.traverse(o=>{if(o.isMesh)n++;});return n;};
 for(const houseType of ['terraced','semi','detached']){
  const limited=sceneHarness({width:500,depth:300},{houseType});
  assert.equal(openings(limited,'house-rear-openings'),0,`${houseType}: no street elevation on the house`);
  assert.equal(openings(limited,'neighbour-rear-openings'),0,`${houseType}: none on the neighbours either`);
  const free=sceneHarness({width:500,depth:300},{houseType},{cameraLimit:false});
  assert.ok(openings(free,'house-rear-openings')>=8,`${houseType}: free rondkijken draws the street elevation (${openings(free,'house-rear-openings')})`);
  assert.equal(openings(free,'neighbour-rear-openings')>0,houseType!=='detached',`${houseType}: the neighbours' street elevation follows the neighbours`);
  // Nothing else changes: the same house, the same garden.
  const meshes=p=>{let n=0;p.root.traverse(o=>{if(o.isMesh)n++;});return n;};
  assert.ok(meshes(free)>meshes(limited),`${houseType}: the limited scene is the smaller one (${meshes(limited)} vs ${meshes(free)})`);
  for(const name of ['house-rear','house-wall','existing-room-rear'])
   assert.ok(limited.root.getObjectByName(name),`${houseType}: ${name} stays — it is part of the house, not of the street elevation`);
 }
});

test('setEnvironment rebuilds only when the house or garden part changed and reports it in getSceneInfo',()=>{
 const p=sceneHarness({width:500,depth:300},{});
 const calls=[];p.update=(config,options)=>calls.push([config,options]);
 assert.equal(p.setEnvironment({...p.environment,floorFinish:'concrete',scenario:'none',renderNeighbours:false}),false);assert.equal(calls.length,0);assert.equal(p.environment.renderNeighbours,false,'the toggle is kept without a rebuild');
 assert.equal(p.setEnvironment({...p.environment,houseType:'semi'}),true);assert.deepEqual(calls,[[p.config,{force:true}]]);
 assert.equal(p.setEnvironment({...p.environment,houseType:'semi',junk:1}),false);assert.equal(calls.length,1);
 assert.equal(p.setEnvironment({houseType:'nonsense'}),true,'invalid input falls back to the defaults');assert.equal(p.environment.houseType,'terraced');
 Object.assign(p,{failed:true,renderer:null});
 assert.deepEqual(p.getSceneInfo().environment,{...defaultEnvironment()});
});

test('getSceneInfo().rendering replaces getSceneInfo().realistic and degrades without a renderer',()=>{
 const p=sceneHarness({width:500,depth:300},{});
 Object.assign(p,{failed:true,renderer:null});
 const info=p.getSceneInfo();
 assert.equal('realistic' in info,false,'the path-tracer contract is gone');
 assert.equal(typeof info.rendering,'object');
 for(const key of ['tier','pixelRatio','maxSamples','composer','shadowPasses','exposure','toneMapping','lamps'])assert.ok(key in info.rendering,`rendering.${key}`);
 assert.ok(['full','compact'].includes(info.rendering.tier),'tier comes from renderTier()');
 // No renderer means no composer and no MSAA: every GPU-dependent number is null rather than a guess.
 assert.deepEqual([info.rendering.composer,info.rendering.pixelRatio,info.rendering.maxSamples,info.rendering.exposure],[null,null,null,null]);
 assert.equal(info.rendering.ambientOcclusion,false);
 assert.equal(info.rendering.toneMapping,'none');
 assert.equal(info.rendering.shadowPasses,0);
 assert.deepEqual(info.rendering.lamps,{slots:0,used:0});
});

test('the render pipeline reports its composer, tier and shadow passes from the live objects',()=>{
 const p=sceneHarness({width:500,depth:300},{});
 // A Preview never gets these from the test: they stand in for a 'full'-tier renderer with a built composer.
 Object.assign(p,{quality:'full',shadowPasses:3,renderTimes:[],composer:{renderTarget1:{width:2520,height:1750}},
  renderer:{getPixelRatio:()=>1.75,capabilities:{maxSamples:8},toneMappingExposure:.92,toneMapping:THREE.ACESFilmicToneMapping,shadowMap:{},
   info:{memory:{geometries:0,textures:0},render:{calls:0,triangles:0}}}});
 const rendering=p.getSceneInfo().rendering;
 assert.deepEqual(rendering.composer,{width:2520,height:1750},'the composer reports its own render target, in drawing-buffer pixels');
 assert.deepEqual([rendering.tier,rendering.pixelRatio,rendering.maxSamples,rendering.ambientOcclusion],['full',1.75,8,true]);
 assert.deepEqual([rendering.exposure,rendering.toneMapping,rendering.shadowPasses],[.92,'aces',3]);
});

test('"Buren tonen" hides the neighbours in the live view without a rebuild and asks for one shadow pass',()=>{
 const p=sceneHarness({width:500,depth:300},{});
 const calls=[];p.update=(config,options)=>calls.push([config,options]);
 assert.ok(p.neighbourGroup,'the terraced house builds a neighbour group');
 assert.equal(p.neighbourGroup.visible,true,'the default shows them');
 p.shadowsDirty=false;
 assert.equal(p.setEnvironment({...p.environment,[NEIGHBOUR_TOGGLE.name]:false}),false,'no scene key change, so no rebuild');
 assert.equal(calls.length,0);
 assert.equal(p.neighbourGroup.visible,false);
 assert.equal(p.shadowsDirty,true,'the sun no longer sees two houses: the shadow map must be redrawn once');
 p.shadowsDirty=false;
 assert.equal(p.setEnvironment({...p.environment,[NEIGHBOUR_TOGGLE.name]:false}),false);
 assert.equal(p.shadowsDirty,false,'an unchanged toggle costs nothing');
 p.setEnvironment({...p.environment,[NEIGHBOUR_TOGGLE.name]:true});
 assert.equal(p.neighbourGroup.visible,true);
 // Proposal images never show the neighbours by default, whatever the visitor's setting is — but no longer
 // through THIS switch. Since the omgeving became one group (setSurroundingsVisible), the buren are hidden with
 // the house, the lawn and the tuinaankleding by their shared parent, and "Buren tonen" is the visitor's alone.
 p.documentMode=true;p.applyNeighbourVisibility();
 assert.equal(p.neighbourGroup.visible,true,'the visitor asked for buren, so the visitor keeps them');
 p.setSurroundingsVisible(false);
 assert.equal(p.surroundingsGroup.visible,false,'the proposal image hides the whole omgeving in one move');
 assert.equal(p.neighbourGroup.visible,true,'and does it without rewriting the visitor own choice');
});

test('render() spends one shadow pass per changed scene and none on a camera move',()=>{
 const p=sceneHarness({width:500,depth:300},{});
 const drawn=[];
 // Enough of a renderer to run render(): the shadow map is the only part under test.
 Object.assign(p,{renderTimes:[],composer:null,scene:{},camera:{},shadowPasses:0,shadowsDirty:false,
  renderer:{shadowMap:{enabled:true,autoUpdate:false,needsUpdate:false},render(){drawn.push(this.shadowMap.needsUpdate);this.shadowMap.needsUpdate=false;}}});
 delete p.render;
 p.render();p.render();
 assert.deepEqual([p.shadowPasses,drawn.length],[0,2],'two frames of an unchanged scene reuse the shadow map');
 // Every structural, visibility or light change raises the flag; the next frame consumes it exactly once.
 for(const change of [()=>p.setDecorVisible(false),()=>p.setExamplesVisible(false),()=>p.applyNeighbourVisibility()]){
  // The flip has to be a real change: this harness builds the group visible, so aim at the group, not at the flag
  // (since 2.16.0 the flag itself starts off, and flipping it to "on" would ask for nothing).
  p.shadowsDirty=false;p.environment={...p.environment,renderNeighbours:!(p.neighbourGroup?.visible??true)};
  const before=p.shadowPasses;
  change();
  assert.equal(p.shadowsDirty||p.shadowPasses>before,true,`${change} asks for a shadow pass`);
  p.render();p.render();p.render();
  assert.equal(p.shadowPasses-before,1,'one pass, however many frames follow');
  assert.equal(p.shadowsDirty,false);
 }
 assert.equal(drawn.filter(Boolean).length,p.shadowPasses,'the renderer saw needsUpdate exactly as often as it was counted');
});

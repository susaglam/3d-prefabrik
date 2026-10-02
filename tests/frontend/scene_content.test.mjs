import test from 'node:test';import assert from 'node:assert/strict';
import {SCENE_EXTRAS,SCENE_EXTRA_IDS,SCENE_MODES,DEFAULT_SCENE_CONTENT,normalizeSceneContent,extraAvailable,sceneDefaults,sceneState} from '../../addons/cs_prefab_configurator/static/src/scene_content.js';
import {NEIGHBOUR_TOGGLE,HOUSE_OPENINGS_TOGGLE,defaultEnvironment,normalizeEnvironment,loadEnvironment,saveEnvironment} from '../../addons/cs_prefab_configurator/static/src/environment.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

/**
 * The inventory the customer asked for: "aslinda tum ek olarak ekledigimiz seyler icin gecerli" — everything we
 * add ter illustratie, not only the new rear openings. Five families, each with an admin switch.
 */
test('the inventory names all five illustrative families and the visitor control each one governs',()=>{
 assert.deepEqual(SCENE_EXTRA_IDS,['fixtures','garden','neighbours','interior','houseOpenings']);
 assert.ok(Object.isFrozen(SCENE_EXTRAS)&&SCENE_EXTRAS.every(extra=>Object.isFrozen(extra)));
 for(const extra of SCENE_EXTRAS){
  assert.ok(extra.label.length>3,`${extra.id} has a Dutch label`);
  assert.ok(extra.control.length>3,`${extra.id} names its visitor control`);
  assert.doesNotMatch(extra.label,/[A-Za-z]+_[A-Za-z]+/,`${extra.id}: a label, not an identifier`);
 }
 // The two persisted toggles are quoted from their own copy, so the admin help and the visitor label cannot drift.
 assert.equal(SCENE_EXTRAS.find(extra=>extra.id==='neighbours').control,NEIGHBOUR_TOGGLE.label);
 assert.equal(SCENE_EXTRAS.find(extra=>extra.id==='houseOpenings').control,HOUSE_OPENINGS_TOGGLE.label);
 assert.ok(Object.isFrozen(HOUSE_OPENINGS_TOGGLE));
 assert.equal(defaultEnvironment()[HOUSE_OPENINGS_TOGGLE.name],HOUSE_OPENINGS_TOGGLE.defaultOn,'the default follows the declared copy');
 // The label says "op de straatgevel" because that is all it switches: the windows in the garden facade the
 // aanbouw attaches to belong to the house itself and stay, and the help has to say so or the switch overpromises.
 assert.match(HOUSE_OPENINGS_TOGGLE.label,/straatgevel/);
 assert.match(HOUSE_OPENINGS_TOGGLE.help,/tuinkant/);
 assert.deepEqual(SCENE_MODES,['on','off','hidden']);
 assert.deepEqual(DEFAULT_SCENE_CONTENT,{fixtures:'on',garden:'on',neighbours:'on',interior:'on',houseOpenings:'on'});
});

test('an unreachable or outdated policy leaves the scene exactly as it has always been drawn',()=>{
 // Deliberately the opposite direction from the compare flag: that one must never switch itself ON by accident,
 // this one must never switch a live website's scenery OFF by accident.
 for(const input of [null,undefined,{},[],'hidden',42,()=>{},{fixtures:'nope'},{unknown:'hidden'}])
  assert.deepEqual(normalizeSceneContent(input),DEFAULT_SCENE_CONTENT,JSON.stringify(input)??String(input));
 assert.deepEqual(normalizeSceneContent({garden:'hidden',unknown:'off'}),{...DEFAULT_SCENE_CONTENT,garden:'hidden'});
 assert.ok(Object.isFrozen(normalizeSceneContent({})));
 for(const id of SCENE_EXTRA_IDS)assert.equal(extraAvailable(null,id),true,`${id} is offered without a policy`);
});

test('the three states differ for every one of the five: available, default, and the control itself',()=>{
 for(const id of SCENE_EXTRA_IDS){
  assert.equal(extraAvailable({[id]:'on'},id),true,`${id} on`);
  assert.equal(extraAvailable({[id]:'off'},id),true,`${id} off keeps its control`);
  assert.equal(extraAvailable({[id]:'hidden'},id),false,`${id} hidden takes the control away`);
 }
 // 'off' is the middle value that a boolean could not express: the extra exists, the control exists, the picture
 // just starts without it. Proven per extra against the state a first-time visitor is seeded with.
 // 2.16.0: the buurhuizen start hidden (environment.js defaultEnvironment).
 assert.deepEqual(sceneDefaults({}),{fixtures:true,garden:true,renderNeighbours:false,scenario:'living',showHouseOpenings:true});
 assert.deepEqual(sceneDefaults({fixtures:'off',garden:'off',neighbours:'off',interior:'off',houseOpenings:'off'}),
  {fixtures:false,garden:false,renderNeighbours:false,scenario:'none',showHouseOpenings:false});
 assert.deepEqual(sceneDefaults({fixtures:'hidden',garden:'hidden',neighbours:'hidden',interior:'hidden',houseOpenings:'hidden'}),
  sceneDefaults({fixtures:'off',garden:'off',neighbours:'off',interior:'off',houseOpenings:'off'}),
  'hidden and off start the same way; they differ in whether the visitor can change it');
 assert.ok(Object.isFrozen(sceneDefaults({})));
});

test('the visitor wins over "standaard uit" and never over "uitgeschakeld"',()=>{
 const chosen={fixtures:true,garden:true,renderNeighbours:true,scenario:'youth',showHouseOpenings:true};
 // 'off' has already had its say through sceneDefaults; a visitor who then switched it on keeps it on.
 assert.deepEqual(sceneState({fixtures:'off',garden:'off',neighbours:'off',interior:'off',houseOpenings:'off'},chosen),
  {fixtures:true,garden:true,renderNeighbours:true,scenario:'youth',showHouseOpenings:true});
 // 'hidden' overrules the same visitor, every family independently.
 for(const [id,key,gone] of [['fixtures','fixtures',false],['garden','garden',false],['neighbours','renderNeighbours',false],
   ['interior','scenario','none'],['houseOpenings','showHouseOpenings',false]]){
  const state=sceneState({[id]:'hidden'},chosen);
  assert.equal(state[key],gone,`${id} hidden removes it`);
  const others=Object.entries(state).filter(([name])=>name!==key);
  assert.deepEqual(others,Object.entries(chosen).filter(([name])=>name!==key),`${id} hidden moves nothing else`);
 }
 // A caller that has not been seeded yet gets the scene as drawn, not an empty one.
 assert.deepEqual(sceneState({},{}),{fixtures:true,garden:true,renderNeighbours:true,scenario:'none',showHouseOpenings:true});
 assert.ok(Object.isFrozen(sceneState({},{})));
});

/**
 * The question the admin switch has to answer honestly: what happens to a visitor who already chose, and whose
 * choice the administrator has since switched off? Answer: the picture obeys the administrator, the stored choice
 * is left alone, and the day the administrator switches it back on the visitor's own choice is simply there again.
 */
test('a saved design keeps the visitor choice an admin switched off, and gets it back when it returns',()=>{
 const store=new Map(),fake={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value))};
 const chose={...defaultEnvironment(),scenario:'youth',renderNeighbours:false,showHouseOpenings:true};
 assert.equal(saveEnvironment(chose,fake),true);

 const off={interior:'hidden',houseOpenings:'hidden'};
 const loaded=loadEnvironment(fake,sceneDefaults(off));
 assert.equal(loaded.scenario,'youth','the store still says what the visitor picked');
 assert.equal(loaded.showHouseOpenings,true);
 const shown=sceneState(off,loaded);
 assert.equal(shown.scenario,'none','but the picture obeys the administrator');
 assert.equal(shown.showHouseOpenings,false);

 // Saving again under the restrictive policy must not overwrite what the visitor had chosen: only the visitor's
 // own state is stored, and clamping happens on the way to the scene.
 assert.equal(saveEnvironment(loaded,fake),true);
 assert.equal(JSON.parse(store.get('cs-prefab-environment-v1')).scenario,'youth');

 const back=loadEnvironment(fake,sceneDefaults({}));
 assert.equal(sceneState({},back).scenario,'youth','switched back on, the old choice is simply there again');
 assert.equal(sceneState({},back).showHouseOpenings,true);
});

test('"standaard uit" only fills a key the visitor never chose',()=>{
 const base=sceneDefaults({neighbours:'off',interior:'off',houseOpenings:'off'});
 // A store written before these keys existed: the policy decides, because the visitor never said anything.
 const fresh=normalizeEnvironment({houseType:'semi'},base);
 assert.deepEqual([fresh.renderNeighbours,fresh.scenario,fresh.showHouseOpenings],[false,'none',false]);
 // The same store with explicit choices: the visitor decides.
 const chosen=normalizeEnvironment({houseType:'semi',renderNeighbours:true,scenario:'bedroom',showHouseOpenings:true},base);
 assert.deepEqual([chosen.renderNeighbours,chosen.scenario,chosen.showHouseOpenings],[true,'bedroom',true]);
 // A policy that cannot be honoured falls back to the shipped default rather than putting nonsense in the scene.
 assert.equal(normalizeEnvironment({},{...base,scenario:'penthouse'}).scenario,'living');
 assert.deepEqual(normalizeEnvironment({}),defaultEnvironment(),'no policy at all is unchanged behaviour');
});

/** Same prototype-backed harness the house and environment suites use: a Preview without a renderer. */
function harness(environment,extra={}){
 const config={width:500,depth:300};
 const preview=Object.create(Preview.prototype);
 Object.assign(preview,{config:structuredClone(config),scope:[],placement:null,model:buildGeometry(config),examplesVisible:true,decorVisible:true,
  roofVisible:true,view:'perspective',mode:'3d',materials:new Map(),textures:new Set(),maps:{},buildCounts:{structure:0,material:0,fixtures:0},
  root:new THREE.Group(),renderer:{shadowMap:{}},environment:normalizeEnvironment(environment),updatePlan(){},render(){}});
 Object.assign(preview,extra);
 preview.facade=code=>preview.material(`facade:${code}`,{color:'#ffffff'});
 preview.makeExistingHouse(preview.model,preview.material('dark',{color:'#353b38'}));
 return preview;
}

test('"uitgeschakeld" takes the example openings out of the scene graph, on the house and on both neighbours',()=>{
 const policy={houseOpenings:'hidden'};
 const environment={...defaultEnvironment(),showHouseOpenings:true};
 // 2.14.1: the street elevation exists for a visitor with free rondkijken; that is the scene this contract is about.
 const preview=harness(environment,{cameraLimit:false});
 const groups=[];preview.root.traverse(object=>{if(object.userData.illustrative)groups.push(object);});
 assert.equal(groups.length,3,'the house and the two neighbours each carry a group');
 assert.ok(groups.every(group=>group.visible),'built shown');

 // Exactly the call app.js makes, with exactly the value sceneState hands it.
 const state=sceneState(policy,environment);
 assert.equal(state.showHouseOpenings,false);
 assert.equal(preview.setIllustrativeVisible('houseOpenings',state.showHouseOpenings),3);
 assert.deepEqual(preview.illustrativeState(),{houseOpenings:false});
 for(const group of groups)assert.equal(group.visible,false,`${group.name} is gone from the scene`);
 // The wall they sit on is masonry the customer's house really has, not scenery: it stays.
 const rear=[];preview.root.traverse(object=>{if(object.name==='house-rear')rear.push(object);});
 assert.equal(rear.length,1);assert.equal(rear[0].visible,true);
 // Nothing in the family can reach a price, a field or a dimension, switched on or off.
 for(const group of groups)group.traverse(object=>assert.equal(object.userData.scopeKey,undefined,`${group.name}`));

 // And back on, because an administrator changes their mind.
 assert.equal(preview.setIllustrativeVisible('houseOpenings',sceneState({},environment).showHouseOpenings),3);
 for(const group of groups)assert.equal(group.visible,true);
});

test('the visitor toggle and the admin switch reach the scene through the one call, and agree',()=>{
 const environment={...defaultEnvironment(),showHouseOpenings:false};
 // 2.14.1: the street elevation exists for a visitor with free rondkijken; that is the scene this contract is about.
 const preview=harness(environment,{cameraLimit:false});
 // Visitor off, admin silent: hidden.
 preview.setIllustrativeVisible('houseOpenings',sceneState({},environment).showHouseOpenings);
 assert.deepEqual(preview.illustrativeState(),{houseOpenings:false});
 // Visitor on, admin silent: shown.
 preview.setIllustrativeVisible('houseOpenings',sceneState({},{...environment,showHouseOpenings:true}).showHouseOpenings);
 assert.deepEqual(preview.illustrativeState(),{houseOpenings:true});
 // Visitor on, admin 'uitgeschakeld': hidden, and the visitor's own value is untouched in the environment.
 preview.setIllustrativeVisible('houseOpenings',sceneState({houseOpenings:'hidden'},{...environment,showHouseOpenings:true}).showHouseOpenings);
 assert.deepEqual(preview.illustrativeState(),{houseOpenings:false});
 assert.equal(environment.showHouseOpenings,false,'sceneState never writes back');
});

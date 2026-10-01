import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {SCENARIOS,DEFAULT_SCENARIO,ITEMS,MODELS,planScenario,buildInteriorScene,createModelLoader} from '../../addons/cs_prefab_configurator/static/src/interior_scenes.js';

const room=(width,depth,extra={})=>buildGeometry({width,depth,frontOpening:'french-black',interior:true,...extra});
const aabb=p=>({x0:p.position[0]-p.size[0]/2,x1:p.position[0]+p.size[0]/2,z0:p.position[2]-p.size[2]/2,z1:p.position[2]+p.size[2]/2,y0:p.position[1],y1:p.position[1]+p.size[1]});
const e=1e-6;
const overlap3d=(a,b)=>a.x0<b.x1-e&&a.x1>b.x0+e&&a.z0<b.z1-e&&a.z1>b.z0+e&&a.y0<b.y1-e&&a.y1>b.y0+e;
/** The rules every plan must honour, whatever the room. */
function assertRules(model,plan,label){
    const clear={x0:model.bounds.left+model.wall,x1:model.bounds.right-model.wall,z0:model.bounds.back,z1:model.bounds.front-model.wall},floorTop=model.floorTop??.091;
    const strip={x0:model.opening.x-model.opening.width/2,x1:model.opening.x+model.opening.width/2,z0:clear.z1-.9,z1:clear.z1};
    for(const p of plan){
        const b=aabb(p);
        assert.ok(b.x0>=clear.x0-e&&b.x1<=clear.x1+e&&b.z0>=clear.z0-e&&b.z1<=clear.z1+e,`${label}: ${p.item} inside the walls`);
        assert.ok(b.y0>=floorTop-e,`${label}: ${p.item} above the floor`);
        if(model.opening.width>0)assert.ok(!(b.x0<strip.x1-e&&b.x1>strip.x0+e&&b.z0<strip.z1-e&&b.z1>strip.z0+e),`${label}: ${p.item} keeps the walkway to the doors clear`);
        for(const f of model.fixtures.filter(f=>f.kind==='radiator')){
            const left=f.side==='left',zone={x0:left?f.position[0]:f.position[0]-.6,x1:left?f.position[0]+.6:f.position[0],z0:f.position[2]-.45,z1:f.position[2]+.45};
            assert.ok(!(b.x0<zone.x1-e&&b.x1>zone.x0+e&&b.z0<zone.z1-e&&b.z1>zone.z0+e),`${label}: ${p.item} keeps 0.6 m in front of the ${f.side} radiator`);
        }
        assert.deepEqual(Object.keys(p).sort(),['item','label','model','position','procedural','rotationY','size'].sort(),`${label}: placement shape`);
        assert.equal(p.procedural,!ITEMS[p.item].model);
    }
    for(let i=0;i<plan.length;i++)for(let j=i+1;j<plan.length;j++)assert.ok(!overlap3d(aabb(plan[i]),aabb(plan[j])),`${label}: ${plan[i].item} overlaps ${plan[j].item}`);
}

test('scenario catalogue shape and defaults',()=>{
    assert.deepEqual(SCENARIOS.map(s=>s.id),['none','living','bedroom','youth']);
    for(const s of SCENARIOS){assert.equal(typeof s.label,'string');assert.ok(s.label.length>1);}
    assert.equal(DEFAULT_SCENARIO,'living');
    assert.ok(SCENARIOS.some(s=>s.id===DEFAULT_SCENARIO));
    // Every model reference resolves and every model has a measured size in metres (nothing is scaled at runtime).
    for(const [key,item] of Object.entries(ITEMS)){
        assert.equal(item.size.length,3,key);
        if(item.model){assert.ok(MODELS[item.model],`${key} → ${item.model}`);assert.ok(MODELS[item.model].file.endsWith('.gltf'));}
        else assert.equal(typeof item.procedural,'string');
    }
});

test('every MODELS size and offset is the box the shipped glTF actually has',async()=>{
    // Third control on the model catalogue, and the one with the sharpest failure pattern: the numbers in MODELS are
    // what the PLANNER reserves on the floor, and nothing at runtime ever compares them with the mesh. A model
    // republished 5 cm wider, or a hand-typed digit, would place furniture through a wall with every other check
    // still green. So the file on disk is parsed here with the SHIPPED loader — images stripped and the buffer
    // inlined, because Node has no DOM and cannot fetch a relative URL — and measured.
    const {GLTFLoader}=await import('../../addons/cs_prefab_configurator/static/vendor/gltf-loader.module.js');
    globalThis.ProgressEvent??=class ProgressEvent extends Event{constructor(type,init={}){super(type);Object.assign(this,init);}};
    const base=new URL('../../addons/cs_prefab_configurator/static/src/assets/models/',import.meta.url);
    for(const [name,spec] of Object.entries(MODELS)){
        const folder=new URL(spec.file.replace(/[^/]+$/,''),base);
        const json=JSON.parse(readFileSync(new URL(spec.file,base),'utf8'));
        for(const buffer of json.buffers??[])if(buffer.uri&&!buffer.uri.startsWith('data:'))
            buffer.uri='data:application/octet-stream;base64,'+readFileSync(new URL(buffer.uri,folder)).toString('base64');
        delete json.images;delete json.textures;
        for(const material of json.materials??[]){
            for(const key of ['normalTexture','occlusionTexture','emissiveTexture'])delete material[key];
            for(const key of ['baseColorTexture','metallicRoughnessTexture'])delete material.pbrMetallicRoughness?.[key];
        }
        const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(JSON.stringify(json),'',resolve,reject));
        const box=new THREE.Box3().setFromObject(gltf.scene),size=box.getSize(new THREE.Vector3());
        for(const [axis,index] of [['x',0],['y',1],['z',2]])
            assert.ok(Math.abs(size[axis]-spec.size[index])<.002,`${name}: ${axis} is ${size[axis].toFixed(3)} m, MODELS says ${spec.size[index]}`);
        assert.ok(Math.abs((box.min.x+box.max.x)/2-spec.offset[0])<.002,`${name}: x offset`);
        assert.ok(Math.abs((box.min.z+box.max.z)/2-spec.offset[1])<.002,`${name}: z offset`);
        assert.ok(Math.abs(box.min.y)<.01,`${name}: the model stands on y=0 (got ${box.min.y.toFixed(3)})`);
    }
});

test('the MODELS.arm flag matches the glTF that actually ships',()=>{
    // Second control on the furniture AO, with a different failure pattern than the scene code: this reads the shipped
    // glTF's own image list. Binding a *_rough map as aoMap (modern_coffee_table_01) would darken a whole model.
    for(const [name,spec] of Object.entries(MODELS)){
        const gltf=JSON.parse(readFileSync(new URL(`../../addons/cs_prefab_configurator/static/src/assets/models/${spec.file}`,import.meta.url),'utf8'));
        const hasArm=(gltf.images??[]).some(image=>/_arm[_.]/i.test(image.uri??''));
        assert.equal(!!spec.arm,hasArm,`${name}: MODELS.arm must follow the shipped textures`);
    }
});

test('none and unknown scenarios plan nothing',()=>{
    const model=room(500,300);
    assert.deepEqual(planScenario(model,'none'),[]);
    assert.deepEqual(planScenario(model,'garage'),[]);
    assert.deepEqual(planScenario(null,'living'),[]);
});

test('living room: sofa faces the garden with the coffee table in front, everything obeys the rules',()=>{
    const model=room(500,300,{heating:'left',sockets:'right',rooflight:'lean-2'});
    const plan=planScenario(model,'living');
    assertRules(model,plan,'living 500x300');
    const sofa=plan.find(p=>p.item==='sofa'),coffee=plan.find(p=>p.item==='coffeeTable'),rug=plan.find(p=>p.item==='rug');
    assert.ok(sofa&&coffee&&rug,'sofa, coffee table and rug are placed');
    assert.equal(sofa.rotationY,0,'sofa faces +z (the garden)');
    assert.ok(coffee.position[2]>sofa.position[2]+.6,'coffee table is between the sofa and the doors');
    assert.ok(Math.abs(sofa.position[0])<.6,'sofa roughly centred');
    assert.ok(Math.abs(sofa.position[1]-(.091+.012))<1e-9&&Math.abs(coffee.position[1]-rug.position[1]-.012)<1e-9,'sofa and coffee table stand on the rug');
    assert.ok(plan.some(p=>p.item==='plant')&&plan.some(p=>p.item==='sideTable'),'plant and side table present');
    assert.ok(plan.some(p=>p.item==='diningTable'),'a 3.0 m deep room gets the dining table');
    assert.ok(plan.every(p=>p.size.every(v=>v>0)));
    const plant=plan.find(p=>p.item==='plant'),side=plan.find(p=>p.item==='sideTable');
    assert.ok(Math.abs(plant.position[1]-(side.position[1]+side.size[1]))<1e-9,'the plant rests on the side table top');
});

test('planScenario is pure and deterministic',()=>{
    const model=room(500,300,{heating:'both'});const before=JSON.stringify(model);
    assert.deepEqual(planScenario(model,'bedroom'),planScenario(model,'bedroom'));
    assert.equal(JSON.stringify(model),before);
});

test('radiators keep 0.6 m clear and interior sockets / wall lights are never covered',()=>{
    for(const heating of ['left','right','both']){
        const model=room(500,300,{heating,sockets:'both',socketPositions:['L1','L2','L3','R1','R2','R3'],wallLights:['L2','R2']});
        for(const s of ['living','bedroom','youth']){
            const plan=planScenario(model,s);
            assertRules(model,plan,`${s} heating=${heating}`);
            for(const f of model.fixtures.filter(f=>['socket','wall-light'].includes(f.kind)&&f.room==='interior'))for(const p of plan){
                const b=aabb(p),tall=p.size[1]>(f.kind==='socket'?.2:1.6);
                const covers=b.z0<f.position[2]+e&&b.z1>f.position[2]-e&&(f.side==='left'||f.rotation>0?b.x0<f.position[0]+.05:b.x1>f.position[0]-.05);
                assert.ok(!(tall&&covers),`${s} heating=${heating}: ${p.item} covers ${f.id}`);
            }
        }
    }
});

test('degrades gracefully: tiny 2.3x2.0 and huge 7.5x3.4 rooms, every opening type',()=>{
    const openings=['none','french-white','sliding-2-black','sliding-4-black','folding-black'];
    for(const [w,d] of [[230,200],[750,340],[150,100],[400,250],[300,340],[620,300]])for(const frontOpening of openings)for(const rooflight of ['none','lean-3','gable-4']){
        const model=room(w,d,{frontOpening,rooflight,heating:'right',sockets:'left'});
        for(const s of ['living','bedroom','youth']){
            const plan=planScenario(model,s);
            assertRules(model,plan,`${s} ${w}x${d} ${frontOpening} ${rooflight}`);
            if(w===750&&d===340)assert.ok(plan.length>=4,`${s} 750x340 gets a full set (${plan.length})`);
            if(w===230)assert.ok(plan.length<=3&&!plan.some(p=>['sofa','bed','wardrobe','diningTable'].includes(p.item)),`${s} 230x200 gets a reduced set`);
        }
    }
    const tiny=room(230,200),huge=room(750,340,{heating:'both'});
    assert.ok(planScenario(tiny,'living').some(p=>p.item==='armchair'),'a tiny living room still gets a seat');
    assert.ok(planScenario(huge,'bedroom').some(p=>p.item==='bed')&&planScenario(huge,'bedroom').some(p=>p.item==='wardrobe'));
    assert.ok(planScenario(huge,'youth').some(p=>p.item==='desk')&&planScenario(huge,'youth').some(p=>p.item==='deskChair'));
});

test('bedroom and youth: headboards against a wall, desk under the rooflight when present',()=>{
    const model=room(500,300,{rooflight:'gable-4'});
    const bedroom=planScenario(model,'bedroom'),bed=bedroom.find(p=>['bed','singleBed'].includes(p.item));
    assert.ok(bed,'a bed is placed');
    const b=aabb(bed),clear={x0:model.bounds.left+model.wall,x1:model.bounds.right-model.wall,z0:model.bounds.back};
    assert.ok(Math.abs(b.z0-clear.z0)<.03||Math.abs(b.x0-clear.x0)<.03||Math.abs(b.x1-clear.x1)<.03,'headboard touches the house wall or a side wall');
    assert.ok(bedroom.filter(p=>p.item==='bedside').length>=1,'at least one bedside table');
    const youth=planScenario(model,'youth'),desk=youth.find(p=>p.item==='desk');
    assert.ok(desk,'youth room has a desk');
    assert.ok(Math.abs(desk.position[0]-model.rooflight.x)<1e-9&&Math.abs(desk.position[2]-model.rooflight.z)<.25,'desk sits under the rooflight');
    assert.ok(youth.some(p=>p.item==='singleBed')&&youth.some(p=>p.item==='bookcase'));
});

const stubLoader=(fail=[])=>({calls:[],async load(name){this.calls.push(name);if(fail.includes(name))throw new Error('offline');const item=ITEMS[name],m=MODELS[item.model];
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(...m.size),new THREE.MeshStandardMaterial());mesh.position.set(m.offset[0],m.size[1]/2,m.offset[1]);const g=new THREE.Group();g.add(mesh);return g;}});

test('buildInteriorScene: group inside the room and above the floor, shadows on, progress reported',async()=>{
    const model=room(500,300,{heating:'left'}),loader=stubLoader(),progress=[];
    const group=await buildInteriorScene(model,'living',loader,{onProgress:p=>progress.push(p)});
    assert.equal(group.name,'interior-scene');
    assert.deepEqual({scenario:group.userData.scenario,indicative:group.userData.indicative,scopeKey:group.userData.scopeKey,fallbacks:group.userData.fallbacks},{scenario:'living',indicative:true,scopeKey:null,fallbacks:[]});
    const plan=planScenario(model,'living');
    assert.equal(group.children.length,plan.length);
    assert.equal(progress.length,plan.length);assert.deepEqual(progress.at(-1),{loaded:plan.length,total:plan.length,item:plan.at(-1).item});
    group.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(group);
    assert.ok(box.min.x>=model.bounds.left+model.wall-1e-6&&box.max.x<=model.bounds.right-model.wall+1e-6,'x inside the walls');
    assert.ok(box.min.z>=model.bounds.back-1e-6&&box.max.z<=model.bounds.front-model.wall+1e-6,'z inside the walls');
    assert.ok(box.min.y>=.091-1e-6&&box.max.y<model.height,'above the floor, below the ceiling');
    let meshes=0;group.traverse(o=>{if(o.isMesh){meshes++;assert.ok(o.castShadow&&o.receiveShadow,'shadows');}});
    assert.ok(meshes>=plan.length);
    // Each glTF child's footprint matches its plan entry (the model offset is compensated, the rotation applied).
    for(const child of group.children){
        const p=plan.find(p=>`interior-${p.item}`===child.name&&Math.abs(child.position.z-p.position[2])<.5);
        assert.ok(p,child.name);
        const cb=new THREE.Box3().setFromObject(child),a=aabb(p);
        assert.ok(Math.abs(cb.min.x-a.x0)<.01&&Math.abs(cb.max.x-a.x1)<.01&&Math.abs(cb.min.z-a.z0)<.01&&Math.abs(cb.max.z-a.z1)<.01,`${child.name} footprint matches the plan`);
        assert.ok(Math.abs(cb.min.y-a.y0)<.01,`${child.name} rests at its planned height`);
    }
    assert.ok(loader.calls.includes('plant')&&!loader.calls.includes('rug')&&!loader.calls.includes('sofa'),'procedural items (the rug, and since 2.10.1 the whole living set) never hit the loader');
});

test('buildInteriorScene: none is empty, a failed download falls back to a procedural stand-in, no loader works too',async()=>{
    const model=room(500,300);
    const empty=await buildInteriorScene(model,'none',stubLoader());
    assert.equal(empty.children.length,0);assert.equal(empty.userData.scenario,'none');
    // Since 2.10.1 the living set is procedural and nothing of it is downloaded; the plant still is, so it carries
    // the failed-download case, and the sofa is procedural by design rather than as a fallback.
    const group=await buildInteriorScene(model,'living',stubLoader(['plant']));
    assert.deepEqual(group.userData.fallbacks.map(f=>f.item),['plant']);
    const sofa=group.children.find(c=>c.name==='interior-sofa');
    assert.equal(sofa.userData.procedural,true);
    const sb=new THREE.Box3().setFromObject(sofa),size=sb.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x-1.807)<1e-6&&Math.abs(size.z-.818)<1e-6,'fallback keeps the real footprint');
    const noLoader=await buildInteriorScene(model,'bedroom',null);
    assert.ok(noLoader.children.length>0&&noLoader.children.every(c=>c.userData.procedural));
    // Since 2.10.3 the bedroom and youth pieces are procedural too: the plant is the only download left in any room.
    for(const scenario of ['bedroom','youth']){
        const loader=stubLoader(),built=await buildInteriorScene(room(500,300,{rooflight:'gable-4'}),scenario,loader);
        assert.ok(loader.calls.every(name=>name==='plant'),`${scenario} downloads only the plant (${loader.calls})`);
        for(const item of ['bedside','desk','deskChair','bookcase'])for(const child of built.children.filter(c=>c.name===`interior-${item}`))
            assert.equal(child.userData.procedural,true,`${scenario}: ${item} is built, not downloaded`);
    }
});

test('every built item fills exactly its declared box, in every scenario and room size',async()=>{
    // The living-room check above measures one plan; this measures every item in every scenario, which is where the
    // PROCEDURAL builders live (bed, wardrobe, rug). planScenario reserves ITEMS[key].size on the floor and plans
    // everything else around that rectangle, so a builder that overruns it — a handle past the carcass, a pillow
    // past the headboard, a rug band under the floor — puts furniture through a wall with nothing in the planner
    // noticing. buildInteriorScene adds one child per placement, in order, so index i is plan[i].
    for(const scenario of ['living','bedroom','youth'])for(const [w,d] of [[500,300],[750,340],[230,300],[300,340]]){
        const model=room(w,d,{rooflight:'gable-4',heating:'left',sockets:'right'});
        const plan=planScenario(model,scenario),group=await buildInteriorScene(model,scenario,stubLoader());
        assert.equal(group.children.length,plan.length,`${scenario} ${w}x${d}: one object per placement`);
        group.updateMatrixWorld(true);
        for(let i=0;i<plan.length;i++){
            const p=plan[i],child=group.children[i],a=aabb(p),cb=new THREE.Box3().setFromObject(child);
            assert.equal(child.name,`interior-${p.item}`,`${scenario} ${w}x${d}: child ${i}`);
            for(const [got,want,axis] of [[cb.min.x,a.x0,'min x'],[cb.max.x,a.x1,'max x'],[cb.min.z,a.z0,'min z'],[cb.max.z,a.z1,'max z'],[cb.min.y,a.y0,'min y'],[cb.max.y,a.y1,'max y']])
                assert.ok(Math.abs(got-want)<.012,`${scenario} ${w}x${d}: ${p.item} ${axis} is ${got.toFixed(3)}, the plan reserves ${want.toFixed(3)}`);
        }
    }
});

test('the desk chair always stands on the desk front, whichever way the desk is turned',()=>{
    // The desk is the one asymmetric model in the catalogue: its knee hole opens to one side only. The old fixed
    // "chair on the -z side" was correct only for a desk at rotation 0 and put the chair behind the desk as soon as
    // it turned against a side wall — invisible while the desk was a symmetric procedural box.
    let seen=0;
    for(const [w,d] of [[500,300],[750,340],[620,300],[400,250]])for(const rooflight of ['none','gable-4'])for(const heating of ['left','right']){
        const model=room(w,d,{rooflight,heating,sockets:'both'}),plan=planScenario(model,'youth');
        const desk=plan.find(p=>p.item==='desk'),chair=plan.find(p=>p.item==='deskChair');
        if(!desk||!chair)continue;
        seen++;
        // The desk's front after rotation, and the chair's front after its own rotation.
        const front=[Math.sin(desk.rotationY),Math.cos(desk.rotationY)].map(v=>Math.round(v));
        const away=[chair.position[0]-desk.position[0],chair.position[2]-desk.position[2]];
        assert.ok(front[0]*away[0]+front[1]*away[1]>0,`${w}x${d} ${rooflight}: the chair is on the desk's front side`);
        const facing=[Math.sin(chair.rotationY),Math.cos(chair.rotationY)].map(v=>Math.round(v));
        assert.ok(facing[0]===-front[0]&&facing[1]===-front[1],`${w}x${d} ${rooflight}: the chair faces the desk`);
    }
    assert.ok(seen>=8,`the sweep actually placed a desk and a chair (${seen} times)`);
});

test('createModelLoader exposes load/dispose and rejects unknown names without touching the network',async()=>{
    const loader=createModelLoader({baseUrl:'http://127.0.0.1:1/assets/models'});
    assert.equal(typeof loader.load,'function');assert.equal(typeof loader.dispose,'function');
    await assert.rejects(loader.load('spaceship'),/Onbekend model/);
    loader.dispose();
});

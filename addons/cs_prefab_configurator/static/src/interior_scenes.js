/** Indicative room furnishing scenarios (plan 2.7 row B/3): CC0 glTF furniture from Poly Haven plus procedural stand-ins.
 *  Everything is real-size (metres); nothing is scaled. planScenario() is pure; buildInteriorScene() makes the THREE group. */
import * as THREE from '../vendor/three.module.js';
import { softPad } from './architectural_details.js';

export const SCENARIOS=[{id:'none',label:'Leeg'},{id:'living',label:'Woonkamer'},{id:'bedroom',label:'Slaapkamer'},{id:'youth',label:'Jeugdkamer'}];
export const DEFAULT_SCENARIO='living';
const FLOOR_TOP=.091,STRIP=.9,RADIATOR_CLEAR=.6,MARGIN=.02;

// Bounding boxes measured with .data/scene_models_check.mjs (three GLTFLoader, 2026-09-15). size=[x,y,z] in the model's own
// axes, offset=[x,z] of the box centre in local space (feet at y=0). Every seat has its backrest at -z, so it faces +z.
// `arm`: the glTF's metallicRoughness slot holds an ARM map (ambient occlusion in R, roughness in G, metalness in B),
// so the same texture can be bound as aoMap for free. modern_coffee_table_01 ships a plain *_rough map in that slot
// instead — using it as AO would multiply the whole table by its roughness, so it is the one model that never gets it.
// The flag is asserted against the shipped glTF image URIs in interior_scenes.test.mjs.
export const MODELS={
    sofa_02:{file:'sofa_02/sofa_02_1k.gltf',size:[1.807,.709,.818],offset:[0,-.069],arm:true},
    modern_coffee_table_01:{file:'modern_coffee_table_01/modern_coffee_table_01_1k.gltf',size:[.6,.39,1.202],offset:[0,0],arm:false},
    ArmChair_01:{file:'ArmChair_01/ArmChair_01_1k.gltf',size:[.848,1.065,.766],offset:[0,-.035],arm:true},
    side_table_01:{file:'side_table_01/side_table_01_1k.gltf',size:[.55,.551,.45],offset:[0,0],arm:true},
    potted_plant_04:{file:'potted_plant_04/potted_plant_04_1k.gltf',size:[.168,.267,.185],offset:[0,.009],arm:true},
    wooden_table_02:{file:'wooden_table_02/wooden_table_02_1k.gltf',size:[1.134,.8,.706],offset:[0,0],arm:true},
    dining_chair_02:{file:'dining_chair_02/dining_chair_02_1k.gltf',size:[.434,.973,.576],offset:[0,-.043],arm:true},
    GreenChair_01:{file:'GreenChair_01/GreenChair_01_1k.gltf',size:[.673,1.059,.664],offset:[0,-.046],arm:true},
    SchoolDesk_01:{file:'SchoolDesk_01/SchoolDesk_01_1k.gltf',size:[.712,.883,.546],offset:[0,-.005],arm:true},
    wooden_display_shelves_01:{file:'wooden_display_shelves_01/wooden_display_shelves_01_1k.gltf',size:[.372,1.556,1.078],offset:[0,0],arm:true},
    // Garden set. It has no ITEMS entry: the room planner never places it, preview.js lays it out on the terrace
    // itself (makeGarden / loadGardenSet) and loads it through this same loader, so it lives in the same catalogue
    // and gets the same ARM-as-aoMap wiring. `size` is the whole trimmed scene (one table plus one chair).
    outdoor_table_chair_set_01:{file:'outdoor_table_chair_set_01/outdoor_table_chair_set_01_1k.gltf',size:[.754,.859,1.326],offset:[-.068,-.246],arm:true},
};
/** aoMapIntensity for the furniture: the baked contact shadow under a cushion, which no real-time AO pass can know. */
export const FURNITURE_AO=.9;
// Catalogue: size=[w,h,d] in the item's canonical orientation (w along x, front toward +z). modelRotation turns the glTF into
// that orientation (the coffee table is modelled with its long side along z). Procedural items carry a builder + colours.
export const ITEMS={
    // The living and dining set is procedural since 2.10.1 (BUILDERS below): the customer found the CC0 chesterfield,
    // baroque armchair, rustic table and tufted chairs neither modern nor well chosen. Footprints are the ones the
    // planner already placed, so every scenario keeps its layout; only the heights follow the new pieces.
    sofa:{label:'Bank',procedural:'sofa',size:[1.807,.709,.818],color:'#a1998d'},
    coffeeTable:{label:'Salontafel',procedural:'coffeeTable',size:[1.202,.39,.6]},
    armchair:{label:'Fauteuil',procedural:'armchair',size:[.848,.78,.766],color:'#626c55'},
    sideTable:{label:'Bijzettafel',procedural:'sideTable',size:[.45,.52,.45]},
    // Bedroom and youth pieces are procedural since 2.10.3, for the reason the living set is: next to it the CC0 rustic
    // side table, school desk, green lounge chair and cube shelving read as a different, older house.
    bedside:{label:'Nachtkastje',procedural:'bedside',size:[.5,.5,.4]},
    plant:{label:'Plant',model:'potted_plant_04',size:[.168,.267,.185]},
    diningTable:{label:'Eettafel',procedural:'diningTable',size:[1.134,.75,.706]},
    diningChair:{label:'Eetkamerstoel',procedural:'diningChair',size:[.434,.82,.5],color:'#bdb2a2'},
    deskChair:{label:'Bureaustoel',procedural:'deskChair',size:[.6,.92,.6],color:'#6d8290'},
    // The desk's front is the side its knee hole opens to (+z, the catalogue convention), so the chair always stands
    // on the +z side of the placed footprint.
    desk:{label:'Bureau',procedural:'desk',size:[1,.75,.55]},
    bookcase:{label:'Boekenkast',procedural:'bookcase',size:[1,1.6,.36]},
    rug:{label:'Vloerkleed',procedural:'rug',size:[2,.012,1.8],color:'#b9a58c'},
    rugSmall:{label:'Vloerkleed',procedural:'rug',size:[1.4,.012,.9],color:'#a9b0a0'},
    bed:{label:'Tweepersoonsbed',procedural:'bed',size:[1.6,.95,2.1],color:'#8a7358'},
    singleBed:{label:'Eenpersoonsbed',procedural:'bed',size:[.9,.9,2],color:'#6f6558'},
    wardrobe:{label:'Kledingkast',procedural:'wardrobe',size:[1,2.1,.6],color:'#e4e1d8'},
};

const quarter=r=>Math.round(r/(Math.PI/2))%2!==0;
const footprint=(item,rotationY)=>quarter(rotationY)?[item.size[2],item.size[1],item.size[0]]:[...item.size];
const box=(x,y,z,[w,h,d])=>({x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2,y0:y,y1:y+h});
const overlaps=(a,b,e=1e-6)=>a.x0<b.x1-e&&a.x1>b.x0+e&&a.z0<b.z1-e&&a.z1>b.z0+e;
const within=(a,b,e=1e-6)=>a.x0>=b.x0-e&&a.x1<=b.x1+e&&a.z0>=b.z0-e&&a.z1<=b.z1+e;

/**
 * The x range of the walkway to the garden: the whole opening, except that openslaande deuren are walked through
 * their two doors only — the side lights either side of them (2.17.0) are glass in the frame, and a bed or a
 * cabinet may stand in front of those as in front of any window.
 */
export function walkway(model){
    const o=model.opening,doors=o.kind==='french'?(model.panels??[]).filter(p=>p.role==='door'):[];
    if(!doors.length)return [o.x-o.width/2,o.x+o.width/2];
    return [o.x+Math.min(...doors.map(p=>p.x-p.width/2)),o.x+Math.max(...doors.map(p=>p.x+p.width/2))];
}

/** The clear room, the keep-out zones that come from the configuration, and a placement helper. */
function roomContext(model){
    const {bounds,wall}=model,floorTop=model.floorTop??FLOOR_TOP;
    const clear={x0:bounds.left+wall+MARGIN,x1:bounds.right-wall-MARGIN,z0:bounds.back+MARGIN,z1:bounds.front-wall-MARGIN};
    const zones=[];
    const opening=model.opening??{kind:'none',width:0,x:0};
    // Walkway to the garden doors: nothing (not even a rug) across the opening width within 0.9 m of the glazing.
    // A "geen kozijn" skeleton is an open hole, so it needs the same walkway as a fitted schuifpui.
    if(opening.width>0){const [x0,x1]=walkway(model);zones.push({kind:'glazing',x0,x1,z0:clear.z1-STRIP,z1:clear.z1+1,minHeight:0});}
    for(const f of model.fixtures??[]){
        if(f.room&&f.room!=='interior')continue;
        const [x,,z]=f.position,left=f.side?f.side==='left':f.rotation>0;
        // Radiator panel ≈ 0.9 m wide on the wall; keep 0.6 m in front of it (plus its own 0.1 m depth).
        if(f.kind==='radiator')zones.push({kind:'radiator',side:left?'left':'right',x0:left?x-.05:x-RADIATOR_CLEAR-.1,x1:left?x+RADIATOR_CLEAR+.1:x+.05,z0:z-.45,z1:z+.45,minHeight:0});
        else if(['socket','switch','dimmer','wall-light'].includes(f.kind)){
            // Wall fittings must stay reachable: a 30 cm band along the wall, 12 cm into the room, blocking items tall enough to cover them.
            const minHeight=f.kind==='socket'?.2:f.kind==='wall-light'?1.6:.9;
            zones.push({kind:f.kind,x0:left?x-.05:x-.12,x1:left?x+.12:x+.05,z0:z-.15,z1:z+.15,minHeight});
        }
    }
    const placements=[],isRug=p=>ITEMS[p.item].procedural==='rug',onFloor=p=>Math.abs(p.box.y0-floorTop)<1e-6;
    const collides=(a,b)=>overlaps(a,b)&&a.y0<b.y1-1e-6&&a.y1>b.y0+1e-6;
    /** Try candidates in order; `on` rests the item on top of another placement (it must lie fully inside that top). */
    const place=(key,candidates,{on=null}={})=>{
        const item=ITEMS[key],rugItem=item.procedural==='rug';
        for(const c of candidates){
            const size=footprint(item,c.rotationY??0);
            let y=on?on.position[1]+on.size[1]:floorTop;
            const b=box(c.x,y,c.z,size);
            if(on&&!within(b,on.box))continue;
            // Items standing entirely on a rug rest on it; a partial overlap with a rug is rejected like any overlap.
            const rug=!on&&!rugItem&&placements.find(p=>isRug(p)&&overlaps(b,p.box));
            if(rug){if(!within(b,rug.box))continue;y=rug.box.y1;b.y0=y;b.y1=y+size[1];}
            // A rug may slide under items that stand entirely on it (they are lifted onto it), never half under one.
            const lifted=rugItem?placements.filter(p=>overlaps(b,p.box)):[];
            if(lifted.some(p=>isRug(p)||!onFloor(p)||!within(p.box,b)))continue;
            if(!within(b,clear)||zones.some(zone=>size[1]>zone.minHeight&&overlaps(b,zone))||placements.some(p=>!lifted.includes(p)&&collides(b,p.box)))continue;
            for(const p of lifted){p.position[1]+=size[1];p.box.y0+=size[1];p.box.y1+=size[1];}
            const placement={item:key,label:item.label,position:[c.x,y,c.z],rotationY:c.rotationY??0,size,procedural:!item.model,model:item.model??null,box:b};
            placements.push(placement);return placement;
        }
        return null;
    };
    const radiatorSide=zones.find(z=>z.kind==='radiator')?.side??null;
    return {clear,zones,placements,place,floorTop,width:clear.x1-clear.x0,depth:clear.z1-clear.z0,radiatorSide,
        sides:radiatorSide==='left'?['right','left']:['left','right']};
}
const at=(x,z,rotationY=0)=>({x,z,rotationY});
const spread=(x,z,rotationY=0,offsets=[0,-.25,.25,-.5,.5])=>offsets.map(o=>at(x+o,z,rotationY));
/** A plant on the first support that leaves room for it (table-top corner first, then the centre). */
function plantOn(ctx,supports){
    for(const s of supports.filter(Boolean)){
        const dx=Math.max(0,s.size[0]/2-.16),dz=Math.max(0,s.size[2]/2-.16);
        const hit=ctx.place('plant',[at(s.position[0]-dx,s.position[2]-dz),at(s.position[0]+dx,s.position[2]-dz),at(s.position[0],s.position[2])],{on:s});
        if(hit)return hit;
    }
    return null;
}

function planLiving(ctx,model){
    const {clear,place,width}=ctx,cx=(clear.x0+clear.x1)/2,strip=clear.z1-STRIP;
    if(width<2.6-2*model.wall){ // narrow room: one seat with a table beside it instead of a sofa group
        const chair=place('armchair',[...spread(cx,clear.z0+.05+.383),...spread(cx,clear.z0+.6)]);
        const table=chair&&place('sideTable',[at(chair.position[0]+.424+.05+.275,chair.position[2]),at(chair.position[0]-.424-.05-.275,chair.position[2])]);
        plantOn(ctx,[table]);
        if(chair)place('rugSmall',[at(chair.position[0],chair.box.z1+.55)]);
        return;
    }
    // Sofa faces the garden, as far forward as the walkway allows so the coffee table (and the rug edge) still fit in front.
    const forward=strip-.03-.6-.35-.409;
    const sofa=place('sofa',[...spread(cx,forward),...spread(cx,clear.z0+.05+.409)]);
    if(!sofa)return;
    const front=sofa.box.z1,sx=sofa.position[0];
    const coffee=place('coffeeTable',[at(sx,front+.35+.3),at(sx,front+.25+.3)]);
    // The rug runs under the sofa and the coffee table (both are lifted onto it); it is skipped when it cannot cover them.
    const groupEnd=coffee?coffee.box.z1:front+.35;
    const rug=place('rug',[at(sx,Math.max(clear.z0+.9,(sofa.box.z0+groupEnd)/2)),at(sx,Math.max(clear.z0+.9,sofa.box.z0+.9)),at(sx,groupEnd-.9)]);
    const edge=rug?rug.box:sofa.box;
    const side=place('sideTable',[at(edge.x1+.04+.275,sofa.position[2]),at(edge.x0-.04-.275,sofa.position[2])]);
    const az=coffee?coffee.position[2]:front+.5;
    // Armchair beside the coffee table (outside the rug), turned toward the group.
    place('armchair',[at(edge.x1+.3+.383,az,-Math.PI/2),at(edge.x0-.3-.383,az,Math.PI/2),at(edge.x1+.3+.383,az-.25,-Math.PI/2),at(edge.x0-.3-.383,az-.25,Math.PI/2)]);
    plantOn(ctx,[side,coffee]);
    if(model.depth>=3){
        // Small dining group in a corner on the house side, chairs on the house and garden side of the table.
        const chairD=.576,tz=clear.z0+.05+chairD+.04+.353;
        const table=place('diningTable',[at(clear.x0+.05+.567,tz),at(clear.x1-.05-.567,tz),at(clear.x0+.05+.567,tz+.3),at(clear.x1-.05-.567,tz+.3)]);
        if(table){
            place('diningChair',[at(table.position[0],table.box.z0-.04-.288,0),at(table.position[0]+.25,table.box.z0-.04-.288,0)]);
            place('diningChair',[at(table.position[0],table.box.z1+.04+.288,Math.PI),at(table.position[0]-.25,table.box.z1+.04+.288,Math.PI)]);
        }
    }
}
function planBedroom(ctx,model){
    const {clear,place,width,sides}=ctx,cx=(clear.x0+clear.x1)/2,narrow=width<2.6-2*model.wall;
    // Headboard against the house wall first; in a shallow room the bed lies along a side wall (radiator side last).
    // A double bed that fits nowhere degrades to a single bed (logeerkamer) rather than an empty room.
    const candidatesFor=key=>{
        const [bw,,bd]=ITEMS[key].size,list=[...spread(cx,clear.z0+bd/2),...spread(cx,clear.z0+MARGIN+bd/2)];
        for(const side of sides)for(const gap of [0,.12,.4])list.push(side==='left'?at(clear.x0+bd/2,clear.z0+gap+bw/2,Math.PI/2):at(clear.x1-bd/2,clear.z0+gap+bw/2,-Math.PI/2));
        return list;
    };
    let key=narrow?'singleBed':'bed',bed=place(key,candidatesFor(key));
    if(!bed&&key==='bed'){key='singleBed';bed=place(key,candidatesFor(key));}
    if(!bed)return;
    // Bedside tables 5 cm off the bed, backs to the headboard wall; the offsets come from the table's own size.
    const [bw]=ITEMS[key].size,[sw,,sd]=ITEMS.bedside.size,beside=bw/2+.05+sw/2,tables=[];
    if(bed.rotationY===0)for(const sign of [1,-1])tables.push(place('bedside',[at(bed.position[0]+sign*beside,bed.box.z0+sd/2),at(bed.position[0]+sign*beside,bed.box.z0+.3+sd/2)]));
    else for(const sign of [1,-1])tables.push(place('bedside',[at(bed.rotationY>0?bed.box.x0+sd/2:bed.box.x1-sd/2,bed.position[2]+sign*beside,bed.rotationY)]));
    if(!narrow){
        // Wardrobe against a side wall (radiator side last) or in a house-side corner, doors toward the room.
        const wz=clear.z0+.05+.5,options=[];
        for(const side of sides)options.push(side==='left'?at(clear.x0+MARGIN+.3,wz,Math.PI/2):at(clear.x1-MARGIN-.3,wz,-Math.PI/2));
        for(const side of sides)options.push(side==='left'?at(clear.x0+MARGIN+.5,clear.z0+MARGIN+.3,0):at(clear.x1-MARGIN-.5,clear.z0+MARGIN+.3,0));
        for(const side of sides)options.push(side==='left'?at(clear.x0+MARGIN+.3,wz+.8,Math.PI/2):at(clear.x1-MARGIN-.3,wz+.8,-Math.PI/2));
        place('wardrobe',options);
    }
    plantOn(ctx,tables);
}
function planYouth(ctx,model){
    const {clear,place,width,sides}=ctx,cx=(clear.x0+clear.x1)/2,narrow=width<2.6-2*model.wall;
    // Single bed along a side wall (head to the house), otherwise along the house wall.
    const bedOptions=[];
    for(const side of sides)bedOptions.push(side==='left'?at(clear.x0+MARGIN+.45,clear.z0+MARGIN+1,0):at(clear.x1-MARGIN-.45,clear.z0+MARGIN+1,0));
    for(const side of sides)bedOptions.push(side==='left'?at(clear.x0+MARGIN+1,clear.z0+MARGIN+.45,Math.PI/2):at(clear.x1-MARGIN-1,clear.z0+MARGIN+.45,-Math.PI/2));
    const bed=place('singleBed',bedOptions);
    const bedSide=bed?(bed.position[0]<cx?'left':'right'):sides[0],other=bedSide==='left'?'right':'left';
    let desk=null;
    if(!narrow){
        const r=model.rooflight,options=[],half=ITEMS.desk.size[2]/2;
        // Desk under the rooflight when there is one, turned to face the house so whoever sits at it looks out at
        // the garden; else against the free side wall with the chair on the room side.
        if(r&&r.kind!=='none'&&r.panelCount>0)options.push(at(r.x,r.z,Math.PI),at(r.x,r.z-.2,Math.PI),at(r.x,r.z+.2,Math.PI));
        // Against the wall first, then 15 cm off it (clear of sockets), at two depths.
        for(const inset of [MARGIN,.15])for(const z of [clear.z0+.7+.6,clear.z0+.3+.6])options.push(other==='left'?at(clear.x0+inset+half,z,Math.PI/2):at(clear.x1-inset-half,z,-Math.PI/2));
        desk=place('desk',options);
        if(desk){
            // The chair stands on the desk's FRONT — the side the knee hole opens to, which is +z before rotation —
            // and turns a half circle to face it. Deriving both from the desk's own rotation is what keeps an
            // asymmetric model honest: the old fixed "chair on the -z side" put the chair behind the desk as soon
            // as the desk turned against a side wall, which nothing noticed while the desk was a symmetric box.
            const [dx,,dz]=desk.position,gap=.05+ITEMS.deskChair.size[2]/2;
            const fx=Math.round(Math.sin(desk.rotationY)),fz=Math.round(Math.cos(desk.rotationY));
            const reach=(fz?desk.size[2]:desk.size[0])/2+gap,turn=desk.rotationY>0?desk.rotationY-Math.PI:desk.rotationY+Math.PI;
            // Slide along the desk's width if the chair's first spot is taken (a radiator, a socket band, the walkway).
            place('deskChair',[0,-.2,.2,-.35,.35].map(o=>at(dx+fx*reach+fz*o,dz+fz*reach-fx*o,turn)));
        }
    }
    // Bookcase against the house wall: sweep along it, starting from the corner away from the bed.
    const [bookWidth,,bookDepth]=ITEMS.bookcase.size,edge=bookWidth/2+.03;
    const corner=other==='left'?clear.x0+edge:clear.x1-edge,bookOptions=[];
    for(let x=clear.x0+edge;x<=clear.x1-edge+1e-9;x+=.3)bookOptions.push(at(x,clear.z0+MARGIN+bookDepth/2,0));
    place('bookcase',bookOptions.sort((a,b)=>Math.abs(a.x-corner)-Math.abs(b.x-corner)));
    const freeX=bed?(bedSide==='left'?bed.box.x1+.85:bed.box.x0-.85):cx,midZ=clear.z0+Math.min(ctx.depth-STRIP-.55,Math.max(.6,ctx.depth*.5));
    place('rugSmall',[at(freeX,midZ),at(cx,midZ),at(freeX,midZ-.3)]);
    plantOn(ctx,[desk]);
}

/** Pure: furniture placements for a scenario inside `model` (buildGeometry output, metres). */
export function planScenario(model,scenarioId){
    if(!model?.bounds||!SCENARIOS.some(s=>s.id===scenarioId)||scenarioId==='none')return [];
    const ctx=roomContext(model);
    if(ctx.width<.6||ctx.depth<.6)return [];
    ({living:planLiving,bedroom:planBedroom,youth:planYouth})[scenarioId](ctx,model);
    return ctx.placements.map(({box:_box,...p})=>p); // the working AABB stays internal
}

/** Lazy GLTFLoader wrapper: one parsed scene per model, a clone per load() call. */
export function createModelLoader({baseUrl}={}){
    const base=String(baseUrl??'').replace(/\/?$/,'/'),cache=new Map();
    let loaderPromise=null;
    const loader=()=>loaderPromise??=import('../vendor/gltf-loader.module.js').then(({GLTFLoader})=>new GLTFLoader());
    const parsed=name=>{
        const spec=MODELS[ITEMS[name]?.model??name];
        if(!spec)return Promise.reject(new Error(`Onbekend model: ${name}`));
        if(!cache.has(name))cache.set(name,loader().then(l=>l.loadAsync(base+spec.file)).then(gltf=>{
            gltf.scene.traverse(o=>{
                if(!o.isMesh)return;
                o.castShadow=o.receiveShadow=true;
                for(const material of [].concat(o.material??[])){
                    if(!material)continue;
                    material.side=THREE.FrontSide;
                    // The ARM map is already uploaded as roughnessMap: binding it as aoMap costs no download and no
                    // extra sampler, and it reads the same uv channel the glTF gave it.
                    if(spec.arm&&material.roughnessMap&&o.geometry?.attributes?.uv){material.aoMap=material.roughnessMap;material.aoMapIntensity=FURNITURE_AO;}
                }
            });
            return gltf.scene;
        }).catch(error=>{cache.delete(name);throw error;}));
        return cache.get(name);
    };
    return {
        async load(name){return (await parsed(name)).clone(true);},
        dispose(){
            for(const p of cache.values())p.then(scene=>scene.traverse(o=>{
                if(o.geometry)o.geometry.dispose();
                for(const m of [].concat(o.material??[]))for(const v of Object.values(m)){if(v?.isTexture)v.dispose();}
                for(const m of [].concat(o.material??[]))m.dispose?.();
            }),()=>{});
            cache.clear();
        },
    };
}

const matte=(color,roughness=.9)=>new THREE.MeshStandardMaterial({color,roughness,metalness:0});
const mesh=(group,geometry,material,x,y,z)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;group.add(m);return m;};
const slab=(group,material,w,h,d,x,y,z)=>mesh(group,new THREE.BoxGeometry(w,h,d),material,x,y+h/2,z);
/** Same hue a shade darker (negative) or lighter (positive): a border, a shadow gap, a seam, a second wood tone. */
const shade=(hex,amount)=>`#${new THREE.Color(hex).lerp(new THREE.Color(amount<0?'#000000':'#ffffff'),Math.abs(amount)).getHexString()}`;

/** Procedural stand-ins at real size, feet at y=0, front toward +z (a bed's headboard is at -z).
 *  Each builder must fill its declared [w,h,d] box and never leave it — buildInteriorScene plans around that box
 *  and interior_scenes.test.mjs measures the built group against it. */
const BUILDERS={
    rug(item,[w,h,d]){
        // A rug is a textile, not a tile: soft corners, a bound border a shade darker, and a pile that stands a
        // couple of millimetres above the binding so its edge catches the light instead of disappearing.
        const g=new THREE.Group();
        mesh(g,softPad(w,h*.6,d,{radius:.05,bevel:.006}),matte(shade(item.color,-.2),.97),0,h*.3,0);
        mesh(g,softPad(w-.11,h,d-.11,{radius:.04,bevel:.005}),matte(item.color,.99),0,h/2,0);
        // A wide and a narrow woven band in from each end: a flat-weave kleed, not a painted rectangle. They stand
        // 2 % of the pile proud of the field so they never z-fight with it.
        const band=matte(shade(item.color,-.13),.98);
        for(const end of [-1,1])for(const [inset,width] of [[.17,.06],[.25,.022]])
            mesh(g,softPad(w-.19,h*1.04,width,{radius:.008,bevel:.004}),band,0,h*.52,end*(d/2-inset));
        return g;
    },
    bed(item,[w,h,d]){
        // Platform bed: a recessed plinth under a rail frame, a soft mattress inset so the frame shows all round,
        // an upholstered headboard, two pillows and a duvet turned back at the head. Nothing here is a bare box.
        const g=new THREE.Group();
        const wood=matte(item.color,.62),plinth=matte(shade(item.color,-.22),.72),head=matte(shade(item.color,.1),.86);
        // The duvet has to be a clearly DIFFERENT tone from the mattress: at the near-white it started out, bedding
        // and mattress merged into one white block and the bed read as a mattress on a plinth.
        const sheet=matte('#f4f1e9',.94),cover=matte('#cbc4b3',.96),pillow=matte('#fbf9f4',.93),throwRug=matte('#b0afa0',.95);
        const rail=.22,mattress=.19,top=.06+rail+mattress;
        slab(g,plinth,w-.18,.06,d-.18,0,0,0);
        slab(g,wood,w,rail,d,0,.06,0);
        mesh(g,softPad(w-.05,mattress,d-.05,{radius:.045,bevel:.028}),sheet,0,.06+rail+mattress/2,0);
        // Headboard: full width, standing from the rail to the declared height, flush with the back of the frame.
        mesh(g,softPad(w,h-.06,.075,{radius:.03,bevel:.016}),head,0,.06+(h-.06)/2,-d/2+.0375);
        const pillows=w>1.2?[-w*.24,w*.24]:[0],pillowW=Math.min(.62,w*.46);
        for(const x of pillows)mesh(g,softPad(pillowW,.14,.38,{radius:.07,bevel:.055}),pillow,x,top+.07,-d/2+.075+.235);
        // Duvet over the lower two thirds, its top edge turned back on itself in the sheet, and a throw folded
        // across the foot — the three layers are what make a made bed read as made.
        const duvet=d-.62,dz=d/2-.03-duvet/2;
        mesh(g,softPad(w-.07,.13,duvet,{radius:.05,bevel:.04}),cover,0,top+.065,dz);
        mesh(g,softPad(w-.07,.08,.18,{radius:.045,bevel:.035}),sheet,0,top+.135,dz-duvet/2+.08);
        mesh(g,softPad(w-.11,.06,.32,{radius:.04,bevel:.028}),throwRug,0,top+.14,d/2-.07-.16);
        return g;
    },
    wardrobe(item,[w,h,d]){
        // Two doors set into the carcass with a shadow gap down the middle and a recessed toe kick under it; the
        // long bar handles are what carry the 2 cm of depth the carcass gives up, so the box stays exactly [w,h,d].
        const g=new THREE.Group();
        const body=matte(item.color,.56),door=matte(shade(item.color,.05),.5),cap=matte(shade(item.color,-.09),.6);
        const gap=matte('#2f312e',.95),steel=new THREE.MeshStandardMaterial({color:'#9aa0a2',metalness:.82,roughness:.3});
        const kick=.09,carcass=d-.022,front=d/2-.022,cz=-.011;
        slab(g,gap,w-.09,kick,carcass-.05,0,0,cz);                       // recessed toe kick, in its own shadow
        slab(g,body,w,h-kick-.022,carcass,0,kick,cz);
        slab(g,cap,w,.022,carcass,0,h-.022,cz);                          // top a shade darker, so it is not one slab
        for(const side of [-1,1]){
            slab(g,door,w/2-.014,h-kick-.072,.019,side*(w/4+.004),kick+.026,front-.0095);
            mesh(g,new THREE.CapsuleGeometry(.009,h*.34,4,10),steel,side*.052,kick+(h-kick)*.56,d/2-.009);
        }
        return g;
    },
    // --- The living and dining set, 2.10.1 -----------------------------------------------------------------------
    // The customer on the CC0 set it replaces (a black chesterfield, a baroque armchair, a rustic table and tufted
    // chairs): "salon takımı hiç modern değil ve seçim olarak kötü duruyorlar. zarif modern mobilyalar olsun." Modern
    // furniture is made of what these helpers draw well — soft-edged pads, slim legs, one clean top — so the set is
    // built here in a calm Scandinavian palette: a greige bouclé sofa, an olive lounge chair as the one accent, oiled
    // oak and black steel. Every piece fills exactly its declared box (the planner places the box, not the piece).
    sofa(item,[w,h,d]){
        const g=new THREE.Group(),fabric=upholstery(item.color),seam=upholstery(shade(item.color,-.08)),steel=blackSteel();
        const leg=.12,arm=.15,armTop=.56,backDepth=.17,seatTop=.44;
        for(const x of [-1,1])for(const z of [-1,1])taperedLeg(g,steel,x*(w/2-.09),z*(d/2-.09),leg);
        mesh(g,softPad(w,.2,d,{radius:.035,bevel:.02}),fabric,0,leg+.1,0);                          // upholstered base
        for(const x of [-1,1])mesh(g,softPad(arm,armTop-leg,d,{radius:.06,bevel:.035}),fabric,x*(w/2-arm/2),leg+(armTop-leg)/2,0);
        mesh(g,softPad(w-2*arm+.02,h-leg,backDepth,{radius:.05,bevel:.03}),fabric,0,leg+(h-leg)/2,-d/2+backDepth/2);
        const inner=w-2*arm,cushion=(inner-.012)/2,seatDepth=d-backDepth-.02;
        for(const x of [-1,1]){
            mesh(g,softPad(cushion,seatTop-(leg+.2),seatDepth,{radius:.05,bevel:.04}),seam,x*(cushion/2+.006),(leg+.2+seatTop)/2,d/2-seatDepth/2);
            const pillow=h-.025-seatTop;   // the back cushions stop just under the backrest's top, inside the box
            mesh(g,softPad(cushion,pillow,.14,{radius:.06,bevel:.05}),fabric,x*(cushion/2+.006),seatTop+pillow/2,-d/2+backDepth+.06);
        }
        return g;
    },
    armchair(item,[w,h,d]){
        const g=new THREE.Group(),fabric=upholstery(item.color),oak=oiledOak();
        const leg=.17,seatTop=.42,back=.14;
        for(const x of [-1,1])for(const z of [-1,1])taperedLeg(g,oak,x*(w/2-.07),z*(d/2-.07),leg,.016,.011);
        mesh(g,softPad(w,.12,d,{radius:.04,bevel:.025}),fabric,0,leg+.06,0);
        for(const x of [-1,1])mesh(g,softPad(.11,.56-leg,d-.02,{radius:.05,bevel:.03}),fabric,x*(w/2-.055),leg+(.56-leg)/2,-.01);
        mesh(g,softPad(w,h-leg,back,{radius:.06,bevel:.035}),fabric,0,leg+(h-leg)/2,-d/2+back/2);
        mesh(g,softPad(w-.24,seatTop-(leg+.12),d-back-.03,{radius:.05,bevel:.035}),upholstery(shade(item.color,.06)),0,(leg+.12+seatTop)/2,(back+.03)/2);
        return g;
    },
    coffeeTable(item,[w,h,d]){
        // A racetrack top in oiled oak on four slim black legs, with a thin darker edge so the top reads as solid wood.
        const g=new THREE.Group(),oak=oiledOak(),edge=oiledOak(-.16),steel=blackSteel(),top=.035;
        mesh(g,softPad(w,top,d,{radius:d/2-.002,bevel:.008}),edge,0,h-top/2,0);
        mesh(g,softPad(w-.012,top*1.02,d-.012,{radius:d/2-.008,bevel:.006}),oak,0,h-top/2+.0005,0);
        for(const x of [-1,1])for(const z of [-1,1])taperedLeg(g,steel,x*(w/2-.2),z*(d/2-.11),h-top,.012,.009);
        return g;
    },
    sideTable(item,[w,h,d]){
        const g=new THREE.Group(),steel=blackSteel(),oak=oiledOak(),r=Math.min(w,d)/2;
        mesh(g,new THREE.CylinderGeometry(r,r,.022,48),oak,0,h-.011,0);
        mesh(g,new THREE.CylinderGeometry(.014,.014,h-.034,16),steel,0,(h-.022)/2+.006,0);
        mesh(g,new THREE.CylinderGeometry(r*.62,r*.66,.012,40),steel,0,.006,0);
        return g;
    },
    diningTable(item,[w,h,d]){
        const g=new THREE.Group(),oak=oiledOak(),edge=oiledOak(-.16),steel=blackSteel(),top=.03;
        mesh(g,softPad(w,top,d,{radius:.025,bevel:.006}),edge,0,h-top/2,0);
        mesh(g,softPad(w-.01,top*1.02,d-.01,{radius:.022,bevel:.005}),oak,0,h-top/2+.0005,0);
        for(const x of [-1,1])for(const z of [-1,1])slab(g,steel,.035,h-top,.035,x*(w/2-.07),0,z*(d/2-.07));
        for(const x of [-1,1])slab(g,steel,.02,.05,d-.18,x*(w/2-.07),h-top-.05,0);                    // apron rails
        return g;
    },
    diningChair(item,[w,h,d]){
        // An upholstered shell on slim oak legs: seat 46 cm, a softly curved back leaning 6 degrees.
        const g=new THREE.Group(),fabric=upholstery(item.color),oak=oiledOak(),seat=.46,sd=d;
        for(const x of [-1,1])for(const z of [-1,1])taperedLeg(g,oak,x*(w/2-.05),z*(sd/2-.05),seat-.06,.014,.01);
        mesh(g,softPad(w,.07,sd,{radius:.05,bevel:.03}),fabric,0,seat-.035,0);
        const backrest=mesh(g,softPad(w-.02,h-seat,.055,{radius:.06,bevel:.025}),fabric,0,seat+(h-seat)/2,-sd/2+.045);
        backrest.rotation.x=-.1;
        return g;
    },
    // --- Bedroom and youth room, 2.10.3 ------------------------------------------------------------------------------
    // The same material language as the living set (oiled oak, black steel, soft upholstery), so the three scenarios
    // read as one house. The youth room's one accent is the dusty blue desk chair.
    bedside(item,[w,h,d]){
        // An oak box on a slim steel frame: one drawer with a shadow-gap grip instead of a knob, an open niche below.
        const g=new THREE.Group(),oak=oiledOak(),front=oiledOak(.08),steel=blackSteel(),shadow=matte('#2b2a27',.95);
        const leg=.15,t=.018,niche=.12,top=h-t,drawer=top-(leg+t+niche+t)-.004;
        for(const x of [-1,1])for(const z of [-1,1])slab(g,steel,.018,leg+t,.018,x*(w/2-.03),0,z*(d/2-.03));
        slab(g,oak,w,t,d,0,leg,0);                                              // bottom
        slab(g,oiledOak(-.1),w,t,d,0,top,0);                                    // top, a shade darker
        for(const x of [-1,1])slab(g,oak,t,top-leg-t,d,x*(w/2-t/2),leg+t,0);   // sides
        slab(g,oak,w-2*t,top-leg-t,t,0,leg+t,-d/2+t/2);                         // back
        slab(g,oak,w-2*t,t,d-t,0,leg+t+niche,t/2);                              // shelf over the niche
        slab(g,front,w-2*t-.004,drawer-.014,t,0,leg+2*t+niche+.002,d/2-t/2);    // drawer front, flush
        slab(g,shadow,w-2*t-.004,.014,t*.6,0,top-.014,d/2-t*.8);                // the grip: a dark gap under the top
        return g;
    },
    desk(item,[w,h,d]){
        // An oak top on a black steel frame with a slim white drawer hung under the right side. The back carries the
        // rails; the knee hole stays open toward +z, where the planner puts the chair.
        const g=new THREE.Group(),oak=oiledOak(),edge=oiledOak(-.16),steel=blackSteel(),white=matte('#eceae4',.45),top=.025,legH=h-top;
        mesh(g,softPad(w,top,d,{radius:.012,bevel:.004}),edge,0,h-top/2,0);
        mesh(g,softPad(w-.008,top*1.02,d-.008,{radius:.01,bevel:.004}),oak,0,h-top/2+.0005,0);
        for(const x of [-1,1])for(const z of [-1,1])slab(g,steel,.03,legH,.03,x*(w/2-.035),0,z*(d/2-.035));
        for(const x of [-1,1])slab(g,steel,.02,.04,d-.1,x*(w/2-.035),legH-.04,0);   // side rails
        slab(g,steel,w-.1,.04,.02,0,legH-.04,-d/2+.035);                              // back rail
        slab(g,steel,w-.1,.02,.02,0,.16,-d/2+.035);                                   // low stretcher, feet off it
        const box=.36,bx=w/2-.05-box/2;
        slab(g,white,box,.1,d-.12,bx,legH-.1,0);                                      // drawer
        slab(g,steel,.12,.012,.012,bx,legH-.062,(d-.12)/2+.006);                      // its pull
        return g;
    },
    deskChair(item,[w,h,d]){
        // A task chair: a five-star base on castors, a gas column, a padded seat and back on one steel spine. The base
        // is sized so its castors touch the sides and the front of the declared box; the backrest closes the back.
        const g=new THREE.Group(),fabric=upholstery(item.color),steel=blackSteel(),castor=matte('#2a2b2c',.55);
        const c=.025,R=(w/2-c)/Math.sin(2*Math.PI/5),oz=d/2-c-R,seat=.47;
        for(let i=0;i<5;i++){
            const a=i*2*Math.PI/5;
            mesh(g,new THREE.BoxGeometry(.034,.028,R),steel,Math.sin(a)*R/2,.062,Math.cos(a)*R/2+oz).rotation.y=a;
            mesh(g,new THREE.SphereGeometry(c,16,12),castor,Math.sin(a)*R,c,Math.cos(a)*R+oz);
        }
        mesh(g,new THREE.CylinderGeometry(.045,.05,.04,24),steel,0,.076,oz);           // hub
        mesh(g,new THREE.CylinderGeometry(.022,.022,seat-.18,16),steel,0,.08+(seat-.18)/2,oz);   // gas column up to the mechanism
        slab(g,steel,.18,.03,.18,0,seat-.1,oz);                                       // tilt mechanism
        const seatD=d-.08;
        mesh(g,softPad(w-.1,.075,seatD,{radius:.05,bevel:.03}),fabric,0,seat-.0375,d/2-seatD/2-.01);
        slab(g,steel,.05,.2,.016,0,seat-.09,-d/2+.058);                               // spine up to the back
        mesh(g,softPad(w-.14,h-seat-.06,.05,{radius:.06,bevel:.03}),fabric,0,seat+.06+(h-seat-.06)/2,-d/2+.025);
        return g;
    },
    bookcase(item,[w,h,d]){
        // Open shelving: five oak shelves on four black steel posts, loosely filled: runs of books, a lying stack,
        // two storage boxes and a bay left open. A full grid of identical books reads as wallpaper, not as a room.
        const g=new THREE.Group(),oak=oiledOak(),steel=blackSteel(),t=.025,post=.022,levels=5;
        for(const x of [-1,1])for(const z of [-1,1])slab(g,steel,post,h,post,x*(w/2-post/2),0,z*(d/2-post/2));
        for(const y of [.04,h-.03])slab(g,steel,w-2*post,.02,.012,0,y,-d/2+.006);     // back rails, top and bottom
        const shelfY=i=>.04+i*(h-.04-t)/(levels-1);
        for(let i=0;i<levels;i++)slab(g,oak,w-.004,t,d-.004,0,shelfY(i),0);
        const random=seeded(23),covers=['#7d8a7a','#b9a27d','#4f5d66','#c9c1b1','#8b5e4a','#d8d2c4','#5a6358'].map(c=>matte(c,.8));
        const inner=w-2*post-.02,left=-inner/2;
        const books=(x0,x1,y,bay)=>{
            for(let x=x0;x<x1-.02;){
                const bw=.018+random()*.022,bh=Math.min(bay-.04,.17+random()*.1),bd=.15+random()*.06;
                if(x+bw>x1)break;
                slab(g,covers[Math.floor(random()*covers.length)],bw,bh,bd,x+bw/2,y,d/2-.035-bd/2);
                x+=bw+.002;
            }
        };
        const box=matte('#e6e2d8',.7);
        for(let i=0;i<levels-1;i++){
            const y=shelfY(i)+t,bay=shelfY(i+1)-y;
            if(i===0){slab(g,box,.3,Math.min(.26,bay-.04),d-.08,left+.17,y,0);slab(g,box,.3,Math.min(.26,bay-.04),d-.08,left+.49,y,0);books(left+.68,left+inner,y,bay);}
            else if(i===1)books(left,left+inner*.62,y,bay);                         // the right of this bay stays open
            else if(i===2){books(left+inner*.3,left+inner,y,bay);for(let k=0;k<4;k++)slab(g,covers[k+2],.24,.028,.17,left+.14,y+k*.03,d/2-.035-.085);}
            else books(left,left+inner*.45,y,bay);
        }
        return g;
    },
    fallback(item,[w,h,d]){const g=new THREE.Group();slab(g,matte(item.color??'#b9b3a6',.85),w,h,d,0,0,0);return g;}
};
/**
 * Two small textures drawn once on a canvas, shared by every piece: an oak grain and a bouclé weave. Measured on the
 * first render of the set: flat-coloured oak read as orange cardboard and flat fabric as white plastic, in exactly the
 * close-ups a visitor makes. Without a document (the node tests) they are null and the pieces keep plain colours.
 */
let woodGrain,fabricWeave;
function canvasTexture(size,paint){
    if(typeof document==='undefined')return null;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    paint(canvas.getContext('2d'),size);
    const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
}
function seeded(seed){return ()=>{seed=seed*16807%2147483647;return seed/2147483647;};}
function grain(){
    // Long, slightly wavering lines of varying weight on white: multiplied by the oak tint they become the figure of
    // flat-sawn oak running along the piece (softPad UVs are in metres, so one tile is one metre of board).
    if(woodGrain===undefined)woodGrain=canvasTexture(512,(ctx,size)=>{
        const random=seeded(7);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size,size);
        for(let i=0;i<260;i++){
            const y=random()*size,alpha=.03+random()*.09,wave=1+random()*2,phase=random()*6.28;
            ctx.strokeStyle=`rgba(96,64,34,${alpha.toFixed(3)})`;ctx.lineWidth=.5+random()*2;ctx.beginPath();
            for(let x=0;x<=size;x+=16)ctx.lineTo(x,y+Math.sin(x/size*6.28*wave+phase)*2.5);
            ctx.stroke();
        }
    });
    return woodGrain;
}
function weave(){
    // A fine mottle, 256 px per metre: a few millimetres of loop, which is what reads as bouclé instead of vinyl.
    if(fabricWeave===undefined)fabricWeave=canvasTexture(256,(ctx,size)=>{
        const random=seeded(11),image=ctx.createImageData(size,size);
        for(let i=0;i<image.data.length;i+=4){const v=205+Math.floor(random()*50);image.data[i]=image.data[i+1]=image.data[i+2]=v;image.data[i+3]=255;}
        ctx.putImageData(image,0,0);
    });
    return fabricWeave;
}
/** Bouclé-like upholstery: a mid-tone, fully rough, the weave as colour and relief, and a little sheen at the edges. */
function upholstery(color){
    const texture=weave();
    return new THREE.MeshPhysicalMaterial({color,roughness:.95,metalness:0,sheen:.45,sheenRoughness:.85,
        sheenColor:new THREE.Color(color).lerp(new THREE.Color('#ffffff'),.25),map:texture,bumpMap:texture,bumpScale:.8});
}
/** Oiled natural oak: muted rather than orange, satin, with the grain. `amount` darkens it for an edge band. */
function oiledOak(amount=0){
    const material=matte(amount?shade('#b39676',amount):'#b39676',.58);
    const texture=grain();if(texture){material.map=texture;material.needsUpdate=true;}
    return material;
}
function blackSteel(){return new THREE.MeshStandardMaterial({color:'#1f2123',roughness:.42,metalness:.6});}
/** A slim leg narrowing to its foot, standing at (x,z) from the floor to `height`. */
function taperedLeg(group,material,x,z,height,top=.015,foot=.01){
    return mesh(group,new THREE.CylinderGeometry(top,foot,height,16),material,x,height/2,z);
}

/** THREE group 'interior-scene' for a scenario; never throws on a failed model download (procedural fallback instead). */
export async function buildInteriorScene(model,scenarioId,loader,{onProgress}={}){
    const group=new THREE.Group();group.name='interior-scene';
    const placements=planScenario(model,scenarioId);
    group.userData={scenario:scenarioId,indicative:true,scopeKey:null,fallbacks:[],placements};
    let loaded=0;
    for(const p of placements){
        const item=ITEMS[p.item];let object=null;
        if(item.model&&loader){
            try{object=(await loader.load(p.item))??null;}
            catch{object=null;}
            if(!object)group.userData.fallbacks.push({item:p.item,model:item.model});
        }
        const fallback=!!item.model&&!object,total=p.rotationY+(object?item.modelRotation??0:0);
        if(object){
            // The glTF box centre is not on the origin: shift by the rotated local offset so the footprint lands on the plan.
            const [ox,oz]=MODELS[item.model]?.offset??[0,0],c=Math.cos(total),s=Math.sin(total);
            object.position.set(p.position[0]-(ox*c+oz*s),p.position[1],p.position[2]-(-ox*s+oz*c));
        }else{
            object=(BUILDERS[item.procedural]??BUILDERS.fallback)(item,item.size);
            object.position.set(p.position[0],p.position[1],p.position[2]);
        }
        object.rotation.y=total;object.name=`interior-${p.item}`;object.userData={item:p.item,label:p.label,indicative:true,procedural:!item.model||fallback};
        object.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});
        group.add(object);
        onProgress?.({loaded:++loaded,total:placements.length,item:p.item});
    }
    return group;
}

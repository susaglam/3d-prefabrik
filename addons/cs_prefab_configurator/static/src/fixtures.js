import * as THREE from '../vendor/three.module.js';

/** Commercial state is supplied by the server; hiding examples never changes it. */
export function fixtureAppearance(scope, key, showExamples = true) {
    const row=Array.isArray(scope)?scope.find(item=>item.key===key):null;
    const components=row?.components||[];
    const supplied=row?.productIncluded===true||components.some(c=>c.role==='product'&&['included','extra'].includes(c.status));
    const preparation=components.some(c=>['preparation','prep'].includes(c.role)&&['included','extra'].includes(c.status));
    const pointOnly=row?.visualMode==='preparation',hidden=row?.visualMode==='none';
    return {mode:hidden?'none':pointOnly?'preparation':supplied?'included':'representative',visible:!hidden&&!pointOnly&&(supplied||showExamples),preparation:!hidden&&preparation,
        fidelity:row?.modelFidelity||'indicative',assetKey:row?.assetKey||key,resolved:!!row};
}

/** A floor route explains the selected concept; preparation never supplies pipework. */
export function underfloorAppearance(scope, showExamples = true) {
    const appearance=fixtureAppearance(scope,'underfloorHeating',showExamples);
    const mode=appearance.mode==='none'?'none':appearance.mode==='included'?'included':'representative';
    return {mode,visible:mode!=='none'&&(mode==='included'||showExamples)};
}

/** Construction connection points remain distinct from optional example devices. */
export function buildPreparation(fixture,appearance,material) {
    const group=new THREE.Group();group.name=fixture.id+'-preparation';
    group.position.set(...fixture.position);group.rotation.y=fixture.rotation;
    group.visible=appearance.preparation;
    group.userData={fixtureId:fixture.id,scopeKey:fixture.key,visualMode:'preparation',room:fixture.room,
        preparationKind:fixture.kind==='radiator'?'heating-pipes':fixture.kind==='tap'?'water-pipe':'electrical-point'};
    const metal=material('preparation-copper',{color:'#98734e',roughness:.65,metalness:.5});
    const cap=material('preparation-cap',{color:'#b6afa1',roughness:.72,metalness:.3});
    const add=(geometry,mat,position,rotation=[0,0,0])=>{
        const object=new THREE.Mesh(geometry,mat);object.position.set(...position);object.rotation.set(...rotation);
        object.castShadow=true;object.receiveShadow=true;group.add(object);return object;
    };
    if(fixture.kind==='radiator'){
        const panel=appearance.assetKey==='heating-panel',y=panel?-.35:-.94;
        for(const x of panel?[-.36,.36]:[-.16,.16]){
            const path=new THREE.CatmullRomCurve3([[x,y,.004],[x,y,.032],[x,y+.008,.052],[x,y+.034,.052]].map(p=>new THREE.Vector3(...p)));
            add(new THREE.TubeGeometry(path,14,.007,8,false),metal,[0,0,0]);
            add(new THREE.CylinderGeometry(.014,.014,.004,16),cap,[x,y,.004],[Math.PI/2,0,0]);
            add(new THREE.CylinderGeometry(.010,.010,.012,12),cap,[x,y+.037,.052]);
        }
    }else if(fixture.kind==='tap'){
        add(new THREE.CylinderGeometry(.012,.012,.042,12),metal,[0,0,.022],[Math.PI/2,0,0]);
        add(new THREE.CylinderGeometry(.015,.015,.006,12),cap,[0,0,.046],[Math.PI/2,0,0]);
    }else{
        const ceiling=['ceiling','overhang'].includes(fixture.room);
        add(new THREE.CylinderGeometry(.013,.013,.008,12),metal,ceiling?[0,-.004,0]:[0,0,.004],ceiling?[0,0,0]:[Math.PI/2,0,0]);
    }
    return group;
}

/** Thin route lines and a transparent floor area, never an installation promise. */
export function buildUnderfloorHeating(model,appearance,material) {
    const group=new THREE.Group();group.name='underfloor-overlay';
    const loops=model.interior&&model.underfloorHeating?(model.underfloorLoops||[]):[];
    group.userData={scopeKey:'underfloorHeating',visualMode:appearance.mode,schematic:true,loopCount:loops.length};
    group.visible=appearance.visible&&loops.length>0;
    if(!loops.length)return group;
    const points=loops.flat(),padding=.04;
    const left=Math.max(model.bounds.left+model.wall+.025,Math.min(...points.map(p=>p[0]))-padding);
    const right=Math.min(model.bounds.right-model.wall-.025,Math.max(...points.map(p=>p[0]))+padding);
    const back=Math.max(model.bounds.back+.025,Math.min(...points.map(p=>p[2]))-padding);
    const front=Math.min(model.bounds.front-model.wall-.025,Math.max(...points.map(p=>p[2]))+padding);
    if(right<=left||front<=back)return group;
    const area=new THREE.Mesh(new THREE.PlaneGeometry(right-left,front-back),material('underfloor-area',{
        color:'#b99b77',transparent:true,opacity:.09,depthTest:true,depthWrite:false,side:THREE.DoubleSide},'flat'));
    area.rotation.x=-Math.PI/2;area.position.set((left+right)/2,.095,(back+front)/2);area.renderOrder=1;
    // The 9 %-opacity wash covers nearly the whole floor. Left pickable it would swallow every click meant for the
    // afwerkvloer underneath, so only the copper route lines answer to vloerverwarming.
    area.userData={floorPreparationArea:true,noPick:true};group.add(area);
    const line=material('underfloor-route',{color:'#98714e',transparent:true,opacity:.68,depthTest:true,depthWrite:false,toneMapped:false},'line');
    for(const points of loops){
        const route=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),line);
        route.renderOrder=2;route.userData.floorHeatingLoop=true;group.add(route);
    }
    return group;
}

/** Lightweight optical falloff confined to a fitting's aperture, without scene lights. */
function apertureGlow(radius,appearance,material,position,rotation){
    const segments=24,vertices=[],colours=[],colour=new THREE.Color('#ffd39a');
    const alpha=appearance.mode==='representative'?.12:.24;
    for(let i=0;i<segments;i++){
        const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
        vertices.push(0,0,0,Math.cos(a)*radius,Math.sin(a)*radius,0,Math.cos(b)*radius,Math.sin(b)*radius,0);
        for(const opacity of [alpha,0,0])colours.push(colour.r,colour.g,colour.b,opacity);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,4));
    const mesh=new THREE.Mesh(geometry,material('fixture-aperture-glow',{vertexColors:true,transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false},'flat'));
    mesh.position.set(...position);mesh.rotation.set(...rotation);mesh.renderOrder=3;
    mesh.userData.lightEffect=true;
    return mesh;
}

/**
 * Dimensioned generic fittings. Example devices look exactly like supplied ones — real materials and shadows — so the
 * scene reads as a finished room; the scope text and the examples toggle carry the commercial distinction.
 */
export function buildFixture(fixture,appearance,material) {
    const group=new THREE.Group();group.name=fixture.id;
    group.position.set(...fixture.position);group.rotation.y=fixture.rotation;
    group.userData={fixtureId:fixture.id,scopeKey:fixture.key,visualMode:appearance.mode,modelFidelity:appearance.fidelity,room:fixture.room};
    const body=material('fixture-ivory',{color:'#f3f1e9',roughness:.35,metalness:.12});
    const metal=material('fixture-chrome',{color:'#c4c9c9',roughness:.19,metalness:.94});
    const dark=material('fixture-graphite',{color:'#252b2c',roughness:.36,metalness:.4});
    const diffuser=material('fixture-warm-diffuser',{color:'#fff1d9',emissive:'#f8c68e',emissiveIntensity:.45,roughness:.62,metalness:0});
    const glow=(radius,position,rotation)=>group.add(apertureGlow(radius,appearance,material,position,rotation));
    function mesh(geometry,mat,position=[0,0,0],rotation=[0,0,0],parent=group){
        const object=new THREE.Mesh(geometry,mat);object.position.set(...position);object.rotation.set(...rotation);
        object.castShadow=true;object.receiveShadow=true;parent.add(object);
        return object;
    }
    const box=(w,h,d,x=0,y=0,z=0,mat=body)=>mesh(new THREE.BoxGeometry(w,h,d),mat,[x,y,z]);
    const cylinder=(r,h,x,y,z,mat=body,rotation=[0,0,0])=>mesh(new THREE.CylinderGeometry(r,r,h,16),mat,[x,y,z],rotation);
    const tube=(points,r,mat=metal)=>mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),24,r,10,false),mat);
    if(fixture.kind==='radiator'&&appearance.assetKey==='heating-panel'){
        box(.90,.60,.095,0,0,.073);
        for(let i=0;i<20;i++)box(.029,.55,.013,-.418+i*.044,0,.127);
        for(const x of [-.36,.36]){box(.055,.055,.04,x,.16,.018);cylinder(.019,.065,x,-.277,.072,metal);}
        cylinder(.033,.09,.42,-.287,.072,body,[0,0,Math.PI/2]);
    }else if(fixture.kind==='radiator'){
        // The example design radiator: four flat vertical lanes in matt anthracite, 58 x 90 cm, from 20 to 110 cm
        // above the floor (the group sits at the 108 cm anchor, so it hangs from -0,88 to +0,02). It replaces a 1,64 m
        // ivory column whose thin tubes and dark gaps read as a black-dotted grille and which, reaching 1,90 m, blocked
        // the wall-light slot above it (customer report 2026-09-18). Same width and floor clearance, so every other
        // rule — wall space, the socket below it — behaves exactly as before. services/geometry_rules.py: (29, 45, 65).
        const finish=material('radiator-anthracite',{color:'#3b3e40',roughness:.55,metalness:.25});
        const width=.58,height=.90,lanes=4,gap=.012,lane=(width-(lanes-1)*gap)/lanes,centre=-.43;
        for(let i=0;i<lanes;i++)box(lane,height,.026,-width/2+lane/2+i*(lane+gap),centre,.071,finish);
        for(const y of [centre+height/2-.08,centre-height/2+.08])box(width-.04,.045,.03,0,y,.042,finish);
        for(const x of [-.16,.16])cylinder(.012,.06,x,centre-height/2-.03,.052,metal);
        cylinder(.02,.055,.16,centre-height/2-.035,.078,metal,[Math.PI/2,0,0]);
    }else if(fixture.kind==='tap'){
        cylinder(.041,.025,0,0,.015,metal,[Math.PI/2,0,0]);
        tube([[0,0,.02],[0,0,.085],[0,-.015,.13],[0,-.08,.14]],.013);
        cylinder(.016,.065,0,.033,.072,metal);
        cylinder(.01,.09,0,.071,.072,metal,[0,0,Math.PI/2]);
    }else if(fixture.kind==='socket'||fixture.kind==='switch'){
        const count=fixture.double?2:1;
        box(count*.08,.083,.016,0,0,.018);
        for(let i=0;i<count;i++){
            const x=(i-(count-1)/2)*.076;
            if(fixture.kind==='switch')box(.057,.058,.01,x,0,.032);
            else{
                cylinder(.026,.009,x,0,.032,body,[Math.PI/2,0,0]);
                mesh(new THREE.TorusGeometry(.025,.002,6,24),metal,[x,0,.038]);
                for(const offset of [-.009,.009])cylinder(.0028,.002,x+offset,0,.039,dark,[Math.PI/2,0,0]);
            }
        }
    }else if(fixture.kind==='dimmer'){
        box(.08,.083,.016,0,0,.018);
        cylinder(.017,.014,0,0,.033,body,[Math.PI/2,0,0]);
        cylinder(.0035,.005,0,.009,.0415,dark,[Math.PI/2,0,0]);
    }else if(fixture.kind==='wall-light'){
        box(.075,.17,.10,0,0,.064,dark);
        for(const y of [-.084,.084]){
            box(.056,.004,.067,0,y,.069,diffuser);
            glow(.027,[0,y+Math.sign(y)*.003,.069],[y>0?-Math.PI/2:Math.PI/2,0,0]);
        }
    }else if(fixture.kind==='spot'){
        cylinder(.045,.007,0,0,0,body);
        cylinder(.032,.01,0,-.007,0,dark);
        cylinder(.023,.003,0,-.013,0,diffuser);
        glow(.030,[0,-.0155,0],[Math.PI/2,0,0]);
    }else if(fixture.kind==='pendant'){
        // Modern pendants that do not shade the ceiling: a slim matte-black cylinder, or a flat LED disc on thin cables.
        cylinder(.035,.018,0,-.009,0,dark);
        if(appearance.assetKey==='ceiling-dome'){
            for(const [dx,dz] of [[-.11,0],[.11,0]])cylinder(.0012,.40,dx,-.218,dz,dark);
            cylinder(.15,.028,0,-.432,0,body);
            cylinder(.146,.004,0,-.448,0,diffuser);
            glow(.147,[0,-.451,0],[Math.PI/2,0,0]);
        }else{
            cylinder(.0015,.36,0,-.198,0,dark);
            cylinder(.045,.16,0,-.456,0,dark);
            cylinder(.041,.004,0,-.535,0,diffuser);
            glow(.042,[0,-.538,0],[Math.PI/2,0,0]);
        }
    }
    group.visible=appearance.visible;
    return group;
}

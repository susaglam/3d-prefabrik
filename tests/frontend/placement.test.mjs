import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const source=await readFile(new URL('../../addons/cs_prefab_configurator/static/src/geometry.js',import.meta.url),'utf8');
const {buildFixtureLayout,buildGeometry,planSvg,documentPlanSvg,openingSpec,EXTERIOR_HEIGHTS_CM}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const addon=fileURLToPath(new URL('../../addons/cs_prefab_configurator',import.meta.url));
const python=(code,input)=>{
    const process=spawnSync('python',['-c',`import sys,json\nsys.path.insert(0,sys.argv[1])\n${code}`,addon],{input:JSON.stringify(input),encoding:'utf8'});
    assert.equal(process.status,0,process.stderr);
    return JSON.parse(process.stdout);
};
const close=(actual,expected,path='root')=>{
    if(typeof expected==='number'){assert.ok(Math.abs(actual-expected)<1e-8,`${path}: ${actual} != ${expected}`);return;}
    if(expected&&typeof expected==='object'){
        assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),path);
        for(const key of Object.keys(expected))close(actual[key],expected[key],`${path}.${key}`);
    }else assert.equal(actual,expected,path);
};

test('server and scene size every front opening, "geen kozijn" included, from one shared cm rule',()=>{
    const cases=[];
    for(const kind of ['none','french','sliding-2','sliding-4','folding'])for(const width of [150,200,230,300,410,500,530,750])cases.push({kind,width});
    const rows=python(`from services.geometry_rules import opening_spec
print(json.dumps([opening_spec(case['kind'],case['width']) for case in json.load(sys.stdin)]))`,cases);
    assert.equal(rows.length,cases.length);
    cases.forEach((case_,index)=>close(openingSpec(case_.kind,case_.width),rows[index],`${case_.kind}@${case_.width}`));
    // The skeleton is the 2-leaf schuifpui's rough opening at every width, with no leaves; the metric model agrees.
    for(const {kind,width} of cases.filter(c=>c.kind==='none')){
        const spec=openingSpec(kind,width);
        assert.equal(spec.width,openingSpec('sliding-2',width).width,`none@${width}`);
        assert.equal(spec.panelCount,0);assert.equal(spec.skeleton,true);
        const model=buildGeometry({width,frontOpening:'none'});
        assert.ok(Math.abs(model.opening.width*100-spec.width)<1e-8,`metres@${width}: ${model.opening.width*100} != ${spec.width}`);
        assert.ok(Math.abs(buildFixtureLayout({width,depth:300,height:280,frontOpening:'none',rooflight:'none',drainSide:'right'}).basis.width-width)<1e-8);
    }
});

test('server and scene use the same cm layout across dimensions, roofs, drains and custom clearances',()=>{
    const inputs=[];
    for(const [width,depth,frontOpening] of [[150,100,'none'],[230,200,'french-white'],[500,300,'sliding-2-black'],[750,340,'folding-white']]){
        for(const rooflight of ['none','lean-1','gable-10'])for(const drainSide of ['left','right','both'])for(const clearance of [5,20])inputs.push({width,depth,frontOpening,rooflight,drainSide,clearance});
    }
    const rows=python(`from services.catalog import default_release
from services.geometry_rules import fixture_layout
rows=[]
for values in json.load(sys.stdin):
    release=default_release()
    clearance=values.pop('clearance')
    config=dict(release['catalog']['defaults'],**values)
    rules=release['catalog']['geometryRules']
    rules['clearanceCm'].update(fixture=clearance,roof=clearance)
    rows.append({'config':config,'rules':rules,'layout':fixture_layout(config,rules)})
print(json.dumps(rows))`,inputs);
    assert.equal(rows.length,72);
    for(const {config,rules,layout} of rows)close(buildFixtureLayout(config,rules),layout);
});

test('canonical server layout is rendered at exact matching locations and stale dimensions are ignored',()=>{
    const result=python(`from services.catalog import default_release,release_context
from services.pricing import price_config
release=default_release()
release['catalog']['geometryRules']['clearanceCm'].update(roof=20,wallEdge=12)
with release_context(release):
    result=price_config(json.load(sys.stdin))
print(json.dumps(result))`,{interior:true,rooflight:'lean-1',ceilingPositions:['left','center','right'],spotPositions:['r1c1','r3c5'],heating:'left',socketPositions:['L1','L3'],wallLights:['R2'],outsideLight:'both',outsideSocket:'double-both',outsideTap:'both'});
    const model=buildGeometry(result.config,{fixtureLayout:result.fixtureLayout,scope:result.scope});
    for(const fixture of model.fixtures){
        let expected;
        if(fixture.id.startsWith('ceiling-'))expected=result.fixtureLayout.ceilingPositions[fixture.id.slice(8)];
        else if(fixture.id.startsWith('spot-'))expected=result.fixtureLayout.spotPositions[fixture.id.slice(5)];
        else if(fixture.id.startsWith('socket-'))expected=result.fixtureLayout.wallPositions[fixture.id.slice(7)].socket;
        else if(fixture.id.startsWith('wall-light-'))expected=result.fixtureLayout.wallPositions[fixture.id.slice(11)].light;
        else if(fixture.key==='heating')expected=result.fixtureLayout.heating[fixture.side];
        else if(fixture.room==='outside'){
            const item=result.fixtureLayout.exterior[fixture.side];
            expected=item[{outsideLight:'light',outsideSocket:'socket',outsideTap:'tap'}[fixture.key]];
            assert.equal(fixture.rotation,item.rotation);assert.equal(fixture.surface,item.surface);
        }
        if(expected)close(fixture.position,expected.map(value=>value/100),fixture.id);
    }
    const changed=buildGeometry({...result.config,width:750},{fixtureLayout:result.fixtureLayout});
    assert.equal(changed.fixtureLayout.basis.width,750);
    assert.notDeepEqual(changed.fixtureLayout.ceilingPositions,result.fixtureLayout.ceilingPositions);
});

test('exterior electric fittings align and the water point stays toward the corner with side identity',()=>{
    for(const width of [150,500,750]){
        const model=buildGeometry({width,depth:100,frontOpening:width===150?'none':'folding-white',drainSide:'both',outsideLight:'both',outsideSocket:'double-both',outsideTap:'both'});
        for(const side of ['left','right']){
            const get=key=>model.fixtures.find(f=>f.key===key&&f.side===side);
            const lamp=get('outsideLight'),socket=get('outsideSocket'),tap=get('outsideTap');
            close([lamp.position[0],lamp.position[2]],[socket.position[0],socket.position[2]]);
            // Either a separate tap axis 35 cm toward the corner, or a vertical stack on one front axis.
            const stacked=tap.surface==='front'&&Math.abs(tap.position[0]-socket.position[0])<1e-8;
            // The customer's rule, in every tier: the socket ABOVE the tap ("prizler musluğun altında olmamalı,
            // yukarısında olmalı"), and the tap at one height whatever the width ("musluk yerinde sabit durur").
            assert.ok(socket.position[1]>tap.position[1]+.35-1e-8,`${width} ${side}: the socket sits above the tap`);
            assert.ok(Math.abs(tap.position[1]-EXTERIOR_HEIGHTS_CM.tap/100)<1e-9,`${width} ${side}: the tap stays at ${EXTERIOR_HEIGHTS_CM.tap} cm`);
            assert.ok(Math.abs(socket.position[1]-EXTERIOR_HEIGHTS_CM.socket/100)<1e-9,`${width} ${side}: the socket stays at ${EXTERIOR_HEIGHTS_CM.socket} cm`);
            if(!stacked)assert.ok(Math.hypot(socket.position[0]-tap.position[0],socket.position[2]-tap.position[2])>=.35-1e-8);
            if(tap.surface==='front'){if(!stacked)assert.ok(Math.abs(tap.position[0])>Math.abs(socket.position[0]));}
            else {assert.equal(tap.surface,side);assert.ok(tap.position[2]>socket.position[2]);}
        }
    }
});

test('widening or narrowing the aanbouw never moves the tap up or down, in any tier',()=>{
    // The report: "prefabrik genişletilince musluk aşağı kayıyor, daraltılınca yukarı çıkıyor". Every catalogue
    // width from 150 to 750 in 10 cm steps, both sides, with and without a downpipe on the side: one tap height.
    const heights=new Set(),sockets=new Set(),tiers=new Set();
    for(let width=150;width<=750;width+=10)for(const drainSide of ['left','right','both']){
        const model=buildGeometry({width,depth:300,frontOpening:width<200?'none':'folding-white',drainSide,outsideSocket:'double-both',outsideTap:'both'});
        for(const tap of model.fixtures.filter(f=>f.key==='outsideTap')){
            heights.add(+tap.position[1].toFixed(4));
            const socket=model.fixtures.find(f=>f.key==='outsideSocket'&&f.side===tap.side);
            if(socket){sockets.add(+socket.position[1].toFixed(4));tiers.add(tap.surface+(Math.abs(tap.position[0]-socket.position[0])<1e-8?'-stacked':''));}
        }
    }
    assert.deepEqual([...heights],[EXTERIOR_HEIGHTS_CM.tap/100],'one tap height across every width and tier');
    assert.deepEqual([...sockets],[EXTERIOR_HEIGHTS_CM.socket/100],'one socket height across every width and tier');
    assert.ok(tiers.size>=2,`the sweep really crosses a tier boundary (${[...tiers].join(', ')})`);
});

test('odd centimetre dimensions retain the server override and its administrative clearance',()=>{
    const results=python(`from services.catalog import default_release,release_context
from services.pricing import price_config
release=default_release()
release['catalog']['geometryRules']['clearanceCm'].update(roof=20,wallEdge=12)
with release_context(release):
    results=[price_config(config) for config in json.load(sys.stdin)]
print(json.dumps(results))`,[{width:301,depth:299,rooflight:'lean-1',frontOpening:'none',interior:true,ceilingPositions:['left']},{width:251,depth:271,rooflight:'lean-1',frontOpening:'none',interior:true,ceilingPositions:['left']}]);
    // The administrative roof clearance moves the pendant strip further from the rooflight, so a local recomputation differs.
    for(const result of results){
        const model=buildGeometry(result.config,{fixtureLayout:result.fixtureLayout});
        assert.equal(model.fixtureLayout,result.fixtureLayout,'valid server packet must be retained');
        close(model.fixtures.find(f=>f.id==='ceiling-left').position,result.fixtureLayout.ceilingPositions.left.map(v=>v/100));
        assert.notDeepEqual(buildFixtureLayout(result.config).ceilingPositions,model.fixtureLayout.ceilingPositions);
    }
});

test('floor plan and print use the shared bounded route and respect illustrative visibility',()=>{
    const model=buildGeometry({width:150,depth:100,frontOpening:'none',interior:true,underfloorHeating:true});
    assert.equal(model.underfloorLoops.length,1);
    for(const [x,y,z] of model.underfloorLoops[0]){
        assert.ok(x>model.bounds.left+model.wall&&x<model.bounds.right-model.wall);
        assert.ok(z>model.bounds.back&&z<model.bounds.front-model.wall);
        assert.equal(y,.098);
    }
    const representative=[{key:'underfloorHeating',visualMode:'preparation',productIncluded:false,components:[{role:'preparation',status:'extra'}]}];
    assert.match(planSvg(model,false,{scope:representative,examplesVisible:true}),/data-underfloor-loop/);
    assert.doesNotMatch(planSvg(model,false,{scope:representative,examplesVisible:false}),/data-underfloor-loop/);
    const included=[{key:'underfloorHeating',visualMode:'product',productIncluded:true}];
    assert.match(planSvg(model,false,{scope:included,examplesVisible:false}),/data-underfloor-loop/);
    assert.match(documentPlanSvg(model,{scope:representative}),/data-underfloor-loop/);
    assert.doesNotMatch(documentPlanSvg(model,{scope:[{key:'underfloorHeating',visualMode:'none'}]}),/data-underfloor-loop/);
    assert.equal(buildGeometry({interior:false,underfloorHeating:true}).underfloorLoops.length,0);
});

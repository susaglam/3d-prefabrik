import test from 'node:test';
import assert from 'node:assert/strict';
import {documentConfigKey} from '../../addons/cs_prefab_configurator/static/src/document_capture.js';
import {buildGeometry,documentPlanSvg,elevationSvg} from '../../addons/cs_prefab_configurator/static/src/geometry.js';

test('document identity is deterministic and excludes contact postcode without mutating configuration',()=>{
    const config={width:620,depth:320,interior:true,facade:'pvc-green',postcode:'1234 AB'};
    const before=JSON.stringify(config);
    assert.equal(documentConfigKey(config),'{"depth":320,"facade":"pvc-green","interior":true,"width":620}');
    assert.equal(documentConfigKey(config),documentConfigKey({postcode:'9999 ZZ',facade:'pvc-green',depth:320,width:620,interior:true}));
    assert.notEqual(documentConfigKey(config),documentConfigKey({...config,width:621}));
    assert.equal(JSON.stringify(config),before);
});

test('print floor plan keeps actual dimensions, area, opening and all rooflight panels',()=>{
    const svg=documentPlanSvg(buildGeometry({width:620,depth:320,frontOpening:'sliding-4-white',rooflight:'gable-8'}));
    assert.match(svg,/620 cm/);assert.match(svg,/320 cm/);assert.match(svg,/19,84 m²/);
    assert.equal((svg.match(/data-rooflight-panel=/g)||[]).length,8);
    assert.match(svg,/4 panelen in de voorpui/);assert.match(svg,/BESTAANDE WONING/);assert.match(svg,/TUINZIJDE/);
    assert.doesNotMatch(svg,/<image|href=|NaN|Infinity/);
});

test('front elevation follows chosen frame divisions, aperture size, drain and exterior connections',()=>{
    const m=buildGeometry({width:620,depth:320,frontOpening:'sliding-4-white',rooflight:'gable-8',drainSide:'left',outsideLight:'both'});
    const svg=elevationSvg(m,'front');
    assert.equal((svg.match(/data-front-panel=/g)||[]).length,4);
    assert.match(svg,/data-dimension="620 cm"/);assert.match(svg,/data-dimension="280 cm"/);assert.match(svg,/data-dimension="440 cm"/);
    assert.match(svg,/data-drain-side="left"/);
    assert.equal((svg.match(/data-connection="lighting-conduit"/g)||[]).length,2);
    assert.match(svg,/stroke="#efede6"/);
    // "Geen kozijn" draws the rough opening with its outer frame only: the aperture is dimensioned, nothing is divided.
    const skeleton=elevationSvg(buildGeometry({width:500,frontOpening:'none'}));
    assert.doesNotMatch(skeleton,/data-front-panel=/);
    assert.match(skeleton,/data-skeleton-opening="true"/);
    assert.match(skeleton,/stroke="#303432"/);
    assert.match(skeleton,/data-dimension="320 cm"/);
    assert.match(documentPlanSvg(buildGeometry({width:500,frontOpening:'none'})),/data-skeleton-opening="true"/);
    assert.doesNotMatch(documentPlanSvg(buildGeometry({width:500,frontOpening:'none'})),/data-plan-panel=/);
});

/*
 * 2.17.0: the drawings read the same section layout as the 3D and the option icons (geometry.js openingLayout, from
 * the customer's reference renders). The owner: "tüm çerçeveleri hem çizim olarak hem de görsel olarak elden geçir".
 */
const planRoles=svg=>[...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="[\d.]+" data-plan-panel="(\d+)" data-plan-role="(\w+)"/g)].map(([,y,index,role])=>({y:+y,index:+index,role}));
test('the plan draws each kozijn as built: a sliding leaf on the inner track, a door swinging OUT from its hinge',()=>{
    const plan=frontOpening=>documentPlanSvg(buildGeometry({width:600,depth:300,frontOpening}));
    for(const [frontOpening,roles] of [['sliding-2-black',['sliding','fixed']],['sliding-4-white',['fixed','sliding','sliding','fixed']],
        ['folding-black',['folding','folding','folding','folding','door']],['french-black',['fixed','door','door','fixed']]]){
        assert.deepEqual(planRoles(plan(frontOpening)).map(p=>p.role),roles,frontOpening);
    }
    // A sliding leaf runs behind the fixed pane, on the room side of the frame line.
    const [leaf,fixed]=planRoles(plan('sliding-2-black'));
    assert.ok(leaf.y<fixed.y,'the sliding leaf is drawn on the inner track');
    // Only a door swings, into the garden (larger y), from the hinge the layout names; nothing gets a travel arrow.
    for(const [frontOpening,hinges] of [['sliding-2-black',[]],['sliding-4-white',[]],['folding-black',['right']],['french-black',['left','right']]]){
        const svg=plan(frontOpening),arcs=[...svg.matchAll(/data-door-swing="(\d+)" data-hinge="(\w+)" d="M([\d.]+) ([\d.]+)V([\d.]+)/g)];
        assert.deepEqual(arcs.map(arc=>arc[2]),hinges,frontOpening);
        for(const [, , , , y, end] of arcs)assert.ok(+end>+y,`${frontOpening}: the door opens outward`);
        assert.doesNotMatch(svg,/marker-end=/);
        // The width dimension moves out past the swings instead of running through them.
        const swing=Math.max(0,...arcs.map(arc=>+arc[5])),dimension=+/data-dimension="600 cm"><path d="M[\d.]+ [\d.]+V[\d.]+ M[\d.]+ [\d.]+V[\d.]+ M[\d.]+ ([\d.]+)H/.exec(svg)[1];
        assert.ok(dimension-45>swing,`${frontOpening}: dimension at ${dimension}, swing to ${swing}`);
        assert.match(svg,/TUINZIJDE/);
    }
});
test('the front elevation shows how each section opens, its grille, its handle and its roedes, as on the reference',()=>{
    const front=frontOpening=>elevationSvg(buildGeometry({width:600,depth:300,frontOpening}),'front');
    const french=front('french-bars-white');
    // A swing door's triangle points at its hinge; drawn solid, because it opens toward the viewer in the garden.
    assert.deepEqual([...french.matchAll(/data-front-swing="(\d+)" data-hinge="(\w+)"/g)].map(match=>[+match[1],match[2]]),[[1,'left'],[2,'right']]);
    assert.doesNotMatch(french.match(/<path data-front-swing[^>]*>/g).join(''),/stroke-dasharray/);
    assert.deepEqual([...french.matchAll(/data-front-grille="(\d+)"/g)].map(match=>+match[1]),[0,3],'grilles on the side lights only');
    assert.deepEqual([...french.matchAll(/data-front-handle="(\d+)" data-handle="(\w+)"/g)].map(match=>[+match[1],match[2]]),[[2,'lever']]);
    assert.equal((french.match(/data-front-bar=/g)||[]).length,3*4,'three horizontal roedes per pane');
    assert.doesNotMatch(front('french-white'),/data-front-bar=/);
    // A schuifpui's sliding leaves carry an arrow toward where they park; a fixed pane carries nothing.
    const sliding=front('sliding-4-white');
    assert.deepEqual([...sliding.matchAll(/data-front-slide="(\d+)" data-opens="(\w+)"/g)].map(match=>[+match[1],match[2]]),[[1,'left'],[2,'right']]);
    assert.deepEqual([...sliding.matchAll(/data-front-grille="(\d+)"/g)].map(match=>+match[1]),[0,3]);
    assert.doesNotMatch(sliding,/data-front-swing=/);
    // A harmonicapui: only the loopdeur swings, the grille is on the loopdeur, two flush pulls where it meets the set.
    const folding=front('folding-white');
    assert.deepEqual([...folding.matchAll(/data-front-swing="(\d+)"/g)].map(match=>+match[1]),[4]);
    assert.deepEqual([...folding.matchAll(/data-front-grille="(\d+)"/g)].map(match=>+match[1]),[4]);
    assert.deepEqual([...folding.matchAll(/data-front-handle="(\d+)" data-handle="(\w+)"/g)].map(match=>[+match[1],match[2]]),[[3,'pull'],[4,'pull']]);
});

test('right side elevation dimensions the depth and preserves the real lean or gable profile',()=>{
    for(const kind of ['lean-4','gable-8']) {
        const svg=elevationSvg(buildGeometry({width:620,depth:320,rooflight:kind}),'side');
        assert.match(svg,/data-dimension="320 cm"/);assert.match(svg,/data-dimension="280 cm"/);
        assert.match(svg,new RegExp(`data-rooflight-profile="${kind.split('-')[0]}"`));
        assert.doesNotMatch(svg,/data-front-panel=/);
        assert.match(svg,/Rechter zijgevel/);
    }
    assert.throws(()=>elevationSvg(buildGeometry(),'back'),/Unknown elevation/);
});

test('technical exports remain finite at minimum and maximum accepted dimensions',()=>{
    for(const [width,depth] of [[150,100],[150,340],[750,100],[750,340]]) {
        const model=buildGeometry({width,depth,rooflight:'gable-8',frontOpening:'french-bars-white'});
        for(const svg of [documentPlanSvg(model),elevationSvg(model),elevationSvg(model,'side')]) {
            assert.doesNotMatch(svg,/NaN|Infinity|undefined|<script/);
            assert.match(svg,/width="1440" height="960"/);
        }
        assert.match(documentPlanSvg(model),new RegExp(`data-dimension="${width} cm"`));
        assert.match(elevationSvg(model,'side'),new RegExp(`data-dimension="${depth} cm"`));
    }
});

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
    const closed=elevationSvg(buildGeometry({frontOpening:'none'}));
    assert.doesNotMatch(closed,/data-front-panel=/);
});

test('sliding and folding plans retain closed panels without inventing an opening direction',()=>{
    for(const [frontOpening,count] of [['sliding-2-black',2],['sliding-4-white',4],['folding-black',4]]) {
        const svg=documentPlanSvg(buildGeometry({frontOpening}));
        assert.equal((svg.match(/data-plan-panel=/g)||[]).length,count);
        assert.doesNotMatch(svg,/data-door-swing=|marker-end=|l-10 -6m10 6l-10 6/);
    }
    assert.equal((documentPlanSvg(buildGeometry({frontOpening:'french-black'})).match(/data-door-swing=/g)||[]).length,2);
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

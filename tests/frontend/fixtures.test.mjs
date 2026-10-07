import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureAppearance,buildFixture,buildPreparation,buildUnderfloorHeating,underfloorAppearance} from '../../addons/cs_prefab_configurator/static/src/fixtures.js';
import {visibleLightEffectCount} from '../../addons/cs_prefab_configurator/static/src/render_state.js';
import {buildGeometry,elevationSvg} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

test('examples visibility does not remove a supplied product or change scope',()=>{
    const scope=[{key:'heating',productIncluded:true,components:[{role:'product',status:'included',total:0}]}];
    const before=JSON.stringify(scope);
    assert.equal(fixtureAppearance(scope,'heating',false).visible,true);
    assert.equal(fixtureAppearance(scope,'heating',false).mode,'included');
    assert.equal(fixtureAppearance([], 'heating',false).visible,false);
    assert.equal(JSON.stringify(scope),before);
});

test('preparation is independent of the illustrative device and unknown scope never promises delivery',()=>{
    const scope=[{key:'outsideTap',productIncluded:false,components:[{role:'preparation',status:'extra'},{role:'product',status:'excluded'}]}];
    assert.deepEqual(fixtureAppearance(scope,'outsideTap',false),{mode:'representative',visible:false,preparation:true,fidelity:'indicative',assetKey:'outsideTap',resolved:true});
    assert.equal(fixtureAppearance([], 'outsideTap').mode,'representative');
});

test('admin preparation-only and hidden presentation preserve the commercial product scope',()=>{
    for(const visualMode of ['preparation','none']){
        const scope=[{key:'heating',productIncluded:true,visualMode,components:[{role:'preparation',status:'included'},{role:'product',status:'included'}]}];
        const appearance=fixtureAppearance(scope,'heating',true);
        assert.equal(appearance.mode,visualMode);assert.equal(appearance.visible,false);
        assert.equal(appearance.preparation,visualMode==='preparation');
        assert.equal(scope[0].productIncluded,true);
    }
});

test('fixed fixture geometry retains its dimensions when the structure widens',()=>{
    const material=(_key,options,type)=>type==='line'?new THREE.LineBasicMaterial(options):new THREE.MeshStandardMaterial(options);
    const configs=[{width:300,depth:300},{width:750,depth:340}];
    const fixtures=configs.map(config=>buildGeometry({...config,interior:true,heating:'left'}).fixtures.find(x=>x.key==='heating'));
    const sizes=fixtures.map(f=>{const group=buildFixture(f,fixtureAppearance([],f.key),material);group.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(group);return bounds.getSize(new THREE.Vector3());});
    assert.ok(sizes[0].distanceTo(sizes[1])<1e-9);
    // The example radiator is 90 cm of panel plus its valves since 2.10.0 (it was a 1,64 m column that blocked the
    // wall-light slot above it). Its reach must stay below that slot: 185 cm minus the lamp's own half-height.
    assert.ok(sizes[0].y>.9&&sizes[0].y<1.05,`radiator height ${sizes[0].y.toFixed(3)} m`);
    const top=fixtures[0].position[1]+new THREE.Box3().setFromObject(buildFixture(fixtures[0],fixtureAppearance([],'heating'),material)).max.y-fixtures[0].position[1];
    assert.ok(top<1.85-.085-.05,`the radiator's top (${top.toFixed(3)} m) stays clear of the 185 cm wall-light slot`);
    assert.notEqual(fixtures[0].position[0],fixtures[1].position[0]);
});

test('new rooflight counts, paired drains and explicit fitting positions survive geometry',()=>{
    for(const code of ['lean-5','gable-2','gable-10'])assert.equal(buildGeometry({rooflight:code}).rooflight.panels.length,Number(code.split('-')[1]));
    const m=buildGeometry({interior:true,drainSide:'both',outsideSocket:'double-both',ceilingPositions:['left','right'],spotPositions:['r1c1','r3c5'],socketPositions:['L1','R2'],wallLights:['R1'],overhang:'pvc-white',overhangSpots:3});
    assert.deepEqual(m.drains.map(x=>x.side),['left','right']);
    assert.equal(m.fixtures.filter(x=>x.double).length,2);
    assert.equal(m.fixtures.filter(x=>x.key==='ceilingLights').length,2);
    assert.equal(m.fixtures.filter(x=>x.key==='overhangSpots').length,3);
    assert.equal(m.fixtures.find(x=>x.id==='socket-L1').rotation,Math.PI/2);
    assert.equal(m.fixtures.find(x=>x.id==='socket-R2').rotation,-Math.PI/2);
});

test('example fixtures render as real devices with shadows, identical to supplied ones, and hide only through the examples toggle',()=>{
    const material=(_key,options,type)=>type==='line'?new THREE.LineBasicMaterial(options):type==='flat'?new THREE.MeshBasicMaterial(options):new THREE.MeshStandardMaterial(options);
    const signature=group=>{const rows=[];group.traverse(object=>{if(object.isMesh&&!object.userData.lightEffect)rows.push([object.geometry.type,object.material.color.getHexString(),object.material.roughness,object.material.metalness]);});return rows;};
    for(const kind of ['radiator','tap','socket','switch','dimmer','wall-light','spot','pendant']){
        const fixture={id:kind,key:kind,kind,position:[0,0,0],rotation:0};
        const example=buildFixture(fixture,fixtureAppearance([],kind),material);
        const parts=[];example.traverse(object=>{if(object.isMesh||object.isLineSegments)parts.push(object);});
        assert.ok(parts.length>0&&parts.every(object=>object.isMesh&&!object.userData.contourSilhouette),`${kind}: no contour strokes`);
        for(const object of parts.filter(object=>!object.userData.lightEffect))assert.ok(object.material.colorWrite!==false&&object.castShadow&&object.receiveShadow,`${kind}: example device is a real lit surface`);
        assert.equal(example.visible,true);assert.equal(example.userData.visualMode,'representative');
        assert.equal(buildFixture(fixture,fixtureAppearance([],kind,false),material).visible,false,`${kind}: hidden with examples off`);
        const included=buildFixture(fixture,fixtureAppearance([{key:kind,productIncluded:true}],kind,false),material);
        assert.equal(included.visible,true);assert.equal(included.userData.visualMode,'included');
        assert.deepEqual(signature(example),signature(included),`${kind}: example and supplied device share one appearance`);
    }
});

const renderMaterial=(_key,options,type)=>type==='line'?new THREE.LineBasicMaterial(options):type==='flat'?new THREE.MeshBasicMaterial(options):new THREE.MeshStandardMaterial(options);

test('radiator preparation exposes two lower pipe connections on either wall, independently of example devices',()=>{
    for(const assetKey of ['heating','heating-panel'])for(const side of ['left','right']){
        const fixture=buildGeometry({interior:true,heating:side}).fixtures.find(f=>f.key==='heating');
        const scope=[{key:'heating',assetKey,components:[{role:'preparation',status:'included'},{role:'product',status:'excluded'}]}];
        const appearance=fixtureAppearance(scope,'heating',false);
        const preparation=buildPreparation(fixture,appearance,renderMaterial);
        assert.equal(buildFixture(fixture,appearance,renderMaterial).visible,false);
        assert.equal(preparation.visible,true);assert.equal(preparation.userData.preparationKind,'heating-pipes');
        const pipes=preparation.children.filter(part=>part.geometry.type==='TubeGeometry');
        assert.equal(pipes.length,2);
        const pipeBounds=pipes.map(pipe=>new THREE.Box3().setFromObject(pipe));
        assert.ok(pipeBounds[0].max.x<pipeBounds[1].min.x,'separate flow and return connections');
        for(const part of preparation.children){
            part.geometry.computeBoundingBox();
            assert.ok(part.geometry.boundingBox.max.y+part.position.y<-.28,'all preparation remains below the radiator centre');
        }
        preparation.updateMatrixWorld(true);
        const worldBounds=new THREE.Box3().setFromObject(preparation);
        assert.ok(worldBounds.min.y>.09,'connections stay above the floor');
        if(side==='left')assert.ok(worldBounds.min.x>=fixture.position[0]-.003);
        else assert.ok(worldBounds.max.x<=fixture.position[0]+.003);
        assert.equal(buildPreparation(fixture,fixtureAppearance([{...scope[0],visualMode:'none'}],'heating'),renderMaterial).visible,false);
    }
});

test('light effects remain within the fitting aperture and disappear with hidden or preparation-only devices',()=>{
    for(const [kind,assetKey] of [['wall-light','wallLights'],['spot','spotlights'],['pendant','ceilingLights'],['pendant','ceiling-dome']]){
        const fixture={id:assetKey,key:assetKey,kind,position:[0,0,0],rotation:0};
        const variants=[false,true].map(productIncluded=>buildFixture(fixture,fixtureAppearance([{key:assetKey,assetKey,productIncluded}],assetKey),renderMaterial));
        const alpha=[];
        for(const group of variants){
            const effects=[],bodies=[];
            group.traverse(part=>{assert.equal(!!part.isLight,false,'optical effects do not add renderer lights');if(part.userData.lightEffect)effects.push(part);else if(part.isMesh&&!part.userData.contourSilhouette)bodies.push(part);});
            assert.ok(effects.length>0);
            const bounds=new THREE.Box3();for(const body of bodies)bounds.union(new THREE.Box3().setFromObject(body));bounds.expandByScalar(.008);
            for(const effect of effects){
                assert.equal(effect.castShadow,false);assert.equal(effect.material.depthWrite,false);assert.equal(effect.material.depthTest,true);
                assert.ok(bounds.containsBox(new THREE.Box3().setFromObject(effect)),'glow is confined to the physical fitting');
                const colour=effect.geometry.attributes.color;
                const opacities=Array.from({length:colour.count},(_,i)=>colour.getW(i));
                assert.equal(Math.min(...opacities),0,'glow fades completely at its edge');
                assert.ok(Math.max(...opacities)<=.25);alpha.push(Math.max(...opacities));
            }
        }
        assert.ok(alpha[0]<alpha.at(-1),'representative optical effect is quieter than the supplied diffuser');
        let emissive=0;variants[1].traverse(part=>{if(part.material?.emissiveIntensity>0&&part.material?.emissive?.getHex())emissive++;});assert.ok(emissive>0);
        for(const visualMode of ['none','preparation']){
            const hidden=buildFixture(fixture,fixtureAppearance([{key:assetKey,productIncluded:true,visualMode}],assetKey),renderMaterial);
            assert.equal(visibleLightEffectCount(hidden),0);
        }
        const hiddenExample=buildFixture(fixture,fixtureAppearance([],assetKey,false),renderMaterial);
        assert.equal(visibleLightEffectCount(hiddenExample),0);
    }
});

test('underfloor schematic follows shared floor geometry and obeys preparation, supply and example visibility',()=>{
    const config={width:500,depth:300,interior:true,underfloorHeating:true};
    const model=buildGeometry(config),scope=[{key:'underfloorHeating',visualMode:'preparation',components:[{role:'preparation',status:'included'}]}];
    const before=JSON.stringify(scope),group=buildUnderfloorHeating(model,underfloorAppearance(scope),renderMaterial);
    assert.equal(group.visible,true);assert.equal(group.userData.schematic,true);
    const routes=group.children.filter(part=>part.userData.floorHeatingLoop);
    assert.equal(routes.length,model.underfloorLoops.length);assert.ok(routes.length>0);
    for(const [index,route] of routes.entries()){
        assert.equal(route.isLine,true);assert.equal(route.castShadow,false);
        const positions=route.geometry.attributes.position;assert.equal(positions.count,model.underfloorLoops[index].length);
        for(let i=0;i<positions.count;i++){
            assert.ok(Math.abs(positions.getY(i)-.098)<1e-6);
            assert.ok(positions.getX(i)>model.bounds.left+model.wall&&positions.getX(i)<model.bounds.right-model.wall);
            assert.ok(positions.getZ(i)>model.bounds.back&&positions.getZ(i)<model.bounds.front-model.wall);
            assert.ok(new THREE.Vector3().fromBufferAttribute(positions,i).distanceTo(new THREE.Vector3(...model.underfloorLoops[index][i]))<1e-6);
        }
    }
    const area=group.children.find(part=>part.userData.floorPreparationArea);assert.ok(area.material.transparent&&area.material.opacity<.15&&!area.material.depthWrite);
    assert.equal(buildUnderfloorHeating(model,underfloorAppearance(scope,false),renderMaterial).visible,false);
    assert.equal(underfloorAppearance([{key:'underfloorHeating',productIncluded:true,visualMode:'product'}],false).visible,true);
    assert.equal(underfloorAppearance([{key:'underfloorHeating',productIncluded:true,visualMode:'none'}]).visible,false);
    for(const change of [{interior:false},{underfloorHeating:false}])assert.equal(buildUnderfloorHeating(buildGeometry({...config,...change}),underfloorAppearance(scope),renderMaterial).visible,false);
    assert.equal(JSON.stringify(scope),before);
});

test('rollaag panel sits only above the front frame, is omitted for masonry, and does not wait for a kozijn',()=>{
    const omitted=buildGeometry({rollaag:'masonry'});
    const legacy=buildGeometry({rollaag:'panel-black',rollaagEnabled:false});
    assert.equal(Object.hasOwn(legacy,'rollaagEnabled'),false,'the retired toggle no longer reaches the geometry model');assert.equal(legacy.rollaag,'panel-black');
    for(const view of ['front','side'])assert.doesNotMatch(elevationSvg(omitted,view),/data-rollaag=/);
    assert.match(elevationSvg(legacy,'front'),/data-rollaag="panel-black"/);
    assert.doesNotMatch(elevationSvg(legacy,'side'),/data-rollaag=/,'A panel above the frame is not visible on the side facade');
    // 2.17.0: "geen kozijn" still leaves the hole and its outer frame, and since 2.16.0 it is the choice the design
    // STARTS on — with the Rollaag card before the Kozijn card. Until now the panel waited for a door with leaves, so
    // the owner chose "geen rollaag wit" and the drawing kept showing brick until the next card was touched.
    assert.match(elevationSvg(buildGeometry({rollaag:'panel-black',frontOpening:'none'}),'front'),/data-rollaag="panel-black"/);
    const panel=/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*data-rollaag/.exec(elevationSvg(legacy,'front'));
    const frame=/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*fill="#dce8e4"/.exec(elevationSvg(legacy,'front'));
    assert.ok(panel&&frame,'panel and frame rectangles are drawn');
    assert.ok(Math.abs(Number(panel[1])-Number(frame[1]))<1&&Math.abs(Number(panel[2])-Number(frame[2]))<1,'panel spans exactly the frame width');
});

test('the daktrim caps a flush roof, while an overstek band carries the roof 20 cm past the garden side only',()=>{
    const plain=buildGeometry({overhang:'none',overhangSpots:3}),extended=buildGeometry({overhang:'pvc-white',overhangSpots:3});
    assert.equal(plain.overhangDepth,0);assert.equal(plain.fasciaHeight,0);assert.equal(extended.overhangDepth,.20);assert.equal(extended.fasciaHeight,.32);
    const slab=plain.roof[0],longer=extended.roof[0];
    assert.ok(slab.size[0]<plain.width&&slab.size[0]>plain.width-.05&&slab.size[2]<plain.depth,'without an overstek the slab hides just inside the facade');
    assert.ok(longer.size[0]<extended.width&&longer.size[0]>extended.width-.08,'the slab never projects over the neighbours');
    assert.ok(Math.abs((longer.center[2]+longer.size[2]/2)-(extended.bounds.front+.20-.035))<1e-9,'the slab reaches the inner face of the front board');
    assert.ok(Math.abs(longer.center[2]-longer.size[2]/2-extended.bounds.back)<1e-9,'nothing projects at the house');
    const withLight=buildGeometry({overhang:'wood-white',rooflight:'lean-2'});
    const front=withLight.roof.find(part=>part.key==='roof-front'),left=withLight.roof.find(part=>part.key==='roof-left');
    assert.ok(Math.abs((front.center[2]+front.size[2]/2)-(withLight.bounds.front+.165))<1e-9);
    assert.ok(left.center[0]-left.size[0]/2>withLight.bounds.left,'side parts stay inside the side walls');
    // Spots hang from the soffit of the band; the downpipe goes up into the soffit (2.18.3: inside, under the
    // overstek), or without one hangs from its hopper under the daktrim (2.17.0).
    const spot=extended.fixtures.find(f=>f.key==='overhangSpots');
    assert.ok(Math.abs(spot.position[1]-(extended.height+.08-.32-.004))<1e-9);assert.ok(Math.abs(spot.position[2]-(extended.bounds.front+.10))<1e-9);
    assert.equal(plain.fixtures.filter(f=>f.key==='overhangSpots').length,0);
    assert.ok(Math.abs(extended.drain.height-(extended.height+.08-.32))<1e-9);assert.ok(Math.abs(plain.drain.height-plain.drain.hopper.bottom)<1e-9);
    assert.ok(plain.drain.hopper.bottom>2,'the hopper hangs well above the wall light (top 1,985 m)');
    for(const view of ['front','side']){
        assert.match(elevationSvg(extended,view),/data-overhang="pvc-white"/);assert.match(elevationSvg(extended,view),/data-roof-edge=/);
        assert.doesNotMatch(elevationSvg(plain,view),/data-overhang=/);assert.match(elevationSvg(plain,view),/data-roof-edge=/);
    }
});

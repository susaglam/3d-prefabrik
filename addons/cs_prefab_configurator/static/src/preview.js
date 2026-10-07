import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { HDRLoader } from '../vendor/HDRLoader.js';
import { EffectComposer, RenderPass, GTAOPass, OutputPass } from '../vendor/render-addons.module.js';
import { buildGeometry, planSvg, DAKTRIM_FACE, HOPPER, KOZIJN, kozijnProfile, sectionMembers } from './geometry.js';
import { buildFixture, fixtureAppearance, buildPreparation, buildUnderfloorHeating, underfloorAppearance } from './fixtures.js';
import { sceneChange, canonicalFixtureKey, visibleLightEffectCount, renderTier } from './render_state.js';
import { profileGeometry, metricUVs, softPad, ROOF_RECESS, TRIM_REACH, DOWNPIPE, downpipeRoute, roundedRoute, pipeGeometries, SPOUT } from './architectural_details.js';
import { FENCE_STYLE_IDS, DEFAULT_FENCE_STYLE, FENCE_HEIGHT, HEDGE, fencePanels, mergedBoxes, modernPanelParts, hedgeLeaves, classicPanelParts, occludingPanels, seeded } from './garden_fence.js';
import { normalizeEnvironment, sceneEnvironmentKey, houseLayout } from './environment.js';
import { finishColor, shadeHex } from './finishes.js';
import { DOCUMENT_PARTS, normalizeDocumentParts } from './scene_content.js';
import { KOZIJN_MOTION, OPERABLE, easeInOut, sectionPoses } from './kozijn_motion.js';

/**
 * Which scanned albedo answers for which facade finish (`this.maps` key). The three non-red bricks are recoloured
 * from the red scan and the wood finishes all share one retoned board scan, so a finish that is missing here — pvc,
 * stucwerk — is a genuinely flat coated surface and keeps the canvas pattern of facadeTexture().
 */
const FACADE_SCANS = {
    'brick-red':'brickColor','brick-black':'brickBlackColor','brick-white':'brickWhiteColor','brick-yellow':'brickYellowColor',
    'wood-horizontal':'woodColor','wood-vertical':'woodColor','open-horizontal':'woodColor','open-vertical':'woodColor',
};

const PALETTE = {
    // Shown until the scan arrives: tones of the lighter red clay (2.17.0), so the wall does not jump when it loads.
    'brick-red':['#b4877a','#c49686','#a07465','#cba091'],
    'brick-black':['#494b44','#55574f','#41443e','#66635b'],
    'brick-white':['#dfdbcf','#eae6dd','#d6d2c7','#d0cbbb'],
    'brick-yellow':['#c8ae76','#d4bc88','#bda06a','#d7c494'],
    'pvc-black':'#323632','pvc-green':'#425448','pvc-cream':'#dbd5bd','pvc-anthracite':'#4b514e',
};

/**
 * outdoor_table_chair_set_01, as this scene re-lays it out on the terrace: a folding teak-slat table with an
 * anthracite steel frame and three folding chairs around it — the bistro set every Dutch garden centre sells.
 *
 * Poly Haven publishes it as a STYLED arrangement: the table and a chair baked at casual angles, in one scene. A
 * chair therefore cannot simply be cloned into place, it has to be turned back square first, and `yaw` is that
 * rotation (recovered by minimising the footprint area over a 0.25° sweep in .data/measure_outdoor_set.mjs; the
 * chair's own axes are 8.5° off world z). Everything else about the pose — where the footprint centre sits, where
 * the feet are — is measured off the loaded geometry at runtime, so only a change in how the model is ORIENTED can
 * invalidate these two numbers, not a change in where its origin is.
 *
 * The cushion planes come from the same script's plane fit over the canonical chair: the seat slats top out at
 * y 0.397 over z −0.019…0.280, and the backrest is a 26 mm slat plane z = 0.067 − 0.396·y — a 21.6° lean — running
 * from y 0.559 to y 0.859. Each pad is offset half its own thickness plus half a slat along that plane's normal, so
 * it rests ON the chair rather than in it. Fitting the plane rather than eyeballing two bands matters: the first
 * pass read the lean as 18° off two coarse bands and the back cushion visibly floated free of the backrest.
 */
const GARDEN_SET = {
    model:'outdoor_table_chair_set_01',
    table:{node:'outdoor_table_chair_set_01_table',yaw:0},
    chair:{node:'outdoor_table_chair_set_01_chair_02',yaw:.1489},
    seat:{y:.385,z:.1305,width:.37,depth:.28,thickness:.055},
    back:{y:.7176,z:-.1917,width:.32,height:.24,thickness:.05,tilt:Math.PI/2-.377},
    // Chair centre distance from the table centre. 0.72 m leaves a 12 cm gap between the table edge and the chair,
    // and with the nudges below the set still ends ~1,02 m past its own centre.
    ring:.72,
    // Table centre from the building line (2.13.1; was 0,95). Seen from the garden cameras a set right in front of
    // the pui covered the foot of the aanbouw; this far out, the table stands 1,6 m clear of the facade and from
    // the elevated opening camera it falls on the paving in front of the building instead of across it. The
    // chairs end ~3,07 m out, inside the 3,20 m terras (PLOT.terrace).
    standoff:2.05,
    // Unit direction of each chair from the table, the turn that faces it back at the table, and a few degrees of
    // nudge so the three are not machined to the same angle: nobody leaves a garden set square, and three chairs at
    // exactly 90° is the tell that gives a render away. Fixed values, not random, so every screenshot repeats.
    // The house side (−z) stays free: that is where you walk out of the doors.
    seats:[[0,1,Math.PI+.10],[1,0,-Math.PI/2+.06],[-1,0,Math.PI/2+.11]],
};

/** One named mesh out of the loaded set, turned square and re-centred: feet on y=0, footprint centred, seat to +z. */
function gardenPart(scene,{node,yaw}) {
    const source=scene.getObjectByName(node);
    if(!source)return null;
    const part=new THREE.Group();part.rotation.y=yaw;part.add(source);
    const box=new THREE.Box3().setFromObject(part),centre=box.getCenter(new THREE.Vector3());
    part.position.set(-centre.x,-box.min.y,-centre.z);
    return part;
}

function facadeTexture(code) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    let seed = 481;
    const random = () => {seed = (seed*16807)%2147483647; return seed/2147483647;};
    if (code.startsWith('brick')) {
        // 16 courses and 4 bricks per tile: at the 0,88 m facadePeriods maps every brick finish at, that is a
        // 220 x 55 mm module — near enough Dutch waalformaat, and both counts divide 512 so the tile still wraps.
        // It only shows before the scans arrive or if one fails to load, but then it has to be the right SIZE wall.
        const colours = PALETTE[code] || PALETTE['brick-red'];
        ctx.fillStyle='#b3a592';ctx.fillRect(0,0,512,512);
        for (let row=0;row<16;row++) for(let col=-1;col<5;col++) {
            const x=col*128+(row%2)*64,y=row*32;
            ctx.fillStyle=colours[Math.floor(random()*colours.length)];ctx.fillRect(x+3,y+2,122,28);
            for(let i=0;i<40;i++) {ctx.fillStyle=random()>.5?'rgba(255,255,255,.08)':'rgba(20,10,0,.06)';ctx.fillRect(x+random()*125,y+random()*29,random()*6+1,2);}
        }
    } else if(code === 'render') {
        ctx.fillStyle='#e8e3d6';ctx.fillRect(0,0,512,512);
        for(let i=0;i<6500;i++){ctx.fillStyle=random()>.5?'rgba(255,255,255,.14)':'rgba(80,65,40,.045)';ctx.fillRect(random()*512,random()*512,2,2);}
    } else {
        const pvc=code.startsWith('pvc'),horizontal=code.includes('horizontal'),open=code.startsWith('open');
        if(horizontal){ctx.translate(512,0);ctx.rotate(Math.PI/2);}
        ctx.fillStyle=pvc?PALETTE[code]||'#4b514e':'#3d3c31';ctx.fillRect(0,0,512,512);
        const count=open?14:8,sw=512/count;
        for(let i=0;i<count;i++) {
            const base = pvc ? PALETTE[code]||'#4b514e' : ['#b5986e','#bc9e74','#a98b62','#c1a17a','#ad906b'][Math.floor(random()*5)];
            ctx.fillStyle=base;ctx.fillRect(i*sw+2,0,sw-(open?10:3),512);
            ctx.fillStyle='rgba(255,255,255,.15)';ctx.fillRect(i*sw+2,0,1,512);
            if(!pvc) for(let grain=0;grain<50;grain++){ctx.strokeStyle=random()>.5?'rgba(66,41,15,.08)':'rgba(239,208,164,.14)';ctx.beginPath();const x=i*sw+4+random()*(sw-8);ctx.moveTo(x,0);ctx.bezierCurveTo(x+random()*3,170,x-random()*3,350,x,512);ctx.stroke();}
        }
    }
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(2,2);
    texture.anisotropy=4;
    return texture;
}

/** Brightest texel of an equirectangular HDR, as a world direction (three.js equirect convention). */
export function equirectSunDirection(texture) {
    const {data,width,height}=texture?.image||{};
    if(!data||!width||!height)return null;
    const channels=data.length/(width*height),half=data instanceof Uint16Array;
    const read=index=>half?THREE.DataUtils.fromHalfFloat(data[index]):data[index];
    let best=-1,bestIndex=0;
    for(let y=0;y<height/2;y++)for(let x=0;x<width;x++){
        const i=(y*width+x)*channels,value=read(i)*.2126+read(i+1)*.7152+read(i+2)*.0722;
        if(value>best){best=value;bestIndex=y*width+x;}
    }
    const column=bestIndex%width,row=Math.floor(bestIndex/width);
    const v=texture.flipY?1-(row+.5)/height:(row+.5)/height,u=(column+.5)/width;
    const elevation=(v-.5)*Math.PI,azimuth=(u-.5)*Math.PI*2;
    return new THREE.Vector3(Math.cos(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.sin(azimuth)*Math.cos(elevation)).normalize();
}

/**
 * Copy of the sky with its sun hotspot clamped. Used for the PMREM environment and the visible backdrop: the
 * raw hotspot is thousands of times brighter than the sky around it and would blow out every glass and zinc
 * reflection. The directional sun light carries the sharp light instead (see alignSunWithSky).
 */
export function clampedSkyTexture(texture,maxLuminance=6) {
    const {data,width,height}=texture?.image||{};
    if(!data||!width||!height)return null;
    const channels=data.length/(width*height),half=data instanceof Uint16Array,copy=new Float32Array(width*height*4);
    const read=index=>half?THREE.DataUtils.fromHalfFloat(data[index]):data[index];
    for(let pixel=0;pixel<width*height;pixel++){
        const i=pixel*channels,o=pixel*4,r=read(i),g=read(i+1),b=read(i+2),luminance=r*.2126+g*.7152+b*.0722;
        const scale=luminance>maxLuminance?maxLuminance/luminance:1;
        copy[o]=r*scale;copy[o+1]=g*scale;copy[o+2]=b*scale;copy[o+3]=1;
    }
    const result=new THREE.DataTexture(copy,width,height,THREE.RGBAFormat,THREE.FloatType);
    result.mapping=THREE.EquirectangularReflectionMapping;result.flipY=texture.flipY;
    result.minFilter=result.magFilter=THREE.LinearFilter;result.generateMipmaps=false;result.colorSpace=texture.colorSpace;result.needsUpdate=true;
    return result;
}

function lineBetween(a,b,material,thickness=.025,{hollow=null}={}) {
    const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),delta=to.clone().sub(from),length=delta.length();
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(thickness/2,thickness/2,length,hollow?14:6,1,!!hollow),material);
    if(hollow){
        // Inner bore (back faces) makes the open end read as a real tube instead of a solid rod.
        const inner=new THREE.Mesh(new THREE.CylinderGeometry(thickness/2*.8,thickness/2*.8,length*1.001,14,1,true),hollow);inner.position.y=0;mesh.add(inner);
        const ring=new THREE.Mesh(new THREE.RingGeometry(thickness/2*.8,thickness/2,14),material);ring.rotation.x=Math.PI/2;ring.position.y=-length/2;mesh.add(ring);
        const ringTop=ring.clone();ringTop.rotation.x=-Math.PI/2;ringTop.position.y=length/2;mesh.add(ringTop);
    }
    mesh.position.copy(from.add(to).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    mesh.castShadow=true;return mesh;
}

/**
 * Scene units per candela. A 450 lm spot is 535 cd, so 2.14 here, and at the 2,4 m from ceiling to floor it puts
 * 0.37 on its patch against the ≈1.8 the room already has by day: a visible pool, never a second sun. Lamps are
 * meant to read at night-time levels in a daylight scene — turning them up to compete with the sun looks wrong.
 */
const LIGHT_SCALE=4e-3;
/**
 * Daylight rig, set from the sky's own energy rather than by eye (scripts note: .data/b2_swatch.mjs measures the
 * result). Integrating this HDR shows the sun disc carries 49 % of the whole sky's energy, and 68 % of the
 * irradiance reaching a sun-facing wall: E(sun-facing) drops 6.43 → 2.03 when the hotspot is clamped to 6. So the
 * clamped sky is the ambient (environment 1.0 = the sky at its true radiance, no artistic fudge in reflections)
 * and the DirectionalLight carries exactly the 4.40 the clamp removed. Ambient used to be counted twice
 * (hemisphere .75 AND a raw-HDR environment at .72) which washed every interior into the sky's blue; the
 * hemisphere is now a ground-bounce trim, and `fill` opens the shaded facade without a second set of highlights.
 */
/**
 * An asset URL carrying the release version. `new URL(relative, import.meta.url)` keeps the path but DROPS the query,
 * so without this the textures and models sit on a stable URL behind a week of `max-age` and a returning visitor keeps
 * the previous release's image. Models are excluded on purpose: the glTF loader concatenates baseUrl + filename and
 * a glTF resolves its own .bin and textures relative to itself, so a query on the base breaks the path.
 * The version is read from this module's own import-map URL, so it needs no wiring.
 */
const ASSET_VERSION=new URL(import.meta.url).searchParams.get('v')||'';
function assetUrl(relative){
    const url=new URL(relative,import.meta.url);
    if(ASSET_VERSION)url.searchParams.set('v',ASSET_VERSION);
    return url.href;
}

const RIG={hemi:.25,sun:4.4,fill:.5,ambient:1,environment:1,interiorFill:.55,houseFill:3.6,exteriorFill:.18,interiorEnv:.38};
/**
 * Tone-mapping exposure per camera: a sunlit garden and a room behind glass are two different photographs. Measured
 * with the swatch read-back probe (docs/verification/2.9) — the exterior lands the facade swatches on their catalogue
 * hex, the interior lifts a room that receives no direct sun.
 */
// 2.16.0, the customer: "render biraz sanki koyu". Measured against their own reference render
// (kozijn/render-Buitenzijde-nieuw-brick.jpg): the paving and the lawn already matched it within a few percent, but
// sunny brick came out at luma 81 against the reference's 118. The exterior views go up a step and the brick gets
// its own lift (facade(), envMapIntensity), which is where the difference actually was.
const VIEW_EXPOSURE={perspective:1.02,'perspective-right':1.02,'perspective-left':1.02,front:1.02,top:1.02,interior:1.6,ceiling:1.3,cutaway:1.2};
/**
 * Proposal images are taken at one fixed focal length, whatever the live camera was doing a moment earlier.
 * The same 40° the exterior preview uses: wide enough for a 750 cm aanbouw, narrow enough that the facade
 * nearest the lens is not stretched in a picture the customer is asked to judge a purchase on.
 */
const DOCUMENT_FOV=40;
/**
 * The gipsplaat lining's joints (buildBoardJoints): 1,20 m sheets, a 5 cm band of filler over each joint, a 3 cm band
 * either side of a taped corner bead at the dagkant, in a grey one small step darker than the board (#c2c3c1).
 */
export const BOARD_JOINT=Object.freeze({sheet:1.2,width:.05,corner:.03,color:'#b9bab8'});
/**
 * The lowest the visitor's camera may go, in metres above the scene origin (see clampCamera). The lawn's
 * top is at -0,205, the terras at -0,05 and the finished floor inside at about +0,10, so an eye at 0,25 m is above
 * every surface a visitor can stand on — knee height inside, low enough outside to look up at a daktrim. The orbit
 * point may go down to grade (0) and no further.
 */
const CAMERA_FLOOR=Object.freeze({eye:.25,target:0});
/** The visitor asked for less motion: a kozijn then changes state at once and never plays on its own. */
const reducedMotion=()=>!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/**
 * How far the visitor may travel around the building (2.14.0, the customer: "prefabriğin etrafında tam tur
 * atabiliyor, bunu sınırlandırmak daha doğru olmaz mı — ana binanın duvar hizasına kadar yaklaşması yeterli").
 *
 * Outside, the eye stays on the garden side of the existing house's own front wall: the visitor swings from the
 * left-hand boundary to the right-hand one and stops level with the gevel, which is as far as anything was ever
 * drawn to be seen from. Inside, the doorbraak view stands in the room behind the opening, so the limit there is
 * that room's back wall instead — wheeling backwards stops in the room rather than flying out through the house.
 * `wall` and `room` are the clearances kept off those two planes. An administrator can lift the whole thing with
 * Vormgeving → "Vrij rondkijken" (services/appearance.py camera_free_orbit); then nothing is clamped but the ground.
 */
const CAMERA_LIMIT=Object.freeze({wall:.02,room:.35});
/**
 * The levels everything in the garden stands on (2.14.1, the customer: "bina biraz havada duruyormuş… teras betonu da
 * yere temas etmiyor"). `plane` is the endless ground of the world, `lawn` the grass island over the plot — 1 cm above
 * the plane so the two never share a depth — and `paving` the top of the terras. `bury` is how deep a wall is drawn
 * into the ground: a wall that stops exactly at the grass shows a seam at a grazing angle, so it goes well under.
 */
const GROUND=Object.freeze({plane:-.175,lawn:-.165,paving:-.05,bury:-.30});
/**
 * The studio a proposal image is taken in once the omgeving is switched off (setSurroundingsVisible).
 *
 * `#fbfaf6` is not a new colour: it is the paper document_capture.js already fills the plattegrond and the two
 * gevelaanzichten with. Using it behind the 3D views too makes the six images of one proposal read as one set
 * instead of three photographs stapled to three drawings, and it is the reason the background is a flat sheet
 * rather than a gradient — a gradient would be a fourth kind of surface in the same PDF.
 *
 * The ground stays, a shade below the paper: an aanbouw needs a floor to stand on and a shadow to sit in, or it
 * reads as a rendering that floats. The fog dissolves that floor into the paper well before its edge, so there
 * is no horizon line and no visible end to the plane. The LIGHTING is untouched — the HDR sky keeps lighting the
 * building and keeps reflecting in its glass and aluminium, exactly as in the live view. Only what the camera
 * sees BEHIND the product changes.
 */
const STUDIO={paper:'#fbfaf6',ground:'#eceadf',fogNear:13,fogFar:46};
/**
 * Grass only on the plot. The customer, 2026-09-19: "çimler her yerde gözükmese … heryerde çim olunca odak
 * genişliyor, odak prefabrik kısımda olmalı" — a lawn running to the horizon pulls the eye away from the product.
 * The lawn stays one 400 m plane (shadows, the camera floor and the view never meet an edge), but beyond a
 * feathered rectangle around the house, its garden and the buren it dissolves into the scene's own fog colour, so
 * the plot reads as an island in soft haze. `garden` is where the back schutting stands, measured from the front.
 */
// terrace: how far the paving reaches past the building line. 3,20 m since 2.13.1 (was 2,00): the customer asked
// for the garden set further from the aanbouw ("prefabrik görünümüne engel olmasın") and for a longer terras for
// it. openGarden (without a schutting, 2.11.0) keeps the same 2,2 m of lawn behind the terras as before.
const PLOT=Object.freeze({garden:10.3,margin:1.2,feather:5,terrace:3.2,openGarden:5.4});
/** Terrace top (-0,05) to the slab top the walls stand on (0): the part of a wall drawn below m.walls. */
const FOOTING=.05;
/**
 * EPDM roof membrane (2.13.0, the customer: "mebran kaplama hissi ver, eskitme bir şey koyma"). One even, dark satin
 * sheet: no scan, because every scan tried carried what a new roof does not have — the screed set (2.10) read as
 * concrete, the asphalt set as a cracked road. The roof, the membrane-clad inside of the kantplank and the outlet
 * flange all take this one material, so the membrane reads as one sheet dressed up the edge.
 */
const ROOF_MEMBRANE=Object.freeze({color:'#474b49',roughness:.78,envMapIntensity:.9});
/**
 * The glazing profile of a daklicht: a broad, flat aluminium bar. 9 cm across is what a lichtstraat's rafter cap
 * measures against a 72 cm bay in the owner's reference photographs (about an eighth of the bay). It stands 5 cm
 * high, 12 mm of which lies under the glass line, so the pane reads as set into the frame rather than laid on it.
 */
const ROOFLIGHT_BAR=Object.freeze({width:.09,height:.05,sink:.012});
function attachPlotFade(material,uniforms){
    // Mixed after the fog, with the fog's own colour and its own colour-space handling: the haze therefore meets the
    // fogged far ground, the sky's horizon and the studio paper without a seam, whichever backdrop is active.
    material.onBeforeCompile=shader=>{
        Object.assign(shader.uniforms,uniforms);
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vPlotXZ;')
            .replace('#include <project_vertex>','#include <project_vertex>\nvPlotXZ=(modelMatrix*vec4(transformed,1.0)).xz;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vPlotXZ;\nuniform vec4 plotRect;\nuniform float plotFeather;')
            .replace('#include <fog_fragment>','#include <fog_fragment>\n#ifdef USE_FOG\n{vec2 q=abs(vPlotXZ-plotRect.xy)-plotRect.zw;gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,smoothstep(0.0,plotFeather,length(max(q,0.0))));}\n#endif');
    };
    material.customProgramCacheKey=()=>'plot-fade-v1';
}
/**
 * The named parts a proposal image may leave out, beside the omgeving switch. Each is a group in the scene, each
 * has one boolean on cs.prefab.appearance, and each is only ever consulted while `documentMode` is on: the visitor
 * configuring the aanbouw keeps the whole picture whatever an administrator has chosen for the PDF.
 *
 * Why these three and why separately. `document_surroundings` is one switch over everything that is not the product
 * — and that was too coarse in both directions. Two things it did NOT cover stayed in every proposal image because
 * they hung from the root: the existing room's floor and its rear wall, drawn so a full-width doorbraak reads as an
 * opening rather than a hole. The customer's own words about them are "bu resimde kalan parcalarida evin kendisine
 * dahil et, prefabrik yapiya degil" — they belong to the HOUSE, so they now hang from the house and leave with it,
 * and they get a switch of their own on top. And one thing it covered wrongly: the terrace. The slab under the
 * aanbouw and the apron that reaches into the garden were one mesh, so there was no way to keep the first and drop
 * the second ("bahceye uzanan beton zemin kalabilir … prefabrik beton altindaki ayri bir secenekle olsun").
 *
 * The defaults are what the next proposal shows when nobody has chosen: the aanbouw on its own concrete, the apron
 * it is delivered onto, and none of the house. An Odoo that predates these fields, a website with no vormgeving
 * record and the standalone server all land exactly here.
 *
 * The list itself and its defaults live in scene_content.js, beside the five scene extras, and are imported from
 * here: theme.js has to read them off the appearance payload before the first frame and may not pull in three.js
 * to do it, so the constant cannot live in this module. What each part COVERS is written here, with the geometry.
 */
const documentPartsOf=normalizeDocumentParts;
/** Fixed lamp slots per tier: the count is part of every shader program, so it must never change while a scene runs. */
const LAMP_SLOTS={full:{spot:4,point:2},compact:{spot:3,point:1}};
const UP=new THREE.Vector3(0,1,0);
/**
 * The sedum scan tiles every 0.90 m. Laid square on a rectangular roof its repeat reads as rows of identical
 * patches from the top-down view; turning the grid 21 degrees off the roof axes leaves the same mat with no line
 * for the eye to follow. Not a whole number of degrees, so the grid never lands back on the roof edge.
 */
const SEDUM_UV_ROTATION=.373;
/** Reported by getSceneInfo().rendering.toneMapping; the numbers are THREE's tone mapping constants. */
const TONE_MAPPING_NAMES={[THREE.NoToneMapping]:'none',[THREE.LinearToneMapping]:'linear',[THREE.ReinhardToneMapping]:'reinhard',
    [THREE.CineonToneMapping]:'cineon',[THREE.ACESFilmicToneMapping]:'aces',[THREE.AgXToneMapping]:'agx',[THREE.NeutralToneMapping]:'neutral'};

/**
 * Milliseconds between two hover raycasts. A pointermove fires up to once per frame; at 90 ms the highlight still
 * feels immediate (a pointer needs longer than that to settle on a new part) while the raycast runs at most eleven
 * times a second instead of sixty. Measured cost per test: docs/verification/2.9/scene-links.json → hoverCost.
 */
const HOVER_INTERVAL=90;

/**
 * The house's ground-floor outer leaf, on the street elevation behind the extension.
 *
 * Until 2.9.6 the existing house had no envelope there at all: `makeExistingHouse` gave the ground floor an upper
 * wall, two flanks and the wings beside the extension, but over the extension's own width the outermost thing in the
 * -z direction was `makeExistingRoom`'s painted lining — the room's INSIDE seen from the street. Measured by
 * .data/back_probe.mjs over a full circle, that panel filled 20-31% of the frame at 180 degrees for every house
 * type and every extension size (docs/verification/2.9/rear-elevation.json, `before`).
 *
 * 105 mm is the thickness the flanks beside the room already use, and the leaf sits FLUSH with the upper wall, the
 * wings and the neighbours' walls — one brick plane from grade to eaves — rather than proud of them, so the courses
 * run straight through the joint instead of stepping at it. That flushness is why the lined room has to give the
 * leaf its depth back: see `existingRoomDepth`.
 */
const HOUSE_LEAF=.105;
/**
 * How far the lined room runs INTO that leaf. The room's floor, ceiling, side leaves and rear lining all used to end
 * exactly on the street plane; if they still did, every one of those end faces would be coplanar with the leaf's own
 * outer face and z-fight along a 2-12 cm band. Burying them 10 mm inside the leaf costs nothing (the band is inside
 * masonry) and there is then no pair of coplanar faces anywhere in the stack.
 */
const ROOM_BURY=.01;
/**
 * Depth of the lined room behind the doorbraak, given the house depth. Shared by `makeExistingRoom` (which builds
 * the room) and `buildFloorFinish` (which runs the laminaat up to its rear lining): two call sites that must agree
 * to the millimetre or the planks stop short of the wall.
 */
function existingRoomDepth(houseDepth){return houseDepth-HOUSE_LEAF+ROOM_BURY;}
/**
 * How deep the doorbraak is on a proposal image with the omgeving switched off.
 *
 * With the omgeving ON the room behind the doorbraak is the full living room — `existingRoomDepth`, some eight
 * metres of it — because the house it belongs to is drawn around it. With the omgeving OFF that house is gone, and
 * eight metres of somebody else's room is left standing in the studio: measured on the 620 x 320 default, its rear
 * lining rose 3,4 % of the frame ABOVE the daktrim in both tuinperspectieven and its floor ran 2,5 % out past the
 * rear corner, while op het beeld zonder dak the same floor — roofless, because its ceiling leaves with the house —
 * was 22 % of the picture, a laminate plain wider than the aanbouw itself. A customer reading that picture sizes
 * the product by it. Exactly the "arkadaki ev" the customer asked to have taken out.
 *
 * So with the omgeving off the room is replaced by its first half metre: floor, rear lining, both side leaves and a
 * soffit, in the same materials on the same metric UV origin, so the planks and the stucwerk still run straight
 * through the opening. That is a DOORBRAAK — a wall opened up with a space behind it — which is what is being sold,
 * and it is short enough to stay inside the aanbouw's own silhouette from every proposal camera (measured: nothing
 * of it reaches outside, at every size in the catalogue). Hiding the room outright was tried first and is worse: you
 * then look through the aanbouw straight onto the paper, and the doorbraak reads as a hole rather than an opening.
 */
const DOORBRAAK_REVEAL=.55;

/** True for a mesh whose material is marked as glazing (see the 'glass' materials in buildScene). */
function isGlazing(object) {
    const material=object.material;
    if(!material)return false;
    return Array.isArray(material)?material.some(entry=>entry?.userData?.glazing):!!material.userData?.glazing;
}

/**
 * GTAO reads a normal+depth G-buffer. A 6 mm pane standing 7 cm in front of the room writes its own flat plane into
 * that buffer, so the whole room behind the window is occluded by the window — a grey smear exactly where the
 * customer wants to see through. Hiding the panes for the G-buffer pass only leaves the room's own AO intact.
 * Pinned to three 0.180: GTAOPass calls _overrideVisibility() / _restoreVisibility() around the normal pass and
 * restores everything in _visibilityCache (esbuild keeps property names, so the vendored bundle carries them too).
 */
class GlazingAwareGTAOPass extends GTAOPass {
    _overrideVisibility() {
        super._overrideVisibility();
        const cache=this._visibilityCache;
        this.scene.traverse(object=>{if(object.visible&&(isGlazing(object)||object.userData.excludeFromAO)){object.visible=false;cache.push(object);}});
    }
}

/**
 * Solid prism: a closed profile (star-shaped from its first point) extruded between two offsets along one axis.
 * Axis 'x' profiles are [z,y] pairs, axis 'z' profiles are [x,y] pairs; every face is wound to be lit from outside.
 */
function extrudedPrism(profile,axis,from,to) {
    const point=(u,v,w)=>axis==='x'?[w,v,u]:[u,v,w];
    const cu=profile.reduce((sum,p)=>sum+p[0],0)/profile.length,cv=profile.reduce((sum,p)=>sum+p[1],0)/profile.length;
    const positions=[];
    const triangle=(a,b,c,outward)=>{
        const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
        if(n[0]*outward[0]+n[1]*outward[1]+n[2]*outward[2]<0)[b,c]=[c,b];
        positions.push(...a,...b,...c);
    };
    const [low,high]=from<to?[from,to]:[to,from];
    for(const [w,sign] of [[low,-1],[high,1]])for(let i=1;i<profile.length-1;i++)triangle(point(...profile[0],w),point(...profile[i],w),point(...profile[i+1],w),point(0,0,sign));
    for(let i=0;i<profile.length;i++){
        const a=profile[i],b=profile[(i+1)%profile.length],outward=point((a[0]+b[0])/2-cu,(a[1]+b[1])/2-cv,0);
        triangle(point(...a,low),point(...b,low),point(...b,high),outward);
        triangle(point(...a,low),point(...b,high),point(...a,high),outward);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
    return geometry;
}

/**
 * The fittings that hang on the garden front. Choosing one shows the WHOLE front, not a close-up of one pier
 * (2.17.0, the owner: "buitenlicht seçiminde sol sağ focus yapmasın, hepsini bir kerede göstersin; musluk ve
 * dışarıdaki prizlerde de aynı şekilde"): the choice moves the fitting, and left, right and both are one picture.
 */
const FRONT_FITTINGS=Object.freeze(['outsideLight','outsideSocket','outsideTap']);
/** The front of the aanbouw as camera subjects: both piers, foot to roof edge, out to the overstek when there is one. */
function frontFacadeSubjects(model) {
    const b=model.bounds,top=model.height+model.roofThickness/2,reach=b.front+(model.overhangDepth||0);
    return [b.left,b.right].flatMap(x=>[[x,0,b.front],[x,top,reach]]).map(position=>({kind:'facade',position,rotation:0,room:'outside'}));
}

/** Fit the selected fittings with surrounding wall/ceiling context, using their real mounting side. */
function fixtureCameraFrame(fixtures,model,aspect,automatic=false,{padding=automatic?.65:.35}={}) {
    const box=new THREE.Box3();
    for(const fixture of fixtures){
        const p=new THREE.Vector3(...fixture.position),radiator=fixture.kind==='radiator',pendant=fixture.kind==='pendant';
        const extent=new THREE.Vector3(radiator?.54:.15,radiator?.97:.18,radiator?.54:.15);
        box.expandByPoint(p.clone().sub(extent));box.expandByPoint(p.clone().add(extent));
        if(pendant)box.expandByPoint(p.clone().add(new THREE.Vector3(0,-.75,0)));
    }
    box.expandByScalar(padding);
    const target=box.getCenter(new THREE.Vector3()),first=fixtures[0];
    // The overstek soffit is a ceiling you stand UNDER from the garden, not one you look up at from indoors.
    const soffit=first.room==='overhang',ceiling=first.room==='ceiling',inside=first.room==='interior';
    const sameWall=fixtures.every(f=>Math.abs((f.rotation||0)-(first.rotation||0))<.01);
    let direction=first.kind==='roof-detail'?new THREE.Vector3(-.45,1,1):soffit?new THREE.Vector3(0,-.7,.8):ceiling?new THREE.Vector3(0,-.8,-.6):sameWall?new THREE.Vector3(Math.sin(first.rotation||0),.08,Math.cos(first.rotation||0)):new THREE.Vector3(0,.10,inside?-1:1);
    const fov=ceiling||soffit?64:54,tanY=Math.tan(THREE.MathUtils.degToRad(fov)/2),tanX=tanY*Math.max(.3,aspect||1);
    const fit=()=>{
        direction.normalize();
        const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
        const up=new THREE.Vector3().crossVectors(direction,right).normalize();
        let distance=automatic?2.7:1.85;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
            const point=new THREE.Vector3(x,y,z).sub(target),towards=point.dot(direction);
            distance=Math.max(distance,towards+Math.abs(point.dot(right))/tanX,towards+Math.abs(point.dot(up))/tanY);
        }
        return target.clone().addScaledVector(direction,distance);
    };
    let position=fit();
    // Standing on the terrace, not crouching on it: keep the eye above the paving and pull back instead.
    if(soffit&&position.y<1.1){direction=new THREE.Vector3(0,1.25-target.y,1.5);position=fit();if(position.y<1.1)position.y=1.25;}
    if(ceiling&&position.y<.35){
        // The existing room is open at the back. Look through that connection instead of below the floor.
        direction=new THREE.Vector3(0,.45-target.y,model.bounds.back-Math.max(model.width*.65,2)-target.z);position=fit();
        if(position.y<.35){direction.y=0;position=fit();position.y=.45;}
    }
    if(inside&&position.z>=model.bounds.back&&(
        position.x<model.bounds.left+model.wall+.15||position.x>model.bounds.right-model.wall-.15||position.z>model.bounds.front-model.wall-.15)){
        direction=new THREE.Vector3(-target.x,1.25-target.y,model.bounds.back-Math.max(model.width*.6,2)-target.z);position=fit();
    }
    return {target,position,fov,view:ceiling?'ceiling':inside?'interior':'perspective'};  // the soffit is seen from outside, with the roof on
}

export class Preview {
    constructor(container,{onReady,onError,onSelect,pixelRatio,observeResize=true,initialConfig={},environment,quality,preserveDrawingBuffer=false,
        documentSurroundings=false,documentParts=null,gardenFence=true,cameraLimit=true,interiorFurniture=false}={}) {
        this.container=container;this.onReady=onReady;this.onError=onError;this.selectionHandler=onSelect;
        this.mode='3d';this.view='perspective';this.dimensionsVisible=false;this.roofVisible=true;
        this.scope=[];this.placement=null;this.examplesVisible=true;this.decorVisible=true;this.environment=normalizeEnvironment(environment);this.maps={};this.assetRevision='2026-09-13.3';
        this.gardenFence=gardenFence!==false; // Vormgeving → Schutting in de tuin (setGardenFence)
        this.cameraLimit=cameraLimit!==false; // Vormgeving → Vrij rondkijken, off (see CAMERA_LIMIT / clampCamera)
        this.interiorFurniture=interiorFurniture===true; // Vormgeving → Meubels in de binnenweergave, off
        // Illustrative families that have been switched OFF, by `illustrative` key (see setIllustrativeVisible).
        // Absent means on, so a family added later is visible until somebody deliberately turns it off.
        this.illustrativeOff={};
        // The omgeving is in the picture while the visitor is configuring; a proposal image asks setDocumentView
        // for it and gets whatever the administrator chose (default: not shown). See setSurroundingsVisible.
        this.surroundingsVisible=true;this.documentSurroundings=documentSurroundings===true;
        // Named parts a proposal image may leave out, per the administrator. See setDocumentParts / DOCUMENT_PARTS.
        this.documentParts=documentPartsOf(documentParts);this.partGroups={};this.documentMode=false;
        this.buildCounts={structure:0,material:0,fixtures:0};this.renderTimes=[];
        this.materials=new Map();this.textures=new Set();this.disposed=false;this.config={};
        this.cameraFocus=null;this.cameraTouched=false;
        // Render tier and pixel ratio are measured from the device (renderTier in render_state.js); `quality` forces one.
        this.forcedQuality=quality==='full'||quality==='compact'?quality:null;this.pixelRatioOption=pixelRatio;
        this.shadowsDirty=true;this.shadowPasses=0;
        // Read by loadAssets, which runs under a bare THREE stub in asset_loading.test.mjs and cannot see RIG.
        this.environmentIntensity=RIG.environment;
        this.host=document.createElement('div');this.host.className='prefab-preview-renderer';
        this.host.style.cssText='position:absolute;inset:0;overflow:hidden;';
        this.plan=document.createElement('div');this.plan.className='prefab-plan';this.plan.style.cssText='position:absolute;inset:0;display:none;';
        this.host.append(this.plan);container.append(this.host);
        this._planSelect=event=>{const target=event.target.closest?.('[data-option-key]');if(target&&(event.type==='click'||['Enter',' '].includes(event.key))){event.preventDefault();this.selectionHandler?.(target.dataset.optionKey);}};
        this.plan.addEventListener('click',this._planSelect);this.plan.addEventListener('keydown',this._planSelect);
        if(getComputedStyle(container).position==='static') container.style.position='relative';
        try {
            // preserveDrawingBuffer costs a full-screen copy per frame; only the document-capture Preview reads the canvas back.
            this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:!!preserveDrawingBuffer,powerPreference:'high-performance'});
            this.quality=this.measureTier(container.clientWidth);
            this.renderer.setPixelRatio(this.pixelRatioFor(this.quality));
            this.renderer.setClearColor('#e7e9e5');this.renderer.outputColorSpace=THREE.SRGBColorSpace;
            // Neutral keeps product colours true (ACES tints reds orange and desaturates the whole midtone range);
            // the exposure is per view and set by applyViewLighting().
            this.renderer.toneMapping=THREE.NeutralToneMapping;this.renderer.toneMappingExposure=VIEW_EXPOSURE.perspective;
            // One shadow pass per changed scene, not per frame: render() consumes this.shadowsDirty (see render()).
            this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
            this.renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none;';
            this.renderer.domElement.setAttribute('role','img');
            this.renderer.domElement.setAttribute('aria-label','Interactieve 3D-voorvertoning van je aanbouw. Sleep om te draaien; scroll om te zoomen.');
            this.host.prepend(this.renderer.domElement);
            this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e7e9e5');
            this.scene.fog=new THREE.Fog('#e7e9e5',27,60);
            this.camera=new THREE.PerspectiveCamera(40,1,.035,150);
            this.controls=new OrbitControls(this.camera,this.renderer.domElement);
            this.controls.enableDamping=false;this.controls.enablePan=true;
            this.controls.maxPolarAngle=Math.PI/2-.015;this.controls.minPolarAngle=.025;
            this.controls.minDistance=3;this.controls.maxDistance=27;this.controls.target.set(0,1,0);
            this._render=()=>{if(!this.renderFrame)this.renderFrame=requestAnimationFrame(()=>{this.renderFrame=null;this.render();});};
            // Clamp BEFORE the frame is scheduled, on every change the visitor makes: orbit, pan, zoom, touch.
            this._clampToGround=()=>this.clampCamera();
            this.controls.addEventListener('change',this._clampToGround);this.controls.addEventListener('change',this._render);
            this._controlStart=()=>{this.cameraFocus=null;this.cameraTouched=true;};this.controls.addEventListener('start',this._controlStart);
            // The one term that stands in for the interreflection a raster renderer has not got: a white room bounces
            // its own light about 2.7× before it settles, and without that everything the sky lights reads grey-blue.
            // An AmbientLight is the only light in three that costs no shader program slot (one folded vec3 uniform),
            // and GTAO supplies the contact darkening it cannot know about.
            this.ambient=new THREE.AmbientLight('#ffeedd',RIG.ambient);this.scene.add(this.ambient);
            const hemi=new THREE.HemisphereLight('#e9edf2','#bfae96',RIG.hemi);this.scene.add(hemi);
            const sun=new THREE.DirectionalLight('#fff1dc',RIG.sun);sun.position.set(-6,8,5);sun.castShadow=true;
            sun.shadow.mapSize.set(this.quality==='compact'?1024:2048,this.quality==='compact'?1024:2048);
            // The frustum is fitted to the built scene (fitSunShadow); these are only the values before the first build.
            sun.shadow.camera.left=-12;sun.shadow.camera.right=12;sun.shadow.camera.top=12;sun.shadow.camera.bottom=-12;
            sun.shadow.camera.near=.5;sun.shadow.camera.far=45;
            // 8 mm inner leaves and 6 mm panes: normalBias walks the sample along the normal (peter-panning at the
            // 2 cm the design started with), bias is the depth slack. Tuned against the fitted ≈0.8 cm texel.
            sun.shadow.normalBias=.012;sun.shadow.bias=-.00014;this.scene.add(sun,sun.target);this.sun=sun;this.hemi=hemi;
            // Opposite the sun, in the colour of light bounced off terrace and grass — not the blue it used to be,
            // which turned every shaded facade and every room behind the glass grey-blue.
            const fill=new THREE.DirectionalLight('#f2ebdd',RIG.fill);fill.position.set(6,4,-4);this.scene.add(fill);this.fill=fill;
            this.buildLampSlots();
            // The composer is built by the first real resize(): before that the container size (and so the target size) is unknown.
            this.watchPixelRatio();
            this._contextLost=event=>{event.preventDefault();this.assetLoadGeneration=(this.assetLoadGeneration||0)+1;this.fallback(new Error('3D is tijdelijk niet beschikbaar. De plattegrond blijft bruikbaar.'));};
            this.renderer.domElement.addEventListener('webglcontextlost',this._contextLost);
            this._contextRestored=()=>{this.failed=false;this.shadowsDirty=true;this.environmentTarget?.dispose();this.environmentTarget=null;this.scene.environment=null;this.assetsReady=this.loadAssets().then(current=>{if(!current)return;this.applyMode();this.render();this.onReady?.({mode:this.mode,restored:true});return true;});};
            this.renderer.domElement.addEventListener('webglcontextrestored',this._contextRestored);
            this.raycaster=new THREE.Raycaster();this.raycaster.params.Line.threshold=.035;
            this._pointerDown=event=>{this.pointerStart={x:event.clientX,y:event.clientY};this.setHighlight(null);};
            // The highlight is dropped while the camera is dragged; once the button is released the pointer is still
            // resting on something, so the outline is asked for again instead of waiting for the next move.
            this._pointerUp=event=>{if(this.pointerStart&&Math.hypot(event.clientX-this.pointerStart.x,event.clientY-this.pointerStart.y)<5)this.selectAt(event.clientX,event.clientY);this.pointerStart=null;if(event.pointerType==='mouse')this.queueHover(event.clientX,event.clientY);};
            this.renderer.domElement.addEventListener('pointerdown',this._pointerDown);this.renderer.domElement.addEventListener('pointerup',this._pointerUp);
            // A fine pointer learns the model is clickable by hovering it; a touch screen has no hover and gets nothing.
            this._pointerMove=event=>{if(event.pointerType==='mouse')this.queueHover(event.clientX,event.clientY);};
            this._pointerLeave=()=>{this.hoverPoint=null;this.setHighlight(null);};
            this.renderer.domElement.addEventListener('pointermove',this._pointerMove);
            this.renderer.domElement.addEventListener('pointerleave',this._pointerLeave);
            // Double click brings a lost camera back to the standard viewpoint.
            this._doubleClick=event=>{event.preventDefault();this.onResetCamera?.();};this.renderer.domElement.addEventListener('dblclick',this._doubleClick);
        } catch(error) {this.failed=true;queueMicrotask(()=>{if(!this.disposed)this.onError?.(error);});}
        this.resizeObserver=observeResize&&typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>this.resize()):null;
        this.resizeObserver?.observe(container);
        this.update(initialConfig);
        this.assetsReady=this.renderer&&!this.failed?this.loadAssets():Promise.resolve();
        queueMicrotask(()=>{if(!this.disposed)this.onReady?.({mode:this.failed?'2d':'3d'});});
    }

    material(key,options,kind='mesh') {
        if(!this.materials.has(key)) this.materials.set(key,kind==='line'?new THREE.LineBasicMaterial(options):kind==='flat'?new THREE.MeshBasicMaterial(options):new THREE.MeshStandardMaterial(options));
        return this.materials.get(key);
    }

    /**
     * Scanned surface material; rebuilt once the local maps arrive (keys start with `surface:`). aoMap reads the same
     * `uv` channel as the colour map (Texture.channel is 0 by default in three 0.180), so the metric UVs below serve
     * both and no second UV set is needed.
     */
    surface(key,{color,roughness=.95,map,normalMap,roughnessMap,aoMap,aoMapIntensity=1,normalScale=.5,envMapIntensity=1,metalness=0,side}) {
        const cacheKey=`surface:${key}`;
        if(!this.materials.has(cacheKey)){
            const maps={map:this.maps[map]||null,normalMap:this.maps[normalMap]||null,roughnessMap:this.maps[roughnessMap]||null,aoMap:this.maps[aoMap]||null};
            this.materials.set(cacheKey,new THREE.MeshStandardMaterial({color,roughness,metalness,envMapIntensity,aoMapIntensity,
                ...(side?{side}:{}),...maps,normalScale:new THREE.Vector2(normalScale,normalScale)}));
        }
        return this.materials.get(cacheKey);
    }

    /**
     * Interior lining (stucwerk, verf, gipsplaat). One instance per finish so the extension and the house's room read
     * as one room, and one metric period so the plaster relief is the same size on every wall and ceiling — the scan
     * carries no colour of its own, the paint tint does (see the interior_plaster rows in provenance.json).
     */
    lining(kind) {
        const stuc={normalMap:'stucNormal',roughnessMap:'stucRough',aoMap:'stucAo',aoMapIntensity:.8,envMapIntensity:RIG.interiorEnv};
        // roughness 1 × the scan's 0.88 mean = the matte wall paint the lighting stage measured; gypsum board is duller still.
        if(kind==='painted')return this.surface('painted',{color:'#f4f2ed',roughness:1,normalScale:.25,...stuc});
        if(kind==='plaster')return this.surface('plaster',{color:'#dfdcd4',roughness:1,normalScale:.45,...stuc});
        // Unpainted gipsplaat is the ONE finish in the room that is not paint: it must read as the grey of the bare
        // floor slab, a little lighter, and not as a cream wall. The tint is neutral rather than floor-coloured
        // because the interior light is warm (a #fff3e4 bounce fill under a warm sky): measured off the render, this
        // room adds about R-B +9 of its own, so a neutral albedo lands on the floor's own +6..+12 while the old
        // #c4c0b7 (albedo R-B +13) landed at +22 - a visible cream cast. See docs/verification/2.9/interior-grey.json.
        return this.surface('gypsum-board',{color:'#c2c3c1',roughness:1,normalScale:.3,...stuc});
    }
    /**
     * The filled joint's material: the board's own lighting response (same scans, same interior env strength) with
     * only the tint a step darker. The first version was a plain material, and a plain material takes the full
     * environment the board is deliberately held back from - on the GPU a DARKER albedo rendered as a WHITE line
     * across every wall and the ceiling (docs/verification/gipsplaat). Matched lighting leaves the tint to speak.
     */
    boardJoint(){
        return this.surface('board-joint',{color:BOARD_JOINT.color,roughness:1,normalScale:.3,normalMap:'stucNormal',
            roughnessMap:'stucRough',aoMap:'stucAo',aoMapIntensity:.8,envMapIntensity:RIG.interiorEnv});
    }

    /**
     * The joints of the gipsplaat lining as a prefab leaves the factory: sheets taped and FILLED, not finished. The
     * customer's words: "vida izi olmasin, derz dolgu izi hafif belli olsun yeter" — no screw heads, only a faint
     * trace of the joint filler — and the walls and the dagkant must carry it, not only the ceiling.
     *
     * Why the walls showed nothing before: every wall joint was a 3 mm strip placed 4,5-7,5 mm from the structural
     * wall, and the lining it belonged to is 8 mm thick. The joints were INSIDE the board. The ceiling's happened to
     * sit below its board's face, which is why "tavanlarda biraz yapmissin ama duvarlarda yoktu". Every band here is
     * placed from the FACE of the board it lies on, 0,5 mm in front of it.
     *
     * A band, not a line: filler is spread 5 cm wide over the taped joint, and a crisp 14 mm dark stripe read as a
     * drawn grid. BOARD_JOINT.color is a small step darker than the board (a lighter joint is the white-line bug the
     * 2.9 notes recorded), measured in interior_lining.test.mjs to stay "visible when you look, not when you pass".
     *
     * The dagkant: the reveals left, right and above the opening are lined with board too, and the corner where a
     * reveal meets the wall is a taped corner bead — filled on BOTH faces. That is what makes the opening read as
     * finished in board rather than as a hole cut into it.
     */
    buildBoardJoints(m){
        const b=m.bounds,o=m.opening,open=o.width>0,H=BOARD_JOINT,proud=.0005,thin=.001;
        const joint=this.boardJoint();
        const band=(size,at,name)=>{const mesh=this.linedBox(this.root,size,at,joint,{shadow:false});mesh.userData.scopeKey='plaster';mesh.name=name;return mesh;};
        // Side walls: the lining's room face is 8 mm off the structural wall.
        const sideFace=m.width/2-m.wall-.008;
        for(const side of [-1,1])for(let z=b.back+H.sheet;z<b.front-m.wall-.02;z+=H.sheet)
            band([thin,m.height-.13,H.width],[side*(sideFace-proud-thin/2),m.height/2,z],'board-joint-wall');
        // Front wall: the joints belong to the lining, so they stop at the opening (a strip across the glass read as a
        // white line through the pane). Pier linings face the room 15 mm off the wall, the lintel's 17 mm.
        const pierFace=b.front-m.wall-.015,lintelFace=b.front-m.wall-.017;
        for(let x=b.left+m.wall+H.sheet;x<b.right-m.wall;x+=H.sheet){
            const inside=open&&Math.abs(x)<o.width/2+H.width/2;
            if(inside&&Math.abs(x)>o.width/2-H.width/2)continue;   // a sheet edge on the opening's own edge is the corner bead below
            const [y0,y1]=inside?[o.bottom+o.height,m.height-.065]:[.065,m.height-.065];
            if(y1-y0<.02)continue;
            const face=inside?lintelFace:pierFace;
            band([H.width,y1-y0,thin],[x,(y0+y1)/2,face-proud-thin/2],'board-joint-front');
        }
        if(!open)return;
        // Dagkant corners, filled on both faces: the wall face beside/above the opening, and the reveal face.
        const top=o.bottom+o.height,revealFace=o.width/2-.012,revealEdge=b.front-m.wall-.01;
        for(const side of [-1,1]){
            band([H.corner,o.height,thin],[side*(o.width/2+H.corner/2),o.bottom+o.height/2,pierFace-proud-thin/2],'board-joint-dagkant');
            band([thin,o.height,H.corner],[side*(revealFace-proud-thin/2),o.bottom+o.height/2,revealEdge+H.corner/2],'board-joint-dagkant');
        }
        band([o.width+2*H.corner,H.corner,thin],[0,top+H.corner/2,lintelFace-proud-thin/2],'board-joint-dagkant');
        band([o.width-.024,thin,H.corner],[0,top-.012-proud-thin/2,revealEdge+H.corner/2],'board-joint-dagkant');
    }

    /** A lining box with the 2 m stucwerk period on it: metric UVs, so a wall and the ceiling above it tile alike. */
    linedBox(group,size,position,material,options) {
        const mesh=this.box(group,size,position,material,options);metricUVs(mesh.geometry,position,2,2);return mesh;
    }

    /**
     * The floor slab itself — a smoothed cement screed or the bare structural floor. It is what "kaal beton" shows
     * (buildFloorFinish lays nothing over it), and it is the one material the extension and the house room share, so
     * the same scan and the same metric origin run through the doorbraak. 3 m period = the scan's own tile size.
     */
    screedFloor(m,key) {
        const floor=this.surface(key||(m.screed?'floor-screed':'floor'),{color:m.screed?'#f2f1ec':'#e2e0d8',roughness:1,
            map:'screedColor',normalMap:'screedNormal',roughnessMap:'screedRough',aoMap:'screedAo',aoMapIntensity:.7,
            normalScale:.45,envMapIntensity:RIG.interiorEnv});
        // The house room keeps its own material (the scene tests locate the room by it) but never its own look: it
        // follows whatever the extension's floor is, so "kaal beton" is one floor across the doorbraak, not two.
        if(key){const slab=this.screedFloor(m);floor.color.copy(slab.color);floor.needsUpdate=true;}
        return floor;
    }
    /** Floor slab box with the screed period on it. */
    screedBox(group,size,position,material,options) {
        const mesh=this.box(group,size,position,material,options);metricUVs(mesh.geometry,position,3,3);return mesh;
    }

    /** Device facts in, tier out. Pure decision in render_state.js so it can be unit tested without a GPU. */
    measureTier(width) {
        const r=this.renderer;
        // Nothing to measure without a WebGL renderer, so nothing changes: the constructor always measures with one.
        if(!r?.capabilities)return this.forcedQuality||this.quality;
        const media=typeof matchMedia==='function'?matchMedia('(pointer: coarse)'):null;
        const screenSize=typeof screen==='object'&&screen?Math.min(screen.width||Infinity,screen.height||Infinity):Infinity;
        return renderTier({width,webgl2:r.capabilities.isWebGL2,
            halfFloat:r.extensions.has('EXT_color_buffer_float')||r.extensions.has('EXT_color_buffer_half_float'),
            maxSamples:r.capabilities.maxSamples,coarsePointer:!!media?.matches,shortSide:screenSize,forced:this.forcedQuality});
    }

    /** A DPR above 1.75 costs more than it shows; a compact device stops at 1.25. An explicit option always wins. */
    pixelRatioFor(tier) {
        return this.pixelRatioOption ?? Math.min((typeof window!=='undefined'?window.devicePixelRatio:1)||1,tier==='compact'?1.25:1.75);
    }

    /**
     * A zoom or a move to a second monitor changes devicePixelRatio, which changes the drawing-buffer size and so the
     * composer targets. `(resolution: Xdppx)` stops matching at that moment; re-arm it for the new ratio each time.
     */
    watchPixelRatio() {
        if(this.pixelRatioOption!==undefined||typeof matchMedia!=='function')return;
        this.dprQuery?.removeEventListener?.('change',this._dprChange);
        const ratio=(typeof window!=='undefined'?window.devicePixelRatio:1)||1;
        try{this.dprQuery=matchMedia(`(resolution: ${ratio}dppx)`);}catch{this.dprQuery=null;return;}
        this._dprChange=()=>{if(this.disposed)return;this.watchPixelRatio();this.applyTier(this.measureTier(this.lastWidth||this.container.clientWidth),true);};
        this.dprQuery.addEventListener?.('change',this._dprChange,{once:true});
    }

    /**
     * The render quality chosen under Weergave → Kwaliteit (or the administrator's default): 'auto' measures the
     * device as before, 'full' and 'compact' force that tier. Returns whether the tier changed. The texture ladder is
     * picked when the scans load, so crossing between full-size and 512 px scans reloads them — once, on an explicit
     * choice, through the same path the first load takes.
     */
    setQuality(mode){
        this.forcedQuality=mode==='full'||mode==='compact'?mode:null;
        if(!this.renderer||this.failed||this.disposed)return false;
        const before=this.quality;
        if(!this.applyTier(this.measureTier(this.lastWidth||this.container.clientWidth)))return false;
        this.ensureComposer();
        if((before==='compact')!==(this.quality==='compact'))this.assetsReady=this.loadAssets();
        this.render();
        return true;
    }

    /** Switch tier (container crossed 600 px, or the pixel ratio moved): new DPR, new shadow map size, new composer. */
    applyTier(tier,pixelRatioChanged=false) {
        // An unmeasurable device (no capabilities) yields no tier: keep what we have rather than degrade blindly.
        if(!this.renderer||!['full','compact'].includes(tier)||(tier===this.quality&&!pixelRatioChanged))return false;
        this.quality=tier;
        this.renderer.setPixelRatio(this.pixelRatioFor(tier));
        const mapSize=tier==='compact'?1024:2048;
        if(this.sun&&this.sun.shadow.mapSize.x!==mapSize){this.sun.shadow.mapSize.set(mapSize,mapSize);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;}
        // A tier change is the one moment the lamp-slot count may move: it recompiles every material, so it happens
        // here (a container crossing 600 px) and nowhere else.
        this.buildLampSlots();this.assignLampLights();this.fitSunShadow();
        // The MSAA/AO targets are sized in drawing-buffer pixels: both inputs just changed, so rebuild rather than resize.
        this.disposeComposer();this.composerUnavailable=false;this.shadowsDirty=true;
        return true;
    }

    /**
     * Build the composer at the current drawing-buffer size, or resize the existing one. Called after the renderer
     * has been resized, never from the constructor (before the first resize the container size is unknown).
     */
    ensureComposer() {
        if(!this.renderer||this.composerSuspended)return;
        if(this.quality!=='full'){this.disposeComposer();return;}
        if(this.composer)this.sizeComposer(this.composer);
        else if(!this.composerUnavailable)this.setupComposer();
    }

    /**
     * EffectComposer.setSize() multiplies by ITS OWN pixel ratio (a copy of the renderer's, taken at construction),
     * so handing it drawing-buffer pixels ran every pass at DPR² — 13.5 MP instead of 4.4 MP at 1440×1000, DPR 1.75.
     * Handing it CSS pixels is half right: the renderer FLOORS the drawing buffer (Math.floor(css × dpr)) while the
     * composer does not, which leaves the targets half a pixel wider (1774.5 vs 1774) and shifts the GTAO texel grid.
     * So neutralise the composer's own ratio and give it the renderer's integer buffer size.
     */
    sizeComposer(composer) {
        const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
        composer.setPixelRatio(1);composer.setSize(Math.max(1,size.x),Math.max(1,size.y));
    }

    /** Ambient occlusion and MSAA for full-quality screens; compact screens keep the direct renderer. */
    setupComposer() {
        if(this.quality!=='full'||!this.renderer||this.composer)return;
        let target=null,composer=null;
        try {
            const size=this.renderer.getDrawingBufferSize(new THREE.Vector2()),w=Math.max(1,size.x),h=Math.max(1,size.y);
            target=new THREE.WebGLRenderTarget(w,h,{type:THREE.HalfFloatType,samples:4});
            // An unsupported multisampled HalfFloat attachment does not throw, it renders black. Probe it once.
            this.renderer.setRenderTarget(target);
            const gl=this.renderer.getContext(),status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            this.renderer.setRenderTarget(null);
            this.framebufferStatus=status;
            if(status!==gl.FRAMEBUFFER_COMPLETE)throw new Error(`incomplete multisampled framebuffer (0x${status.toString(16)})`);
            composer=new EffectComposer(this.renderer,target);
            composer.addPass(new RenderPass(this.scene,this.camera));
            const ao=new GlazingAwareGTAOPass(this.scene,this.camera,w,h);
            ao.blendIntensity=.85;
            // Contact shading, not a grey wash: a 35 cm radius darkens a skirting and a table leg, not a whole wall.
            ao.updateGtaoMaterial({radius:.35,distanceExponent:1.6,thickness:1.2,scale:1,samples:12,distanceFallOff:1});
            ao.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:5,rings:2,samples:12});
            composer.addPass(ao);composer.addPass(new OutputPass());
            // After the passes: addPass() sizes each new pass with the ratio still in place, so re-size them all here.
            this.sizeComposer(composer);
            this.composer=composer;this.aoPass=ao;this.shadowsDirty=true;
        } catch(error) {
            // Graceful degradation: without post-processing the direct renderer still shows the full design.
            this.aoPass=null;this.composerUnavailable=true;
            // A half-built composer still owns its targets; disposeComposer() releases them without touching the
            // full-screen triangle geometry three shares between every pass on the page.
            this.composer=composer;
            try{this.disposeComposer();target?.dispose();this.renderer.setRenderTarget(null);}catch{/* the context is already gone */}
            this.composer=null;
            console.warn('Ambient occlusion unavailable',error);
        }
    }

    /**
     * Document capture builds a second WebGL context: free our post-processing targets while it works (iGPU memory).
     * Only while this preview is actually drawing 3D — behind the flat plan nothing would redraw afterwards, so the
     * fresh targets would sit unallocated and the capture would leave a trace in renderer.info.memory.
     */
    suspendComposer() {
        if(this.composerSuspended||!this.composer||this.mode!=='3d')return false;
        this.composerSuspended=true;this.disposeComposer();return true;
    }
    resumeComposer() {
        if(!this.composerSuspended)return false;
        this.composerSuspended=false;this.composerUnavailable=false;
        this.ensureComposer();this.render();return true;
    }

    /**
     * Three's full-screen passes share one triangle geometry across every renderer on the page. Disposing it
     * from a temporary document renderer would make the live preview re-upload it, so give each pass a
     * private placeholder before releasing the composer's render targets and materials.
     */
    disposeComposer() {
        if(!this.composer)return;
        const passes=[...this.composer.passes,this.composer.copyPass];
        for(const pass of passes){const quad=pass?._fsQuad;if(quad?._mesh)quad._mesh.geometry=new THREE.BufferGeometry();}
        for(const pass of this.composer.passes)pass.dispose?.();
        this.composer.dispose();this.composer=null;this.aoPass=null;
    }

    /** The lighting sky: the raw hotspot clamped, so it cannot blow out glass, zinc or chrome. Falls back to the raw HDR. */
    skyForLighting(texture){return clampedSkyTexture(texture,6)||texture;}

    /**
     * Make a material's own `envMapIntensity` actually reach the shader. three 0.180 (three.module.js L17341) does:
     *   if (material.isMeshStandardMaterial && material.envMap === null && scene.environment !== null)
     *       m_uniforms.envMapIntensity.value = scene.environmentIntensity;
     * — so for every standard/physical material WITHOUT an envMap of its own the per-material value is silently
     * overwritten by the scene's. Measured: setting `painted.envMapIntensity = 0` changed the rendered wall by
     * exactly zero counts, while `scene.environmentIntensity = 0` moved it 60. Pointing the material at the very
     * same PMREM texture restores the material uniform (L14313) and resolves to the identical shader program
     * (L6832 uses `material.envMap || environment`), so this costs one uniform refresh and no recompile.
     */
    bindEnvironment() {
        const environment=this.scene?.environment;
        if(!environment)return 0;
        let bound=0;
        for(const material of this.materials.values()){
            if(!material.isMeshStandardMaterial||material.envMapIntensity===this.environmentIntensity)continue;
            if(material.envMap===environment)continue;
            material.envMap=environment;material.needsUpdate=true;bound++;
        }
        return bound;
    }

    /**
     * Align the shadow-casting sun with the sun in the sky image, so the cast shadows agree with the backdrop.
     * Always fed the RAW HDR: the clamped copy has no hotspot left to find.
     */
    alignSunWithSky(texture) {
        const direction=equirectSunDirection(texture);
        if(!direction||direction.y<.08||!this.sun)return;
        this.sun.position.copy(direction).multiplyScalar(14);this.sun.target.position.set(0,0,0);
        this.sun.updateMatrixWorld();this.sun.target.updateMatrixWorld();
        // The fill sits opposite the sun: it opens the shaded facade without adding a second set of highlights.
        this.fill.position.set(-direction.x*6,4,-direction.z*6);
        this.fitSunShadow();
        this.shadowsDirty=true;
    }

    /**
     * Fit the sun's orthographic shadow frustum to what is actually in the picture — the prefab, its terrace, the
     * existing house (whose roof throws the long afternoon shadow across the garden) and the neighbours while they
     * are shown. A fixed ±12 m box spent most of its texels on empty grass; the fit brings the same 2048 px map to
     * 1,15 cm per texel on a terraced plot (1,06 detached, 2,31 on the compact tier's 1024), reported as
     * rendering.sunShadow.texel. PCF-soft spreads over ≈2 texels, so the penumbra lands near the sun's real one
     * (0,53° ≈ 2,8 cm at terrace distance) instead of being either razor-sharp or a smudge.
     */
    fitSunShadow() {
        const sun=this.sun,m=this.model;
        if(!sun?.shadow||!m)return null;
        const b=m.bounds,lay=houseLayout(this.environment,m),around=this.surroundingsVisible!==false;
        const neighbours=around&&this.neighbourGroup?.visible!==false;
        // With the omgeving switched off there is no house roof throwing an afternoon shadow and no garden to throw
        // it across: the frustum shrinks to the aanbouw, its terras and the ground the building's own shadow lands
        // on, which spends the same 2048 px on a third of the area. The 4 m margin is that shadow's reach, not a
        // round number — a 2,8 m wall with the sun at the rig's 46° throws 2,7 m, and a frustum any tighter cuts
        // the shadow off mid-terrace with a straight edge across an otherwise empty studio floor.
        const x0=around?Math.min(neighbours?lay.roofLeft:lay.left,b.left-4):b.left-4,
            x1=around?Math.max(neighbours?lay.roofRight:lay.right,b.right+4):b.right+4;
        const z0=around?b.back-lay.houseDepth-1:b.back-4,z1=around?b.front+6:b.front+4,y0=-.3,y1=m.height+(around?6.5:2.5);
        const view=new THREE.Matrix4().lookAt(sun.position,sun.target.position,UP).setPosition(sun.position).invert();
        const point=new THREE.Vector3();let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity,near=Infinity,far=-Infinity;
        for(const x of [x0,x1])for(const y of [y0,y1])for(const z of [z0,z1]){
            point.set(x,y,z).applyMatrix4(view);
            left=Math.min(left,point.x);right=Math.max(right,point.x);bottom=Math.min(bottom,point.y);top=Math.max(top,point.y);
            // The camera looks down -z, so the nearest corner has the largest (least negative) z.
            near=Math.min(near,-point.z);far=Math.max(far,-point.z);
        }
        const camera=sun.shadow.camera;
        camera.left=left-.5;camera.right=right+.5;camera.bottom=bottom-.5;camera.top=top+.5;
        camera.near=Math.max(.1,near-1);camera.far=far+1;camera.updateProjectionMatrix();
        this.shadowTexel=Math.max(camera.right-camera.left,camera.top-camera.bottom)/sun.shadow.mapSize.x;
        this.shadowsDirty=true;
        return this.shadowTexel;
    }

    /**
     * Per-view lighting. Exposure changes because the subject changes; the interior bounce light and the lamp rig
     * are driven by INTENSITY, never by `.visible` — three keys its shader programs on the number of visible lights
     * per type, so hiding one recompiles every material in the scene (a 1–2 s hitch on Windows ANGLE).
     */
    applyViewLighting(view=this.view) {
        const inside=['interior','ceiling','cutaway'].includes(view);
        if(this.renderer)this.renderer.toneMappingExposure=VIEW_EXPOSURE[view]??VIEW_EXPOSURE.perspective;
        // Not zero outside: the room seen through the pui is the second thing a visitor looks at, and it needs the
        // same warm bounce as the interior views, only weaker so it does not glow out of the opening.
        if(this.interiorFill)this.interiorFill.intensity=inside?RIG.interiorFill:RIG.exteriorFill;
        if(this.houseFill)this.houseFill.intensity=inside?RIG.houseFill:RIG.houseFill*.35;
        this.shadowsDirty=true;
        return inside;
    }

    setBackdrop(mode) {
        this.backdrop=mode==='plain'?'plain':'sky';
        this.applyBackdrop();
        this.render();
    }
    /**
     * What is behind everything, without drawing a frame. Split out from setBackdrop because buildScene and the
     * omgeving switch both have to set it and neither may render: a render inside a build spends the shadow pass the
     * build's own render was going to spend, and the scene then costs two per structural change instead of one
     * (verify-rendering.mjs gate 2 counts exactly this).
     *
     * The studio wins over `backdrop` rather than replacing it: the sky texture arriving mid-capture calls
     * setBackdrop, and without this order a proposal image would get its clouds back halfway through the six views.
     */
    applyBackdrop() {
        if(!this.scene)return;
        if(this.surroundingsVisible===false){
            // The paper of the technical drawings, with the fog closing the ground into it: no horizon, no sky,
            // no cut edge where the plane stops. scene.environment is untouched — see STUDIO.
            this.scene.background=new THREE.Color(STUDIO.paper);
            this.scene.fog.color.set(STUDIO.paper);this.scene.fog.near=STUDIO.fogNear;this.scene.fog.far=STUDIO.fogFar;
            return;
        }
        // The sky's haze is a light cloud tone since 2.10.5: the ground beyond the plot dissolves into it (PLOT), and a
        // cloud layer reads as air under the plot where the old mid grey (#bfc6cd) read as a concrete floor.
        if(this.backdrop==='sky'&&this.skyTexture){this.scene.background=this.skyTexture;this.scene.backgroundBlurriness=.035;this.scene.backgroundIntensity=.95;this.scene.fog.color.set('#dde2e7');this.scene.fog.near=30;this.scene.fog.far=115;}
        else{this.scene.background=new THREE.Color('#e7e9e5');this.scene.fog.color.set('#e7e9e5');this.scene.fog.near=27;this.scene.fog.far=60;}
        this.horizonMist?.material.color.copy(this.scene.fog.color);
    }

    async loadAssets() {
        const generation=this.assetLoadGeneration=(this.assetLoadGeneration||0)+1;
        const current=()=>!this.disposed&&!this.failed&&generation===this.assetLoadGeneration;
        const loader=new THREE.TextureLoader();
        // Compact devices load the 512 px ladder and skip the AO maps altogether: a third of the texture memory and
        // a third of the samplers, for detail nobody sees at that pixel density. `_512` siblings exist for every
        // colour/normal/roughness map and for none of the AO maps (material_assets.test.mjs proves the ladder).
        const compact=this.quality==='compact';
        // Every brick finish is ONE wall in four clay colours: the black, white and yellow albedos are recoloured
        // from the red scan (scripts/prepare_facade_textures.py) and all four share its relief and its roughness, so
        // the bond, the brick size and the weathering stay identical across the four swatches a customer compares.
        // The wood albedo is the wood_floor_deck scan retoned from varnished floor to oiled cladding — that keeps it
        // registered pixel for pixel with the normal and roughness maps of the same scan, which already shipped.
        // [key, file, sRGB colour map?, AO map?]
        // 2.17.0: "Baksteen rood" is the lighter salmon recolour too (the owner's reference brick); the scan itself
        // stays on disk as the source of all four and is no longer fetched.
        const entries=[['brickColor','brick_red_diffuse.jpg',true],['brickNormal','red_brick_03_nor_gl.jpg'],['brickRough','red_brick_03_rough.jpg'],
            ['brickBlackColor','brick_black_diffuse.jpg',true],['brickWhiteColor','brick_white_diffuse.jpg',true],['brickYellowColor','brick_yellow_diffuse.jpg',true],
            ['woodColor','wood_facade_diffuse.jpg',true],['woodNormal','wood_floor_deck_nor_gl.jpg'],['woodRough','wood_floor_deck_rough.jpg'],
            // The modern fence's hardwood slats (2.12.0): the deck scan's own warm albedo, registered with the two maps above.
            ['deckColor','wood_floor_deck_diffuse.jpg',true],
            ['houseColor','house_plaster_diffuse.jpg',true],['houseNormal','house_plaster_nor_gl.jpg'],
            ['terraceColor','terrace_gravel_tile_diffuse.jpg',true],['terraceNormal','terrace_gravel_tile_nor_gl.jpg'],['terraceRough','terrace_gravel_tile_rough.jpg'],
            ['grassColor','garden_grass_diffuse.jpg',true],['grassNormal','garden_grass_nor_gl.jpg'],
            ['roofColor','roof_bitumen_diffuse.jpg',true],['roofNormal','roof_bitumen_nor_gl.jpg'],
            ['tileColor','roof_tiles_diffuse.jpg',true],['tileNormal','roof_tiles_nor_gl.jpg'],['tileRough','roof_tiles_rough.jpg'],
            ['laminateColor','laminate_floor_diffuse.jpg',true],['laminateNormal','laminate_floor_nor_gl.jpg'],['laminateRough','laminate_floor_rough.jpg'],
            ['laminateAo','laminate_floor_ao.jpg',false,true],
            ['parquetColor','parquet_herringbone_diffuse.jpg',true],['parquetNormal','parquet_herringbone_nor_gl.jpg'],['parquetRough','parquet_herringbone_rough.jpg'],
            ['parquetAo','parquet_herringbone_ao.jpg',false,true],
            // Interior stucwerk carries no colour scan on purpose: the paint tint is the colour (see lining()).
            ['stucNormal','interior_plaster_nor_gl.jpg'],['stucRough','interior_plaster_rough.jpg'],['stucAo','interior_plaster_ao.jpg',false,true],
            ['screedColor','concrete_screed_diffuse.jpg',true],['screedNormal','concrete_screed_nor_gl.jpg'],['screedRough','concrete_screed_rough.jpg'],
            ['screedAo','concrete_screed_ao.jpg',false,true],
            ['fenceColor','garden_fence_diffuse.jpg',true],['fenceNormal','garden_fence_nor_gl.jpg'],['fenceRough','garden_fence_rough.jpg'],
            ['fenceAo','garden_fence_ao.jpg',false,true],
            // Green roof. Everything but the sedum colour map ships at 512 px, so those `_512` siblings are
            // byte-identical copies and the compact rule below still applies without a special case. The ballast
            // carries no roughness or AO map on purpose: loose gravel is uniformly matte (see the provenance note).
            ['sedumColor','sedum_mat_diffuse.jpg',true],['sedumNormal','sedum_mat_nor_gl.jpg'],['sedumRough','sedum_mat_rough.jpg'],
            ['sedumAo','sedum_mat_ao.jpg',false,true],
            ['ballastColor','roof_ballast_diffuse.jpg',true],['ballastNormal','roof_ballast_nor_gl.jpg']];
        const loaded=await Promise.allSettled(entries.filter(([,,,ao])=>!(compact&&ao)).map(async([key,file,color,ao])=>{
            const name=compact&&!ao?file.replace(/\.jpg$/,'_512.jpg'):file;
            const texture=await loader.loadAsync(assetUrl(`./assets/materials/${name}`));
            if(!current()){texture.dispose();return;}
            texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(compact?4:8,this.renderer.capabilities.getMaxAnisotropy());
            if(color)texture.colorSpace=THREE.SRGBColorSpace;
            if(this.maps[key]){this.maps[key].dispose();this.textures.delete(this.maps[key]);}
            this.maps[key]=texture;this.textures.add(texture);
        }).concat([(async()=>{
            const hdr=await new HDRLoader().loadAsync(assetUrl('./assets/materials/kloofendal_48d_partly_cloudy_puresky_hdri.hdr'));
            if(!current()){hdr.dispose();return;}
            let generator,kept=false,lit=null;
            try {
                // The sun disc of the raw HDR is thousands of times brighter than the sky around it. Both the
                // environment and the visible backdrop use the clamped copy; only alignSunWithSky needs the hotspot.
                lit=this.skyForLighting?.(hdr)??hdr;
                generator=new THREE.PMREMGenerator(this.renderer);
                const target=generator.fromEquirectangular(lit);
                this.environmentTarget?.dispose();this.environmentTarget=target;this.scene.environment=target.texture;
                this.scene.environmentIntensity=this.environmentIntensity;
                lit.mapping=THREE.EquirectangularReflectionMapping;
                if(this.skyTexture&&this.skyTexture!==lit){this.skyTexture.dispose();this.textures.delete(this.skyTexture);}
                this.skyTexture=lit;this.textures.add(lit);kept=true;
                this.alignSunWithSky?.(hdr);this.setBackdrop?.(this.backdrop||'sky');
                if(lit!==hdr)hdr.dispose();
            } finally {if(!kept){hdr.dispose();if(lit&&lit!==hdr)lit.dispose();}generator?.dispose();}
        })()]));
        if(!current())return false;
        this.assetLoadFailures=loaded.filter(result=>result.status==='rejected').length;
        // Rebuild material bindings once after the current local scan set settles.
        for(const [key,material] of this.materials)if(key.startsWith('facade:')||key.startsWith('surface:')){material.dispose();this.materials.delete(key);}
        this.update(this.config,{force:true});
        // The PMREM has only just arrived: give every material that wants its own env strength a handle on it.
        this.bindEnvironment?.();
        return true;
    }

    box(group,size,position,material,{shadow=true}={}) {
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...position);
        mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);return mesh;
    }

    /**
     * Join an object to the form field it belongs to, so a click on it opens that field. selectAt walks up to the
     * FIRST tagged ancestor, so always tag the smallest part a customer would point at: a tag on a big parent is
     * then only reached when nothing smaller was hit (the facade wall never steals a click meant for the daktrim).
     */
    tag(object,key) {
        if(object)object.userData.scopeKey=key;
        return object;
    }

    /**
     * The wall material for one facade finish. Every brick and every wood finish is a photographic scan since
     * 2.9.4: the four bricks share red_brick_03's relief and roughness and differ only in the recoloured albedo
     * (FACADE_SCANS), the four wood finishes share the wood_floor_deck scan outright. `facadeTexture` — a canvas
     * pattern with a bumpMap made of itself — is what is left for the coated finishes (pvc, stucwerk), which ARE
     * flat, and for the moment before the scans have arrived.
     */
    facade(code) {
        const key=`facade:${code}`;
        if(!this.materials.has(key)){
            const brick=code.startsWith('brick'),wood=code.startsWith('wood')||code.startsWith('open');
            const scanned=this.maps[FACADE_SCANS[code]];
            const texture=scanned||facadeTexture(code);if(!scanned)this.textures.add(texture);
            const normalMap=(brick?this.maps.brickNormal:wood?this.maps.woodNormal:null)||null;
            const roughnessMap=(brick?this.maps.brickRough:wood?this.maps.woodRough:null)||null;
            // Brick relief is deep and the mortar joints have to read from the terrace; sawn cladding is flatter, but
            // .16 was a figure for a procedural colour map and left the boards without an edge — .3 is the board.
            // Roughness: the brick map averages .53 and the deck map .44, so the factors land the wall at .49 (matte
            // fired clay) and the boards at .40 (oiled timber, a little sheen at grazing sun, never a gloss).
            const scale=brick?.45:.3;
            // The 2.16.0 lift (2.15) brightened DARK clay by the environment. The red brick now carries its lightness
            // in the albedo itself (2.17.0), and stacked on a light albedo that lift overshoots into pink — measured
            // #ce9f9b against the reference's #b5857a at 1.0 — so the red is lit like any wall and the others keep it.
            const lift=code==='brick-red'?1:brick?2.15:1;
            this.materials.set(key,new THREE.MeshStandardMaterial({map:texture,normalMap,normalScale:new THREE.Vector2(scale,scale),bumpMap:brick&&!scanned?texture:null,bumpScale:.002,roughnessMap,roughness:brick?.93:.9,envMapIntensity:lift,color:'#ffffff'}));
        }
        return this.materials.get(key);
    }

    /**
     * Metres per texture tile for a finish, and whether the scan has to be turned a quarter turn to get there.
     *
     * Brick: 0,88 m puts the scan's 14 courses at 63 mm — Dutch waalformaat (50 mm brick + 12,5 mm joint) — and its
     * bond at a 182 mm brick module. All four colours are the same wall, so they share the one period.
     * Wood: the deck scan is 12 boards wide, so 12 x 12 cm = 1,44 m lands one scanned board on every cladding groove
     * buildCladding draws, and 12 x 5 cm = 0,60 m does the same for the 5 cm battens of an opengevel (the boards are
     * stretched to 2x along their length there, which the grain hides). Their boundaries sit at whole twelfths of the
     * tile, and the grooves at whole multiples of their pitch from the world origin, so the two meet without a phase.
     * `turn`: the boards run along the image's u axis and metricUVs maps u to the wall's horizontal, so horizontal
     * cladding maps straight and vertical cladding is the same scan with u and v swapped (facadeUVs).
     * pvc and stucwerk keep the pre-2.9.4 period of the canvas pattern they still use.
     */
    facadePeriods(code) {
        if(code.startsWith('brick'))return{periodX:.88,periodY:.88,turn:false};
        if(!code.startsWith('wood')&&!code.startsWith('open'))return{periodX:.96,periodY:2,turn:false};
        const open=code.startsWith('open'),across=open?.60:1.44,along=open?1.2:1.44;
        return code.includes('horizontal')?{periodX:along,periodY:across,turn:false}:{periodX:across,periodY:along,turn:true};
    }

    /** metricUVs for a facade surface, with the quarter turn vertical cladding needs. u ends up along the boards. */
    facadeUVs(geometry,at,code) {
        const {periodX,periodY,turn}=this.facadePeriods(code);
        metricUVs(geometry,at,periodX,periodY);
        if(turn){const uv=geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getY(i),uv.getX(i));uv.needsUpdate=true;}
        return geometry;
    }

    facadeBox(group,size,position,baseMaterial,code) {
        for(const slot of ['map','normalMap','roughnessMap'])baseMaterial[slot]?.repeat.set(1,1);
        const mesh=this.box(group,size,position,baseMaterial);this.facadeUVs(mesh.geometry,position,code);
        mesh.userData={surface:'facade',scopeKey:'facade',facadeSize:size};return mesh;
    }

    update(config,{force=false}={}) {
        if(this.disposed)return;
        const old=this.model,change=force?'structure':sceneChange(old?this.config:null,config);this.config=structuredClone(config);this.model=buildGeometry(config,{fixtureLayout:this.placement,scope:this.scope});
        this.updatePlan();
        if(this.renderer&&!this.failed) {
            try {
                if(change==='structure')this.buildScene();
                else if(change==='material'){this.updateFacade();this.buildFixtures();}
                else if(change==='fixtures')this.buildFixtures();
                if(change!=='none')this.shadowsDirty=true;
                if(change==='structure'&&this.scenario&&this.scenario!=='none')this.applyScenario();
                // Newly chosen underfloor heating is laid in front of the visitor instead of switching cameras.
                if(old&&this.view==='interior'&&this.model.underfloorLoops?.length&&!old.underfloorLoops?.length)this.playUnderfloorAnimation();
                if(!old)this.resize();
                else if(this.cameraFocus)this.refreshCameraFocus();
                else if(!this.cameraTouched&&(old.width!==this.model.width||old.depth!==this.model.depth||old.height!==this.model.height))this.fitCamera({render:false});
                this.render();
            }
            catch(error){this.fallback(error);}
        }
        this.applyMode();
    }

    updatePlan(){if(this.model)this.plan.innerHTML=planSvg(this.model,this.dimensionsVisible,{scope:this.scope,examplesVisible:this.examplesVisible,interactive:true});}

    updateFacade(){
        this.buildCounts.material++;const code=this.model.facade,material=this.facade(code);
        for(const slot of ['map','normalMap','roughnessMap'])material[slot]?.repeat.set(1,1);
        this.root.traverse(object=>{if(object.userData.surface!=='facade')return;object.material=material;this.facadeUVs(object.geometry,object.position.toArray(),code);});
        this.buildCladding();
    }

    /**
     * Panel material for "geen rollaag wit/zwart" (frame colour); null when the facade continues (rollaag).
     * The panel belongs to the HOLE, not to the door in it: until 2.17.0 it waited for a kozijn with leaves
     * (opening.panelCount), which was invisible while a sliding door was the default and became a bug the day "Geen
     * deur" became the starting choice — the Rollaag card comes before the Kozijn card, so the owner chose a panel
     * and the picture kept its brick until the next card was touched. "Geen kozijn" still leaves the hole and its
     * outer frame (geometry.js: every kozijn leaves a real hole), and that is all the panel needs.
     */
    rollaagPanel(m){
        if(m.rollaag==='masonry'||!(m.opening.width>0))return null;
        return this.material(`rollaag:${m.rollaag}`,{color:m.rollaag==='panel-white'?'#efede6':'#303432',roughness:.5});
    }

    release(group) {
        if(!group)return;
        const geometries=new Set();group.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.isInstancedMesh)object.dispose();if(object.userData.ownedMaterial){for(const slot of ['map','normalMap','roughnessMap'])object.material[slot]?.dispose();object.material.dispose();}});
        geometries.forEach(geometry=>geometry.dispose());group.removeFromParent();
    }

    buildScene() {
        this.buildCounts.structure++;
        this.clearHighlight();
        this.release(this.root);this.root=new THREE.Group();this.scene.add(this.root);
        const m=this.model,b=m.bounds;
        // 'painted' is the finished paint of the existing house's room (see makeExistingRoom); the extension shares that
        // very material once stucwerk and schilderwerk are chosen, so both rooms read as one colour.
        // Interior surfaces see a room, not an open sky: at the full environment intensity the walls picked up the
        // sky's blue and the paint read grey-blue instead of the warm off-white on the colour card.
        const facade=this.facade(m.facade),painted=this.lining('painted');
        const white=m.painting?painted:this.lining('plaster');
        // Delivered as grey gipsplaat (plasterboard); stucwerk is applied on top of it later.
        const innerFinish=m.plaster?white:this.lining('gypsum');
        // The wall tag follows the finish you are LOOKING at: gipsplaat and stucwerk answer to "Wel of geen stucwerk",
        // a painted wall answers to "Schilderwerk". Both controls sit in the same card, so either way the click lands
        // on the right section — but the highlighted field is the one that describes what is in front of you.
        const finishKey=m.interior&&m.plaster&&m.painting?'painting':'plaster';
        const floorMat=this.screedFloor(m);
        this.sceneryGroup?.removeFromParent();
        const dark=this.material('dark',{color:'#353b38',roughness:.48,metalness:.35});
        // Anodised aluminium is a real metal: almost all of its light is the reflected environment, which is why it
        // reads as a frame and not as a painted plank. Wood and PVC stay dielectric (painted timber, matte plastic).
        const aluminium=m.openingMaterial==='aluminium';
        const frame=this.material(`frame:${m.opening.frame}:${m.openingMaterial}`,{color:m.opening.frame,
            roughness:m.openingMaterial==='wood'?.72:m.openingMaterial==='pvc'?.42:aluminium?.34:.29,
            metalness:aluminium?.85:.05,envMapIntensity:aluminium?1.1:1});
        // Clear glazing. A near-black diffuse with One / OneMinusSrcAlpha blending makes the pane ADD its own Fresnel
        // reflection (sky, sun, surroundings) at full strength over a scene behind it that is darkened 14 % — the room
        // stays as sharp and as bright as the facade, which plain alpha blending cannot do (it multiplies the
        // reflection by the opacity too, so the glass reads as "tinted nothing"). userData.glazing keeps the panes out
        // of the GTAO G-buffer (GlazingAwareGTAOPass), where a 6 mm pane would smear AO over the whole room.
        const glazing=side=>{
            const material=new THREE.MeshPhysicalMaterial({color:'#0b100e',roughness:.02,metalness:0,ior:1.52,specularIntensity:1,
                envMapIntensity:1,transparent:true,opacity:.14,side,depthWrite:false,
                blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,
                blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor});
            material.userData.glazing=true;return material;
        };
        // Panes are 6 mm solids: FrontSide draws one layer, DoubleSide would add the reflection twice. The rooflight
        // panels are single quads seen from above AND from the room below, so those keep both faces.
        if(!this.materials.has('glass'))this.materials.set('glass',glazing(THREE.FrontSide));
        if(!this.materials.has('glass-rooflight'))this.materials.set('glass-rooflight',glazing(THREE.DoubleSide));
        const glass=this.materials.get('glass');
        // Tint measured down from '#dcdfdb': at that value the paving was the brightest thing in every exterior view
        // (b2_swatch: lit dL +10.4 against its own albedo, where every other lit surface lands within ±5).
        const terrace=this.surface('terrace',{color:'#c8cbc7',roughness:1,map:'terraceColor',normalMap:'terraceNormal',roughnessMap:'terraceRough',normalScale:.7});
        const ground=this.surface('ground',{color:'#8fb277',roughness:1,map:'grassColor',normalMap:'grassNormal',normalScale:.55});
        // Everything that is not the product for sale hangs under ONE group from here on (see setSurroundingsVisible):
        // the lawn, the existing house, the buren, the tuinaankleding and the voorbeeldinrichting. Their own visitor
        // switches keep working untouched — three hides a child whose parent is hidden either way — and a proposal
        // image now has a single thing to switch instead of five it has to remember to name.
        this.surroundingsGroup=new THREE.Group();this.surroundingsGroup.name='surroundings';this.root.add(this.surroundingsGroup);
        // Its counterpart, shown exactly when the omgeving is not: the studio floor described at STUDIO.
        this.studioGroup=new THREE.Group();this.studioGroup.name='studio-ground';this.studioGroup.visible=false;this.root.add(this.studioGroup);
        this.box(this.studioGroup,[400,.05,400],[0,-.23,0],this.material('studio-ground',{color:STUDIO.ground,roughness:1}),{shadow:false});
        const lawn=this.box(this.surroundingsGroup,[400,.05,400],[0,GROUND.plane-.025,0],ground,{shadow:false});lawn.name='ground-grass';
        metricUVs(lawn.geometry,[0,-.23,0],6,6);
        // The 400 m plane stays out of the AO G-buffer: seen at a grazing angle near the horizon, GTAO shaded it into a
        // dark line exactly where the haze meets the sky (measured: gone with AO off). Contact shading where it
        // matters is kept by the garden lawn, the terrace and the slab, which are their own meshes and stay in.
        lawn.userData.excludeFromAO=true;
        this.fadeLawn(ground);this.updatePlotFade(m);this.surroundingsGroup.add(this.makeHorizonMist());
        // The terrace, in TWO pieces, because they answer to two different questions (DOCUMENT_PARTS).
        //
        // `terrace-slab` is the concrete the aanbouw is delivered onto: it carries the building's contact shadow and
        // a proposal image without it shows a box hanging in the air. `terrace-apron` is the two metres that reach
        // into the garden (PLOT.terrace, 3,20 m since 2.13.1) so a table with chairs stands on paving — useful in a picture of a garden, paper in a
        // picture of a product. Neither is part of the omgeving, so neither hangs from `surroundingsGroup`; both are
        // named so a measurement can tell the paving apart from the product standing on it.
        //
        // They ABUT at the front face of the building and overlap by 5 mm there, deliberately: exactly coplanar end
        // faces are two faces at one depth and would flicker. The UVs come from metricUVs with each piece's own world
        // centre, and metricUVs writes uv from WORLD coordinates — so the tile pattern crosses the joint without
        // either piece knowing the joint is there, the same rule the house wall's seam is built on.
        // A rebuild makes fresh groups, so the handles are reset here rather than trusted from the constructor.
        this.partGroups={};
        this.partGroups.slab=this.documentPart('slab','terrace-slab',this.root);
        this.partGroups.terrace=this.documentPart('terrace','terrace-apron',this.root);
        // Together they cover exactly the plane the single mesh covered: z from b.back-0,275 to b.front+PLOT.terrace.
        const APRON=PLOT.terrace,LAP=.005;
        // 12 cm of paving, drawn 5 mm into the ground: level with the grass it looked as if it hovered over it.
        const deck=.12+(GROUND.paving-.12-GROUND.plane)+.005,deckY=GROUND.paving-deck/2;
        const slabAt=[0,deckY,(b.back-.275+b.front)/2],apronAt=[0,deckY,b.front+(APRON-LAP)/2];
        const slab=this.box(this.partGroups.slab,[m.width+.55,deck,b.front-b.back+.275],slabAt,terrace);slab.name='terrace';
        metricUVs(slab.geometry,slabAt,1.3,1.3);
        const reach=this.box(this.partGroups.terrace,[m.width+.55,deck,APRON+LAP],apronAt,terrace);reach.name='terrace-reach';
        metricUVs(reach.geometry,apronAt,1.3,1.3);
        // A joint between two paving tiles is a shadow gap, not a grout line: at '#b8b6a7' these strips read as white
        // stripes painted across the terrace, which is the first thing the eye lands on in every exterior view.
        // They lie on the apron, so they leave with it.
        for(let x=b.left-.2;x<b.right+.2;x+=.65)this.box(this.partGroups.terrace,[.012,.003,APRON-.1],[x,-.048,b.front+APRON/2-.02],this.material('joint',{color:'#7a7469',roughness:1}),{shadow:false}).name='terrace-joint';
        // The structural slab stays 1 cm inside the outer faces: flush with them, its light edge was a white strip along
        // the foot of every wall, and where it shared the plane with the brick the two z-fought into a speckled band.
        // The walls themselves run down to the paving (FOOTING below), so the building stands on the terrace.
        this.box(this.root,[m.width-.02,.12,m.depth-.02],[0,.01,0],this.material('slab-edge',{color:'#55585a',roughness:.95}));
        // The floor slab you stand on is the afwerkvloer decision; the structural box under it stays untagged.
        this.tag(this.screedBox(this.root,[m.width-2*m.wall,.018,m.depth-m.wall],[0,.082,-m.wall/2],floorMat,{shadow:false}),'screed');
        this.buildFloorFinish(m);
        // Seams between the floor elements, drawn only while no afwerkvloer covers them. Like the paving above, a joint
        // is a shadow gap and must read DARKER than the slab: at '#9e9e96' these strips lit up as bright white lines
        // across the room under the interior exposure, which is what the customer reported.
        if(!m.screed){const joint=this.material('floor-joint',{color:'#6d6e69',roughness:1});for(let x=b.left+m.wall+.6;x<b.right-m.wall;x+=1.2)this.box(this.root,[.004,.002,m.depth-m.wall],[x,.093,-m.wall/2],joint,{shadow:false});}
        // "Geen rollaag wit/zwart": the wall above the frame is itself the panel — flush, touching the frame — not a plate.
        const panel=this.rollaagPanel(m);
        // A masonry rollaag is a course of bricks standing on end over the opening, in the same facade as the rest of
        // the wall, and the wall above it carries on as before (2.16.0: "tam kapı üstündeki kısımda tuğlalar 1 sıra
        // dikey olarak yerleştiriliyor, dikine, seçilen yüzey materyali ile aynı renkte"). Until now it was drawn as
        // ordinary brickwork, so the customer paid for something that was nowhere in the picture. The course is the
        // facade material with its UVs turned a quarter: the same brick, on end, with its own joints.
        if(!panel&&m.opening.width>0&&m.facade.startsWith('brick')){
            const o=m.opening,course=.21,at=[0,o.bottom+o.height+course/2,m.bounds.front+.014];
            const stand=this.box(this.root,[o.width+.02,course,.028],at,facade);
            const {periodX,periodY}=this.facadePeriods(m.facade);
            metricUVs(stand.geometry,at,periodY,periodX);
            const uv=stand.geometry.attributes.uv;
            for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getY(i),uv.getX(i));
            uv.needsUpdate=true;
            stand.name='rollaag-course';stand.userData={surface:'rollaag',scopeKey:'rollaag'};
        }
        for(const wall of m.walls){
            if(wall.key==='front-header'&&panel)this.box(this.root,wall.size,wall.center,panel).userData={surface:'rollaag',scopeKey:'rollaag'};
            // A masonry rollaag has no panel: the strip above the frame is brickwork. It is still the rollaag choice,
            // so it carries that tag instead of the facade's — the rest of the wall keeps 'facade'.
            else{
                // A wall standing on the floor slab is drawn down to the paving (2.13.0): the 5 cm between the terrace and
                // the slab top is facade, not a light slab edge. Only the drawing grows; m.walls keeps its dimensions.
                const onFloor=Math.abs(wall.center[1]-wall.size[1]/2)<1e-6,size=onFloor?[wall.size[0],wall.size[1]+FOOTING,wall.size[2]]:wall.size;
                const at=onFloor?[wall.center[0],wall.center[1]-FOOTING/2,wall.center[2]]:wall.center;
                this.tag(this.facadeBox(this.root,size,at,facade,m.facade),wall.key==='front-header'&&m.opening.width>0?'rollaag':'facade');
            }
        }
        this.buildCladding();
        // Separate inside faces keep exterior materials outside the room.
        this.linedBox(this.root,[.008,m.height-.1,m.depth-m.wall],[b.left+m.wall+.004,m.height/2,-m.wall/2],innerFinish);
        this.linedBox(this.root,[.008,m.height-.1,m.depth-m.wall],[b.right-m.wall-.004,m.height/2,-m.wall/2],innerFinish);
        // The 10 cm return where the thicker extension wall meets the house's inner leaf is lined like the room, never facade.
        // It stands 8 mm proud of the wall's house-side face: flush with it, the two coplanar faces z-fought and the brick
        // showed through as a striped strip beside the doorbraak.
        for(const side of [-1,1])this.linedBox(this.root,[.104,m.height-.1,.012],[side*(m.width/2-.17),m.height/2,b.back-.002],innerFinish);
        if(!m.plaster)this.buildBoardJoints(m);
        if(m.plaster){const skirting=this.material('skirting',{color:'#e7e6df',roughness:.65,envMapIntensity:RIG.interiorEnv});for(const side of [-1,1])this.box(this.root,[.018,.08,m.depth-m.wall],[side*(m.width/2-m.wall-.013),.132,-m.wall/2],skirting);}
        // Every kozijn leaves a hole, "geen kozijn" included: piers, lintel and the reveals around the aperture.
        const pier=(m.width-m.opening.width)/2;
        for(const side of [-1,1])this.linedBox(this.root,[Math.max(.03,pier-m.wall),m.height-.1,.012],[side*(m.opening.width/2+(pier-m.wall)/2),m.height/2,b.front-m.wall-.009],innerFinish);
        const lintel=m.height-m.opening.height-m.opening.bottom;
        this.linedBox(this.root,[m.opening.width+.012,lintel,.014],[0,m.height-lintel/2,b.front-m.wall-.01],innerFinish);
        for(const side of [-1,1])this.linedBox(this.root,[.012,m.opening.height,.13],[side*(m.opening.width/2-.006),m.opening.bottom+m.opening.height/2,b.front-m.wall+.055],innerFinish);
        this.linedBox(this.root,[m.opening.width,.012,.13],[0,m.opening.height+m.opening.bottom-.006,b.front-m.wall+.055],innerFinish);
        if(m.plaster)for(const side of [-1,1])this.box(this.root,[Math.max(.03,pier-m.wall),.08,.018],[side*(m.opening.width/2+(pier-m.wall)/2),.132,b.front-m.wall-.02],this.material('skirting',{color:'#e7e6df',roughness:.65,envMapIntensity:RIG.interiorEnv}));
        this.makeOpening(m,frame,glass);
        this.roofGroup=new THREE.Group();this.root.add(this.roofGroup);this.roofGroup.visible=this.roofVisible;
        const roofMat=this.surface('roof-membrane',ROOF_MEMBRANE);
        this.ceilingGroup=new THREE.Group();this.root.add(this.ceilingGroup);
        m.roof.forEach(part=>{const size=[part.size[0],part.size[1]-ROOF_RECESS,part.size[2]],at=[part.center[0],part.center[1]-ROOF_RECESS/2,part.center[2]];
            const roofPart=this.box(this.roofGroup,size,at,roofMat);metricUVs(roofPart.geometry,at,1.6,1.6);roofPart.userData.scopeKey='rooflight';this.linedBox(this.ceilingGroup,[part.size[0],.012,part.size[2]],[part.center[0],m.height-.086,part.center[2]],innerFinish).userData.scopeKey=finishKey;});
        if(!m.plaster){
            // Ceiling boards run from the house to the garden, one sheet width apart, with the same faint filled
            // joint as the walls (buildBoardJoints). The ceiling lining's underside is at m.height-.092; the band sits
            // 0,5 mm below it, so it is in front of the face it lies on and never inside it.
            const joint=this.boardJoint(),y=m.height-.092-.0005;
            for(let x=Math.ceil((b.left+m.wall)/BOARD_JOINT.sheet)*BOARD_JOINT.sheet;x<b.right-m.wall;x+=BOARD_JOINT.sheet){
                const o=m.rooflight.opening;
                const runs=o&&x>o.left&&x<o.right?[[b.back,o.back],[o.front,b.front-m.wall]]:[[b.back,b.front-m.wall]];
                for(const [z0,z1] of runs)if(z1-z0>.02){const band=this.linedBox(this.ceilingGroup,[BOARD_JOINT.width,.001,z1-z0],[x,y,(z0+z1)/2],joint,{shadow:false});band.userData.scopeKey='plaster';band.name='board-joint-ceiling';}
            }
        }
        // Soft daylight reflected upward from the floor, used only by interior cameras. Its INTENSITY is switched by
        // applyViewLighting (see there); it is never hidden, which would recompile every material in the scene.
        this.interiorFill=new THREE.DirectionalLight('#fff3e4',0);
        this.interiorFill.position.set(0,.7,b.back+.25);this.interiorFill.target.position.set(0,m.height,-.05);
        this.root.add(this.interiorFill,this.interiorFill.target);
        // The room across the doorbraak gets its own bounce inside makeExistingRoom, where the room depth is known.
        this.houseFill=null;
        // A real rectangular opening remains between the four roof solids.
        // 2.16.0: the lessenaar and the lichtkoepel are white, always — they are a different product from the pui and
        // followed its colour only because they were handed the same material ("kleur van de lessenaars niet aanpassen").
        if(m.rooflight.panelCount)this.makeRooflight(m,this.material('rooflight-frame',{color:'#eeece5',roughness:.45,metalness:.12}),this.materials.get('glass-rooflight'),white);
        if(m.greenRoof)this.makeGreenRoof(m);
        this.buildRoofEdge(m,facade);
        const pipe=this.material(`pipe:${m.drain.material}`,{color:m.drain.material==='zinc'?'#a6aaa3':m.drain.material==='pvc-black'?'#303638':'#777b77',metalness:m.drain.material==='zinc'?.72:.05,roughness:.4});
        const bore=this.material('pipe-bore',{color:'#141716',roughness:1,side:THREE.DoubleSide});
        for(const drain of m.drains){
            // The whole downpipe — standpipe, roof spout, outlet elbow and beugels — answers to "Regenbuis materiaal".
            // "Plaatsing" shares it: one pipe can only open one field, and both controls sit in the same card, so the
            // click lands with Materiaal focused and Plaatsing directly under it (docs/verification/2.9/scene-links.json).
            const drainPart=object=>{this.tag(object,'drainMaterial');this.root.add(object);};
            // One pipe from its hopper under the daktrim into the ground: plumb down a plain facade, or on an overstek
            // out of the hopper on the boeiboord and through a zwanenhals back to the facade (2.18.2). Every corner is a
            // real rounded bend (2.13.0, "45'lik dirsek bağlantı kısmı yuvarlak olmalı"): two straight cylinders meeting
            // at an angle read as a broken pipe. The last run stays a hollow tube, so the open end still shows its bore.
            const parts=roundedRoute(downpipeRoute(drain),DOWNPIPE.bend),end=parts.pop();
            for(const geometry of pipeGeometries(parts,DOWNPIPE.radius)){const tube=new THREE.Mesh(geometry,pipe);tube.castShadow=true;tube.name='downpipe';drainPart(tube);}
            const mouth=lineBetween(end.from,end.to,pipe,2*DOWNPIPE.radius,{hollow:bore});mouth.name='downpipe-uitloop';drainPart(mouth);
            // The water leaves through the roof EDGE into a hopper under the daktrim: on the facade (2.17.0) or on the
            // boeiboord of an overstek (2.18.2). There is no hole in the roof any more.
            this.buildHopper(m,drain,pipe,bore,drainPart);
            for(const y of [.5,1.8])this.tag(this.box(this.root,[.095,.034,.035],[drain.x,y,drain.z+.007],pipe),'drainMaterial');
        }
        this.buildFixtures();
        this.makeExistingHouse(m,dark);
        this.decorGroup=new THREE.Group();this.decorGroup.name='garden';this.surroundingsGroup.add(this.decorGroup);this.decorGroup.visible=this.decorVisible;this.makeGarden(m);
        // The CC0 garden set replaces its stand-in as soon as it is parsed. Exposed as a promise so a render or a
        // screenshot can wait for the real set instead of catching the terrace mid-swap.
        this.gardenSetReady=this.loadGardenSet();
        // Out of the GTAO G-buffer: that pass draws every object with its own override material, which renders a label
        // SPRITE as a fixed, un-billboarded 1.9 × 0.48 m plate, and the AO then paints a black slab around a plate nobody
        // sees ("ölçüleri göster ... siyah bir kutucuk", 2026-09-19). Annotations take no part in the shading anyway.
        this.dimensionGroup=new THREE.Group();this.dimensionGroup.name='dimensions';this.dimensionGroup.userData.excludeFromAO=true;
        this.root.add(this.dimensionGroup);this.dimensionGroup.visible=this.dimensionsVisible;
        this.makeDimensions(m);
        // The existing room may share the painted material; it is never part of the extension's stucwerk scope.
        this.root.traverse(object=>{if(object.isMesh&&object.material===innerFinish&&!object.userData.scopeKey&&!object.userData.existing)object.userData.scopeKey=finishKey;});
        this.applyNeighbourVisibility({render:false});
        this.applyIllustrativeVisibility();
        // A rebuild makes fresh groups, so the omgeving switch has to be pushed onto them again — a resize or an
        // edited width during a capture must not quietly hand the surroundings back. The part switches are in the
        // same position and are pushed on for the same reason.
        this.applySurroundings();
        this.applyDocumentParts();
        this.applyRoofVisibility();
        this.applyViewLighting();
        this.fitSunShadow();
        this.bindEnvironment();
        this.shadowsDirty=true;
    }

    /**
     * Sedum roof, seated INTO the roof package instead of stacked on top of the membrane.
     *
     * It used to be stacked: 70 mm of substrate over the membrane, then the mat, the ballast and a field of instanced
     * cushions, so the finished green surface stood 97 mm above the slab and 82 mm PROUD of the daktrim. The whole
     * roof read taller with the option than without it, and the customer saw exactly that. Neither the factory nor the
     * site does it that way: the roof cassette is built to one outer height and an extensive sedum system displaces
     * insulation inside it; the daktrim is a catalogue profile with one height, so raising the upstand was not an
     * option either. So the layers are seated down. The finished sedum surface sits at slabTop + 12 mm, three
     * millimetres BELOW the top of the anthracite / white daktrim cap (33 mm below the zinc roll), the ballast at
     * slabTop + 6 mm, and both are bedded into the slab underneath. Silhouette, fascia band and daktrim are therefore
     * identical with and without the option - measured in docs/verification/2.9/sedum-roof-edge-diff.json.
     *
     * The build-up also stops FLASHING (85 mm) short of the slab edge, clear of the 75 mm the daktrim's horizontal leg
     * reaches inboard, so no layer ever intersects the trim. What is left, from the edge inwards: a lap of bare
     * membrane, a 0.16 m gravel ballast strip (wind uplift and fire break, also around the rooflight kerb), then the
     * mat. The wide brown substrate border is gone - on a real extensive roof the substrate is UNDER the mat, and
     * drawn as a band it was the "brown soil" half of the complaint. The ballast is its own river-gravel scan now;
     * it used to borrow the terrace paving scan, which carries no aggregate at all and read as more brown border.
     */
    makeGreenRoof(m) {
        const parts=m.roof,top=m.height+m.roofThickness/2,flashing=.085,strip=.16,matY=top+.012,ballastY=top+.006;
        const left=Math.min(...parts.map(p=>p.center[0]-p.size[0]/2))+flashing,right=Math.max(...parts.map(p=>p.center[0]+p.size[0]/2))-flashing;
        const back=Math.min(...parts.map(p=>p.center[2]-p.size[2]/2))+flashing,front=Math.max(...parts.map(p=>p.center[2]+p.size[2]/2))-flashing;
        const gravel=this.surface('roof-ballast',{color:'#9ba09c',roughness:1,map:'ballastColor',normalMap:'ballastNormal',normalScale:.9});
        const sedum=this.surface('sedum-mat',{color:'#ffffff',roughness:1,map:'sedumColor',normalMap:'sedumNormal',roughnessMap:'sedumRough',aoMap:'sedumAo',aoMapIntensity:.85,normalScale:.9});
        // The scan tiles every 0.90 m. Turning its grid off the roof axes stops the repeat from reading as rows of
        // identical patches down a rectangular roof; the maps are used by nothing else, so this is local to the mat.
        for(const key of ['sedumColor','sedumNormal','sedumRough','sedumAo']){const texture=this.maps[key];if(texture&&texture.rotation!==SEDUM_UV_ROTATION){texture.center.set(.5,.5);texture.rotation=SEDUM_UV_ROTATION;texture.needsUpdate=true;}}
        // y is the FINISHED top face of the layer; the thickness runs down into the roof below it.
        const layer=(x0,x1,z0,z1,y,thickness,material,period)=>{
            if(x1-x0<.01||z1-z0<.01)return null;
            const at=[(x0+x1)/2,y-thickness/2,(z0+z1)/2],mesh=this.box(this.roofGroup,[x1-x0,thickness,z1-z0],at,material);
            metricUVs(mesh.geometry,at,period,period);mesh.userData.scopeKey='greenRoof';return mesh;
        };
        // The finished levels stay where they were; the layers reach down to the membrane ROOF_RECESS under the slab top.
        const ballast=(x0,x1,z0,z1)=>layer(x0,x1,z0,z1,ballastY,.014+ROOF_RECESS,gravel,.55);
        const mat=(x0,x1,z0,z1)=>layer(x0,x1,z0,z1,matY,.022+ROOF_RECESS,sedum,.9);
        const o=m.rooflight.opening,kerb=o?{left:o.left-.12,right:o.right+.12,back:o.back-.12,front:o.front+.12}:null;
        ballast(left,right,back,back+strip);ballast(left,right,front-strip,front);
        ballast(left,left+strip,back+strip,front-strip);ballast(right-strip,right,back+strip,front-strip);
        const field=[left+strip,right-strip,back+strip,front-strip];
        if(kerb){
            // A 0.18 m ballast ring keeps the planting off the rooflight upstand; the mat closes around it.
            const ring=.18,r=[kerb.left-ring,kerb.right+ring,kerb.back-ring,kerb.front+ring];
            mat(field[0],r[0],field[2],field[3]);mat(r[1],field[1],field[2],field[3]);
            mat(r[0],r[1],field[2],r[2]);mat(r[0],r[1],r[3],field[3]);
            ballast(r[0],r[1],r[2],kerb.back);ballast(r[0],r[1],kerb.front,r[3]);
            ballast(r[0],kerb.left,kerb.back,kerb.front);ballast(kerb.right,r[1],kerb.back,kerb.front);
        } else mat(field[0],field[1],field[2],field[3]);
    }

    /**
     * Daktrim and overstek are two separate things. The daktrim is a thin capping along the outer roof edge in its
     * own colour and material. Without an overstek the facade simply continues over the slab edge up to that capping;
     * with an overstek a boeiboord band runs round three walls, flush with the side walls (never over the neighbours)
     * and 20 cm past the garden side, its soffit in the same finish.
     */
    buildRoofEdge(m,facade){
        const b=m.bounds,slabTop=m.height+m.roofThickness/2,ovh=m.overhangDepth||0,t=.035,panel=this.rollaagPanel(m);
        const edgeFront=b.front+ovh,edgeSide=m.width/2+(ovh?.006:0);
        if(!ovh){
            // Facade band over the slab edge; above the frame it carries the rollaag panel colour instead.
            const bandY=slabTop-m.roofThickness/4,bandSize=[m.width,m.roofThickness/2,.03];
            if(panel){
                const pier=(m.width-m.opening.width)/2;
                for(const side of [-1,1])this.facadeBox(this.roofGroup,[pier,bandSize[1],.03],[side*(m.opening.width/2+pier/2),bandY,b.front-.015],facade,m.facade);
                this.box(this.roofGroup,[m.opening.width,bandSize[1],.03],[0,bandY,b.front-.015],panel).userData={surface:'rollaag',scopeKey:'rollaag'};
            } else this.facadeBox(this.roofGroup,bandSize,[0,bandY,b.front-.015],facade,m.facade);
            for(const side of [-1,1])this.facadeBox(this.roofGroup,[.03,bandSize[1],m.depth],[side*(m.width/2-.015),bandY,0],facade,m.facade);
        } else {
            const board=this.material(`overhang:${m.overhang}`,{color:m.overhang==='pvc-anthracite'?'#33393a':'#efeee8',roughness:m.overhang.startsWith('wood')?.78:.46});
            const fh=m.fasciaHeight,fy=slabTop-fh/2,soffitY=slabTop-fh;
            // Boeiboord and soffit are the overstek itself: both answer to "Overstek", never to the facade behind them.
            const boeiboord=(size,at,options)=>this.tag(this.box(this.roofGroup,size,at,board,options),'overhang');
            boeiboord([2*edgeSide,fh,t],[0,fy,edgeFront-t/2]);
            for(const side of [-1,1])boeiboord([t,fh,edgeFront-b.back],[side*(edgeSide-t/2),fy,(b.back+edgeFront)/2]);
            boeiboord([2*edgeSide,.012,ovh-t],[0,soffitY+.006,b.front+(ovh-t)/2],{shadow:false});
            if(m.overhang==='wood-white'){
                // Primed timber boeiboord: a small profiled lip along the lower edge.
                boeiboord([2*edgeSide+.03,.035,t+.015],[0,soffitY+.0175,edgeFront-t/2+.0075]);
                for(const side of [-1,1])boeiboord([t+.015,.035,edgeFront-b.back+.015],[side*(edgeSide-t/2+.0075),soffitY+.0175,(b.back+edgeFront)/2+.0075]);
            }
        }
        // Zinc is bare rolled metal (metalness .9); the anthracite and white trims are coated aluminium, which the
        // lighting stage measured at .22 / .40 — coated metal reflects like a painted surface, not like zinc.
        const edge=this.material(`edge:${m.roofEdge}`,{color:m.roofEdge==='anthracite'?'#3a3f3d':m.roofEdge==='zinc'?'#a9b1ae':'#c9ccc6',metalness:m.roofEdge==='zinc'?.9:.22,roughness:m.roofEdge==='zinc'?.35:.4});
        // Every part is laid between the corners it closes (2.13.0, "daktrim köşelerden birleşen yerlerde boşluklar
        // var"): a part reaches `inner` in over the roof and `outer` past the edge; the front run runs out to the side
        // runs' OUTER face and the side runs stop at the front run's INNER face, so a corner is neither open nor doubled
        // (a doubled corner puts two coplanar faces on top of each other, which z-fight). Until 2.12 the side legs
        // stopped 1 cm short of the front leg and the front run stood 1,2 cm proud of the side profiles.
        const runs=[{axis:'x',center:[0,edgeFront],normal:[0,1]},...[-1,1].map(side=>({axis:'z',center:[side*edgeSide,(b.back+edgeFront)/2],normal:[side,0]}))];
        const membrane=this.surface('roof-membrane',ROOF_MEMBRANE);
        for(const run of runs){
            // Every trim profile carries its own tag: the daktrim is a thin band in front of a much bigger facade band,
            // and only a tag on the small part keeps the click on the trim instead of on the wall behind it.
            const put=(inner,outer,height,y,{material=edge,key='roofEdge'}={})=>{
                const along=run.axis==='x'?2*(edgeSide+outer):edgeFront-inner-b.back,shift=(outer-inner)/2;
                const at=[run.center[0]+run.normal[0]*shift,y,run.center[1]+run.normal[1]*shift];
                if(run.axis==='z')at[2]-=inner/2;
                const mesh=this.box(this.roofGroup,run.axis==='x'?[along,height,inner+outer]:[inner+outer,height,along],at,material);
                if(key)this.tag(mesh,key);else mesh.userData.scopeKey='rooflight';return mesh;
            };
            // The kantplank under the trim, clad in the membrane on its inner face: it carries the trim ROOF_RECESS above
            // the finished roof ("daktrim iç tarafında biraz daha derinlik"). 5 mm short of the outer face, so it never
            // shares a plane with the facade band or the boeiboord.
            put(TRIM_REACH,-.005,ROOF_RECESS+.003,slabTop+.001-(ROOF_RECESS+.003)/2,{material:membrane,key:null});
            // The trim's top leg on the kantplank, then the visible edge profile — its face is DAKTRIM_FACE
            // (geometry.js), which is also where the downpipe's hopper hangs from.
            put(TRIM_REACH,.01,.014,slabTop+.008);
            const face=DAKTRIM_FACE[m.roofEdge]||DAKTRIM_FACE.anthracite,faceHeight=face.top-face.bottom,faceY=slabTop+(face.top+face.bottom)/2;
            if(m.roofEdge==='zinc'){
                // The zinc roll runs corner centre to corner centre and a ball of the same radius turns each corner.
                const roll=new THREE.Mesh(new THREE.CylinderGeometry(.028,.028,run.axis==='x'?2*edgeSide:edgeFront-b.back,18),edge);
                roll.rotation.set(run.axis==='x'?0:Math.PI/2,0,run.axis==='x'?Math.PI/2:0);roll.position.set(run.center[0],slabTop+.004,run.center[1]);
                roll.castShadow=true;this.roofGroup.add(roll);this.tag(roll,'roofEdge');
                put(0,.012,faceHeight,faceY);
            } else put(0,.018,faceHeight,faceY);
        }
        if(m.roofEdge==='zinc')for(const side of [-1,1]){
            const ball=new THREE.Mesh(new THREE.SphereGeometry(.028,18,12),edge);ball.position.set(side*edgeSide,slabTop+.004,edgeFront);
            ball.castShadow=true;this.roofGroup.add(ball);this.tag(ball,'roofEdge');
        }
        // Against the house the membrane does not stop at the roof: it is dressed up the gevel and closed with a wall
        // profile sealed into the brick (2.14.1, the customer's photo — "mebran yalıtımı evin duvarına da biraz
        // yapıştırılıyor"). 18 cm of opstand is the ordinary detail for an EPDM roof against an existing wall, and it
        // is what makes the junction read as finished instead of as two volumes pushed together.
        const surface=slabTop-ROOF_RECESS,upstand=.18,reachX=2*(edgeSide-.005);
        const wall=this.box(this.roofGroup,[reachX,upstand,.014],[0,surface+upstand/2,b.back+.007],membrane);
        wall.name='roof-upstand';wall.userData.scopeKey='rooflight';
        this.tag(this.box(this.roofGroup,[reachX,.035,.03],[0,surface+upstand+.0175,b.back+.015],edge),'roofEdge').name='roof-upstand-trim';
    }

    /**
     * The roof drains through its EDGE (2.17.0, the owner with photographs: "dak trim yandan dışarı çıkıntısı yok ama
     * borunun hizasında çıkıntısı var ve boru duvara değil bu daktrim çıkıntısına bağlanıp suyu oradan topluyor;
     * üstten bakıldığında tavanda bir delik değil, iç kısımdan dışa taşan daktrimden boruya bağlantı var").
     *
     * Three parts, the way a Dutch roofer builds it: a kiezelbak on the membrane with its rectangular zijuitloop in the
     * inner face of the roof edge; that 80 x 60 mm tube running out under the uninterrupted daktrim, through the
     * facade; and an open vergaarbak screwed to the facade directly under the trim, the tube entering its back. The
     * pipe hangs from the hopper's floor (geometry.js drain.hopper), so there is no elbow and no hole in the roof.
     * On an overstek (2.18.2) the same three parts sit 20 cm further out: the tube runs through the boeiboord and the
     * hopper is screwed to the boeiboord (h.face), the pipe under it at h.z (downpipeRoute adds the zwanenhals).
     * Everything answers to "Regenbuis" like the pipe; the kiezelbak lies in the roof group and leaves with the roof.
     */
    buildHopper(m,drain,pipe,bore,drainPart){
        const h=drain.hopper,back=h.face+.003,[wTop,dTop]=HOPPER.top,[wBottom,dBottom]=HOPPER.bottom;
        // A prismoid between two rectangles, flat back against the face, the front and sides leaning in toward the outlet.
        const outline=(y,w,d,inset=0)=>[[drain.x-w/2+inset,y,back+inset],[drain.x+w/2-inset,y,back+inset],[drain.x+w/2-inset,y,back+d-inset],[drain.x-w/2+inset,y,back+d-inset]];
        const shell=(top,bottom,{inward=false,capBottom=true}={})=>{
            const positions=[],centre=[0,1,2].map(i=>(top.concat(bottom)).reduce((sum,p)=>sum+p[i],0)/8);
            const triangle=(a,b2,c)=>{
                const n=[(b2[1]-a[1])*(c[2]-a[2])-(b2[2]-a[2])*(c[1]-a[1]),(b2[2]-a[2])*(c[0]-a[0])-(b2[0]-a[0])*(c[2]-a[2]),(b2[0]-a[0])*(c[1]-a[1])-(b2[1]-a[1])*(c[0]-a[0])];
                const out=[0,1,2].map(i=>(a[i]+b2[i]+c[i])/3-centre[i]),facing=n[0]*out[0]+n[1]*out[1]+n[2]*out[2];
                if((facing<0)!==inward)positions.push(...a,...c,...b2);else positions.push(...a,...b2,...c);
            };
            for(let i=0;i<4;i++){const j=(i+1)%4;triangle(top[i],top[j],bottom[j]);triangle(top[i],bottom[j],bottom[i]);}
            if(capBottom){triangle(bottom[0],bottom[1],bottom[2]);triangle(bottom[0],bottom[2],bottom[3]);}
            const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();return geometry;
        };
        const part=(geometry,material,name)=>{const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=name==='downpipe-hopper';mesh.receiveShadow=true;drainPart(mesh);return mesh;};
        // Outside; inside (seen from above, through the open top, 4 mm under the rim); and the rim that closes the
        // gap between the two, so the wall of the hopper has a thickness rather than a slit.
        const wall=.003,rimDrop=.004;
        part(shell(outline(h.top,wTop,dTop),outline(h.bottom,wBottom,dBottom)),pipe,'downpipe-hopper');
        part(shell(outline(h.top-rimDrop,wTop,dTop,wall),outline(h.bottom+.01,wBottom,dBottom,wall),{inward:true}),bore,'downpipe-hopper-inside');
        const outer=outline(h.top,wTop,dTop),inner=outline(h.top-rimDrop,wTop,dTop,wall),rim=[];
        // Wound so every rim triangle faces up (outer, inner-next, outer-next): one-sided, in the pipe's own material.
        for(let i=0;i<4;i++){const j=(i+1)%4;rim.push(...outer[i],...inner[j],...outer[j],...outer[i],...inner[i],...inner[j]);}
        const rimGeometry=new THREE.BufferGeometry();rimGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rim,3));rimGeometry.computeVertexNormals();
        part(rimGeometry,pipe,'downpipe-hopper');
        // The outlet collar under the floor, where the pipe is pushed in.
        const collar=new THREE.Mesh(new THREE.CylinderGeometry(DOWNPIPE.radius+.004,DOWNPIPE.radius+.004,.03,18),pipe);
        collar.position.set(drain.x,h.bottom-.015,h.z);collar.name='downpipe-hopper';collar.castShadow=true;drainPart(collar);
        // The zijuitloop: from inside the wall or the boeiboord, through its face, into the back of the hopper — just
        // under its rim.
        const lead=this.material('downpipe-spout',{color:'#6b6e72',roughness:.7,metalness:.3});
        const spoutTop=h.top-.02,spoutLength=SPOUT.into+SPOUT.reach;
        const spout=this.box(this.root,[SPOUT.width,SPOUT.height,spoutLength],[drain.x,spoutTop-SPOUT.height/2,h.face-SPOUT.into+spoutLength/2],lead);
        spout.name='downpipe-spout';this.tag(spout,'drainMaterial');
        // On the roof: the kiezelbak plate on the membrane and the dark mouth of the tube in the inner face of the edge.
        const slabTop=m.height+m.roofThickness/2,surface=slabTop-ROOF_RECESS,innerFace=h.face-TRIM_REACH;
        const plate=this.box(this.roofGroup,[.16,.004,.16],[drain.x,surface+.002,innerFace-.08],lead,{shadow:false});
        plate.name='roof-scupper';this.tag(plate,'drainMaterial');
        // 2 mm proud of the inner face of the kantplank and 8 mm into it, so it reads as the tube's mouth from the roof.
        const mouth=this.box(this.roofGroup,[SPOUT.width,.034,.01],[drain.x,surface+.017,innerFace+.003],bore,{shadow:false});
        mouth.name='roof-scupper';this.tag(mouth,'drainMaterial');
    }


    buildCladding(){
        this.release(this.claddingGroup);this.claddingGroup=new THREE.Group();this.claddingGroup.userData.scopeKey='facade';this.root.add(this.claddingGroup);
        const m=this.model;if(m.facade.startsWith('brick')||m.facade==='render')return;
        const horizontal=m.facade.includes('horizontal'),open=m.facade.startsWith('open'),positions=[];
        // An opengevel is the same boards with a gap between them: 5 cm battens with an 8 mm shadow gap instead of
        // 12 cm boards with a 3 mm joint. Until 2.9.4 only the VERTICAL branch knew that, so "Opengevel horizontaal"
        // was drawn as ordinary 12 cm cladding; both branches now read the same pitch, and facadePeriods maps one
        // scanned board onto every batten either way.
        const pitch=open?.05:.12,joint=open?.008:.003,proud=open?.004:.003;
        // Without an overstek the cladding runs on over the slab edge up to the daktrim.
        const extra=m.overhangDepth?0:m.roofThickness/2,panel=this.rollaagPanel(m);
        for(const wall of m.walls){
            if(wall.key==='front-header'&&panel)continue;
            const side=['left','right'].includes(wall.key),axis=side?2:0,start=wall.center[axis]-wall.size[axis]/2,end=start+wall.size[axis];
            const outside=side?(wall.key==='left'?m.bounds.left-.002:m.bounds.right+.002):m.bounds.front+.002;
            // Down to the paving like the wall itself (FOOTING, 2.13.0).
            const foot=Math.abs(wall.center[1]-wall.size[1]/2)<1e-6?FOOTING:0;
            const top=wall.center[1]+wall.size[1]/2+extra,height=wall.size[1]+extra+foot,centerY=wall.center[1]+(extra-foot)/2;
            if(horizontal){for(let y=Math.ceil((wall.center[1]-wall.size[1]/2)/pitch)*pitch;y<top;y+=pitch)positions.push({size:side?[proud,joint,wall.size[2]]:[wall.size[0],joint,proud],at:side?[outside,y,wall.center[2]]:[wall.center[0],y,outside]});}
            else for(let x=Math.ceil(start/pitch)*pitch;x<end;x+=pitch)positions.push({size:side?[.004,height,joint]:[joint,height,.004],at:side?[outside,centerY,x]:[x,centerY,outside]});
        }
        const grooves=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),this.material('cladding-joint',{color:'#44443b',roughness:1}),positions.length),dummy=new THREE.Object3D();
        positions.forEach((p,i)=>{dummy.position.set(...p.at);dummy.scale.set(...p.size);dummy.updateMatrix();grooves.setMatrixAt(i,dummy.matrix);});this.claddingGroup.add(grooves);
    }

    buildFixtures(){
        if(!this.root||!this.ceilingGroup)return;this.buildCounts.fixtures++;this.clearHighlight();const m=this.model;
        for(const group of [this.fixtureGroup,this.ceilingFixtures,this.overhangFixtures,this.floorHeatingGroup])this.release(group);
        this.fixtureGroup=new THREE.Group();this.root.add(this.fixtureGroup);
        this.ceilingFixtures=new THREE.Group();this.ceilingGroup.add(this.ceilingFixtures);
        this.overhangFixtures=new THREE.Group();this.roofGroup.add(this.overhangFixtures);
        for(const fixture of m.fixtures){
            const appearance=fixtureAppearance(this.scope,fixture.key,this.examplesVisible);
            const parent=fixture.room==='ceiling'?this.ceilingFixtures:fixture.room==='overhang'?this.overhangFixtures:this.fixtureGroup;
            const device=buildFixture(fixture,appearance,this.material.bind(this));this.seatFixture(device,fixture,m);parent.add(device);
            // The preparation marker is seated on the finished wall exactly like the device. Unseated it floated at the
            // logical point, 2,5 cm proud of the structural wall, and on a double buitenstopcontact that point is the
            // middle of the plate: a 13 mm copper disc between the two sockets, which the customer read as a dimmer
            // "always in the middle of the sockets". Seated, the plate covers it; with no device it marks the wall.
            if(appearance.preparation){const preparation=buildPreparation(fixture,appearance,this.material.bind(this));this.seatFixture(preparation,fixture,m);parent.add(preparation);}
        }
        this.floorHeatingGroup=buildUnderfloorHeating(m,underfloorAppearance(this.scope,this.examplesVisible),this.material.bind(this));
        this.root.add(this.floorHeatingGroup);this.applyUnderfloorVisibility();
        this.assignLampLights();this.bindEnvironment();
        this.shadowsDirty=true;
    }

    /**
     * Seats a wall-mounted device on the finished surface. Its logical point (the group position, reported by
     * getSceneInfo and kept 2,5–2,8 cm in front of the structural wall) stays put; only the parts slide back along the
     * mount axis until the rearmost body face lies 1 mm inside the finish — the 8 mm gipsplaat/stucwerk lining inside,
     * the facade (plus its 4 mm cladding grooves for wood) outside. Without this the switches, sockets and lamps hung
     * 2–3 cm off the wall. Ceiling fittings already sit in the ceiling plane; radiator preparation stays at its point.
     */
    seatFixture(group,fixture,m){
        if(!['socket','switch','dimmer','wall-light','radiator','tap'].includes(fixture.kind)||!['interior','outside'].includes(fixture.room))return;
        const b=m.bounds,inward=new THREE.Vector3(0,0,1).applyQuaternion(group.quaternion),at=new THREE.Vector3(...fixture.position);
        let plane;
        if(fixture.room==='interior')plane=new THREE.Vector3(fixture.rotation>0?b.left+m.wall+.008:b.right-m.wall-.008,0,0);
        else{
            const proud=m.facade.startsWith('brick')||m.facade==='render'?0:.004,surface=fixture.surface||'front';
            plane=surface==='front'?new THREE.Vector3(0,0,b.front+proud):new THREE.Vector3(surface==='left'?b.left-proud:b.right+proud,0,0);
        }
        const box=new THREE.Box3();let rear=Infinity;
        for(const part of group.children){
            if(!part.isMesh||part.userData.lightEffect)continue;
            part.updateMatrix();part.geometry.computeBoundingBox();box.copy(part.geometry.boundingBox).applyMatrix4(part.matrix);rear=Math.min(rear,box.min.z);
        }
        if(!Number.isFinite(rear))return;
        const shift=plane.dot(inward)-at.dot(inward)-.001-rear;
        if(Math.abs(shift)<1e-4)return;
        for(const part of group.children)part.position.z+=shift;
    }

    /**
     * A FIXED number of lamp lights, built once on the scene (not on `root`, so a rebuild never touches them) and
     * never shown or hidden — an unused slot sits at intensity 0 below the ground. The count is fixed because three
     * compiles one program per light count: assigning lights per fixture, as the old rig did, recompiled every
     * material the moment a visitor ticked a sixth spot. No lamp casts shadows: PCFSoft costs 25 texture taps per
     * lookup per light, and the emissive fitting meshes already carry the visual cue.
     */
    buildLampSlots() {
        if(this.lampLights){this.lampLights.traverse(object=>object.shadow?.dispose());this.lampLights.removeFromParent();}
        const slots=LAMP_SLOTS[this.quality]||LAMP_SLOTS.full,warm='#ffdcb0';
        this.lampLights=new THREE.Group();this.lampLights.name='lamp-lights';this.scene.add(this.lampLights);
        this.lampSpots=[];this.lampPoints=[];
        for(let i=0;i<slots.spot;i++){
            const light=new THREE.SpotLight(warm,0,0,Math.PI/6,.45,2);light.castShadow=false;light.position.set(0,-50,0);
            this.lampLights.add(light,light.target);this.lampSpots.push(light);
        }
        for(let i=0;i<slots.point;i++){
            const light=new THREE.PointLight(warm,0,0,2);light.castShadow=false;light.position.set(0,-50,0);
            this.lampLights.add(light);this.lampPoints.push(light);
        }
        this.shadowsDirty=true;
    }

    /**
     * Fill the fixed slots from the lamps the visitor actually chose (LED spot 450 lm, overstek spot 300 lm, pendant
     * 800 lm, wall light 2×280 lm), converted to candela and scaled by LIGHT_SCALE. Nearest the room centre wins:
     * on a phone three spots must be the three that light the picture, not the three that happen to be first.
     */
    assignLampLights() {
        if(!this.lampLights||!this.model)return {slots:0,used:0};
        const m=this.model,spots=[],points=[];
        const cone=lumen=>angle=>lumen/(2*Math.PI*(1-Math.cos(angle)));
        for(const f of m.fixtures){
            const appearance=fixtureAppearance(this.scope,f.key,this.examplesVisible);
            if(!appearance.visible)continue;
            const [x,y,z]=f.position,out=[Math.sin(f.rotation||0),0,Math.cos(f.rotation||0)];
            if(f.kind==='pendant')points.push({at:[x,y-(appearance.assetKey==='ceiling-dome'?.47:.56),z],intensity:800/(4*Math.PI)*LIGHT_SCALE});
            else if(f.kind==='spot'){
                const lumen=f.room==='overhang'?300:450;
                spots.push({at:[x,y-.025,z],to:[x,y-1.025,z],angle:Math.PI/6,intensity:cone(lumen)(Math.PI/6)*LIGHT_SCALE});
            }
            else if(f.kind==='wall-light')for(const dir of [1,-1])
                spots.push({at:[x+out[0]*.075,y+dir*.1,z+out[2]*.075],to:[x+out[0]*.425,y+dir*1.1,z+out[2]*.425],
                    angle:Math.PI*.31,intensity:cone(280)(Math.PI*.31)*LIGHT_SCALE});
        }
        const centre=[0,m.height*.5,-m.wall/2],near=(a,b)=>
            Math.hypot(a.at[0]-centre[0],a.at[1]-centre[1],a.at[2]-centre[2])-Math.hypot(b.at[0]-centre[0],b.at[1]-centre[1],b.at[2]-centre[2]);
        spots.sort(near);points.sort(near);
        const fill=(list,lamps,aim)=>list.forEach((light,index)=>{
            const lamp=lamps[index];
            if(!lamp){light.intensity=0;light.position.set(0,-50,0);return;}
            light.position.set(...lamp.at);light.intensity=lamp.intensity;aim?.(light,lamp);
        });
        fill(this.lampSpots,spots,(light,lamp)=>{light.angle=lamp.angle;light.target.position.set(...lamp.to);light.target.updateMatrixWorld();});
        fill(this.lampPoints,points);
        this.shadowsDirty=true;
        return {slots:this.lampSpots.length+this.lampPoints.length,used:Math.min(spots.length,this.lampSpots.length)+Math.min(points.length,this.lampPoints.length)};
    }

    /**
     * Indicative floor finish (laminaat / visgraat) shown once the interior finishing is part of the design; "kaal
     * beton" lays nothing and shows the screed slab itself (screedFloor). Both wood finishes are the same product
     * family, re-laid at real Dutch plank sizes by scripts/prepare_floor_textures.py, so the numbers come in pairs:
     * the tint is WHITE (the map already carries the light "naturel eiken" tone — a beige tint would double-darken
     * it), the roughness map keeps them matte, and the AO map is the plank grooves, nothing else.
     */
    floorFinishMaterial() {
        const finish={roughness:.88,aoMapIntensity:.8,envMapIntensity:.3,color:'#ffffff'};
        if(this.floorFinish==='herringbone')return this.surface('floor-herringbone',{...finish,map:'parquetColor',normalMap:'parquetNormal',roughnessMap:'parquetRough',aoMap:'parquetAo',normalScale:.4});
        return this.surface('floor-laminate',{...finish,map:'laminateColor',normalMap:'laminateNormal',roughnessMap:'laminateRough',aoMap:'laminateAo',normalScale:.35});
    }
    /**
     * Physical tile size of the floor maps, in metres — it MUST equal provenance.json `physicalSizeM`, or the
     * boards come out the wrong size and the tile stops meeting itself. 2.40 m = 2 × 12 boards of 120×20 cm;
     * 3.3941 m = the 60×15 cm herringbone lattice's 2×2 period (2·2L·√2 / 1200 px/m), an exact irrational period
     * the generator warps onto a whole number of pixels rather than rounding. `python scripts/check_floor_tiling.py`
     * re-derives both from the maps on disk.
     */
    floorPeriod(){return this.floorFinish==='herringbone'?3.3941:2.4;}
    /**
     * Floor UVs with the texture's own axis turned across the room: both tiles are laid with the plank LENGTH along
     * the image's u axis, and metricUVs maps u to world x, so without the swap the planks would run left to right.
     * They run from the house to the garden, as laid in practice (and as the herringbone lattice is square-periodic,
     * the mirrored mapping tiles just as seamlessly).
     */
    floorUVs(geometry,at,period) {
        metricUVs(geometry,at,period,period);
        const uv=geometry.attributes.uv;
        for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getY(i),uv.getX(i));
        uv.needsUpdate=true;return geometry;
    }
    buildFloorFinish(m) {
        this.release(this.floorFinishGroup);this.floorFinishGroup=new THREE.Group();this.floorFinishGroup.name='floor-finish';this.floorFinishGroup.userData={indicative:true,floorFinish:this.floorFinish||'laminate'};this.root.add(this.floorFinishGroup);
        this.shadowsDirty=true;
        if(!m.interior||(this.floorFinish||'laminate')==='concrete')return;
        const material=this.floorFinishMaterial(),period=this.floorPeriod(),at=[0,.0955,-m.wall/2];
        // The indicative finish lies straight on the afwerkvloer and hides it, so it answers to the same field.
        const finish=this.tag(this.box(this.floorFinishGroup,[m.width-2*m.wall-.01,.007,m.depth-m.wall-.01],at,material,{shadow:false}),'screed');
        this.floorUVs(finish.geometry,at,period);
        // The same floor runs on through the doorbraak into the house's room, up to its inner leaves and back wall:
        // one material and one metric UV origin, so the planks continue across the junction without a seam.
        const b=m.bounds,{houseDepth}=houseLayout(this.environment,m),leaf=.12,z0=b.back-existingRoomDepth(houseDepth)+.1,z1=b.back+.005,room=[0,.0955,(z0+z1)/2];
        const roomMesh=this.box(this.floorFinishGroup,[m.width-2*leaf,.007,z1-z0],room,material,{shadow:false});
        roomMesh.name='floor-finish-house';roomMesh.userData.existing=true;roomMesh.userData.roomBehind=true;this.floorUVs(roomMesh.geometry,room,period);
        // And the same planks over the half metre that STAYS when the omgeving is off (DOORBRAAK_REVEAL): one piece
        // or the other, never both. Cut from the same material on the same metric origin, so the two are pixel for
        // pixel identical where they overlap and the switch cannot move a plank.
        // Its WIDTH is the recess's clear opening, not the room's: makeDoorbraak insets the recess to the aanbouw's
        // inner faces so no camera can see past the rear corner onto it, and planks 10 cm wider on each side would
        // hand that leak straight back as a strip of laminate sticking out behind the side wall.
        const zr0=Math.max(z0,b.back-DOORBRAAK_REVEAL+.1),reveal=[0,.0955,(zr0+z1)/2];
        const revealMesh=this.box(this.floorFinishGroup,[Math.max(.3,m.width-2*m.wall),.007,z1-zr0],reveal,material,{shadow:false});
        revealMesh.name='floor-finish-doorbraak';revealMesh.userData.existing=true;revealMesh.userData.doorbraak=true;this.floorUVs(revealMesh.geometry,reveal,period);
        this.applyRoomFinish();
    }
    /**
     * Which of the two house-side floor pieces is drawn: the full room's, or the doorbraak's (DOORBRAAK_REVEAL).
     * Separate from applyDoorbraak because this group is rebuilt whenever the floor finish changes, long after the
     * scene was built. Never renders — setFloorFinish and the omgeving switch each do their own.
     */
    applyRoomFinish() {
        const visible=this.surroundingsVisible!==false;
        for(const child of this.floorFinishGroup?.children||[]) {
            if(child.userData.roomBehind)child.visible=visible;
            // The doorbraak's planks follow the doorbraak itself, administrator's switch included (wantsHouseRoom):
            // the recess and the floor inside it are one surface and may never disagree about being there.
            else if(child.userData.doorbraak)child.visible=!visible&&this.wantsHouseRoom();
        }
    }
    setFloorFinish(id) {
        const next=['laminate','herringbone','concrete'].includes(id)?id:'laminate';
        if(next===(this.floorFinish||'laminate')&&this.floorFinishGroup)return;
        this.floorFinish=next;if(this.model&&this.root)this.buildFloorFinish(this.model);this.shadowsDirty=true;this.render();
    }

    /** Lay the heating loops in the live view: drawn over 2,5 s, held, then faded out. Drawings keep the loops. */
    playUnderfloorAnimation({draw=2500,hold=900,fade=1000}={}) {
        const group=this.floorHeatingGroup;
        if(!group||!this.model?.underfloorLoops?.length||this.mode!=='3d'||this.failed)return Promise.resolve(false);
        this.underfloorAnimation?.cancel();
        const routes=group.children.filter(o=>o.userData.floorHeatingLoop),area=group.children.find(o=>o.userData.floorPreparationArea);
        const total=routes.reduce((n,r)=>n+r.geometry.attributes.position.count,0),materials=[...new Set(routes.map(r=>r.material))];
        // Only the extension's floor is lifted while the loops are laid; the house's room keeps its floor.
        const lifted=(this.floorFinishGroup?.children||[]).filter(o=>!o.userData.existing),liftedVisible=lifted.map(o=>o.visible);
        const reset=()=>{for(const r of routes)r.geometry.setDrawRange(0,Infinity);for(const mat of materials)mat.opacity=.68;if(area)area.material.opacity=.09;lifted.forEach((o,i)=>{o.visible=liftedVisible[i];});};
        let frame=null,cancelled=false;const start=performance.now();
        const done=new Promise(resolve=>{
            const tick=()=>{
                if(cancelled)return resolve(false);
                const t=performance.now()-start;let drawn=Math.floor(total*Math.min(1,t/draw));
                for(const r of routes){const take=Math.max(0,Math.min(r.geometry.attributes.position.count,drawn));r.geometry.setDrawRange(0,take);drawn-=take;}
                const alpha=t<draw+hold?1:Math.max(0,1-(t-draw-hold)/fade);
                for(const mat of materials)mat.opacity=.68*alpha;if(area)area.material.opacity=.09*alpha;
                // The lifted floor and the growing loops change what casts: this animation pays for a shadow pass per frame.
                this.shadowsDirty=true;this.render();
                if(t<draw+hold+fade)frame=requestAnimationFrame(tick);
                else{this.underfloorAnimation=null;reset();this.applyUnderfloorVisibility();this.shadowsDirty=true;this.render();resolve(true);}
            };
            frame=requestAnimationFrame(tick);
        });
        this.underfloorAnimation={cancel:()=>{cancelled=true;cancelAnimationFrame(frame);this.underfloorAnimation=null;reset();this.applyUnderfloorVisibility();}};
        group.visible=true;for(const o of lifted)o.visible=false;this.shadowsDirty=true;
        return done;
    }

    /** Indicative furnishing scenario, loaded on demand from the CC0 model set (interior_scenes.js). */
    setScenario(id) {this.scenario=id&&id!=='none'?String(id):'none';return this.applyScenario();}
    async applyScenario() {
        const token=this.scenarioToken=(this.scenarioToken||0)+1;
        // Loaded models share geometry through the loader cache, so the group is detached, never disposed.
        if(this.sceneryGroup){this.sceneryGroup.removeFromParent();this.sceneryGroup=null;this.shadowsDirty=true;}
        if(!this.root||!this.model||!this.scenario||this.scenario==='none'||this.failed){this.render();return false;}
        try {
            const scenes=await import('./interior_scenes.js');
            if(token!==this.scenarioToken||!this.root)return false;
            this.modelLoader??=scenes.createModelLoader({baseUrl:new URL('./assets/models/',import.meta.url).href});
            const group=await scenes.buildInteriorScene(this.model,this.scenario,this.modelLoader);
            if(token!==this.scenarioToken||!this.root||!group)return false;
            // Under `surroundingsGroup` with the lawn and the house: a bank and a salontafel are as little part of the
            // delivery as the schutting is, and the customer asked for the proposal images to show neither.
            this.sceneryGroup=group;(this.surroundingsGroup||this.root).add(group);this.applyScenery();
            this.shadowsDirty=true;this.render();return true;
        } catch(error) {console.warn('Interior scene unavailable',error);return false;}
    }

    makeOpening(m,frame,glass) {
        this.stopKozijnMotion();this.kozijnLeaves=null;this.kozijnOpenness=0;this.kozijnTarget=0;
        if(!m.opening.panelCount&&!m.opening.skeleton)return;
        const o=m.opening,group=new THREE.Group();group.name='opening';group.userData.scopeKey='frontOpening';this.root.add(group);
        const rubber=this.material('window-gasket',{color:'#222625',roughness:.92});
        const slots=this.material('window-grille',{color:'#1b1e1d',roughness:.9});
        // A profile drawn in the FRAME material is the kozijn itself, so it answers to "Materiaal kozijn"; panes,
        // rails, hardware and tracks keep the group's own "Kozijn". Both controls live in the card Gevel & voorpui.
        // With "geen kozijn" the outer profile IS the rough opening, so it keeps the group's own "Kozijn" tag: the
        // customer who clicks it wants to choose a pui, not the material of a frame that is not being delivered.
        const profile=(size,at,mat=frame,name=null)=>{const mesh=new THREE.Mesh(profileGeometry(...size),mat);mesh.position.set(...at);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);if(mat===frame&&!o.skeleton)this.tag(mesh,'openingMaterial');if(name)mesh.name=name;return mesh;};
        const y0=o.bottom,top=o.bottom+o.height;
        if(o.skeleton){
            // "Geen kozijn" is the rough opening and nothing else — the customer's own frame goes in later, so the sill
            // is the anthracite outer profile too and the aperture stays open: no leaves, no glass, no hardware.
            const f=.075,z=o.z+.016;
            profile([o.width+.11,.045,.30],[0,.067,z],frame);
            profile([o.width+.05,f,.11],[0,top,z],frame,'frame-head');
            for(const side of [-1,1])profile([f,o.height,.11],[side*o.width/2,o.height/2+y0,z],frame,'frame-jamb');
            return;
        }
        // 2.17.0: every kozijn is built from the customer's reference renders (geometry.js KOZIJN, kozijnProfile) and
        // from the one layout the option icons and the drawings read too (openingLayout). The frame sits IN the
        // aperture — jambs and head inside it — and the sections share the clear width between the jambs.
        const spec=kozijnProfile(o.kind,{bars:o.bars,material:m.openingMaterial}),family=spec.family;
        const face=o.z+.016+.055,frameZ=face-spec.frameDepth/2,clear=o.width-2*spec.jamb,scale=clear/o.width;
        profile([o.width,spec.head,spec.frameDepth],[0,top-spec.head/2,frameZ],frame,'frame-head');
        for(const side of [-1,1])profile([spec.jamb,o.height,spec.frameDepth],[side*(o.width/2-spec.jamb/2),y0+o.height/2,frameZ],frame,'frame-jamb');
        let bottom=y0;
        // Every threshold stands `proud` above the floor slab it lies on (2.18.3, the owner: "fareyle hareket ettiğimde
        // kapı eşiğinden kararma/glitch oluyor"): its top lay exactly level with the slab's top inside the opening, and
        // two coplanar faces z-fight — the light harmonica threshold flickered through the dark slab with every camera
        // move. 2 mm is invisible and far above the depth buffer's resolution; what stands on it simply starts inside it.
        const proud=.002;
        if(spec.threshold){
            // A harmonicapui stands on a light threshold in both colours, 34 mm out in front of the frame and 214 mm
            // behind it, with no frame member at its foot.
            this.box(group,[o.width+.04,.03+proud,.248],[0,y0-.015+proud/2,face-.09],this.material('kozijn-threshold',{color:spec.threshold,roughness:.6,metalness:.2})).name='kozijn-threshold';
        } else {
            // A schuifpui and openslaande deuren stand on a frame-colour onderdorpel over a DARK drempel of their own,
            // the same in both colours.
            this.box(group,[o.width+.04,spec.sillFace+proud,.24],[0,y0-spec.sillFace/2+proud/2,face+spec.sillProud-.12],this.material(`kozijn-sill:${spec.sill}`,{color:spec.sill,roughness:.7,metalness:.15})).name='kozijn-threshold';
            profile([clear,spec.lip,spec.frameDepth],[0,y0+spec.lip/2,frameZ],frame,'frame-lip');
            bottom=y0+spec.lip;
        }
        const ceiling=top-spec.head;
        // The sections' left and right edges in the clear width. Openslaande deuren put a kozijnstijl between a side
        // light and a door, and a hairline where the two doors meet.
        const edges=m.panels.map(section=>[(section.x-section.width/2)*scale,(section.x+section.width/2)*scale]);
        if(family==='french')m.panels.slice(0,-1).forEach((section,i)=>{
            const boundary=edges[i][1],gap=section.role===m.panels[i+1].role?spec.meeting:spec.mullion;
            if(gap===spec.mullion)profile([spec.mullion,ceiling-bottom,spec.frameDepth],[boundary,(bottom+ceiling)/2,frameZ],frame,'frame-mullion');
            edges[i][1]-=gap/2;edges[i+1][0]+=gap/2;
        });
        // The pane of one section, shortened by its grille, with the black gasket line every reference shows on both
        // faces, the grille and the roedes. `s` is the glazing: its x, width gx, glass plane pz, and the front and rear
        // faces of the member around it.
        const glaze=s=>{
            const grille=s.section.grille?KOZIJN.grille.height:0,paneTop=s.glassTop-grille,gh=paneTop-s.glassBottom,gy=s.glassBottom+gh/2;
            const pane=this.box(group,[s.gx+.02,gh+.02,.006],[s.x,gy,s.pz],glass,{shadow:false});pane.name='clear-glazing';s.parts.push(pane);
            for(const side of [-1,1])s.parts.push(this.box(group,[.008,gh,.014],[s.x+side*(s.gx/2-.004),gy,s.pz],rubber,{shadow:false}));
            for(const [yy,dir] of [[s.glassBottom,1],[paneTop,-1]])s.parts.push(this.box(group,[s.gx,.008,.014],[s.x,yy+dir*.004,s.pz],rubber,{shadow:false}));
            if(grille)rooster(s,paneTop);
            // Roedes (met roedes): KOZIJN.bars bars at equal parts of the pane, 21 mm faces standing 30 mm off the
            // glass on both sides, as on the reference. The panes line up across the front, so the bars do too.
            if(o.bars)for(let k=1;k<=KOZIJN.bars;k++)for(const side of [-1,1])
                s.parts.push(profile([s.gx,.021,.027],[s.x,s.glassBottom+gh*k/(KOZIJN.bars+1),s.pz+side*.0165],frame,'roede'));
        };
        // The ventilatierooster of the references: a housing in the frame colour across the whole pane directly under
        // the top rail (or the head), ONE row of dark slots in its lower half, seen from both faces (it ventilates the
        // room it is seen from too, 2.16.0) — one half-block per face. Only where the layout puts one.
        const rooster=(s,paneTop)=>{
            const g=KOZIJN.grille,y=paneTop+g.height/2,front=s.front-.01,rear=s.rear+.01,middle=(front+rear)/2,run=s.gx-.06,count=Math.max(1,Math.floor(run/g.pitch));
            for(const [side,faceZ] of [[1,front],[-1,rear]]){
                const housing=this.box(group,[s.gx,g.height,Math.abs(faceZ-middle)],[s.x,y,(faceZ+middle)/2],frame,{shadow:false});housing.name='window-rooster';housing.userData.scopeKey='frontOpening';s.parts.push(housing);
                const zz=faceZ+side*.001,sy=y+g.height/2-g.below;
                const slot=this.box(group,[run,g.slot,.002],[s.x,sy,zz],slots,{shadow:false});slot.name='window-rooster-slots';slot.userData.scopeKey='frontOpening';s.parts.push(slot);
                const dividers=new THREE.InstancedMesh(new THREE.BoxGeometry(g.divider,g.slot,.004),frame,count),at=new THREE.Matrix4();
                for(let k=0;k<count;k++){at.makeTranslation(s.x-run/2+(k+.5)*run/count,sy,zz+side*.001);dividers.setMatrixAt(k,at);}
                dividers.name='window-rooster-dividers';dividers.userData.scopeKey='frontOpening';group.add(dividers);s.parts.push(dividers);
            }
        };
        // The handles of the references, on the stile the layout names and on both faces: the small flush pull of a
        // schuifpui and a harmonicapui (a rim around a dark pocket, in the frame colour), and the deurkruk of an
        // openslaande deur — a satin-silver lever on a round rosette pointing to the hinge side, a cylinder rosette
        // under it, the same on the white and the anthracite door.
        const handle=s=>{
            const edge=s.section.handle.edge==='left'?-1:1,hx=s.x+edge*(s.width/2-s.edgeStile(edge)/2);
            if(s.section.handle.type==='pull'){
                const p=KOZIJN.pull,y=y0+(family==='folding'?p.foldingY:p.y),recess=this.material('window-pull-recess',{color:'#1c1f1e',roughness:.8});
                for(const [side,faceZ] of [[1,s.front],[-1,s.rear]]){
                    const zz=faceZ+side*p.proud/2;
                    s.parts.push(profile([p.width,p.height,p.proud],[hx,y,zz],frame,'window-pull'));
                    const pocket=this.box(group,[p.width-.018,p.height-.026,.003],[hx,y,zz+side*(p.proud/2+.0005)],recess,{shadow:false});pocket.name='window-pull-recess';s.parts.push(pocket);
                }
            } else {
                const l=KOZIJN.lever,steel=this.material('window-lever',{color:l.color,metalness:.6,roughness:.32});
                const disc=(r,depth,at,name)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,depth,28),steel);mesh.rotation.x=Math.PI/2;mesh.position.set(...at);mesh.castShadow=true;mesh.name=name;group.add(mesh);s.parts.push(mesh);return mesh;};
                for(const [side,faceZ] of [[1,s.front],[-1,s.rear]]){
                    disc(l.rose,l.proud,[hx,y0+l.y,faceZ+side*l.proud/2],'window-lever-rose');
                    disc(.007,l.reach,[hx,y0+l.y,faceZ+side*l.reach/2],'window-lever');
                    const grip=new THREE.Mesh(profileGeometry(l.length,l.height,l.height),steel);grip.position.set(hx-edge*(l.length/2-.008),y0+l.y,faceZ+side*(l.reach-l.height/2));
                    grip.castShadow=true;grip.name='window-lever';group.add(grip);s.parts.push(grip);
                    disc(l.rose,l.proud,[hx,y0+l.cylinder,faceZ+side*l.proud/2],'window-cylinder');
                }
            }
        };
        // One glazed sash between its edges, its front face `back` behind the frame face. A door's hinge stile and
        // meeting stile differ (89 / 95 mm on the reference); every other sash has one stile width.
        const sash=(section,[left,right],{back,depth=spec.sash,glassBack=depth/2,members=sectionMembers(spec,section)})=>{
            const x=(left+right)/2,width=right-left,front=face-back,rear=front-depth,height=ceiling-bottom;
            const edgeStile=edge=>section.role==='door'&&family==='french'?((edge<0)===(section.hinge==='left')?spec.stile:spec.meetingStile):spec.stile;
            const [sl,sr]=[edgeStile(-1),edgeStile(1)],gx=width-sl-sr,gxCentre=left+sl+gx/2;
            const s={section,x:gxCentre,width,stile:spec.stile,edgeStile,pz:front-glassBack,front,rear,gx,glassTop:ceiling-members.top,glassBottom:bottom+members.bottom,parts:[]};
            s.parts.push(profile([sl,height,depth],[left+sl/2,bottom+height/2,front-depth/2],frame,'sash-stile'),profile([sr,height,depth],[right-sr/2,bottom+height/2,front-depth/2],frame,'sash-stile'));
            s.parts.push(profile([gx,members.top,depth],[gxCentre,ceiling-members.top/2,front-depth/2],frame,'sash-rail'),profile([gx,members.bottom,depth],[gxCentre,bottom+members.bottom/2,front-depth/2],frame,'sash-rail'));
            glaze(s);
            // The handle centres on its stile: measured from the section's own edges, not from the pane.
            if(section.handle)handle({...s,x});
            return s;
        };
        // A side light of openslaande deuren is glazed straight into the frame, over the frame's own sill member.
        const light=(section,[left,right])=>{
            const x=(left+right)/2,gx=right-left,members=sectionMembers(spec,section),pz=face-spec.lightBack;
            // front / rear bound the grille box: its faces stand 20 mm off the glass, 44 mm behind the frame face.
            const s={section,x,width:gx,stile:0,edgeStile:()=>0,pz,front:pz+.03,rear:pz-.03,gx,glassTop:ceiling,glassBottom:bottom+members.bottom,parts:[]};
            s.parts.push(profile([gx,members.bottom,spec.frameDepth],[x,bottom+members.bottom/2,frameZ],frame,'frame-rail'));
            glaze(s);
            return s;
        };
        // 2.18.0: every section that opens hangs in a leaf group on its hinge line — a door on its outer face at the hinge
        // stile, a folding leaf and a sliding leaf on their own plane — so the kozijn can open the way it is built to
        // (kozijn_motion.js) and close back to exactly this.
        const rest=sectionPoses(m.panels,edges,0,{stile:spec.stile}),leaves=[];
        m.panels.forEach((section,i)=>{
            const s=family==='sliding'?sash(section,edges[i],{back:section.role==='sliding'?spec.slidingBack:spec.fixedBack})
                :family==='folding'?sash(section,edges[i],{back:spec.back})
                :section.role==='door'?sash(section,edges[i],{back:spec.back,glassBack:spec.glassBack}):light(section,edges[i]);
            for(const part of s.parts)part.userData.leaf=section.index;
            if(!OPERABLE.includes(section.role))return;
            const pivot=new THREE.Vector3(rest[i].pivotX,0,section.role==='door'?s.front:s.pz),leaf=new THREE.Group();
            leaf.name='kozijn-leaf';leaf.userData={kozijnLeaf:true,section:section.index};leaf.position.copy(pivot);group.add(leaf);
            for(const part of s.parts){leaf.add(part);part.position.sub(pivot);}
            leaves.push({group:leaf,pivot,index:i});
        });
        this.kozijnLeaves=leaves.length?{leaves,sections:m.panels,edges:edges.map(edge=>[...edge]),stile:spec.stile}:null;
        this.applyKozijnPose();
    }

    /** The leaf group a part of the kozijn hangs in, or null: the frame and the fixed glass are no leaf. */
    kozijnLeafOf(object){for(let node=object;node;node=node.parent)if(node.userData?.kozijnLeaf)return node;return null;}
    /** Whether the kozijn is open, or opening: the state a click toggles. */
    get kozijnOpen(){return !!this.kozijnTarget;}
    applyKozijnPose(){
        const k=this.kozijnLeaves;if(!k)return;
        const poses=sectionPoses(k.sections,k.edges,this.kozijnOpenness||0,{stile:k.stile});
        for(const leaf of k.leaves){
            const pose=poses[leaf.index];if(!pose)continue;
            leaf.group.position.set(leaf.pivot.x+pose.dx,leaf.pivot.y,leaf.pivot.z+pose.dz);leaf.group.rotation.y=pose.ry;
        }
    }
    stopKozijnMotion(){
        if(this.kozijnFrame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(this.kozijnFrame);
        clearTimeout(this.kozijnTimer);this.kozijnFrame=null;this.kozijnTimer=null;
    }
    /**
     * Open or close the kozijn. It moves from wherever it is, eased, about a second; the shadow map is redrawn once it
     * comes to rest, not on every frame (the leaves are mostly glass, and eight shadow passes a frame would stutter on a
     * phone). At once with `instant`, with reduced motion, in a proposal image and without a browser.
     */
    setKozijnOpen(open,{instant=false,done=null}={}){
        this.stopKozijnMotion();
        if(!this.kozijnLeaves){this.kozijnTarget=0;return false;}
        const to=open?1:0,from=this.kozijnOpenness||0;this.kozijnTarget=to;
        if(instant||from===to||this.documentMode||reducedMotion()||typeof requestAnimationFrame!=='function'){
            this.kozijnOpenness=to;this.applyKozijnPose();this.shadowsDirty=true;this.render();done?.();return true;
        }
        const duration=Math.abs(to-from)*(to?KOZIJN_MOTION.openMs:KOZIJN_MOTION.closeMs),start=performance.now();
        const step=now=>{
            this.kozijnFrame=null;
            const t=Math.min(1,Math.max(0,(now-start)/duration));
            this.kozijnOpenness=from+(to-from)*easeInOut(t);this.applyKozijnPose();
            if(t<1){this.render();this.kozijnFrame=requestAnimationFrame(step);}
            else{this.shadowsDirty=true;this.render();done?.();}
        };
        this.kozijnFrame=requestAnimationFrame(step);
        return true;
    }
    toggleKozijn(){return this.setKozijnOpen(!this.kozijnTarget);}
    /** Right after a kozijn is chosen: it opens, stays open a moment and closes again — once, never with reduced motion. */
    previewKozijn(){
        if(!this.kozijnLeaves||this.documentMode||reducedMotion()||typeof requestAnimationFrame!=='function')return false;
        this.stopKozijnMotion();
        this.kozijnTimer=setTimeout(()=>this.setKozijnOpen(true,{done:()=>{this.kozijnTimer=setTimeout(()=>this.setKozijnOpen(false),KOZIJN_MOTION.holdMs);}}),KOZIJN_MOTION.delayMs);
        return true;
    }

    makeRooflight(m,frame,glass,inside) {
        const r=m.rooflight,o=r.opening,baseY=r.baseY,rise=r.rise,lip=.11;
        // Opstand, kerb, cheeks, glass and its frame lines are the daklicht; the zonwering under the glass is tagged
        // separately below, so a click from inside lands on the blind and a click from outside on the rooflight.
        const firstPart=this.roofGroup.children.length;
        // The upstand is the roofer's work: the roof membrane dressed up the kerb, whatever colour the kozijn has
        // (2.17.0, the owner's photographs — a dark kerb under a white frame). It used to take the kozijn colour, so a
        // white kozijn gave a white box on the roof and the frame on top of it had nothing to stand out against.
        const kerb=this.surface('roof-membrane',ROOF_MEMBRANE);
        // The kerb stands on the membrane, which lies ROOF_RECESS under the slab top, and a capping closes its top
        // between the glass edge and the outer kerb face on all four sides. The capping starts AT the glass edge:
        // when it reached 2 cm in under the glass it showed through as a white ledge running round inside the shaft
        // (the owner's red crosses, 2.17.0 — "daklichtte koymuş olduğun bu iç destek profillerini kaldır").
        const kerbFoot=m.height+.08-ROOF_RECESS;
        for(const side of [-1,1])this.box(this.roofGroup,[.05,baseY-kerbFoot,r.depth+.20],[side*(r.width/2+.085),(baseY+kerbFoot)/2,r.z],kerb).name='rooflight-kerb';
        for(const side of [-1,1])this.box(this.roofGroup,[r.width+.22,baseY-kerbFoot,.05],[0,(baseY+kerbFoot)/2,r.z+side*(r.depth/2+.085)],kerb).name='rooflight-kerb';
        for(const side of [-1,1]){
            this.box(this.roofGroup,[lip,.025,r.depth+2*lip],[side*(r.width/2+lip/2),baseY-.0125,r.z],kerb).name='rooflight-capping';
            this.box(this.roofGroup,[r.width+2*lip,.025,lip],[0,baseY-.0125,r.z+side*(r.depth/2+lip/2)],kerb).name='rooflight-capping';
        }
        // The shaft is lined in the room's own wall finish right up to the glass, on all four sides, so from the room
        // you look up past plain walls into the sky and from outside you look down onto the same plain walls. Until
        // 2.17.0 the lining stopped 13 cm under the glass and the gap showed the kerb behind it; corner posts and a
        // ledge stood in front of that — the "inner supports" the owner asked to take out. 8 mm inside the glass
        // line, so the lining is the first surface the room sees, not the cheek behind it.
        const foot=m.height-.06,high=baseY+rise,t=.008;
        const lining=mesh=>{mesh.name='rooflight-lining';mesh.castShadow=false;mesh.receiveShadow=true;this.roofGroup.add(mesh);return mesh;};
        const sideProfile=r.kind==='gable'
            ?[[o.back,foot],[o.back,baseY],[r.z,high],[o.front,baseY],[o.front,foot]]
            :[[o.back,foot],[o.back,high],[o.front,baseY],[o.front,foot]];
        lining(new THREE.Mesh(extrudedPrism(sideProfile,'x',o.left,o.left+t),inside));
        lining(new THREE.Mesh(extrudedPrism(sideProfile,'x',o.right-t,o.right),inside));
        const backTop=r.kind==='lean'?high:baseY;
        lining(this.box(this.roofGroup,[r.width,backTop-foot,t],[0,(backTop+foot)/2,o.back+t/2],inside,{shadow:false}));
        lining(this.box(this.roofGroup,[r.width,baseY-foot,t],[0,(baseY+foot)/2,o.front-t/2],inside,{shadow:false}));
        // Closed ends: solid cheeks from the glass edge out to the kerb face, so no side, back or front stays open.
        const solid=(profile,axis,from,to)=>{const mesh=new THREE.Mesh(extrudedPrism(profile,axis,from,to),kerb);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='rooflight-cheek';this.roofGroup.add(mesh);};
        if(r.kind==='lean'){
            const cheek=[[o.back-lip,baseY-.01],[o.back-lip,baseY+rise],[o.back,baseY+rise],[o.front,baseY],[o.front+lip,baseY],[o.front+lip,baseY-.01]];
            solid(cheek,'x',o.left-lip,o.left);solid(cheek,'x',o.right,o.right+lip);
            // Upstand under the high edge at the house side.
            this.box(this.roofGroup,[r.width,rise+.01,lip],[0,baseY+rise/2-.005,o.back-lip/2],kerb).name='rooflight-cheek';
        }
        if(r.kind==='gable'){
            // The ridge runs parallel to the house, so the gable ends are the short left and right sides.
            const end=[[o.back-lip,baseY-.01],[o.front+lip,baseY-.01],[o.front+lip,baseY],[o.front,baseY],[r.z,baseY+rise],[o.back,baseY],[o.back-lip,baseY]];
            solid(end,'x',o.left-lip,o.left);solid(end,'x',o.right,o.right+lip);
        }
        for(const panel of r.panels) {
            const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(panel.points.flat(),3));
            geometry.setIndex([0,1,2,0,2,3]);geometry.computeVertexNormals();
            this.roofGroup.add(new THREE.Mesh(geometry,glass));
        }
        // The glazing profiles (2.17.0, the owner: "bizdeki daklicht çerçeveleri boru gibi duruyor, örnek görseldeki gibi
        // kalın çerçeveleri olsun"). Every line of the frame used to be a 43 mm CYLINDER between two pane corners —
        // literally a pipe. A lichtstraat is glazed in broad, flat aluminium profiles that stand proud of the glass:
        // one per rafter, one along each eaves, one along the high edge or the ridge. Each lies in the plane of its
        // own slope, sunk a little under the glass line so the pane reads as set INTO the frame.
        const bar=(from,to,normal,{width=ROOFLIGHT_BAR.width,height=ROOFLIGHT_BAR.height,sink=ROOFLIGHT_BAR.sink,offset=[0,0,0],overrun=0}={})=>{
            const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),along=b.clone().sub(a),length=along.length();
            along.normalize();
            const up=new THREE.Vector3(...normal);up.addScaledVector(along,-up.dot(along)).normalize();
            const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,length+2*overrun),frame);
            mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up,along),up,along));
            mesh.position.copy(a).add(b).multiplyScalar(.5).addScaledVector(up,height/2-sink).add(new THREE.Vector3(...offset));
            mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='rooflight-bar';this.roofGroup.add(mesh);
        };
        // The profiles round the outside are broader: from half a bar inside the glass edge out over the kerb, 1 cm
        // past its face, so from the garden the frame is the whole top of the daklicht and the kerb is what it stands
        // on. `shift` is how far such a profile's centre lies outside the glass edge.
        const reach=lip+.01,edge=ROOFLIGHT_BAR.width/2+reach,shift=(reach-ROOFLIGHT_BAR.width/2)/2;
        // A lean-to is one slope, high against the house; a zadeldak is two, meeting on a ridge parallel to the house.
        const perSide=r.kind==='gable'?r.panelCount/2:r.panelCount;
        const slopes=r.kind==='gable'?[{low:o.back,top:r.z},{low:o.front,top:r.z}]:[{low:o.front,top:o.back}];
        for(const slope of slopes){
            const run=slope.low-slope.top,out=Math.sign(run),normal=[0,Math.abs(run),rise*out];
            // Rafters lie in the plane of their slope; the two end ones are edge profiles, over the cheeks.
            for(let i=0;i<=perSide;i++){
                const x=o.left+i*r.width/perSide,end=i===0?-1:i===perSide?1:0;
                bar([x,high,slope.top],[x,baseY,slope.low],normal,end?{width:edge,offset:[end*shift,0,0]}:{});
            }
            // The eaves profile is a level sill ON the kerb, not a tilted one cutting through it: tilted, its outer
            // half dips under the kerb's own top (3 cm on a zadeldak) and the two surfaces fight for the same pixels.
            bar([o.left,baseY,slope.low],[o.right,baseY,slope.low],[0,1,0],{width:edge,height:.045,sink:0,offset:[0,0,out*shift],overrun:reach});
            // The high edge of a lean-to stands on the upstand against the house, reaching down to cover the glass.
            if(r.kind==='lean')bar([o.left,high,slope.top],[o.right,high,slope.top],[0,1,0],{width:edge,height:.055,sink:.015,offset:[0,0,-out*shift],overrun:reach});
        }
        // The ridge cap of a zadeldak covers both top edges, which fall away from it on either side. Nothing stands
        // under it: the frame carries itself on the kerb, and the gable ends are closed by the cheeks outside the glass.
        if(r.kind==='gable')bar([o.left,high,r.z],[o.right,high,r.z],[0,1,0],{width:.11,height:.068,sink:.03,overrun:reach});
        for(let i=firstPart;i<this.roofGroup.children.length;i++)this.tag(this.roofGroup.children[i],'rooflight');
        if(m.roofShade){
            const fabric=this.material('roof-shade',{color:'#e5e0d1',roughness:1,side:THREE.DoubleSide});
            const shade=this.box(this.roofGroup,[r.width-.05,.012,r.depth-.05],[0,m.height+.105,r.z],fabric,{shadow:false});
            for(let z=o.back+.025;z<o.front;z+=.045)this.tag(this.box(this.roofGroup,[r.width-.06,.007,.008],[0,m.height+.114,z],this.material('shade-fold',{color:'#c7c3b8',roughness:1}),{shadow:false}),'roofShade');
            shade.name='rooflight-shade';this.tag(shade,'roofShade');
        }
    }

    /**
     * Extruded profile (see `extrudedPrism`) as a lit mesh with the same metric UVs as the boxes: a brick gable
     * continues the courses of the wall below it and a roof slope tiles by the metre. A negative period mirrors.
     */
    prism(group,profile,x0,x1,material,[periodX,periodY]) {
        const geometry=extrudedPrism(profile,'x',x0,x1);
        geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*2),2));
        metricUVs(geometry,[0,0,0],periodX,periodY);
        const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
    }

    /**
     * The existing house per "Woning & tuin" (houseLayout) as typical Dutch housing: a ground floor as high as the
     * extension, a first floor to the eaves 3 m higher and a 45° zadeldak with its ridge parallel to the facade
     * (ceramic tiles, gutter, downpipe, closed gable ends, dark edge boards). A terraced house shares one roof with
     * neighbours on both sides, a semi with the left one, a detached house stands alone. Every wall — including the
     * parts beyond the extension — wears the chosen facade finish; roofs never do. The own house goes into
     * `houseGroup`, everything belonging to the neighbours into `neighbourGroup` (hidden for proposal images and
     * whenever "Buren tonen" is off). The ground floor behind the extension is `makeExistingRoom`, and the street
     * elevation that closes it off from outside is the `house-rear` leaf (HOUSE_LEAF).
     *
     * It used to take the extension's interior lining as a `wall` argument and build the existing house's window
     * joinery out of it. That was an inside material worn outside on some fifty meshes, and it meant ticking
     * "schilderwerk" on the aanbouw's INTERIOR repainted every window frame on the house and on both neighbours.
     * The joinery is its own painted timber now and the argument is gone.
     */
    makeExistingHouse(m,frame) {
        const lay=houseLayout(this.environment,m),finish=lay.finish,brick=finish.startsWith('brick');
        // Both ride in `surroundingsGroup`: the house the aanbouw is built against is context, not merchandise.
        const around=this.surroundingsGroup||this.root;
        this.houseGroup=new THREE.Group();this.houseGroup.name='existing-house';around.add(this.houseGroup);
        this.neighbourGroup=new THREE.Group();this.neighbourGroup.name='neighbours';around.add(this.neighbourGroup);
        // All four bricks reuse the extension's own facade material — one scanned wall per colour, shared with the
        // aanbouw, so house and aanbouw in the same baksteen are literally the same material instance and can never
        // read as two different reds. Stucwerk is the plaster scan tinted.
        // Cool tints cancel the warm cast of the plaster scan (the pre-2.9 house used '#dce5e8' for the same reason).
        // Stucwerk is a paint-like finish, so the tint IS its colour and no colour scan multiplies it. Measured with
        // the beige house_plaster diffuse underneath, "render-white" left the wall at #796d5f — a taupe house, not a
        // white one: that scan's own mean is #9e8c78 and a tint can only ever darken. The scan's normal map stays for
        // the render relief, the interior plaster's roughness map adds the trowel variation the flat tint has not.
        // The tint comes from finishes.js, the same entry the picker chip shows, so the chip and the wall are one
        // value. The neighbours take it one shade darker (shadeHex) so the party line still reads in flat light;
        // both used to be spelled out here as their own hexes, a third copy of a colour the form also claimed.
        const plaster=part=>this.surface(`existing-${part}:${finish}`,{color:part==='house'?finishColor(finish):shadeHex(finishColor(finish),8),roughness:.95,normalMap:'houseNormal',roughnessMap:'stucRough',normalScale:.3});
        const house=brick?this.facade(finish):plaster('house'),neighbour=brick?house:plaster('neighbour');
        if(brick)for(const slot of ['map','normalMap','roughnessMap'])house[slot]?.repeat.set(1,1);
        // The house wears the same wall as the extension: brick finishes take the facade's own period (all four
        // bricks now share it), stucwerk tiles at 2,4 m. No wood finish exists for the house, so no quarter turn
        // is ever needed here and the gable prisms can keep taking a plain period pair.
        const {periodX,periodY}=this.facadePeriods(finish),periods=brick?[periodX,periodY]:[2.4,2.4];
        const uv=(mesh,at)=>metricUVs(mesh.geometry,at,...periods);
        // Ceramic clay tiles (Poly Haven clay_roof_tiles_03, 2,6 m per repeat); the 45° slope is √2 longer than its plan depth.
        const tiles=this.surface('roof-tiles',{color:'#cbc1bb',roughness:.92,map:'tileColor',normalMap:'tileNormal',roughnessMap:'tileRough',normalScale:.7});
        const board=this.material('roof-board',{color:'#2f2d2b',roughness:.75}),gutterMat=this.material('gutter',{color:'#8d918e',roughness:.4,metalness:.85});
        const ridgeMat=this.material('ridge-tile',{color:'#6b4c3f',roughness:.9});
        // The neighbours' windows are opaque dark panels, not glazing: at the old envMapIntensity 1.7 they mirrored the
        // clamped sky brighter than the sky itself and read as white plates on the back of every exterior view.
        const windowMat=this.material('existing-window',{color:'#182022',roughness:.05,metalness:0,envMapIntensity:1.15});
        const sill=this.material('sill',{color:'#8b8d86',roughness:.75});
        // Painted timber joinery, semi-gloss: the kozijn of a Dutch house, and the only white on the outside of it.
        // Deliberately its own key rather than the extension's lining: this is an OUTDOOR material, it takes the
        // outdoor environment strength, and nothing the customer chooses for the aanbouw's inside may repaint it.
        const joinery=this.material('existing-joinery',{color:'#eceae1',roughness:.5});
        // The example front door's leaf. Slate blue rather than another dark green-grey: `dark` (#353b38, the
        // aanbouw's frame) and `roof-board` (#2f2d2b) already own that corner of the palette and a door the eye
        // cannot separate from a daktrim is not worth drawing. Illustrative — see `rearElevation`.
        const doorMat=this.material('existing-door',{color:'#3a4a55',roughness:.45});
        const handleMat=this.material('existing-handle',{color:'#8d918e',roughness:.35,metalness:.8});
        // The rear facade sits directly against the extension (no gap); the houses are 5,2 m deep, the ridge above their middle.
        const b=m.bounds,{reach,houseDepth}=lay,zF=b.back,zR=zF-houseDepth,zM=zF-houseDepth/2,zDeep=zM,z=zF-.40;
        const eaves=m.height+3,overhang=.35,skin=.12,ridge=eaves+houseDepth/2+overhang,tile=2.6,firstFloor=m.height+1.55;
        /**
         * One window in the house's own language: dark pane set back in the reveal, a kozijn of two stiles, a head
         * and a transom, and a lekdorpel under it. `face` is the wall plane it sits in and `out` which way is
         * outdoors (+1 on the garden elevation at zF, -1 on the street elevation at zR), so both elevations are the
         * same five boxes rather than two drifting copies.
         */
        const paneAt=(group,x,y,w,h,face,out)=>{
            this.box(group,[w,h,.025],[x,y,face-out*.01],windowMat);
            for(const xx of [-1,1])this.box(group,[.05,h+.06,.07],[x+xx*(w/2+.01),y,face+out*.03],joinery);
            for(const yy of [-1,1])this.box(group,[w+.07,.05,.07],[x,y+yy*(h/2+.01),face+out*.03],joinery);
            this.box(group,[.04,h-.02,.05],[x,y,face+out*.02],joinery);
            this.box(group,[w+.16,.04,.12],[x,y-h/2-.03,face+out*.06],sill);
        };
        const pane=(group,x,y,w,h)=>paneAt(group,x,y,w,h,zF,1);
        /**
         * A front door in that same language: the kozijn without a bottom rail, a painted leaf, the bovenlicht every
         * Dutch voordeur of this age has over it, a handle and a stone drempel. `sit` is the ground it stands on.
         */
        const doorAt=(group,x,w,h,face,out,sit)=>{
            // Every part overlaps its neighbour the way paneAt's do (15 mm under the stiles, flush at the transom
            // and the head). The first cut left 40 mm of open air between the leaf and the bovenlicht and you could
            // see the brick wall through the door — a slot is what you get for abutting two boxes by arithmetic
            // instead of by construction.
            const leaf=h-.44;
            for(const xx of [-1,1])this.box(group,[.05,h+.05,.07],[x+xx*(w/2+.01),sit+(h+.05)/2,face+out*.03],joinery);
            this.box(group,[w+.07,.05,.07],[x,sit+h+.035,face+out*.03],joinery);
            this.box(group,[w+.07,.06,.07],[x,sit+leaf+.03,face+out*.03],joinery);
            this.box(group,[w,leaf,.045],[x,sit+leaf/2,face+out*.004],doorMat);
            this.box(group,[w,h-leaf-.05,.02],[x,sit+(leaf+.06+h+.01)/2,face-out*.008],windowMat);
            this.box(group,[.035,.16,.05],[x+w/2-.15,sit+1.02,face+out*.04],handleMat);
            this.box(group,[w+.16,.05,.14],[x,sit+.02,face+out*.07],sill);
        };
        const gutterZ=zF+overhang+.03+.065;
        // Rainwater: the gutter hangs before the eaves board; a swan neck brings the downpipe onto the wall.
        const downpipe=(group,x,yEnd)=>{
            // Gutter, swan neck, facade: rounded like the aanbouw's own pipe (2.13.0).
            for(const geometry of pipeGeometries(roundedRoute([[x,eaves-.08,gutterZ],[x,eaves-.45,zF+.07],[x,yEnd,zF+.07]],.08),.04,{radial:12,bendSegments:10})){
                const tube=new THREE.Mesh(geometry,gutterMat);tube.castShadow=true;group.add(tube);
            }
        };
        // One house segment: both roof slopes with soffit, eaves board, gutter and ridge; closed gables where asked;
        // wind boards only on ends that are really open (a gable buried in the neighbour's attic still closes the own house
        // when the neighbours are hidden).
        const segment=(group,x0,x1,material,gables,open,name)=>{
            const w=x1-x0,xc=(x0+x1)/2;
            for(const side of [-1,1]){
                const zE=side>0?zF+overhang:zR-overhang,zWall=side>0?zF:zR;
                // Mirrored courses on the garden slope: the tiles overlap downhill on both sides of the ridge.
                this.prism(group,[[zE,eaves],[zM,ridge],[zM,ridge+skin],[zE,eaves+skin]],x0,x1,tiles,[tile,side*tile/Math.SQRT2]).name=`${name}-roof`;
                this.box(group,[w,.02,overhang+.03],[xc,eaves-.01,(zWall+zE)/2+side*.015],board);
                this.box(group,[w,.2,.03],[xc,eaves+.06,zE+side*.015],board);
                for(const [end,x] of [[open[0],x0],[open[1],x1]])if(end)this.prism(group,[[zE+side*.03,eaves-.03],[zM,ridge-.03],[zM,ridge+skin+.02],[zE+side*.03,eaves+skin+.02]],x-(x===x0?.03:0),x+(x===x1?.03:0),board,[1,1]);
            }
            this.box(group,[w+.08,.11,.13],[xc,eaves-.005,gutterZ],gutterMat);
            this.box(group,[w,.06,.3],[xc,ridge+skin+.02,zM],ridgeMat);
            for(const [end,xa,xb] of [[gables[0],x0,x0+.24],[gables[1],x1-.24,x1]])if(end)this.prism(group,[[zR,eaves],[zF,eaves],[zF,eaves+overhang],[zM,ridge],[zR,eaves+overhang]],xa,xb,material,periods).name=`${name}-gable`;
        };
        /**
         * A group for scenery that describes nothing the customer is buying. The two markers together are what make
         * it switchable and unclickable in ONE place: `illustrative` is what setIllustrativeVisible looks for, and
         * `noPick` makes a ray pass straight through everything inside. Nothing in such a group ever carries a
         * `scopeKey`, so a click cannot open a form field, and nothing in it exists in `buildGeometry`, so it cannot
         * reach a price, a dimension or a quote line.
         */
        const illustrative=(group,name)=>{
            const openings=new THREE.Group();openings.name=name;
            openings.userData={illustrative:'houseOpenings',noPick:true};
            group.add(openings);return openings;
        };
        /**
         * One example street elevation over the span [x0,x1]: the entrance against the left party wall, the living
         * room's window beside it and the two bedroom windows above. Placed to that rule rather than scattered, so a
         * terrace of three reads as a street of three doors at the same distance from their own party wall — which
         * is what the eye reads as "a street" instead of "some windows".
         *
         * Narrow spans drop parts rather than squeeze them: under 1,50 m there is no room for a door beside anything
         * at all, and under 2,92 m none for a window beside the door.
         */
        const rearElevation=(openings,x0,x1)=>{
            const span=x1-x0;if(span<1.5)return null;
            const dw=.96,dh=2.14,doorX=x0+.26+dw/2;
            doorAt(openings,doorX,dw,dh,zR,-1,0);
            // Whatever is left between the door and the far party wall, up to a 2,40 m woonkamerraam, centred in it.
            const free=x1-.34-(x0+.26+dw+.36);
            if(free>=1.0){const w=Math.min(2.4,free);paneAt(openings,x1-.34-free/2,1.45,w,1.5,zR,-1);}
            // Two bedroom windows upstairs, on the same rule as the garden elevation's pair.
            for(const s of [-1,1])paneAt(openings,(x0+x1)/2+s*span/4,firstFloor,Math.min(1.4,span*.28),1.3,zR,-1);
            return openings;
        };
        /** A wing's street elevation: the mirror of the pair it already carries on the garden side. */
        const rearWing=(openings,x,w)=>{
            paneAt(openings,x,1.35,Math.min(1.3,w-.5),1.25,zR,-1);
            paneAt(openings,x,firstFloor,Math.min(1.3,w-.5),1.3,zR,-1);
        };
        // Own house: the first floor above the extension, full-height wings beside it when the facade is wider.
        const g=this.houseGroup;
        const upperAt=[0,(eaves+m.height-.03)/2,zDeep],upper=this.box(g,[m.width,eaves-m.height+.03,houseDepth],upperAt,house);uv(upper,upperAt);upper.name='house-wall';
        for(const x of [-1,1])pane(g,x*m.width/4,firstFloor,Math.min(1.5,m.width*.3),1.3);
        // Ground-floor flanks in the facade finish over the room's inner leaf (5 mm proud of it): buried in a
        // neighbour or wing when there is one, they keep the house closed when the neighbours are hidden.
        //
        // They used to stop 5 mm short at BOTH ends, and that left a 5 mm strip of the room's painted leaf showing
        // at the corner where the house meets the extension — two pixels at 17 m, but cream ones, and the same
        // material the whole street elevation was made of. The street end can now sink into the rear leaf instead of
        // stopping short of it; the garden end runs 2 mm INTO the extension's side wall, where its end face is
        // buried and only a 2 mm return of house finish shows at the junction, which is what a junction looks like.
        for(const side of [-1,1]){const at=[side*(m.width/2-.0475),(m.height+GROUND.bury)/2,zM+.0035],flank=this.box(g,[.105,m.height-GROUND.bury,houseDepth-.003],at,house);uv(flank,at);flank.name='house-flank';}
        // The street elevation of that same ground floor, which simply did not exist before 2.9.6 (HOUSE_LEAF). It
        // runs from below grade (the ground slab's top is at -0.205) up to the underside of the upper wall.
        //
        // It ABUTS its neighbours in this plane rather than overlapping them — exactly m.width wide, exactly up to
        // the upper wall's own underside — because every one of those neighbours (the upper wall, the wings, the
        // party-wall neighbours) already presents a face in this same plane at zR. Overlapping by even 5 mm would
        // put two coplanar faces at one depth and the joint would flicker. The upper wall has abutted the
        // neighbours' walls on exactly this rule since 2.9, so the rule is proven, not guessed.
        //
        // Its outer face is that same plane, and `uv` is the same call with the same period and the same world
        // origin the upper wall used — which is the whole of the UV continuity story: metricUVs writes
        // uv = (worldX/periodX, worldY/periodY) on a wall face, so the courses cross the joint because neither mesh
        // knows the joint is there. Measured in millimetres by scripts/check-wall-seam.mjs.
        const rearAt=[0,(m.height-.28)/2,zR+HOUSE_LEAF/2],rear=this.box(g,[m.width,m.height+.22,HOUSE_LEAF],rearAt,house);
        uv(rear,rearAt);rear.name='house-rear';
        // 2.14.1: the street elevations are only built when the visitor can actually reach them. With the camera
        // held on the garden side (CAMERA_LIMIT) nothing here is ever in frame — not from the tuin, not from the
        // top view, where a vertical pane shows nothing — and not in a proposal image, which uses the same garden
        // standpoints. Measured on the default terraced scene: 60 meshes and ~1k triangles that nobody can see.
        // Vrij rondkijken builds them again (setCameraLimit rebuilds the scene when the limit is lifted).
        const streetSide=this.cameraLimit===false;
        const houseOpenings=streetSide?illustrative(g,'house-rear-openings'):null;
        if(houseOpenings)rearElevation(houseOpenings,b.left,b.right);
        for(const [x0,x1] of [[lay.left,b.left],[b.right,lay.right]]){
            const w=x1-x0;if(w<.01)continue;
            const x=(x0+x1)/2,at=[x,(eaves+GROUND.bury)/2,zDeep],wing=this.box(g,[w,eaves-GROUND.bury,houseDepth],at,house);uv(wing,at);wing.name='house-wall';
            if(w>=1.2){pane(g,x,1.35,Math.min(1.3,w-.5),1.25);pane(g,x,firstFloor,Math.min(1.3,w-.5),1.3);if(houseOpenings)rearWing(houseOpenings,x,w);}
        }
        segment(g,lay.left,lay.right,house,[true,true],[!lay.neighbours.includes(-1),!lay.neighbours.includes(1)],'house');
        // The own downpipe runs beside the right party wall: to the ground on a wing, else onto the extension roof.
        const pipeX=lay.right-.4;downpipe(g,pipeX,pipeX>b.right+.05?.05:m.height+.08-ROOF_RECESS+.04);
        // Brick chimney on the ridge, near the right party wall.
        const chimneyAt=[lay.right-.9,ridge+.125,zM+.3],chimney=this.box(g,[.55,1.25,.55],chimneyAt,house);uv(chimney,chimneyAt);chimney.name='house-chimney';
        this.box(g,[.65,.07,.65],[chimneyAt[0],ridge+.78,zM+.3],frame);
        // Neighbours continue the facade line in the same finish under one roof. Nothing marks the party line: the
        // light 2 cm strip down the facade and the lead flashing over the roof read as white lines across the
        // houses and down the corner where the aanbouw meets the house (2.13.0, "bu beyaz çizgiler olmamalı").
        const n=this.neighbourGroup;
        for(const side of lay.neighbours){
            const edge=side<0?lay.left:lay.right,at=[edge+side*reach/2,(eaves+GROUND.bury)/2,zDeep],wallBox=this.box(n,[reach,eaves-GROUND.bury,houseDepth],at,neighbour);
            uv(wallBox,at);wallBox.name='neighbour-wall';
            pane(n,edge+side*1.45,firstFloor,1.1,1.3);
            pane(n,edge+side*3.7,firstFloor,1.1,1.3);
            pane(n,edge+side*1.25,1.35,1.3,1.25);
            pane(n,edge+side*3.6,1.15,.9,2.0);
            const x0=side<0?edge-reach:edge,x1=side<0?edge:edge+reach;
            // The neighbours get the same example elevation, for the same reason the terrace shares one roof: a row
            // of doors at the same distance from each party wall is what makes it read as a street rather than as
            // one house with two blank walls glued to it. They ride in `neighbourGroup`, so "Buren tonen" and every
            // proposal image drop them without the illustrative switch having to know about them.
            if(streetSide)rearElevation(illustrative(n,'neighbour-rear-openings'),x0,x1);
            segment(n,x0,x1,neighbour,[side<0,side>0],[side<0,side>0],'neighbour');
            downpipe(n,edge+side*.4,.05);
        }
        this.makeExistingRoom(m,z,houseDepth);
    }

    /**
     * The opened rear wall and the living room behind it, as wide as the extension between the party walls: what the
     * garden sees through the glass is a room, not sky. The old wall is opened over the full clear width, so only the
     * (thicker) extension walls and a beam above the opening remain in line.
     */
    makeExistingRoom(m,z,houseDepth) {
        // The old rear wall is gone over the full width and height: floor and ceiling run straight on into the house.
        // Only the house's thinner inner leaf (12 cm against the 22 cm extension wall) leaves a 10 cm step at the join.
        // The room follows the extension's own wall finish AS SOON AS stucwerk is chosen, painted or not: choosing
        // stucwerk is what equalises the two rooms. Reported by the customer on 2026-09-16 with stucwerk but no
        // schilderwerk — the room across the doorbraak read cool off-white (#f4f2ed, R-B +8) against the extension's
        // unpainted stucwerk (#dfdcd4, R-B +22) and looked like a second wall colour. Without stucwerk the extension
        // keeps its grey gipsplaat while the house stays painted, and the two differ on purpose. Its floor is the
        // extension's screed continued (bare when
        // "kaal beton" is chosen); the chosen laminaat/visgraat runs over both in buildFloorFinish.
        // One material instance per finish, shared with the extension (lining/screedFloor), and the same metric UV
        // origin — that is what makes the two rooms read as one room rather than as two abutting boxes.
        const finish=this.lining(m.plaster&&!m.painting?'plaster':'painted'),floor=this.screedFloor(m,'existing-floor');
        // The room stops at the inside of the house's own outer leaf (HOUSE_LEAF) and runs ROOM_BURY into it, so the
        // street elevation has masonry to be made of and no two faces in the stack are ever coplanar. Before 2.9.6
        // the room ran the full house depth and its painted rear lining WAS the street elevation.
        const b=m.bounds,roomDepth=existingRoomDepth(houseDepth),zRoom=b.back-roomDepth/2,leaf=.12,existing=mesh=>{mesh.userData.existing=true;return mesh;};
        // No daylight reaches this far, so the very same paint read colder here (R-B +11 against the extension's
        // +22) and the customer saw a second wall colour. A local warm bounce, not a directional light: a
        // directional one has no falloff and brightened the extension's own ceiling as well.
        this.houseFill=new THREE.PointLight('#ffe7ca',0,roomDepth*1.0,2);
        this.houseFill.position.set(0,m.height*.62,b.back-roomDepth*.45);
        existing(this.root.add(this.houseFill)&&this.houseFill);
        /**
         * The room belongs to the house, and it leaves with the house.
         *
         * All four of its surfaces are the bestaande woning: a living room eight metres deep, drawn so the garden
         * sees a room through the glass instead of sky. The first version of the omgeving switch kept its floor and
         * its rear lining behind, on the argument that they are seen through the doorbraak — true of the half metre
         * nearest the opening, and false of the seven and a half behind it. Measured on the 620 x 320 default with
         * the omgeving off: the rear lining stood 3,4 % of the frame above the daktrim in both tuinperspectieven,
         * the floor ran 2,5 % out past the rear corner, and op het beeld zonder dak — where the room loses its
         * ceiling with the rest of the house — that floor was 22 % of the picture, a laminate plain wider than the
         * product. All of it outside the aanbouw's own silhouette, none of it for sale.
         *
         * So the whole room hangs from `surroundingsGroup` and leaves in one move, and what stands in for it is the
         * doorbraak itself (DOORBRAAK_REVEAL) — the same opening, half a metre deep, in the same materials. Nothing
         * changes while the omgeving is shown: the room is then drawn in full, exactly as before.
         */
        const shell=new THREE.Group();shell.name='existing-room-shell';(this.surroundingsGroup||this.root).add(shell);
        existing(this.screedBox(shell,[m.width,.02,roomDepth],[0,.081,zRoom],floor)).name='existing-room-floor';
        existing(this.linedBox(shell,[m.width,m.height,.1],[0,m.height/2,b.back-roomDepth+.05],finish)).name='existing-room-rear';
        existing(this.linedBox(shell,[m.width,.04,roomDepth],[0,m.height-.072,zRoom],finish)).name='existing-room-ceiling';
        for(const side of [-1,1])existing(this.linedBox(shell,[leaf,m.height,roomDepth],[side*(m.width/2-leaf/2),m.height/2,zRoom],finish)).name='existing-room-flank';
        this.makeDoorbraak(m,roomDepth,floor,finish,leaf);
    }

    /**
     * The opening itself, shown exactly when the room behind it is not (DOORBRAAK_REVEAL).
     *
     * Five surfaces, all of them the first half metre of the room that just left: the floor running on through the
     * opening, the lining that closes it, the two side leaves that give the opening its 10 cm reveal against the
     * thicker extension wall, and the soffit above it. Same materials and same metric UV origin as the room, so
     * with the omgeving switched on and off the pixels nearest the opening are identical — only the seven and a
     * half metres behind them appear or go.
     *
     * The soffit rides with the dak: "Ruimtelijk overzicht zonder dak" takes the extension's own plafond off, and a
     * lid left hanging over the doorbraak in that view is the very thing the room's ceiling was removed for.
     */
    makeDoorbraak(m,roomDepth,floor,finish,leaf) {
        const b=m.bounds,reveal=Math.min(DOORBRAAK_REVEAL,roomDepth),zReveal=b.back-reveal/2;
        const group=new THREE.Group();group.name='doorbraak';this.root.add(group);this.doorbraakGroup=group;
        const existing=mesh=>{mesh.userData.existing=true;return mesh;};
        // Built at the CLEAR opening, not at the full m.width the room behind it has.
        //
        // The room is m.width wide because it is the house, and the house is as wide as the aanbouw. The recess is
        // not the house: it is what is left when the house has gone, and at the full width its outer faces are
        // COPLANAR with the aanbouw's own outer faces while sitting 0,55 m further back, where those walls have
        // already stopped. Any camera to one side then sees past the rear corner onto the far leaf, and it reads as
        // a separate white panel standing beside the product — measured at 3,44 % of the frame on the 150 x 100 unit
        // in the tuinperspectief, with studio paper on both sides of it. Exactly the class of thing the customer
        // asked to have taken out, only smaller.
        //
        // So the recess is inset to the aanbouw's INNER faces: the building's own 22 cm side walls stand in front of
        // it from every camera in front of the back plane, and the leak is gone by construction rather than by
        // budget. Architecturally it is also the honest drawing — with the house gone there is no thinner house leaf
        // for the opening to step against, so it simply continues straight back.
        const clear=Math.max(.3,m.width-2*m.wall),skin=Math.min(leaf,m.wall);
        existing(this.screedBox(group,[clear,.02,reveal],[0,.081,zReveal],floor)).name='doorbraak-floor';
        existing(this.linedBox(group,[clear,m.height,.1],[0,m.height/2,b.back-reveal+.05],finish)).name='doorbraak-rear';
        for(const side of [-1,1])existing(this.linedBox(group,[skin,m.height,reveal],[side*(clear/2-skin/2),m.height/2,zReveal],finish)).name='doorbraak-flank';
        this.doorbraakSoffit=existing(this.linedBox(group,[clear,.04,reveal],[0,m.height-.072,zReveal],finish));
        this.doorbraakSoffit.name='doorbraak-soffit';
        this.applyDoorbraak();
    }
    /**
     * Push the omgeving switch, the administrator's `houseRoom` switch and the dak switch onto the doorbraak.
     * Never renders, for the reason in applyBackdrop.
     *
     * ONE owner per object: this method is the only thing that writes `doorbraakGroup.visible`, which is why the
     * part policy is read here rather than by applyDocumentParts' traversal. Two writers on one flag is how a
     * switch comes to work in the order the calls happened to run in.
     */
    applyDoorbraak() {
        if(this.doorbraakGroup)this.doorbraakGroup.visible=this.surroundingsVisible===false&&this.wantsHouseRoom();
        if(this.doorbraakSoffit)this.doorbraakSoffit.visible=this.roofVisible&&!['cutaway','top'].includes(this.view);
    }
    /**
     * Whether the half metre of the woning behind the doorbraak belongs in the picture being drawn.
     *
     * Always, while the visitor is configuring. In a proposal image it is the administrator's call: the customer's
     * rule is that only the prefab shows ("sadece prefabrik alani gozuksun"), and the aanbouw genuinely has no rear
     * wall — it is delivered open against the house — so a picture of the product alone is the honest default.
     * An administrator who would rather the opening read as an opening switches it back on.
     */
    wantsHouseRoom(){return !this.documentMode||this.documentParts?.houseRoom!==false;}

    makeGarden(m) {
        const b=m.bounds,paving=-.05,lay=houseLayout(this.environment,m);
        const potMat=this.material('pot',{color:'#8d9187',roughness:.86});
        const leafA=this.material('leaf-a',{color:'#627855',roughness:.8,side:THREE.DoubleSide});
        // Two planters at the garden edge of the terrace, standing on the paving (2.13.0, "saksıları prefabrikten biraz
        // uzaklaştır"): beside the pui and the downpipe they covered the foot of the aanbouw in every garden view.
        for(const [x,z,size] of [[b.left+.34,b.front+PLOT.terrace-.38,.42],[b.right-.26,b.front+PLOT.terrace-.26,.27]]) {
            const pot=new THREE.Mesh(new THREE.CylinderGeometry(size*.57,size*.46,size,24),potMat);pot.position.set(x,paving+size/2,z);pot.castShadow=true;pot.receiveShadow=true;this.decorGroup.add(pot);
            const rim=new THREE.Mesh(new THREE.TorusGeometry(size*.54,.012,6,32),potMat);rim.rotation.x=Math.PI/2;rim.position.set(x,paving+size,z);this.decorGroup.add(rim);
            const leaves=new THREE.InstancedMesh(new THREE.SphereGeometry(1,6,4),leafA,220),dummy=new THREE.Object3D();
            let seed=113;const random=()=>{seed=seed*16807%2147483647;return seed/2147483647;};
            for(let i=0;i<220;i++){
                const angle=random()*Math.PI*2,rad=Math.sqrt(random())*size*.53,y=random()*size*.58;
                dummy.position.set(x+Math.cos(angle)*rad,paving+size*.93+y,z+Math.sin(angle)*rad);
                dummy.scale.set(size*.06,size*.15,size*.018);dummy.rotation.set(random()*2,angle,random()*1.2-.6);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
                leaves.setColorAt(i,new THREE.Color().setHSL(.23+random()*.045,.22+random()*.14,.30+random()*.16));
            }
            leaves.castShadow=true;this.decorGroup.add(leaves);
        }
        // Garden set on the terrace, kept clear of the doors. The set the customer sees is the CC0 folding teak
        // bistro set (loadGardenSet, kicked off by buildScene); what is built here is the stand-in that holds the
        // spot while that downloads and stays put if it never arrives — a missing asset must not empty the terrace.
        const set=new THREE.Group();set.name='garden-set';set.position.set(Math.max(0,b.right-1.35),paving,b.front+GARDEN_SET.standoff);
        this.decorGroup.add(set);this.gardenSet=set;this.gardenSetLoaded=false;
        this.buildGardenSet(set,null);
        // Lawn and boundary: schuttingen on the party lines continue the side walls; a back fence closes the garden.
        // Free sides (semi right, detached both) are side gardens in grass with the boundary fence running past the house.
        const grass=this.surface('ground',{color:'#8fb277',roughness:1,map:'grassColor',normalMap:'grassNormal',normalScale:.55});
        // The lawn starts where the terras ends and runs to just past the back schutting (b.front + 10,4).
        const lawnDepth=10.4-PLOT.terrace,lawn=[(lay.boundaryLeft+lay.boundaryRight)/2,GROUND.lawn-.007,b.front+PLOT.terrace+lawnDepth/2];
        const lawnBox=this.box(this.decorGroup,[lay.boundaryRight-lay.boundaryLeft+.02,.014,lawnDepth],lawn,grass,{shadow:false});
        lawnBox.name='garden-lawn';metricUVs(lawnBox.geometry,lawn,6,6);
        const zSide=b.back-lay.houseDepth-.2,free=side=>!lay.neighbours.includes(side),boundary=side=>side<0?lay.boundaryLeft:lay.boundaryRight;
        for(const side of [-1,1]){
            if(!free(side))continue;
            const x0=side<0?lay.boundaryLeft:b.right+.275,x1=side<0?b.left-.275:lay.boundaryRight,at=[(x0+x1)/2,GROUND.lawn-.007,(zSide+b.front+PLOT.terrace)/2];
            if(x1-x0>.01)metricUVs(this.box(this.decorGroup,[x1-x0,.014,b.front+PLOT.terrace-zSide],at,grass,{shadow:false}).geometry,at,6,6);
        }
        // 2.11.0, Vormgeving → Schutting in de tuin: off, no schutting at all — no planks, no posts — and
        // updatePlotFade pulls the island in to just behind the terras. The customer: "telefonda ve mobilde bahçe
        // çiti bize engel oluyor" (from the right-hand camera the side schutting stood in front of the gevel).
        if(this.gardenFence!==false)this.buildGardenFence(b,lay,zSide,free,boundary); // unset (a bare instance) = on
    }
    /**
     * The garden boundary (garden_fence.js, 2.12.0): the two side runs on the boundary lines and the back run, split
     * into panels of at most 1,8 m that each step aside when they would stand in front of the aanbouw
     * (updateFenceOcclusion). The style is the visitor's own Woning en tuin choice, else the website's default
     * (Vormgeving → Soort afscheiding), else the modern slat fence.
     */
    buildGardenFence(b,lay,zSide,free,boundary){
        const style=FENCE_STYLE_IDS.includes(this.environment?.fenceStyle)?this.environment.fenceStyle:DEFAULT_FENCE_STYLE;
        const zBack=b.front+PLOT.garden,runs=[];
        for(const side of [-1,1])runs.push({kind:'side',side,start:[boundary(side),free(side)?zSide:b.front+.10],end:[boundary(side),zBack]});
        runs.push({kind:'back',side:0,start:[lay.boundaryLeft,zBack],end:[lay.boundaryRight,zBack]});
        const root=new THREE.Group();root.name='garden-fence';root.userData.style=style;
        // Panels and posts are built from y=0 up; the whole run is set down on the grass, so 1,80 m of schutting
        // is 1,80 m above the lawn and no daylight shows under it (2.14.1).
        root.position.y=GROUND.lawn;this.decorGroup.add(root);
        const post=style==='classic'?this.material('garden-post',{color:'#9a978e',roughness:.9})
            :this.material('garden-post-modern',{color:'#2f3336',roughness:.55,metalness:.35});
        const addPost=(node,x,size,run)=>{const mesh=this.box(node,size,[x,size[1]/2,0],post);mesh.userData={fencePost:true,run};return mesh;};
        this.fencePanels=[];
        for(const panel of fencePanels(runs)){
            const run=runs.find(r=>r.kind===panel.kind&&(panel.kind==='back'||Math.abs(r.start[0]-panel.center[0])<1e-6));
            const node=new THREE.Group();node.name=`garden-fence-panel-${panel.index}`;
            node.position.set(panel.center[0],0,panel.center[1]);node.rotation.y=panel.yaw;
            node.userData={fencePanel:true,kind:panel.kind};
            // Local +z points out of the plot on every run (see garden_fence.js fencePanels): a thick hedge grows
            // OUTWARD from the boundary line, so it never eats into the terras or stands in front of the side wall.
            const outward=panel.kind==='back'?1:(run?.side<0?1:-1);
            if(style==='modern'){
                const parts=modernPanelParts(panel.length,panel.index);
                const slats=new THREE.Mesh(mergedBoxes(parts.slats),this.surface('garden-fence-modern',{color:'#ffffff',roughness:.78,map:'woodColor',normalMap:'woodNormal',roughnessMap:'woodRough',normalScale:.45}));
                slats.castShadow=true;slats.receiveShadow=true;slats.name='garden-fence-slats';node.add(slats);
                const cap=new THREE.Mesh(mergedBoxes(parts.cap),this.material('garden-fence-cap',{color:'#3a3f42',roughness:.5,metalness:.4}));
                cap.castShadow=true;node.add(cap);
                addPost(node,-panel.length/2,[.08,FENCE_HEIGHT+.05,.08],panel.kind);
                if(panel.last)addPost(node,panel.length/2,[.08,FENCE_HEIGHT+.05,.08],panel.kind);
            } else if(style==='hedge'){
                const hedge=this.material('garden-hedge',{color:'#ffffff',roughness:.95});
                if(!hedge.map&&this.hedgeMap()){hedge.map=this.hedgeMap();hedge.needsUpdate=true;}
                const at=[0,(HEDGE.height-.04)/2,outward*HEDGE.depth/2];
                const body=this.box(node,[panel.length+.02,HEDGE.height-.04,HEDGE.depth-.04],at,hedge);
                metricUVs(body.geometry,at,1.1,1.1);body.name='garden-hedge-body';
                const leaves=hedgeLeaves(panel.length,panel.index);
                // A smooth low sphere, squashed per instance: faceted icosahedra read as crystals (2.12.0, first render).
                const tufts=new THREE.InstancedMesh(new THREE.SphereGeometry(1,7,5),this.material('garden-hedge-leaf',{color:'#ffffff',roughness:.9}),leaves.length);
                const dummy=new THREE.Object3D(),colour=new THREE.Color();
                leaves.forEach((leaf,i)=>{
                    dummy.position.set(leaf.position[0],leaf.position[1],leaf.position[2]+outward*HEDGE.depth/2);
                    dummy.scale.set(leaf.scale*1.3,leaf.scale,leaf.scale*.8);dummy.rotation.set(i*.7,i*1.3,i*.4);dummy.updateMatrix();tufts.setMatrixAt(i,dummy.matrix);
                    tufts.setColorAt(i,colour.setHSL(leaf.hue,.4,leaf.light,THREE.SRGBColorSpace)); // meant as sRGB, like the texture
                });
                tufts.castShadow=true;tufts.receiveShadow=true;tufts.name='garden-hedge-leaves';node.add(tufts);
            } else {
                const parts=classicPanelParts(panel.length,panel.index);
                // Planks carry the scanned weathered softwood, lifted above 1 per plank (the scan was shot in shade).
                if(!this.materials.has('surface:garden-fence'))this.surface('garden-fence',{color:'#ffffff',roughness:1,map:'fenceColor',normalMap:'fenceNormal',roughnessMap:'fenceRough',aoMap:'fenceAo',aoMapIntensity:.9,normalScale:.6}).vertexColors=true;
                const planks=new THREE.Mesh(mergedBoxes(parts.planks,{colors:true}),this.surface('garden-fence',{}));
                planks.castShadow=true;planks.receiveShadow=true;planks.name='garden-fence-planks';node.add(planks);
                if(panel.kind==='side'){addPost(node,-panel.length/2,[.07,1.85,.07],panel.kind);if(panel.last)addPost(node,panel.length/2,[.07,1.85,.07],panel.kind);}
            }
            root.add(node);node.updateWorldMatrix(true,true);
            node.userData.box=new THREE.Box3().setFromObject(node);
            this.fencePanels.push(node);
        }
        this.fenceOcclusionKey='';
    }

    /**
     * The haag's leaf texture, drawn once per preview on a canvas: a dark green ground covered by some 5000 small
     * leaves in varied greens, repeated seamlessly (a leaf crossing an edge is drawn on the opposite edge too).
     * Cheap to draw and to render — one map instead of thousands of clusters. Null where there is no canvas (tests).
     */
    hedgeMap(){
        if(this.hedgeTexture!==undefined)return this.hedgeTexture;
        if(typeof document==='undefined'){this.hedgeTexture=null;return null;}
        const size=512,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
        const ctx=canvas.getContext('2d'),random=seeded(9173);
        ctx.fillStyle='#2b4526';ctx.fillRect(0,0,size,size);
        for(let i=0;i<5200;i++){
            const x=random()*size,y=random()*size,r=3+random()*6,angle=random()*Math.PI;
            ctx.fillStyle=`hsl(${92+random()*28},${34+random()*22}%,${15+random()*24}%)`;
            for(const dx of [-size,0,size])for(const dy of [-size,0,size]){
                if((dx&&Math.min(x,size-x)>r)||(dy&&Math.min(y,size-y)>r))continue;
                ctx.beginPath();ctx.ellipse(x+dx,y+dy,r,r*.55,angle,0,Math.PI*2);ctx.fill();
            }
        }
        const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
        texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
        this.hedgeTexture=texture;return texture;
    }

    /**
     * "Hangi açıdan bakarsak o taraftaki çitin kesişen blok gözükmesin": each render, every panel that stands between
     * the camera and the aanbouw (garden_fence.js occludingPanels) is hidden, and shown again once the camera has
     * moved on. Seen square on, the side runs are beside the line of sight and stay. Cheap: ~17 panels × 27 rays
     * against boxes, and the shadow map is only redrawn when a panel actually changes.
     *
     * The garden set follows the same rule (2.13.1, "masa sandalyeleri de prefabrik görünümüne engel olmasın"). It
     * stands 2 m out on the longer terras, so from the opening camera, which looks down from the garden, it falls on
     * the paving in front of the aanbouw and stays; seen square on at eye height nothing on a 5 m wide terras can
     * clear the pui, and there it steps aside. Its box is taken fresh whenever the camera has moved, because the CC0
     * set replaces the stand-in after the first frames (buildGardenSet clears the key).
     */
    updateFenceOcclusion(){
        const panels=this.fencePanels||[],set=this.gardenSet?.parent?this.gardenSet:null;
        if((!panels.length&&!set)||!this.model?.bounds||!this.camera?.position)return;
        const eye=this.camera.position,key=`${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)}|${panels.length}|${set?.uuid||''}`;
        if(key===this.fenceOcclusionKey)return;
        this.fenceOcclusionKey=key;
        const boxes=panels.map(node=>({node,box:node.userData.box}));
        if(set){set.updateWorldMatrix(true,true);boxes.push({node:set,box:new THREE.Box3().setFromObject(set)});}
        const hidden=occludingPanels(eye,this.model.bounds,this.model.height,boxes);
        let changed=false;
        for(const entry of boxes){const visible=!hidden.has(entry);if(entry.node.visible!==visible){entry.node.visible=visible;changed=true;}}
        if(changed)this.shadowsDirty=true;
    }

    /**
     * Fill the garden-set group: the loaded CC0 scene when it is there, the procedural stand-in when it is not.
     * Both paths get the cushions, because the model ships bare teak and steel and an outdoor set without a seat
     * pad reads as a cafe terrace in November. Returns true when the group was (re)filled.
     */
    buildGardenSet(set,loaded) {
        if(!set)return false;
        const tablePart=loaded?gardenPart(loaded,GARDEN_SET.table):this.gardenStandIn('table');
        const chairPart=loaded?gardenPart(loaded,GARDEN_SET.chair):this.gardenStandIn('chair');
        if(!tablePart||!chairPart)return false;
        // gardenPart carries its own rotation and re-centring, so the cushions get their OWN parent: their measured
        // coordinates are canonical-chair coordinates, and putting them inside the part would push them through the
        // model's yaw and offset as well.
        const table=new THREE.Group(),chair=new THREE.Group();
        table.add(tablePart);chair.add(chairPart);
        // What is being replaced is the stand-in, and its geometry is ours alone, so it goes back to the GPU here —
        // buildScene's release() only runs on the NEXT rebuild. A loaded set would never be disposed here: its
        // buffers are shared with the loader cache and with every other clone of the same model.
        for(const child of [...set.children]){
            if(!this.gardenSetLoaded)child.traverse(object=>object.geometry?.dispose());
            child.removeFromParent();
        }
        // Sand canvas, the colour outdoor cushions actually come in beside teak — off-white goes grey in the shade
        // and anthracite disappears into the frame.
        const fabric=this.material('garden-cushion',{color:'#ddd4c0',roughness:.94});
        const {seat,back}=GARDEN_SET;
        const pad=(geometry,y,z,tilt)=>{const m=new THREE.Mesh(geometry,fabric);m.position.set(0,y,z);m.rotation.x=tilt??0;chair.add(m);};
        pad(softPad(seat.width,seat.thickness,seat.depth,{radius:.05,bevel:.022}),seat.y+seat.thickness/2,seat.z);
        pad(softPad(back.width,back.thickness,back.height,{radius:.045,bevel:.02}),back.y,back.z,back.tilt);
        table.name='garden-table';set.add(table);
        for(const [ux,uz,rotation] of GARDEN_SET.seats){
            const copy=chair.clone(true);copy.name='garden-chair';
            copy.position.set(ux*GARDEN_SET.ring,0,uz*GARDEN_SET.ring);copy.rotation.y=rotation;
            set.add(copy);
        }
        set.traverse(object=>{if(object.isMesh)object.castShadow=object.receiveShadow=true;});
        this.gardenSetLoaded=!!loaded;
        this.fenceOcclusionKey=''; // its box changed: measure again on the next frame (updateFenceOcclusion)
        return true;
    }

    /**
     * Procedural stand-in for one part of the garden set, at the CC0 model's own size so the two are swappable:
     * a 0.69 m square folding table (0.726 high) and a 0.42 x 0.56 m folding chair (seat 0.40, back 0.86).
     *
     * It is not the old box-and-cylinder set: the top and the seat are real slats with real gaps between them, the
     * structure is the crossed tube frame a folding set actually has, and the materials are weathered teak and
     * matte powder coat rather than plastic grey. This is what the terrace shows while the model downloads, and
     * what it keeps if the download never lands.
     */
    gardenStandIn(kind) {
        const teak=this.material('garden-teak',{color:'#a2763f',roughness:.8});
        const frame=this.material('garden-frame',{color:'#34383a',roughness:.62,metalness:.35});
        const group=new THREE.Group();
        const tube=(a,b,thickness=.019)=>{const m=lineBetween(a,b,frame,thickness);group.add(m);return m;};
        const slat=(size,at,rotationX=0)=>{const m=this.box(group,size,at,teak);m.rotation.x=rotationX;return m;};
        if(kind==='table'){
            const top=.726,half=.346,width=.062,gap=.0125;
            for(let i=0;i<9;i++)slat([half*2,.022,width],[0,top-.011,-half+.012+width/2+i*(width+gap)]);
            for(const z of [-.22,.22])this.box(group,[half*2-.05,.028,.032],[0,top-.037,z],frame);
            // Two crossed leg frames with a stretcher between them: the whole structure of a folding table.
            for(const z of [-.24,.24]){
                tube([-half+.035,0,z],[half-.11,top-.05,z],.021);
                tube([half-.035,0,z],[-half+.11,top-.05,z],.021);
                tube([-half+.035,.012,z],[half-.035,.012,z],.016);
            }
            tube([0,.315,-.24],[0,.315,.24],.016);
            return group;
        }
        // Same measured pose as the CC0 chair (GARDEN_SET): seat top 0.397, backrest on the plane z = 0.067 − 0.396·y
        // between y 0.559 and 0.859, so the cushions land identically whichever chair is on the terrace.
        const half=.198,seatY=.397,lean=.377,rest=y=>.067-.396*y;
        for(const side of [-1,1]){
            const x=side*half;
            tube([x,0,.26],[x,seatY-.022,-.115]);                                    // front leg, crossing back
            tube([x,0,-.26],[x,seatY-.05,.17]);                                      // rear leg, crossing forward
            tube([x,seatY-.03,rest(.559)],[x,.859,rest(.859)]);                      // back upright, on the fitted plane
        }
        for(const [y,z,t] of [[.055,.26,.015],[.055,-.26,.015],[seatY-.03,-.115,.016],[seatY-.03,.26,.016]])tube([-half,y,z],[half,y,z],t);
        tube([-half,.859,rest(.859)],[half,.859,rest(.859)],.016);
        // Five seat slats and six back slats with a 2 cm gap between them: at the 7 mm the first pass used, the back
        // closed up into a solid board with grooves and the chair stopped reading as a folding chair at all.
        for(let i=0;i<5;i++)slat([half*2-.01,.015,.048],[0,seatY-.0075,i*.068]);
        for(let i=0;i<6;i++){const y=.577+i*.052;slat([half*2-.012,.028,.013],[0,y,rest(y)],-lean);}
        return group;
    }

    /**
     * Load the CC0 garden set and swap it in for the stand-in. Deliberately shaped like applyScenario: the same
     * lazy import, the same shared model loader (so the ARM-as-aoMap wiring and the parsed-scene cache are the
     * ones interior_scenes.js already owns), the same token so a rebuild mid-download does not land on a dead group.
     * A failure is a warning and the stand-in stays — never an exception out of buildScene.
     */
    async loadGardenSet() {
        const token=this.gardenToken=(this.gardenToken||0)+1,set=this.gardenSet;
        if(!this.renderer||this.failed||!set)return false;
        try {
            const scenes=await import('./interior_scenes.js');
            if(token!==this.gardenToken||this.gardenSet!==set)return false;
            this.modelLoader??=scenes.createModelLoader({baseUrl:new URL('./assets/models/',import.meta.url).href});
            const loaded=await this.modelLoader.load(GARDEN_SET.model);
            if(token!==this.gardenToken||this.gardenSet!==set||!loaded)return false;
            if(!this.buildGardenSet(set,loaded))return false;
            this.shadowsDirty=true;this.render();return true;
        } catch(error) {console.warn('Tuinset niet beschikbaar',error);return false;}
    }

    /** "Woning & tuin" settings; the scene is rebuilt only when the house or garden part actually changed. Returns whether it did. */
    /** Vormgeving → Schutting in de tuin. A change rebuilds the garden (the fence is built, not hidden). */
    setGardenFence(on){
        const next=on!==false,changed=next!==this.gardenFence;
        this.gardenFence=next;
        if(changed&&this.model)this.update(this.config,{force:true});
        return changed;
    }
    setEnvironment(env){
        const next=normalizeEnvironment(env),changed=sceneEnvironmentKey(next)!==sceneEnvironmentKey(this.environment);
        this.environment=next;
        if(changed&&this.model)this.update(this.config,{force:true});
        else this.applyNeighbourVisibility();
        return changed;
    }

    /**
     * "Buren tonen" (NEIGHBOUR_TOGGLE) hides the neighbouring houses in the live view without a rebuild — the
     * cheapest way to drop a few thousand triangles and two shadow casters on a phone. Proposal images never show them.
     */
    /**
     * Show or hide one family of purely illustrative scenery, by the `illustrative` key its group carries.
     *
     * The customer's 2.9.6 request was that the example openings on the house's street elevation can be switched off
     * — "en eigenlijk geldt dat voor alles wat we er als voorbeeld bij zetten". This is the switch itself; the admin
     * screen that will drive it is a separate change, and calling this with `false` is all it has to do.
     *
     * It is a THIRD axis on purpose, beside `examplesVisible` (`visualMode:'representative'` — the example
     * APPLIANCES, which stand in for a product the customer may yet buy) and `decorVisible` (the garden set and the
     * planters). What this switch covers is neither: it is the surroundings, drawn so the extension has somewhere to
     * be. Folding it into either of the other two would mean unticking "Voorbeeldapparaten tonen" took the front door
     * off the house.
     *
     * Groups of this kind never carry a `scopeKey` and always carry `noPick`, so nothing in them can open a form
     * field, and nothing in them exists in `buildGeometry` — so no price, no dimension and no quote line moves when
     * they are shown or hidden. Returns how many groups it found, which is what a test asserts on.
     */
    setIllustrativeVisible(kind,value){
        this.illustrativeOff=this.illustrativeOff||{};
        this.illustrativeOff[kind]=value===false;
        const found=this.applyIllustrativeVisibility();
        this.shadowsDirty=true;this.render();
        return found;
    }
    /** Re-apply the stored switches to a freshly built scene; buildScene throws the old groups away with the root. */
    applyIllustrativeVisibility(){
        const off=this.illustrativeOff||{};let found=0;
        this.root?.traverse(object=>{const kind=object.userData.illustrative;if(!kind)return;found++;object.visible=!off[kind];});
        return found;
    }
    /**
     * A named group whose contents a proposal image may leave out (DOCUMENT_PARTS).
     *
     * Deliberately a MARKER on the object rather than a list of groups held by the class, exactly as `illustrative`
     * is: the floor finish is torn down and rebuilt whenever the visitor changes it, so any list of live groups is
     * stale one click later. A traversal reads whatever is in the scene at the moment it runs and cannot go stale.
     */
    documentPart(part,name,parent){
        const group=new THREE.Group();group.name=name;group.userData.documentPart=part;
        (parent||this.root).add(group);return group;
    }
    /**
     * What the NEXT proposal image leaves out, per the administrator. Stored rather than applied, for the same
     * reason as setDocumentSurroundings: the visitor keeps the whole picture while they are still configuring.
     */
    setDocumentParts(values){
        this.documentParts=documentPartsOf({...this.documentParts,...values});
        this.applyDocumentParts();
        if(this.documentMode){this.fitSunShadow();this.shadowsDirty=true;this.render();}
        return this.documentParts;
    }
    /**
     * Push the part policy onto the scene. Outside a proposal image this shows EVERYTHING: the switches govern the
     * PDF, not the picture the visitor is looking at, and a visitor who cannot see the terrace they are buying
     * because an administrator tidied up a document would be a bug, not a setting.
     */
    applyDocumentParts(){
        const parts=this.documentParts||DOCUMENT_PARTS;let found=0;
        this.root?.traverse(object=>{
            const part=object.userData.documentPart;
            if(!part)return;
            // Only a picture WITHOUT the omgeving is trimmed: with the garden shown, the terras is part of it and
            // a missing apron would be a hole in the lawn. The admin form hides these three switches for the same reason.
            found++;object.visible=!this.documentMode||this.surroundingsVisible!==false||parts[part]!==false;
        });
        // `houseRoom` is not a marker group: the doorbraak recess and its planks already have an owner each, and a
        // second writer on the same flag would make the result depend on call order. They read the policy instead.
        this.applyDoorbraak();this.applyRoomFinish();
        return found;
    }
    /**
     * What the part switches are really doing, read back from the scene graph rather than from the flags that asked
     * for it — the same rule as surroundingsState, and for the same reason: a switch nobody can verify is how the
     * previous version came to promise one picture and produce another.
     */
    documentPartsState(){
        const state={};
        this.root?.traverse(object=>{const part=object.userData.documentPart;if(part)state[part]=object.visible;});
        // Two objects answer for the woning behind the doorbraak and they are never both on: the full room while the
        // omgeving is shown, the 0,55 m recess while it is not. Reported separately, because "houseRoom: true" would
        // be the same word for two different pictures and the point of reading back is to tell them apart.
        state.houseRoom={room:!!this.surroundingsGroup?.visible,doorbraak:!!this.doorbraakGroup?.visible};
        return {documentMode:this.documentMode===true,policy:{...this.documentParts},inScene:state};
    }
    /**
     * What the omgeving switch is actually doing right now, read back from the scene graph rather than from the
     * flag that asked for it — a switch nobody can verify is how the previous version came to promise one picture
     * and produce another. `covers` names the groups it hides, so a test can assert on the list itself.
     *
     * The voorbeeldinrichting hangs from the same group but is NOT listed: it is attached asynchronously by
     * applyScenario, so a snapshot taken while a scenario is reloading would find it missing and any comparison of
     * two snapshots would fail for a reason that has nothing to do with the scene. Which scenario is loaded is
     * already `getSceneInfo().scenario`; that it hangs from this group is asserted in document_views.test.mjs.
     */
    surroundingsState(){
        const group=this.surroundingsGroup;
        return {visible:this.surroundingsVisible!==false,documentSurroundings:this.documentSurroundings===true,
            inScene:!!group&&group.visible,studio:!!this.studioGroup?.visible,
            covers:group?group.children.filter(child=>child!==this.sceneryGroup)
                .map(child=>child.name||(child.geometry?'ground':'')).filter(Boolean).sort():[]};
    }
    /** Which illustrative families this scene carries, and whether each is on. Read by describe() and the tests. */
    illustrativeState(){
        const off=this.illustrativeOff||{},state={};
        this.root?.traverse(object=>{const kind=object.userData.illustrative;if(kind)state[kind]=!off[kind];});
        return state;
    }
    /** `render:false` inside a rebuild: the caller renders once and the flagged shadow pass happens there. */
    applyNeighbourVisibility({render=true}={}){
        if(!this.neighbourGroup)return false;
        // Only the visitor's own "Buren tonen" lives here now. A proposal image drops the buren with the rest of the
        // omgeving, through their shared parent (setSurroundingsVisible), so this flag stays the visitor's alone.
        const visible=this.environment?.renderNeighbours!==false;
        if(this.neighbourGroup.visible===visible)return false;
        // Two houses fewer is a narrower sun frustum and so a finer shadow texel: refit before the next pass.
        this.neighbourGroup.visible=visible;this.updatePlotFade();this.fitSunShadow();this.shadowsDirty=true;if(render)this.render();
        return true;
    }
    /** The lawn material (shared by the plane and the garden lawn) gets the plot fade once; see PLOT. */
    fadeLawn(material){
        this.plotUniforms??={plotRect:{value:new THREE.Vector4(0,0,50,50)},plotFeather:{value:PLOT.feather}};
        if(material.userData.plotFade)return;
        attachPlotFade(material,this.plotUniforms);material.userData.plotFade=true;material.needsUpdate=true;
    }
    /**
     * A soft wall of haze on the horizon. At eye level the plot's haze would meet the sky in a hard line, with the
     * backdrop's darker horizon band right above it; a cylinder round the plot, haze-coloured at its foot and fading
     * to nothing 30 m up, lets the one run into the other — a cloud layer, not a table edge. At 105 m it is almost
     * fully fogged, and from any orbit (27 m) it stays inside the camera's 150 m far plane.
     */
    makeHorizonMist(){
        const radius=105,height=30,geometry=new THREE.CylinderGeometry(radius,radius,height,64,12,true);
        const position=geometry.attributes.position,colors=new Float32Array(position.count*4);
        // Solid for the lowest 4 m: at eye level the horizon crosses the mist about 2 m up, and the strip between the
        // ground plane's far-clipped end and the horizon must be covered completely, not at 87 %.
        for(let i=0;i<position.count;i++){const t=(position.getY(i)+height/2)/height;colors.set([1,1,1,t<.13?1:Math.pow(1-(t-.13)/.87,2)],i*4);}
        geometry.setAttribute('color',new THREE.BufferAttribute(colors,4));geometry.translate(0,height/2-.2,0);
        const material=new THREE.MeshBasicMaterial({color:this.scene?.fog?.color??0xdde2e7,vertexColors:true,transparent:true,depthWrite:false,side:THREE.BackSide});
        const mist=new THREE.Mesh(geometry,material);mist.name='horizon-mist';mist.frustumCulled=false;
        mist.userData={noPick:true,excludeFromAO:true,ownedMaterial:true};
        this.horizonMist=mist;return mist;
    }
    /**
     * The island: the house (and the buren while shown), the side gardens and the garden up to the back schutting.
     * Without the schutting (Vormgeving → Schutting in de tuin) there is no garden boundary to stop at, so the island
     * shrinks to the house's own width and ends PLOT.openGarden in front of the aanbouw — the terras and a strip of
     * lawn — which is the "bahçeyi/adayı daraltalım" half of the same request.
     */
    updatePlotFade(m=this.model){
        if(!m?.bounds||!this.plotUniforms)return null;
        const b=m.bounds,lay=houseLayout(this.environment,m),neighbours=this.environment?.renderNeighbours!==false,fence=this.gardenFence!==false;
        const left=Math.min(neighbours?lay.roofLeft:lay.left,b.left),right=Math.max(neighbours?lay.roofRight:lay.right,b.right);
        const x0=(fence?Math.min(lay.boundaryLeft,left):left)-PLOT.margin,x1=(fence?Math.max(lay.boundaryRight,right):right)+PLOT.margin;
        const z0=b.back-lay.houseDepth-PLOT.margin,z1=b.front+(fence?PLOT.garden:PLOT.openGarden)+PLOT.margin;
        this.plotUniforms.plotRect.value.set((x0+x1)/2,(z0+z1)/2,(x1-x0)/2,(z1-z0)/2);
        return {x0,x1,z0,z1};
    }

    label(text,position) {
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
        const ctx=canvas.getContext('2d');ctx.font='500 48px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle='rgba(242,242,234,.92)';ctx.beginPath();ctx.roundRect(90,25,332,76,16);ctx.fill();ctx.fillStyle='#4b6454';ctx.fillText(text,256,66);
        const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
        // depthWrite off: the label is drawn on top of everything, and its transparent corners must not hide what is
        // drawn after it.
        const material=new THREE.SpriteMaterial({map,depthTest:false,depthWrite:false,transparent:true});
        const sprite=new THREE.Sprite(material);sprite.userData.ownedMaterial=true;sprite.scale.set(1.9,.475,1);sprite.position.set(...position);sprite.renderOrder=20;this.dimensionGroup.add(sprite);
    }

    makeDimensions(m) {
        const mat=this.material('dimensions',{color:'#6e8371',roughness:1});
        const b=m.bounds,z=b.front+.85,x=b.left-.66;
        this.dimensionGroup.add(lineBetween([b.left,.07,z],[b.right,.07,z],mat,.013));
        for(const xx of [b.left,b.right])this.dimensionGroup.add(lineBetween([xx,.07,z-.15],[xx,.07,z+.15],mat,.013));
        this.label(`${Math.round(m.width*100)} cm`,[0,.12,z+.09]);
        this.dimensionGroup.add(lineBetween([x,.07,b.back],[x,.07,b.front],mat,.013));
        for(const zz of [b.back,b.front])this.dimensionGroup.add(lineBetween([x-.15,.07,zz],[x+.15,.07,zz],mat,.013));
        this.label(`${Math.round(m.depth*100)} cm`,[x-.15,.12,0]);
    }

    /**
     * The camera may never go below the ground ("3d alanda zeminden aşağı inilemesin, engellensin her zaman").
     *
     * maxPolarAngle alone did not hold it: it limits the ORBIT around the target, but a pan drags the target itself
     * below grade and the camera follows, and the interior views allow PI-0.02 so the visitor can look up at the
     * ceiling — from which a drag carried the camera through the floor. So the limit is on the two points that
     * matter, whatever moved them: the camera's eye stays CAMERA_FLOOR above the ground plane, and the point it
     * orbits stays at or above grade. The clamp writes positions only; OrbitControls re-reads its spherical offset
     * from them on the next update, so there is no feedback loop and no second 'change' event.
     */
    clampCamera(){
        if(!this.camera||!this.controls)return false;
        let moved=false;
        if(this.controls.target.y<CAMERA_FLOOR.target){this.controls.target.y=CAMERA_FLOOR.target;moved=true;}
        const room=this.cameraRoomBox();
        if(room){
            // A pan moves the orbit point itself, and the eye with it (2.16.2 live audit: a 350 px right-drag put the
            // visitor 0,8 m beyond the side wall; three, 7,7 m out on the lawn — and the hold below assumes the orbit
            // point is in the room). So the orbit point is held in the room first, across and along it, and the eye
            // travels by the same amount: the view keeps its direction. Its height is left alone — the ceiling view
            // aims at the ceiling itself, and the eye's own ceiling is held below.
            const target=this.controls.target;
            const held=new THREE.Vector3(THREE.MathUtils.clamp(target.x,room.left,room.right),target.y,THREE.MathUtils.clamp(target.z,room.back,room.front));
            if(!held.equals(target)){this.camera.position.add(held.clone().sub(target));target.copy(held);moved=true;}
            // Indoors the visitor stays in the room: back wall, both side walls and the ceiling (2.14.1, "yan
            // duvarların da dışına çıkamasın"). The eye is drawn back along its own line of sight until it is inside
            // again, so the wheel and the orbit only lose distance — the picture never swings to some other wall.
            const eye=this.camera.position;
            const offset=eye.clone().sub(target);
            let share=1;
            const hold=(from,step,least,most)=>{
                if(step>1e-6&&from+step>most)share=Math.min(share,(most-from)/step);
                else if(step<-1e-6&&from+step<least)share=Math.min(share,(least-from)/step);
            };
            hold(target.x,offset.x,room.left,room.right);
            hold(target.y,offset.y,-Infinity,room.ceiling);
            hold(target.z,offset.z,room.back,room.front);
            if(share<1-1e-9){eye.copy(target).addScaledVector(offset,Math.max(.05,share));moved=true;}
        } else {
            const limit=this.cameraBackLimit();
            if(limit!==null&&this.camera.position.z<limit){
                const eye=this.camera.position,target=this.controls.target;
                const dx=eye.x-target.x,dy=eye.y-target.y,dz=eye.z-target.z,horizontal=Math.hypot(dx,dz),reach=limit-target.z;
                if(horizontal>1e-4&&Math.abs(reach)<=horizontal){
                    // Swinging around the aanbouw: keep the distance and the height, and stop the swing at the wall —
                    // the camera slides along the gevel line instead of diving toward the building.
                    const theta=Math.atan2(dx,dz),most=Math.acos(THREE.MathUtils.clamp(reach/horizontal,-1,1));
                    const turn=THREE.MathUtils.clamp(theta,-most,most);
                    eye.x=target.x+horizontal*Math.sin(turn);eye.z=target.z+horizontal*Math.cos(turn);
                } else if(dz<-1e-4){
                    // Aimed straight through the wall: stop the travel where the wall is, along the same line of
                    // sight, so only the distance changes.
                    const share=Math.max(0,Math.min(1,reach/dz));
                    eye.set(target.x+dx*share,target.y+dy*share,limit);
                } else eye.z=limit;
                moved=true;
            }
        }
        // The ground has the last word: pulling the eye back along its line of sight can send it downward, and it may
        // never end up under the floor it is looking at.
        if(this.camera.position.y<CAMERA_FLOOR.eye){this.camera.position.y=CAMERA_FLOOR.eye;moved=true;}
        if(moved)this.camera.lookAt(this.controls.target);
        return moved;
    }

    /** The views that stand in the room behind the doorbraak rather than in the garden. */
    insideView(){return ['interior','ceiling'].includes(this.view);}

    /**
     * The z the eye may not pass, or null when nothing limits it (free rondkijken, or no model yet). Outside that is
     * the front wall of the existing house; inside it is the back wall of the room behind the doorbraak.
     */
    cameraBackLimit(){
        const m=this.model;
        if(this.cameraLimit===false||!m?.bounds)return null; // unset (a bare instance) = limited, like gardenFence
        if(!this.insideView())return m.bounds.back+CAMERA_LIMIT.wall;
        return m.bounds.back-existingRoomDepth(houseLayout(this.environment,m).houseDepth)+CAMERA_LIMIT.room;
    }

    /**
     * The room the visitor may move in while looking from inside: the aanbouw plus the room behind the doorbraak,
     * kept CAMERA_LIMIT.room off every wall and off the ceiling. Null outside, or when free rondkijken is on.
     */
    cameraRoomBox(){
        const m=this.model;
        if(this.cameraLimit===false||!m?.bounds||!this.insideView())return null;
        // Sideways the eye keeps a hand's clearance off the finished wall; toward the pui it may come right up to the
        // glass, because the binnenweergave itself aims half a metre from it (fitCamera) and a stricter limit would
        // clamp the view the visitor was just given.
        const b=m.bounds,side=Math.max(.05,m.wall+CAMERA_LIMIT.room);
        return {left:b.left+side,right:b.right-side,back:this.cameraBackLimit(),
            front:b.front-m.wall-.05,ceiling:m.height-.2};
    }

    /** Vormgeving → Vrij rondkijken. Off (the default) keeps the visitor in front of the house; on lifts the limit. */
    setCameraLimit(on){
        const next=on!==false,changed=next!==this.cameraLimit;
        this.cameraLimit=next;
        // Lifting the limit needs the street elevations the scene was built without (makeExistingHouse); putting it
        // back does not need a rebuild — what is already drawn there simply stops being reachable.
        if(changed&&!next&&this.model&&this.renderer)this.update(this.config,{force:true});
        if(changed&&next&&this.clampCamera())this.render();
        return changed;
    }
    /**
     * Aim the camera at the aanbouw for the current view. `render:false` is for a caller that renders itself right
     * after (update()). A width change used to cost two shadow passes: buildScene's neighbour refit rendered one,
     * update() flagged the map again, and this fit rendered the second (scripts/probe-shadow-passes.mjs, 2.18.0).
     */
    fitCamera({render=true}={}) {
        if(!this.camera||!this.model)return;
        const m=this.model,aspect=this.camera.aspect||1;
        this.camera.fov=['interior','ceiling'].includes(this.view)?this.view==='ceiling'?95:68:40;
        this.camera.updateProjectionMatrix();this.camera.up.set(0,1,0);
        this.controls.minDistance=['interior','ceiling'].includes(this.view)?.15:3;
        this.controls.maxPolarAngle=['interior','ceiling'].includes(this.view)?Math.PI-.02:Math.PI/2-.015;
        if(this.view==='interior'){
            // Stand in the existing room, far enough back that the whole extension is in view at once — both walls
            // INCLUDING the two corners where they meet the house, the ceiling with its rooflight and the garden
            // doors. The customer's reference (2026-09-18): "kamera konumunu daha geriye al, duvarların kesişme noktası
            // bu şekilde görülmeli". The old rule capped the distance at 1,30 m and aimed at 90 % of the doorway, so on
            // anything wider than about 3,5 m both corners fell outside the frame. Now: the corners at 112 % of the
            // half-width (a clear margin inside the frame), limited only by the depth of the room behind the doorbraak.
            const doorway=m.width-2*m.wall,tanX=Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2)*Math.max(.6,aspect);
            const room=existingRoomDepth(houseLayout(this.environment,m).houseDepth);
            const behind=Math.min(Math.max(.45,room-.45),Math.max(.45,doorway/2/tanX*1.12));
            this.camera.position.set(0,1.5,m.bounds.back-behind);
            this.controls.target.set(0,1.3,m.bounds.front-.5);this.controls.update();if(render)this.render();return;
        }
        if(this.view==='ceiling'){
            this.camera.position.set(0,.28,-.08);this.camera.up.set(0,0,-1);
            this.controls.target.set(0,m.height,-.08);this.controls.update();if(render)this.render();return;
        }
        const vertical=THREE.MathUtils.degToRad(this.camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*aspect);
        const span=this.view==='front'?m.width+.8:Math.max(m.width+1.2,m.depth+1.6);
        const compact=this.container.clientHeight<400;
        // 2.10.7, the customer: "mevcut kadraj uzak kalıyor" — the opening frame was 1.08 × the fitted distance,
        // leaving the aanbouw small in a sea of garden. Now .92: the whole aanbouw still fits with a narrow margin (.84 was
        // measured to cut its far wall off at 1440 px), and the floor of 5.4 m keeps a small aanbouw from filling it all.
        // 2.16.0, the customer: "daha yakın çekim istiyor, komşu binalar, binanın çatısı vesaire gözükmesin". .82
        // against .92 brings the aanbouw forward until the woning's roof and the neighbours are out of frame; the
        // floor comes down with it, so a small aanbouw is not pushed away to fill a picture it cannot fill.
        let distance=Math.max(span/(2*Math.tan(Math.min(vertical,horizontal)/2))*(compact?.70:this.view==='front'?.82:.82),4.6);
        const target=new THREE.Vector3(0,m.height*.48,-.2);
        // "varsayılan konum soldan değil sağdan olsun": the opening standpoint looks in from the garden's right-hand
        // side; 'perspective-left' keeps the old one reachable, 'perspective-right' stays an alias for saved links.
        let direction=new THREE.Vector3(1,.55,1.5).normalize();
        if(this.view==='perspective-left')direction.set(-1,.55,1.5).normalize();
        if(this.view==='front')direction.set(0,.06,1).normalize();
        if(this.view==='top'){direction.set(0,1,.001);target.set(0,0,-.1);}
        if(this.view==='cutaway'){direction.set(.6,1.6,1.3).normalize();target.set(0,.85,0);}
        // Exterior cameras stay inside the garden, in front of the back fence; a wide building need not fit entirely.
        if(direction.z>.2)distance=Math.min(distance,(m.bounds.front+8.2-target.z)/direction.z);
        this.camera.position.copy(target).addScaledVector(direction,distance);
        this.camera.up.set(0,1,0);this.controls.target.copy(target);this.controls.maxDistance=Math.max(27,distance*2);this.controls.update();if(render)this.render();
    }

    /** Fixed export cameras use world coordinates: left is -x, right is +x, garden is +z. */
    setDocumentView(view) {
        if(!this.camera||!this.model||this.failed)return false;
        const directions={
            'perspective-left':[-1.1,.74,1.55],
            'perspective-right':[1.1,.74,1.55],
            interior:[.55,1.9,1.2],
        };
        if(!directions[view])throw new Error(`Unknown document view: ${view}`);
        this.cameraFocus=null;this.cameraTouched=false;this.mode='3d';this.applyMode();this.view=view;
        // A proposal image never carries the hover outline, even when the pointer happens to rest on the canvas.
        this.setHighlight(null);
        this.dimensionsVisible=false;this.roofVisible=view!=='interior';
        // A proposal image shows the aanbouw itself. Whether the omgeving is around it is the administrator's
        // choice (cs.prefab.appearance.document_surroundings, default off), and it is ONE switch — see
        // setSurroundingsVisible for what it covers and why it is not a list of flags here.
        this.documentMode=true;
        this.setKozijnOpen(false,{instant:true});
        this.setSurroundingsVisible(this.documentSurroundings===true);
        // What the aanbouw stands on and what stands behind it are named switches of their own (DOCUMENT_PARTS),
        // because one omgeving flag could not keep the slab and drop the apron, nor keep the terras and drop the
        // woning. They only bite while documentMode is on, which is why this runs after it is set.
        this.applyDocumentParts();
        this.dimensionGroup.visible=false;this.applyRoofVisibility();
        const m=this.model;
        // A proposal image is of the AANBOUW, so its framing may not depend on whatever camera state came before it.
        this.camera.fov=DOCUMENT_FOV;this.camera.updateProjectionMatrix();
        const direction=new THREE.Vector3(...directions[view]).normalize();
        // Orientation only: looking along a fixed direction gives the same rotation wherever the camera ends up,
        // so the camera basis below can be read before the aim point and the distance are known.
        this.camera.position.copy(direction);this.camera.up.set(0,1,0);this.camera.lookAt(0,0,0);this.camera.updateMatrixWorld(true);
        const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion);
        const up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion);
        const tanY=Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2),tanX=tanY*this.camera.aspect;
        // What is framed is the extension's own volume — daktrim, overstek and any lichtkoepel included — plus a
        // margin that scales with the extension, so a 150 cm unit is not given the breathing space of a 750 cm one.
        // Nothing else is ever framed. The old margin was 4,5 % on every side and reached 40 % of the depth behind
        // the back wall; with the omgeving gone (setSurroundingsVisible) there is nothing back there to keep in
        // shot, and every centimetre of margin is paper the aanbouw is not standing on. 2 % with a 6 cm floor keeps
        // the daktrim off the frame edge on the smallest unit in the catalogue and gives the largest one nothing it
        // has not earned; measured, it moves a 620 × 320 aanbouw from 57,2 % to 60,5 % of the image.
        const slabTop=m.height+m.roofThickness/2;
        const roofed=m.rooflight?.panelCount?Math.max(slabTop,m.rooflight.baseY+m.rooflight.rise):slabTop;
        // "Ruimtelijk overzicht zonder dak" has no dak in it, so it is not framed with one: the crown of that view is
        // the top of the walls. Framing to a roof that was hidden two lines above spent the top of the image on air —
        // worst on a 150 × 100 unit, where the 2,86 m height is most of the box and the footprint is 1,6 × 1,1 m.
        const crown=view==='interior'?m.height:roofed;
        const frontFace=m.bounds.front+(m.overhangDepth||0);
        const margin=extent=>Math.max(.06,extent*.02);
        const padX=margin(m.width),padY=margin(crown),padZ=margin(frontFace-m.bounds.back);
        // The bottom is the terrace the aanbouw stands on (-0,05), not an arbitrary margin below ground: a strip of
        // paving under the building is what makes it stand somewhere, a strip of empty ground is not. The back face
        // is the house wall — there is no back elevation to show — so it gets no margin at all.
        const box={left:-m.width/2-padX,right:m.width/2+padX,bottom:-.05,top:crown+padY,
            back:m.bounds.back,front:frontFace+padZ};
        // {right, up, direction} is orthonormal, so every corner reduces to three numbers in camera space and the
        // aim point is (tr, tu, u): `u` slides along the view axis (interchangeable with distance, so it is fixed at
        // the box centre) while `tr` and `tu` slide the frame sideways and vertically.
        const axis=[];
        for(const x of [box.left,box.right])for(const y of [box.bottom,box.top])for(const z of [box.back,box.front]){
            const point=new THREE.Vector3(x,y,z);
            axis.push({a:point.dot(right),b:point.dot(up),c:point.dot(direction)});
        }
        const centre=new THREE.Vector3((box.left+box.right)/2,(box.bottom+box.top)/2,(box.back+box.front)/2);
        const u=centre.dot(direction);
        let tr=centre.dot(right),tu=centre.dot(up);
        // Smallest distance at which every corner is inside the frustum for the current aim point.
        const fit=()=>{let d=3;for(const {a,b,c} of axis)d=Math.max(d,c-u+Math.abs(a-tr)/tanX,c-u+Math.abs(b-tu)/tanY);return d;};
        // Fitting and aiming are coupled — the corner that limits the frame moves as the aim moves — and the old code
        // only ever did the fitting half. Aiming at a fixed guess makes one corner touch one edge while the opposite
        // edge keeps its margin, which is why a fit that was honestly computed still filled a fifth of the picture.
        // Five passes settle the pair; `fit()` runs once more afterwards so containment is exact rather than nearly.
        let distance=fit();
        for(let pass=0;pass<5;pass++){
            let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,depths=0;
            for(const {a,b,c} of axis){
                const depth=distance+u-c;depths+=depth;
                minX=Math.min(minX,(a-tr)/(depth*tanX));maxX=Math.max(maxX,(a-tr)/(depth*tanX));
                minY=Math.min(minY,(b-tu)/(depth*tanY));maxY=Math.max(maxY,(b-tu)/(depth*tanY));
            }
            const depth=depths/axis.length;
            tr+=(minX+maxX)/2*depth*tanX;tu+=(minY+maxY)/2*depth*tanY;
            distance=fit();
        }
        const target=new THREE.Vector3().addScaledVector(right,tr).addScaledVector(up,tu).addScaledVector(direction,u);
        this.camera.position.copy(target).addScaledVector(direction,distance);
        this.camera.lookAt(target);this.camera.updateMatrixWorld(true);
        this.controls.target.copy(target);this.controls.maxDistance=Math.max(27,distance*2);
        this.controls.update();this.shadowsDirty=true;this.render();
        return true;
    }

    setMode(mode) {this.mode=mode==='2d'?'2d':'3d';this.applyMode();this.resize();}
    applyMode() {const flat=this.mode==='2d'||this.failed||!this.renderer;this.plan.style.display=flat?'block':'none';if(this.renderer)this.renderer.domElement.style.display=flat?'none':'block';if(this.controls)this.controls.enabled=!flat;if(flat&&this.highlight)this.setHighlight(null);}
    setView(view) {
        this.cameraFocus=null;this.cameraTouched=false;
        this.view=['perspective','perspective-left','perspective-right','front','top','interior','ceiling','cutaway'].includes(view)?view:'perspective';
        if(['interior','ceiling'].includes(this.view))this.roofVisible=true;
        this.shadowsDirty=true;this.applyRoofVisibility();this.fitCamera();
    }
    setScope(scope) {
        const value=Array.isArray(scope)?scope:[];
        if(JSON.stringify(value)===JSON.stringify(this.scope))return;
        const signature=rows=>[(this.model?.fixtures||[]).map(f=>fixtureAppearance(rows,f.key,this.examplesVisible)),underfloorAppearance(rows,this.examplesVisible)];
        const changed=JSON.stringify(signature(value))!==JSON.stringify(signature(this.scope));
        this.scope=structuredClone(value);if(this.model){this.model=buildGeometry(this.config,{fixtureLayout:this.placement,scope:this.scope});this.updatePlan();if(changed&&this.renderer&&!this.failed)this.buildFixtures();this.shadowsDirty=true;this.render();}
    }
    setPlacement(layout) {
        const value=layout&&typeof layout==='object'?layout:null;
        if(JSON.stringify(value)===JSON.stringify(this.placement))return;
        this.placement=structuredClone(value);
        if(this.model){this.model=buildGeometry(this.config,{fixtureLayout:this.placement,scope:this.scope});this.updatePlan();if(this.renderer&&!this.failed)this.buildFixtures();if(this.cameraFocus)this.refreshCameraFocus();this.shadowsDirty=true;this.render();}
    }
    setExamplesVisible(value) {
        this.examplesVisible=!!value;
        this.root?.traverse(object=>{if(object.userData.visualMode==='representative')object.visible=this.examplesVisible;});
        this.applyUnderfloorVisibility();this.updatePlan();this.shadowsDirty=true;this.render();
    }
    onSelect(callback){this.selectionHandler=callback;}
    /**
     * Which fields the form can open right now. Passing the list keeps the promise honest: only an object whose field
     * is actually on screen lights up and answers a click, so the customer never hits a dead spot. `null` lifts the
     * restriction (document capture, unit tests, any caller that does not know the form state).
     */
    setSelectableKeys(keys) {
        this.selectableKeys=Array.isArray(keys)?new Set(keys):null;
        if(this.hoverKey&&!this.canSelect(this.hoverKey))this.setHighlight(null);
    }
    canSelect(key){return !!key&&(!this.selectableKeys||this.selectableKeys.has(canonicalFixtureKey(key)));}
    /**
     * Nearest visible, pickable hit under the pointer, plus the object that carries its scopeKey. One raycast, shared
     * by the click and by the hover highlight, so both can never disagree about what is under the cursor.
     * `userData.noPick` on an object (or any ancestor) makes the ray pass through it: that is how a near-invisible
     * full-floor overlay stops swallowing the floor beneath it.
     */
    pickAt(clientX,clientY) {
        if(this.failed||this.mode!=='3d'||!this.root||!this.renderer)return null;
        const box=this.renderer.domElement.getBoundingClientRect();
        if(!box.width||!box.height)return null;
        this.raycaster.setFromCamera(new THREE.Vector2((clientX-box.left)/box.width*2-1,-(clientY-box.top)/box.height*2+1),this.camera);
        for(const hit of this.raycaster.intersectObject(this.root,true)){
            let node=hit.object,visible=true,pickable=true,key=null,carrier=null,leaf=null;
            while(node){
                if(!node.visible)visible=false;
                if(node.userData.noPick)pickable=false;
                if(!key&&node.userData.scopeKey){key=node.userData.scopeKey;carrier=node;}
                if(!leaf&&node.userData.kozijnLeaf)leaf=node;
                node=node.parent;
            }
            if(!visible||!pickable)continue;
            if(leaf&&!this.documentMode)return {key:key||'frontOpening',carrier:carrier||leaf,object:hit.object,leaf};
            return key&&this.canSelect(key)?{key,carrier,object:hit.object}:null;
        }
        return null;
    }
    selectAt(clientX,clientY){
        const pick=this.pickAt(clientX,clientY);
        if(!pick)return null;
        // 2.18.0, the owner: "kapıya tıklattığında açılsın, tıklattığında kapansın".
        if(pick.leaf){this.toggleKozijn();return 'kozijn';}
        this.selectionHandler?.(canonicalFixtureKey(pick.key));
        return pick.key;
    }
    /**
     * Hover feedback: the pointer cursor and a soft outline around the part under the cursor, so the customer learns
     * that the whole model answers to a click. Throttled to one raycast per HOVER_INTERVAL and skipped entirely while
     * the camera is being dragged — a raycast per pointermove event is a frame-rate storm on a phone.
     */
    queueHover(clientX,clientY) {
        if(this.disposed||this.pointerStart||this.documentMode)return;
        this.hoverPoint={x:clientX,y:clientY};
        if(this.hoverTimer)return;
        const wait=Math.max(0,HOVER_INTERVAL-(performance.now()-(this.hoverAt||0)));
        this.hoverTimer=setTimeout(()=>{this.hoverTimer=null;this.runHover();},wait);
    }
    runHover() {
        const point=this.hoverPoint;
        if(this.disposed||!point)return;
        this.hoverAt=performance.now();
        const started=performance.now();
        const pick=this.pickAt(point.x,point.y);
        const cost=performance.now()-started;
        this.hoverCost={last:+cost.toFixed(3),count:(this.hoverCost?.count||0)+1,
            total:+(((this.hoverCost?.total||0)+cost)).toFixed(3),max:Math.max(this.hoverCost?.max||0,+cost.toFixed(3))};
        this.setHighlight(pick);
    }
    /**
     * What the visitor is told about the part under the cursor (2.16.0, the customer: "objelerin üstüne geldiğimizde
     * çıkan sarımsı obje seçim belirteci olmasın"). The amber box that used to be drawn around it is gone: it sat in
     * front of the very material somebody was judging and turned a brick wall orange. The pointer cursor stays — that
     * is the affordance that says "this opens a choice" — and `hoverKey` still travels to the form, which highlights
     * the field instead. Nothing is drawn in the picture any more.
     */
    clearHighlight() {
        this.hoverCarrier=null;this.hoverKey=null;
        if(this.renderer?.domElement)this.renderer.domElement.style.cursor='';
    }
    setHighlight(pick) {
        const carrier=pick?.carrier||null,key=pick?.key||null;
        if(carrier===this.hoverCarrier&&key===this.hoverKey)return;
        this.hoverCarrier=carrier;this.hoverKey=key;
        if(this.renderer?.domElement)this.renderer.domElement.style.cursor=carrier?'pointer':'';
        this.render();
    }
    setDecorVisible(value){this.decorVisible=!!value;if(this.decorGroup)this.decorGroup.visible=this.decorVisible;this.shadowsDirty=true;this.render();}
    /**
     * The one switch between "an aanbouw in a Dutch back garden" and "the product on its own".
     *
     * OFF removes everything that is not being sold — the lawn and the ground it is on, the bestaande woning, the
     * buurhuizen, de tuinaankleding (schutting, plantenbakken, tuinset) and de voorbeeldinrichting — and puts the
     * studio of STUDIO in their place. What STAYS is the aanbouw and everything mounted on it: the terras it stands
     * on, de wandlampen, de stopcontacten, de buitenkraan, de spots, de radiator. That is the customer's own line:
     * "prefabrikte montaj yeri olan urunler kalabilir" — what is fixed to the product is part of the product.
     *
     * It is deliberately ONE group rather than five `.visible=false` lines in setDocumentView. Five lines are five
     * chances to forget the sixth thing: the version before this had exactly such a list, it did not mention the
     * lawn or the house, and the customer was looking at both in every proposal image while a comment three lines
     * above promised "no furniture, garden dressing or neighbouring houses".
     *
     * The visitor's own controls ("Tuinaankleding tonen", "Buren tonen", "Inrichting") keep their own flags on their
     * own groups and are neither read nor written here: three hides a child of a hidden parent either way, so
     * switching the omgeving back on restores exactly the picture the visitor had.
     */
    setSurroundingsVisible(value) {
        const visible=value!==false;
        const changed=this.surroundingsVisible!==visible;
        this.surroundingsVisible=visible;
        this.applySurroundings();
        if(changed){this.fitSunShadow();this.shadowsDirty=true;this.render();}
        return visible;
    }
    /**
     * What the NEXT proposal image does with the omgeving, per the administrator's setting. Stored rather than
     * applied, because a live preview keeps its garden while the visitor is still configuring; setDocumentView
     * reads it at the moment the picture is taken.
     */
    setDocumentSurroundings(value){this.documentSurroundings=value===true;return this.documentSurroundings;}
    /** Push the switch onto a scene (a rebuild makes new groups), including the backdrop that goes with it. Never renders. */
    applySurroundings() {
        const visible=this.surroundingsVisible!==false;
        if(this.surroundingsGroup)this.surroundingsGroup.visible=visible;
        if(this.studioGroup)this.studioGroup.visible=!visible;
        // The room behind the doorbraak went with the house; its first half metre takes over. See DOORBRAAK_REVEAL.
        this.applyDoorbraak();
        this.applyRoomFinish();
        this.applyBackdrop();
        return visible;
    }
    focusOption(key,{automatic=false}={}){
        if(!this.model||!this.camera||this.failed)return false;
        if(key==='underfloorHeating'){this.mode='3d';this.applyMode();if(this.view!=='interior')this.setView('interior');this.playUnderfloorAnimation();return true;}
        // An overstek is a band round the whole roof edge: it is judged from the standing view on the right, the one
        // "geen overstek" leaves in place (2.17.0, the owner: "overstek tıklamalarında önizleme 45 izometrik sağdan
        // olsun"). It used to swing the camera up over the LEFT corner, so comparing the four choices meant watching
        // the picture jump between two standpoints.
        if(key==='overhang'){this.mode='3d';this.applyMode();this.setView('perspective');return true;}
        if(['rooflight','roofShade'].includes(key)){
            const m=this.model,points=m.rooflight.panels.flatMap(panel=>panel.points);
            if(!points.length){this.mode='3d';this.applyMode();this.setView('perspective');return true;}
            this.applyCameraFrame(fixtureCameraFrame(points.map(position=>({kind:'roof-detail',position,room:'outside'})),m,this.camera.aspect,automatic));
            this.cameraFocus={kind:'structure',key,automatic};this.cameraTouched=false;return true;
        }
        const aliases={ceilingPositions:'ceilingLights',spotPositions:'spotlights',socketPositions:'sockets'};
        const fixtures=this.model.fixtures.filter(item=>item.key===(aliases[key]||key)||item.id===key);
        if(!fixtures.length){if(['facade','painting','plaster'].includes(key))return this.focusMaterial(key,{automatic});this.mode='3d';this.applyMode();this.setView(['ceilingPositions','ceilingLights','spotPositions','spotlights'].includes(key)?'ceiling':'front');return true;}
        // A CHOICE of outside light, socket or tap shows the whole front, the same picture for left, right and both;
        // the explicit "3D bekijken" still walks up to the fitting itself. When an oversized wall-edge clearance has
        // moved the services to a side wall the front would not show them, so those are followed round as before.
        // The frame is fitted to the front itself with no padding beyond the subjects' own extent: "mümkün olduğu
        // kadar prefabrik kısma odaklansın, dış kısımları çok fazla göstermeye gerek yok".
        if(automatic&&FRONT_FITTINGS.includes(key)&&fixtures.every(fixture=>(fixture.surface||'front')==='front')){
            this.applyCameraFrame(fixtureCameraFrame(frontFacadeSubjects(this.model),this.model,this.camera.aspect,true,{padding:0}));
            this.cameraFocus={kind:'structure',key,automatic};this.cameraTouched=false;return true;
        }
        this.applyCameraFrame(fixtureCameraFrame(fixtures,this.model,this.camera.aspect,automatic));
        this.cameraFocus={kind:'option',key,automatic,fixtureIds:fixtures.map(f=>f.id)};this.cameraTouched=false;return true;
    }
    focusMaterial(key='facade',{automatic=false}={}){
        if(!this.model||!this.camera||this.failed)return false;
        if(automatic){this.mode='3d';this.applyMode();this.setView(['plaster','painting'].includes(key)?'interior':'perspective');return true;}
        const m=this.model,inside=['plaster','painting'].includes(key);
        const fixture={kind:'material',position:[inside?m.bounds.left+m.wall:m.bounds.left,Math.min(1.4,m.height*.5),0],rotation:inside?Math.PI/2:-Math.PI/2,room:inside?'interior':'outside'};
        this.applyCameraFrame(fixtureCameraFrame([fixture],m,this.camera.aspect));
        this.cameraFocus={kind:'material',key,automatic};this.cameraTouched=false;return true;
    }
    applyCameraFrame({target,position,fov,view}){
        this.mode='3d';this.view=view;this.roofVisible=true;this.applyMode();this.applyRoofVisibility();
        this.camera.fov=fov;this.camera.up.set(0,1,0);this.camera.updateProjectionMatrix();
        this.controls.minDistance=.65;this.controls.maxDistance=Math.max(27,position.distanceTo(target)*2);this.controls.maxPolarAngle=Math.PI-.02;
        this.camera.position.copy(position);this.controls.target.copy(target);this.controls.update();this.render();
    }
    refreshCameraFocus(){
        const focus=this.cameraFocus;
        if(!focus||this.mode!=='3d')return;
        if(focus.kind==='material'){this.focusMaterial(focus.key,{automatic:focus.automatic});return;}
        if(focus.kind==='structure'){this.focusOption(focus.key,{automatic:focus.automatic});return;}
        // Adding another multi-select item must not restart or expand an earlier detail view.
        const fixtures=this.model.fixtures.filter(f=>focus.fixtureIds.includes(f.id));
        if(!fixtures.length){this.cameraFocus=null;return;}
        this.applyCameraFrame(fixtureCameraFrame(fixtures,this.model,this.camera.aspect,focus.automatic));
    }
    applyRoofVisibility() {
        const visible=this.roofVisible&&!['cutaway','top'].includes(this.view);
        if(this.roofGroup)this.roofGroup.visible=visible;
        if(this.ceilingGroup)this.ceilingGroup.visible=visible;
        // The soffit over the doorbraak is plafond too, so it goes and comes with the rest of it.
        this.applyDoorbraak();
        this.applyScenery();
        this.applyViewLighting();
        this.applyUnderfloorVisibility();
        this.shadowsDirty=true;
    }
    /**
     * Whether the example furniture is drawn (2.14.1, the customer: "iç görünümde iken odanın ortasındaki mobilyalar
     * gözükmesin"). Two rules, both invariants of every frame:
     *
     * - The ceiling camera stands on the floor, so furniture would block the very fittings it inspects.
     * - Looking from INSIDE, the room is what is being sold: a bank in the middle of it is somebody else's taste
     *   standing in the way of the walls, the vloer and the pui. Vormgeving → "Meubels in de binnenweergave" puts it
     *   back for a website that would rather show a furnished room. From the garden the furniture stays, because
     *   there it reads as a lived-in room behind the glass rather than as something being delivered.
     */
    applyScenery(){
        if(this.sceneryGroup)this.sceneryGroup.visible=this.view!=='ceiling'&&(this.interiorFurniture===true||!this.insideView());
    }

    /** Vormgeving → Meubels in de binnenweergave. */
    setInteriorFurniture(on){
        const next=on===true,changed=next!==this.interiorFurniture;
        this.interiorFurniture=next;
        if(changed){this.applyScenery();this.shadowsDirty=true;this.render();}
        return changed;
    }

    applyUnderfloorVisibility() {
        if(!this.floorHeatingGroup)return;
        // Inside the room the loops appear only while they are being laid (animation); open-roof views keep them.
        const viewShowsFloor=this.view!=='ceiling'&&(['cutaway','top'].includes(this.view)||!this.roofVisible||!!this.underfloorAnimation);
        const visible=!!this.model?.underfloorLoops?.length&&underfloorAppearance(this.scope,this.examplesVisible).visible&&viewShowsFloor;
        if(this.floorHeatingGroup.visible!==visible)this.shadowsDirty=true;
        this.floorHeatingGroup.visible=visible;
    }
    setDimensions(value) {this.dimensionsVisible=!!value;if(this.dimensionGroup)this.dimensionGroup.visible=!!value;this.updatePlan();this.render();}
    setRoofVisible(value) {this.roofVisible=!!value;this.applyRoofVisibility();this.render();}
    resetCamera() {this.setView('perspective');}
    resize() {
        if(this.disposed||!this.renderer||!this.camera)return;
        const width=Math.max(1,this.container.clientWidth),height=Math.max(1,this.container.clientHeight);
        const changed=this.lastWidth!==width||this.lastHeight!==height;
        this.lastWidth=width;this.lastHeight=height;
        if(changed){
            // A container crossing 600 px flips the tier: new pixel ratio, new shadow map, rebuilt composer.
            this.applyTier(this.measureTier(width));
            this.renderer.setSize(width,height,false);
            // After the renderer: the composer takes its size from the fresh drawing buffer (see sizeComposer).
            this.ensureComposer();
        }
        this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
        // Layout changes (mobile browser chrome, validation text, expanded controls) do not own the camera.
        if(changed&&this.model&&!this.cameraInitialized){this.cameraInitialized=true;this.fitCamera();}
        else if(changed&&this.cameraFocus)this.refreshCameraFocus();
        else this.render();
    }
    render() {
        if(this.renderFrame){cancelAnimationFrame(this.renderFrame);this.renderFrame=null;}
        if(!this.disposed&&!this.failed&&this.mode==='3d'&&this.renderer&&this.scene&&this.camera){
            this.applyScenery(); // invariant on every frame: see there
            // Orbiting does not move a single shadow caster, so the (expensive) shadow map is redrawn only
            // after a structural, light, sun or visibility change flagged shadowsDirty. three clears needsUpdate itself.
            this.updateFenceOcclusion(); // may flag shadowsDirty, so it runs before the shadow check
            if(this.shadowsDirty){this.renderer.shadowMap.needsUpdate=true;this.shadowsDirty=false;this.shadowPasses=(this.shadowPasses||0)+1;}
            const start=performance.now();
            if(this.composer){
                try{this.composer.render();}
                catch(error){console.warn('Post-processing failed; using direct rendering',error);this.disposeComposer();this.composerUnavailable=true;this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);}
            } else this.renderer.render(this.scene,this.camera);
            this.renderTimes.push(performance.now()-start);if(this.renderTimes.length>60)this.renderTimes.shift();
        }
    }
    fallback(error) {this.failed=true;this.applyMode();this.onError?.(error);}
    /**
     * What the pipeline actually did, for the verification scripts and the browser console. `composer` is null on the
     * compact tier and whenever the HalfFloat MSAA probe failed; its size must equal the drawing-buffer size.
     * `lamps.used` counts lamp lights that reach the image — the fixed-slot rig arrives with the lighting stage.
     */
    renderingInfo() {
        const lamps=this.lampLights?.children.filter(object=>object.isLight)||[];
        const composer=this.composer?{width:this.composer.renderTarget1.width,height:this.composer.renderTarget1.height}:null;
        return {tier:this.quality||'compact',pixelRatio:this.renderer?.getPixelRatio()??null,maxSamples:this.renderer?.capabilities.maxSamples??null,
            composer,ambientOcclusion:!!this.composer,shadowPasses:this.shadowPasses||0,
            exposure:this.renderer?.toneMappingExposure??null,toneMapping:TONE_MAPPING_NAMES[this.renderer?.toneMapping]||'none',
            backdrop:this.backdrop||'sky',lamps:{slots:lamps.length,used:lamps.filter(light=>light.intensity>0).length},
            sunShadow:this.sun?{mapSize:this.sun.shadow.mapSize.x,texel:this.shadowTexel??null}:null,
            environmentIntensity:this.scene?.environmentIntensity??null};
    }
    getSceneInfo() {
        const floor=underfloorAppearance(this.scope,this.examplesVisible),flat=this.failed||this.mode==='2d'||!this.renderer;
        const floorHeatingState={visible:flat?!!this.model?.underfloorLoops?.length&&floor.visible:!!this.floorHeatingGroup?.visible,mode:floor.mode,loopCount:this.model?.underfloorLoops?.length||0};
        return {...structuredClone(this.model),mode:this.failed?'2d':this.mode,view:this.view,webglAvailable:!!this.renderer&&!this.failed,
            rendering:this.renderingInfo(),
            floorFinish:this.floorFinish||'laminate',scenario:this.scenario||'none',gardenSetLoaded:!!this.gardenSetLoaded,underfloorAnimating:!!this.underfloorAnimation,roofVisible:this.roofVisible,dimensionsVisible:this.dimensionsVisible,examplesVisible:this.examplesVisible,decorVisible:this.decorVisible,illustrative:this.illustrativeState(),surroundings:this.surroundingsState(),environment:{...this.environment},assetRevision:this.assetRevision,buildCounts:{...this.buildCounts},scope:structuredClone(this.scope),floorHeatingState,
            selection:{hoverKey:this.hoverKey||null,highlighted:!!this.highlight?.visible,intervalMs:HOVER_INTERVAL,
                selectableKeys:this.selectableKeys?[...this.selectableKeys].sort():null,
                hoverCost:this.hoverCost?{...this.hoverCost,meanMs:+(this.hoverCost.total/this.hoverCost.count).toFixed(3)}:null},
            fixtureStates:(this.model?.fixtures||[]).map(f=>({id:f.id,key:f.key,...fixtureAppearance(this.scope,f.key,this.examplesVisible)})),rendererInfo:this.renderer?{geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,lightEffectCount:flat?0:visibleLightEffectCount(this.root),pixelRatio:this.renderer.getPixelRatio(),quality:this.quality,meanRenderCpuMs:this.renderTimes.length?this.renderTimes.reduce((a,b)=>a+b,0)/this.renderTimes.length:0}:null};
    }
    destroy() {
        if(this.disposed)return;this.stopKozijnMotion();this.dprQuery?.removeEventListener?.('change',this._dprChange);this.dprQuery=null;this.disposeComposer();this.disposed=true;if(this.renderFrame)cancelAnimationFrame(this.renderFrame);this.resizeObserver?.disconnect();this.controls?.removeEventListener('change',this._render);this.controls?.removeEventListener('change',this._clampToGround);this.controls?.removeEventListener('start',this._controlStart);this.controls?.dispose();
        this.release(this.root);this.lampLights?.removeFromParent();this.materials.forEach(material=>material.dispose());this.textures.forEach(texture=>texture.dispose());
        this.scene?.traverse(object=>object.shadow?.dispose());this.lampLights?.traverse(object=>object.shadow?.dispose());
        this.environmentTarget?.dispose();
        this.plan.removeEventListener('click',this._planSelect);this.plan.removeEventListener('keydown',this._planSelect);
        if(this.hoverTimer){clearTimeout(this.hoverTimer);this.hoverTimer=null;}
        if(this.highlight){this.release(this.highlight);this.highlight=null;}
        if(this.renderer){this.renderer.domElement.removeEventListener('pointerdown',this._pointerDown);this.renderer.domElement.removeEventListener('pointerup',this._pointerUp);this.renderer.domElement.removeEventListener('pointermove',this._pointerMove);this.renderer.domElement.removeEventListener('pointerleave',this._pointerLeave);this.renderer.domElement.removeEventListener('dblclick',this._doubleClick);this.renderer.domElement.removeEventListener('webglcontextlost',this._contextLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this._contextRestored);this.renderer.dispose();this.renderer.forceContextLoss();}
        this.host.remove();
    }
}

/**
 * 2.13.0, the customer's roof and base report: a hole in the roof where the water goes into the pipe; the downpipe's
 * bends rounded; the daktrim standing proud of the roof on its inner side; its corners closed; a membrane, not a
 * concrete-looking roof; no white lines at the foot of the walls, down the house corner or across the roofs; the
 * planters off the prefab. The pure route maths is tested directly, the rest on a REAL built scene (no renderer).
 * What it looks like is in docs/verification/roof/ (scripts/render-roof.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import {buildGeometry, elevationSvg, DAKTRIM_FACE, HOPPER} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {normalizeEnvironment} from '../../addons/cs_prefab_configurator/static/src/environment.js';
import {DOCUMENT_PARTS} from '../../addons/cs_prefab_configurator/static/src/scene_content.js';
import {ROOF_RECESS, TRIM_REACH, DOWNPIPE, downpipeRoute, roundedRoute, roofOutlet} from '../../addons/cs_prefab_configurator/static/src/architectural_details.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

/** Same harness as document_views.test.mjs: a Preview with a real built scene, but no WebGL. */
function sceneHarness(config, environment = {}) {
  const preview = Object.create(Preview.prototype);
  const camera = new THREE.PerspectiveCamera(40, 1.5, .035, 150);
  Object.assign(preview, {config: structuredClone(config), model: buildGeometry(config), scope: [], placement: null,
    mode: '3d', view: 'perspective', camera, cameraFocus: null, cameraTouched: false, dimensionsVisible: false, roofVisible: true,
    examplesVisible: true, decorVisible: true, illustrativeOff: {}, surroundingsVisible: true, documentSurroundings: false,
    documentParts: {...DOCUMENT_PARTS}, partGroups: {}, documentMode: false,
    materials: new Map(), textures: new Set(), maps: {}, buildCounts: {structure: 0, material: 0, fixtures: 0},
    environment: normalizeEnvironment(environment), scenario: 'none', floorFinish: 'laminate',
    scene: new THREE.Scene(), renderer: {shadowMap: {}}, plan: {style: {}}, host: {style: {}},
    container: {clientWidth: 1440, clientHeight: 960},
    controls: {target: new THREE.Vector3(), maxDistance: 27, update() { camera.updateMatrixWorld(true); }},
    updatePlan() {}, render() {}, applyMode() {}, setHighlight() {}, buildFixtures() {}, updateFacade() {}});
  preview.scene.fog = new THREE.Fog('#e7e9e5', 27, 60);
  preview.scene.add(preview.camera);
  preview.facade = code => preview.material(`facade:${code}`, {color: '#ffffff'});
  preview.makeDimensions = () => {};
  preview.buildScene();
  preview.root.updateMatrixWorld(true);
  return preview;
}
const meshes = (root, filter) => { const found = []; root.traverse(o => { if (o.isMesh && filter(o)) found.push(o); }); return found; };
const boxOf = list => { const box = new THREE.Box3(); for (const mesh of list) box.expandByObject(mesh); return box; };
const direction = (a, b) => { const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...v); return v.map(x => x / l); };
const parallel = (u, v) => Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2] - 1) < 1e-9;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the downpipe is one plumb line, from the hopper under the daktrim (or the overstek soffit) into the ground', () => {
  // 2.16.0, the customer: "HWA buizen komen in de grond". 2.17.0, the owner: the pipe does not turn into the wall under
  // the roof edge; it hangs from a hopper (vergaarbak) directly under the daktrim — so there is no bend at all.
  for (const overhang of ['none', 'pvc-white']) for (const drainSide of ['left', 'right', 'both']) {
    const m = buildGeometry({width: 500, depth: 300, overhang, drainSide});
    for (const drain of m.drains) {
      const parts = roundedRoute(downpipeRoute(drain, m.bounds.front, m.overhangDepth), DOWNPIPE.bend);
      const tag = `${overhang}/${drain.side}`;
      assert.equal(parts.length, 1, `${tag}: one straight run, no bend`);
      const [dx, dy, dz] = direction(parts[0].from, parts[0].to);
      assert.ok(near(dx, 0) && near(dz, 0) && near(dy, -1), `${tag}: straight down, got ${[dx, dy, dz]}`);
      assert.ok(parts[0].to[1] < -.15, `${tag}: it ends in the ground, under the paving (${parts[0].to[1]})`);
      if (m.overhangDepth) assert.ok(near(parts[0].from[1], drain.height + .02), `${tag}: up into the soffit`);
      else assert.ok(near(parts[0].from[1], drain.hopper.bottom), `${tag}: it starts at the hopper's outlet (${parts[0].from[1]} vs ${drain.hopper.bottom})`);
    }
  }
});

test('without an overstek the hopper hangs directly under the daktrim, in front of the pipe it feeds', () => {
  for (const roofEdge of ['anthracite', 'aluminium', 'zinc']) for (const drainSide of ['left', 'right', 'both']) {
    const m = buildGeometry({width: 500, depth: 300, overhang: 'none', drainSide, roofEdge}), slabTop = m.height + m.roofThickness / 2, tag = `${roofEdge}/${drainSide}`;
    for (const drain of m.drains) {
      const h = drain.hopper, trimBottom = slabTop + DAKTRIM_FACE[roofEdge].bottom;
      assert.ok(h, `${tag}: a hopper`);
      assert.ok(h.top < trimBottom && trimBottom - h.top <= .01, `${tag}: its rim is just under the trim (${(trimBottom - h.top).toFixed(3)} m)`);
      assert.ok(near(h.top - h.bottom, HOPPER.height), `${tag}: ${HOPPER.height} m tall`);
      assert.ok(near(drain.height, h.bottom), `${tag}: the pipe begins where the hopper ends`);
      // Wider and deeper than the pipe, its back on the facade, the pipe's axis inside its footprint.
      assert.ok(HOPPER.top[0] > 1.4 * 2 * DOWNPIPE.radius && HOPPER.top[1] >= HOPPER.top[0], `${tag}: wider than the pipe, at least as deep as wide`);
      assert.ok(drain.z > m.bounds.front && drain.z + DOWNPIPE.radius < m.bounds.front + HOPPER.bottom[1], `${tag}: the pipe's axis lies under the hopper's floor`);
    }
  }
  assert.equal(buildGeometry({overhang: 'pvc-white'}).drain.hopper, null, 'with an overstek the pipe goes up into the soffit instead');
});

test('the roof outlet of an overstek sits over its pipe with the whole flange on the membrane, clear of the kantplank', () => {
  for (const overhang of ['pvc-white', 'pvc-anthracite']) for (const drainSide of ['left', 'right', 'both']) {
    const m = buildGeometry({width: 500, depth: 300, overhang, drainSide});
    const edgeFront = m.bounds.front + m.overhangDepth, edgeSide = m.width / 2 + (m.overhangDepth ? .006 : 0);
    for (const drain of m.drains) {
      const o = roofOutlet(drain, edgeFront, edgeSide);
      assert.ok(o.z + o.flange <= edgeFront - TRIM_REACH - .005, `${overhang}/${drain.side}: flange clear of the front kantplank`);
      assert.ok(Math.abs(o.x) + o.flange <= edgeSide - TRIM_REACH - .005, `${overhang}/${drain.side}: flange clear of the side kantplank`);
      assert.equal(Math.sign(o.x), Math.sign(drain.x), 'on the side of its own pipe');
      assert.ok(Math.hypot(o.x - drain.x, o.z - drain.z) < .3, 'within a hand of the pipe it feeds');
    }
  }
});

test('in the scene, without an overstek: no hole in the roof, the water leaves through the edge into a hopper', () => {
  // 2.17.0, the owner, with photographs: "üstten bakıldığında tavanda bir delik değil de iç kısımdan dışa taşan
  // daktrimden boruya bağlantı var". The roof outlet on the membrane goes; a rectangular zijuitloop runs from the inner
  // face of the roof edge, under the uninterrupted daktrim, out through the facade into the back of the hopper.
  for (const roofEdge of ['anthracite', 'zinc']) for (const drainSide of ['right', 'both']) {
    const p = sceneHarness({width: 500, depth: 300, drainSide, overhang: 'none', roofEdge}), m = p.model, b = m.bounds, tag = `${roofEdge}/${drainSide}`;
    const slabTop = m.height + m.roofThickness / 2, trimBottom = slabTop + DAKTRIM_FACE[roofEdge].bottom;
    assert.equal(meshes(p.scene, o => o.name === 'roof-outlet').length, 0, `${tag}: no hole in the roof`);
    assert.equal(meshes(p.root, o => o.name === 'downpipe').length, 0, `${tag}: no elbow into the wall`);
    for (const drain of m.drains) {
      const mine = o => Math.abs(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).x - drain.x) < .2;
      const hopper = boxOf(meshes(p.root, o => o.name === 'downpipe-hopper' && mine(o)));
      assert.ok(!hopper.isEmpty(), `${tag}/${drain.side}: a hopper`);
      assert.ok(hopper.max.y <= trimBottom + 1e-6 && trimBottom - hopper.max.y <= .012, `${tag}/${drain.side}: just under the trim (${(trimBottom - hopper.max.y).toFixed(3)})`);
      assert.ok(Math.abs(hopper.min.z - b.front) < .006, `${tag}/${drain.side}: its back on the facade (${(hopper.min.z - b.front).toFixed(3)})`);
      assert.ok(hopper.min.x < drain.x - DOWNPIPE.radius && hopper.max.x > drain.x + DOWNPIPE.radius, `${tag}/${drain.side}: over its pipe`);
      // Open at the top: the dark inside is seen from above, under the rim.
      const inside = boxOf(meshes(p.root, o => o.name === 'downpipe-hopper-inside' && mine(o)));
      assert.ok(!inside.isEmpty() && inside.max.y < hopper.max.y && inside.max.y > hopper.max.y - .02, `${tag}/${drain.side}: open, its inside just under the rim`);
      // The zijuitloop: from inside the facade to within the hopper, below the trim, short of the pipe's axis.
      const spout = boxOf(meshes(p.root, o => o.name === 'downpipe-spout' && mine(o)));
      assert.ok(!spout.isEmpty(), `${tag}/${drain.side}: a zijuitloop`);
      assert.ok(spout.min.z < b.front && spout.max.z > b.front + .03 && spout.max.z < drain.z, `${tag}/${drain.side}: through the facade into the hopper, short of the pipe (${spout.min.z - b.front}, ${spout.max.z - b.front})`);
      assert.ok(spout.max.y < trimBottom && spout.min.y > hopper.min.y, `${tag}/${drain.side}: under the trim, inside the hopper's height`);
      // ...and from the roof: a rectangular opening in the inner face of the roof edge, at the membrane.
      const scupper = boxOf(meshes(p.roofGroup, o => o.name === 'roof-scupper' && mine(o)));
      assert.ok(!scupper.isEmpty(), `${tag}/${drain.side}: the opening in the roof edge`);
      assert.ok(near(scupper.min.y, slabTop - ROOF_RECESS, .006), `${tag}/${drain.side}: at the membrane (${scupper.min.y} vs ${slabTop - ROOF_RECESS})`);
      assert.ok(scupper.max.z <= b.front - TRIM_REACH + .01 && scupper.max.z > b.front - TRIM_REACH - .03, `${tag}/${drain.side}: in the inner face of the kantplank`);
      // The pipe hangs from the hopper's outlet.
      const pipe = boxOf(meshes(p.root, o => o.name === 'downpipe-uitloop' && mine(o)));
      assert.ok(near(pipe.max.y, drain.hopper.bottom, .02), `${tag}/${drain.side}: the pipe starts at the hopper (${pipe.max.y} vs ${drain.hopper.bottom})`);
    }
    for (const part of meshes(p.scene, o => /^(downpipe|roof-scupper)/.test(o.name))) assert.equal(part.userData.scopeKey, 'drainMaterial', `${tag}: ${part.name} answers to Regenbuis`);
    // The trim runs on, unbroken, over the hopper: its front run is still ONE piece per layer.
    const frontRuns = meshes(p.roofGroup, o => o.userData.scopeKey === 'roofEdge' && o.geometry.type === 'BoxGeometry' && !/upstand/.test(o.name) && o.geometry.parameters.width > m.width);
    assert.ok(frontRuns.length >= 2, `${tag}: the front run of the daktrim is uninterrupted`);
  }
});

test('the print elevation draws the hopper and the pipe into the ground, like the 3D', () => {
  const plain = elevationSvg(buildGeometry({width: 500, depth: 300, overhang: 'none', drainSide: 'both'}), 'front');
  assert.equal((plain.match(/data-drain-hopper=/g) || []).length, 2, 'one hopper per pipe');
  assert.doesNotMatch(plain, /data-drain-side="[^"]+" d="[^"]*l10 8/, 'no 45° shoe at the foot any more');
  const extended = elevationSvg(buildGeometry({width: 500, depth: 300, overhang: 'pvc-white'}), 'front');
  assert.doesNotMatch(extended, /data-drain-hopper=/, 'with an overstek the pipe goes into the soffit');
});

test('in the scene, with an overstek: a straight pipe into the soffit and an outlet over it', () => {
  for (const drainSide of ['right', 'both']) {
    const p = sceneHarness({width: 500, depth: 300, drainSide, overhang: 'pvc-white'}), m = p.model, tag = drainSide;
    const drains = m.drains.length, slabTop = m.height + m.roofThickness / 2;
    const tubes = meshes(p.root, o => /^downpipe/.test(o.name) && o.geometry.type === 'TubeGeometry');
    assert.equal(tubes.length, 0, `${tag}: no bend`);
    assert.equal(meshes(p.root, o => o.name === 'downpipe-uitloop').length, drains, `${tag}: one open pipe per drain`);
    assert.equal(meshes(p.root, o => o.name === 'downpipe-hopper').length, 0, `${tag}: no hopper under a soffit`);
    const outlets = meshes(p.roofGroup, o => o.name === 'roof-outlet');
    assert.equal(outlets.length, 3 * drains, `${tag}: flange, ring and bore per outlet`);
    assert.ok(outlets.every(o => o.userData.scopeKey === 'drainMaterial'), `${tag}: the outlet answers like the pipe`);
    // The membrane: every roof slab box, top face ROOF_RECESS under the slab top; the trim stands at least that far above it.
    const membrane = p.materials.get('surface:roof-membrane');
    const roof = meshes(p.roofGroup, o => o.material === membrane && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.height > .1 && !/upstand/.test(o.name)); // the slab, not the kantplank cladding or the opstand
    assert.ok(roof.length >= 1, `${tag}: the roof is drawn in the membrane`);
    assert.ok(near(boxOf(roof).max.y, slabTop - ROOF_RECESS), `${tag}: membrane at ${boxOf(roof).max.y}`);
    const trim = boxOf(meshes(p.roofGroup, o => o.userData.scopeKey === 'roofEdge'));
    assert.ok(trim.max.y - (slabTop - ROOF_RECESS) >= ROOF_RECESS, `${tag}: the daktrim stands ${trim.max.y - (slabTop - ROOF_RECESS)} m above the membrane`);
    for (const outlet of outlets) assert.ok(new THREE.Box3().setFromObject(outlet).min.y >= slabTop - ROOF_RECESS - 1e-6, `${tag}: the outlet lies on the membrane`);
    // "Eskitme bir şey koyma": one even sheet, no scanned stains.
    assert.ok(!membrane.map && !membrane.roughnessMap, 'no scan on the membrane');
  }
});

test('the daktrim corners are closed: the front run meets the side runs exactly, never short and never doubled', () => {
  for (const roofEdge of ['anthracite', 'white']) for (const overhang of ['none', 'pvc-white']) {
    const p = sceneHarness({width: 500, depth: 300, roofEdge, overhang}), m = p.model, tag = `${roofEdge}/${overhang}`;
    // The runs that go round the roof edge; the opstand trim against the house is a single straight piece.
    const edge = meshes(p.roofGroup, o => o.userData.scopeKey === 'roofEdge' && o.geometry.type === 'BoxGeometry' && !/upstand/.test(o.name));
    const layers = new Map();
    for (const mesh of edge) { const key = mesh.geometry.parameters.height.toFixed(4); layers.set(key, [...(layers.get(key) || []), new THREE.Box3().setFromObject(mesh)]); }
    assert.ok(layers.size >= 2, `${tag}: a leg and a profile`);
    for (const [height, boxes] of layers) {
      const front = boxes.reduce((a, b) => (b.max.x - b.min.x > a.max.x - a.min.x ? b : a));
      const right = boxes.find(b => b !== front && b.min.x > 0);
      assert.ok(right, `${tag} ${height}: a right-hand run`);
      assert.ok(near(front.max.x, right.max.x), `${tag} ${height}: the front run ends flush with the side (${front.max.x} vs ${right.max.x})`);
      assert.ok(near(right.max.z, front.min.z), `${tag} ${height}: the side run meets the front run (${right.max.z} vs ${front.min.z})`);
    }
  }
  const zinc = sceneHarness({width: 500, depth: 300, roofEdge: 'zinc'});
  assert.equal(meshes(zinc.roofGroup, o => o.userData.scopeKey === 'roofEdge' && o.geometry.type === 'SphereGeometry').length, 2, 'the zinc roll turns both corners');
});

test('the membrane is dressed up the house wall and closed with a trim', () => {
  // 2.14.1, the customer's photo: "mebran yalıtımı evin duvarına da biraz yapıştırılıyor". The opstand starts on the
  // finished roof and stands well above it, and the wall profile sits on top of it, both against the gevel.
  for (const overhang of ['none', 'pvc-white']) {
    const p = sceneHarness({width: 500, depth: 300, overhang}), m = p.model;
    const surface = m.height + m.roofThickness / 2 - ROOF_RECESS;
    const [upstand] = meshes(p.roofGroup, o => o.name === 'roof-upstand');
    const [trim] = meshes(p.roofGroup, o => o.name === 'roof-upstand-trim');
    assert.ok(upstand && trim, `${overhang}: an opstand and its wall profile`);
    assert.equal(upstand.material, p.materials.get('surface:roof-membrane'), 'in the roof membrane, one sheet dressed up');
    const box = new THREE.Box3().setFromObject(upstand), cap = new THREE.Box3().setFromObject(trim);
    assert.ok(near(box.min.y, surface), `${overhang}: it starts on the finished roof (${box.min.y})`);
    assert.ok(box.max.y - box.min.y >= .15, `${overhang}: a real opstand, not a line (${(box.max.y - box.min.y).toFixed(3)})`);
    assert.ok(box.min.z >= m.bounds.back - 1e-9 && box.max.z <= m.bounds.back + .05, `${overhang}: against the house wall`);
    assert.ok(cap.min.y >= box.max.y - .02 && cap.min.y <= box.max.y + .01, `${overhang}: the profile closes the top of it`);
    assert.ok(box.min.x > m.bounds.left - .01 && box.max.x < m.bounds.right + .01, `${overhang}: it stays on the aanbouw`);
  }
});

test('the foot of the walls: no light slab edge, the facade down to the paving, the planters off the prefab', () => {
  for (const facade of ['brick-red', 'wood-vertical']) {
    const p = sceneHarness({width: 500, depth: 300, facade}), m = p.model, b = m.bounds;
    const slab = meshes(p.root, o => o.material === p.materials.get('slab-edge'));
    assert.equal(slab.length, 1, 'one structural slab');
    const s = boxOf(slab);
    assert.ok(s.max.x <= b.right - .005 && s.min.x >= b.left + .005 && s.max.z <= b.front - .005, 'the slab stays inside the outer faces');
    const walls = meshes(p.root, o => o.userData.surface === 'facade' && o.parent === p.root);
    assert.ok(near(boxOf(walls).min.y, -.05), `${facade}: the facade reaches the paving (${boxOf(walls).min.y})`);
    const pots = meshes(p.decorGroup, o => o.material === p.materials.get('pot') && o.geometry.type === 'CylinderGeometry');
    assert.equal(pots.length, 2);
    for (const pot of pots) assert.ok(pot.position.z >= b.front + 2.8 && pot.position.z <= b.front + 3.2 - .1, `a planter at the garden edge of the 3,20 m terrace, not at the pui (${pot.position.z - b.front})`);
  }
});

test('the daklicht has broad, flat frame profiles on a membrane-clad kerb — not round bars', () => {
  // 2.17.0, the owner, with two photographs: "bizdeki daklicht çerçeveleri boru gibi duruyor, halbuki örnek attığım
  // görseldeki gibi kalın çerçeveleri olsun". Every line of the frame was a 43 mm cylinder between two pane corners.
  // A real lichtstraat is glazed in broad aluminium profiles that stand proud of the glass, on an upstand the roofer
  // dresses in the roof membrane.
  for (const rooflight of ['lean-1', 'lean-4', 'gable-2', 'gable-8']) {
    const p = sceneHarness({width: 500, depth: 300, rooflight}), r = p.model.rooflight, tag = rooflight;
    const frame = p.materials.get('rooflight-frame');
    const framed = meshes(p.roofGroup, o => o.material === frame);
    assert.ok(framed.length, `${tag}: a frame`);
    assert.ok(framed.every(o => o.geometry.type !== 'CylinderGeometry'), `${tag}: no part of the frame is a round bar`);
    const bars = meshes(p.roofGroup, o => o.name === 'rooflight-bar');
    const perSide = r.kind === 'gable' ? r.panelCount / 2 : r.panelCount;
    // Lean-to: a rafter each side of every pane, a top and a bottom rail. Zadeldak: the same per slope, plus the ridge.
    assert.equal(bars.length, r.kind === 'gable' ? 2 * (perSide + 1) + 3 : perSide + 3, `${tag}: one profile per line of the frame`);
    for (const bar of bars) {
      const {width, height} = bar.geometry.parameters;
      assert.equal(bar.geometry.type, 'BoxGeometry', `${tag}: a flat profile`);
      // 9 cm between panes; the profiles round the outside reach on over the kerb, 16,5 cm in all.
      assert.ok(width >= .08 && width <= .18, `${tag}: a broad profile, ${width} m across`);
      assert.ok(height >= .035 && height <= .07, `${tag}: standing ${height} m proud, not a strip`);
      assert.equal(bar.material, frame, `${tag}: in the frame colour`);
      assert.equal(bar.userData.scopeKey, 'rooflight', `${tag}: the frame answers to Daklicht`);
    }
    // Every edge of every pane lies under a profile.
    const boxes = bars.map(bar => new THREE.Box3().setFromObject(bar).expandByScalar(.002));
    for (const pane of r.panels) for (let i = 0; i < 4; i++) {
      const a = pane.points[i], b = pane.points[(i + 1) % 4], middle = new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      assert.ok(boxes.some(box => box.containsPoint(middle)), `${tag}: pane ${pane.index} edge ${i} is framed`);
    }
    // The upstand under it is the roofer's work: the membrane dressed up the kerb, whatever colour the kozijn has.
    const kerb = meshes(p.roofGroup, o => o.name === 'rooflight-kerb');
    assert.ok(kerb.length >= 4, `${tag}: a kerb on all four sides`);
    assert.ok(kerb.every(o => o.material === p.materials.get('surface:roof-membrane')), `${tag}: clad in the roof membrane`);
    // The owner, on the first render of the new frame: "daklichtte koymuş olduğun bu iç destek profillerini kaldır,
    // orada bunlar olmamalı ... diğer görünmeyen tarafları da sen tahmin et". No posts in the corners, no ledge
    // running round the inside under the glass, no king posts under the ridge: looking up from the room, or down
    // through the glass, the shaft is its lining and nothing else. Only the glazing profiles cross the opening.
    assert.ok(framed.every(o => o.name === 'rooflight-bar'), `${tag}: the frame colour is the glazing profiles only (${[...new Set(framed.map(o => o.name))]})`);
    const o = r.opening, shaft = new THREE.Box3(new THREE.Vector3(o.left + .01, p.model.height - .1, o.back + .01), new THREE.Vector3(o.right - .01, r.baseY + r.rise + .1, o.front - .01));
    const glass = p.materials.get('glass-rooflight');
    const roomFinishes = ['painted', 'plaster', 'gypsum'].map(key => p.materials.get(`surface:${key}`)).filter(Boolean);
    const inside = meshes(p.roofGroup, mesh => mesh.userData.scopeKey === 'rooflight' && mesh.material !== glass && mesh.name !== 'rooflight-bar' && new THREE.Box3().setFromObject(mesh).intersectsBox(shaft));
    assert.deepEqual(inside.map(mesh => mesh.name || mesh.geometry.type), [], `${tag}: nothing stands inside the shaft`);
    // ...and what the room sees up there is the lining, right up to the glass, not the dark outside of the kerb.
    const linings = meshes(p.roofGroup, mesh => mesh.name === 'rooflight-lining');
    assert.equal(linings.length, 4, `${tag}: a lining on all four sides`);
    assert.ok(linings.every(mesh => roomFinishes.includes(mesh.material)), `${tag}: in the room's own wall finish`);
    const top = boxOf(linings).max.y;
    assert.ok(near(top, r.baseY + r.rise, 1e-3), `${tag}: the lining reaches the highest glass edge (${top} vs ${r.baseY + r.rise})`);
  }
});

test('"geen rollaag wit/zwart" is in the picture the moment it is chosen, also before a kozijn is picked', () => {
  // 2.17.0, the owner: "rollaag ayarları neden ilk seçtiğim yerde güncellenmiyor, sonraki aşamalarda bir yerlere
  // tıklayınca güncelleniyor". Since "Geen deur" became the starting choice (2.16.0) the Rollaag card comes BEFORE
  // the Kozijn card, and the panel was only drawn once a door with leaves existed — so the choice changed nothing
  // until the next card. "Geen kozijn" still leaves the hole and its outer frame; the panel belongs above that.
  for (const frontOpening of ['none', 'sliding-2-black']) for (const rollaag of ['panel-white', 'panel-black']) {
    const p = sceneHarness({width: 500, depth: 300, facade: 'brick-red', frontOpening, rollaag}), m = p.model, o = m.opening, tag = `${frontOpening}/${rollaag}`;
    const panel = p.materials.get(`rollaag:${rollaag}`);
    assert.ok(panel, `${tag}: the panel has a material`);
    const parts = meshes(p.scene, mesh => mesh.material === panel);
    assert.ok(parts.length >= 1, `${tag}: the panel is drawn`);
    assert.ok(parts.every(mesh => mesh.userData.scopeKey === 'rollaag'), `${tag}: it answers to the Rollaag choice`);
    const box = boxOf(parts);
    assert.ok(near(box.min.y, o.bottom + o.height, 1e-3), `${tag}: it starts on the frame (${box.min.y} vs ${o.bottom + o.height})`);
    assert.ok(near(box.max.x - box.min.x, o.width, 1e-3), `${tag}: as wide as the opening (${box.max.x - box.min.x})`);
    assert.equal(meshes(p.scene, mesh => mesh.name === 'rollaag-course').length, 0, `${tag}: no brick course where the panel is`);
  }
  for (const frontOpening of ['none', 'sliding-2-black']) {
    const p = sceneHarness({width: 500, depth: 300, facade: 'brick-red', frontOpening, rollaag: 'masonry'});
    assert.equal(meshes(p.scene, mesh => mesh.name === 'rollaag-course').length, 1, `${frontOpening}: the masonry rollaag is a course of bricks on end`);
    assert.equal(meshes(p.scene, mesh => /^rollaag:panel/.test([...p.materials].find(([, material]) => material === mesh.material)?.[0] || '')).length, 0, `${frontOpening}: and no panel`);
  }
});

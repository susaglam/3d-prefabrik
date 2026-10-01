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
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
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

test('the downpipe runs through rounded bends, tangent to both legs, and leaves at 45° into the garden', () => {
  for (const overhang of ['none', 'pvc-white']) for (const drainSide of ['left', 'right', 'both']) {
    const m = buildGeometry({width: 500, depth: 300, overhang, drainSide});
    for (const drain of m.drains) {
      const parts = roundedRoute(downpipeRoute(drain, m.bounds.front, m.overhangDepth), DOWNPIPE.bend);
      const tag = `${overhang}/${drain.side}`;
      assert.equal(parts[0].kind, 'line', `${tag}: starts straight`);
      assert.equal(parts.at(-1).kind, 'line', `${tag}: the open end is straight`);
      assert.equal(parts.filter(p => p.kind === 'bend').length, m.overhangDepth ? 1 : 2, `${tag}: one bend per corner`);
      for (let i = 1; i < parts.length; i++) {
        const before = parts[i - 1], part = parts[i];
        assert.deepEqual(part.from, before.to, `${tag}: part ${i} starts where the previous one ends`);
        if (part.kind === 'bend') {
          assert.ok(parallel(direction(part.from, part.corner), direction(before.from, before.to)), `${tag}: bend ${i} is tangent to the leg before`);
          assert.ok(parallel(direction(part.corner, part.to), direction(parts[i + 1].from, parts[i + 1].to)), `${tag}: bend ${i} is tangent to the leg after`);
        }
      }
      const [dx, dy, dz] = direction(parts.at(-1).from, parts.at(-1).to);
      assert.ok(near(dx, 0) && dy < 0 && dz > 0 && near(-dy, dz), `${tag}: 45° down and out, got ${[dx, dy, dz]}`);
      assert.ok(parts.at(-1).to[1] > .05, `${tag}: the uitloop ends above the paving`);
      if (!m.overhangDepth) assert.ok(parts[0].from[2] < m.bounds.front, `${tag}: the pipe comes out of the wall`);
    }
  }
});

test('the roof outlet sits over its pipe with the whole flange on the membrane, clear of the kantplank', () => {
  for (const overhang of ['none', 'pvc-white']) for (const drainSide of ['left', 'right', 'both']) {
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

test('in the scene: a rounded pipe and an outlet per drain, on the membrane that lies under the daktrim', () => {
  for (const drainSide of ['right', 'both']) for (const overhang of ['none', 'pvc-white']) {
    const p = sceneHarness({width: 500, depth: 300, drainSide, overhang}), m = p.model, tag = `${drainSide}/${overhang}`;
    const drains = m.drains.length, slabTop = m.height + m.roofThickness / 2;
    const tubes = meshes(p.root, o => o.name === 'downpipe');
    assert.ok(tubes.every(o => o.geometry.type === 'TubeGeometry'), `${tag}: the pipe is a tube`);
    assert.equal(tubes.filter(o => o.geometry.parameters.path.isQuadraticBezierCurve3).length, drains * (overhang === 'none' ? 2 : 1), `${tag}: every bend is a curve`);
    assert.ok(tubes.every(o => o.geometry.parameters.radialSegments >= 14), `${tag}: round, not a hexagon`);
    assert.equal(meshes(p.root, o => o.name === 'downpipe-uitloop').length, drains, `${tag}: one open uitloop per pipe`);
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

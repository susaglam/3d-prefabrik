/**
 * Clicking the 3D scene must always reach the form (stage 1, release 2.9.3).
 *
 * Two different failure patterns, deliberately:
 *  1. The AUDIT gate reads docs/verification/2.9/scene-links.json — written by a real browser
 *     (.data/scene_links_probe.mjs raycasts the live scene) — and holds every priced field to one of two outcomes:
 *     an object in the scene answers for it, or scripts/scene-link-exceptions.mjs says in writing why it cannot.
 *     A field that loses its tag turns up here even though nothing throws.
 *  2. The STRUCTURAL gate builds the daktrim, de overstek and het daklicht headless and asserts the tags on the
 *     meshes themselves. It catches a regression the moment the code changes, without waiting for a browser run —
 *     and it fails when the audit is merely stale, which the audit gate alone cannot see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import {buildUnderfloorHeating} from '../../addons/cs_prefab_configurator/static/src/fixtures.js';
import {UNLINKED_FIELDS, SHARED_OBJECTS} from '../../scripts/scene-link-exceptions.mjs';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const audit = read('../../docs/verification/2.9/scene-links.json');
const pricebook = read('../../addons/cs_prefab_configurator/data/pricebook.demo-v1.json');
// services/catalog.py default_policies(): every optionPrices row becomes a delivery-scope entry. Wall lighting used
// to be added here by hand; it is retired since 2.16.0, together with the green roof and the zonwering, so the
// pricebook alone is the list — and the audit file is filtered to it rather than being re-probed for three gaps.
const pricedFields = Object.keys(pricebook.optionPrices).sort();

test('the audit covers exactly the priced fields the pricebook defines, so a new option cannot slip past unnoticed', () => {
  assert.deepEqual(audit.pricedFields, pricedFields,
    'Re-run node .data/scene_links_probe.mjs docs/verification/2.9/scene-links.json after changing the pricebook.');
  for (const key of pricedFields) assert.ok(audit.fields[key], 'Missing from the audit: ' + key);
});

test('every priced field is either reachable in the scene or carries a written reason why it is not', () => {
  const gaps = [];
  for (const key of pricedFields) {
    const entry = audit.fields[key];
    if (entry.linked) {
      assert.ok(entry.mesh, key + ' is reported linked but names no mesh');
      continue;
    }
    if (!UNLINKED_FIELDS[key]) {gaps.push(key); continue;}
    assert.equal(entry.unlinkedReason, UNLINKED_FIELDS[key], 'Stale reason in the audit for ' + key);
    assert.ok(entry.unlinkedReason.length > 40, 'The reason for ' + key + ' must explain itself, not label itself');
  }
  assert.deepEqual(gaps, [], 'Priced but unreachable and undocumented: tag an object or write down why not');
});

test('a field that shares its object names the field it shares with, and that one is reachable', () => {
  for (const [key, owner] of Object.entries(SHARED_OBJECTS)) {
    assert.ok(UNLINKED_FIELDS[key], key + ' shares an object, so it needs the reason that says so');
    assert.equal(audit.fields[key]?.sharesObjectWith, owner);
    assert.ok(audit.fields[owner]?.linked, 'The shared object owner ' + owner + ' must itself be reachable');
  }
});

test('the exception list has no stale entries: a field that got an object must lose its excuse', () => {
  for (const key of Object.keys(UNLINKED_FIELDS)) {
    const entry = audit.fields[key];
    if (!entry) continue;
    assert.equal(entry.linked, false,
      key + ' is reachable in the scene now — remove it from scripts/scene-link-exceptions.mjs');
  }
});

test('the audit was taken over several real configurations, in every viewpoint, without console errors', () => {
  assert.deepEqual(audit.scenarios.map(item => item.id), ['rich', 'bare', 'no-frame']);
  for (const scenario of audit.scenarios) assert.deepEqual(scenario.errors, [], scenario.id + ' logged a page error');
  for (const view of ['perspective', 'front', 'top', 'interior', 'ceiling']) assert.ok(audit.views.includes(view));
  // The bare shell must stay linked too: a casco without interior is a real order, not a degraded preview.
  const bare = audit.scenarios.find(item => item.id === 'bare');
  for (const key of ['facade', 'roofEdge', 'drainMaterial', 'frontOpening', 'rooflight', 'screed']) {
    assert.ok(bare.distinctScopeKeys.includes(key), 'The bare shell lost its link to ' + key);
  }
});

/** Prototype-backed Preview without a renderer, same shape as green_roof.test.mjs / house.test.mjs. */
function roofHarness(config) {
  const preview = Object.create(Preview.prototype);
  Object.assign(preview, {config: structuredClone(config), scope: [], placement: null, model: buildGeometry(config),
    examplesVisible: true, decorVisible: true, roofVisible: true, view: 'perspective', mode: '3d',
    materials: new Map(), textures: new Set(), maps: {}, buildCounts: {structure: 0, material: 0, fixtures: 0},
    root: new THREE.Group(), renderer: {shadowMap: {}}, updatePlan() {}, render() {}});
  preview.roofGroup = new THREE.Group(); preview.root.add(preview.roofGroup);
  return preview;
}
const tagsIn = group => {
  const found = new Map();
  group.traverse(object => {
    if (!object.isMesh && !object.isLine) return;
    const key = object.userData.scopeKey || null;
    found.set(key, (found.get(key) || 0) + 1);
  });
  return found;
};

test('every daktrim profile carries roofEdge, so the trim answers before the wall behind it', () => {
  for (const roofEdge of ['aluminium', 'anthracite', 'zinc']) {
    const preview = roofHarness({width: 500, depth: 300, roofEdge, overhang: 'none'});
    preview.buildRoofEdge(preview.model, preview.material('facade:test', {color: '#ffffff'}));
    const trims = [];
    preview.roofGroup.traverse(object => {if (object.isMesh && object.material === preview.materials.get('edge:' + roofEdge)) trims.push(object);});
    assert.ok(trims.length >= 3, roofEdge + ' should build a trim run per side');
    for (const mesh of trims) assert.equal(mesh.userData.scopeKey, 'roofEdge', roofEdge + ' has an untagged trim profile');
  }
});

test('boeiboord and soffit carry overhang; the facade band only appears when there is no overstek', () => {
  for (const overhang of ['pvc-white', 'pvc-anthracite', 'wood-white']) {
    const preview = roofHarness({width: 500, depth: 300, overhang, roofEdge: 'anthracite'});
    preview.buildRoofEdge(preview.model, preview.material('facade:test', {color: '#ffffff'}));
    const boards = [];
    preview.roofGroup.traverse(object => {if (object.isMesh && object.material === preview.materials.get('overhang:' + overhang)) boards.push(object);});
    assert.ok(boards.length >= 4, overhang + ' should build a fascia on three sides plus a soffit');
    for (const mesh of boards) assert.equal(mesh.userData.scopeKey, 'overhang', overhang + ' has an untagged board');
    // Nothing in an overstek build is left untagged, and the facade never reaches the roof edge here. The kantplank
    // under the trim is clad in the roof membrane (2.13.0), so it answers like the roof it belongs to.
    assert.deepEqual([...tagsIn(preview.roofGroup).keys()].sort(), ['overhang', 'roofEdge', 'rooflight']);
  }
});

test('the rooflight tags its own upstand and glass, and the zonwering under it is tagged separately', () => {
  const config = {width: 500, depth: 340, rooflight: 'lean-2', roofShade: true, roofEdge: 'anthracite'};
  const preview = roofHarness(config), m = preview.model;
  assert.ok(m.rooflight.panelCount > 0, 'the fixture configuration must actually produce a rooflight');
  const frame = preview.material('frame:test', {color: '#efefef'});
  const glass = preview.material('glass:test', {color: '#0b100e'});
  preview.makeRooflight(m, frame, glass, preview.material('inside:test', {color: '#ffffff'}));
  const tags = tagsIn(preview.roofGroup);
  assert.equal(tags.get(null), undefined, 'every rooflight part must carry a tag');
  assert.ok(tags.get('rooflight') > 5, 'kerb, cheeks, glass and frame lines all belong to the daklicht');
  assert.ok(tags.get('roofShade') >= 2, 'the blind and its folds answer to the zonwering field');
  assert.equal(preview.roofGroup.getObjectByName('rooflight-shade').userData.scopeKey, 'roofShade');
});

test('without a zonwering nothing in the rooflight claims roofShade', () => {
  const preview = roofHarness({width: 500, depth: 340, rooflight: 'lean-2', roofShade: false, roofEdge: 'anthracite'});
  preview.makeRooflight(preview.model, preview.material('frame:test', {color: '#efefef'}),
    preview.material('glass:test', {color: '#0b100e'}), preview.material('inside:test', {color: '#ffffff'}));
  assert.equal(tagsIn(preview.roofGroup).get('roofShade'), undefined);
});

test('a masonry rollaag keeps its own field: the brick strip above the frame is not plain facade', () => {
  // masonry is what "rich" and "no-frame" carry; before 2.9.3 the strip was plain facade and rollaag was
  // unreachable in both. The panel finishes are covered by "bare".
  for (const id of ['rich', 'no-frame', 'bare']) {
    const scenario = audit.scenarios.find(item => item.id === id);
    assert.ok(scenario.distinctScopeKeys.includes('rollaag'), id + ' has no object answering for the rollaag');
  }
  assert.equal(audit.fields.rollaag.perScenario.every(item => item.blindHits + item.aimedHits > 0), true);
});

test('the near-invisible underfloor wash is not pickable, so it cannot swallow the floor under it', () => {
  const model = buildGeometry({width: 500, depth: 340, interior: true, underfloorHeating: true, screed: true});
  assert.ok(model.underfloorLoops?.length, 'the configuration must actually lay loops');
  const materials = new Map();
  const material = (key, options, kind = 'mesh') => {
    if (!materials.has(key)) materials.set(key, kind === 'line' ? new THREE.LineBasicMaterial(options)
      : kind === 'flat' ? new THREE.MeshBasicMaterial(options) : new THREE.MeshStandardMaterial(options));
    return materials.get(key);
  };
  const group = buildUnderfloorHeating(model, {mode: 'representative', visible: true}, material);
  assert.equal(group.userData.scopeKey, 'underfloorHeating');
  const wash = group.children.find(child => child.userData.floorPreparationArea);
  const routes = group.children.filter(child => child.userData.floorHeatingLoop);
  assert.ok(wash && routes.length, 'the overlay is a wash plus route lines');
  assert.equal(wash.userData.noPick, true, 'the full-floor wash must let a click through to the afwerkvloer');
  for (const route of routes) assert.notEqual(route.userData.noPick, true, 'the route lines are what you click');
});

/**
 * The kozijnen as they are BUILT (2.17.0), held against the customer's reference renders (kozijn/*.png), rectified to
 * front elevations and measured — docs/verification/kozijn-ref/. The owner: "kapıları tam olarak istediğim gibi
 * yapmamışsın; olmayacak her yere havalandırma koymuşsun; kapı kollarını kendin uydurmuşsun; kayan sürgülü kapıları
 * dışarıdan sürgülüymüş hissi verdin, halbuki bunlar içeriden olmalıydı; çerçeveler daha ince duruyor".
 *
 * A real scene is built (no renderer) and read back by mesh name and bounding box; nothing here compares three.js
 * objects with each other (the 20 GB lesson), only numbers and names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Preview} from '../../addons/cs_prefab_configurator/static/src/preview.js';
import {buildGeometry} from '../../addons/cs_prefab_configurator/static/src/geometry.js';
import {normalizeEnvironment} from '../../addons/cs_prefab_configurator/static/src/environment.js';
import {DOCUMENT_PARTS} from '../../addons/cs_prefab_configurator/static/src/scene_content.js';
import * as THREE from '../../addons/cs_prefab_configurator/static/vendor/three.module.js';

function scene(config) {
  const preview = Object.create(Preview.prototype);
  const camera = new THREE.PerspectiveCamera(40, 1.5, .035, 150);
  Object.assign(preview, {config: structuredClone(config), model: buildGeometry(config), scope: [], placement: null,
    mode: '3d', view: 'perspective', camera, cameraFocus: null, cameraTouched: false, dimensionsVisible: false, roofVisible: true,
    examplesVisible: true, decorVisible: true, illustrativeOff: {}, surroundingsVisible: true, documentSurroundings: false,
    documentParts: {...DOCUMENT_PARTS}, partGroups: {}, documentMode: false,
    materials: new Map(), textures: new Set(), maps: {}, buildCounts: {structure: 0, material: 0, fixtures: 0},
    environment: normalizeEnvironment({}), scenario: 'none', floorFinish: 'laminate',
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
const opening = p => p.root.getObjectByName('opening');
const meshes = (root, filter) => { const found = []; root?.traverse(o => { if (o.isMesh && filter(o)) found.push(o); }); return found; };
const box = mesh => new THREE.Box3().setFromObject(mesh);
const within = (b, panel) => b.getCenter(new THREE.Vector3()).x > panel.x - panel.width / 2 && b.getCenter(new THREE.Vector3()).x < panel.x + panel.width / 2;
const glassOf = (p, panel) => meshes(opening(p), o => o.name === 'clear-glazing' && within(box(o), panel));
const near = (a, b, eps) => Math.abs(a - b) <= eps;

test('a schuifpui slides on the INSIDE: the sliding leaf stands behind the fixed pane, never in front of it', () => {
  for (const frontOpening of ['sliding-2-black', 'sliding-4-white']) {
    const p = scene({width: 500, depth: 300, frontOpening}), m = p.model;
    const fixed = m.panels.filter(panel => panel.role === 'fixed'), sliding = m.panels.filter(panel => panel.role === 'sliding');
    const front = panel => box(glassOf(p, panel)[0]).max.z;
    for (const leaf of sliding) for (const pane of fixed) {
      const recess = front(pane) - front(leaf);
      assert.ok(recess > .055 && recess < .09, `${frontOpening}: the sliding glass is ${(recess * 1000).toFixed(0)} mm behind the fixed glass (reference 70-75)`);
    }
    // Nothing of a sliding leaf comes forward of the fixed sash: no track or lap in front of the facade side.
    const fixedFace = Math.max(...fixed.map(pane => box(glassOf(p, pane)[0]).max.z));
    for (const leaf of sliding) {
      const parts = meshes(opening(p), o => o.userData.leaf === leaf.index);
      assert.ok(parts.length, `${frontOpening}: leaf ${leaf.index} is tagged`);
      assert.ok(parts.every(o => box(o).max.z < fixedFace + .03), `${frontOpening}: leaf ${leaf.index} stays behind the fixed sash`);
    }
  }
});

test('ventilatieroosters only where the references have them: fixed panes and the loopdeur', () => {
  for (const frontOpening of ['sliding-2-white', 'sliding-4-black', 'folding-white']) {
    const p = scene({width: 500, depth: 300, frontOpening}), m = p.model;
    const housings = meshes(opening(p), o => o.name === 'window-rooster');
    for (const panel of m.panels) {
      const mine = housings.filter(o => within(box(o), panel));
      if (panel.grille) assert.equal(mine.length, 2, `${frontOpening}: section ${panel.index} (${panel.role}) carries its grille on both faces`);
      else assert.equal(mine.length, 0, `${frontOpening}: section ${panel.index} (${panel.role}) has no grille`);
    }
    // The grille is a band of the reference's height directly under the top rail, across the whole pane.
    for (const housing of housings) {
      const b = box(housing);
      assert.ok(near(b.max.y - b.min.y, .089, .01), `${frontOpening}: an 89 mm housing (${(b.max.y - b.min.y).toFixed(3)})`);
    }
  }
});

test('handles are the small flush pulls of the references, on the right stile, at 0,92 m — not a long bar, no lever', () => {
  for (const frontOpening of ['sliding-2-black', 'sliding-4-white', 'folding-black']) {
    const p = scene({width: 500, depth: 300, frontOpening}), m = p.model, y0 = m.opening.bottom;
    assert.equal(meshes(opening(p), o => /lever/.test(o.name)).length, 0, `${frontOpening}: no deurkruk`);
    const pulls = meshes(opening(p), o => o.name === 'window-pull');
    const handled = m.panels.filter(panel => panel.handle);
    assert.equal(pulls.length, 2 * handled.length, `${frontOpening}: one pull per handled leaf, on each face`);
    for (const panel of handled) {
      const mine = pulls.filter(o => within(box(o), panel));
      assert.equal(mine.length, 2, `${frontOpening}: section ${panel.index} has its pull on both faces`);
      for (const pull of mine) {
        const b = box(pull), centre = b.getCenter(new THREE.Vector3());
        assert.ok(b.max.y - b.min.y <= .125 && b.max.y - b.min.y >= .09, `${frontOpening}: a pull ~110 mm tall, not a bar (${(b.max.y - b.min.y).toFixed(3)})`);
        assert.ok(near(centre.y, y0 + (m.opening.kind === 'folding' ? .93 : .92), .02), `${frontOpening}: centred at the reference height (${centre.y.toFixed(3)})`);
        // Centred on the stile, so at most a jamb plus half a stile (55 + 48 mm) in from the section's edge.
        const edge = panel.handle.edge === 'left' ? panel.x - panel.width / 2 : panel.x + panel.width / 2;
        assert.ok(Math.abs(centre.x - edge) < .13, `${frontOpening}: on the ${panel.handle.edge} stile of section ${panel.index}`);
      }
    }
  }
});

test('the sash profiles carry the reference weight: broad stiles and a tall bottom rail, a slim outer frame', () => {
  for (const frontOpening of ['sliding-2-white', 'folding-white']) {
    const p = scene({width: 500, depth: 300, frontOpening}), m = p.model;
    const stiles = meshes(opening(p), o => o.name === 'sash-stile');
    assert.ok(stiles.length >= 2 * m.panels.length, `${frontOpening}: two stiles per section`);
    for (const stile of stiles) {
      const b = box(stile);
      assert.ok(b.max.x - b.min.x >= .08, `${frontOpening}: a stile ${(b.max.x - b.min.x).toFixed(3)} m across (reference 87-95 mm)`);
    }
    const jambs = meshes(opening(p), o => o.name === 'frame-jamb');
    assert.equal(jambs.length, 2, `${frontOpening}: two jambs`);
    for (const jamb of jambs) {
      const b = box(jamb);
      assert.ok(b.max.x - b.min.x <= .075, `${frontOpening}: a slim outer jamb (${(b.max.x - b.min.x).toFixed(3)} m)`);
    }
  }
});

test('openslaande deuren: side lights glazed into the frame, kozijnstijlen to the doors, one deurkruk on the active door', () => {
  for (const frontOpening of ['french-white', 'french-bars-black']) {
    const p = scene({width: 600, depth: 300, frontOpening}), m = p.model;
    assert.equal(meshes(opening(p), o => o.name === 'frame-mullion').length, 2, `${frontOpening}: a kozijnstijl either side of the doors`);
    assert.equal(meshes(opening(p), o => o.name === 'window-pull').length, 0, `${frontOpening}: no flush pull on a swing door`);
    const active = m.panels[2], levers = meshes(opening(p), o => o.name === 'window-lever');
    assert.ok(levers.length >= 2 && levers.every(o => within(box(o), active)), `${frontOpening}: the deurkruk is on the right-hand door only`);
    assert.ok(levers.every(o => box(o).getCenter(new THREE.Vector3()).x < active.x), `${frontOpening}: on its meeting (left) stile`);
    const housings = meshes(opening(p), o => o.name === 'window-rooster');
    for (const panel of m.panels) assert.equal(housings.filter(o => within(box(o), panel)).length, panel.grille ? 2 : 0, `${frontOpening}: the grille of section ${panel.index}`);
    assert.equal(meshes(opening(p), o => o.name === 'sash-stile').length, 4, `${frontOpening}: two doors with two stiles each; the side lights have none`);
    const bars = meshes(opening(p), o => o.name === 'roede');
    assert.equal(bars.length, frontOpening.includes('bars') ? 3 * 2 * 4 : 0, `${frontOpening}: three roedes on both faces of every pane`);
    if (bars.length) {
      // The roedes line up across a side light (with a grille) and a door (without one), as on the reference.
      const heights = panel => bars.filter(o => within(box(o), panel)).map(o => box(o).getCenter(new THREE.Vector3()).y.toFixed(3));
      assert.deepEqual(new Set(heights(m.panels[0])), new Set(heights(m.panels[1])), `${frontOpening}: one bar line across the front`);
    }
  }
});

test('openslaande deuren carry the reference sightlines: flush doors, deep glass, a tall bottom rail, a satin deurkruk', () => {
  const p = scene({width: 600, depth: 300, frontOpening: 'french-white'}), m = p.model, y0 = m.opening.bottom;
  const face = Math.max(...meshes(opening(p), o => o.name === 'frame-jamb').map(o => box(o).max.z));
  const [light, door] = m.panels, glassFront = panel => box(glassOf(p, panel)[0]).max.z;
  assert.ok(near(face - glassFront(light), .062 - .003, .006), `side light glass ${((face - glassFront(light)) * 1000).toFixed(0)} mm behind the frame face (reference 60-65)`);
  assert.ok(near(face - glassFront(door), .065 - .003, .006), `door glass ${((face - glassFront(door)) * 1000).toFixed(0)} mm behind the frame face (reference 65)`);
  const doorFront = Math.max(...meshes(opening(p), o => o.name === 'sash-stile' && within(box(o), door)).map(o => box(o).max.z));
  assert.ok(near(doorFront, face, .003), 'the doors stand flush with the frame and the mullions');
  // The plain doors have a 187 mm bottom rail, the side lights a 75 mm sill member: the door glass starts higher.
  const glassBottom = panel => box(glassOf(p, panel)[0]).min.y + .01;
  assert.ok(near(glassBottom(door) - glassBottom(light), .187 - .075, .01), 'the door pane starts 112 mm above the side light pane');
  const bars = scene({width: 600, depth: 300, frontOpening: 'french-bars-white'}), [barsLight, barsDoor] = bars.model.panels;
  assert.ok(near(box(glassOf(bars, barsDoor)[0]).min.y, box(glassOf(bars, barsLight)[0]).min.y, .002), 'met roedes: one 88 mm bottom member under every pane');
  // The deurkruk: a satin-silver lever at 879 mm and a cylinder rosette 65 mm under it, on both faces.
  const levers = meshes(opening(p), o => o.name === 'window-lever'), cylinders = meshes(opening(p), o => o.name === 'window-cylinder');
  assert.ok(levers.some(o => near(box(o).getCenter(new THREE.Vector3()).y, y0 + .879, .015)), 'the lever at the reference height');
  assert.equal(cylinders.length, 2, 'a cylinder rosette on each face');
  assert.ok(cylinders.every(o => near(box(o).getCenter(new THREE.Vector3()).y, y0 + .814, .015)), 'the cylinder under the lever');
  assert.ok(levers.every(o => `#${o.material.color.getHexString()}` === '#dcdbd8'), 'satin silver, in both frame colours');
  // The drempel is dark, its own element, and stands 35 mm proud of the frame.
  const [drempel] = meshes(opening(p), o => o.name === 'kozijn-threshold');
  assert.equal(`#${drempel.material.color.getHexString()}`, '#423a34');
  assert.ok(near(box(drempel).max.z - face, .035, .004), 'the drempel stands proud');
  // The aluminium profile ("wit-alu") is slimmer: 32 mm jambs, a 54 mm head, 59 mm mullions.
  const alu = scene({width: 600, depth: 300, frontOpening: 'french-white', openingMaterial: 'aluminium'});
  const width = (q, name) => meshes(opening(q), o => o.name === name).map(o => { const b = box(o); return b.max.x - b.min.x; });
  assert.ok(width(alu, 'frame-jamb').every(w => near(w, .032, .002)), 'aluminium jambs');
  assert.ok(width(alu, 'frame-mullion').every(w => near(w, .059, .002)), 'aluminium mullions');
  assert.ok(width(p, 'frame-jamb').every(w => near(w, .07, .002)), 'kunststof jambs');
});

test('a harmonicapui hangs in one plane, shows no hinge barrels and stands on a light threshold', () => {
  for (const frontOpening of ['folding-black', 'folding-white']) {
    const p = scene({width: 500, depth: 300, frontOpening}), m = p.model;
    const fronts = m.panels.map(panel => box(glassOf(p, panel)[0]).max.z);
    assert.ok(Math.max(...fronts) - Math.min(...fronts) < 1e-6, `${frontOpening}: five leaves in one plane`);
    assert.equal(meshes(opening(p), o => o.geometry.type === 'CylinderGeometry').length, 0, `${frontOpening}: no hinge cylinders`);
    const threshold = meshes(opening(p), o => o.name === 'kozijn-threshold');
    assert.equal(threshold.length, 1, `${frontOpening}: a threshold`);
    assert.equal(`#${threshold[0].material.color.getHexString()}`, '#eae8e6', `${frontOpening}: light, in both colours`);
  }
});

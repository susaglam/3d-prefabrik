import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparisonDrafts, comparisonRows} from '../../addons/cs_prefab_configurator/static/src/model.js';

const catalog = JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json', import.meta.url)));

test('comparison slots restore only canonical design data and reject malformed saved slots', () => {
  const saved = JSON.parse('{"A":{"config":{"width":620,"postcode":"1234 AB","email":"private@example.test","contact":{"name":"Private"},"price":1,"scope":[{"productIncluded":true}],"view":"ceiling","examplesVisible":false,"__proto__":{"polluted":true}},"contact":{"name":"Private"},"price":1},"B":{"config":{"depth":320}},"C":{"config":{"width":750}},"active":"B"}');
  const before = structuredClone(saved);
  const restored = comparisonDrafts(saved, catalog);

  assert.deepEqual(Object.keys(restored), ['A', 'B']);
  assert.equal(restored.A.width, 620);
  assert.equal(restored.B.depth, 320);
  assert.equal(restored.A.postcode, '');
  assert.deepEqual(Object.keys(restored.A).sort(), Object.keys(catalog.defaults).sort());
  for (const key of ['email', 'contact', 'price', 'scope', 'view', 'examplesVisible', '__proto__']) {
    assert.equal(Object.hasOwn(restored.A, key), false, key);
  }
  assert.equal({}.polluted, undefined);
  assert.deepEqual(saved, before, 'restoring slots must not mutate persisted data');
  restored.A.ceilingPositions.push('left');
  assert.deepEqual(catalog.defaults.ceilingPositions, [], 'restored choices must not share catalog arrays');

  for (const invalid of [undefined, null, false, [], 'saved', {A: null, B: []}, {A: {}, B: {width: 620}}, {A: {config: []}, B: {config: null}}]) {
    assert.deepEqual(comparisonDrafts(invalid, catalog), {A: null, B: null});
  }
  const oneSlot = comparisonDrafts({A: {config: {}}}, catalog);
  assert.deepEqual(oneSlot.A, catalog.defaults);
  assert.equal(oneSlot.B, null);
});

test('old saved designs migrate count selections using the current catalog and discard obsolete values', () => {
  const restored = comparisonDrafts({
    A: {config: {interior: true, ceilingLights: 2, spotlights: 2, sockets: 'both', facade: 'retired-brick', width: '620'}},
    B: {config: {interior: true, ceilingLights: 3, ceilingPositions: ['right'], socketPositions: ['R2', 'L1'], sockets: 'none'}},
  }, catalog);

  assert.deepEqual(restored.A.ceilingPositions, ['left', 'center']);
  assert.deepEqual(restored.A.spotPositions, ['r1c1', 'r1c2']);
  assert.deepEqual(restored.A.socketPositions, ['L2', 'R2']);
  assert.equal(restored.A.facade, catalog.defaults.facade);
  assert.equal(restored.A.width, catalog.defaults.width);
  assert.equal(Object.hasOwn(restored.A, 'rollaagEnabled'), false, 'the retired toggle is not restored from old saved designs');
  assert.deepEqual(restored.B.ceilingPositions, ['right'], 'explicit current arrays take precedence over old counts');
  assert.equal(restored.B.ceilingLights, 1);
  assert.deepEqual(restored.B.socketPositions, ['L1', 'R2']);
  assert.equal(restored.B.sockets, 'both');
});

test('comparison rows expose readable dimensions and position differences without duplicate legacy counts', () => {
  const a = {interior: true, width: 500, depth: 300, ceilingPositions: ['left'], socketPositions: ['L1'], spotPositions: []};
  const b = {interior: true, width: 620, depth: 320, ceilingPositions: ['right', 'center'], socketPositions: ['R2'], spotPositions: ['r2c2']};
  const rows = comparisonRows(a, b, catalog);
  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));

  assert.deepEqual(new Set(rows.map(row => row.key)), new Set(['width', 'depth', 'ceilingPositions', 'socketPositions', 'spotPositions']));
  assert.deepEqual(byKey.width, {key: 'width', label: 'Breedte', a: '500 cm', b: '620 cm'});
  assert.deepEqual(byKey.depth, {key: 'depth', label: 'Diepte', a: '300 cm', b: '320 cm'});
  assert.deepEqual(byKey.ceilingPositions, {key: 'ceilingPositions', label: 'Posities plafondlicht', a: 'Links', b: 'Midden, Rechts'});
  assert.deepEqual(byKey.socketPositions, {key: 'socketPositions', label: 'Posities wandcontactdozen', a: 'Links 1', b: 'Rechts 2'});
  assert.deepEqual(byKey.spotPositions, {key: 'spotPositions', label: 'Posities inbouwspots', a: 'Geen', b: 'Rij 2 · positie 2'});
});

test('comparison ignores canonical equality and hidden differences but includes a field visible in either design', () => {
  const current = {interior: true, ceilingPositions: ['left', 'center'], spotPositions: ['r1c1'], socketPositions: ['L2', 'R2']};
  const equivalentLegacy = {interior: true, ceilingLights: 2, spotlights: 1, sockets: 'both', price: 1, contact: {email: 'private@example.test'}};
  assert.deepEqual(comparisonRows(current, equivalentLegacy, catalog), []);
  assert.deepEqual(comparisonRows({...current, socketPositions: ['R2', 'L2']}, current, catalog), [], 'selection order is canonical');
  assert.deepEqual(comparisonRows({rollaag: 'panel-black', interior: false, plaster: true}, {rollaag: 'panel-black', interior: false, plaster: false}, catalog), [], 'inactive finish selections must not create differences');

  // The retired rollaag toggle never appears as a difference; the finish itself does.
  const rows = comparisonRows({rollaagEnabled: false, rollaag: 'panel-black'}, {rollaagEnabled: true, rollaag: 'masonry'}, catalog);
  assert.ok(!rows.some(row => row.key === 'rollaagEnabled'));
  assert.deepEqual(rows, [{key: 'rollaag', label: 'Rollaag', a: 'Geen rollaag zwart', b: 'Rollaag'}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { rooflightIcon, parseRooflight, widthRatio } from '../../addons/cs_prefab_configurator/static/src/rooflight_icons.js';

const OPTIONS = ['none', 'lean-1', 'lean-2', 'lean-3', 'lean-4', 'lean-5', 'gable-2', 'gable-4', 'gable-6', 'gable-8', 'gable-10'];
const countBays = (svg) => (svg.match(/data-bay="\d+"/g) || []).length;
const countSlope = (svg, slope) => (svg.match(new RegExp(`data-slope="${slope}"`, 'g')) || []).length;
/** Screen-space points of every polygon carrying the given attribute. */
function polygonPoints(svg, attribute) {
  const pattern = new RegExp(`<polygon points="([^"]+)"[^>]*${attribute}`, 'g');
  return [...svg.matchAll(pattern)].map((match) => match[1].split(' ').map((pair) => pair.split(',').map(Number)));
}

test('every catalogue option renders an svg with the expected number of glass bays', () => {
  for (const id of OPTIONS) {
    const svg = rooflightIcon(id);
    assert.ok(svg.startsWith('<svg'), `${id} starts with <svg`);
    assert.ok(svg.endsWith('</svg>'), `${id} ends with </svg>`);
    const expected = id === 'none' ? 0 : Number(id.split('-')[1]);
    assert.equal(countBays(svg), expected, `${id} bay count`);
    assert.match(svg, /viewBox="0 0 120 84"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.match(svg, /class="rooflight-icon"/);
    assert.doesNotMatch(svg, /<text/, `${id} has no text inside the svg`);
  }
});

test('profiles are tagged and gable bays are split evenly over the two slopes', () => {
  for (const id of ['lean-1', 'lean-3', 'lean-5']) {
    const svg = rooflightIcon(id);
    assert.match(svg, /data-profile="lean"/, id);
    assert.equal(countSlope(svg, 'single'), Number(id.split('-')[1]));
  }
  for (const id of ['gable-2', 'gable-6', 'gable-10']) {
    const svg = rooflightIcon(id);
    const half = Number(id.split('-')[1]) / 2;
    assert.match(svg, /data-profile="gable"/, id);
    assert.equal(countSlope(svg, 'back'), half, `${id} back slope`);
    assert.equal(countSlope(svg, 'front'), half, `${id} front slope`);
    assert.match(svg, /data-part="ridge"/, `${id} draws a ridge`);
  }
  const none = rooflightIcon('none');
  assert.match(none, /data-profile="none"/);
  assert.match(none, /data-part="placeholder"/);
  assert.doesNotMatch(none, /data-part="(kerb|side|shadow|ridge)"/, 'bare roof has no kerb, sides, shadow or ridge');
});

test('unknown ids fall back to the bare roof without throwing', () => {
  for (const id of ['', undefined, null, 42, 'dome-3', 'gable-3', 'gable-0', 'lean-0', 'lean', 'LEAN-2', 'lean-2x', {}]) {
    let svg;
    assert.doesNotThrow(() => { svg = rooflightIcon(id); }, `id ${String(id)}`);
    assert.ok(svg.startsWith('<svg'));
    assert.match(svg, /data-profile="none"/, `id ${String(id)}`);
    assert.equal(countBays(svg), 0);
    assert.deepEqual(parseRooflight(id), { profile: 'none', bays: 0, columns: 0 });
  }
  assert.equal(rooflightIcon('dome-3'), rooflightIcon('none'));
});

test('output is deterministic and honours the requested size', () => {
  for (const id of OPTIONS) assert.equal(rooflightIcon(id), rooflightIcon(id), id);
  assert.match(rooflightIcon('lean-2'), /width="120" height="84"/);
  assert.match(rooflightIcon('lean-2', { width: 240, height: 168 }), /width="240" height="168"/);
  assert.match(rooflightIcon('lean-2', { width: 'bogus', height: -5 }), /width="120" height="84"/);
  assert.match(rooflightIcon('lean-2', { width: 240 }), /width="240" height="84"/);
});

test('lean glass is high at the back (top) and low at the front (bottom); wider lights for more bays', () => {
  const [first] = polygonPoints(rooflightIcon('lean-3'), 'data-bay="1"');
  const [backLeft, backRight, frontRight, frontLeft] = first;
  assert.ok(backLeft[1] < frontLeft[1] && backRight[1] < frontRight[1], 'back edge sits above the front edge on screen');
  const backDrop = backRight[1] - backLeft[1];
  const frontDrop = frontRight[1] - frontLeft[1];
  assert.ok(Math.abs(backDrop - frontDrop) < 0.05, 'back and front edges are parallel (the plane is not twisted)');
  const span = (id) => {
    const xs = polygonPoints(rooflightIcon(id), 'data-bay=').flat().map((point) => point[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  assert.ok(span('lean-1') < span('lean-3') && span('lean-3') < span('lean-5'), 'lean width grows with bay count');
  assert.ok(span('gable-2') < span('gable-6') && span('gable-6') < span('gable-10'), 'gable width grows with bay count');
  assert.ok(Math.abs(span('lean-5') - span('gable-10')) < 0.05, 'five lean bays and five gable columns share a width');
  assert.equal(widthRatio(1), 0.36);
  assert.equal(widthRatio(5), 0.85);
  assert.equal(widthRatio(9), 0.85, 'width ratio is capped');
});

test('gable ridge is the highest glass edge and both slopes fall away from it', () => {
  const svg = rooflightIcon('gable-4');
  const [back] = polygonPoints(svg, 'data-slope="back"');
  const [front] = polygonPoints(svg, 'data-slope="front"');
  const ridgeBack = back.slice(2);
  const ridgeFront = front.slice(0, 2);
  assert.deepEqual(ridgeBack.map((p) => p.join(',')).reverse(), ridgeFront.map((p) => p.join(',')), 'back and front bays meet along the same ridge edge');
  // Isometric view from the garden: the back eave is farther away, so it projects ABOVE the ridge
  // (a foreshortened but still visible band), while the near front eave projects BELOW it.
  const backBand = ridgeBack[1][1] - back[0][1];
  const frontBand = front[3][1] - ridgeFront[0][1];
  assert.ok(backBand >= 3, `back slope stays visible (${backBand.toFixed(2)}px at 1x)`);
  assert.ok(frontBand > backBand, 'front slope faces the viewer and shows more than the back slope');
  assert.match(svg, /data-part="shade"/, 'back slope carries a shade overlay');
});

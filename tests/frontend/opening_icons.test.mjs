import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openingIcon, parseOpening } from '../../addons/cs_prefab_configurator/static/src/opening_icons.js';

/**
 * 2.16.0: the icons are front elevations with opening symbols, not isometric drawings of a wall section — the
 * customer could not tell the products apart at 120 px and nothing said which way anything opened. What this file
 * pins is what a buyer has to be able to read off the icon: which product it is, how many sections it has, whether
 * it carries roedes, what colour the frame is, and — the point of the redraw — how each leaf opens.
 */
const catalog = JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json', import.meta.url), 'utf8'));
const field = catalog.groups.flatMap((group) => group.fields ?? []).find((item) => item.key === 'frontOpening');
const OPTIONS = field.options.map((option) => option.id);
const FRAME = { white: '#f4f4f0', black: '#303432' };
const count = (svg, pattern) => (svg.match(new RegExp(pattern, 'g')) || []).length;
const EXPECTED = {
  none: { profile: 'none', leaves: 0, bars: false, frame: 'black' },
  'french-black': { profile: 'french', leaves: 2, bars: false, frame: 'black' },
  'french-white': { profile: 'french', leaves: 2, bars: false, frame: 'white' },
  'french-bars-black': { profile: 'french', leaves: 2, bars: true, frame: 'black' },
  'french-bars-white': { profile: 'french', leaves: 2, bars: true, frame: 'white' },
  'sliding-2-black': { profile: 'sliding', leaves: 2, bars: false, frame: 'black' },
  'sliding-2-white': { profile: 'sliding', leaves: 2, bars: false, frame: 'white' },
  'sliding-4-black': { profile: 'sliding', leaves: 4, bars: false, frame: 'black' },
  'sliding-4-white': { profile: 'sliding', leaves: 4, bars: false, frame: 'white' },
  'folding-black': { profile: 'folding', leaves: 5, bars: false, frame: 'black' },
  'folding-white': { profile: 'folding', leaves: 5, bars: false, frame: 'white' },
};

test('the catalogue ships exactly the option ids the icons know about', () => {
  assert.deepEqual([...OPTIONS].sort(), Object.keys(EXPECTED).sort());
});

test('every catalogue option renders an svg tagged with profile, leaf count, roedes and frame colour', () => {
  for (const id of OPTIONS) {
    const svg = openingIcon(id), expected = EXPECTED[id];
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${id} is a single svg`);
    assert.match(svg, /class="opening-swatch opening-icon"/, `${id} keeps the sizing class`);
    assert.match(svg, /viewBox="0 0 120 84"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.match(svg, new RegExp(`data-profile="${expected.profile}"`), `${id} profile`);
    assert.match(svg, new RegExp(`data-leaves="${expected.leaves}"`), `${id} leaves`);
    assert.match(svg, new RegExp(`data-bars="${expected.bars}"`), `${id} bars`);
    assert.match(svg, new RegExp(`data-frame="${expected.frame}"`), `${id} frame colour`);
    assert.equal(count(svg, 'data-part="glass"'), expected.leaves, `${id} draws one glass pane per section`);
    assert.doesNotMatch(svg, /<text/, `${id} has no text inside the svg`);
    assert.ok(svg.includes(`fill="${FRAME[expected.frame]}"`), `${id} uses the ${expected.frame} frame colour`);
    assert.ok(!svg.includes(`fill="${FRAME[expected.frame === 'white' ? 'black' : 'white']}"`), `${id} never mixes in the other frame colour`);
    assert.equal(count(svg, 'data-part="frame" data-role="outer"'), 4, `${id}: head, sill and two jambs`);
    if (expected.profile !== 'none') {
      assert.ok(count(svg, 'data-part="rooster"') === expected.leaves, `${id}: every section shows its ventilation strip`);
      assert.doesNotMatch(svg, /data-skeleton-opening/, `${id} is a fitted kozijn, not a skeleton`);
    }
  }
});

test('"geen kozijn" is the skeleton opening: a real aperture with only its anthracite outer frame', () => {
  // The customer fits their own frame later, so the icon must agree with the scene (geometry.js `opening.skeleton`):
  // an open hole with sill, head and jambs built — never a closed wall, and never a pane of glass.
  const svg = openingIcon('none');
  assert.match(svg, /data-profile="none"/);
  assert.match(svg, /data-leaves="0"/);
  assert.match(svg, /data-skeleton-opening="true"/, 'tagged like the plan and elevation svgs in geometry.js');
  assert.ok(svg.includes(`fill="${FRAME.black}"`), 'the outer frame is anthracite, as the scene builds it');
  assert.ok(count(svg, 'data-part="void"') >= 1, 'the room shows through the aperture');
  assert.doesNotMatch(svg, /data-part="(glass|header|handle|hinge|track|bar|rooster|post|swing|slide|fold)"/, 'no glazing, no hardware, no opening symbol');
  assert.ok(!svg.includes('#cfe3ec'), 'no glass colour anywhere');
  assert.match(svg, /data-part="sill"/, 'the aperture keeps a threshold');
  assert.match(svg, /data-part="wall"/, 'and it is a hole in a wall, not a floating frame');
});

test('the skeleton aperture is the 2-leaf schuifpui rough opening, not a hole of its own size', () => {
  // geometry.js gives 'none' and 'sliding-2' the same 320 cm span, so the two icons must show the same aperture.
  assert.equal(parseOpening('none').pier, parseOpening('sliding-2-black').pier);
  assert.equal(parseOpening('none').skeleton, true);
  assert.equal(parseOpening('sliding-2-black').skeleton, false);
  const outerX = (id) => [...openingIcon(id).matchAll(/<polygon points="([^"]+)"[^>]*data-part="frame" data-role="outer"/g)]
    .flatMap((match) => match[1].split(' ').map((pair) => Number(pair.split(',')[0])));
  const span = (id) => { const xs = outerX(id); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(Math.abs(span('none') - span('sliding-2-black')) < 0.01, 'same outer frame span as the 2-leaf schuifpui');
  assert.ok(span('none') > span('french-white'), 'and wider than the openslaande deuren');
});

test('each leaf is drawn with the symbol that says how it opens', () => {
  const roles = (svg) => [...svg.matchAll(/data-part="glass" data-role="([a-z]+)"/g)].map((match) => match[1]);
  for (const colour of ['white', 'black']) {
    assert.deepEqual(roles(openingIcon(`french-${colour}`)), ['hinged', 'hinged']);
    assert.deepEqual(roles(openingIcon(`sliding-2-${colour}`)), ['fixed', 'sliding']);
    assert.deepEqual(roles(openingIcon(`sliding-4-${colour}`)), ['fixed', 'sliding', 'sliding', 'fixed']);
    assert.deepEqual(roles(openingIcon(`folding-${colour}`)), ['folding', 'folding', 'folding', 'folding', 'door']);

    // Hinged leaves: one swing triangle each, pointing at its own hinge stile, and a handle pair in the middle.
    const french = openingIcon(`french-${colour}`);
    assert.equal(count(french, 'data-part="swing"'), 2, 'one swing symbol per leaf');
    assert.equal(count(french, 'data-part="handle"'), 2, 'a handle on each meeting stile');
    assert.equal(count(french, 'data-part="slide"') + count(french, 'data-part="fold"'), 0, 'hinged leaves never slide or fold');
    assert.equal(count(openingIcon(`french-bars-${colour}`), 'data-part="bar"'), 8, 'four roedes per leaf');
    assert.equal(count(french, 'data-part="bar"'), 0, 'and none without them');

    // Sliding leaves: an arrow per leaf (shaft plus head) and a pull handle; fixed panes get neither.
    for (const [id, sliding] of [[`sliding-2-${colour}`, 1], [`sliding-4-${colour}`, 2]]) {
      const svg = openingIcon(id);
      assert.equal(count(svg, 'data-part="slide"'), sliding * 2, `${id}: a shaft and a head per sliding leaf`);
      assert.equal(count(svg, 'data-part="handle"'), sliding, `${id}: one pull handle per sliding leaf`);
      assert.equal(count(svg, 'data-part="track"'), 2, `${id}: the tracks it runs on`);
      assert.equal(count(svg, 'data-part="swing"'), 0, `${id}: nothing swings`);
    }

    // The harmonicapui folds, and its traffic door swings on its own post.
    const folding = openingIcon(`folding-${colour}`);
    assert.equal(count(folding, 'data-part="fold"'), 4, 'a concertina symbol on every folding leaf');
    assert.equal(count(folding, 'data-part="swing"'), 1, 'and a swing on the traffic door');
    assert.equal(count(folding, 'data-part="handle"'), 1, 'which is the only leaf with a handle');
    assert.match(folding, /data-part="post"/, 'the traffic door is a separate unit');
    assert.equal(count(folding, 'data-part="track"'), 1, 'under one continuous top track');
  }
});

test('the drawing is straight on: every shape is axis aligned, so nothing reads as a perspective view', () => {
  // The old icons were 30° axonometric. A front elevation has only horizontal and vertical edges — which is also
  // what makes the opening symbols (the only diagonals in the drawing) carry all the meaning.
  for (const id of OPTIONS) {
    for (const [, points] of openingIcon(id).matchAll(/<polygon points="([^"]+)"/g)) {
      const corners = points.split(' ').map((pair) => pair.split(',').map(Number));
      for (let i = 0; i < corners.length; i++) {
        const [x1, y1] = corners[i], [x2, y2] = corners[(i + 1) % corners.length];
        assert.ok(Math.abs(x1 - x2) < 1e-9 || Math.abs(y1 - y2) < 1e-9, `${id}: ${x1},${y1} → ${x2},${y2} is not axis aligned`);
      }
    }
  }
});

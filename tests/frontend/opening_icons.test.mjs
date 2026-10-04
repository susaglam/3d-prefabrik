import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openingIcon, parseOpening } from '../../addons/cs_prefab_configurator/static/src/opening_icons.js';

/**
 * 2.16.0: the icons are front elevations with opening symbols, not isometric drawings of a wall section — the
 * customer could not tell the products apart at 120 px and nothing said which way anything opened. What this file
 * pins is what a buyer has to be able to read off the icon: which product it is, how many sections it has, whether
 * it carries roedes, what colour the frame is, and — the point of the redraw — how each leaf opens.
 *
 * 2.17.0, the owner with the reference renders of every product (kozijn/*.png): "tıkladığımız ikonlar doğru olmalı;
 * olmayacak her yere havalandırma koymuşsun; kapı kollarını kendin uydurmuşsun; openslaande deur orijinalinde farklı".
 * The icons now draw the one section layout the 3D and the drawings read (geometry.js openingLayout), so the grilles,
 * the handles and the opening directions below are the reference's, not the icon's own.
 */
const catalog = JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json', import.meta.url), 'utf8'));
const field = catalog.groups.flatMap((group) => group.fields ?? []).find((item) => item.key === 'frontOpening');
const OPTIONS = field.options.map((option) => option.id);
const FRAME = { white: '#f4f4f0', black: '#303432' };
const count = (svg, pattern) => (svg.match(new RegExp(pattern, 'g')) || []).length;
const EXPECTED = {
  none: { profile: 'none', leaves: 0, bars: false, frame: 'black' },
  'french-black': { profile: 'french', leaves: 4, bars: false, frame: 'black' },
  'french-white': { profile: 'french', leaves: 4, bars: false, frame: 'white' },
  'french-bars-black': { profile: 'french', leaves: 4, bars: true, frame: 'black' },
  'french-bars-white': { profile: 'french', leaves: 4, bars: true, frame: 'white' },
  'sliding-2-black': { profile: 'sliding', leaves: 2, bars: false, frame: 'black' },
  'sliding-2-white': { profile: 'sliding', leaves: 2, bars: false, frame: 'white' },
  'sliding-4-black': { profile: 'sliding', leaves: 4, bars: false, frame: 'black' },
  'sliding-4-white': { profile: 'sliding', leaves: 4, bars: false, frame: 'white' },
  'folding-black': { profile: 'folding', leaves: 5, bars: false, frame: 'black' },
  'folding-white': { profile: 'folding', leaves: 5, bars: false, frame: 'white' },
};
const roles = (svg) => [...svg.matchAll(/data-part="glass" data-role="([a-z]+)"/g)].map((match) => match[1]);
/** The x centre of every part tagged `part`, in viewBox units. */
const centres = (svg, part) => [...svg.matchAll(new RegExp(`<polygon points="([^"]+)"[^>]*data-part="${part}"`, 'g'))]
  .map((match) => { const xs = match[1].split(' ').map((pair) => Number(pair.split(',')[0])); return (Math.min(...xs) + Math.max(...xs)) / 2; });
/** Left and right edge of every glass pane, in drawing order. */
const panes = (svg) => [...svg.matchAll(/<polygon points="([^"]+)"[^>]*data-part="glass"/g)]
  .map((match) => { const xs = match[1].split(' ').map((pair) => Number(pair.split(',')[0])); return [Math.min(...xs), Math.max(...xs)]; });

test('the catalogue ships exactly the option ids the icons know about', () => {
  assert.deepEqual([...OPTIONS].sort(), Object.keys(EXPECTED).sort());
});

test('every catalogue option renders an svg tagged with profile, section count, roedes and frame colour', () => {
  for (const id of OPTIONS) {
    const svg = openingIcon(id), expected = EXPECTED[id];
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${id} is a single svg`);
    assert.match(svg, /class="opening-swatch opening-icon"/, `${id} keeps the sizing class`);
    assert.match(svg, /viewBox="0 0 120 84"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.match(svg, new RegExp(`data-profile="${expected.profile}"`), `${id} profile`);
    assert.match(svg, new RegExp(`data-leaves="${expected.leaves}"`), `${id} sections`);
    assert.match(svg, new RegExp(`data-bars="${expected.bars}"`), `${id} bars`);
    assert.match(svg, new RegExp(`data-frame="${expected.frame}"`), `${id} frame colour`);
    assert.equal(count(svg, 'data-part="glass"'), expected.leaves, `${id} draws one glass pane per section`);
    assert.doesNotMatch(svg, /<text/, `${id} has no text inside the svg`);
    assert.ok(svg.includes(`fill="${FRAME[expected.frame]}"`), `${id} uses the ${expected.frame} frame colour`);
    assert.ok(!svg.includes(`fill="${FRAME[expected.frame === 'white' ? 'black' : 'white']}"`), `${id} never mixes in the other frame colour`);
    assert.equal(count(svg, 'data-part="frame" data-role="outer"'), 4, `${id}: head, sill and two jambs`);
    if (expected.profile !== 'none') assert.doesNotMatch(svg, /data-skeleton-opening/, `${id} is a fitted kozijn, not a skeleton`);
    // Nothing the references do not show: no tracks in front of the leaves, no separate post, no hinge barrels.
    assert.doesNotMatch(svg, /data-part="(track|post|hinge)"/, `${id}: no invented hardware`);
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

test('the aperture follows the product span: geen kozijn as the 2-leaf schuifpui, openslaande deuren as wide as a 4-delige', () => {
  // geometry.js gives 'none' and 'sliding-2' the same 320 cm span and french, sliding-4 and folding 440 cm.
  assert.equal(parseOpening('none').pier, parseOpening('sliding-2-black').pier);
  assert.equal(parseOpening('none').skeleton, true);
  assert.equal(parseOpening('sliding-2-black').skeleton, false);
  const outerX = (id) => [...openingIcon(id).matchAll(/<polygon points="([^"]+)"[^>]*data-part="frame" data-role="outer"/g)]
    .flatMap((match) => match[1].split(' ').map((pair) => Number(pair.split(',')[0])));
  const span = (id) => { const xs = outerX(id); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(Math.abs(span('none') - span('sliding-2-black')) < 0.01, 'same outer frame span as the 2-leaf schuifpui');
  assert.ok(Math.abs(span('french-white') - span('sliding-4-white')) < 0.01, 'openslaande deuren span what a 4-delige spans');
  assert.ok(span('french-white') > span('sliding-2-white'), 'wider than the 2-delige');
});

test('each section is drawn with the role, grille, handle and opening symbol of the reference', () => {
  for (const colour of ['white', 'black']) {
    // Openslaande deuren: two side lights, two doors; the swing triangles point at the hinges (left door left, right
    // door right); ONE deurkruk, on the meeting stile of the right-hand door; grilles on the side lights only.
    const french = openingIcon(`french-${colour}`);
    assert.deepEqual(roles(french), ['fixed', 'door', 'door', 'fixed']);
    assert.equal(count(french, 'data-part="swing"'), 2, 'one swing symbol per door');
    assert.deepEqual([...french.matchAll(/data-part="swing" data-hinge="(\w+)"/g)].map((match) => match[1]), ['left', 'right']);
    assert.equal(count(french, 'data-part="handle" data-handle="lever"'), 1, 'one deurkruk');
    assert.equal(count(french, 'data-part="handle" data-handle="pull"'), 0, 'no flush pull on a swing door');
    const [door, active] = panes(french).slice(1, 3), [lever] = centres(french, 'handle');
    assert.ok(lever > door[1] && lever < active[0] + 4, 'the deurkruk sits on the meeting stile of the right-hand door');
    assert.equal(count(french, 'data-part="rooster"'), 2, 'grilles on the two side lights');
    assert.equal(count(french, 'data-part="slide"') + count(french, 'data-part="fold"'), 0, 'doors never slide or fold');
    assert.equal(count(openingIcon(`french-bars-${colour}`), 'data-part="bar"'), 3 * 4, 'three roedes per pane, as on the reference');
    assert.equal(count(french, 'data-part="bar"'), 0, 'and none without them');

    // Schuifpuien: an arrow per sliding leaf toward where it parks (behind the fixed pane), a small flush pull on
    // the stile the reference has it on, grilles on the fixed panes only.
    const two = openingIcon(`sliding-2-${colour}`);
    assert.deepEqual(roles(two), ['sliding', 'fixed'], 'the sliding leaf is the LEFT one');
    assert.equal(count(two, 'data-part="slide"'), 2, 'a shaft and a head');
    const [leaf] = panes(two), [pull] = centres(two, 'handle');
    assert.ok(pull < leaf[0], 'the pull is on the free (left) stile, at the jamb');
    assert.equal(count(two, 'data-part="rooster"'), 1, 'one grille, on the fixed pane');
    const four = openingIcon(`sliding-4-${colour}`);
    assert.deepEqual(roles(four), ['fixed', 'sliding', 'sliding', 'fixed']);
    assert.equal(count(four, 'data-part="slide"'), 4);
    assert.equal(count(four, 'data-part="rooster"'), 2, 'grilles on the fixed panes, none on the sliding leaves');
    const pulls = centres(four, 'handle'), [, left, right] = panes(four);
    assert.equal(pulls.length, 2);
    assert.ok(pulls.every((x) => x > left[1] && x < right[0]), 'both pulls on the centre stiles');
    for (const svg of [two, four]) {
      assert.equal(count(svg, 'data-part="handle" data-handle="pull"'), count(svg, 'data-part="handle"'), 'pulls, never a lever');
      assert.equal(count(svg, 'data-part="swing"'), 0, 'nothing swings');
    }
    // Each sliding leaf's arrow points away from its pull — the way it opens (left leaf of four: left; right: right).
    const heads = [...four.matchAll(/<polyline points="([^"]+)"[^>]*data-part="slide" data-head="(\w+)"/g)].map((match) => match[2]);
    assert.deepEqual(heads, ['left', 'right']);

    // Harmonicapui: four folding leaves and a loopdeur; only the loopdeur swings and has the grille; two flush pulls
    // where the door meets the folding set.
    const folding = openingIcon(`folding-${colour}`);
    assert.deepEqual(roles(folding), ['folding', 'folding', 'folding', 'folding', 'door']);
    assert.equal(count(folding, 'data-part="fold"'), 4, 'a concertina symbol on every folding leaf');
    assert.equal(count(folding, 'data-part="swing"'), 1, 'and a swing on the loopdeur');
    assert.equal(count(folding, 'data-part="rooster"'), 1, 'the grille on the loopdeur only');
    assert.equal(count(folding, 'data-part="handle" data-handle="pull"'), 2, 'two flush pulls');
    assert.equal(count(folding, 'data-part="handle" data-handle="lever"'), 0, 'no deurkruk on a harmonicapui');
  }
});

test('the profiles carry the reference weight: sash stiles broader than the outer jamb', () => {
  // The owner: "çerçeve kalınlıkları örnek resimlere benzemiyor, daha ince duruyor". On every reference a sash stile
  // (87-100 mm) is broader than the outer jamb (52-78 mm); the icon keeps that order and never draws a hairline.
  for (const id of ['sliding-2-white', 'french-white', 'folding-white']) {
    const svg = openingIcon(id);
    const width = (pattern) => [...svg.matchAll(new RegExp(`<polygon points="([^"]+)"[^>]*${pattern}`, 'g'))]
      .map((match) => { const xs = match[1].split(' ').map((pair) => Number(pair.split(',')[0])); return Math.max(...xs) - Math.min(...xs); });
    const jamb = Math.min(...width('data-part="frame" data-role="outer"'));
    const stiles = width('data-part="stile"');
    assert.ok(stiles.length >= 2, `${id}: stiles drawn`);
    assert.ok(stiles.every((w) => w > jamb && w >= 2.6), `${id}: stiles ${stiles.map((w) => w.toFixed(1))} against a ${jamb.toFixed(1)} jamb`);
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

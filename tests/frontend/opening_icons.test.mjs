import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openingIcon, parseOpening } from '../../addons/cs_prefab_configurator/static/src/opening_icons.js';

const catalog = JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json', import.meta.url), 'utf8'));
const field = catalog.groups.flatMap((group) => group.fields ?? []).find((item) => item.key === 'frontOpening');
const OPTIONS = field.options.map((option) => option.id);
const FRAME = { white: '#f4f4f0', black: '#303432' };
const count = (svg, pattern) => (svg.match(new RegExp(pattern, 'g')) || []).length;
/** What every catalogue id must render: profile, glazed sections, roedes and frame colour. */
const EXPECTED = {
  // "Geen kozijn" is the skeleton opening, and the scene builds its outer frame in anthracite (#303432).
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
    assert.ok(count(svg, 'data-part="frame"') > 0, `${id} draws an outer frame`);
    if (expected.profile !== 'none') {
      assert.match(svg, /data-part="header"/, `${id} shows the flat header panel above the doors`);
      assert.ok(count(svg, 'data-part="rooster"') >= 1, `${id} shows a ventilation strip`);
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
  assert.equal(count(svg, 'data-part="frame" data-role="outer"'), 4, 'head, sill and two jambs, nothing inside them');
  assert.ok(svg.includes(`fill="${FRAME.black}"`), 'the outer frame is anthracite, as the scene builds it');
  assert.ok(count(svg, 'data-part="void"') >= 1, 'the room shows through the aperture');
  assert.doesNotMatch(svg, /data-part="(glass|header|handle|hinge|track|bar|rooster|post)"/, 'no glazing and no hardware');
  assert.ok(!svg.includes('#cfe3ec'), 'no glass colour anywhere');
  assert.ok(count(svg, 'data-part="wall"') >= 3, 'wall top, end face and piers are drawn');
  assert.match(svg, /data-part="sill"/, 'the aperture keeps a threshold');
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

test('each product has its own layout: leaf roles, handles, hinges, tracks and roedes', () => {
  const roles = (svg) => [...svg.matchAll(/data-part="glass" data-role="([a-z]+)"/g)].map((match) => match[1]);
  for (const colour of ['white', 'black']) {
    assert.deepEqual(roles(openingIcon(`french-${colour}`)), ['hinged', 'hinged']);
    assert.deepEqual(roles(openingIcon(`sliding-2-${colour}`)), ['fixed', 'sliding']);
    assert.deepEqual(roles(openingIcon(`sliding-4-${colour}`)), ['fixed', 'sliding', 'sliding', 'fixed']);
    assert.deepEqual(roles(openingIcon(`folding-${colour}`)), ['folding', 'folding', 'folding', 'folding', 'door']);
    // french: a handle pair at the meeting stiles, three hinges per leaf; bars only on the roedes variant
    assert.equal(count(openingIcon(`french-${colour}`), 'data-part="handle"') / 3, 2);
    assert.equal(count(openingIcon(`french-${colour}`), 'data-part="hinge"') / 3, 6);
    assert.equal(count(openingIcon(`french-${colour}`), 'data-part="bar"'), 0);
    assert.equal(count(openingIcon(`french-bars-${colour}`), 'data-part="bar"'), 8, 'four roedes per leaf');
    // sliding: pull handle per sliding leaf, tracks top and bottom, no hinges
    assert.equal(count(openingIcon(`sliding-2-${colour}`), 'data-part="handle"') / 3, 1);
    assert.equal(count(openingIcon(`sliding-4-${colour}`), 'data-part="handle"') / 3, 2);
    for (const n of [2, 4]) {
      assert.equal(count(openingIcon(`sliding-${n}-${colour}`), 'data-part="track"') / 3, 2);
      assert.equal(count(openingIcon(`sliding-${n}-${colour}`), 'data-part="hinge"'), 0);
    }
    // folding: hinges between the leaves and on the traffic door, one lever on the door, a top track
    const folding = openingIcon(`folding-${colour}`);
    assert.equal(count(folding, 'data-part="handle"') / 3, 1);
    assert.equal(count(folding, 'data-part="hinge"') / 3, 4 * 2 + 3);
    assert.equal(count(folding, 'data-part="track"') / 3, 1);
    assert.match(folding, /data-part="post"/, 'the traffic door is a separate unit');
  }
});

test('unknown ids fall back to the skeleton opening without throwing', () => {
  for (const id of ['', undefined, null, 42, 'french', 'french-red', 'sliding-3-black', 'folding-bars-white', 'FRENCH-WHITE', {}]) {
    let svg;
    assert.doesNotThrow(() => { svg = openingIcon(id); }, `id ${String(id)}`);
    assert.match(svg, /data-profile="none"/, `id ${String(id)}`);
    assert.equal(count(svg, 'data-part="glass"'), 0);
    assert.equal(parseOpening(id).profile, 'none');
  }
  assert.equal(openingIcon('french-red'), openingIcon('none'));
});

test('output is deterministic and honours the requested size', () => {
  for (const id of OPTIONS) assert.equal(openingIcon(id), openingIcon(id), id);
  assert.match(openingIcon('sliding-2-black'), /width="120" height="84"/);
  assert.match(openingIcon('sliding-2-black', { width: 240, height: 168 }), /width="240" height="168"/);
  assert.match(openingIcon('sliding-2-black', { width: 'bogus', height: -5 }), /width="120" height="84"/);
});

test('sliding leaves stand proud of the fixed panes and the opening grows with the product', () => {
  const glassX = (svg, role) => [...svg.matchAll(new RegExp(`<polygon points="([^"]+)"[^>]*data-part="glass" data-role="${role}"`, 'g'))]
    .map((match) => match[1].split(' ').map((pair) => Number(pair.split(',')[0])));
  const [fixedPane] = glassX(openingIcon('sliding-2-white'), 'fixed');
  const [sliding] = glassX(openingIcon('sliding-2-white'), 'sliding');
  assert.ok(Math.max(...sliding) > Math.max(...fixedPane), 'sliding leaf is to the right of the fixed pane');
  const span = (id) => { const xs = glassX(openingIcon(id), '[a-z]+').flat(); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(span('french-white') < span('sliding-2-white') && span('sliding-2-white') < span('sliding-4-white'), 'wider products get wider openings');
  assert.ok(Math.abs(span('sliding-4-white') - span('folding-white')) < 1, 'four-part sliding and folding share the widest opening');
});

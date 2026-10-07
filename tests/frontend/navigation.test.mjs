/**
 * The cursor: the footer's primary button walks the visitor to their next CHOICE and only becomes "verder naar
 * <stap>" once no choice of the step is left unseen. Every row of the design's state table is pinned here against
 * the REAL steps and the REAL catalogue labels, not against a copy — STEP_SECTIONS and STEP_LEAD_KEYS moved into
 * sections.js precisely so this file can assert the strings a visitor actually reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STEPS, fieldsOf, normalizedDraft, fieldIsVisible} from '../../addons/cs_prefab_configurator/static/src/model.js';
import {STEP_SECTIONS, STEP_LEAD_KEYS, stepChoiceKeys, nextChoice, remainingChoices, choiceDestination, nextGroupId} from '../../addons/cs_prefab_configurator/static/src/sections.js';

const catalog = JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json', import.meta.url)));
const fields = fieldsOf(catalog);
const defaults = () => normalizedDraft(catalog.defaults, catalog);

/** app.js's choiceVisible(): a dimension is always a choice, a catalogue field only while fieldIsVisible() says so. */
const visible = config => key => (catalog.dimensions[key] ? true : !!fields[key] && fieldIsVisible(key, config, fields));
const label = key => catalog.dimensions[key]?.label || fields[key]?.label || key;
const sectionsOf = (config, index) => STEP_SECTIONS[index].filter(section => section.keys.some(visible(config)));
const keysOf = (config, index) => stepChoiceKeys(sectionsOf(config, index), STEP_LEAD_KEYS[index], visible(config));

/** app.js's footerAction(), with the DOM left out: the label, the data-action and the footer-note count. */
function footerAction(config, index, seen, openId) {
  if (index === STEPS.length - 1) return {action: 'contact', label: 'Persoonlijk voorstel maken', remaining: 0};
  const keys = keysOf(config, index), key = nextChoice(keys, seen);
  if (key === null) return {action: 'next', label: 'Verder naar ' + STEPS[index + 1].short.toLowerCase(), remaining: 0};
  const destination = choiceDestination(key, sectionsOf(config, index), openId, label);
  return {action: 'goto-choice', key, kind: destination.kind, target: destination.id, label: 'Naar ' + destination.label, remaining: remainingChoices(keys, seen)};
}
function footerNote(action, index) {
  if (index === STEPS.length - 1) return 'Met je contactgegevens · geen bestelling of betaling';
  if (action.action === 'goto-choice') return 'Nog ' + action.remaining + ' keuze' + (action.remaining === 1 ? '' : 's') + ' in deze stap';
  return 'Je ontwerp wordt automatisch op dit apparaat bewaard';
}

test('a step lists its lead fields first, then its sections in document order, and hides what fieldIsVisible hides', () => {
  const config = defaults();
  const step0 = keysOf(config, 0);
  assert.deepEqual(step0.slice(0, 5), ['width', 'depth', 'facade', 'rollaag', 'openingMaterial']);
  assert.equal(step0[0], 'width', 'the maten come before the first section card');
  assert.ok(step0.indexOf('facade') < step0.indexOf('rooflight'), 'Gevel & voorpui precedes Dak & daglicht');
  assert.ok(step0.indexOf('rooflight') < step0.indexOf('outsideLight'), 'Dak & daglicht precedes Voorzieningen buiten');
  // Conditional fields are absent until the choice that reveals them is made.
  assert.ok(!step0.includes('roofShade'), 'zonwering is hidden without a lessenaar-daklicht');
  assert.ok(!step0.includes('overhangSpots'), 'overstekspots are hidden without an overstek');
  assert.deepEqual(keysOf(config, 1), ['interior'], 'with "Aanbouw binnen" off the step has exactly one choice');
  // 2.18.0: the building site's postcode opens step 3 — the kilometervergoeding is priced from it.
  assert.deepEqual(keysOf(config, 2), ['postcode', 'demolition', 'access', 'piles']);
  assert.deepEqual(keysOf(config, 3), [], 'the review step has no choices at all');
});

test('the interior step opens up the moment "Aanbouw binnen" is chosen', () => {
  const keys = keysOf({...defaults(), interior: true}, 1);
  assert.deepEqual(keys, ['interior', 'plaster', 'screed', 'underfloorHeating', 'heating', 'ceilingPositions', 'spotPositions', 'socketPositions', 'switches']);
  assert.ok(!keys.includes('painting'), 'schilderwerk stays hidden until stucwerk is chosen');
  assert.ok(!keys.includes('ceilingLightControl'), 'bediening stays hidden while the count is zero');
  assert.ok(!keys.includes('ceilingLights'), 'the count field yields to the position grid that drives it');
  assert.equal(keys.length, 9, 'nine choices behind one gate — the whole reason this step is skipped today');
});

test('STATE 1 — an unseen choice inside the OPEN card: the button names the field and targets the field', () => {
  // Since 2.16.0 a card IS a choice, so this state only arises on the two cards that hold one decision in two
  // fields. Kozijn is the one the customer named: the material and the door set, together.
  const config = defaults(), seen = new Set(['width', 'depth', 'facade', 'rollaag', 'openingMaterial']);
  const action = footerAction(config, 0, seen, 'kozijn');
  assert.equal(action.label, 'Naar Kozijn');
  assert.equal(action.action, 'goto-choice');
  assert.equal(action.kind, 'field');
  assert.equal(action.target, 'frontOpening');
});

test('STATE 2 — an unseen choice in a CLOSED card: the button names the card and targets the card', () => {
  const config = defaults(), seen = new Set(['width', 'depth', 'facade', 'rollaag', 'openingMaterial', 'frontOpening']);
  const action = footerAction(config, 0, seen, 'kozijn');
  assert.equal(action.label, 'Naar Daklicht', 'the card header is the landmark — and now it carries the choice name');
  assert.equal(action.kind, 'section');
  assert.equal(action.target, 'daglicht');
  assert.equal(action.key, 'rooflight', 'the cursor is still the field; only the destination is the header');
  // The same cursor, once that card is the open one, becomes the field itself.
  assert.deepEqual(
    (a => [a.label, a.kind, a.target])(footerAction(config, 0, seen, 'daglicht')),
    ['Naar Daklicht', 'field', 'rooflight'],
  );
});

test('STATE 3 — nothing unseen left: the button reverts to today\'s step text, character for character', () => {
  const config = defaults();
  assert.equal(footerAction(config, 0, new Set(keysOf(config, 0)), 'regenpijp').label, 'Verder naar binnen');
  assert.equal(footerAction(config, 0, new Set(keysOf(config, 0)), 'regenpijp').action, 'next');
  assert.equal(footerAction(config, 1, new Set(keysOf(config, 1)), null).label, 'Verder naar situatie');
  assert.equal(footerAction(config, 2, new Set(keysOf(config, 2)), 'heipalen').label, 'Verder naar voorstel');
});

test('STATE 4 — step 1 with the interior gate off has one choice, so the footer behaves exactly as it does today', () => {
  const config = defaults();
  assert.equal(footerAction(config, 1, new Set(), null).label, 'Naar Aanbouw binnen');
  assert.equal(footerAction(config, 1, new Set(['interior']), null).label, 'Verder naar situatie');
  assert.equal(footerAction(config, 1, new Set(['interior']), null).action, 'next');
});

test('STATE 5/6/7 — the review step is untouched: the cursor is permanently null there', () => {
  const config = defaults();
  for (const seen of [new Set(), new Set(['width'])]) {
    const action = footerAction(config, 3, seen, null);
    assert.equal(action.action, 'contact');
    assert.equal(action.label, 'Persoonlijk voorstel maken');
    assert.equal(action.key, undefined, 'no choice can arm the cursor on a step with no fields');
  }
});

test('STATE 8 — a choice the visitor reveals is genuinely new, so the cursor re-arms for exactly one press', () => {
  const config = {...defaults(), interior: true};
  const seen = new Set(keysOf(config, 1));
  assert.equal(footerAction(config, 1, seen, 'stucwerk').action, 'next', 'retired');
  // Choosing stucwerk reveals "Schilderwerk" — a field that has never been on screen.
  const revealed = {...config, plaster: true};
  const action = footerAction(revealed, 1, seen, 'stucwerk');
  assert.equal(action.label, 'Naar Schilderwerk');
  assert.equal(action.key, 'painting');
  // One press and it retires again — this is not a loop.
  seen.add('painting');
  assert.equal(footerAction(revealed, 1, seen, 'stucwerk').action, 'next');
});

test('STATE 8 — an overstek reveals its spots, and a spot count reveals its bediening, one press each', () => {
  const config = {...defaults(), overhang: 'full'};
  const seen = new Set(keysOf(defaults(), 0));
  assert.equal(footerAction(config, 0, seen, 'overstek').key, 'overhangSpots');
  seen.add('overhangSpots');
  assert.equal(footerAction(config, 0, seen, 'overstek').action, 'next', 'a count of zero reveals no bediening');
  const withSpots = {...config, overhangSpots: 2};
  assert.equal(footerAction(withSpots, 0, seen, 'overstek').key, 'overhangSpotControl');
  seen.add('overhangSpotControl');
  assert.equal(footerAction(withSpots, 0, seen, 'overstek').action, 'next');
});

test('STATE 9 — going back to change an answer cannot trap the visitor, because seen is never un-set', () => {
  const config = defaults();
  const seen = new Set(keysOf(config, 0));
  assert.equal(footerAction(config, 0, seen, 'regenpijp').action, 'next');
  // Scroll back, re-open the first card, change the facade, change the rollaag: all already seen.
  for (const key of ['facade', 'rollaag', 'frontOpening']) {
    seen.add(key); // what changeConfig() does — add, never delete
    assert.equal(footerAction(config, 0, seen, 'facade').action, 'next', 're-visiting ' + key + ' must not re-arm the cursor');
    assert.equal(footerAction(config, 0, seen, 'facade').label, 'Verder naar binnen');
  }
  assert.equal(remainingChoices(keysOf(config, 0), seen), 0);
});

test('STATE 10 — jumping ahead leaves the skipped choice armed, and the label points backwards honestly', () => {
  const config = defaults();
  const keys = keysOf(config, 0);
  // The visitor taps the last section and works through it, never having read the rollaag.
  const seen = new Set(keys.filter(key => key !== 'rollaag'));
  const action = footerAction(config, 0, seen, 'regenpijp');
  assert.equal(action.label, 'Naar Rollaag', 'a backward jump names its destination, so no arrow is needed');
  assert.equal(action.kind, 'section');
  assert.equal(action.target, 'rollaag');
  assert.equal(action.remaining, 1);
});

test('STATES 11/12/13 — the footer note counts CHOICES while armed and returns to the storage line when it retires', () => {
  const config = defaults();
  const keys = keysOf(config, 0);
  assert.equal(footerNote(footerAction(config, 0, new Set(), 'facade'), 0), 'Nog ' + keys.length + ' keuzes in deze stap');
  const oneLeft = new Set(keys.slice(0, -1));
  assert.equal(footerNote(footerAction(config, 0, oneLeft, 'regenpijp'), 0), 'Nog 1 keuze in deze stap', 'singular, one press ahead of retirement');
  assert.equal(footerNote(footerAction(config, 0, new Set(keys), 'regenpijp'), 0), 'Je ontwerp wordt automatisch op dit apparaat bewaard');
  assert.equal(footerNote(footerAction(config, 3, new Set(), null), 3), 'Met je contactgegevens · geen bestelling of betaling');
});

test('the count falls by exactly one per press and reaches zero on the same press the button retires', () => {
  const config = defaults();
  const keys = keysOf(config, 0), seen = new Set();
  let presses = 0;
  for (let action = footerAction(config, 0, seen, 'facade'); action.action === 'goto-choice'; action = footerAction(config, 0, seen, 'facade')) {
    assert.equal(action.remaining, keys.length - presses);
    seen.add(action.key); // arriving marks the destination seen
    presses++;
    assert.ok(presses <= keys.length, 'the walk must terminate');
  }
  assert.equal(presses, keys.length, 'every choice of the step was visited exactly once');
  assert.equal(remainingChoices(keys, seen), 0);
});

test('every label fits the "Naar <naam>" form and stays short enough for one line in the button', () => {
  // Measured: the primary button has 297px of label room at 390px and 273px at 360px; the widest destination
  // ("Naar Vloerverwarming voorbereiden") renders at 209px. Nothing here may grow past that worst case.
  const widest = 'Naar Vloerverwarming voorbereiden';
  const config = {...defaults(), interior: true, plaster: true, rooflight: 'lean-2', overhang: 'full'};
  for (const index of [0, 1, 2]) {
    for (const key of keysOf(config, index)) {
      for (const openId of [null, ...sectionsOf(config, index).map(section => section.id)]) {
        const text = 'Naar ' + choiceDestination(key, sectionsOf(config, index), openId, label).label;
        assert.match(text, /^Naar \S/, key);
        assert.ok(text.length <= widest.length, text + ' is wider than the measured worst case');
      }
    }
  }
});

test('nextChoice and remainingChoices agree, and both are null-safe on an exhausted or empty step', () => {
  assert.equal(nextChoice([], new Set()), null);
  assert.equal(nextChoice(['a', 'b'], new Set(['a', 'b'])), null);
  assert.equal(nextChoice(['a', 'b'], new Set(['a'])), 'b');
  assert.equal(remainingChoices([], new Set()), 0);
  assert.equal(remainingChoices(['a', 'b', 'c'], new Set(['b'])), 2);
  assert.equal(stepChoiceKeys(null, null).length, 0);
  assert.deepEqual(stepChoiceKeys([{keys: ['a', 'b']}], ['lead'], key => key !== 'a'), ['lead', 'b']);
});

test('a choice that belongs to no section is always reached as a field', () => {
  const sections = STEP_SECTIONS[0];
  assert.deepEqual(choiceDestination('width', sections, 'facade', label), {kind: 'field', id: 'width', label: 'Breedte'});
  assert.deepEqual(choiceDestination('interior', STEP_SECTIONS[1], 'stucwerk', label), {kind: 'field', id: 'interior', label: 'Aanbouw binnen'});
});

test('one card per choice, in the order the visitor answers them', () => {
  // 2.16.0: "kullanıcı her seferinde tek seçenek görsün". Every card carries one decision, except the two that
  // hold one decision in two fields — Kozijn (material + door set) and anything with its own positions/bediening.
  const ids = STEP_SECTIONS[0].map(section => section.id);
  assert.deepEqual(ids, ['facade', 'rollaag', 'kozijn', 'daglicht', 'daktrim', 'overstek', 'buitenlicht', 'buitenstopcontact', 'buitenkraan', 'regenpijp']);
  assert.equal(nextGroupId(ids, 'facade'), 'rollaag');
  assert.equal(nextGroupId(ids, 'regenpijp'), null);
  const singles = STEP_SECTIONS.flat().filter(section => section.keys.length === 1).length;
  assert.ok(singles >= 10, 'most cards are a single question');
  assert.deepEqual(STEP_SECTIONS[0].find(section => section.id === 'kozijn').keys, ['openingMaterial', 'frontOpening']);
});

test('the step sections still cover every field the step claims, so no choice can fall through the cursor', () => {
  for (const [index, step] of STEPS.entries()) {
    const covered = new Set([...STEP_LEAD_KEYS[index], ...STEP_SECTIONS[index].flatMap(section => section.keys)]);
    for (const key of step.fields) assert.ok(covered.has(key), 'step ' + index + ' field ' + key + ' reaches no section or lead list');
  }
});

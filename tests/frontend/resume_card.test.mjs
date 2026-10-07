/**
 * The resume card (docs/resume-card-contract.md, agreed with the customer 2026-09-21, built in 2.18.0): the
 * configurator WRITES one flat card per product under one key; the website's "Je ontwerp staat klaar" bar READS only
 * that. Both halves are tested here against the contract's own rules, and against each other: the same key, the same
 * field names. The reader is a plain site script (no module), so it is loaded the way a browser would run it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {RESUME_KEY, RESUME_PRODUCT, resumeCard, putResumeCard, dropResumeCard} from '../../addons/cs_prefab_configurator/static/src/model.js';

const source = readFileSync(new URL('../../addons/cs_prefab_website/static/src/js/resume_bar.js', import.meta.url), 'utf8');
const sandbox = {Intl, Date, JSON, Math, Number, Object, String, Array, isFinite, parseFloat};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const bar = sandbox.csResumeBar;

const DAY = 864e5, NOW = Date.parse('2026-10-07T12:00:00Z');
const card = (overrides = {}) => ({label: 'Aanbouw', url: '/prefab', total: 7557000, revision: 'odoo-1-1-16-abc', savedAt: new Date(NOW - DAY).toISOString(), ...overrides});
const pick = (cards, options = {}) => bar.pick(cards, {now: NOW, path: '/', revision: 'odoo-1-1-16-abc', dismissed: {}, ...options});

/** A localStorage stand-in. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), data};
}

test('both halves use the one key and the one product name of the contract', () => {
  assert.equal(RESUME_KEY, 'cs-resume-v1');
  assert.equal(bar.KEY, RESUME_KEY, 'the reader reads exactly what the writer writes');
  assert.equal(RESUME_PRODUCT, 'aanbouw');
});

test('the writer: a card only for a design the visitor changed, flat, and never with personal data', () => {
  assert.equal(resumeCard({changed: false, total: 100, revision: 'r', url: '/prefab', savedAt: '2026-10-07T00:00:00.000Z'}), null,
    'an untouched default design is an invitation to nothing');
  const written = resumeCard({changed: true, total: 7557000, revision: 'odoo-1', url: '/prefab', savedAt: '2026-10-07T00:00:00.000Z'});
  assert.deepEqual(Object.keys(written).sort(), ['label', 'revision', 'savedAt', 'total', 'url'], 'exactly the contract fields');
  assert.equal(written.label, 'Aanbouw');
  assert.equal(resumeCard({changed: true, total: undefined, revision: 'odoo-1', url: '/prefab', savedAt: 'x'}).total, undefined, 'an unknown price is omitted');
  assert.equal(resumeCard({changed: true, total: 0, revision: 'odoo-1', url: '/prefab', savedAt: 'x'}).total, undefined);
  assert.ok(!JSON.stringify(written).match(/postcode|email|name/i), 'no personal data in a card');
});

test('the writer keeps other products and removes only its own card', () => {
  const storage = memoryStorage({[RESUME_KEY]: JSON.stringify({dakkapel: card({label: 'Dakkapel'})})});
  putResumeCard(storage, RESUME_PRODUCT, card());
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(RESUME_KEY))).sort(), ['aanbouw', 'dakkapel']);
  dropResumeCard(storage, RESUME_PRODUCT);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(RESUME_KEY))), ['dakkapel']);
  dropResumeCard(storage, 'dakkapel');
  assert.equal(storage.getItem(RESUME_KEY), null, 'no empty object left behind');
  // A broken store never breaks the configurator.
  const broken = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {}};
  assert.doesNotThrow(() => putResumeCard(broken, RESUME_PRODUCT, card()));
  assert.doesNotThrow(() => dropResumeCard(broken, RESUME_PRODUCT));
  const garbage = memoryStorage({[RESUME_KEY]: '{not json'});
  putResumeCard(garbage, RESUME_PRODUCT, card());
  assert.deepEqual(Object.keys(JSON.parse(garbage.getItem(RESUME_KEY))), ['aanbouw'], 'an unreadable store is replaced, not crashed on');
});

test('the reader: the most recent card wins, and the price shows only on the catalogue it was priced on', () => {
  const older = card({label: 'Dakkapel', url: '/dakkapel', savedAt: new Date(NOW - 3 * DAY).toISOString()});
  const choice = pick({dakkapel: older, aanbouw: card()});
  assert.equal(choice.product, 'aanbouw');
  assert.equal(choice.showPrice, true);
  assert.equal(bar.priceText(choice.card.total), '€ 75.570', 'the visitor\'s own total, whole euros');
  assert.equal(pick({aanbouw: card()}, {revision: 'odoo-1-1-17-new'}).showPrice, false, 'a moved catalogue shows the label alone');
  assert.equal(pick({aanbouw: card({total: undefined})}).showPrice, false);
});

test('the reader: no bar on the configurator itself, after 30 days, or for 7 days after the ×', () => {
  assert.equal(pick({aanbouw: card()}, {path: '/prefab'}), null, 'never on the page the card points at');
  assert.equal(pick({aanbouw: card({savedAt: new Date(NOW - 31 * DAY).toISOString()})}), null, 'stale after 30 days');
  assert.ok(pick({aanbouw: card({savedAt: new Date(NOW - 29 * DAY).toISOString()})}));
  const dismissedYesterday = {aanbouw: new Date(NOW - DAY / 2).toISOString()};
  assert.equal(pick({aanbouw: card({savedAt: new Date(NOW - DAY).toISOString()})}, {dismissed: dismissedYesterday}), null, 'the × holds');
  assert.ok(pick({aanbouw: card({savedAt: new Date(NOW - DAY).toISOString()})}, {dismissed: {aanbouw: new Date(NOW - 8 * DAY).toISOString()}}), 'for 7 days');
  assert.ok(pick({aanbouw: card({savedAt: new Date(NOW - 60e3).toISOString()})}, {dismissed: dismissedYesterday}), 'a fresh save clears the dismissal');
  assert.ok(pick({dakkapel: card({label: 'Dakkapel', url: '/dakkapel'})}, {dismissed: dismissedYesterday}), 'dismissing the aanbouw does not silence a dakkapel');
});

test('the reader: anything unreadable means no bar, silently', () => {
  for (const cards of [null, undefined, 'x', 42, [], {aanbouw: null}, {aanbouw: 'x'}, {aanbouw: card({label: ''})}, {aanbouw: card({url: 'https://evil.example/'})},
    {aanbouw: card({url: '//evil.example/'})}, {aanbouw: card({savedAt: 'not a date'})}, {aanbouw: card({label: 'x'.repeat(200)})}]) {
    assert.equal(pick(cards), null, JSON.stringify(cards));
  }
  // (Object.keys, not deepEqual: the reader runs in its own vm realm, so its {} has another Object prototype.)
  assert.equal(Object.keys(bar.read({getItem: () => '{broken'}, bar.KEY)).length, 0, 'bad JSON reads as no cards');
  assert.equal(Object.keys(bar.read({getItem() { throw new Error('blocked'); }}, bar.KEY)).length, 0, 'a blocked store reads as no cards');
  assert.equal(Object.keys(bar.read({getItem: () => '[1,2]'}, bar.KEY)).length, 0, 'an array is not a set of cards');
  assert.ok(pick({aanbouw: card({extra: 'ignored'})}), 'unknown fields are ignored, not fatal');
});

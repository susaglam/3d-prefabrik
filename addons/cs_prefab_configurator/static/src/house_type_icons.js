/**
 * Small front-elevation drawings of the three house types in the "Woning en tuin" dialog.
 *
 * The choice used to be three text buttons ("Rijwoning / Twee-onder-een-kap / Vrijstaand"), which asks the
 * visitor to translate a word into a picture before they can answer. These are the picture: the same option
 * tiles the form uses, with your own house drawn in ink and the neighbours — the thing the three types really
 * differ in — drawn lighter beside it.
 *
 *  - `terraced` : an unbroken row; your house is the middle bay and the row continues left and right.
 *  - `semi`     : one neighbour on the left under a shared ridge, a side garden with a fence on the right.
 *  - `detached` : your house standing free, a fence and a tree on both sides.
 *
 * Pure function of the id: no randomness, no DOM. The palette matches the rooflight and opening icons so the
 * three icon families read as one drawing style.
 */

const VIEW = {width: 112, height: 64};
const GROUND = 52;

const COLOR = {
  ownWall: '#f7f7f3', ownLine: '#5f6e6a', ownRoof: '#c3c8c0',
  otherWall: '#eceee7', otherLine: '#a9b2aa', otherRoof: '#d8dbd4',
  glass: '#cfe3ec', ground: '#98a29a', fence: '#b2b9b0', leaf: '#cbd8c2',
};

const round = value => Math.round(value * 100) / 100;
const points = list => list.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');

const EAVE = 27;

/** One house front: the wall with its window, and a door on the house that is yours. */
function wall(x0, x1, own, {door = own} = {}) {
  const line = own ? COLOR.ownLine : COLOR.otherLine;
  const width = x1 - x0, middle = x0 + width / 2, strokeWidth = own ? 1.6 : 1.2;
  const face = `<rect x="${round(x0)}" y="${EAVE}" width="${round(width)}" height="${GROUND - EAVE}" fill="${own ? COLOR.ownWall : COLOR.otherWall}" stroke="${line}" stroke-width="${strokeWidth}"/>`;
  const glass = `<rect x="${round(middle - width * 0.2)}" y="${EAVE + 4}" width="${round(width * 0.4)}" height="7" fill="${COLOR.glass}" stroke="${line}" stroke-width="1"/>`;
  const entry = door ? `<rect x="${round(middle - 3.5)}" y="${GROUND - 11}" width="7" height="11" fill="${COLOR.glass}" stroke="${line}" stroke-width="1"/>` : '';
  return face + glass + entry;
}

/** A stretch of roof. The row and the pair share ONE roof across the party wall — that is what the type means. */
function roof(shape, own) {
  const line = own ? COLOR.ownLine : COLOR.otherLine;
  return `<polygon points="${points(shape)}" fill="${own ? COLOR.ownRoof : COLOR.otherRoof}" stroke="${line}" stroke-width="${own ? 1.6 : 1.2}" stroke-linejoin="round"/>`;
}

/** A garden strip: two fence rails between two posts, so "zijtuin" is visible and not only implied. */
function fence(x0, x1) {
  const top = GROUND - 13;
  return `<path d="M${round(x0)} ${top}h${round(x1 - x0)}M${round(x0)} ${top + 5}h${round(x1 - x0)}M${round(x0 + 1)} ${top - 2}v15M${round(x1 - 1)} ${top - 2}v15" stroke="${COLOR.fence}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
}

/** A shrub in the garden — the same cue the "Woning en tuin" toolbar icon uses. */
function shrub(x) {
  return `<path d="M${round(x)} ${GROUND}v-6" stroke="${COLOR.ground}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="${round(x)}" cy="${GROUND - 9.5}" r="5" fill="${COLOR.leaf}" stroke="${COLOR.ground}" stroke-width="1.2"/>`;
}

const ground = `<path d="M2 ${GROUND}h108" stroke="${COLOR.ground}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`;

const DRAWINGS = {
  // Your house is the middle bay of an unbroken row: one roof across the party walls, neighbours running off frame.
  terraced: () =>
    roof([[-6, EAVE], [0, 16], [32, 16], [32, EAVE]], false) + roof([[80, EAVE], [80, 16], [112, 16], [118, EAVE]], false) +
    roof([[32, EAVE], [32, 16], [80, 16], [80, EAVE]], true) +
    wall(-6, 32, false, {door: false}) + wall(80, 118, false, {door: false}) + wall(32, 80, true),
  // Two halves under one cap: the ridge sits over the party wall. A side garden with a fence on the free side.
  semi: () =>
    roof([[3, EAVE], [48, 13], [48, EAVE]], false) + roof([[48, 13], [93, EAVE], [48, EAVE]], true) +
    wall(6, 48, false, {door: false}) + wall(48, 90, true) + fence(94, 110) + shrub(101),
  // Free on both sides: fences and garden left and right, no neighbour touching the house.
  detached: () =>
    fence(4, 26) + fence(86, 108) + roof([[31, EAVE], [56, 13], [81, EAVE]], true) + wall(34, 78, true) + shrub(18) + shrub(96),
};

/**
 * Render the house-type drawing for an id from HOUSE_TYPES.
 *
 * @param {string} id  'terraced' | 'semi' | 'detached' (unknown -> 'terraced')
 * @returns {string} inline SVG markup, decorative (the option tile carries the readable label)
 */
export function houseTypeIcon(id) {
  const draw = DRAWINGS[id] || DRAWINGS.terraced;
  return `<svg class="house-type-icon" viewBox="0 0 ${VIEW.width} ${VIEW.height}" width="${VIEW.width}" height="${VIEW.height}" aria-hidden="true" focusable="false" data-house-type="${DRAWINGS[id] ? id : 'terraced'}">${ground}${draw()}</svg>`;
}

/** Where the extension sits in the facade, seen from above: the facade as a band with the extension in front of it. */
const ALIGNMENT_X = {left: 3, center: 13.5, right: 24};

/**
 * Render the alignment mark for an id from ALIGNMENTS.
 *
 * @param {string} id  'left' | 'center' | 'right' (unknown -> 'center')
 * @returns {string} inline SVG markup, decorative (the chip carries the readable label)
 */
export function alignmentIcon(id) {
  const known = Object.hasOwn(ALIGNMENT_X, id), x = known ? ALIGNMENT_X[id] : ALIGNMENT_X.center;
  return `<svg class="alignment-icon" viewBox="0 0 40 17" width="40" height="17" aria-hidden="true" focusable="false" data-alignment="${known ? id : 'center'}">` +
    `<rect x="1.5" y="1.5" width="37" height="3.6" fill="${COLOR.otherRoof}" stroke="${COLOR.otherLine}" stroke-width="1"/>` +
    `<rect x="${x}" y="6.2" width="13" height="8.6" fill="${COLOR.ownRoof}" stroke="${COLOR.ownLine}" stroke-width="1.3"/></svg>`;
}

/**
 * The garden boundary for an id from FENCE_STYLES (2.12.0): two posts and what stands between them, over the same
 * ground line as the house drawings, so the three tiles in "Woning en tuin" read as one family with the house types.
 *
 * @param {string} id  'modern' | 'hedge' | 'classic' (unknown -> 'modern')
 * @returns {string} inline SVG markup, decorative (the option tile carries the readable label)
 */
const FENCES = {
  // Horizontal hardwood slats between anthracite posts, a slim cap: the customer's example.
  modern: () => {
    let out = '';
    for (let i = 0; i < 7; i++) out += `<rect x="22" y="${round(18 + i * 4.8)}" width="68" height="3.6" rx="0.6" fill="${i % 2 ? '#9a6440' : '#a8704a'}" stroke="#6d4a33" stroke-width="0.6"/>`;
    return out + `<rect x="20" y="15.5" width="72" height="2.4" fill="#3a3f42"/>` +
      `<rect x="16" y="14" width="6" height="${GROUND - 14}" fill="#2f3336"/><rect x="90" y="14" width="6" height="${GROUND - 14}" fill="#2f3336"/>`;
  },
  // A clipped green hedge: a soft block with leaf clusters on its face and top.
  hedge: () => {
    let out = `<rect x="14" y="17" width="84" height="${GROUND - 17}" rx="7" fill="#5f7f52" stroke="#44603b" stroke-width="1.2"/>`;
    const tufts = [[22, 22], [34, 19], [47, 21], [60, 18], [73, 21], [86, 19], [28, 33], [42, 30], [56, 34], [69, 31], [82, 34], [35, 43], [50, 44], [64, 42], [78, 45]];
    for (const [x, y] of tufts) out += `<circle cx="${x}" cy="${y}" r="5.4" fill="#7a9a67" opacity=".85"/>`;
    return out;
  },
  // The weathered vertical schutting of earlier releases, with its concrete posts.
  classic: () => {
    let out = '';
    for (let x = 22; x < 90; x += 5.6) out += `<rect x="${round(x)}" y="16" width="4.6" height="${GROUND - 16}" fill="#c9c2b4" stroke="#9b9486" stroke-width="0.6"/>`;
    return out + `<rect x="16" y="14" width="5" height="${GROUND - 14}" fill="#a8a59c"/><rect x="91" y="14" width="5" height="${GROUND - 14}" fill="#a8a59c"/>`;
  },
};
export function fenceIcon(id) {
  const known = Object.hasOwn(FENCES, id);
  return `<svg class="fence-icon" viewBox="0 0 ${VIEW.width} ${VIEW.height}" width="${VIEW.width}" height="${VIEW.height}" aria-hidden="true" focusable="false" data-fence="${known ? id : 'modern'}">${ground}${FENCES[known ? id : 'modern']()}</svg>`;
}

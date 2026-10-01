/**
 * Isometric rooflight icons for the catalogue "Daklicht" options.
 *
 * Every icon is a small true-isometric (30° axonometric) drawing of a flat-roof
 * section carrying the chosen rooflight: a light-grey roof slab, a white upstand
 * (kerb) and the glass bays as pale-blue quads separated by dark mullions.
 *
 *  - `lean-N`  (lessenaar): one inclined glass plane, HIGH at the house side
 *              (back, top of the icon) and LOW toward the garden (front, bottom),
 *              closed on both sides by white right-triangle panels.
 *  - `gable-N` (zadeldak): a ridge running left-right through the middle with
 *              N/2 bays on the back slope and N/2 on the front slope, closed by
 *              two triangular white gable ends.
 *  - `none`:   the bare roof with a dashed footprint where a rooflight would sit.
 *
 * World axes: x = width (left -> right), y = depth (house -> garden), z = up.
 * Faces are emitted back-to-front (painter's algorithm); every solid is convex
 * so the visible faces never overlap each other and hidden faces are skipped.
 * The output is a pure function of the option id and size: no randomness, no DOM.
 */

const VIEW = { width: 120, height: 84 };
const COS30 = Math.sqrt(3) / 2;
const SIN30 = 0.5;
/** Screen position of world origin (back-left roof corner, z = 0). */
const ORIGIN = { x: 51.5, y: 12 };

const COLOR = {
  roof: '#cfd3cc',
  roofSide: '#b9beb6',
  kerb: '#f4f4f0',
  kerbEdge: '#9aa39c',
  glass: '#cfe3ec',
  mullion: '#5f6e6a',
  shadow: '#b9beb6',
};

/** World-unit dimensions of the roof section (a slab seen from above). */
const ROOF = { width: 72, depth: 52, thickness: 5 };
/** Upstand height above the roof plane. */
const KERB_HEIGHT = 4;
/** Rooflight depth as a fraction of the roof depth (same for all profiles). */
const LIGHT_DEPTH_RATIO = 0.66;
/** Glass rise: lean = fraction of the full depth, gable = fraction of half depth. */
const LEAN_RISE_RATIO = 0.32;
const GABLE_RISE_RATIO = 0.25;
/** Shadow offset on the roof plane (world units, light from the back-left). */
const SHADOW_OFFSET = { x: 3, y: 1.5 };

const PROFILE_LIMITS = { lean: { min: 1, max: 8 }, gable: { min: 2, max: 16 } };

/**
 * Parse an option id into a profile description.
 * Anything that is not a supported `lean-N` / `gable-N` (gable must be even)
 * degrades to the `none` profile so callers never have to guard the input.
 */
export function parseRooflight(id) {
  const match = /^(lean|gable)-(\d+)$/.exec(String(id ?? ''));
  if (!match) return { profile: 'none', bays: 0, columns: 0 };
  const profile = match[1];
  const bays = Number(match[2]);
  const { min, max } = PROFILE_LIMITS[profile];
  const evenEnough = profile === 'lean' || bays % 2 === 0;
  if (bays < min || bays > max || !evenEnough) return { profile: 'none', bays: 0, columns: 0 };
  return { profile, bays, columns: profile === 'gable' ? bays / 2 : bays };
}

/** Isometric projection: world (x, y, z) -> screen (sx, sy). */
export function project([x, y, z]) {
  return [ORIGIN.x + (x - y) * COS30, ORIGIN.y + (x + y) * SIN30 - z];
}

const fixed = (value) => String(Math.round(value * 100) / 100);
const toPoints = (points) => points.map((point) => project(point).map(fixed).join(',')).join(' ');

/** A filled, stroked polygon from world-space points (any vertex count). */
export function quad(points, fill, stroke, attributes = '') {
  const extra = attributes ? ` ${attributes}` : '';
  return `<polygon points="${toPoints(points)}" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"${extra}/>`;
}

/** Rooflight width as a fraction of the roof width; grows mildly with bay columns. */
export function widthRatio(columns) {
  return Math.min(0.85, 0.36 + 0.1225 * (Math.max(1, columns) - 1));
}

/** Plan-view footprint of the rooflight, centred on the roof. */
function footprint(columns) {
  const w = ROOF.width * widthRatio(columns);
  const d = ROOF.depth * LIGHT_DEPTH_RATIO;
  const x0 = (ROOF.width - w) / 2;
  const y0 = (ROOF.depth - d) / 2;
  return { x0, x1: x0 + w, y0, y1: y0 + d, w, d };
}

/** The roof slab: two visible side faces of the slab plus the top plane. */
function roofSection() {
  const { width: W, depth: D, thickness: T } = ROOF;
  return [
    quad([[W, 0, 0], [W, D, 0], [W, D, -T], [W, 0, -T]], COLOR.roofSide, COLOR.roofSide, 'data-part="slab"'),
    quad([[0, D, 0], [W, D, 0], [W, D, -T], [0, D, -T]], COLOR.roofSide, COLOR.roofSide, 'data-part="slab"'),
    quad([[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]], COLOR.roof, COLOR.roof, 'data-part="roof"'),
  ].join('');
}

/** Soft cast shadow of the kerb on the roof plane. */
function shadow(f) {
  const { x: dx, y: dy } = SHADOW_OFFSET;
  const points = [[f.x0 + dx, f.y0 + dy, 0], [f.x1 + dx, f.y0 + dy, 0], [f.x1 + dx, f.y1 + dy, 0], [f.x0 + dx, f.y1 + dy, 0]];
  return quad(points, COLOR.shadow, 'none', 'fill-opacity="0.6" data-part="shadow"');
}

/** Front (+y) face of the kerb: a low white strip under the glass eave. */
function frontKerb(f) {
  return quad([[f.x0, f.y1, 0], [f.x1, f.y1, 0], [f.x1, f.y1, KERB_HEIGHT], [f.x0, f.y1, KERB_HEIGHT]], COLOR.kerb, COLOR.kerbEdge, 'data-part="kerb"');
}

/** Right (+x) face of the kerb box. */
function rightKerb(f) {
  return quad([[f.x1, f.y0, 0], [f.x1, f.y1, 0], [f.x1, f.y1, KERB_HEIGHT], [f.x1, f.y0, KERB_HEIGHT]], COLOR.kerb, COLOR.kerbEdge, 'data-part="kerb"');
}

/** Glass bay `index` (1-based) between the two given plan-space edges. */
function bay(index, slope, xa, xb, [yBack, zBack], [yFront, zFront]) {
  const points = [[xa, yBack, zBack], [xb, yBack, zBack], [xb, yFront, zFront], [xa, yFront, zFront]];
  return quad(points, COLOR.glass, COLOR.mullion, `data-bay="${index}" data-slope="${slope}"`);
}

/** Split the rooflight width into `columns` equal bays and render them. */
function bays(f, columns, slope, back, front, offset = 0) {
  const parts = [];
  for (let i = 0; i < columns; i += 1) {
    const xa = f.x0 + (f.w * i) / columns;
    const xb = f.x0 + (f.w * (i + 1)) / columns;
    parts.push(bay(offset + i + 1, slope, xa, xb, back, front));
  }
  return parts.join('');
}

/** Lessenaar: one plane, high at the back (house) and low at the front (garden). */
function leanLight(f, columns) {
  const low = KERB_HEIGHT;
  const high = KERB_HEIGHT + f.d * LEAN_RISE_RATIO;
  return [
    shadow(f),
    bays(f, columns, 'single', [f.y0, high], [f.y1, low]),
    frontKerb(f),
    rightKerb(f),
    // closed right-triangle side panel on the visible (+x) side
    quad([[f.x1, f.y0, low], [f.x1, f.y0, high], [f.x1, f.y1, low]], COLOR.kerb, COLOR.kerbEdge, 'data-part="side"'),
  ].join('');
}

/** Zadeldak: a left-right ridge with columns bays on each slope. */
function gableLight(f, columns) {
  const eave = KERB_HEIGHT;
  const half = f.d / 2;
  const ym = f.y0 + half;
  const ridge = KERB_HEIGHT + half * GABLE_RISE_RATIO;
  const [ra, rb] = [project([f.x0, ym, ridge]), project([f.x1, ym, ridge])].map((p) => p.map(fixed));
  return [
    shadow(f),
    bays(f, columns, 'back', [f.y0, eave], [ym, ridge]),
    // the back slope faces away from the light: a whisper of shade so the ridge reads as a fold
    quad([[f.x0, f.y0, eave], [f.x1, f.y0, eave], [f.x1, ym, ridge], [f.x0, ym, ridge]], COLOR.mullion, 'none', 'fill-opacity="0.08" data-part="shade"'),
    bays(f, columns, 'front', [ym, ridge], [f.y1, eave], columns),
    `<line x1="${ra[0]}" y1="${ra[1]}" x2="${rb[0]}" y2="${rb[1]}" stroke="${COLOR.mullion}" stroke-width="1.6" stroke-linecap="round" data-part="ridge"/>`,
    frontKerb(f),
    // closed gable end on the visible (+x) side: kerb strip plus triangle in one panel
    quad([[f.x1, f.y0, 0], [f.x1, f.y1, 0], [f.x1, f.y1, eave], [f.x1, ym, ridge], [f.x1, f.y0, eave]], COLOR.kerb, COLOR.kerbEdge, 'data-part="side"'),
  ].join('');
}

/** Bare roof with a dashed outline where a (three-bay) rooflight would sit. */
function noLight() {
  const f = footprint(3);
  const points = [[f.x0, f.y0, 0], [f.x1, f.y0, 0], [f.x1, f.y1, 0], [f.x0, f.y1, 0]];
  return quad(points, 'none', COLOR.kerbEdge, 'stroke-dasharray="3 2" data-part="placeholder"');
}

function sizeOf(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Render the rooflight icon for a catalogue option id.
 *
 * @param {string} optionId  'none', 'lean-1'..'lean-5', 'gable-2'..'gable-10' (unknown -> 'none')
 * @param {{width?: number, height?: number}} [options]  rendered size; the viewBox is always 120 x 84
 * @returns {string} inline SVG markup
 */
export function rooflightIcon(optionId, { width = VIEW.width, height = VIEW.height } = {}) {
  const { profile, bays: count, columns } = parseRooflight(optionId);
  const body = profile === 'lean' ? leanLight(footprint(columns), columns)
    : profile === 'gable' ? gableLight(footprint(columns), columns)
    : noLight();
  return `<svg class="rooflight-icon" viewBox="0 0 ${VIEW.width} ${VIEW.height}" width="${sizeOf(width, VIEW.width)}" height="${sizeOf(height, VIEW.height)}" aria-hidden="true" focusable="false" data-profile="${profile}" data-bays="${count}">${roofSection()}${body}</svg>`;
}

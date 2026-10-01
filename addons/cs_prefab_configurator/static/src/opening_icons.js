/**
 * Isometric front-opening icons for the catalogue "Kozijn" (door set) options.
 *
 * Every icon is a small true-isometric (30° axonometric) drawing of a wall section seen
 * from the garden with the chosen door set in its opening: a light-grey wall with a
 * visible top and end face, the flat header panel above the doors (as on the supplier
 * renders) and the glazing as pale-blue quads inside frames of the chosen colour. The
 * opening width grows with the product (french 2.2 m ... folding 4.4 m) so the icons also
 * carry a scale cue, like the rooflight icons do with their bay count.
 *
 *  - `french[-bars]-<colour>`  two hinged leaves meeting in the middle with a lever-handle
 *                              pair at the meeting stiles and hinges on the outer stiles;
 *                              the bars variant adds four horizontal roedes per leaf.
 *  - `sliding-2-<colour>`      one fixed pane in the frame plane and one sliding leaf that
 *                              stands proud on its own track, with a vertical pull handle.
 *  - `sliding-4-<colour>`      two fixed outer panes and two sliding centre leaves that
 *                              meet in the middle under two pull handles.
 *  - `folding-<colour>`        four equal folding leaves under a continuous top track plus
 *                              a separate traffic door at the right; drawn closed.
 *  - `none`                    "geen kozijn": the SKELETON opening, not a closed wall. The
 *                              customer fits their own frame later, so the drawing shows the
 *                              rough aperture a 2-leaf schuifpui would get at this width
 *                              (hence the shared pier, mirroring OPENING_SPAN_CM's shared 320)
 *                              with only the anthracite outer frame built: no glass, no
 *                              leaves, no hardware, and the room visible through the hole.
 *
 * World axes: x = width (left -> right), y = depth (house -> garden), z = up. The wall face
 * is the plane y = 0; the door set sits REVEAL units behind it and sliding leaves stand
 * PROUD units in front of the fixed frame. Faces are emitted back-to-front (painter's
 * algorithm); the right pier and the lintel are drawn last so they occlude the recessed
 * set. The output is a pure function of the option id and size: no randomness, no DOM.
 */

const VIEW = { width: 120, height: 84 };
const COS30 = Math.sqrt(3) / 2;
const SIN30 = 0.5;
/** Screen position of world origin (front-left wall corner at ground level). */
const ORIGIN = { x: 30.6, y: 41.5 };

const COLOR = {
  ground: '#e4e6e1', wall: '#cfd3cc', wallTop: '#e0e3dd', wallSide: '#b9beb6', reveal: '#aeb3ab',
  sill: '#7f827c', sillTop: '#9a9d97', glass: '#cfe3ec', track: '#5f6362', trackTop: '#858988',
  steel: '#c3c7c6', steelTop: '#e4e6e5', steelSide: '#8d9291', steelEdge: '#5d6362', rooster: '#2c302f',
  room: '#6f7571', roomSide: '#8a908b', roomFloor: '#9ea49f',
};
/** Grey aluminium sill of a fitted kozijn; the skeleton uses the anthracite frame tone instead. */
const SILL_TONE = { fill: COLOR.sill, top: COLOR.sillTop, edge: COLOR.sill };
/** Frame finishes keyed by the colour suffix of the option id. */
const FRAME = {
  white: { fill: '#f4f4f0', top: '#ffffff', side: '#d5d5cf', edge: '#9aa39c', header: '#e8e7e1' },
  black: { fill: '#303432', top: '#4d5250', side: '#1f2322', edge: '#181b1a', header: '#474c4b' },
};
const STEEL = { fill: COLOR.steel, top: COLOR.steelTop, side: COLOR.steelSide, edge: COLOR.steelEdge };
const TRACK = { fill: COLOR.track, top: COLOR.trackTop, side: COLOR.track, edge: COLOR.track };

/** Wall section in world units. */
const WALL = { width: 72, height: 37, thickness: 4 };
const GROUND_DEPTH = 8;
const SILL = 1;           // threshold height
const DOOR_TOP = 29;      // top of the door set
const HEADER_TOP = 34;    // top of the flat header panel; the lintel runs from here to the wall top
const REVEAL = 2;         // the set sits this far behind the wall face
const PROUD = 1;          // sliding leaves and hardware stand this far in front of the fixed frame
const OUTER = 1.2;        // fixed outer frame width

/** Leaf profile widths per product family (stile = vertical, rail = top, bottomRail = bottom). */
const PROFILES = {
  french: { stile: 1.6, rail: 1.6, bottomRail: 2.4 },
  sliding: { stile: 1.0, rail: 1.0, bottomRail: 1.4 },
  folding: { stile: 1.3, rail: 1.3, bottomRail: 1.9 },
};
/**
 * Product table. `leaves` counts every glazed section (fixed panes and the folding traffic
 * door included); `pier` is the wall left and right of the frame, so narrower products
 * get a narrower opening.
 */
const KINDS = {
  french: { profile: 'french', leaves: 2, bars: false, pier: 14 },
  'french-bars': { profile: 'french', leaves: 2, bars: true, pier: 14 },
  'sliding-2': { profile: 'sliding', leaves: 2, bars: false, pier: 7 },
  'sliding-4': { profile: 'sliding', leaves: 4, bars: false, pier: 4 },
  folding: { profile: 'folding', leaves: 5, bars: false, pier: 4 },
};
/**
 * "Geen kozijn" is a skeleton opening, so it keeps the 2-leaf schuifpui's pier — geometry.js gives both a 320 cm
 * span — and the anthracite frame the scene builds for it (`opening.frame` is #303432 whenever the id is not white).
 */
const SKELETON = { profile: 'none', leaves: 0, bars: false, pier: KINDS['sliding-2'].pier, skeleton: true };

/**
 * Parse an option id into a product description.
 * Anything that is not a known `<kind>-<white|black>` id degrades to the skeleton opening
 * so callers never have to guard the input.
 */
export function parseOpening(id) {
  const match = /^(french|french-bars|sliding-2|sliding-4|folding)-(white|black)$/.exec(String(id ?? ''));
  if (!match) return { ...SKELETON, kind: 'none', frame: 'black' };
  return { ...KINDS[match[1]], kind: match[1], frame: match[2], skeleton: false };
}

/** Isometric projection: world (x, y, z) -> screen (sx, sy). */
export function project([x, y, z]) {
  return [ORIGIN.x + (x - y) * COS30, ORIGIN.y + (x + y) * SIN30 - z];
}

const fixed = (value) => String(Math.round(value * 100) / 100);
const toPoints = (points) => points.map((point) => project(point).map(fixed).join(',')).join(' ');

/** A filled, stroked polygon from world-space points (any vertex count). */
export function quad(points, fill, stroke, attributes = '', strokeWidth = 1) {
  const extra = attributes ? ` ${attributes}` : '';
  return `<polygon points="${toPoints(points)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"${extra}/>`;
}

/** Vertical face parallel to the wall at depth `y`. */
const face = (x0, x1, z0, z1, y, fill, stroke, attributes = '', strokeWidth = 1) =>
  quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], fill, stroke, attributes, strokeWidth);

/** A box between depths y0 (back) and y1 (front): its visible top, right and front faces. */
function slab(x0, x1, z0, z1, y0, y1, tone, attributes = '', strokeWidth = 1) {
  return quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], tone.top, tone.edge, attributes, strokeWidth)
    + quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], tone.side, tone.edge, attributes, strokeWidth)
    + face(x0, x1, z0, z1, y1, tone.fill, tone.edge, attributes, strokeWidth);
}

/** Door set (outer frame) and the clear area inside it for a given pier width, in the plane y = -REVEAL. */
function layout(pier) {
  const set = { x0: pier, x1: WALL.width - pier, z0: SILL, z1: DOOR_TOP, y: -REVEAL };
  return { pier, set, clear: { x0: set.x0 + OUTER, x1: set.x1 - OUTER, z0: set.z0 + OUTER, z1: set.z1 - OUTER } };
}

/** Glass rectangle left inside a leaf once the profile widths are taken off. */
const glassOf = (x0, x1, z0, z1, p) => ({ x0: x0 + p.stile, x1: x1 - p.stile, z0: z0 + p.bottomRail, z1: z1 - p.rail });

/** One glazed section in the frame plane: leaf frame plus the inset glass. */
function section(index, role, x0, x1, z0, z1, y, frame, p) {
  const g = glassOf(x0, x1, z0, z1, p);
  return face(x0, x1, z0, z1, y, frame.fill, frame.edge, `data-part="frame" data-role="${role}" data-section="${index}"`, 0.8)
    + face(g.x0, g.x1, g.z0, g.z1, y, COLOR.glass, frame.edge, `data-part="glass" data-role="${role}" data-section="${index}"`, 0.6);
}

/** A sliding leaf standing PROUD of the frame plane: a slab with the glass on its front. */
function proudSection(index, role, x0, x1, z0, z1, y, frame, p) {
  const g = glassOf(x0, x1, z0, z1, p);
  return slab(x0, x1, z0, z1, y, y + PROUD, frame, `data-part="frame" data-role="${role}" data-section="${index}"`, 0.8)
    + face(g.x0, g.x1, g.z0, g.z1, y + PROUD, COLOR.glass, frame.edge, `data-part="glass" data-role="${role}" data-section="${index}"`, 0.6);
}

/** Four horizontal roedes dividing the glass into five lights. */
function roedes(g, y, frame, count = 4) {
  let out = '';
  for (let k = 1; k <= count; k += 1) {
    const z = g.z0 + ((g.z1 - g.z0) * k) / (count + 1);
    out += face(g.x0, g.x1, z - 0.35, z + 0.35, y, frame.fill, frame.edge, 'data-part="bar"', 0.35);
  }
  return out;
}

/** Ventilation strip (rooster): a dark dotted line just under the top rail. */
function rooster(g, y) {
  const [a, b] = [project([g.x0 + 0.6, y, g.z1 - 0.9]), project([g.x1 - 0.6, y, g.z1 - 0.9])].map((point) => point.map(fixed));
  return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${COLOR.rooster}" stroke-width=".9" stroke-dasharray="1.1 .55" data-part="rooster"/>`;
}

/** Vertical pull handle (sliding leaves) standing off the leaf plane `y`. */
const pull = (x, z, y, length = 5) =>
  slab(x - 0.35, x + 0.35, z - length / 2, z + length / 2, y, y + 0.8, STEEL, 'data-part="handle"', 0.4);
/** Lever handle on a hinged leaf, pointing away from the stile it sits on (`dir` -1 left, +1 right). */
const lever = (x, z, y, dir) =>
  slab(Math.min(x, x + dir * 2.4), Math.max(x, x + dir * 2.4), z - 0.3, z + 0.3, y, y + 0.7, STEEL, 'data-part="handle"', 0.4);
/** Hinge knuckle on a stile. */
const hinge = (x, z, y) => slab(x - 0.28, x + 0.28, z - 0.8, z + 0.8, y, y + 0.5, STEEL, 'data-part="hinge"', 0.35);
/** Bottom track: the sliding leaves sit on its front lip. */
const bottomTrack = ({ clear: c }, y, h = 0.6) => slab(c.x0, c.x1, c.z0, c.z0 + h, y, y + PROUD + 0.3, TRACK, 'data-part="track"', 0.3);
/** Top track: nearest element of the set, so callers emit it after the leaves. */
const topTrack = ({ clear: c }, y, h = 0.6) => slab(c.x0, c.x1, c.z1 - h, c.z1, y, y + PROUD + 0.3, TRACK, 'data-part="track"', 0.3);

/**
 * Ground strip, wall top and end face, then the left pier with the reveal and sill of the opening.
 * `top` is where the masonry above the opening starts: the header panel's top for a fitted kozijn,
 * the frame head for the skeleton, which carries no panel of its own.
 */
function wallSection(pier, top = HEADER_TOP, sill = SILL_TONE) {
  const { width: W, height: H, thickness: T } = WALL;
  return [
    quad([[0, 0, 0], [W, 0, 0], [W, GROUND_DEPTH, 0], [0, GROUND_DEPTH, 0]], COLOR.ground, COLOR.ground, 'data-part="ground"'),
    quad([[0, -T, H], [W, -T, H], [W, 0, H], [0, 0, H]], COLOR.wallTop, COLOR.wallSide, 'data-part="wall"'),
    quad([[W, -T, 0], [W, 0, 0], [W, 0, H], [W, -T, H]], COLOR.wallSide, COLOR.wallSide, 'data-part="wall"'),
    face(0, pier, 0, H, 0, COLOR.wall, COLOR.wallSide, 'data-part="wall"'),
    quad([[pier, -REVEAL, SILL], [pier, 0, SILL], [pier, 0, top], [pier, -REVEAL, top]], COLOR.reveal, 'none', 'data-part="reveal"'),
    face(pier, W - pier, 0, SILL, 0, sill.fill, sill.edge, 'data-part="sill"'),
    quad([[pier, -REVEAL, SILL], [W - pier, -REVEAL, SILL], [W - pier, 0, SILL], [pier, 0, SILL]], sill.top, 'none', 'data-part="sill"'),
  ].join('');
}

/** The right pier and the lintel are nearer than the recessed set: drawn last to occlude it. */
function wallFront(pier, top = HEADER_TOP) {
  const { width: W, height: H } = WALL;
  return face(W - pier, W, 0, H, 0, COLOR.wall, COLOR.wallSide, 'data-part="wall"')
    + face(pier, W - pier, top, H, 0, COLOR.wall, COLOR.wallSide, 'data-part="wall"');
}

/** How far into the room the void behind a skeleton opening is shaded. */
const ROOM_DEPTH = 7;

/**
 * "Geen kozijn": the rough aperture with only its outer frame. The room shows through the hole
 * (back plane, the visible left reveal and the threshold running inward), and the anthracite frame
 * is a ring of four profiles — head, sill and two jambs — with nothing inside it.
 */
function skeletonSet(frame, { set: s, clear: c }) {
  const back = s.y - ROOM_DEPTH;
  const ring = [[s.x0, s.x1, s.z1 - OUTER, s.z1], [s.x0, s.x1, s.z0, s.z0 + OUTER],
    [s.x0, s.x0 + OUTER, c.z0, c.z1], [s.x1 - OUTER, s.x1, c.z0, c.z1]];
  return face(c.x0, c.x1, c.z0, c.z1, back, COLOR.room, COLOR.room, 'data-part="void" data-role="room"')
    + quad([[c.x0, back, c.z0], [c.x0, s.y, c.z0], [c.x0, s.y, c.z1], [c.x0, back, c.z1]], COLOR.roomSide, 'none', 'data-part="void" data-role="reveal"')
    + quad([[c.x0, back, c.z0], [c.x1, back, c.z0], [c.x1, s.y, c.z0], [c.x0, s.y, c.z0]], COLOR.roomFloor, 'none', 'data-part="void" data-role="threshold"')
    + ring.map(([x0, x1, z0, z1]) => face(x0, x1, z0, z1, s.y, frame.fill, frame.edge, 'data-part="frame" data-role="outer"', 0.8)).join('');
}

/** Flat header panel above the doors and the fixed outer frame, both in the frame colour. */
function doorSet(frame, { set: s }) {
  return face(s.x0, s.x1, DOOR_TOP, HEADER_TOP, s.y, frame.header, frame.edge, 'data-part="header"')
    + face(s.x0, s.x1, s.z0, s.z1, s.y, frame.fill, frame.edge, 'data-part="frame" data-role="outer"');
}

/** Openslaande deuren: two hinged leaves, lever handles at the meeting stiles, hinges outside. */
function frenchSet(frame, bars, { set, clear: c }) {
  const p = PROFILES.french, y = set.y, mid = (c.x0 + c.x1) / 2, handleZ = c.z0 + (c.z1 - c.z0) * 0.45;
  return [[c.x0, mid, -1], [mid, c.x1, 1]].map(([x0, x1, side], i) => {
    const g = glassOf(x0, x1, c.z0, c.z1, p);
    return section(i, 'hinged', x0, x1, c.z0, c.z1, y, frame, p)
      + (bars ? roedes(g, y, frame) : '') + rooster(g, y)
      + [c.z0 + 3.5, (c.z0 + c.z1) / 2, c.z1 - 3.5].map((z) => hinge(side < 0 ? x0 + 0.7 : x1 - 0.7, z, y)).join('')
      + lever(mid + side * 0.8, handleZ, y, side);
  }).join('');
}

/** Schuifpui: fixed panes in the frame plane, sliding leaves proud on the outer track. */
function slidingSet(frame, leaves, L) {
  const { set, clear: c } = L, p = PROFILES.sliding, y = set.y, w = (c.x1 - c.x0) / leaves, lap = 0.9, trackH = 0.6;
  const centre = (c.x0 + c.x1) / 2, handleZ = c.z0 + (c.z1 - c.z0) * 0.5;
  let out = bottomTrack(L, y, trackH);
  for (let i = 0; i < leaves; i += 1) {
    const x0 = c.x0 + i * w, x1 = x0 + w;
    if (i === 0 || (leaves === 4 && i === 3)) {
      out += section(i, 'fixed', x0, x1, c.z0, c.z1, y, frame, p) + rooster(glassOf(x0, x1, c.z0, c.z1, p), y);
      continue;
    }
    // The leaf overlaps the neighbouring fixed pane by an interlock; its handle faces the centre.
    const lapDir = i === 2 ? 1 : -1, handleDir = (x0 + x1) / 2 < centre ? 1 : -1;
    const [lx0, lx1] = lapDir < 0 ? [x0 - lap, x1] : [x0, x1 + lap];
    out += proudSection(i, 'sliding', lx0, lx1, c.z0 + trackH, c.z1 - trackH, y, frame, p)
      + pull(handleDir > 0 ? lx1 - p.stile / 2 - 0.15 : lx0 + p.stile / 2 + 0.15, handleZ, y + PROUD);
  }
  return out + topTrack(L, y, trackH);
}

/** Harmonicapui: four folding leaves with hinge knuckles, a traffic door at the right, top track. */
function foldingSet(frame, L) {
  const { set, clear: c } = L, p = PROFILES.folding, y = set.y, trackH = 0.7, doorW = 13.6, w = (c.x1 - c.x0 - doorW) / 4;
  const z0 = c.z0, z1 = c.z1 - trackH, handleZ = z0 + (z1 - z0) * 0.45;
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    const x0 = c.x0 + i * w;
    out += section(i, 'folding', x0, x0 + w, z0, z1, y, frame, p)
      + [z0 + 4, z1 - 4].map((z) => hinge(i ? x0 : x0 + 0.7, z, y)).join('');
  }
  const dx0 = c.x1 - doorW;
  out += section(4, 'door', dx0, c.x1, z0, z1, y, frame, p) + rooster(glassOf(dx0, c.x1, z0, z1, p), y)
    + face(dx0 - 0.25, dx0 + 0.25, z0, z1, y, frame.edge, 'none', 'data-part="post"')
    + [z0 + 3.5, (z0 + z1) / 2, z1 - 3.5].map((z) => hinge(c.x1 - 0.7, z, y)).join('')
    + lever(dx0 + 0.9, handleZ, y, 1);
  return out + topTrack(L, y, trackH);
}

function sizeOf(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Render the front-opening icon for a catalogue option id.
 *
 * @param {string} optionId  'none', 'french[-bars]-<white|black>', 'sliding-<2|4>-<white|black>',
 *                           'folding-<white|black>' (unknown -> 'none')
 * @param {{width?: number, height?: number}} [options]  rendered size; the viewBox is always 120 x 84
 * @returns {string} inline SVG markup
 */
export function openingIcon(optionId, { width = VIEW.width, height = VIEW.height } = {}) {
  const { profile, leaves, bars, frame: colour, pier, skeleton } = parseOpening(optionId);
  const frame = FRAME[colour], L = layout(pier), top = skeleton ? DOOR_TOP : HEADER_TOP;
  const body = wallSection(pier, top, skeleton ? frame : SILL_TONE)
    + (skeleton ? skeletonSet(frame, L)
      : doorSet(frame, L) + (profile === 'french' ? frenchSet(frame, bars, L) : profile === 'sliding' ? slidingSet(frame, leaves, L) : foldingSet(frame, L)))
    + wallFront(pier, top);
  return `<svg class="opening-swatch opening-icon" viewBox="0 0 ${VIEW.width} ${VIEW.height}" width="${sizeOf(width, VIEW.width)}" height="${sizeOf(height, VIEW.height)}" aria-hidden="true" focusable="false" data-profile="${profile}" data-leaves="${leaves}" data-bars="${bars}" data-frame="${colour}"${skeleton ? ' data-skeleton-opening="true"' : ''}>${body}</svg>`;
}

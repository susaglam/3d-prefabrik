/**
 * Isometric scene icons for the standpoints and the camera tools (2.10.7).
 *
 * The customer (2026-09-19): the "Standpunt kiezen" popup should be prettier, "bakış açıları için de alakalı ikon
 * tasarımı … tıpkı daklicht penceresinde yaptığın ikonlar gibi", and the camera-tool icons were liked neither for their
 * meaning nor their style. So both families are drawn the way rooflight_icons.js draws the rooflights: a small true
 * isometric (30°) scene in the same soft greys, white upstands, pale-blue glass and dark mullion lines.
 *
 * Every standpoint shows the SAME little aanbouw in front of its house wall; what changes is where the viewer stands,
 * marked by one warm eye with its sight cone. So the icon answers the one question the menu asks: "from where?".
 * World axes as in rooflight_icons.js: x = width (left -> right), y = depth (house -> garden), z = up. In this
 * projection the faces at +x (right) and +y (garden) face the reader, so the drawing itself looks in from the
 * garden's right-hand side — which is also the opening standpoint since 2.10.7.
 *
 * Pure functions of the id: no randomness, no DOM; unknown ids fall back to the first entry of their family.
 */

const COS30 = Math.sqrt(3) / 2;
const SIN30 = 0.5;
const COLOR = {
  ground: '#e4e7e0', groundEdge: '#c9cec6', house: '#eceee7', houseLine: '#a9b2aa',
  wall: '#f4f4f0', wallSide: '#dfe2da', line: '#5f6e6a', roof: '#b9beb6', roofTop: '#cfd3cc',
  glass: '#cfe3ec', eye: '#c96b2c', cone: '#e8a36c', brick: '#b76a52', mortar: '#ead9cf', tree: '#b7c8a8', trunk: '#9a8a74',
};
const round = value => Math.round(value * 100) / 100;
const pts = list => list.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');

/** Iso projection for one drawing: world [x, y, z] -> screen [x, y]. */
function projector(ox, oy, scale) {
  return ([x, y, z]) => [ox + (x - y) * COS30 * scale, oy + (x + y) * SIN30 * scale - z * scale];
}
/**
 * The projector that fits `points` (every corner the drawing reaches, eyes included) into a width × height box with
 * `margin` px to spare, centred. Measured, not tuned: a hand-picked origin clipped the eyes of three standpoints.
 */
function fitProjector(points, width, height, margin) {
  const X = points.map(([x, y]) => (x - y) * COS30), Y = points.map(([x, y, z]) => (x + y) * SIN30 - z);
  const [x0, x1, y0, y1] = [Math.min(...X), Math.max(...X), Math.min(...Y), Math.max(...Y)];
  const scale = Math.min((width - 2 * margin) / (x1 - x0), (height - 2 * margin) / (y1 - y0));
  return projector(width / 2 - (x0 + x1) / 2 * scale, height / 2 - (y0 + y1) / 2 * scale, scale);
}
const poly = (P, corners, fill, stroke = COLOR.line, width = 1, extra = '') =>
  `<polygon points="${pts(corners.map(P))}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"${extra}/>`;

/** A box's three reader-facing faces (right, garden, top), painted back to front. */
function box(P, [x0, x1], [y0, y1], [z0, z1], {side = COLOR.wallSide, front = COLOR.wall, top = COLOR.roofTop, stroke = COLOR.line, width = 1, open = []} = {}) {
  let out = '';
  if (!open.includes('right')) out += poly(P, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], side, stroke, width);
  if (!open.includes('front')) out += poly(P, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], front, stroke, width);
  if (!open.includes('top')) out += poly(P, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top, stroke, width);
  return out;
}

/**
 * The aanbouw in front of its house wall, on a patch of ground. `open` removes the reader-facing walls/roof (for the
 * interior, ceiling and cutaway standpoints); the garden face carries the glass pui.
 */
function extensionScene(P, {open = [], roofLifted = 0, compact = false, lw = 1} = {}) {
  const W = [0, 34], D = [0, 22], H = 13;
  // `compact` (the camera tools, drawn at ~30 px): a tight ground patch and a low house wall without windows, so the
  // aanbouw itself stays large enough to read. `lw` thickens every line for that small size.
  const g = compact ? COMPACT_GROUND : [-8, 46, -2, 32], wallTop = compact ? 17 : 22;
  let out = poly(P, [[g[0], g[2], 0], [g[1], g[2], 0], [g[1], g[3], 0], [g[0], g[3], 0]], COLOR.ground, COLOR.groundEdge, lw);
  out += poly(P, [[g[0], -2, 0], [g[1], -2, 0], [g[1], -2, wallTop], [g[0], -2, wallTop]], COLOR.house, COLOR.houseLine, lw);   // house wall
  if (!compact) for (const x of [-2, 36]) out += poly(P, [[x, -2, 14], [x + 7, -2, 14], [x + 7, -2, 19], [x, -2, 19]], COLOR.glass, COLOR.houseLine, 0.8); // its windows
  if (open.length) {
    // Floor of the open box and its back/left walls seen from inside.
    out += poly(P, [[W[0], D[0], 0.2], [W[1], D[0], 0.2], [W[1], D[1], 0.2], [W[0], D[1], 0.2]], '#efe6d6', COLOR.line, 0.8 * lw);
    out += poly(P, [[W[0], D[0], 0], [W[0], D[1], 0], [W[0], D[1], H], [W[0], D[0], H]], COLOR.wallSide, COLOR.line, 0.8 * lw);
  }
  out += box(P, W, D, [0, H], {open, stroke: COLOR.line, width: 1.1 * lw});
  if (!open.includes('front')) {
    out += poly(P, [[W[0] + 6, D[1], 1], [W[1] - 6, D[1], 1], [W[1] - 6, D[1], H - 3], [W[0] + 6, D[1], H - 3]], COLOR.glass, COLOR.line, 0.9 * lw);
    const mid = (W[0] + W[1]) / 2;
    out += `<line x1="${round(P([mid, D[1], 1])[0])}" y1="${round(P([mid, D[1], 1])[1])}" x2="${round(P([mid, D[1], H - 3])[0])}" y2="${round(P([mid, D[1], H - 3])[1])}" stroke="${COLOR.line}" stroke-width="${0.9 * lw}"/>`;
  }
  if (!open.includes('top')) out += box(P, [W[0] - 1, W[1] + 1], [D[0], D[1] + 1], [H + roofLifted, H + 2 + roofLifted], {side: COLOR.roof, front: COLOR.roof, top: COLOR.roofTop, width: lw});
  return out;
}

/** The viewer: an eye at `from` looking at `to`, with its sight cone. `r` is the eye's radius in viewBox units. */
function eye(P, from, to, spread = 0.42, r = 4.2) {
  const [ex, ey] = P(from), [tx, ty] = P(to);
  const angle = Math.atan2(ty - ey, tx - ex), reach = Math.hypot(tx - ex, ty - ey) * 0.92;
  const a = [ex + Math.cos(angle - spread) * reach, ey + Math.sin(angle - spread) * reach];
  const b = [ex + Math.cos(angle + spread) * reach, ey + Math.sin(angle + spread) * reach];
  return `<polygon points="${pts([[ex, ey], a, b])}" fill="${COLOR.cone}" opacity=".45"/>` +
    `<circle cx="${round(ex)}" cy="${round(ey)}" r="${r}" fill="#ffffff" stroke="${COLOR.eye}" stroke-width="${round(r * 0.38)}"/>` +
    `<circle cx="${round(ex + Math.cos(angle) * r * 0.3)}" cy="${round(ey + Math.sin(angle) * r * 0.3)}" r="${round(r * 0.43)}" fill="${COLOR.eye}"/>`;
}

/** The eight corners of a world box — the input fitProjector measures. */
const corners = ([x0, x1], [y0, y1], [z0, z1]) =>
  [x0, x1].flatMap(x => [y0, y1].flatMap(y => [[x, y, z0], [x, y, z1]]));
const COMPACT_GROUND = [-3, 37, -2, 26];

const VIEW = {width: 96, height: 68};
const CENTRE = [17, 11, 7];
const EYES = {perspective: [58, 44, 16], 'perspective-left': [-14, 44, 16], front: [22, 50, 7], top: [26, 22, 46]};
// One projector for every standpoint, fitted to the scene AND all the eyes: the aanbouw keeps one size and place in
// every tile, so only the eye moves — the comparison the popup is for.
const P_VIEW = fitProjector([...corners([-8, 46], [-2, 32], [0, 22]), ...Object.values(EYES)], VIEW.width, VIEW.height, 5.5);

const STANDPOINTS = {
  perspective: () => extensionScene(P_VIEW) + eye(P_VIEW, EYES.perspective, CENTRE),              // garden, right-hand side
  'perspective-left': () => extensionScene(P_VIEW) + eye(P_VIEW, EYES['perspective-left'], CENTRE), // garden, left-hand side
  front: () => extensionScene(P_VIEW) + eye(P_VIEW, EYES.front, CENTRE),                         // square on to the pui
  top: () => extensionScene(P_VIEW) + eye(P_VIEW, EYES.top, [17, 11, 12], 0.5),                  // from above
  interior: () => extensionScene(P_VIEW, {open: ['top', 'right']}) + eye(P_VIEW, [8, 3, 7], [26, 22, 6], 0.5),
  ceiling: () => extensionScene(P_VIEW, {open: ['top', 'right', 'front']}) +
    poly(P_VIEW, [[10, 6, 15], [24, 6, 15], [24, 16, 15], [10, 16, 15]], COLOR.glass, COLOR.line, 1, ' stroke-dasharray="2 1.5"') +
    eye(P_VIEW, [17, 11, 1.5], [17, 11, 15], 0.55),
  cutaway: () => extensionScene(P_VIEW, {open: ['top', 'front']}) +
    poly(P_VIEW, [[6, 4, 0.3], [18, 4, 0.3], [18, 9, 0.3], [6, 9, 0.3]], '#c3c8c0', COLOR.line, 0.7) +          // a sofa, seen in plan
    eye(P_VIEW, [40, 40, 34], [17, 11, 2], 0.45),
  'perspective-right': () => STANDPOINTS.perspective(),
};

/**
 * The standpoint drawing for a view id (perspective, perspective-left, front, top, interior, ceiling, cutaway).
 * It names its view in data-standpoint, never data-view: the app treats every [data-view] as a standpoint BUTTON
 * (it toggles .active and aria-pressed on them, and a script's [data-view=front] must match exactly one element).
 */
export function viewpointIcon(view) {
  const known = Object.hasOwn(STANDPOINTS, view);
  return `<svg class="viewpoint-icon" viewBox="0 0 ${VIEW.width} ${VIEW.height}" width="${VIEW.width}" height="${VIEW.height}" aria-hidden="true" focusable="false" data-standpoint="${known ? view : 'perspective'}">${STANDPOINTS[known ? view : 'perspective']()}</svg>`;
}

const TOOL = {width: 40, height: 32};
const TOOL_LW = 1.45;   // lines drawn at 30 px must stay about one screen pixel wide
const SCENE = corners(COMPACT_GROUND.slice(0, 2), COMPACT_GROUND.slice(2), [0, 17]);
const fitTool = (extra = [], margin = 1.5) => fitProjector([...SCENE, ...extra], TOOL.width, TOOL.height, margin);

/** A circular arrow around (cx, cy), running clockwise from `fromDeg` to `toDeg` (screen degrees, 0 = right, y down). */
function circularArrow(cx, cy, rx, ry, fromDeg, toDeg, width) {
  const at = deg => [cx + rx * Math.cos(deg * Math.PI / 180), cy + ry * Math.sin(deg * Math.PI / 180)];
  const [s, e] = [at(fromDeg), at(toDeg)], t = toDeg * Math.PI / 180;
  const dir = [-rx * Math.sin(t), ry * Math.cos(t)], len = Math.hypot(...dir), [ux, uy] = [dir[0] / len, dir[1] / len];
  const head = width * 1.9, tip = [e[0] + ux * head, e[1] + uy * head];
  const wings = [[e[0] - uy * head * 0.9, e[1] + ux * head * 0.9], [e[0] + uy * head * 0.9, e[1] - ux * head * 0.9]];
  return `<path d="M${round(s[0])} ${round(s[1])}A${rx} ${ry} 0 1 1 ${round(e[0])} ${round(e[1])}" fill="none" stroke="${COLOR.eye}" stroke-width="${width}" stroke-linecap="round"/>` +
    `<polygon points="${pts([tip, ...wings])}" fill="${COLOR.eye}" stroke="${COLOR.eye}" stroke-width="${width * 0.5}" stroke-linejoin="round"/>`;
}

const TOOLS = {
  // Standpunt: the aanbouw and the eye beside it.
  viewpoints: () => {
    const P = fitTool([[50, 40, 16]], 4);
    return extensionScene(P, {compact: true, lw: TOOL_LW}) + eye(P, [50, 40, 16], [17, 11, 7], 0.42, 3.6);
  },
  // Woning en tuin: a gabled house behind the aanbouw with a tree in the garden.
  environment: () => {
    const P = fitProjector([...corners([-6, 44], [-14, 30], [0, 0]), ...corners([-4, 40], [-14, -2], [0, 30]), [40, 26, 16]], TOOL.width, TOOL.height, 1.5);
    let out = poly(P, [[-6, -14, 0], [44, -14, 0], [44, 30, 0], [-6, 30, 0]], COLOR.ground, COLOR.groundEdge, TOOL_LW);
    out += box(P, [-4, 40], [-14, -2], [0, 20], {side: COLOR.house, front: COLOR.house, top: COLOR.house, stroke: COLOR.houseLine, width: TOOL_LW});
    out += poly(P, [[-4, -2, 20], [40, -2, 20], [40, -8, 30], [-4, -8, 30]], '#c98a6a', COLOR.line, TOOL_LW);        // roof slope
    out += box(P, [2, 32], [-2, 18], [0, 11], {width: TOOL_LW});
    out += box(P, [1, 33], [-2, 19], [11, 13], {side: COLOR.roof, front: COLOR.roof, width: TOOL_LW});
    const [tx, ty] = P([40, 26, 11]), [bx, by] = P([40, 26, 0]);
    return out + `<line x1="${round(bx)}" y1="${round(by)}" x2="${round(tx)}" y2="${round(ty)}" stroke="${COLOR.trunk}" stroke-width="2"/><circle cx="${round(tx)}" cy="${round(ty)}" r="4.6" fill="${COLOR.tree}" stroke="${COLOR.line}" stroke-width="1.1"/>`;
  },
  // Materiaal van dichtbij: a brick swatch under a magnifying glass.
  'material-detail': () => {
    let out = `<rect x="2" y="3" width="28" height="22" rx="2" fill="${COLOR.mortar}" stroke="${COLOR.line}" stroke-width="${TOOL_LW}"/>`;
    for (const [row, shift] of [[0, 0], [1, 5.5], [2, 0], [3, 5.5]]) for (let x = 2 - shift; x < 30; x += 11) {
      const x0 = Math.max(3, x + 0.9), x1 = Math.min(29, x + 10.1);
      if (x1 > x0) out += `<rect x="${round(x0)}" y="${round(4 + row * 5.25)}" width="${round(x1 - x0)}" height="4.3" fill="${COLOR.brick}"/>`;
    }
    return out + `<circle cx="26" cy="19" r="8.5" fill="#ffffff" fill-opacity=".6" stroke="${COLOR.line}" stroke-width="2.2"/><line x1="32" y1="25" x2="37.5" y2="30.5" stroke="${COLOR.line}" stroke-width="3.2" stroke-linecap="round"/>`;
  },
  // Hulp: a soft badge with a question mark.
  process: () => `<circle cx="20" cy="16" r="13.5" fill="${COLOR.glass}" stroke="${COLOR.line}" stroke-width="${TOOL_LW}"/>` +
    `<path d="M15.6 12.2a4.5 4.5 0 1 1 6.3 4.1c-1.3.7-1.9 1.5-1.9 3" fill="none" stroke="${COLOR.line}" stroke-width="2.6" stroke-linecap="round"/><circle cx="20" cy="24" r="1.7" fill="${COLOR.line}"/>`,
  // Maatlijnen: the aanbouw with a width and a depth dimension in the eye's warm colour.
  dimensions: () => {
    const lines = [[[0, 31, 0], [34, 31, 0]], [[43, 0, 0], [43, 22, 0]]];
    const P = fitTool(lines.flat(), 2.5);
    const tick = ([x, y]) => `<circle cx="${round(x)}" cy="${round(y)}" r="1.8" fill="${COLOR.eye}"/>`;
    return extensionScene(P, {compact: true, lw: TOOL_LW}) + lines.map(([from, to]) => {
      const [a, b] = [P(from), P(to)];
      return `<line x1="${round(a[0])}" y1="${round(a[1])}" x2="${round(b[0])}" y2="${round(b[1])}" stroke="${COLOR.eye}" stroke-width="2"/>` + tick(a) + tick(b);
    }).join('');
  },
  // Dak verbergen (the roof is on): the roof slab lifting off the aanbouw — the move the button makes.
  roof: () => extensionScene(fitTool(corners([-1, 35], [0, 23], [0, 26])), {compact: true, roofLifted: 9, lw: TOOL_LW}),
  // Dak tonen (the roof is off): the open box with the roof's place drawn dashed above it.
  'roof-off': () => {
    const P = fitTool(corners([-1, 35], [0, 23], [0, 26]));
    return extensionScene(P, {compact: true, open: ['top'], lw: TOOL_LW}) +
      poly(P, [[-1, 0, 24], [35, 0, 24], [35, 23, 24], [-1, 23, 24]], 'none', COLOR.line, 1.2, ' stroke-dasharray="2.4 1.8"');
  },
  // Weergave (2.11.0, in the phone's menu): the aanbouw beside three slider knobs — the picture's own settings.
  weergave: () => {
    const P = fitProjector(SCENE, 27, TOOL.height, 1.5);
    const sliders = [29, 33, 37].map((x, i) => `<line x1="${x}" y1="6" x2="${x}" y2="26" stroke="${COLOR.houseLine}" stroke-width="1.4" stroke-linecap="round"/>` +
      `<circle cx="${x}" cy="${[11, 20, 14][i]}" r="2.3" fill="#ffffff" stroke="${COLOR.eye}" stroke-width="1.5"/>`).join('');
    return extensionScene(P, {compact: true, lw: TOOL_LW}) + sliders;
  },
  // Volledig scherm (2.11.0, in the phone's menu): the aanbouw inside four corner brackets.
  fullscreen: () => {
    const corner = d => `<path d="${d}" fill="none" stroke="${COLOR.eye}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    return extensionScene(fitProjector(SCENE, TOOL.width, TOOL.height, 7.5), {compact: true, lw: TOOL_LW}) +
      corner('M3 10V3h7') + corner('M30 3h7v7') + corner('M37 22v7h-7') + corner('M10 29H3v-7');
  },
  // Camera herstellen: the aanbouw inside a circular arrow.
  'reset-camera': () => extensionScene(fitProjector(SCENE, TOOL.width, TOOL.height, 7.5), {compact: true, lw: TOOL_LW}) +
    circularArrow(20, 16.5, 17.5, 14, -62, -118, 2),
};

/**
 * The camera-tool drawing for a data-action (viewpoints, environment, material-detail, process, dimensions,
 * reset-camera) or a roof state ('roof' while the roof is on, 'roof-off' while it is hidden).
 */
export function toolIcon(action) {
  const known = Object.hasOwn(TOOLS, action);
  return `<svg class="tool-icon" viewBox="0 0 ${TOOL.width} ${TOOL.height}" width="${TOOL.width}" height="${TOOL.height}" aria-hidden="true" focusable="false" data-tool="${known ? action : 'viewpoints'}">${TOOLS[known ? action : 'viewpoints']()}</svg>`;
}
export const TOOL_DRAWINGS = Object.freeze(Object.keys(TOOLS));
export const STANDPOINT_VIEWS = Object.freeze(Object.keys(STANDPOINTS).filter(view => view !== 'perspective-right'));

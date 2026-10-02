/**
 * Front-elevation icons for the catalogue "Kozijn" (door set) options.
 *
 * 2.16.0, the customer: "kozijn ikonlarını karşıdan gözükecek şekilde yeniden çiz, açılış yönleri de olsun". The
 * icons used to be small isometric drawings of a wall section. They read as pictures of a building rather than as a
 * choice between products: at 120 px the two leaves of an openslaande deur and the two panes of a schuifpui looked
 * the same, and nothing said which way anything opened. A window is chosen the way it is drawn on a plan — straight
 * on, with the opening symbol that belongs to it — so that is what these are now:
 *
 *  - `french[-bars]-<colour>`  two hinged leaves, each with the swing triangle that points at its hinge stile, a
 *                              handle pair at the meeting stiles; the bars variant adds four roedes per leaf.
 *  - `sliding-2-<colour>`      one fixed pane and one sliding leaf, with the arrow that shows which way it runs.
 *  - `sliding-4-<colour>`      two fixed outer panes and two sliding leaves meeting in the middle, two arrows.
 *  - `folding-<colour>`        four folding leaves drawn with the concertina zigzag, plus the traffic door at the
 *                              right with its own swing triangle.
 *  - `none`                    "geen kozijn": the rough aperture with its anthracite outer frame and nothing in it.
 *
 * Every product also carries the ventilatierooster across the head, because the scene builds one on every glazed
 * section (preview.js makeOpening) and a visitor comparing icons should see what is included.
 *
 * Geometry is in viewBox units: x to the right, y DOWN (svg), origin top-left. The drawing is a pure function of the
 * option id: no randomness, no DOM, no text inside the svg.
 */

const VIEW = { width: 120, height: 84 };
/** The drawn frame, in viewBox units: left/right margins grow with the pier, so a wider product draws wider. */
const BOX = { top: 10, bottom: 74 };
const OUTER = 3.4;        // outer frame thickness
const STILE = 2.6;        // leaf stile / rail
const ROOSTER = 5.2;      // ventilation strip under the head

const COLOR = {
  white: '#f4f4f0',
  black: '#303432',
  glass: '#cfe3ec',
  line: '#5c6670',
  void: '#2f3a3f',
  symbol: '#44515a',
  wall: '#e7e5df',
};

/**
 * Product table. `leaves` counts every glazed section (fixed panes and the folding traffic door included); `pier`
 * is the wall left and right of the frame in catalogue units, so narrower products draw a narrower opening — the
 * same cue the scene gives, where a 2-leaf schuifpui needs 320 cm and openslaande deuren 220.
 */
const KINDS = {
  french: { profile: 'french', leaves: 2, bars: false, pier: 14, roles: ['hinged', 'hinged'] },
  'french-bars': { profile: 'french', leaves: 2, bars: true, pier: 14, roles: ['hinged', 'hinged'] },
  'sliding-2': { profile: 'sliding', leaves: 2, bars: false, pier: 7, roles: ['fixed', 'sliding'] },
  'sliding-4': { profile: 'sliding', leaves: 4, bars: false, pier: 4, roles: ['fixed', 'sliding', 'sliding', 'fixed'] },
  folding: { profile: 'folding', leaves: 5, bars: false, pier: 4, roles: ['folding', 'folding', 'folding', 'folding', 'door'] },
};
/**
 * "Geen kozijn" is a skeleton opening, so it keeps the 2-leaf schuifpui's pier — geometry.js gives both a 320 cm
 * span — and the anthracite frame the scene builds for it (`opening.frame` is #303432 whenever the id is not white).
 */
const SKELETON = { profile: 'none', leaves: 0, bars: false, pier: KINDS['sliding-2'].pier, roles: [], skeleton: true };

/**
 * Parse an option id into a product description. Anything that is not a known `<kind>-<white|black>` id degrades to
 * the skeleton opening, so callers never have to guard the input.
 */
export function parseOpening(id) {
  const match = /^(french|french-bars|sliding-2|sliding-4|folding)-(white|black)$/.exec(String(id ?? ''));
  if (!match) return { ...SKELETON, kind: 'none', frame: 'black' };
  return { ...KINDS[match[1]], kind: match[1], frame: match[2], skeleton: false };
}

const fixed = (value) => String(Math.round(value * 100) / 100);
/** A filled, stroked polygon from screen-space [x, y] points. */
export function quad(points, fill, stroke, attributes = '', strokeWidth = 1) {
  const extra = attributes ? ` ${attributes}` : '';
  const list = points.map((point) => point.map(fixed).join(',')).join(' ');
  return `<polygon points="${list}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"${extra}/>`;
}
/** An axis-aligned rectangle as a polygon, so every drawn part is one shape with one contract. */
const rect = (x, y, width, height, fill, stroke, attributes = '', strokeWidth = 1) =>
  quad([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], fill, stroke, attributes, strokeWidth);
/** An open path: the opening symbols are lines, never filled. */
const path = (points, attributes, { width = 1.3, dash = '' } = {}) =>
  `<polyline points="${points.map((point) => point.map(fixed).join(',')).join(' ')}" fill="none" stroke="${COLOR.symbol}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''} ${attributes}/>`;

/** Where the outer frame stands: the pier is catalogue width, mapped to a side margin. */
function frameBox(spec) {
  const margin = 6 + spec.pier * 0.62;
  return { left: margin, right: VIEW.width - margin, top: BOX.top, bottom: BOX.bottom };
}

/** The swing symbol of a hinged leaf: a triangle from the hinge stile to the middle of the opposite edge. */
function swing(leaf, hinge) {
  const x0 = hinge === 'left' ? leaf.x : leaf.x + leaf.width;
  const x1 = hinge === 'left' ? leaf.x + leaf.width : leaf.x;
  const middle = leaf.y + leaf.height / 2;
  return path([[x0, leaf.y + 1.5], [x1, middle], [x0, leaf.y + leaf.height - 1.5]], 'data-part="swing"');
}
/** The slide symbol: an arrow along the head of the leaf, pointing the way it runs. */
function slide(leaf, direction) {
  const y = leaf.y + leaf.height / 2;
  const from = direction > 0 ? leaf.x + 3 : leaf.x + leaf.width - 3;
  const to = direction > 0 ? leaf.x + leaf.width - 3 : leaf.x + 3;
  const head = direction > 0 ? -3.4 : 3.4;
  return path([[from, y], [to, y]], 'data-part="slide"')
    + path([[to + head, y - 2.6], [to, y], [to + head, y + 2.6]], 'data-part="slide"');
}
/** The concertina symbol: a zigzag across the leaf, the way a harmonicapui folds. */
function fold(leaf) {
  const steps = 4, points = [];
  for (let i = 0; i <= steps; i++) {
    points.push([leaf.x + (leaf.width * i) / steps, leaf.y + (i % 2 ? leaf.height - 2 : 2)]);
  }
  return path(points, 'data-part="fold"');
}

/** One glazed section: the leaf frame, its pane, its roedes and its opening symbol. */
function leafParts(leaf, role, spec, frameFill) {
  const parts = [rect(leaf.x, leaf.y, leaf.width, leaf.height, frameFill, COLOR.line, `data-part="frame" data-role="leaf"`)];
  const glass = { x: leaf.x + STILE, y: leaf.y + STILE, width: leaf.width - 2 * STILE, height: leaf.height - 2 * STILE };
  parts.push(rect(glass.x, glass.y, glass.width, glass.height, COLOR.glass, COLOR.line, `data-part="glass" data-role="${role}"`, .8));
  // The rooster sits in the head of every section, as the scene builds it on both faces.
  parts.push(rect(glass.x, glass.y, glass.width, ROOSTER, frameFill, COLOR.line, 'data-part="rooster"', .8));
  if (spec.bars) {
    for (let i = 1; i <= 4; i++) {
      const y = glass.y + ROOSTER + ((glass.height - ROOSTER) * i) / 5;
      parts.push(rect(glass.x, y - .5, glass.width, 1, frameFill, COLOR.line, 'data-part="bar"', .5));
    }
  }
  return { parts, glass };
}

/**
 * The icon for one catalogue option: a front elevation of the product in its aperture, with the opening symbol of
 * each leaf. `width`/`height` only scale the svg element; the drawing itself is fixed in viewBox units.
 */
export function openingIcon(optionId, { width = VIEW.width, height = VIEW.height } = {}) {
  const spec = parseOpening(optionId);
  const frameFill = COLOR[spec.frame];
  const box = frameBox(spec);
  const inner = { x: box.left + OUTER, y: box.top + OUTER, width: box.right - box.left - 2 * OUTER, height: box.bottom - box.top - 2 * OUTER };
  const parts = [];
  // The wall the aperture sits in, so the icon reads as a hole in a facade rather than as a floating frame.
  parts.push(rect(0, BOX.top - 6, VIEW.width, VIEW.height - BOX.top + 6, COLOR.wall, 'none', 'data-part="wall"', 0));
  if (spec.skeleton) {
    parts.push(rect(inner.x, inner.y, inner.width, inner.height, COLOR.void, COLOR.line, 'data-part="void"', .8));
  } else {
    parts.push(rect(inner.x, inner.y, inner.width, inner.height, frameFill, COLOR.line, 'data-part="header"', .8));
  }
  // The outer frame: head, sill and two jambs, each its own shape (the aperture span is measured from these).
  parts.push(rect(box.left, box.top, box.right - box.left, OUTER, frameFill, COLOR.line, 'data-part="frame" data-role="outer"'));
  parts.push(rect(box.left, box.bottom - OUTER, box.right - box.left, OUTER, frameFill, COLOR.line, 'data-part="frame" data-role="outer"'));
  for (const x of [box.left, box.right - OUTER]) {
    parts.push(rect(x, box.top, OUTER, box.bottom - box.top, frameFill, COLOR.line, 'data-part="frame" data-role="outer"'));
  }
  if (spec.skeleton) {
    parts.push(rect(box.left, box.bottom - OUTER - 1.6, box.right - box.left, 1.6, COLOR.wall, COLOR.line, 'data-part="sill"', .8));
    return svg(parts, spec, { width, height, extra: ' data-skeleton-opening="true"' });
  }
  // The leaves, left to right, each the same width except the folding traffic door, which is its own unit.
  const count = spec.roles.length;
  const leafWidth = inner.width / count;
  const leaves = spec.roles.map((role, index) => ({
    role,
    x: inner.x + index * leafWidth,
    y: inner.y,
    width: leafWidth,
    height: inner.height,
  }));
  for (const [index, leaf] of leaves.entries()) {
    const { parts: leafDrawing } = leafParts(leaf, leaf.role, spec, frameFill);
    parts.push(...leafDrawing);
    if (leaf.role === 'hinged') {
      parts.push(swing(leaf, index === 0 ? 'left' : 'right'));
      // The handle sits on the meeting stile, where the two leaves come together.
      const hx = index === 0 ? leaf.x + leaf.width - STILE / 2 : leaf.x + STILE / 2;
      parts.push(rect(hx - 1, leaf.y + leaf.height / 2 - 4, 2, 8, COLOR.symbol, COLOR.symbol, 'data-part="handle"', .5));
    } else if (leaf.role === 'sliding') {
      parts.push(slide(leaf, index < count / 2 ? 1 : -1));
      const hx = index < count / 2 ? leaf.x + leaf.width - STILE / 2 : leaf.x + STILE / 2;
      parts.push(rect(hx - 1, leaf.y + leaf.height / 2 - 5, 2, 10, COLOR.symbol, COLOR.symbol, 'data-part="handle"', .5));
    } else if (leaf.role === 'folding') {
      parts.push(fold(leaf));
    } else if (leaf.role === 'door') {
      parts.push(swing(leaf, 'right'));
      parts.push(rect(leaf.x + STILE / 2 - 1, leaf.y + leaf.height / 2 - 4, 2, 8, COLOR.symbol, COLOR.symbol, 'data-part="handle"', .5));
      // The traffic door hangs on its own post, separate from the folding set beside it.
      parts.push(rect(leaf.x - .8, inner.y, 1.6, inner.height, frameFill, COLOR.line, 'data-part="post"', .6));
    }
  }
  if (spec.profile === 'sliding') {
    // The tracks the leaves run on, top and bottom of the aperture.
    parts.push(rect(inner.x, inner.y - 1.2, inner.width, 1.2, frameFill, COLOR.line, 'data-part="track"', .6));
    parts.push(rect(inner.x, inner.y + inner.height, inner.width, 1.2, frameFill, COLOR.line, 'data-part="track"', .6));
  }
  if (spec.profile === 'folding') {
    parts.push(rect(inner.x, inner.y - 1.2, inner.width, 1.2, frameFill, COLOR.line, 'data-part="track"', .6));
  }
  return svg(parts, spec, { width, height });
}

function svg(parts, spec, { width, height, extra = '' }) {
  return `<svg class="opening-swatch opening-icon" viewBox="0 0 ${VIEW.width} ${VIEW.height}" width="${width}" height="${height}" `
    + `role="presentation" aria-hidden="true" focusable="false" `
    + `data-profile="${spec.profile}" data-leaves="${spec.leaves}" data-bars="${spec.bars}" data-frame="${spec.frame}"${extra}>`
    + parts.join('') + '</svg>';
}

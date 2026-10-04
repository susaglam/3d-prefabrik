/**
 * Front-elevation icons for the catalogue "Kozijn" (door set) options.
 *
 * 2.16.0, the customer: "kozijn ikonlarını karşıdan gözükecek şekilde yeniden çiz, açılış yönleri de olsun". A window
 * is chosen the way it is drawn on a plan — straight on, with the opening symbol that belongs to it.
 *
 * 2.17.0, the owner with the reference renders of every product (kozijn/*.png): "tıkladığımız ikonlar doğru olmalı;
 * olmayacak her yere havalandırma koymuşsun; kapı kollarını kendin uydurmuşsun". The icon now draws the one section
 * layout the 3D and the drawings read (geometry.js openingLayout, at the product's own span), so what it shows is
 * the reference's, not the icon's own:
 *
 *  - `french[-bars]-<colour>`  two side lights glazed into the frame either side of two doors; each door's swing
 *                              triangle points at its hinge; one deurkruk, on the meeting stile of the right-hand door;
 *                              the bars variant has three roedes in every pane.
 *  - `sliding-2-<colour>`      the sliding leaf on the left (its flush pull on the free stile at the jamb) and a fixed
 *                              pane on the right, the arrow pointing the way the leaf parks.
 *  - `sliding-4-<colour>`      fixed panes outside, two sliding leaves with their pulls on the centre stiles, each
 *                              arrow pointing outward, toward the fixed pane it parks behind.
 *  - `folding-<colour>`        four folding leaves with the concertina zigzag and the loopdeur on the right with its
 *                              swing; two flush pulls where the door meets the folding set.
 *  - `none`                    "geen kozijn": the rough aperture with its anthracite outer frame and nothing in it.
 *
 * The ventilatierooster is drawn only where the layout has one (fixed panes and the loopdeur), and nothing the
 * references do not show is drawn at all: no tracks, no separate post, no hinge barrels. The members are drawn one by
 * one with the reference's weight: a sash stile is broader than the outer jamb.
 *
 * Geometry is in viewBox units: x to the right, y DOWN (svg), origin top-left. The drawing is a pure function of the
 * option id: no randomness, no DOM, no text inside the svg.
 */
import { OPENING_SPAN_CM, KOZIJN, openingLayout } from './geometry.js';

const VIEW = { width: 120, height: 84 };
/** The drawn frame, in viewBox units: left/right margins shrink with the product's span, so a wider product draws wider. */
const BOX = { top: 10, bottom: 74 };
/** Member sightlines in viewBox units, in the reference's order: outer frame < sash members < bottom rail. */
const OUTER = 2.4;        // outer jamb and head
const SILL = 2.6;         // the dorpel (sliding, french) or the light threshold (folding) under the frame
const STILE = 3.1;        // a sash stile
const RAIL = 2.8;         // a sash's top rail
const BOTTOM = 3.8;       // a sash's bottom rail, and the frame member under an openslaande side light
const MULLION = 2.8;      // the kozijnstijl between an openslaande side light and its door
const ROOSTER = 3.2;      // the ventilatierooster band under the top rail

const COLOR = {
  white: '#f4f4f0',
  black: '#303432',
  glass: '#cfe3ec',
  line: '#5c6670',
  void: '#2f3a3f',
  symbol: '#44515a',
  slots: '#1b1e1d',
  wall: '#e7e5df',
};

/** Product table: which layout an id draws and how to name it. `pier` maps the product's span to the side margin. */
const KINDS = {
  french: { profile: 'french', layout: 'french', bars: false },
  'french-bars': { profile: 'french', layout: 'french', bars: true },
  'sliding-2': { profile: 'sliding', layout: 'sliding-2', bars: false },
  'sliding-4': { profile: 'sliding', layout: 'sliding-4', bars: false },
  folding: { profile: 'folding', layout: 'folding', bars: false },
};
/** Wall either side of the frame, in the 2.16 icon's units: 320 cm of span draws a 7, 440 cm a 4. */
const pierFor = (layout) => 15 - OPENING_SPAN_CM[layout] / 40;
/**
 * "Geen kozijn" is a skeleton opening, so it keeps the 2-leaf schuifpui's pier — geometry.js gives both a 320 cm
 * span — and the anthracite frame the scene builds for it (`opening.frame` is #303432 whenever the id is not white).
 */
const SKELETON = { profile: 'none', layout: 'none', leaves: 0, bars: false, pier: pierFor('none'), roles: [], sections: [], skeleton: true };

/**
 * Parse an option id into a product description, its sections included. Anything that is not a known
 * `<kind>-<white|black>` id degrades to the skeleton opening, so callers never have to guard the input.
 */
export function parseOpening(id) {
  const match = /^(french|french-bars|sliding-2|sliding-4|folding)-(white|black)$/.exec(String(id ?? ''));
  if (!match) return { ...SKELETON, kind: 'none', frame: 'black' };
  const kind = KINDS[match[1]], span = OPENING_SPAN_CM[kind.layout] / 100, sections = openingLayout(kind.layout, span);
  return { ...kind, kind: match[1], frame: match[2], skeleton: false, pier: pierFor(kind.layout), span, sections,
    leaves: sections.length, roles: sections.map((section) => section.role) };
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

/** The swing symbol of a door: a triangle from the free stile's corners to the middle of the hinge stile. */
function swing(pane, hinge) {
  const atHinge = hinge === 'left' ? pane.x : pane.x + pane.width, free = hinge === 'left' ? pane.x + pane.width : pane.x;
  return path([[free, pane.y + 1.2], [atHinge, pane.y + pane.height / 2], [free, pane.y + pane.height - 1.2]], `data-part="swing" data-hinge="${hinge}"`);
}
/** The slide symbol: an arrow across the leaf, pointing the way it opens (toward the fixed pane it parks behind). */
function slide(pane, opens) {
  const y = pane.y + pane.height * .38, direction = opens === 'left' ? -1 : 1;
  const from = direction > 0 ? pane.x + 2.5 : pane.x + pane.width - 2.5, to = direction > 0 ? pane.x + pane.width - 2.5 : pane.x + 2.5;
  const head = -direction * 3.2;
  return path([[from, y], [to, y]], 'data-part="slide"')
    + path([[to + head, y - 2.4], [to, y], [to + head, y + 2.4]], `data-part="slide" data-head="${opens}"`);
}
/** The concertina symbol: a zigzag across the leaf, the way a harmonicapui folds. */
function fold(pane) {
  const steps = 4, points = [];
  for (let i = 0; i <= steps; i++) points.push([pane.x + (pane.width * i) / steps, pane.y + (i % 2 ? pane.height - 2 : 2)]);
  return path(points, 'data-part="fold"');
}
/**
 * The handle on the stile the layout names, at the reference height: the small flush pull of a schuifpui and a
 * harmonicapui, or a deurkruk — a rosette with its lever pointing to the hinge side.
 */
function handle(section, area, inner, profile) {
  const parts = [], edge = section.handle.edge === 'left' ? -1 : 1;
  const x = edge < 0 ? area.x0 + STILE / 2 : area.x1 - STILE / 2;
  const height = KOZIJN.lever.y;
  if (section.handle.type === 'pull') {
    const at = profile === 'folding' ? KOZIJN.pull.foldingY : KOZIJN.pull.y, y = inner.bottom - inner.height * at / 2.3;
    parts.push(rect(x - .9, y - 2, 1.8, 4, COLOR.symbol, COLOR.symbol, 'data-part="handle" data-handle="pull"', .4));
  } else {
    const y = inner.bottom - inner.height * height / 2.3;
    parts.push(rect(x - .7, y - 1.2, 1.4, 4, COLOR.symbol, COLOR.symbol, 'data-part="handle" data-handle="lever"', .4));
    parts.push(rect(edge < 0 ? x : x - 4.4, y - .55, 4.4, 1.1, COLOR.symbol, COLOR.symbol, 'data-part="lever-bar"', .4));
  }
  return parts;
}

/**
 * One section: its members, its pane (under the grille where it has one), its roedes and its opening symbol. A sash
 * is two stiles, a top and a bottom rail; a side light of openslaande deuren is glazed straight into the frame.
 */
function sectionParts(section, area, inner, spec, frameFill) {
  const parts = [], sash = !(spec.profile === 'french' && section.role === 'fixed');
  const member = (x, y, width, height, part) => rect(x, y, width, height, frameFill, COLOR.line, `data-part="${part}"`, .7);
  let glass;
  if (sash) {
    parts.push(member(area.x0, inner.y, STILE, inner.height, 'stile'), member(area.x1 - STILE, inner.y, STILE, inner.height, 'stile'));
    parts.push(member(area.x0 + STILE, inner.y, area.x1 - area.x0 - 2 * STILE, RAIL, 'rail'));
    parts.push(member(area.x0 + STILE, inner.bottom - BOTTOM, area.x1 - area.x0 - 2 * STILE, BOTTOM, 'rail'));
    glass = { x: area.x0 + STILE, y: inner.y + RAIL, width: area.x1 - area.x0 - 2 * STILE, height: inner.height - RAIL - BOTTOM };
  } else {
    parts.push(member(area.x0, inner.bottom - BOTTOM, area.x1 - area.x0, BOTTOM, 'rail'));
    glass = { x: area.x0 + .8, y: inner.y, width: area.x1 - area.x0 - 1.6, height: inner.height - BOTTOM };
  }
  if (section.grille) {
    parts.push(rect(glass.x, glass.y, glass.width, ROOSTER, frameFill, COLOR.line, 'data-part="rooster"', .6));
    parts.push(rect(glass.x + 1.5, glass.y + ROOSTER * .45, glass.width - 3, ROOSTER * .3, COLOR.slots, 'none', 'data-part="rooster-slots"', 0));
    glass = { ...glass, y: glass.y + ROOSTER, height: glass.height - ROOSTER };
  }
  parts.push(rect(glass.x, glass.y, glass.width, glass.height, COLOR.glass, COLOR.line, `data-part="glass" data-role="${section.role}"`, .7));
  if (spec.bars) {
    for (let i = 1; i <= KOZIJN.bars; i++) {
      const y = glass.y + (glass.height * i) / (KOZIJN.bars + 1);
      parts.push(rect(glass.x, y - .5, glass.width, 1, frameFill, COLOR.line, 'data-part="bar"', .5));
    }
  }
  if (section.role === 'door') parts.push(swing(glass, section.hinge));
  else if (section.role === 'sliding') parts.push(slide(glass, section.opens));
  else if (section.role === 'folding') parts.push(fold(glass));
  if (section.handle) parts.push(...handle(section, area, inner, spec.profile));
  return parts;
}

/**
 * The icon for one catalogue option: a front elevation of the product in its aperture, with the opening symbol of
 * each section. `width`/`height` only scale the svg element; the drawing itself is fixed in viewBox units.
 */
export function openingIcon(optionId, { width = VIEW.width, height = VIEW.height } = {}) {
  const spec = parseOpening(optionId);
  const frameFill = COLOR[spec.frame];
  const box = frameBox(spec);
  const inner = { x: box.left + OUTER, y: box.top + OUTER, width: box.right - box.left - 2 * OUTER, height: box.bottom - box.top - OUTER - SILL };
  inner.bottom = inner.y + inner.height;
  const parts = [];
  // The wall the aperture sits in, so the icon reads as a hole in a facade rather than as a floating frame.
  parts.push(rect(0, BOX.top - 6, VIEW.width, VIEW.height - BOX.top + 6, COLOR.wall, 'none', 'data-part="wall"', 0));
  if (spec.skeleton) {
    parts.push(rect(inner.x, inner.y, inner.width, inner.height, COLOR.void, COLOR.line, 'data-part="void"', .8));
  } else {
    parts.push(rect(inner.x, inner.y, inner.width, inner.height, frameFill, COLOR.line, 'data-part="header"', .8));
  }
  // The outer frame: head, sill and two jambs, each its own shape (the aperture span is measured from these). A
  // schuifpui and openslaande deuren stand on a dark dorpel, a harmonicapui on a light threshold, in both colours.
  const sill = spec.skeleton ? frameFill : spec.profile === 'folding' ? KOZIJN.folding.threshold : KOZIJN.sliding.sill;
  parts.push(rect(box.left, box.top, box.right - box.left, OUTER, frameFill, COLOR.line, 'data-part="frame" data-role="outer"'));
  parts.push(rect(box.left - 1, box.bottom - SILL, box.right - box.left + 2, SILL, sill, COLOR.line, 'data-part="frame" data-role="outer"'));
  for (const x of [box.left, box.right - OUTER]) {
    parts.push(rect(x, box.top, OUTER, box.bottom - box.top - SILL, frameFill, COLOR.line, 'data-part="frame" data-role="outer"'));
  }
  if (spec.skeleton) {
    parts.push(rect(box.left, box.bottom - SILL - 1.6, box.right - box.left, 1.6, COLOR.wall, COLOR.line, 'data-part="sill"', .8));
    return svg(parts, spec, { width, height, extra: ' data-skeleton-opening="true"' });
  }
  // Each section's area in the aperture, from the layout. Openslaande deuren put a kozijnstijl between a side light
  // and a door, and a hairline where the two doors meet.
  const toX = (metres) => inner.x + (metres / spec.span + .5) * inner.width;
  const areas = spec.sections.map((section) => ({ x0: toX(section.x - section.width / 2), x1: toX(section.x + section.width / 2) }));
  if (spec.profile === 'french') {
    spec.sections.slice(0, -1).forEach((section, index) => {
      const boundary = areas[index].x1, gap = section.role === spec.sections[index + 1].role ? .4 : MULLION;
      if (gap === MULLION) parts.push(rect(boundary - MULLION / 2, inner.y, MULLION, inner.height, frameFill, COLOR.line, 'data-part="frame" data-role="mullion"', .7));
      areas[index].x1 -= gap / 2;
      areas[index + 1].x0 += gap / 2;
    });
  }
  spec.sections.forEach((section, index) => parts.push(...sectionParts(section, areas[index], inner, spec, frameFill)));
  return svg(parts, spec, { width, height });
}

function svg(parts, spec, { width, height, extra = '' }) {
  return `<svg class="opening-swatch opening-icon" viewBox="0 0 ${VIEW.width} ${VIEW.height}" width="${width}" height="${height}" `
    + `role="presentation" aria-hidden="true" focusable="false" `
    + `data-profile="${spec.profile}" data-leaves="${spec.leaves}" data-bars="${spec.bars}" data-frame="${spec.frame}"${extra}>`
    + parts.join('') + '</svg>';
}

/**
 * Small drawings for the Weergave dialog (2.10.7): the four inrichting scenarios and the three render qualities.
 *
 * The customer (2026-09-19): the Weergave strip squeezed the preview; "diğerleri gibi bir dialogda görsel seçicilerle
 * bezenmiş olabilir". So the choices moved into a dialog like "Woning en tuin", and like that dialog they are
 * pictures, not words: a room seen from above with the furniture the scenario places, and three marks for the
 * qualities. Same palette and line weights as house_type_icons.js so the dialogs read as one drawing style.
 *
 * Pure functions of the id: no randomness, no DOM. Unknown ids fall back to the first entry.
 */

const COLOR = {
  wall: '#5f6e6a', floor: '#f7f7f3', furniture: '#c3c8c0', soft: '#d8dbd4', accent: '#cfe3ec', line: '#5f6e6a', faint: '#a9b2aa',
};
const svg = (cls, id, body, width = 112, height = 64) =>
  `<svg class="${cls}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false" data-id="${id}">${body}</svg>`;
const rect = (x, y, w, h, fill, stroke = COLOR.line, sw = 1.2, r = 1.5) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;

/** The room from above: three walls, the garden side open with the pui drawn in glass. */
const ROOM = rect(8, 6, 96, 52, COLOR.floor, COLOR.wall, 2, 1) + `<line x1="30" y1="58" x2="82" y2="58" stroke="${COLOR.accent}" stroke-width="4"/>`;

const SCENES = {
  none: () => `<path d="M40 30h32M56 22v16" stroke="${COLOR.faint}" stroke-width="1.2" stroke-dasharray="3 3"/>`,
  living: () => rect(22, 12, 40, 12, COLOR.furniture) + rect(22, 12, 40, 4, COLOR.soft, COLOR.line, 1) +       // sofa, back to the house
    rect(32, 30, 20, 9, COLOR.soft, COLOR.line, 1, 4.5) +                                                        // coffee table
    rect(70, 14, 13, 13, '#b7c3ab') + rect(76, 40, 18, 11, COLOR.soft, COLOR.line, 1),                          // armchair, dining corner
  bedroom: () => rect(36, 10, 34, 38, COLOR.floor) + rect(36, 10, 34, 5, COLOR.furniture) +                      // double bed, headboard
    rect(40, 17, 11, 6, COLOR.soft, COLOR.line, 1, 2) + rect(55, 17, 11, 6, COLOR.soft, COLOR.line, 1, 2) +       // pillows
    rect(37, 30, 32, 17, COLOR.accent, COLOR.line, 1) + rect(25, 11, 8, 7, COLOR.furniture) + rect(73, 11, 8, 7, COLOR.furniture), // duvet, bedsides
  youth: () => rect(14, 10, 18, 36, COLOR.floor) + rect(14, 10, 18, 5, COLOR.furniture) + rect(15, 24, 16, 21, COLOR.accent, COLOR.line, 1) + // single bed
    rect(72, 20, 22, 11, COLOR.furniture) + `<circle cx="83" cy="38" r="4.5" fill="#9fb2bd" stroke="${COLOR.line}" stroke-width="1"/>` +     // desk + chair
    rect(44, 8, 26, 6, COLOR.soft, COLOR.line, 1),                                                               // bookcase on the house wall
};

/**
 * The room drawing for a scenario id from environment.js SCENARIOS.
 * @param {string} id  'none' | 'living' | 'bedroom' | 'youth' (unknown -> 'none')
 */
export function scenarioIcon(id) {
  const known = Object.hasOwn(SCENES, id);
  return svg('scenario-icon', known ? id : 'none', ROOM + SCENES[known ? id : 'none']());
}

const QUALITY = {
  // A: the configurator decides — a half sharp, half light picture with the device measuring in between.
  auto: () => rect(20, 12, 72, 40, COLOR.floor, COLOR.wall, 1.6, 3) + `<path d="M56 12v40" stroke="${COLOR.faint}" stroke-width="1.2" stroke-dasharray="3 3"/>` +
    `<path d="M28 44l10-12 8 8 6-6" fill="none" stroke="${COLOR.line}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M62 44l8-9 7 6 7-6" fill="none" stroke="${COLOR.faint}" stroke-width="1.4" stroke-linejoin="round"/>`,
  // Hoog: soft contact shadow under a crisp shape and a fine texture grid.
  full: () => rect(20, 12, 72, 40, COLOR.floor, COLOR.wall, 1.6, 3) + `<ellipse cx="56" cy="44" rx="20" ry="4" fill="${COLOR.soft}"/>` +
    rect(42, 22, 28, 20, COLOR.accent, COLOR.line, 1.4, 1) + `<path d="M49 22v20M56 22v20M63 22v20M42 29h28M42 35h28" stroke="${COLOR.line}" stroke-width=".6" opacity=".6"/>`,
  // Snel: a lightning mark over a plain shape.
  compact: () => rect(20, 12, 72, 40, COLOR.floor, COLOR.wall, 1.6, 3) + rect(42, 22, 28, 20, COLOR.soft, COLOR.line, 1.2, 1) +
    `<path d="M60 16l-10 18h8l-4 16 12-20h-8l4-14z" fill="#e4b04a" stroke="${COLOR.line}" stroke-width="1.2" stroke-linejoin="round"/>`,
};

/**
 * The mark for a render quality id ('auto' | 'full' | 'compact'; unknown -> 'auto').
 */
export function qualityIcon(id) {
  const known = Object.hasOwn(QUALITY, id);
  return svg('quality-icon', known ? id : 'auto', QUALITY[known ? id : 'auto']());
}

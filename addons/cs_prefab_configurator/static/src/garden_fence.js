/**
 * The garden boundary (2.12.0): three styles, built as panels, and the rule that no panel ever hides the aanbouw.
 *
 * The customer, 2026-09-19, after 2.11.0 made the schutting switchable: "çit asla prefabriğin görüntüsünü kameradan
 * bakış açısına göre hiçbir zaman kesmeyecek şekilde gösterilebilir. hangi açıdan bakarsak o taraftaki çitin kesişen
 * blok gözükmesin. düz baktığımızda gözükebilir. ayrıca çit tasarımımız çok eski bir görünüm veriyor … modern olabilir.
 * yeşil çit de ayrı bir hava katmış". So:
 *  - every run (a side boundary, the back boundary) is split into panels of at most PANEL_MAX metres, each its own
 *    group, so one panel can step aside without the rest of the boundary going with it;
 *  - `occludingPanels` answers which panels stand between the camera and the aanbouw, by rays from the camera to 27
 *    points on the aanbouw's box: a panel any of them passes through is the "kesişen blok" and is hidden. Seen square
 *    on (Voorgevel) the side boundaries are beside the line of sight, never across it, so they stay;
 *  - the styles are the modern horizontal slat fence the customer pointed at (anthracite posts, hardwood slats), a
 *    green hedge, and the weathered schutting the configurator drew until now.
 *
 * Pure geometry: THREE objects in, THREE objects out, no scene, no DOM — so node tests can measure it.
 */
import * as THREE from '../vendor/three.module.js';
// The style list lives in environment.js (no three.js there): the Woning en tuin form needs it before the 3D loads.
import {FENCE_STYLES, DEFAULT_FENCE_STYLE} from './environment.js';

export {FENCE_STYLES, DEFAULT_FENCE_STYLE};
export const FENCE_STYLE_IDS = Object.freeze(FENCE_STYLES.map(style => style.id));
export const PANEL_MAX = 1.8;
export const FENCE_HEIGHT = 1.8;

/**
 * Split each run into equal panels of at most `max` metres. A run is {start:[x,z], end:[x,z], kind:'side'|'back'};
 * a panel carries its centre, its length along the run, its yaw (rotation about y that turns local +x along the run)
 * and whether it opens the run (it then carries the run's first post).
 */
export function fencePanels(runs, max = PANEL_MAX) {
  const panels = [];
  for (const run of runs) {
    const dx = run.end[0] - run.start[0], dz = run.end[1] - run.start[1], length = Math.hypot(dx, dz);
    if (!(length > 0.05)) continue;
    const count = Math.max(1, Math.ceil(length / max - 1e-9)), step = length / count, yaw = Math.atan2(-dz, dx);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      panels.push({kind: run.kind, index: panels.length, length: step, yaw, first: i === 0, last: i === count - 1,
        center: [run.start[0] + dx * t, run.start[1] + dz * t]});
    }
  }
  return panels;
}

/**
 * Many boxes as ONE indexed geometry — a panel is one draw call, not fourteen. Each part is {size:[w,h,d],
 * position:[x,y,z], uv?:(x,y,z,u,v)=>[u,v], color?:[r,g,b]}; `uv` rewrites the box's own uv from its local vertex
 * position, `color` fills a vertex colour (the material then sets vertexColors).
 */
export function mergedBoxes(parts, {colors = false} = {}) {
  const positions = [], normals = [], uvs = [], tints = [], indices = [];
  for (const part of parts) {
    const box = new THREE.BoxGeometry(...part.size), offset = positions.length / 3;
    const p = box.attributes.position, n = box.attributes.normal, t = box.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + part.position[0], y = p.getY(i) + part.position[1], z = p.getZ(i) + part.position[2];
      positions.push(x, y, z);
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      const [u, v] = part.uv ? part.uv(x, y, z, t.getX(i), t.getY(i), p.getX(i), p.getY(i), n.getY(i)) : [t.getX(i), t.getY(i)];
      uvs.push(u, v);
      if (colors) tints.push(...(part.color || [1, 1, 1]));
    }
    for (const index of box.index.array) indices.push(index + offset);
    box.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A tiny deterministic generator, so the same garden is drawn on every visit and in every test. */
export function seeded(seed) {
  let state = Math.max(1, Math.floor(seed)) % 2147483647;
  return () => (state = state * 16807 % 2147483647) / 2147483647;
}

/**
 * Modern: horizontal hardwood slats between anthracite posts, a slim aluminium cap on top (the customer's example).
 * The deck scan holds twelve boards per tile over 1,44 m; each slat shows ONE board of it (v band), picked
 * pseudo-randomly per slat and panel so no two neighbours repeat, with the grain running along the slat (u).
 */
// Every open gap showed the bright haze behind the fence as a white line (2,2 cm, 1 cm and 4 mm all measured in
// close-ups; with no gap at all the lines vanished, which proved the cause). So the 8 mm shadow gap stays — it is
// what makes the slats read as boards — and an anthracite backing board behind them turns it dark, as on the real thing.
export const MODERN = Object.freeze({slat: 0.11, gap: 0.008, thickness: 0.024, post: 0.08, cap: 0.03, boardsPerTile: 12, tile: 1.44, bottom: 0.06});
export function modernPanelParts(length, panelIndex) {
  const {slat, gap, thickness, post, cap, boardsPerTile, tile, bottom} = MODERN;
  const inner = Math.max(0.1, length - post), slats = [], pitch = slat + gap;
  const count = Math.floor((FENCE_HEIGHT - bottom - cap) / pitch);
  const random = seeded(7919 + panelIndex * 104729);
  for (let i = 0; i < count; i++) {
    const y = bottom + i * pitch + slat / 2, band = Math.floor(random() * boardsPerTile), shift = random();
    slats.push({size: [inner, slat, thickness], position: [post / 2, y, 0],
      // The top and bottom faces take the middle of the board: at the band's edge they sampled the scan's pale groove,
      // which the sun lit into a white line along every slat (2.12.0 close-up).
      // 8-92 % of the band, not 0-100: the scan's pale joint lies on the band edge and drew a hairline on every slat.
      uv: (x, yy, z, u, v, lx, ly, ny) => [x / tile + shift, (band + (ny ? 0.5 : 0.08 + (ly / slat + 0.5) * 0.84)) / boardsPerTile]});
  }
  const top = bottom + count * pitch;
  return {slats, posts: [{size: [post, FENCE_HEIGHT + 0.05, post], position: [-length / 2, (FENCE_HEIGHT + 0.05) / 2, 0]}],
    // The cap on top and the dark backing board 8 mm behind the slats share the anthracite material.
    cap: [{size: [length, cap, thickness + 0.012], position: [0, top + cap / 2, 0]},
      {size: [inner, top - bottom, 0.006], position: [post / 2, (top + bottom) / 2, -thickness / 2 - 0.007]}], top};
}

/**
 * Hedge: a clipped green block with leaf clusters over its faces and a slightly soft top. The block keeps the
 * silhouette honest; the clusters (low-poly, instanced, varied greens) keep it from reading as a painted box.
 */
// 2.12.0 measured on the first render: 64 large pale clusters per metre read as green crystals, not leaves. Now many
// small dark ones, softly shaded, so the block reads as a clipped haag from the garden camera.
// The faces carry a generated leaf texture (preview.js hedgeMap); the clusters only soften the top edge. Covering the
// faces with clusters would take ~1000 per metre — far too heavy for a phone — and still read as pompoms.
export const HEDGE = Object.freeze({depth: 0.55, height: 1.7, perMetre: 46});
export function hedgeLeaves(length, panelIndex) {
  const random = seeded(4271 + panelIndex * 7717), count = Math.round(length * HEDGE.perMetre), leaves = [];
  for (let i = 0; i < count; i++) {
    const x = (random() - 0.5) * length, face = random();
    // 40 % on each long face, 20 % on top; a cluster sits half inside the block so the surface reads as foliage.
    // 60 % on the top, 20 % along each upper edge: they break the straight silhouette the texture cannot.
    let y, z;
    if (face < 0.6) { y = HEDGE.height - 0.02; z = (random() - 0.5) * HEDGE.depth * 0.9; }
    else { y = HEDGE.height - 0.02 - random() * 0.14; z = (face < 0.8 ? 1 : -1) * HEDGE.depth / 2; }
    const size = 0.06 + random() * 0.05;
    leaves.push({position: [x, y, z], scale: size, hue: 0.27 + random() * 0.05, light: 0.2 + random() * 0.12});
  }
  return leaves;
}

/**
 * Classic: the weathered vertical softwood schutting of the configurator until 2.12.0, now per panel. 13,5 cm planks
 * on a 15 cm pitch carrying the scanned board (0,75 m period over five boards), concrete posts every panel.
 */
export const CLASSIC = Object.freeze({plank: 0.135, pitch: 0.15, thickness: 0.025, post: 0.07});
export function classicPanelParts(length, panelIndex) {
  const {plank, pitch, thickness, post} = CLASSIC, count = Math.max(1, Math.round(length / pitch)), planks = [];
  for (let i = 0; i < count; i++) {
    const x = -length / 2 + (i + 0.5) * (length / count), shift = 0.075 + ((panelIndex * 3 + i) % 5) * 0.15;
    const grey = 1.22 + ((panelIndex + i) % 5) * 0.05;
    planks.push({size: [plank, 1.75, thickness], position: [x, 0.8, 0], color: [grey, grey, grey],
      uv: (xx, y, z, u, v, lx, ly) => [(lx / plank + 0.5) * 0.18 + shift / 0.75, (y + 0.95) / 1.9]});
  }
  return {planks, posts: [{size: [post, 1.85, post], position: [-length / 2, 0.85, 0]}]};
}

/**
 * Which panels stand between the camera and the aanbouw. `panels` are {box: THREE.Box3 (world), ...}; `bounds` is
 * the aanbouw's box as {left,right,back,front} with `height`; a panel is occluding when any ray from the eye to one
 * of 27 points on the aanbouw box (corners, edge middles, face centres, centre) crosses the panel's box before it
 * reaches that point. Returns a Set of the occluding panels.
 */
export function occludingPanels(eye, bounds, height, panels) {
  // The points sit 15 cm inside the aanbouw's corners: a ray to the exact corner grazes a post standing right beside
  // the side wall (a rijwoning's party-line fence starts 5 cm from it) and would hide a panel that blocks nothing.
  const inset = 0.15;
  const xs = [bounds.left + inset, (bounds.left + bounds.right) / 2, bounds.right - inset];
  const ys = [0.15, height / 2, height - inset];
  const zs = [bounds.back + inset, (bounds.back + bounds.front) / 2, bounds.front - inset];
  const ray = new THREE.Ray(), hit = new THREE.Vector3(), target = new THREE.Vector3(), result = new Set();
  for (const panel of panels) {
    if (panel.box.containsPoint(eye)) continue; // a camera inside a panel's box is not looking THROUGH it
    let blocks = false;
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          target.set(x, y, z);
          const distance = eye.distanceTo(target);
          ray.origin.copy(eye);ray.direction.copy(target).sub(eye).normalize();
          if (ray.intersectBox(panel.box, hit) && eye.distanceTo(hit) < distance - 0.01) { blocks = true; break; }
        }
        if (blocks) break;
      }
      if (blocks) break;
    }
    if (blocks) result.add(panel);
  }
  return result;
}

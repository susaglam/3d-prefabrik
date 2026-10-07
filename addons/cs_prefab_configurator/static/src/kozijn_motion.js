/**
 * How each kozijn opens (2.18.0). The owner: "kapılara açılış yönü ve yöntemlerine göre animasyon ekle; kapı
 * seçildikten sonra otomatik oynatsın, kapıya tıklattığında açılsın, tıklattığında kapansın".
 *
 * Pure: the pose of every section follows from the section layout (geometry.js openingLayout — the same table the 3D,
 * the option icons and the drawings read) and one number, the openness from 0 (as built) to 1 (open). preview.js
 * animates the openness over time and eases it; nothing here knows about time or three.js.
 *
 * x runs to the right seen from the garden, z OUT toward the garden. A pose {pivotX, dx, dz, ry} turns a section by ry
 * about the vertical line through x = pivotX on its hinge plane, and moves that line by (dx, dz).
 *  sliding  slides the way it opens, behind its fixed pane (it runs on the inner track), by its width less one stile so
 *           its handle stays in sight
 *  door     swings OUT on its hinge stile to a right angle: Dutch garden doors open outward (the harmonica reference
 *           shows its loopdeur standing open in the garden)
 *  folding  the set folds OUT in one zigzag against the jamb it opens to, each leaf turning the other way from the last
 *           and hinged to its neighbour at every moment (the reference: folded to the left, into the garden)
 */
export const KOZIJN_MOTION = Object.freeze({doorAngle: Math.PI / 2, foldAngle: 84 * Math.PI / 180, openMs: 1100, closeMs: 900,
    holdMs: 1400, delayMs: 350});
/** The sections that move. A fixed pane never does. */
export const OPERABLE = Object.freeze(['sliding', 'door', 'folding']);

/** Slow in, slow out, clamped to 0..1. */
export function easeInOut(t) {
    const x = Math.min(1, Math.max(0, t));
    return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * The pose of every section at `openness` (linear, 0..1), or null for a section that does not move. `edges` are the
 * sections' [left, right] as built; `stile` is the sash stile a parked sliding leaf leaves in sight.
 */
export function sectionPoses(sections, edges, openness, {stile = 0} = {}) {
    const o = Math.min(1, Math.max(0, openness)), poses = sections.map(() => null);
    sections.forEach((section, i) => {
        const [x0, x1] = edges[i];
        if (section.role === 'sliding') {
            const travel = Math.max(0, x1 - x0 - stile);
            poses[i] = {pivotX: x0, dx: (section.opens === 'left' ? -1 : 1) * travel * o, dz: 0, ry: 0};
        } else if (section.role === 'door') {
            const left = section.hinge !== 'right';
            poses[i] = {pivotX: left ? x0 : x1, dx: 0, dz: 0, ry: (left ? -1 : 1) * KOZIJN_MOTION.doorAngle * o};
        }
    });
    const set = sections.map((section, i) => i).filter(i => sections[i].role === 'folding');
    if (set.length) {
        // From the jamb the set opens to: each leaf turns about its edge on that side, outward and back in turn.
        const toLeft = sections[set[0]].opens !== 'right', order = toLeft ? set : [...set].reverse(), theta = KOZIJN_MOTION.foldAngle * o;
        let px = toLeft ? edges[order[0]][0] : edges[order[0]][1], pz = 0;
        order.forEach((i, k) => {
            const [x0, x1] = edges[i], width = x1 - x0, out = k % 2 === 0, pivotX = toLeft ? x0 : x1;
            poses[i] = {pivotX, dx: px - pivotX, dz: pz, ry: (toLeft ? 1 : -1) * (out ? -theta : theta)};
            px += (toLeft ? 1 : -1) * width * Math.cos(theta);
            pz += (out ? 1 : -1) * width * Math.sin(theta);
        });
    }
    return poses;
}

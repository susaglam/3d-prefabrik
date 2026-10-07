/**
 * How each kozijn opens (2.18.0). The owner: "kapılara açılış yönü ve yöntemlerine göre animasyon ekle; kapı
 * seçildikten sonra otomatik oynatsın, kapıya tıklattığında açılsın, tıklattığında kapansın". The motion is a pure
 * function of the section layout (geometry.js openingLayout, the same one the 3D, the icons and the drawings read) and
 * an openness 0..1, so it is tested here on numbers; tests/frontend/kozijn.test.mjs checks the built scene follows it.
 *
 * Conventions: x to the right seen from the garden, z OUT toward the garden. A pose turns a section by ry about the
 * vertical line through x = pivotX on its hinge plane, and moves that line by (dx, dz).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {KOZIJN_MOTION, OPERABLE, easeInOut, sectionPoses} from '../../addons/cs_prefab_configurator/static/src/kozijn_motion.js';
import {openingLayout} from '../../addons/cs_prefab_configurator/static/src/geometry.js';

const edgesOf = sections => sections.map(s => [s.x - s.width / 2, s.x + s.width / 2]);
/** Where a point of a section, given relative to its pivot line in the closed state, ends up in the pose. */
const moved = (pose, [x, z]) => [pose.pivotX + pose.dx + x * Math.cos(pose.ry) + z * Math.sin(pose.ry), pose.dz - x * Math.sin(pose.ry) + z * Math.cos(pose.ry)];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('every kozijn is as built at openness 0, and only leaves, doors and folding sets move', () => {
  assert.deepEqual([...OPERABLE].sort(), ['door', 'folding', 'sliding']);
  for (const [kind, width] of [['sliding-2', 3.2], ['sliding-4', 4.4], ['folding', 4.4], ['french', 4.4], ['french', 1.2]]) {
    const sections = openingLayout(kind, width), poses = sectionPoses(sections, edgesOf(sections), 0, {stile: .09});
    sections.forEach((section, i) => {
      if (section.role === 'fixed') assert.equal(poses[i], null, `${kind}: a fixed pane never moves`);
      else assert.ok(near(poses[i].dx, 0) && near(poses[i].dz, 0) && near(poses[i].ry, 0), `${kind}: section ${i} closed at 0`);
    });
  }
});

test('a schuifpui leaf slides the way it opens and parks behind its fixed pane, its handle stile still in sight', () => {
  const stile = .095;
  for (const [kind, width] of [['sliding-2', 3.2], ['sliding-4', 4.4]]) {
    const sections = openingLayout(kind, width), edges = edgesOf(sections), poses = sectionPoses(sections, edges, 1, {stile});
    sections.forEach((section, i) => {
      if (section.role !== 'sliding') return;
      const travel = edges[i][1] - edges[i][0] - stile, dir = section.opens === 'left' ? -1 : 1;
      assert.ok(near(poses[i].dx, dir * travel), `${kind}: leaf ${i} slides ${section.opens} by its width less a stile`);
      assert.equal(poses[i].ry, 0, 'a sliding leaf does not turn');
      // It ends behind the fixed pane it parks behind, one stile still over its own opening: that is the stile with
      // the pull, the one the hand finds to close it again.
      const fixed = sections.findIndex(other => other.role === 'fixed' && Math.sign(other.x - section.x) === dir);
      const [l, r] = [edges[i][0] + poses[i].dx, edges[i][1] + poses[i].dx];
      assert.ok(l >= edges[fixed][0] - stile - 1e-9 && r <= edges[fixed][1] + stile + 1e-9, `${kind}: leaf ${i} behind fixed pane ${fixed}`);
      const overhang = dir > 0 ? edges[fixed][0] - l : r - edges[fixed][1];
      assert.ok(near(overhang, stile), `${kind}: leaf ${i} leaves exactly its handle stile in the opening`);
    });
    assert.ok(near(sectionPoses(sections, edges, .5, {stile})[sections.findIndex(s => s.role === 'sliding')].dx,
      (sections[sections.findIndex(s => s.role === 'sliding')].opens === 'left' ? -.5 : .5) * (edges[sections.findIndex(s => s.role === 'sliding')][1] - edges[sections.findIndex(s => s.role === 'sliding')][0] - stile)),
    'openness is linear in travel: the easing belongs to the animation, not to the pose');
  }
});

test('openslaande deuren swing OUT on their hinge stiles to a right angle', () => {
  for (const width of [4.4, 1.2]) {
    const sections = openingLayout('french', width), edges = edgesOf(sections), poses = sectionPoses(sections, edges, 1);
    const doors = sections.map((s, i) => i).filter(i => sections[i].role === 'door');
    assert.equal(doors.length, 2);
    for (const i of doors) {
      const pose = poses[i], w = edges[i][1] - edges[i][0], left = sections[i].hinge === 'left';
      assert.equal(pose.pivotX, left ? edges[i][0] : edges[i][1], 'the hinge line is the outer stile');
      assert.ok(near(Math.abs(pose.ry), KOZIJN_MOTION.doorAngle) && near(KOZIJN_MOTION.doorAngle, Math.PI / 2));
      const [x, z] = moved(pose, [left ? w : -w, 0]);
      assert.ok(near(x, pose.pivotX, 1e-9) && near(z, w, 1e-9), `door ${i}: its free edge stands ${w.toFixed(2)} m out in the garden`);
    }
  }
});

test('a harmonicapui folds OUT against its left jamb in one unbroken zigzag; the loopdeur swings out on the right', () => {
  const sections = openingLayout('folding', 4.4), edges = edgesOf(sections), set = sections.map((s, i) => i).filter(i => sections[i].role === 'folding');
  assert.equal(set.length, 4);
  for (const openness of [.25, .5, 1]) {
    const poses = sectionPoses(sections, edges, openness);
    assert.ok(near(poses[set[0]].dx, 0) && near(poses[set[0]].dz, 0), 'the first leaf keeps its hinge at the jamb');
    for (let k = 0; k < set.length; k++) {
      const i = set[k], w = edges[i][1] - edges[i][0], end = moved(poses[i], [w, 0]);
      assert.ok(end[1] >= -1e-9, `leaf ${i}: folds outward, never into the room`);
      if (k + 1 < set.length) {
        const next = poses[set[k + 1]];
        assert.ok(near(end[0], next.pivotX + next.dx, 1e-9) && near(end[1], next.dz, 1e-9), `leaf ${i} stays hinged to leaf ${set[k + 1]} at ${openness}`);
      }
      assert.ok(Math.sign(poses[i].ry) === (k % 2 ? 1 : -1) || openness === 0, 'each leaf turns the other way from the last');
    }
  }
  const open = sectionPoses(sections, edges, 1), last = set[set.length - 1], w = edges[last][1] - edges[last][0];
  const stack = moved(open[last], [w, 0])[0] - edges[set[0]][0];
  assert.ok(near(stack, set.reduce((sum, i) => sum + (edges[i][1] - edges[i][0]), 0) * Math.cos(KOZIJN_MOTION.foldAngle), 1e-9), 'the open stack is the leaves seen edge-on');
  assert.ok(stack < .5 * (edges[last][1] - edges[set[0]][0]), 'and it clears most of the opening');
  const door = sections.findIndex(s => s.role === 'door'), pose = open[door];
  assert.equal(pose.pivotX, edges[door][1], 'the loopdeur hangs on the right jamb');
  assert.ok(moved(pose, [-(edges[door][1] - edges[door][0]), 0])[1] > .5, 'and opens into the garden');
});

test('the easing starts and ends at rest and is symmetric', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(-1), 0, 'clamped');
  assert.equal(easeInOut(2), 1, 'clamped');
  for (const t of [.1, .25, .4]) assert.ok(near(easeInOut(t) + easeInOut(1 - t), 1, 1e-12), `symmetric at ${t}`);
  assert.ok(easeInOut(.05) < .05 && easeInOut(.95) > .95, 'slow in, slow out');
  assert.ok(KOZIJN_MOTION.openMs >= 800 && KOZIJN_MOTION.openMs <= 1600, 'a door takes about a second to open');
});

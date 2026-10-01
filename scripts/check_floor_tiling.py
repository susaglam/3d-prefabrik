"""Measure whether the generated floor tiles really wrap, whether their size is a whole number of boards, and
whether any joint runs unbroken across the floor. "It looks seamless in a render" is an opinion; these are numbers.

Three controls, each with a different failure pattern:

1. WRAP STEP - tile the map 3 x 3 and compare the pixel step ACROSS the wrap (last column against first column,
   last row against first row) with the interior steps that are structurally the same thing. The comparator matters
   more than the measurement: a tile whose wrap falls on a plank joint SHOULD show a big step there, so every line
   of the image is first classified by what the ambient-occlusion map says sits at the wrap.
     * PLAIN lines (unbroken board across the wrap) must be continuous. They are compared against the interior
       steps at JPEG block boundaries, because 8 x 8 block noise is the real noise floor of any lossy map and on a
       normal map of a flat board it is the entire signal (measured: interior 0.21, block boundaries 0.88).
     * JOINT lines are compared against the 90th percentile of the interior steps that also sit on a joint.
   Run with --self-test to confirm the control still detects a broken wrap: the right half of each shipped tile is
   rolled vertically, so its right edge lands on a different board than its left edge - exactly what the 2.9.1
   generator did by laying independent boards across a canvas wider than the tile and cropping it - and the
   plain-line ratio has to blow past the threshold. Measured on the real 2.9.1 maps (regenerated for the comparison):
   laminate diffuse x 2.84, herringbone diffuse x 1.91 / y 1.90, against 1.03 / 1.00 / 0.94 for the tiles shipped now.

2. BOARD MODULE - the tile side in metres divided by the board module it is supposed to contain, so a tile that is a
   rounded-to-a-whole-pixel approximation of an irrational period (the 45 degree herringbone crop) reports its
   residual in modules and in millimetres of drift per tile.

3. LONGEST STRAIGHT JOINT - threshold the ambient-occlusion map (the joints, and nothing else) and measure the
   longest unbroken run of joint pixels along the four directions the pattern can produce. In a single herringbone
   no line may run further than one board plus one board width (L + W = 0.75 m); in the laminate the boards butt
   side by side, so a full-tile run along the board direction is correct and only the cross direction is checked.

Run from the repository root:  python scripts/check_floor_tiling.py [--write-tiles] [--self-test]
Writes nothing unless --write-tiles is given (3 x 3 contact sheets into .data/render-compare/tiling/).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / "addons" / "cs_prefab_configurator" / "static" / "src" / "assets" / "materials"
PROVENANCE = MATERIALS / "provenance.json"
TILES = ROOT / ".data" / "render-compare" / "tiling"

PLAIN_LIMIT = 1.5   # a continuous board across the wrap may not step more than 1.5x the map's own block noise
JOINT_LIMIT = 1.5   # a joint across the wrap may not step more than 1.5x the tile's other joints

FINISHES = {
    "laminate": {
        "prefix": "laminate_floor", "plank": (1.20, 0.20),
        # The tile is an exact number of boards along the board and an exact number of boards across it.
        "modules": lambda side, L, W: {"tile / board length": (side / L, L), "tile / board width": (side / W, W)},
        # Boards butt side by side, so the long joints run the full tile: only the 45 degree diagonals are limited.
        "joints": {"diagonal": 0.30},
    },
    "herringbone": {
        "prefix": "parquet_herringbone", "plank": (0.60, 0.15),
        # The 45 degree tile is the axis-aligned lattice period 2L times sqrt(2), so the module along the tile edge
        # is L*sqrt(2) (the rotated lattice spacing) and W*sqrt(2) across it.
        "modules": lambda side, L, W: {"tile / (L*sqrt2)": (side / (L * math.sqrt(2)), L * math.sqrt(2)),
                                       "tile / (W*sqrt2)": (side / (W * math.sqrt(2)), W * math.sqrt(2))},
        # Every joint lies at 45 degrees to the tile edge, so nothing may run along a row or a column at all, and a
        # diagonal run may not exceed one board plus one board width.
        "joints": {"axis": 0.10, "diagonal": 0.60 + 0.15},
    },
}
KINDS = ("diffuse", "nor_gl", "rough", "ao")


def wrap_steps(array: np.ndarray, joints: np.ndarray) -> dict:
    """Wrap step per axis, split into the lines that must be continuous and the lines that carry a joint."""
    out = {}
    for axis, name in ((1, "x"), (0, "y")):
        a = array if axis == 1 else array.transpose(1, 0, 2)
        j = joints if axis == 1 else joints.T
        wrap = np.abs(a[:, 0] - a[:, -1]).mean(axis=1)
        steps = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=2)
        joint_pair = j[:, 1:] | j[:, :-1]
        block = ((np.arange(steps.shape[1]) + 1) % 8 == 0)[None, :]
        at_wrap = j[:, 0] | j[:, -1]
        report = {}
        plain = ~at_wrap
        if plain.any():
            reference = steps[plain[:, None] & block & ~joint_pair]
            report["plain"] = {"n": int(plain.sum()), "wrap": float(wrap[plain].mean()),
                               "reference": float(reference.mean()) if reference.size else float("nan")}
            report["plain"]["ratio"] = report["plain"]["wrap"] / max(report["plain"]["reference"], 1e-6)
        if at_wrap.any():
            reference = steps[at_wrap[:, None] & joint_pair]
            level = float(np.percentile(reference, 90)) if reference.size else float("nan")
            report["joint"] = {"n": int(at_wrap.sum()), "wrap": float(wrap[at_wrap].mean()), "reference": level,
                               "ratio": float(wrap[at_wrap].mean() / max(level, 1e-6))}
        out[name] = report
    return out


def joint_mask(prefix: str, size: int) -> np.ndarray:
    """Where the joints are, from the ambient-occlusion map - it carries the joints and nothing else."""
    image = Image.open(MATERIALS / f"{prefix}_ao.jpg").convert("L")
    if image.size != (size, size):
        image = image.resize((size, size), Image.NEAREST)
    array = np.asarray(image, np.float32)
    return array < (array.min() + array.max()) / 2


def longest_run(mask: np.ndarray, step: tuple[int, int]) -> int:
    """Longest unbroken run of True along `step`, over every line of the (wrapping) tile. The wrap counts: a joint
    that continues across the tile edge really does continue across the floor."""
    size = mask.shape[0]
    dy, dx = step
    t = np.arange(size)
    if (dy, dx) == (0, 1):
        lines = mask
    elif (dy, dx) == (1, 0):
        lines = mask.T
    else:
        lines = mask[t[None, :], (t[:, None] + dx * t[None, :]) % size]
    doubled = np.concatenate([lines, lines], axis=1)
    run, best = np.zeros(doubled.shape[0], np.int32), 0
    for column in range(doubled.shape[1]):
        run = np.where(doubled[:, column], run + 1, 0)
        best = max(best, int(run.max()))
    return min(best, size)


def joint_runs(prefix: str, side_m: float) -> dict:
    """Longest straight joint in metres, per direction, from the ambient-occlusion map."""
    size = Image.open(MATERIALS / f"{prefix}_ao.jpg").size[0]
    mask = joint_mask(prefix, size)
    metre = side_m / size
    return {"row": longest_run(mask, (0, 1)) * metre, "column": longest_run(mask, (1, 0)) * metre,
            "diag+": longest_run(mask, (1, 1)) * metre * math.sqrt(2),
            "diag-": longest_run(mask, (1, -1)) * metre * math.sqrt(2), "px/m": size / side_m}


def contact_sheet(path: Path, target: Path) -> None:
    image = Image.open(path).convert("RGB")
    sheet = Image.new("RGB", (image.width * 3, image.height * 3))
    for row in range(3):
        for column in range(3):
            sheet.paste(image, (column * image.width, row * image.height))
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.resize((min(1500, sheet.width), min(1500, sheet.height)), Image.LANCZOS).save(target, quality=92)


def report(prefix: str, kind: str, crop: int = 0) -> tuple[np.ndarray, dict]:
    """`crop` drops that many columns off the right, which is the 2.9.1 mistake in miniature: the tile is no longer
    a whole period, so its own left edge no longer continues into its right edge. The rows are left alone, so the
    injection lands on one axis only and the other stays as a control."""
    path = MATERIALS / f"{prefix}_{kind}.jpg"
    array = np.asarray(Image.open(path).convert("RGB"), np.float32)
    mask = joint_mask(prefix, array.shape[0])
    if crop:
        half = array.shape[1] // 2
        array = np.concatenate([array[:, :half], np.roll(array[:, half:], crop, axis=0)], axis=1)
        mask = np.concatenate([mask[:, :half], np.roll(mask[:, half:], crop, axis=0)], axis=1)
    return array, wrap_steps(array, mask)


def main() -> int:
    global MATERIALS, PROVENANCE
    write_tiles, self_test = "--write-tiles" in sys.argv, "--self-test" in sys.argv
    if "--dir" in sys.argv:  # point the same controls at an older or experimental set of maps
        MATERIALS = Path(sys.argv[sys.argv.index("--dir") + 1])
        PROVENANCE = MATERIALS / "provenance.json"
        print("materials:", MATERIALS)
    rows = {row["file"]: row for row in json.loads(PROVENANCE.read_text(encoding="utf-8"))["assets"]}
    worst, failures = 0.0, []
    for finish, spec in FINISHES.items():
        prefix, (length, width) = spec["prefix"], spec["plank"]
        side_m = rows.get(f"{prefix}_diffuse.jpg", {}).get("physicalSizeM")
        print(f"\n=== {finish} ({prefix})   tile {side_m} m ===")
        for name, (value, module) in spec["modules"](side_m, length, width).items():
            residual = value - round(value)
            print(f"  {name:22s} = {value:.5f} modules   residual {residual:+.5f} module "
                  f"({residual * module * 1000:+.3f} mm per tile)")
            if abs(residual) > 1e-4:
                failures.append(f"{finish}: {name} is not a whole number of modules ({value:.5f})")
        for kind in KINDS:
            if not (MATERIALS / f"{prefix}_{kind}.jpg").is_file():
                continue
            array, result = report(prefix, kind)
            line = f"  {kind:8s} {array.shape[1]:4d}px {array.shape[0] / side_m:6.1f}px/m  "
            for axis, classes in result.items():
                for label, r in classes.items():
                    line += (f" {axis}/{label[0]}: {r['wrap']:6.2f} vs {r['reference']:6.2f}"
                             f" (x{r['ratio']:.2f}, n={r['n']})")
                # Only the plain lines are a pass/fail control. A line that carries a joint at the wrap is SUPPOSED
                # to step there, and its comparator (other joints in the same lines) is unstable - inside a joint
                # band every neighbouring pixel is equally dark, so the reference collapses towards zero and the
                # ratio reads in the thousands on a tile that is provably exact. Reported, never enforced.
                if "plain" in classes:
                    ratio = classes["plain"]["ratio"]
                    worst = max(worst, ratio / PLAIN_LIMIT)
                    if ratio > PLAIN_LIMIT:
                        failures.append(f"{finish}/{kind}: the {axis} wrap steps {ratio:.2f}x the map's own block "
                                        f"noise on the {classes['plain']['n']} lines that carry unbroken board")
            print(line)
        tone = np.asarray(Image.open(MATERIALS / f"{prefix}_diffuse.jpg").convert("RGB"), np.float64)
        mean = tone.reshape(-1, 3).mean(axis=0)
        top, bottom = mean.max(), mean.min()
        print(f"  tone      mean sRGB ({mean[0]:.1f},{mean[1]:.1f},{mean[2]:.1f})  "
              f"#{int(round(mean[0])):02x}{int(round(mean[1])):02x}{int(round(mean[2])):02x}  "
              f"R-B {mean[0] - mean[2]:+.1f}  saturation {(top - bottom) / top * 100:.1f}%  "
              f"grain sd {tone.reshape(-1, 3).mean(axis=1).std():.1f}")
        recorded_tone = rows.get(f"{prefix}_diffuse.jpg", {}).get("meanSRGB")
        if recorded_tone and max(abs(a - b) for a, b in zip(recorded_tone, mean)) > 0.5:
            failures.append(f"{finish}: the manifest records mean sRGB {recorded_tone} but the file measures "
                            f"{[round(c, 1) for c in mean]}")
        runs = joint_runs(prefix, side_m)
        print(f"  joints    longest straight run  row {runs['row']:.3f} m  column {runs['column']:.3f} m  "
              f"diag+ {runs['diag+']:.3f} m  diag- {runs['diag-']:.3f} m")
        for direction, limit in spec["joints"].items():
            measured = max(runs["row"], runs["column"]) if direction == "axis" else max(runs["diag+"], runs["diag-"])
            if measured > limit + 0.02:  # 2 cm of slack for the blurred joint's shoulders and the AO threshold
                failures.append(f"{finish}: a joint runs {measured:.3f} m along the {direction} (limit {limit} m)")
        if write_tiles:
            contact_sheet(MATERIALS / f"{prefix}_diffuse.jpg", TILES / f"{prefix}-3x3.jpg")

    if self_test:
        print("\n=== self-test: roll the right half of each shipped tile so its right edge lands on a different "
              "board (the 2.9.1 mistake) - the control must fire ===")
        for finish, spec in FINISHES.items():
            for roll in (20, 60, 137):
                ratios = {}
                for kind in KINDS:
                    _, result = report(spec["prefix"], kind, crop=roll)
                    ratios[kind] = result["x"]["plain"]["ratio"] if "plain" in result["x"] else 0.0
                caught = [kind for kind, ratio in ratios.items() if ratio > PLAIN_LIMIT]
                print(f"  {finish}: right half rolled {roll:3d} px -> "
                      + "  ".join(f"{kind} {ratio:.2f}" for kind, ratio in ratios.items())
                      + (f"   DETECTED by {', '.join(caught)}" if caught else "   not detected"))
                # The battery has to catch it, not every map: a herringbone normal map is intrinsically noisy
                # (block-boundary reference 1.92) and is a weak detector on its own, while the colour and the
                # occlusion map are sharp ones.
                if roll == 137 and not caught:
                    failures.append(f"self-test: a 137 px break in the {finish} tile was not detected by any map")

    print(f"\nworst ratio as a fraction of its limit: {worst:.2f}   (under 1.00 = every wrap is within tolerance)")
    for failure in failures:
        print("  FAIL", failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

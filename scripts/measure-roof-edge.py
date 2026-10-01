"""Does selecting "Sedumdak" move the roof edge? Compare two renders of the SAME design from the SAME camera.

The finished roof level is read off the images themselves, not off the scene graph, so this is a second control with a
different failure pattern than the geometry constants in preview.js: if the build-up were stacked on the membrane
again, or the daktrim profile changed, or the fascia band moved, these numbers move with it.

Two independent measurements per camera:

1. The daktrim line. For every column inside a given band, the topmost row that starts a run of dark trim pixels. The
   line is reported per column for both images and the difference is summarised (max / mean / histogram).
2. The topmost differing row, per column, over the WHOLE image. Every difference must sit BELOW the daktrim line of
   that column: anything at or above it means the option changed the roof edge or the silhouette.

Usage: python scripts/measure-roof-edge.py <plain>.png <green>.png <x0> <x1> <y0> <y1> [--json out.json] [--overlay out.png]
where x0..x1 is the column band the roof edge runs through and y0..y1 the rows to look for it in.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

DARK = 100       # luma below this is daktrim, not brick / sky / render
RUN = 6          # rows of trim that must follow, so a dark mortar joint is not mistaken for the trim
DIFFERENT = 24   # sum of |dR|+|dG|+|dB| above which two pixels are called different
RUN_DIFF = 5     # consecutive differing rows a column needs before it counts as changed


def luma(pixel):
    return 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]


def dark_mask(image, dark, span=4):
    """Pixels darker than `dark` that are ALSO dark for `span` columns either side.

    The daktrim is a long horizontal band; a shaded brick is a 6 x 12 px patch that is just as dark. Requiring the
    darkness to continue sideways keeps the band and drops the bricks, which a per-column test cannot do.
    """
    width, height = image.size
    pixels = image.load()
    column = [[luma(pixels[x, y]) < dark for y in range(height)] for x in range(width)]
    return [[all(column[x + step][y] for step in range(-min(x, span), min(width - 1 - x, span) + 1))
             for y in range(height)] for x in range(width)]


def trim_line(mask, x, y0, y1):
    """Topmost row in x's column that starts a run of RUN trim rows; None when the column carries no trim."""
    for y in range(y0, y1 - RUN):
        if all(mask[x][y + step] for step in range(RUN)):
            return y
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("plain")
    parser.add_argument("green")
    parser.add_argument("box", nargs=4, type=int, metavar=("X0", "X1", "Y0", "Y1"))
    parser.add_argument("--json")
    parser.add_argument("--overlay")
    parser.add_argument("--label", default="")
    parser.add_argument("--dark", type=int, default=DARK, help="luma below which a pixel counts as daktrim")
    args = parser.parse_args()
    x0, x1, y0, y1 = args.box

    plain = Image.open(args.plain).convert("RGB")
    green = Image.open(args.green).convert("RGB")
    if plain.size != green.size:
        raise SystemExit(f"different sizes: {plain.size} vs {green.size}")

    lines, missing = [], 0
    plain_mask, green_mask = dark_mask(plain, args.dark), dark_mask(green, args.dark)
    for x in range(x0, x1):
        a, b = trim_line(plain_mask, x, y0, y1), trim_line(green_mask, x, y0, y1)
        if a is None or b is None:
            missing += 1
            continue
        lines.append({"x": x, "plain": a, "green": b})

    # Topmost differing row per column, over the whole image. A single differing pixel is anti-aliasing jitter (the
    # extra meshes re-fit the sun shadow map, which moves every high-contrast edge by a fraction of a pixel), so a
    # column only counts once RUN_DIFF rows in a row differ.
    differs = [[False] * plain.height for _ in range(plain.width)]
    changed = 0
    for x in range(plain.width):
        for y in range(plain.height):
            p, g = plain.getpixel((x, y)), green.getpixel((x, y))
            if abs(p[0] - g[0]) + abs(p[1] - g[1]) + abs(p[2] - g[2]) > DIFFERENT:
                differs[x][y] = True
                changed += 1
    top_diff = {}
    for x in range(plain.width):
        for y in range(plain.height - RUN_DIFF):
            if all(differs[x][y + step] for step in range(RUN_DIFF)):
                top_diff[x] = y
                break

    # Every difference inside the measured band must sit strictly below that column's daktrim line. Columns whose trim
    # was found on the band's own first row are dropped: there the band ceiling cut into something already dark (a
    # downpipe), so the "line" is the band edge, not the trim.
    solid = [row for row in lines if row["plain"] > y0 + 1]
    deltas = [row["green"] - row["plain"] for row in solid]
    above = [{"x": row["x"], "trim": row["plain"], "firstDiff": top_diff[row["x"]]}
             for row in solid if row["x"] in top_diff and top_diff[row["x"]] <= row["plain"]]

    # Third measurement, independent of both: the largest per-channel difference in the strip that actually holds the
    # roof edge - twelve rows above each column's trim line through twenty below it, so cap, fascia band and the
    # membrane lap are all inside it.
    edge_strip = 0
    for row in solid:
        for y in range(max(0, row["plain"] - 12), min(plain.height, row["plain"] + 20)):
            p, g = plain.getpixel((row["x"], y)), green.getpixel((row["x"], y))
            edge_strip = max(edge_strip, abs(p[0] - g[0]), abs(p[1] - g[1]), abs(p[2] - g[2]))

    result = {
        "label": args.label,
        "plain": Path(args.plain).name, "green": Path(args.green).name,
        "size": list(plain.size), "band": {"x": [x0, x1], "y": [y0, y1], "darkBelowLuma": args.dark},
        "daktrimLine": {
            "columnsMeasured": len(solid), "columnsWithoutTrim": missing, "columnsAtBandCeiling": len(lines) - len(solid),
            "maxAbsDeltaPx": max((abs(d) for d in deltas), default=None),
            "meanDeltaPx": round(sum(deltas) / len(deltas), 4) if deltas else None,
            "histogram": {str(value): deltas.count(value) for value in sorted(set(deltas))},
        },
        "maxChannelDiffInEdgeStrip": edge_strip,
        "pixelsChanged": changed,
        "pixelsChangedPercent": round(changed / (plain.width * plain.height) * 100, 2),
        "topmostDiffRow": min(top_diff.values()) if top_diff else None,
        "columnsWithDiffAtOrAboveTrim": above[:20],
        "columnsWithDiffAtOrAboveTrimCount": len(above),
    }
    print(json.dumps(result, indent=1))
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    if args.overlay:
        sheet = Image.new("RGB", (plain.width * 2, plain.height), "black")
        sheet.paste(plain, (0, 0))
        sheet.paste(green, (plain.width, 0))
        draw = ImageDraw.Draw(sheet)
        for row in lines:
            draw.point((row["x"], row["plain"]), fill=(255, 0, 255))
            draw.point((plain.width + row["x"], row["green"]), fill=(255, 0, 255))
        draw.rectangle([x0, y0, x1, y1], outline=(0, 255, 255))
        sheet.save(args.overlay)
        print("overlay:", args.overlay)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

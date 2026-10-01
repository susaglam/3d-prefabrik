"""Interior colour probe, part 2 of 2: average the rendered sRGB per surface group.

Reads the <slug>.png / <slug>-points.json pairs written by scripts/measure-surface-colour.mjs and prints, per surface, the
mean sRGB of the real rendered pixels plus the warm cast (R-B) and the relative luminance. The point list comes from
a raycast, so every averaged pixel is proven to sit on that surface - no hand-picked rectangles.

Usage: python scripts/measure-surface-colour.py <slug> [<slug> ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

OUT = Path(".data") / "render-compare"


def luminance(rgb):
    def linear(channel):
        c = channel / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (linear(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


for slug in sys.argv[1:]:
    image = Image.open(OUT / f"{slug}.png").convert("RGB")
    points = json.loads((OUT / f"{slug}-points.json").read_text(encoding="utf-8"))
    groups: dict[str, list] = {}
    for point in points["found"]:
        x = min(image.width - 1, max(0, point["px"]))
        y = min(image.height - 1, max(0, point["py"]))
        groups.setdefault(point["group"], []).append(image.getpixel((x, y)))
    print(f"== {slug}  ({image.width}x{image.height}, {len(points['found'])} raycast hits)")
    for group, pixels in sorted(groups.items(), key=lambda item: -len(item[1])):
        n = len(pixels)
        mean = tuple(round(sum(p[c] for p in pixels) / n) for c in range(3))
        print(f"   {group:<34} n={n:<5} sRGB={mean}  hex=#{mean[0]:02x}{mean[1]:02x}{mean[2]:02x}"
              f"  R-B={mean[0] - mean[2]:+d}  Y={luminance(mean):.3f}")

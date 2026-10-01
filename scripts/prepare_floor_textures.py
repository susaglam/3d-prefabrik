"""Generate the two floor-finish texture sets from one CC0 oak scan, at real Dutch plank sizes, exactly seamless.

Why generated instead of downloaded: scanned herringbone tiles publish an unknown physical size, and the ones that
tile at 1 k resolution carry planks far smaller than the 60 x 15 cm visgraat that is actually laid in Dutch homes.
Both finishes are therefore re-laid here from the same grain, so the plain laminate and the herringbone read as one
product family in a light, warm "naturel eiken" tone:

- laminate   : 120 x 20 cm planks, wandering joints, 2 x 12 planks -> a 2.40 m tile.
- herringbone: 60 x 15 cm planks in a single herringbone, 2 x 2 lattice periods -> a 3.3941 m tile at 45 degrees.

Three things the 2.9.1 generator got wrong, all of them measurable with scripts/check_floor_tiling.py:

1. NOTHING ACTUALLY WRAPPED. Both layouts drew a fresh random grain patch per plank across a canvas wider than the
   tile and then cropped it, so the geometry repeated but the wood did not: the crop's left edge met a different
   board than its right edge. Measured on the 2.9.1 maps, wrap step over the map's own JPEG block noise on the lines
   that carry unbroken board: laminate colour 2.84x, herringbone colour 1.91x / 1.90x (limit 1.5; the tiles below
   measure 1.03x / 1.01x / 0.95x). On a floor that is a line at every tile boundary. Everything is now laid MODULO
   the tile - one canvas exactly one period wide, planks pasted with wraparound, groove mask blurred with
   wraparound, every downsample an exact 2:1 box reduction (local, so it cannot disturb the wrap).

2. THE 45 DEGREE CROP WAS ROUNDED TO A WHOLE PIXEL. The axis-aligned herringbone period 2L has a rotated period of
   2L*sqrt(2), which is irrational, so cropping round(2L*sqrt(2)) pixels left a 0.15 px mismatch across the wrap.
   The rotation is now a single resampling warp that maps the exact irrational period onto exactly N output pixels
   and reads the source with wraparound, so output pixel i+N samples source (x+P, y-P) == (x, y) mod P: periodic by
   construction, at any N, with no rounding anywhere. The grain normal map's XY is rotated by the same 45 degrees
   after the warp - a warped normal map whose vectors are not turned with it lights from the wrong side.

3. THE SCAN'S OWN PLANK JOINTS ENDED UP INSIDE OUR PLANKS. The source is a laid floor, not a single board: it carries
   a joint every 256 px (21.3 cm). Random crops therefore cut a dark line across the middle of a 20 cm plank, which
   is why the old laminate tile shows rows of two different heights. The grain is now read at 2 k and split into the
   clean bands BETWEEN those joints (8 bands of ~250 px = 20.8 cm, cut again at the scan's butt joints), and every
   plank is a window inside one clean band.

Grain source: Poly Haven `laminate_floor_02` (CC0) diffuse/normal/roughness at 2k, sampled per plank with random
offsets and flips, colour graded to the target tone. Run from the repository root:

    python scripts/prepare_floor_textures.py

Downloads are cached in .data/asset-cache (gitignored); outputs land in the addon's assets/materials folder, the
512 px compact-tier siblings are rebuilt with them, and the matching provenance.json rows are replaced. Re-running is
idempotent (fixed random seeds). Verify with `python scripts/check_floor_tiling.py`.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import math
import random
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFile, ImageFilter

# JPEG `optimize=True` writes through a single block whose default 64 kB a high-entropy 2 k map overflows.
ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 16 << 20)

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / "addons" / "cs_prefab_configurator" / "static" / "src" / "assets" / "materials"
PROVENANCE = MATERIALS / "provenance.json"
CACHE = ROOT / ".data" / "asset-cache"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cs-prefab-configurator asset preparation"
SOURCE = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/laminate_floor_02/laminate_floor_02_{role}_2k.jpg"
ASSET_PAGE = "https://polyhaven.com/a/laminate_floor_02"
GRAIN_SIZE_M = 1.7  # published size of the source scan (api.polyhaven.com/info: 1700.0 x 1700.0 mm)

PX_PER_M = 1200  # working resolution; the 2 k scan is 1204.7 px/m, so this is a 0.4 % resize, not an invention
LADDER_SIZE = 512
QUALITY = 88
# Light warm Dutch oak. The 2.9.1 tone rgb(198,186,167) was only 16 % saturated: grading the warm scan onto it meant
# multiplying blue by 1.86 against red by 1.32, which is what bleached the floor to grey-beige under interior light.
TARGET_TONE = (214, 184, 149)
CONTRAST = 1.26  # grain deviation around the mean, applied before the tone match, for visible ring contrast
SATURATION = 1.18  # chroma around per-pixel luminance, applied before the tone match
PLANK_TONE = 0.055  # per-plank brightness jitter (+/-), as real boards vary board to board
GROOVE = 0.62  # groove darkness relative to the plank face
GROOVE_PX = 1  # groove half-width inside each plank edge, in working pixels -> 2 px = 1.7 mm per joint
# Groove blur radii in working pixels for colour, height and ambient occlusion. They are the 2.9.1 radii converted
# to this resolution (1.29 / 1.88 / 3.05 mm), so the joints keep the softness the renders were signed off on.
BLUR = (1.55, 2.25, 3.66)
NORMAL_STRENGTH = 6 / 851  # 2.9.1 used "gradient * 6" at 851 px/m; keep the physical slope, not the pixel constant

LAMINATE = {"plank": (1.20, 0.20), "rows": 12, "per_row": 2, "stagger_min": 0.30, "out": 1440}
# `repeat` = how many lattice periods the tile holds; 2 gives 64 distinct boards and a 3.39 m period, so a 7.00 m
# extension shows the pattern twice across instead of four times.
HERRINGBONE = {"plank": (0.60, 0.15), "repeat": 2, "out": 1536}
SUPERSAMPLE = 2  # the 45 degree warp is sampled at 2x and box-reduced, so the 1200 -> 603 px/m step does not alias

# Which scan map each output is actually made of, so the manifest names a URL that really is this file's source
# instead of one made-up composite URL for all four. The ambient-occlusion map carries no scan pixels at all - it is
# the board layout's own joint mask - and says so; it names the colour scan only because that is the asset whose
# licence covers the whole set.
SOURCE_ROLE = {"diffuse": "diff", "nor_gl": "nor_gl", "rough": "rough", "ao": "diff"}
DERIVED = {
    "diffuse": f"scan colour, graded to rgb{{tone}} (contrast {{contrast}}, saturation {{saturation}}) and darkened "
               f"in the joints",
    "nor_gl": "scan normal, its XY turned with the pattern, over a height map built from the joint mask",
    "rough": "scan roughness, raised a little in the joints; no gloss anywhere",
    "ao": "generated from the joint mask alone - no scan pixels in this map",
}


# --------------------------------------------------------------------------------------------------- source grain

def fetch(url: str, name: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / name
    if cached.is_file():
        return cached.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        data = response.read()
    cached.write_bytes(data)
    return data


def grain_maps() -> dict:
    """The three scan maps resampled to exactly PX_PER_M. Roughness is a single channel; the scan ships it as grey."""
    side = round(GRAIN_SIZE_M * PX_PER_M)
    maps = {}
    for role, key in (("diff", "color"), ("nor_gl", "normal"), ("rough", "rough")):
        image = Image.open(io.BytesIO(fetch(SOURCE.format(role=role), f"laminate_floor_02_{role}_2k.jpg")))
        image = image.convert("L" if key == "rough" else "RGB").resize((side, side), Image.LANCZOS)
        maps[key] = np.asarray(image, dtype=np.uint8)
    return maps


def dark_runs(profile: np.ndarray, window: int, depth: float) -> list[tuple[int, int]]:
    """Index ranges where `profile` dips below its local average by `depth` - the scan's own joints."""
    kernel = np.ones(window) / window
    smooth = np.convolve(np.pad(profile, window, mode="edge"), kernel, mode="same")[window:-window]
    mask = profile < smooth - depth
    runs, start = [], None
    for index, value in enumerate(mask):
        if value and start is None:
            start = index
        elif not value and start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, len(mask)))
    return runs


def grain_strips(grain: dict) -> list[dict]:
    """Split the scan into rectangles that contain no joint of its own: the rows between the long joints, cut again
    at the butt joints inside each row. Every plank we lay is then a window of clean board, never a board with a
    line across it."""
    luma = grain["color"].mean(axis=2)
    margin = max(3, round(.003 * PX_PER_M))
    edges = [0] + [(a + b) // 2 for a, b in dark_runs(luma.mean(axis=1), 41, 4.0)] + [luma.shape[0]]
    strips = []
    for top, bottom in zip(edges, edges[1:]):
        top, bottom = top + margin, bottom - margin
        if bottom - top < .08 * PX_PER_M:  # a band under 8 cm is a sliver at the edge of the scan
            continue
        band = luma[top:bottom]
        cuts = [0] + [(a + b) // 2 for a, b in dark_runs(band.mean(axis=0), 41, 4.0)] + [band.shape[1]]
        for left, right in zip(cuts, cuts[1:]):
            left, right = left + margin, right - margin
            if right - left < .25 * PX_PER_M:
                continue
            strips.append({key: array[top:bottom, left:right] for key, array in grain.items()})
    if not strips:
        raise SystemExit("no clean grain band survived the joint detection; check the source scan")
    return strips


def usable_strips(strips: list[dict], width: int, height: int) -> list[dict]:
    """Only bands that hold a whole board. Mirroring a short band to length puts a butterfly in the middle of the
    board - very visible on a 1.20 m laminate plank - and stretching one reads as a coarser wood beside its
    neighbours, so a board is only ever cut from a band that is already big enough."""
    fits = [s for s in strips if s["color"].shape[0] >= height and s["color"].shape[1] >= width]
    if not fits:
        raise SystemExit(f"no clean grain band holds a {width} x {height} px board; lower PX_PER_M or the format")
    return fits


def plank_patch(strips: list[dict], width: int, height: int, rng: random.Random) -> dict:
    """One board: a window of clean grain, flipped at random, with a slight board-to-board tone shift. Wide bands
    are picked more often, so the variety follows the scan rather than the band count."""
    weights = [s["color"].shape[1] - width + 1 for s in strips]
    strip = rng.choices(strips, weights=weights, k=1)[0]
    y = rng.randrange(0, strip["color"].shape[0] - height + 1)
    x = rng.randrange(0, strip["color"].shape[1] - width + 1)
    patch = {key: array[y:y + height, x:x + width] for key, array in strip.items()}
    if rng.random() < .5:
        patch = {key: array[:, ::-1] for key, array in patch.items()}
        patch["normal"] = patch["normal"].copy()
        patch["normal"][..., 0] = 255 - patch["normal"][..., 0]  # mirroring along x flips the normal's x
    if rng.random() < .5:
        patch = {key: array[::-1] for key, array in patch.items()}
        patch["normal"] = patch["normal"].copy()
        patch["normal"][..., 1] = 255 - patch["normal"][..., 1]
    shade = rng.uniform(1 - PLANK_TONE, 1 + PLANK_TONE)
    patch["color"] = np.clip(patch["color"].astype(np.float32) * shade, 0, 255).astype(np.uint8)
    return patch


# ------------------------------------------------------------------------------------------------ wrapped canvas

def blank(size: int) -> dict:
    return {"color": np.zeros((size, size, 3), np.uint8), "normal": np.zeros((size, size, 3), np.uint8),
            "rough": np.zeros((size, size), np.uint8)}


def paste_wrapped(canvas: dict, patch: dict, x: int, y: int, rotate: bool = False) -> None:
    """Write one plank into the canvas modulo the tile, so the tile is periodic the moment it is laid."""
    if rotate:
        patch = {key: np.rot90(array) for key, array in patch.items()}
        normal = patch["normal"].copy()
        # np.rot90 sends +column to -row and +row to +column; the tangent-space normal has to turn with the board.
        normal[..., 0], normal[..., 1] = 255 - patch["normal"][..., 1], patch["normal"][..., 0]
        patch["normal"] = normal
    height, width = patch["color"].shape[:2]
    size = canvas["color"].shape[0]
    index = np.ix_(np.arange(y, y + height) % size, np.arange(x, x + width) % size)
    for key, array in patch.items():
        canvas[key][index] = array


def groove_rect(mask: np.ndarray, x: int, y: int, width: int, height: int) -> None:
    """Darken a border inside one plank's footprint; two neighbouring planks together make one joint."""
    size = mask.shape[0]
    rows, columns = np.arange(y, y + height) % size, np.arange(x, x + width) % size
    mask[np.ix_(rows[:GROOVE_PX], columns)] = 0
    mask[np.ix_(rows[-GROOVE_PX:], columns)] = 0
    mask[np.ix_(rows, columns[:GROOVE_PX])] = 0
    mask[np.ix_(rows, columns[-GROOVE_PX:])] = 0


def wrapped_blur(array: np.ndarray, radius: float) -> np.ndarray:
    """Gaussian blur that sees the tile's opposite edge as its neighbour, so the joint at the wrap is blurred like
    every other joint instead of being clipped into a half-groove."""
    pad = max(2, int(math.ceil(radius * 3)))
    padded = np.pad(array, pad, mode="wrap")
    image = Image.fromarray(np.clip(padded, 0, 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(image, dtype=np.float32)[pad:-pad, pad:-pad]


def reduce2(array: np.ndarray, times: int = 1) -> np.ndarray:
    """Exact 2:1 box reduction. Local, so a periodic image stays periodic - unlike a Lanczos resize, whose filter
    runs off the edge and quietly breaks the wrap it was asked to preserve."""
    array = array.astype(np.float32)
    for _ in range(times):
        height, width = array.shape[:2]
        array = array.reshape((height // 2, 2, width // 2, 2) + array.shape[2:]).mean(axis=(1, 3))
    return array


# -------------------------------------------------------------------------------------------------------- layouts

def lay_laminate(grain: dict, rng: random.Random) -> dict:
    length, width = LAMINATE["plank"]
    plank_w, plank_h = round(length * PX_PER_M), round(width * PX_PER_M)
    size = plank_w * LAMINATE["per_row"]
    assert size == plank_h * LAMINATE["rows"], "the laminate tile must be square: per_row*length == rows*width"
    strips = usable_strips(grain_strips(grain), plank_w, plank_h)
    canvas, mask = blank(size), np.full((size, size), 255, np.uint8)
    gap = round(LAMINATE["stagger_min"] * PX_PER_M)

    def far_enough(candidate: int, other: int) -> bool:  # joints repeat every board, so compare modulo the board
        delta = abs(candidate - other) % plank_w
        return min(delta, plank_w - delta) >= gap

    offsets = [0]
    while len(offsets) < LAMINATE["rows"]:
        candidate = rng.randrange(0, plank_w)
        last = len(offsets) == LAMINATE["rows"] - 1
        if far_enough(candidate, offsets[-1]) and (not last or far_enough(candidate, offsets[0])):
            offsets.append(candidate)
    for row, offset in enumerate(offsets):
        y = row * plank_h
        for plank in range(LAMINATE["per_row"]):
            x = offset + plank * plank_w
            paste_wrapped(canvas, plank_patch(strips, plank_w, plank_h, rng), x, y)
            groove_rect(mask, x, y, plank_w, plank_h)
    return {"maps": canvas, "grooves": mask, "size_m": size / PX_PER_M, "boards": LAMINATE["rows"] * LAMINATE["per_row"],
            "out": LAMINATE["out"], "reduce": round(math.log2(size / LAMINATE["out"]))}


def lay_herringbone_source(grain: dict, rng: random.Random) -> dict:
    """The axis-aligned herringbone, exactly one square period wide. The lattice generated by (L,-L) and (W,W) has
    square period 2L; `repeat` copies of it are laid with independent boards, so the period is 2L*repeat."""
    length, width = HERRINGBONE["plank"]
    W = round(width * PX_PER_M)
    ratio = round(length / width)
    L = W * ratio  # keep the exact integer ratio the lattice needs
    period = 2 * L * HERRINGBONE["repeat"]
    strips = usable_strips(grain_strips(grain), L, W)
    canvas, mask = blank(period), np.full((period, period), 255, np.uint8)
    seen = set()
    for a in range(2 * HERRINGBONE["repeat"]):
        for b in range(2 * ratio * HERRINGBONE["repeat"]):
            x, y = (a * L + b * W) % period, (-a * L + b * W) % period
            if (x, y) in seen:
                continue
            seen.add((x, y))
            paste_wrapped(canvas, plank_patch(strips, L, W, rng), x, y)
            groove_rect(mask, x, y, L, W)
            paste_wrapped(canvas, plank_patch(strips, L, W, rng), x, y + W, rotate=True)
            groove_rect(mask, x, y + W, W, L)
    covered = len(seen) * 2 * L * W
    assert covered == period * period, f"the herringbone lattice does not tile its period ({covered} of {period ** 2})"
    return {"maps": canvas, "grooves": mask, "period": period, "boards": len(seen) * 2}


def warp45(source: dict, grooves: np.ndarray, period: int, out_px: int) -> tuple[dict, np.ndarray]:
    """Rotate the axis-aligned tile 45 degrees onto an exactly periodic out_px square.

    Output (u,v) reads source (x,y) = ((u+v)/sqrt2, (v-u)/sqrt2) with wraparound, and one output tile spans
    u,v in [0, period*sqrt2). Stepping a whole tile (u += period*sqrt2) therefore steps the source by exactly
    (+period, -period) - a lattice vector, and zero modulo the period. No rounding, no crop, at any out_px.
    """
    stack = np.concatenate([source["color"], source["normal"], source["rough"][..., None], grooves[..., None]], axis=2)
    span, root = out_px * SUPERSAMPLE, math.sqrt(2)
    scale = period * root / span
    out = np.empty((out_px, out_px, stack.shape[2]), np.float32)
    columns = (np.arange(span) + .5) * scale
    block = SUPERSAMPLE * 64
    for start in range(0, span, block):
        rows = (np.arange(start, min(span, start + block)) + .5) * scale
        u, v = np.meshgrid(columns, rows)
        x, y = (u + v) / root, (v - u) / root
        x0, y0 = np.floor(x), np.floor(y)
        fx = (x - x0)[..., None].astype(np.float32)
        fy = (y - y0)[..., None].astype(np.float32)
        x0, y0 = x0.astype(np.int64) % period, y0.astype(np.int64) % period
        x1, y1 = (x0 + 1) % period, (y0 + 1) % period
        top = stack[y0, x0] * (1 - fx) + stack[y0, x1] * fx
        bottom = stack[y1, x0] * (1 - fx) + stack[y1, x1] * fx
        chunk = reduce2(top * (1 - fy) + bottom * fy, round(math.log2(SUPERSAMPLE)))
        out[start // SUPERSAMPLE:start // SUPERSAMPLE + chunk.shape[0]] = chunk
    maps = {"color": out[..., 0:3], "normal": out[..., 3:6], "rough": out[..., 6]}
    # The warp turns the image 45 degrees, so the grain normal's tangent-space XY turns with it. In the OpenGL
    # convention the green channel points up the image (-row), so with u=(x-y)/sqrt2, v=(x+y)/sqrt2 the encoded
    # pair maps to ((nx+ny)/sqrt2, (ny-nx)/sqrt2). The groove normals are rebuilt from the warped height afterwards
    # and need no correction. Leaving this out is what makes a rotated parquet light from the wrong side.
    nx, ny = maps["normal"][..., 0] / 255 * 2 - 1, maps["normal"][..., 1] / 255 * 2 - 1
    maps["normal"][..., 0] = np.clip(((nx + ny) / root + 1) / 2 * 255, 0, 255)
    maps["normal"][..., 1] = np.clip(((ny - nx) / root + 1) / 2 * 255, 0, 255)
    return maps, out[..., 7]


def lay_herringbone(grain: dict, rng: random.Random) -> dict:
    source = lay_herringbone_source(grain, rng)
    maps, grooves = warp45(source["maps"], source["grooves"], source["period"], HERRINGBONE["out"])
    return {"maps": maps, "grooves": grooves, "size_m": source["period"] * math.sqrt(2) / PX_PER_M,
            "boards": source["boards"], "out": HERRINGBONE["out"], "reduce": 0}


# ------------------------------------------------------------------------------------------------------ finishing

def grade(array: np.ndarray) -> np.ndarray:
    """Lift the grain's contrast and chroma first, then match the mean to the target tone, so the tone match is a
    translation of an already lively image instead of a bleaching multiply."""
    weights = np.array([.2126, .7152, .0722], np.float32)
    mean = array.reshape(-1, 3).mean(axis=0)
    array = mean + (array - mean) * CONTRAST
    luma = (array * weights).sum(axis=2, keepdims=True)
    array = np.clip(luma + (array - luma) * SATURATION, 0, 255)
    array = array * (np.array(TARGET_TONE, np.float32) / np.maximum(array.reshape(-1, 3).mean(axis=0), 1e-3))
    return np.clip(array, 0, 255)


def finish(layout: dict) -> dict:
    """Bake the joints into colour, normal, roughness and ambient occlusion, all at the tile's own resolution."""
    maps = {key: reduce2(array, layout["reduce"]) for key, array in layout["maps"].items()}
    grooves = reduce2(layout["grooves"], layout["reduce"])
    px_per_m = maps["color"].shape[0] / layout["size_m"]
    scale = px_per_m / PX_PER_M  # working px -> output px

    colour = grade(maps["color"])
    mask = wrapped_blur(grooves, BLUR[0] * scale) / 255
    colour = np.clip(colour * (GROOVE + (1 - GROOVE) * mask)[..., None], 0, 255)

    height = wrapped_blur(grooves, BLUR[1] * scale) / 255
    grain_normal = maps["normal"] / 255 * 2 - 1
    dy, dx = np.gradient(np.pad(height, 1, mode="wrap"))
    dx, dy = dx[1:-1, 1:-1] * px_per_m, dy[1:-1, 1:-1] * px_per_m  # per metre, so the slope is resolution-free
    normal = np.stack([-dx * NORMAL_STRENGTH + grain_normal[..., 0] * .35,
                       -dy * NORMAL_STRENGTH + grain_normal[..., 1] * .35, np.ones_like(height)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)

    rough = np.clip(.78 + maps["rough"] / 255 * .10 + (1 - mask) * .12, 0, 1)
    occlusion = np.clip(.55 + .45 * wrapped_blur(grooves, BLUR[2] * scale) / 255, 0, 1)

    out = {"diffuse": colour, "nor_gl": np.clip((normal + 1) / 2, 0, 1) * 255,
           "rough": np.repeat((rough * 255)[..., None], 3, axis=2),
           "ao": np.repeat((occlusion * 255)[..., None], 3, axis=2)}
    # Roughness is nearly flat - a board value plus a touch more in the joints - so it ships at half the colour size.
    # Ambient occlusion does NOT: it is the joint shading, and a 1.7 mm joint is already under a pixel at half size.
    out["rough"] = reduce2(out["rough"])
    return {key: Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), "RGB") for key, array in out.items()}


def encode(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=QUALITY, optimize=True, subsampling=0)
    return buffer.getvalue()


def write(data: bytes, target: Path) -> dict:
    target.write_bytes(data)
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


# ------------------------------------------------------------------------------------------------------------ run

def main() -> int:
    today = dt.date.today().isoformat()
    grain = grain_maps()
    print("clean grain bands:", [tuple(s["color"].shape[:2]) for s in grain_strips(grain)])
    entries = []
    plans = [("laminate_floor", lay_laminate(grain, random.Random(20260916)),
              "120 x 20 cm boards, wandering joints, 2 x 12 boards per tile"),
             ("parquet_herringbone", lay_herringbone(grain, random.Random(20260917)),
              "60 x 15 cm boards, single herringbone, 2 x 2 lattice periods rotated 45 degrees")]
    for name, layout, note in plans:
        maps = finish(layout)
        size_m = round(layout["size_m"], 4)
        for suffix, image in maps.items():
            data = encode(image)
            target = MATERIALS / f"{name}_{suffix}.jpg"
            row = {"file": target.name, "origin": SOURCE.format(role=SOURCE_ROLE[suffix]),
                   "sources": [SOURCE.format(role=role) for role in ("diff", "nor_gl", "rough")],
                   "assetPage": ASSET_PAGE,
                   "license": "CC0-1.0", "licenseUrl": "https://polyhaven.com/license", **write(data, target),
                   "role": suffix, "resolution": f"{image.width}px generated", "downloaded": today,
                   "physicalSizeM": size_m, "publishedSizeM": GRAIN_SIZE_M,
                   "derived": f"re-laid from the laminate_floor_02 oak grain at {PX_PER_M}px/m: {note}; "
                              f"{layout['boards']} boards per tile, laid modulo the tile so it wraps exactly; "
                              f"{DERIVED[suffix].format(tone=TARGET_TONE, contrast=CONTRAST, saturation=SATURATION)}"}
            if suffix == "diffuse":
                # The tone the floor actually ships with, measured off the encoded file rather than off the target,
                # so a grading regression is visible in the manifest and testable without a JPEG decoder in Node.
                # scripts/check_floor_tiling.py re-measures the pixels against this number from the other side.
                mean = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), np.float64).reshape(-1, 3).mean(axis=0)
                row["meanSRGB"] = [round(float(channel), 1) for channel in mean]
            entries.append(row)
            print(f"wrote {target.name:34s} {row['bytes']:8d} bytes  {image.width:4d}px  tile {size_m} m  "
                  f"{image.width / size_m:.0f} px/m" + (f"  mean {row['meanSRGB']}" if "meanSRGB" in row else ""))
            if suffix == "ao":
                continue
            ladder = image if max(image.size) <= LADDER_SIZE else image.resize((LADDER_SIZE, LADDER_SIZE), Image.LANCZOS)
            ladder_target = MATERIALS / f"{target.stem}_{LADDER_SIZE}.jpg"
            ladder_data = encode(ladder)
            ladder_row = {**row, "file": ladder_target.name, **write(ladder_data, ladder_target),
                          "resolution": f"{image.width}px resized to {LADDER_SIZE}px",
                          "derived": f"compact-tier variant of {target.name} (sha256 {row['sha256']})"}
            if "meanSRGB" in ladder_row:  # measured on the compact file itself, never inherited from its parent
                mean = np.asarray(Image.open(io.BytesIO(ladder_data)).convert("RGB"), np.float64).reshape(-1, 3).mean(axis=0)
                ladder_row["meanSRGB"] = [round(float(channel), 1) for channel in mean]
            entries.append(ladder_row)
            print(f"wrote {ladder_target.name:34s} {ladder_row['bytes']:8d} bytes  {LADDER_SIZE:4d}px")

    provenance = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    index = {row["file"]: position for position, row in enumerate(provenance["assets"])}
    for row in entries:
        if row["file"] in index:
            provenance["assets"][index[row["file"]]] = row
        else:
            provenance["assets"].append(row)
    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("provenance entries:", len(provenance["assets"]), "| floor bytes:", sum(row["bytes"] for row in entries))
    return 0


if __name__ == "__main__":
    sys.exit(main())

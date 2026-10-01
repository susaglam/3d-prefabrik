"""Derive the black / white / yellow brick albedos and the wood facade albedo from the scans already shipped.

WHY DERIVE RATHER THAN DOWNLOAD (decided 2026-09-17, after looking at the candidates)
--------------------------------------------------------------------------------------
Until 2.9.4 only "Baksteen rood" was a photographic scan (Poly Haven red_brick_03); the other three bricks fell back
to a canvas-drawn pattern with a bumpMap made of itself and no roughness map, which is why a customer asked why the
red one looks real and the others do not.

Two honest routes existed. (a) Download a separate CC0 scan per colour. The pool was surveyed
(`https://api.polyhaven.com/assets?t=textures&c=brick`, 107 textures, and
`https://ambientcg.com/api/v2/full_json?q=brick&type=Material`, 31 materials) and the plausible ones rendered into a
contact sheet: Poly Haven yellow_brick (2.0 m tile, heavily mottled and grimy), whitewashed_brick (2.0 m, fine
weathered module), brick_wall_10 (1.9 m, dark aubergine), white_bricks (peeling paint), plus ambientCG Bricks072
(150x75 cm modern yellow), Bricks060 (105 cm white) and Bricks061/089 (grey, medieval bonds). Every one of them
carries its OWN bond, brick module, tile size and weathering: put side by side in a picker they read as four
different BUILDINGS, when what the customer is comparing is one wall in four clay colours. They would also have cost
roughly 5-7 MB of extra downloads (three sets x colour/normal/roughness).
(b) Keep red_brick_03 as the wall itself - its bond, its mortar layout, its relief and its roughness - and recolour
only the clay. One bond, one brick size, one weathering pattern, one page-weight item per colour (the albedo), and
the four swatches stay honestly comparable. That is what this script does.

The wood facades had the mirror-image problem: they already used the wood_floor_deck normal and roughness, but their
COLOUR was procedural, because that scan's own diffuse is a dark varnished floor. It is retoned here into an oiled
timber cladding instead of being thrown away, so the albedo registers pixel for pixel with the relief that ships.

HOW THE CLAY IS SEPARATED FROM THE MORTAR
-----------------------------------------
Tinting the whole image would have turned the joints into coloured mortar. The mask is built from two independent
signals and only agrees where both do:
  * saturation - the clay is chromatic, the mortar is grey;
  * a height map integrated from the scan's OWN normal map (Frankot-Chellappa, FFT Poisson solve), high-passed to
    drop the low-frequency drift the solve leaves behind - the mortar is the RECESSED part.
Saturation alone calls every sooty brick head mortar; the height alone calls every chipped arris mortar. The product
of the two is written out as `docs/verification/2.9/facade-brick-mortar-mask.png` on every run, so the separation is
something you look at rather than something you hope for.

Clay pixels are then gradient-mapped: the brick's own luminance (normalised over the clay pixels only) picks a
colour along a three-point ramp in CIELAB, so every brick keeps its own lightness and the wall still reads as many
individual bricks rather than one flat colour. A fraction of the scan's own chroma deviation is added back on top so
the bricks keep differing from each other in warmth. Mortar pixels keep their own lightness and are neutralised to a
light grey (red / black / yellow); for white brick they are lifted most of the way to the brick tone, which is how
white Dutch facades are actually pointed.

Everything here is a per-pixel operation and every blur wraps around the edges (FFT), so the tiles stay seamless.

Run from the repository root:  python scripts/prepare_facade_textures.py
Idempotent: it reads the shipped scans, rewrites the derived maps and their 512 px siblings, and replaces its own
rows in provenance.json. It downloads nothing. scripts/prepare_surface_textures.py deliberately skips these files
(they are recorded with fields its generic ladder builder knows nothing about) - see its OWNED_ELSEWHERE note.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFile

ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 8 << 20)

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / "addons" / "cs_prefab_configurator" / "static" / "src" / "assets" / "materials"
PROVENANCE = MATERIALS / "provenance.json"
MASK_PROOF = ROOT / "docs" / "verification" / "2.9" / "facade-brick-mortar-mask.png"
SIZE = 1024
LADDER_SIZE = 512
QUALITY = 88

# The scans these are derived from, and the tile each is MAPPED at in preview.js (physicalSizeM) next to the tile
# Poly Haven published it at (publishedSizeM). The brick tile is mapped at 0.88 m, which puts the scan's 14 courses
# at 63 mm - Dutch waalformaat (50 mm brick + 12.5 mm joint). The deck is mapped at 1.44 m, which puts its 12 boards
# at 120 mm, the exact pitch preview.js draws the cladding grooves at.
BRICK_SOURCE = {
    "file": "red_brick_03_diffuse.jpg",
    "normal": "red_brick_03_nor_gl.jpg",
    "assetPage": "https://polyhaven.com/a/red_brick_03",
    "origin": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/red_brick_03/red_brick_03_diff_1k.jpg",
    "physicalSizeM": 0.88,
    "publishedSizeM": 1.0,
}
WOOD_SOURCE = {
    "file": "wood_floor_deck_diffuse.jpg",
    "assetPage": "https://polyhaven.com/a/wood_floor_deck",
    "origin": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor_deck/wood_floor_deck_diff_1k.jpg",
    "physicalSizeM": 1.44,
    "publishedSizeM": 1.8,
}
LICENSE = {"license": "CC0-1.0", "licenseUrl": "https://polyhaven.com/license"}

# Mask tuning. `sat` and `height` are the two windows the signals are stretched over before they are multiplied;
# both are normalised to their own percentiles first, so these are percentile positions, not raw values.
MASK = {"satLow": 0.18, "satHigh": 0.55, "heightLow": 0.30, "heightHigh": 0.62, "blurPx": 1.6, "detailPx": 48}

# Three-point CIELAB ramps, written as the sRGB hex of the darkest brick, the average brick and the lightest brick.
# Real Dutch facing bricks: a dark anthracite that is never flat black, a chalky white, a warm sand yellow.
BRICKS = (
    {
        "name": "brick_black",
        "label": "Baksteen zwart",
        "ramp": ("#1f1f1d", "#3d3c37", "#615d54"),
        "contrast": 1.05,
        "chroma": 0.22,
        "mortar": {"mode": "grey", "lShift": 2.0, "chroma": 0.22},
        "note": "dark anthracite facing brick (genuanceerd zwart), light grey joint",
    },
    {
        "name": "brick_white",
        "label": "Baksteen wit",
        "ramp": ("#a8a398", "#d5d1c7", "#f1eee6"),
        "contrast": 0.95,
        "chroma": 0.2,
        "mortar": {"mode": "match", "blend": 0.55, "lShift": 0.0, "chroma": 0.2},
        "note": "chalky white handvorm brick, pointed close to the brick itself",
    },
    {
        "name": "brick_yellow",
        "label": "Baksteen geel",
        "ramp": ("#836a3d", "#bda471", "#ded0a6"),
        "contrast": 1.05,
        "chroma": 0.42,
        "mortar": {"mode": "grey", "lShift": 3.0, "chroma": 0.22},
        "note": "warm sand-yellow facing brick (geel genuanceerd), light grey joint",
    },
)

WOOD = {
    "name": "wood_facade",
    "label": "Houten gevelbekleding",
    "ramp": ("#4c3927", "#b18b5c", "#e0c69a"),
    "contrast": 0.85,
    "chroma": 0.26,
    "note": "oiled timber cladding retoned from the varnished deck scan whose normal and roughness maps already ship",
}


# ---------------------------------------------------------------------------------------------------------------
# colour space helpers (sRGB <-> linear <-> CIELAB, D65), vectorised over an H x W x 3 array in 0..1
# ---------------------------------------------------------------------------------------------------------------
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_MI = np.linalg.inv(_M)
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb):
    xyz = srgb_to_linear(rgb) @ _M.T / _WHITE
    f = np.where(xyz > 0.008856, np.cbrt(np.maximum(xyz, 1e-12)), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def lab_to_rgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * _WHITE
    return linear_to_srgb(xyz @ _MI.T)


def hex_to_lab(value):
    rgb = np.array([int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]).reshape(1, 1, 3)
    return rgb_to_lab(rgb)[0, 0]


def mean_srgb(rgb):
    return [round(float(v) * 255, 1) for v in rgb.reshape(-1, 3).mean(axis=0)]


# ---------------------------------------------------------------------------------------------------------------
# image helpers - every blur WRAPS, so a seamless tile stays seamless
# ---------------------------------------------------------------------------------------------------------------
def blur(image, sigma):
    if sigma <= 0:
        return image
    h, w = image.shape[:2]
    fy = np.fft.fftfreq(h).reshape(-1, 1)
    fx = np.fft.fftfreq(w).reshape(1, -1)
    kernel = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    if image.ndim == 3:
        kernel = kernel[..., None]
    return np.real(np.fft.ifft2(np.fft.fft2(image, axes=(0, 1)) * kernel, axes=(0, 1)))


def normalise(values, low=2, high=98):
    lo, hi = np.percentile(values, [low, high])
    return np.clip((values - lo) / max(hi - lo, 1e-6), 0, 1)


def smoothstep(values, low, high):
    t = np.clip((values - low) / max(high - low, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def height_from_normal(normal):
    """Frankot-Chellappa: the least-squares height whose gradient best matches an OpenGL (green-up) normal map."""
    nx = normal[..., 0] * 2 - 1
    ny = normal[..., 1] * 2 - 1
    nz = np.clip(normal[..., 2] * 2 - 1, 1e-3, None)
    p, q = -nx / nz, ny / nz          # image rows grow downward, the green channel points up -> q keeps ny's sign
    h, w = nx.shape
    fx = np.fft.fftfreq(w).reshape(1, -1)
    fy = np.fft.fftfreq(h).reshape(-1, 1)
    denom = (2 * np.pi * fx) ** 2 + (2 * np.pi * fy) ** 2
    denom[0, 0] = 1
    field = (-1j * 2 * np.pi * fx * np.fft.fft2(p) + -1j * 2 * np.pi * fy * np.fft.fft2(q)) / denom
    field[0, 0] = 0
    return np.real(np.fft.ifft2(field))


def mortar_mask(diffuse, normal):
    """1 where the wall is mortar, 0 where it is clay: low saturation AND recessed, each normalised on its own."""
    smooth = blur(diffuse, 1.0)
    mx, mn = smooth.max(axis=2), smooth.min(axis=2)
    saturation = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    height = height_from_normal(normal)
    height = height - blur(height, MASK["detailPx"])          # drop the drift the Poisson solve leaves behind
    # A pixel is mortar only where BOTH signals say so. Multiplying the two MORTAR scores (rather than the two clay
    # scores) is what makes the second signal a corroboration: the chalky efflorescence on a brick face is
    # desaturated but raised, the sooty header is recessed but chromatic, and neither survives the product.
    by_saturation = 1 - smoothstep(normalise(saturation), MASK["satLow"], MASK["satHigh"])
    by_relief = 1 - smoothstep(normalise(height), MASK["heightLow"], MASK["heightHigh"])
    return np.clip(blur(by_saturation * by_relief, MASK["blurPx"]), 0, 1)


def gradient_map(lab, weight, ramp, contrast, chroma):
    """Re-colour `lab` along a three-point ramp, driven by its own lightness; `weight` says which pixels count."""
    total = max(float(weight.sum()), 1e-6)
    lightness = lab[..., 0]
    lo, mid, hi = (np.percentile(lightness[weight > 0.5], p) for p in (2, 50, 98))
    t = np.clip((lightness - lo) / max(hi - lo, 1e-6), 0, 1)
    pivot = np.clip((mid - lo) / max(hi - lo, 1e-6), 0.05, 0.95)
    t = np.where(t < pivot, 0.5 * t / pivot, 0.5 + 0.5 * (t - pivot) / (1 - pivot))     # median lands mid-ramp
    t = np.clip(0.5 + (t - 0.5) * contrast, 0, 1)
    anchors = np.stack([hex_to_lab(value) for value in ramp])                            # 3 x 3 (L, a, b)
    out = np.empty_like(lab)
    for channel in range(3):
        out[..., channel] = np.interp(t, [0.0, 0.5, 1.0], anchors[:, channel])
    for channel in (1, 2):                                                               # keep brick-to-brick warmth
        mean = float((lab[..., channel] * weight).sum() / total)
        out[..., channel] += chroma * (lab[..., channel] - mean)
    return out


def neutral_mortar(lab, spec, clay_lab=None):
    out = lab.copy()
    out[..., 0] = lab[..., 0] + spec["lShift"]
    out[..., 1] = lab[..., 1] * spec["chroma"]
    out[..., 2] = lab[..., 2] * spec["chroma"]
    if spec["mode"] == "match" and clay_lab is not None:
        blend = spec["blend"]
        out = out * (1 - blend) + clay_lab * blend
    return out


def encode(image, size):
    if image.size != (size, size):
        image = image.resize((size, size), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=QUALITY, optimize=True, subsampling=0)
    return buffer.getvalue()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_pair(name, rgb, source, today, derived, label):
    """Write <name>_diffuse.jpg and its 512 px sibling, and return both provenance rows."""
    image = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    rows = []
    for size, suffix, resolution in ((SIZE, "", f"1k scan derived at {SIZE}px"),
                                     (LADDER_SIZE, "_512", f"{SIZE}px resized to {LADDER_SIZE}px")):
        data = encode(image, size)
        target = MATERIALS / f"{name}_diffuse{suffix}.jpg"
        target.write_bytes(data)
        row = {"file": target.name, "origin": source["origin"], "assetPage": source["assetPage"], **LICENSE,
               "sha256": sha256(data), "bytes": len(data), "role": "diffuse", "resolution": resolution,
               "downloaded": today, "physicalSizeM": source["physicalSizeM"],
               "publishedSizeM": source["publishedSizeM"],
               "derived": derived if not suffix else f"compact-tier variant of {name}_diffuse.jpg ({derived})",
               "meanSRGB": mean_srgb(rgb), "note": label}
        rows.append(row)
        print(f"wrote {target.name} {len(data)} bytes  mean sRGB {row['meanSRGB']}")
    return rows


def merge(provenance, rows):
    assets = provenance["assets"]
    index = {row["file"]: position for position, row in enumerate(assets)}
    for row in rows:
        if row["file"] in index:
            assets[index[row["file"]]] = row
        else:
            index[row["file"]] = len(assets)
            assets.append(row)


def annotate_source_rows(provenance):
    """Record on the two parent scans the tile preview.js maps them at, so the pair travels with every sibling."""
    sizes = {"red_brick_03": BRICK_SOURCE, "wood_floor_deck": WOOD_SOURCE}
    for row in provenance["assets"]:
        for prefix, source in sizes.items():
            if row["file"].startswith(f"{prefix}_"):
                row["physicalSizeM"] = source["physicalSizeM"]
                row["publishedSizeM"] = source["publishedSizeM"]


def main() -> int:
    today = dt.date.today().isoformat()
    provenance = json.loads(PROVENANCE.read_text(encoding="utf-8"))

    brick_bytes = (MATERIALS / BRICK_SOURCE["file"]).read_bytes()
    brick = np.asarray(Image.open(io.BytesIO(brick_bytes)).convert("RGB"), dtype=np.float64) / 255
    normal = np.asarray(Image.open(MATERIALS / BRICK_SOURCE["normal"]).convert("RGB"), dtype=np.float64) / 255
    mask = mortar_mask(brick, normal)
    MASK_PROOF.parent.mkdir(parents=True, exist_ok=True)
    proof = np.concatenate([(brick * 255).astype(np.uint8),
                            np.repeat((mask[..., None] * 255).astype(np.uint8), 3, axis=2),
                            (np.clip(brick * (0.25 + 0.75 * (1 - mask[..., None])) +
                                     mask[..., None] * np.array([0.0, 0.9, 0.4]) * 0.55, 0, 1) * 255).astype(np.uint8)], axis=1)
    # Half size: three 512 px panels still show every joint, and keep the proof in line with the other PNGs in the folder.
    Image.fromarray(proof).resize((proof.shape[1] // 2, proof.shape[0] // 2), Image.LANCZOS).save(MASK_PROOF)
    print(f"mortar mask: {mask.mean() * 100:.1f}% of the wall; proof sheet -> {MASK_PROOF.relative_to(ROOT)}")

    lab = rgb_to_lab(brick)
    clay_weight = 1 - mask
    rows = []
    source_sha = sha256(brick_bytes)
    for spec in BRICKS:
        clay = gradient_map(lab, clay_weight, spec["ramp"], spec["contrast"], spec["chroma"])
        joint = neutral_mortar(lab, spec["mortar"], clay)
        blended = clay * (1 - mask[..., None]) + joint * mask[..., None]
        rgb = lab_to_rgb(blended)
        derived = (f"recoloured from {BRICK_SOURCE['file']} (sha256 {source_sha}): clay gradient-mapped in CIELAB to "
                   f"{'/'.join(spec['ramp'])} keeping its own lightness variation, mortar "
                   + ("lifted towards the brick" if spec["mortar"]["mode"] == "match" else "kept as a neutral light grey")
                   + "; mask = saturation x height-from-normal")
        rows.extend(write_pair(spec["name"], rgb, BRICK_SOURCE, today, derived, spec["note"]))
        clay_only = rgb.reshape(-1, 3)[(clay_weight > 0.5).reshape(-1)]
        joint_only = rgb.reshape(-1, 3)[(mask > 0.5).reshape(-1)]
        print(f"  {spec['name']}: clay mean {(clay_only.mean(axis=0) * 255).round(1)}  "
              f"joint mean {(joint_only.mean(axis=0) * 255).round(1)}")

    wood_bytes = (MATERIALS / WOOD_SOURCE["file"]).read_bytes()
    wood = np.asarray(Image.open(io.BytesIO(wood_bytes)).convert("RGB"), dtype=np.float64) / 255
    wood_lab = rgb_to_lab(wood)
    retoned = lab_to_rgb(gradient_map(wood_lab, np.ones(wood.shape[:2]), WOOD["ramp"], WOOD["contrast"], WOOD["chroma"]))
    derived = (f"retoned from {WOOD_SOURCE['file']} (sha256 {sha256(wood_bytes)}): the varnished deck gradient-mapped "
               f"in CIELAB to {'/'.join(WOOD['ramp'])}, board joints kept dark; relief and roughness stay the "
               f"wood_floor_deck scan's own maps")
    rows.extend(write_pair(WOOD["name"], retoned, WOOD_SOURCE, today, derived, WOOD["note"]))

    annotate_source_rows(provenance)
    merge(provenance, rows)
    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("provenance entries:", len(provenance["assets"]))
    print("derived set:", len(rows), "files,", sum(row["bytes"] for row in rows), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

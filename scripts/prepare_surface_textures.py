"""Fetch and prepare the CC0 surface scans for the realistic live view and build the 512 px compact-tier ladder.

New sets (all Poly Haven, CC0-1.0, 1k JPEG, written at 1024 px):
- interior_plaster  <- white_stucco (normal / roughness / AO only; the paint colour is the material tint), a seamless
  matte fine-grained stucco at a 2.0 m tile. The originally planned plastered_wall_02 is a PANELLED wall: its normal
  and AO maps carry four vertical joints per tile (a groove every 0.5 m on every interior wall), so it was rejected.
- concrete_screed   <- concrete_floor_worn_001 (diffuse / normal / roughness / AO), the most even light-grey floor
  scan of the candidates (smooth_concrete_floor is rust brown, concrete_floor_02 dark and pitted). Tile 3.0 m as
  published. The diffuse is brightness graded (x1.6, mean sRGB 86 -> ~138) towards a daylight cement screed.
- garden_fence      <- wood_planks_grey (diffuse / normal / roughness / AO): grey planed vertical planks like a Dutch
  schutting; weathered_plank_siding is dark rustic lap siding. Tile 1.5 m as published (five planks per tile, so map
  the fence at a 0.75 m period for 15 cm planks). The diffuse is brightness graded (x1.45, mean sRGB 70 -> ~100).

Compact-tier ladder: every colour / normal / roughness map in assets/materials (existing sets and the new ones) gets a
512 px sibling "<name>_512.jpg" resized from the canonical file on disk with the same JPEG settings. AO maps get no
512 variant (the compact tier skips AO). Sources that are already 512 px are copied byte-identically so the loader
can apply one rule ("<file>" -> "<file>_512.jpg") without special cases. The two FLOOR sets are the exception: since
2.9.x scripts/prepare_floor_textures.py writes their compact siblings itself, in the same step as the canonical maps,
because it records fields on those rows this builder would strip (see ladder_sources()).

Run from the repository root:  python scripts/prepare_surface_textures.py
Downloads are cached in .data/asset-cache (gitignored). Each downloaded file is checked against the md5 published by
the Poly Haven files API. The matching rows in provenance.json are replaced in place (new ones appended); the run is
idempotent and never re-downloads what the cache already holds.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFile

# JPEG `optimize=True` writes through a single block whose default size (64 kB) a high-entropy 1024 px scan overflows:
# Pillow then raises "broken data stream when writing image file" from encode_jpeg, on the map rather than on the run,
# so the failure looks like a corrupt download. The sedum / moss normal map hits it; the smoother sets never did.
ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 8 << 20)

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / "addons" / "cs_prefab_configurator" / "static" / "src" / "assets" / "materials"
PROVENANCE = MATERIALS / "provenance.json"
CACHE = ROOT / ".data" / "asset-cache"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cs-prefab-configurator asset preparation"
SIZE = 1024
LADDER_SIZE = 512
LADDER_SUFFIX = f"_{LADDER_SIZE}"
QUALITY = 88

API_FILES = "https://api.polyhaven.com/files/{asset}"
API_INFO = "https://api.polyhaven.com/info/{asset}"
ASSET_PAGE = "https://polyhaven.com/a/{asset}"
LICENSE = {"license": "CC0-1.0", "licenseUrl": "https://polyhaven.com/license"}

# Poly Haven role key in the files API -> local file suffix.
ROLES = {"Diffuse": "diffuse", "nor_gl": "nor_gl", "Rough": "rough", "AO": "ao"}
# Only these map kinds get a compact-tier sibling; "ao" is deliberately absent.
LADDER_KINDS = ("diffuse", "nor_gl", "rough")
# Owned by another generator, ladder included - see ladder_sources().
FLOOR_PREFIXES = ("laminate_floor_", "parquet_herringbone_")
FACADE_PREFIXES = ("brick_black_", "brick_white_", "brick_yellow_", "wood_facade_")
OWNED_ELSEWHERE = FLOOR_PREFIXES + FACADE_PREFIXES

SETS = (
    {
        "asset": "white_stucco",
        "prefix": "interior_plaster",
        "roles": ("nor_gl", "Rough", "AO"),
        "physicalSizeM": 2.0,
        "grade": None,
        "note": "interior stucwerk; no diffuse map, the paint colour comes from the material tint; seamless matte "
                "stucco chosen over plastered_wall_02, whose normal/AO maps carry four vertical panel joints per tile",
    },
    {
        "asset": "concrete_floor_worn_001",
        "prefix": "concrete_screed",
        "roles": ("Diffuse", "nor_gl", "Rough", "AO"),
        "physicalSizeM": None,
        "grade": {"brightness": 1.6},
        "note": "screed / kaal beton floor; chosen over smooth_concrete_floor (rust brown) and concrete_floor_02 "
                "(dark, pitted) as the most even light-grey scan",
    },
    {
        "asset": "wood_planks_grey",
        "prefix": "garden_fence",
        "roles": ("Diffuse", "nor_gl", "Rough", "AO"),
        "physicalSizeM": None,
        "grade": {"brightness": 1.45},
        "note": "garden fence (schutting); grey planed vertical planks (five per 1.5 m tile), chosen over "
                "weathered_plank_siding (dark rustic lap siding)",
    },
)


def fetch(url: str, name: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / name
    if cached.is_file():
        return cached.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        data = response.read()
    cached.write_bytes(data)
    return data


def fetch_json(url: str, name: str) -> dict:
    return json.loads(fetch(url, name).decode("utf-8"))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode_jpeg(image: Image.Image, size: int) -> bytes:
    """Resize to size x size (Lanczos) and encode with the project JPEG settings; greyscale sources stay greyscale."""
    if image.mode not in ("L", "RGB"):
        image = image.convert("RGB")
    if image.size != (size, size):
        image = image.resize((size, size), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=QUALITY, optimize=True, subsampling=0)
    return buffer.getvalue()


def published_size_m(asset: str) -> float | None:
    info = fetch_json(API_INFO.format(asset=asset), f"{asset}_info.json")
    dimensions = info.get("dimensions") or []
    if not dimensions:
        return None
    return round(float(dimensions[0]) / 1000.0, 3)


def prepare_set(spec: dict, today: str) -> list[dict]:
    asset, prefix = spec["asset"], spec["prefix"]
    files = fetch_json(API_FILES.format(asset=asset), f"{asset}_files.json")
    size_m = spec["physicalSizeM"] if spec["physicalSizeM"] is not None else published_size_m(asset)
    rows = []
    for role in spec["roles"]:
        record = files.get(role, {}).get("1k", {}).get("jpg")
        if not record:
            print(f"skip {asset} {role}: no 1k jpg published")
            continue
        url = record["url"]
        original = fetch(url, url.rsplit("/", 1)[-1])
        if record.get("md5") and hashlib.md5(original).hexdigest() != record["md5"]:
            raise SystemExit(f"{url}: md5 differs from the Poly Haven files API; delete the cached copy and retry")
        target = MATERIALS / f"{prefix}_{ROLES[role]}.jpg"
        image = Image.open(io.BytesIO(original))
        grade = spec.get("grade") if role == "Diffuse" else None
        if grade:
            image = ImageEnhance.Brightness(image.convert("RGB")).enhance(grade["brightness"])
        data = encode_jpeg(image, SIZE)
        target.write_bytes(data)
        row = {"file": target.name, "origin": url, "assetPage": ASSET_PAGE.format(asset=asset), **LICENSE,
               "originalSha256": sha256(original), "sha256": sha256(data), "bytes": len(data), "role": role,
               "resolution": f"1k resized to {SIZE}px", "downloaded": today, "physicalSizeM": size_m}
        if spec["physicalSizeM"] is not None:
            row["publishedSizeM"] = published_size_m(asset)
        if grade:
            row["derived"] = "colour graded: brightness {brightness}".format(**grade)
        row["note"] = spec["note"]
        rows.append(row)
        print("wrote", target.name, len(data), "bytes")
    return rows


def ladder_sources() -> list[Path]:
    """Every canonical colour / normal / roughness map on disk (never an AO map, never an existing _512 file).

    The two floor sets are excluded: scripts/prepare_floor_textures.py writes their compact siblings in the same
    step that writes the canonical maps, and it records two extra fields on those rows (`publishedSizeM`, the mean
    sRGB the floor actually ships with) that this builder knows nothing about. Two owners for one file means the
    second run silently strips what the first one recorded, so the floor script owns its own ladder outright.
    The three recoloured bricks and the retoned wood facade (scripts/prepare_facade_textures.py, 2.9.4) are excluded
    for exactly the same reason: their rows carry `meanSRGB` and a `derived` note describing the recolour.
    """
    sources = []
    for path in sorted(MATERIALS.glob("*.jpg")):
        if path.stem.endswith(LADDER_SUFFIX) or path.name.startswith(OWNED_ELSEWHERE):
            continue
        if any(path.stem.endswith(f"_{kind}") for kind in LADDER_KINDS):
            sources.append(path)
    return sources


def build_ladder(by_file: dict[str, dict], today: str) -> list[dict]:
    rows = []
    for source in ladder_sources():
        parent = by_file.get(source.name)
        if parent is None:
            raise SystemExit(f"{source.name} has no provenance row; record the canonical asset before deriving from it")
        original = source.read_bytes()
        image = Image.open(io.BytesIO(original))
        if max(image.size) <= LADDER_SIZE:
            data, how = original, f"{image.size[0]}px byte-identical copy"
        else:
            data, how = encode_jpeg(image, LADDER_SIZE), f"{image.size[0]}px resized to {LADDER_SIZE}px"
        target = MATERIALS / f"{source.stem}{LADDER_SUFFIX}.jpg"
        target.write_bytes(data)
        row = {"file": target.name, "origin": parent["origin"], "assetPage": parent["assetPage"],
               "license": parent["license"], "licenseUrl": parent["licenseUrl"], "sha256": sha256(data),
               "bytes": len(data), "role": parent["role"], "resolution": how, "downloaded": today}
        # Both size fields travel, not just the first: physicalSizeM is the period preview.js maps the map at and
        # publishedSizeM the tile the scan was published at, and a compact sibling is mapped at exactly the same
        # period as its parent. Carrying only one of the pair silently dropped publishedSizeM from the sedum and
        # ballast _512 rows on every re-run (the green-roof test only asserts the pair on the canonical maps).
        for field in ("physicalSizeM", "publishedSizeM"):
            if field in parent:
                row[field] = parent[field]
        row["derived"] = f"compact-tier variant of {source.name} (sha256 {sha256(original)})"
        rows.append(row)
        print("wrote", target.name, len(data), "bytes")
    return rows


def merge(provenance: dict, rows: list[dict]) -> None:
    assets = provenance["assets"]
    index = {row["file"]: position for position, row in enumerate(assets)}
    for row in rows:
        if row["file"] in index:
            assets[index[row["file"]]] = row
        else:
            index[row["file"]] = len(assets)
            assets.append(row)


def main() -> int:
    today = dt.date.today().isoformat()
    provenance = json.loads(PROVENANCE.read_text(encoding="utf-8"))

    desktop = []
    for spec in SETS:
        desktop.extend(prepare_set(spec, today))
    merge(provenance, desktop)

    by_file = {row["file"]: row for row in provenance["assets"]}
    ladder = build_ladder(by_file, today)
    merge(provenance, ladder)

    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("provenance entries:", len(provenance["assets"]))
    print("desktop set:", len(desktop), "files,", sum(row["bytes"] for row in desktop), "bytes")
    print("512 ladder:", len(ladder), "files,", sum(row["bytes"] for row in ladder), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

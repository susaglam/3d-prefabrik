"""Fetch and prepare the CC0 scans the sedum roof is made of, and their 512 px compact siblings.

Two sets, both ambientCG, both CC0-1.0, 1k JPEG:

- sedum_mat  <- Moss001. The green roof used a procedural canvas texture of round cushions, which the customer read
  as "loose green and pink blobs on brown soil" rather than a planted mat. Neither catalogue publishes a sedum or
  succulent ground cover: `https://api.polyhaven.com/assets?t=textures` (861 textures, 2026-09-16) has no moss or
  sedum ground scan at all - its "moss" tag sits only on rock, brick and cobblestone - and ambientCG's
  `https://ambientcg.com/api/v2/full_json?q=moss&type=Material` returns 49 hits of which only Moss001-004 are ground
  covers. Moss002/003/004 are deep, uniform cushion moss: one saturated dark green, no colour variation. Moss001 is a
  dense low ground-cover mat with exactly the spread a sedum mix has - grey-green through olive and yellow-green with
  reddish-brown rosettes and flecks - so it is the one scan in either catalogue that reads as a planted mat.
- roof_ballast <- Gravel023. The ballast strip used to borrow the terrace scan, which is a SMOOTH fine-grained taupe
  concrete tile with no aggregate in it at all: at any tint it read as a wide brown border, which was the "brown soil"
  half of the same complaint. Gravel023 is clean light rounded pebbles, the 16/32 river gravel a Dutch roof edge is
  actually ballasted with, and it tiles without a visible repeat (checked at 3 x 3). Gravel026 is dirty grey-brown with
  near-black stones, Gravel038 is pink sand; both were rejected on look.

Deliberate departures, all recorded in the provenance rows:

- Each set is mapped at a period of its own (see `mappedSizeM`), not at the scan's published tile. The sedum mat runs
  at 0.90 m against a published 0.45 m: that takes the rosettes from moss scale (5-10 mm) to sedum scale (10-20 mm)
  and drops the repeat over a 5 x 3 m roof from 11 x 7 tiles to 5.5 x 3.3, which is what made the old mat read as a
  pattern from the top-down view. The ballast runs at 0.55 m against a published 1.50 m, which takes the pebbles down
  to the 20-40 mm of real roof ballast.
- The sedum colour map is graded towards a Dutch sedum mix with a white balance (per-channel gains) that pulls the red down,
  taking the scan off its forest-floor yellow and onto the grey-green of sedum album / sexangulare without
  touching the reddish rosettes that carry the mix. Its near-white specks are healed away (see heal_specks): a tiled
  map repeats them on a grid, and that grid is what a viewer reads as "a pattern" from the top-down roof view.
- Only the sedum colour map is written at the 1024 px the Poly Haven sets use - it is the map that carries the read
  and the one a user can zoom into. Every other map is written at 512 px, which is still well above the screen
  sampling of the top-down roof view, and keeps both sets together at about 2.2 MB instead of 4.5 MB.

ambientCG serves its zips only to a browser-shaped request (a bare urllib call gets 404), so the User-Agent and the
asset-page Referer below are required, not cosmetic.

Run from the repository root:  python scripts/prepare_green_roof_textures.py
Downloads are cached in .data/asset-cache (gitignored); the run is idempotent and never re-downloads.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Same encoder, same sizes, same provenance merge as the Poly Haven sets, so one rule covers every material on disk.
from prepare_surface_textures import (  # noqa: E402
    CACHE,
    LADDER_SIZE,
    LADDER_SUFFIX,
    MATERIALS,
    PROVENANCE,
    SIZE,
    encode_jpeg,
    merge,
    sha256,
)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
LICENSE = {"license": "CC0-1.0", "licenseUrl": "https://docs.ambientcg.com/books/website/page/licensing"}
# zip member suffix -> local file suffix, provenance role.
MAPS = {"diffuse": ("_Color.jpg", "Color"), "nor_gl": ("_NormalGL.jpg", "NormalGL"),
        "rough": ("_Roughness.jpg", "Roughness"), "ao": ("_AmbientOcclusion.jpg", "AmbientOcclusion")}
GRADE = {"saturation": 0.95, "gain": (0.86, 1.0, 0.92), "speckFraction": 0.006}

SETS = (
    {
        "asset": "Moss001",
        "prefix": "sedum_mat",
        # (map kind, written size). Only the colour map earns the full 1024 px.
        "maps": (("diffuse", SIZE), ("nor_gl", LADDER_SIZE), ("rough", LADDER_SIZE), ("ao", LADDER_SIZE)),
        "publishedSizeM": 0.45,
        "mappedSizeM": 0.90,
        "grade": True,
        "note": "sedum mix mat for the green roof; the one ground-cover scan in either CC0 catalogue with the "
                "grey-green / olive / reddish spread of a sedum mix (Poly Haven publishes none, ambientCG's "
                "Moss002-004 are uniform dark cushion moss). Published tile 0.45 m, mapped at 0.90 m so the rosettes "
                "read at sedum scale (10-20 mm) and a 5 x 3 m roof carries 5.5 x 3.3 tiles instead of 11 x 7",
    },
    {
        "asset": "Gravel023",
        "prefix": "roof_ballast",
        "maps": (("diffuse", LADDER_SIZE), ("nor_gl", LADDER_SIZE)),
        "publishedSizeM": 1.50,
        "mappedSizeM": 0.55,
        "grade": False,
        "note": "16/32 river gravel for the ballast strip along the roof edge and around the rooflight kerb; replaces "
                "the terrace paving scan, which carries no aggregate and read as a brown border. Published tile "
                "1.50 m, mapped at 0.55 m so the pebbles read at 20-40 mm. Roughness and AO are not shipped: loose "
                "gravel is uniformly matte and the strip is 0.16 m wide, so both would be invisible page weight",
    },
)


def fetch(url: str, name: str, referer: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / name
    if cached.is_file():
        return cached.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Referer": referer,
                                                   "Accept": "application/zip,*/*"})
    with urllib.request.urlopen(request, timeout=300) as response:
        data = response.read()
    cached.write_bytes(data)
    return data


def heal_specks(image: Image.Image) -> Image.Image:
    """Replace the near-white specks (small stones, a pale dead leaf) with their surroundings.

    They are a fraction of a percent of the map, but a tiled map repeats them on a grid: over a 5 x 3 m roof the same
    white dot appears eighteen times in rows, which is exactly the "repeating clump pattern" the 2.9 notes recorded as
    a known limit. The threshold is the map's own brightest `speckFraction`, so the grade does not flatten the
    pale-green highlights of the mat itself (5.7% of the map sits above L=190 - clamping those would kill the relief).
    """
    grey = image.convert("L")
    histogram, total, running, level = grey.histogram(), grey.width * grey.height, 0, 0
    for level in range(255, -1, -1):
        running += histogram[level]
        if running / total > GRADE["speckFraction"]:
            break
    mask = grey.point(lambda value: 255 if value > level else 0).filter(ImageFilter.MaxFilter(5))
    return Image.composite(image.filter(ImageFilter.MedianFilter(9)), image, mask)


def grade_colour(image: Image.Image) -> Image.Image:
    """Take the forest-floor yellow off the sedum scan and land it on grey-green, keeping the reddish rosettes.

    The per-channel gains are a white balance, not a tint: pulling red down and leaving green alone moves the whole
    map off the scan's warm woodland cast without flattening the reddish rosettes, which stay the brightest red
    thing in it. The small overall darkening that comes with it is wanted - the raw scan renders as a pale dusty
    carpet under this sky, a planted mat reads darker than the grass around the house.
    """
    image = ImageEnhance.Color(image.convert("RGB")).enhance(GRADE["saturation"])
    channels = [channel.point(lambda value, gain=gain: min(255, round(value * gain)))
                for channel, gain in zip(image.split(), GRADE["gain"])]
    return heal_specks(Image.merge("RGB", channels))


def prepare_set(spec: dict, today: str) -> list[dict]:
    asset, prefix = spec["asset"], spec["prefix"]
    page = f"https://ambientcg.com/view?id={asset}"
    download = f"https://ambientcg.com/get?file={asset}_1K-JPG.zip"
    archive = zipfile.ZipFile(io.BytesIO(fetch(download, f"{asset}_1K-JPG.zip", page)))
    common = {"origin": download, "assetPage": page, **LICENSE, "physicalSizeM": spec["mappedSizeM"],
              "publishedSizeM": spec["publishedSizeM"], "downloaded": today}
    rows = []
    for kind, size in spec["maps"]:
        suffix, role = MAPS[kind]
        name = next((n for n in archive.namelist() if n.endswith(suffix)), None)
        if not name:
            raise SystemExit(f"{asset}: the 1K-JPG zip carries no {suffix}")
        original = archive.read(name)
        source = io.BytesIO(original)
        image = Image.open(source)
        image.load()  # PIL reads JPEG lazily; the buffer must not be collected before the encode below.
        if kind == "diffuse" and spec["grade"]:
            image = grade_colour(image)
        data = encode_jpeg(image, size)
        target = MATERIALS / f"{prefix}_{kind}.jpg"
        target.write_bytes(data)
        row = {"file": target.name, **common, "originalSha256": sha256(original), "sha256": sha256(data),
               "bytes": len(data), "role": role, "resolution": f"1k resized to {size}px", "note": spec["note"]}
        if kind == "diffuse" and spec["grade"]:
            row["derived"] = ("colour graded: saturation {saturation}, channel gains {gain}, the brightest "
                              "{speckFraction:.1%} of near-white specks healed to their surroundings").format(**GRADE)
        rows.append(row)
        print("wrote", target.name, len(data), "bytes")
        if kind == "ao":
            continue
        # Same rule as prepare_surface_textures.build_ladder, so re-running that script rewrites these byte for byte.
        if size <= LADDER_SIZE:
            compact, how = data, f"{size}px byte-identical copy"
        else:
            compact, how = encode_jpeg(Image.open(io.BytesIO(data)), LADDER_SIZE), f"{size}px resized to {LADDER_SIZE}px"
        sibling = MATERIALS / f"{target.stem}{LADDER_SUFFIX}.jpg"
        sibling.write_bytes(compact)
        rows.append({"file": sibling.name, **common, "sha256": sha256(compact), "bytes": len(compact), "role": role,
                     "resolution": how, "derived": f"compact-tier variant of {target.name} (sha256 {sha256(data)})"})
        print("wrote", sibling.name, len(compact), "bytes")
    return rows


def main() -> int:
    today = dt.date.today().isoformat()
    provenance = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    rows = []
    for spec in SETS:
        rows.extend(prepare_set(spec, today))
    merge(provenance, rows)
    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("provenance entries:", len(provenance["assets"]))
    print("green roof sets:", len(rows), "files,", sum(row["bytes"] for row in rows), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

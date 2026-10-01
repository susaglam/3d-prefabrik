"""Fetch and prepare the CC0 glTF furniture models the scenes load lazily (Poly Haven, 1k tier).

Why a script and not a one-off download: the models folder is licensed content. Every byte that ships needs a
provenance row naming where it came from, and `tests/frontend/material_assets.test.mjs` re-checks those rows against
the sha256 of the file on disk. Re-running this script has to reproduce exactly what is committed, or the gate fires.

What it writes, per asset, under static/src/assets/models/<asset>/:
  <asset>_1k.gltf        the 1k glTF (byte-identical to Poly Haven's unless the set is trimmed, see TRIM)
  <asset>.bin            the shared buffer (byte-identical unless trimmed)
  textures/*_1k.jpg      every referenced map, RESIZED TO 512 px (the names keep Poly Haven's _1k suffix because the
                         glTF references them by name; only the pixels shrink). A 1k furniture map is 150-900 kB and
                         is never seen closer than ~1.5 m in this scene, so 512 px is the whole page-weight argument:
                         it turns a 1.2 MB set into ~0.5 MB with no visible difference at the camera distances used.
                         The JPEG recipe is quality 86 with the encoder's default 4:2:0 chroma subsampling - the same
                         recipe the furniture textures already in the bundle were written with. Measured over these
                         twelve maps it costs 418 kB where quality 88 / no subsampling costs 634 kB, and at 512 px on
                         an object seen from 2 m none of that 216 kB is visible.

Two of the three sets ship exactly the bytes Poly Haven published. The garden set does not: see TRIM below.

Sets prepared here (2.9.2, stage 2 "furniture"):
- outdoor_table_chair_set_01  the only CC0 garden set in the whole Poly Haven model catalogue (521 models, checked
                              2026-09-16): a folding teak-slat table with a bright metal frame plus folding teak
                              chairs - exactly the bistro set Dutch garden centres sell. Replaces the procedural
                              boxes-and-cylinders terrace set. It ships WITHOUT cushions; preview.js adds those
                              procedurally (seat pad + back pad in outdoor off-white) because the customer asked for
                              a set with cushions and no CC0 model carries them.
- SchoolDesk_01               oak top on a black tubular steel frame with a side drawer, 0.71 x 0.55 m: a real desk
                              at a size that still fits the 2.30 m minimum room. metal_office_desk (the only other
                              desk) is 2.00 m wide and cannot fit.
- wooden_display_shelves_01   light pine cube shelving with fabric boxes, 1.08 x 0.37 x 1.56 m - the Kallax-shaped
                              unit a Dutch youth room actually has. Shelf_01 and the steel_frame_shelves pair are
                              the alternatives; this one is the only MODERN one and the cheapest in bytes.

Deliberately still procedural, because the catalogue has no CC0 model that fits (survey: scripts/../.data/ph_models.py
plus the full furniture/seating/bed/shelves category dump, 2026-09-16):
- bed / singleBed   the three beds published are GothicBed_01 (carved Victorian four-poster), old_bed_frame (rusted
                    hospital frame, 1.8 MB buffer) and vintage_day_bed (floral quilted daybed). All three would look
                    worse in a new prefab extension than a clean procedural bed.
- wardrobe          there is no wardrobe/kledingkast at all; the nearest are Victorian display cabinets.
- rug               there are no rug or carpet models, only rock_face_* matching the word.

TRIM (garden set only). outdoor_table_chair_set_01 is published as a styled arrangement: one table and TWO copies of
the same folding chair, baked at different angles around it. preview.js lays the set out itself (it needs three
chairs, turned to face the table), so the second chair mesh is 163 kB of buffer nobody ever sees. `keepNodes` drops
it: the node and its mesh go, and the buffer is rebuilt from only the bufferViews the surviving accessors point at.
The result is a valid glTF that the shipped GLTFLoader parses; the run verifies that by re-parsing the trimmed file
and checking the surviving accessor bounds are unchanged. The provenance row for a trimmed file records the
untouched upstream sha256 in `originalSha256` and what was removed in `derived`.

Run from the repository root:  python scripts/prepare_furniture_models.py
Downloads are cached in .data/asset-cache (gitignored) and each one is verified against the md5 the Poly Haven files
API publishes. Rows in models/provenance.json are replaced in place (new ones appended), so the run is idempotent.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import struct
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageFile

# See prepare_surface_textures.py: `optimize=True` writes through one block whose 64 kB default a high-entropy
# photo scan overflows, and Pillow then raises "broken data stream" from the encoder rather than from the download.
ImageFile.MAXBLOCK = max(ImageFile.MAXBLOCK, 8 << 20)

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "addons" / "cs_prefab_configurator" / "static" / "src" / "assets" / "models"
PROVENANCE = MODELS / "provenance.json"
CACHE = ROOT / ".data" / "asset-cache"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cs-prefab-configurator asset preparation"
TEXTURE_SIZE = 512
QUALITY = 86

API_FILES = "https://api.polyhaven.com/files/{asset}"
ASSET_PAGE = "https://polyhaven.com/a/{asset}"
LICENSE = {"license": "CC0-1.0", "licenseUrl": "https://polyhaven.com/license"}

SETS = (
    {
        "asset": "outdoor_table_chair_set_01",
        "note": "the only CC0 garden furniture set on Poly Haven: folding teak-slat table and chairs on a bright "
                "metal frame. Cushions are added procedurally in preview.js; the model ships without them.",
        # preview.js places three chairs itself from the one surviving chair mesh, so the duplicate goes.
        "keepNodes": ("outdoor_table_chair_set_01_table", "outdoor_table_chair_set_01_chair_02"),
    },
    {
        "asset": "SchoolDesk_01",
        "note": "desk for the jeugdkamer: oak top, black tubular frame, side drawer; 0.71 x 0.55 m so it still "
                "fits the 2.30 m minimum room (metal_office_desk, the only alternative, is 2.00 m wide).",
    },
    {
        "asset": "wooden_display_shelves_01",
        "note": "bookcase for the jeugdkamer: light pine cube shelving with fabric boxes, 1.08 x 0.37 x 1.56 m.",
    },
)


def fetch(url: str, name: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / name
    if cached.exists():
        return cached.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    cached.write_bytes(data)
    return data


def fetch_json(url: str, name: str) -> dict:
    return json.loads(fetch(url, name).decode("utf-8"))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode_jpeg(image: Image.Image, size: int) -> bytes:
    image = image.convert("RGB")
    if max(image.size) > size:
        image = image.resize((size, size), Image.LANCZOS)
    buffer = io.BytesIO()
    # No `subsampling=0` here, unlike prepare_surface_textures.py: a wall or floor scan is mapped a few centimetres
    # from the camera in the interior views, a chair never is. See the measured 634 kB / 418 kB split in the module
    # docstring - this is the one knob that pays for itself on the furniture set.
    image.save(buffer, format="JPEG", quality=QUALITY, optimize=True)
    return buffer.getvalue()


def trim_gltf(gltf: dict, buffer: bytes, keep: tuple[str, ...]) -> tuple[dict, bytes]:
    """Drop every scene node whose name is not in `keep`, then rebuild the single buffer from what is left.

    The Poly Haven furniture glTFs are flat: one scene, one buffer, one bufferView per accessor, no interleaving,
    no skins, no animations, no morph targets. Anything richer would need more than this, so the shape is asserted
    rather than assumed - a silent partial trim would ship a broken model.
    """
    for unsupported in ("skins", "animations", "cameras"):
        if gltf.get(unsupported):
            raise SystemExit(f"trim: {unsupported} present; this trimmer only handles flat static meshes")
    if len(gltf.get("buffers", [])) != 1 or len(gltf.get("scenes", [])) != 1:
        raise SystemExit("trim: expected exactly one buffer and one scene")
    nodes = gltf["nodes"]
    missing = [name for name in keep if not any(node.get("name") == name for node in nodes)]
    if missing:
        raise SystemExit(f"trim: no node named {missing} - the upstream model changed, re-check keepNodes")
    if any("children" in node for node in nodes):
        raise SystemExit("trim: node hierarchy present; this trimmer only handles a flat node list")

    kept_nodes = [node for node in nodes if node.get("name") in keep]
    mesh_order = sorted({node["mesh"] for node in kept_nodes if "mesh" in node})
    mesh_map = {old: new for new, old in enumerate(mesh_order)}
    meshes = [gltf["meshes"][old] for old in mesh_order]

    accessor_order, views, blob = [], [], bytearray()
    accessor_map = {}
    for mesh in meshes:
        for primitive in mesh["primitives"]:
            for accessor in list(primitive.get("attributes", {}).values()) + ([primitive["indices"]] if "indices" in primitive else []):
                if accessor in accessor_map:
                    continue
                source = gltf["accessors"][accessor]
                view = gltf["bufferViews"][source["bufferView"]]
                if view.get("byteStride"):
                    raise SystemExit("trim: interleaved bufferView; this trimmer copies whole views only")
                start = view.get("byteOffset", 0)
                while len(blob) % 4:                                   # every view stays 4-byte aligned
                    blob.append(0)
                copy = dict(view)
                copy["byteOffset"] = len(blob)
                blob += buffer[start:start + view["byteLength"]]
                accessor_map[accessor] = len(accessor_order)
                accessor_order.append({**source, "bufferView": len(views)})
                views.append(copy)

    for mesh in meshes:
        for primitive in mesh["primitives"]:
            primitive["attributes"] = {key: accessor_map[value] for key, value in primitive["attributes"].items()}
            if "indices" in primitive:
                primitive["indices"] = accessor_map[primitive["indices"]]
    for node in kept_nodes:
        if "mesh" in node:
            node["mesh"] = mesh_map[node["mesh"]]

    trimmed = dict(gltf)
    trimmed["nodes"] = kept_nodes
    trimmed["meshes"] = meshes
    trimmed["accessors"] = accessor_order
    trimmed["bufferViews"] = views
    trimmed["scenes"] = [{**gltf["scenes"][0], "nodes": list(range(len(kept_nodes)))}]
    trimmed["buffers"] = [{**gltf["buffers"][0], "byteLength": len(blob)}]
    return trimmed, bytes(blob)


def check_md5(record: dict, data: bytes, url: str) -> None:
    published = record.get("md5")
    if published and hashlib.md5(data).hexdigest() != published:
        raise SystemExit(f"{url}: md5 differs from the Poly Haven files API; delete the cached copy and retry")


def verify_positions(gltf: dict, blob: bytes) -> int:
    """Re-read every POSITION accessor out of the rebuilt buffer and compare with the bounds the glTF declares.

    This is the control on the trim: a bufferView copied from the wrong offset still parses, still has the right
    byte length, and only shows up as furniture that has exploded into confetti. Comparing the decoded min/max
    against the accessor's own published min/max catches it on the spot, before anything is committed.
    """
    checked = 0
    for accessor in gltf["accessors"]:
        if accessor.get("type") != "VEC3" or "min" not in accessor or accessor.get("componentType") != 5126:
            continue
        view = gltf["bufferViews"][accessor["bufferView"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        floats = struct.unpack_from(f"<{accessor['count'] * 3}f", blob, start)
        for axis in range(3):
            values = floats[axis::3]
            for measured, declared in ((min(values), accessor["min"][axis]), (max(values), accessor["max"][axis])):
                if abs(measured - declared) > 1e-4:
                    raise SystemExit(f"trim: accessor bounds moved on axis {axis}: {measured} vs {declared}")
        checked += 1
    return checked


def prepare_set(spec: dict, today: str) -> list[dict]:
    asset, keep = spec["asset"], spec.get("keepNodes")
    files = fetch_json(API_FILES.format(asset=asset), f"{asset}_files.json")
    entry = files.get("gltf", {}).get("1k", {}).get("gltf")
    if not entry:
        raise SystemExit(f"{asset}: Poly Haven publishes no 1k glTF")
    page, rows = ASSET_PAGE.format(asset=asset), []
    folder = MODELS / asset
    (folder / "textures").mkdir(parents=True, exist_ok=True)

    gltf_name = entry["url"].rsplit("/", 1)[-1]
    gltf_bytes = fetch(entry["url"], f"{asset}__{gltf_name}")
    check_md5(entry, gltf_bytes, entry["url"])
    include = dict(entry.get("include", {}))

    # The .bin travels with the glTF, so a trim has to rewrite both together before either is written out.
    bin_name = next((name for name in include if name.lower().endswith(".bin")), None)
    bin_original = bin_bytes = None
    if bin_name:
        bin_record = include.pop(bin_name)
        bin_original = fetch(bin_record["url"], f"{asset}__{bin_name.replace('/', '__')}")
        check_md5(bin_record, bin_original, bin_record["url"])
        bin_bytes = bin_original

    document, derived = json.loads(gltf_bytes), None
    if keep:
        if bin_bytes is None:
            raise SystemExit(f"{asset}: keepNodes needs an external .bin")
        dropped = sorted(node.get("name", "?") for node in document["nodes"] if node.get("name") not in keep)
        document, bin_bytes = trim_gltf(document, bin_original, keep)
        checked = verify_positions(document, bin_bytes)
        derived = (f"trimmed: node(s) {', '.join(dropped)} removed and the buffer rebuilt from the surviving "
                   f"bufferViews only ({len(bin_original)} -> {len(bin_bytes)} bytes); "
                   f"{checked} POSITION accessors re-read and their bounds verified unchanged")
        gltf_out = (json.dumps(document, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
        print(f"trimmed {asset}: dropped {', '.join(dropped)}, buffer {len(bin_original)} -> {len(bin_bytes)}")
    else:
        gltf_out = gltf_bytes

    (folder / gltf_name).write_bytes(gltf_out)
    row = {"file": f"{asset}/{gltf_name}", "origin": entry["url"], "assetPage": page, **LICENSE,
           "sha256": sha256(gltf_out), "bytes": len(gltf_out), "role": "gltf",
           "downloaded": today, "resolution": "1k", "note": spec["note"]}
    if derived:
        row |= {"originalSha256": sha256(gltf_bytes), "derived": derived}
    rows.append(row)
    print("wrote", f"{asset}/{gltf_name}", len(gltf_out), "bytes")

    if bin_name:
        target = folder / bin_name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(bin_bytes)
        row = {"file": f"{asset}/{bin_name}", "origin": bin_record["url"], "assetPage": page, **LICENSE,
               "sha256": sha256(bin_bytes), "bytes": len(bin_bytes), "role": "bin",
               "resolution": "1k", "downloaded": today}
        if derived:
            row |= {"originalSha256": sha256(bin_original), "derived": derived}
        rows.append(row)
        print("wrote", f"{asset}/{bin_name}", len(bin_bytes), "bytes")

    for relative, record in sorted(include.items()):
        url = record["url"]
        original = fetch(url, f"{asset}__{relative.replace('/', '__')}")
        check_md5(record, original, url)
        target = folder / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not relative.lower().endswith((".jpg", ".jpeg", ".png")):
            raise SystemExit(f"{asset}: unexpected non-image companion {relative}")
        data = encode_jpeg(Image.open(io.BytesIO(original)), TEXTURE_SIZE)
        target.write_bytes(data)
        rows.append({"file": f"{asset}/{relative}", "origin": url, "assetPage": page, **LICENSE,
                     "downloaded": today, "originalSha256": sha256(original), "role": "texture",
                     "resolution": f"1k resized to {TEXTURE_SIZE}px",
                     "sha256": sha256(data), "bytes": len(data)})
        print("wrote", f"{asset}/{relative}", len(data), "bytes")
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
    added = []
    for spec in SETS:
        added.extend(prepare_set(spec, today))
    merge(provenance, added)
    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("provenance entries:", len(provenance["assets"]))
    print("prepared:", len(added), "files,", sum(row["bytes"] for row in added), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

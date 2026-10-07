"""Build data/pc4_centroids.json: one point per Dutch four-digit postcode area, for the kilometervergoeding (2.18.0).

Source: CBS "Postcode 2024, numeriek deel" (postcode4) through the PDOK WFS, licence CC BY 4.0 (bron: CBS). Every
feature is a (multi)polygon; its point here is the area-weighted centroid of the outer rings, computed in a local
equirectangular projection — at postcode-area scale that is within metres of a proper equal-area centroid, and the
kilometre charge it feeds rounds to whole kilometres anyway.

The price service reads only the generated file, never the network: a price must not depend on PDOK being up. Re-run
this script when CBS publishes a newer year and commit the result; nothing else changes.

    python scripts/build_pc4_centroids.py [year]
"""
import json
import math
import pathlib
import sys
import time
import urllib.request

YEAR = sys.argv[1] if len(sys.argv) > 1 else "2024"
URL = (f"https://service.pdok.nl/cbs/postcode4/{YEAR}/wfs/v1_0?request=GetFeature&service=WFS&version=2.0.0"
       "&typeNames=postcode4:postcode4&outputFormat=application/json&srsName=EPSG:4326&count={count}&startIndex={start}")
OUT = pathlib.Path(__file__).resolve().parents[1] / "addons" / "cs_prefab_configurator" / "data" / "pc4_centroids.json"
PAGE = 1000


def fetch(start):
    for attempt in range(5):
        try:
            request = urllib.request.Request(URL.format(count=PAGE, start=start), headers={"User-Agent": "cs-prefab-pc4-build"})
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.load(response)
        except Exception as error:  # a transient PDOK hiccup is retried, a persistent one stops the build
            print(f"page {start}: {error}; retry {attempt + 1}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"PDOK did not answer for startIndex={start}")


def centroid(geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    rings = [polygon[0] for polygon in polygons if polygon and polygon[0]]
    lat0 = sum(point[1] for ring in rings for point in ring) / sum(len(ring) for ring in rings)
    k = math.cos(math.radians(lat0))
    area = cx = cy = 0.0
    for ring in rings:
        for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
            a, b = x0 * k, x1 * k
            cross = a * y1 - b * y0
            area += cross
            cx += (a + b) * cross
            cy += (y0 + y1) * cross
    if abs(area) < 1e-12:  # a degenerate sliver: fall back to the mean of its vertices
        points = [point for ring in rings for point in ring]
        return sum(p[1] for p in points) / len(points), sum(p[0] for p in points) / len(points)
    return cy / (3 * area), cx / (3 * area) / k


points, start = {}, 0
while True:
    page = fetch(start)
    features = page.get("features", [])
    for feature in features:
        code = str(feature["properties"]["postcode"]).zfill(4)
        lat, lon = centroid(feature["geometry"])
        assert 50.6 < lat < 53.7 and 3.2 < lon < 7.3, (code, lat, lon)
        points[code] = [round(lat, 4), round(lon, 4)]
    print(f"startIndex {start}: {len(features)} features, {len(points)} postcodes so far", flush=True)
    if len(features) < PAGE:
        break
    start += PAGE
assert len(points) > 3900, f"only {len(points)} postcode areas; the source looks incomplete"
document = {
    "source": f"CBS, Postcode {YEAR} numeriek deel (postcode4), via PDOK WFS service.pdok.nl/cbs/postcode4/{YEAR}",
    "licence": "CC BY 4.0, bron: CBS",
    "method": "area-weighted centroid of the outer rings, WGS84, 4 decimals (about 10 m)",
    "points": dict(sorted(points.items())),
}
OUT.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"wrote {OUT} with {len(points)} postcode areas ({OUT.stat().st_size // 1024} kB)")

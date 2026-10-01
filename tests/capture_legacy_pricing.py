"""Capture the linear (pre-curve) engine's complete answers as a golden fixture.

Run ONCE, before the base-price curve lands, from the tests/ directory:  python capture_legacy_pricing.py
The fixture pins every line (id, label, quantity, unit, unitPrice, total), the subtotal, VAT and total for a spread of
designs, so test_pricing_curve.py can prove that a pricebook WITHOUT baseCurve still prices byte-for-byte as before.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "addons" / "cs_prefab_configurator"))

from services.catalog import default_release, release_context  # noqa: E402
from services.pricing import price_config  # noqa: E402

DESIGNS = {
    "default": {},
    "tiny-151x101": {"width": 151, "depth": 101, "frontOpening": "none"},
    "odd-501x299": {"width": 501, "depth": 299, "facade": "render", "frontOpening": "french-white"},
    "large-750x340-full": {"width": 750, "depth": 340, "facade": "pvc-anthracite", "frontOpening": "folding-black", "rooflight": "lean-4",
                           "roofEdge": "zinc", "drainMaterial": "zinc", "drainSide": "both", "outsideLight": "both", "outsideSocket": "double-both",
                           "outsideTap": "left", "demolition": True, "access": "restricted", "piles": 6, "overhang": "wood-white", "overhangSpots": 4,
                           "greenRoof": True, "roofShade": False, "openingMaterial": "aluminium",
                           "interior": True, "plaster": True, "screed": True, "underfloorHeating": True, "heating": "both", "ceilingLights": 2,
                           "switches": 2, "spotlights": 6, "sockets": "both", "painting": True, "wallLights": ["L1", "R1"]},
}


def capture():
    release = default_release()
    out = {"revision": release["revision"], "designs": {}}
    with release_context(release):
        for name, config in DESIGNS.items():
            answer = price_config(dict(config))
            out["designs"][name] = {"config": config, "lines": answer["lines"], "subtotal": answer["subtotal"], "vat": answer["vat"],
                                    "total": answer["total"], "scope": [{"key": s["key"], "components": s["components"]} for s in answer["scope"]]}
    return out


if __name__ == "__main__":
    target = pathlib.Path(__file__).with_name("fixtures") / "legacy_pricing_golden.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(capture(), ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print("wrote", target)

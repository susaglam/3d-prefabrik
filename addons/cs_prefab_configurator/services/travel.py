"""Kilometervergoeding (2.18.0): a per-kilometre charge from the vestiging to the building site.

The owner, 2026-10-07: "müşteriden veri beklemeye gerek yok, sen rakamı belirle; zaten adminden güncellenebilir olacak".
TRAVEL_DEFAULTS are those numbers — from Prefab Partner in Rijswijk (2288), the first 50 km included, then € 1,50 per
kilometre counted there and back — and a pricebook's own "travel" block (catalogue editor → Kilometervergoeding)
replaces them per catalogue. The defaults live here and not in data/pricebook*.json on purpose: a key added to the
shipped book would change the demo release's revision that every pricing golden is pinned to.

Distance is estimated, never looked up live: the straight line between the two four-digit postcode areas
(data/pc4_centroids.json, CBS postcode4 2024, CC BY 4.0) times ROAD_FACTOR, the average detour over Dutch roads
(Amsterdam 68 km, Utrecht 67, Zwolle 163, Groningen 250 from Rijswijk, against 65-70 / 65 / 165 / 250 by road). A price
must not depend on a map service being up, and the same postcode must always cost the same. Anything that cannot be
measured — no postcode yet, an area CBS does not list, a missing table — charges nothing and says so in the warnings.
"""
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
import json
import math
from pathlib import Path
import re

TRAVEL_DEFAULTS = {"originPostcode": "2288", "originLabel": "Rijswijk", "freeKm": 50, "perKm": 150, "roundTrip": True}
ROAD_FACTOR = 1.25
EARTH_RADIUS_KM = 6371.0088
DATA = Path(__file__).resolve().parent.parent / "data" / "pc4_centroids.json"
_POSTCODE = re.compile(r"^\s*([1-9][0-9]{3})\s*(?:[A-Za-z]{2})?\s*$")


@lru_cache(maxsize=1)
def centroids():
    """Four-digit postcode → [lat, lon]. An unreadable table degrades to 'no distance', never to a failed price."""
    try:
        return json.loads(DATA.read_text(encoding="utf-8"))["points"]
    except (OSError, ValueError, KeyError):
        return {}


def pc4(value):
    """The four digits of a Dutch postcode ("2288 GK", "2288gk", "2288"), or None."""
    if not isinstance(value, str):
        return None
    match = _POSTCODE.match(value)
    return match.group(1) if match else None


def road_km(origin, destination):
    """Estimated road distance in whole kilometres between two postcode areas, or None when either is unknown."""
    points = centroids()
    if origin not in points or destination not in points:
        return None
    (la1, lo1), (la2, lo2) = (map(math.radians, points[origin]), map(math.radians, points[destination]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    straight = 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))
    return int(Decimal(straight * ROAD_FACTOR).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def travel_settings(book):
    """The pricebook's own kilometervergoeding, or the defaults for a book that has none."""
    settings = dict(TRAVEL_DEFAULTS)
    settings.update((book or {}).get("travel") or {})
    return settings


def check_travel(travel):
    """Raise ValueError (in Dutch, for the catalogue editor) unless `travel` is a complete, sane settings block."""
    if not isinstance(travel, dict) or set(travel) != set(TRAVEL_DEFAULTS):
        raise ValueError("kilometervergoeding: vul vestiging, vrije kilometers, prijs per kilometer en heen-en-terug in.")
    if not isinstance(travel["originPostcode"], str) or travel["originPostcode"] not in centroids():
        raise ValueError("kilometervergoeding: de vier cijfers van de postcode van de vestiging zijn onbekend.")
    if not isinstance(travel["originLabel"], str) or not travel["originLabel"].strip() or len(travel["originLabel"]) > 60:
        raise ValueError("kilometervergoeding: geef de vestiging een plaatsnaam (hoogstens 60 tekens).")
    for key, most in (("freeKm", 1000), ("perKm", 100000)):
        if type(travel[key]) is not int or not 0 <= travel[key] <= most:
            raise ValueError("kilometervergoeding: vrije kilometers en prijs per kilometer zijn hele, niet-negatieve getallen.")
    if type(travel["roundTrip"]) is not bool:
        raise ValueError("kilometervergoeding: heen en terug is aan of uit.")


def _euro(cents):
    return "€ " + f"{cents / 100:,.2f}".replace(",", " ").replace(".", ",").replace(" ", ".")


def travel_charge(config, book):
    """What the kilometres to this site cost.

    None when there is nothing to charge or to say: the rate is 0, or there is no postcode yet. A dict with km None
    when the postcode's area cannot be measured. Otherwise km (one way), chargedKm (beyond the free radius, doubled
    there and back), total in cents and the line label — total is 0 inside the free radius.
    """
    settings = travel_settings(book)
    destination = pc4(config.get("postcode"))
    if not settings["perKm"] or not destination:
        return None
    km = road_km(settings["originPostcode"], destination)
    if km is None:
        return {"postcode": destination, "km": None, "chargedKm": 0, "total": 0, "label": ""}
    beyond = max(0, km - settings["freeKm"])
    charged = beyond * (2 if settings["roundTrip"] else 1)
    label = (f"Kilometervergoeding vanaf {settings['originLabel']}: ca. {km} km, {charged} km boven de eerste "
             f"{settings['freeKm']} km{' (heen en terug)' if settings['roundTrip'] else ''} à {_euro(settings['perKm'])}")
    return {"postcode": destination, "km": km, "chargedKm": charged, "total": charged * settings["perKm"], "label": label}


def travel_warning(config, book, charge):
    """The sentence the price carries when the kilometres are not (yet) in it, or None."""
    settings = travel_settings(book)
    if not settings["perKm"]:
        return None
    if charge is None:
        return (f"De kilometervergoeding wordt berekend zodra de postcode van de bouwplaats bekend is: vanaf "
                f"{settings['originLabel']}, de eerste {settings['freeKm']} km inbegrepen.")
    if charge["km"] is None:
        return f"Voor postcode {charge['postcode']} is geen afstand bekend; de kilometervergoeding volgt na de opname."
    return None

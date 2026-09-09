"""Server-authoritative demo pricing; all monetary values are integer euro cents."""
from decimal import Decimal, ROUND_HALF_UP

from .catalog import get_catalog, get_pricebook
from .configuration import canonical_config, config_labels


def cents(value):
    return int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def price_config(value):
    config = canonical_config(value)
    catalog = get_catalog()
    book = get_pricebook()
    area = Decimal(config["width"]) * Decimal(config["depth"]) / Decimal(10000)
    labels = {entry["key"]: entry for entry in config_labels(config)}
    lines = []

    def add(key, label, quantity, unit, unit_price):
        total = cents(Decimal(str(quantity)) * unit_price)
        if total:
            lines.append({"id": key, "label": label, "quantity": float(quantity), "unit": unit, "unitPrice": unit_price, "total": total})

    add("base", "Geïsoleerde prefab casco aanbouw", area, "m²", book["basePerM2"])
    add("setup", "Werkvoorbereiding, transport en plaatsing (basis)", 1, "post", book["fixedSetup"])
    for key, prices in book["optionPrices"].items():
        val = config[key]
        option_key = str(val).lower() if isinstance(val, bool) else str(val)
        label = labels.get(key)
        if not label:
            continue
        per_area = key in book["perM2"]
        add(key, f"{label['label']}: {label['value']}", area if per_area else 1, "m²" if per_area else "post", prices[option_key])
    subtotal = sum(line["total"] for line in lines)
    vat = cents(Decimal(subtotal) * Decimal(book["vatRate"]) / 100)
    warnings = [catalog["engineeringNotice"]]
    if config["underfloorHeating"]:
        warnings.append("Vloerverwarming: vloer wordt voorbereid/verlaagd; aansluiting op de bestaande verwarming is uitgesloten.")
    if any(config[key] != "none" for key in ("outsideLight", "outsideSocket", "heating", "sockets")) or config["switches"]:
        warnings.append("Geselecteerde leidingpunten worden als loze leiding aangelegd. Eindmontage en aansluiting zijn niet inbegrepen.")
    if config["ceilingLights"]:
        warnings.append("Plafondlampen zijn niet inbegrepen; alleen de stroompunten worden voorbereid.")
    return {"config": config, "schemaVersion": catalog["schemaVersion"], "pricebookVersion": book["pricebookVersion"],
            "currency": book["currency"], "priceMode": book["priceMode"], "disclaimer": book["disclaimer"],
            "areaM2": float(area), "subtotal": subtotal, "vatRate": book["vatRate"], "vat": vat,
            "total": subtotal + vat, "lines": lines, "warnings": warnings, "labels": list(labels.values())}

"""Server-authoritative pricing and explicit commercial component scope."""
from decimal import Decimal, ROUND_HALF_UP, localcontext

from .catalog import get_catalog, get_pricebook, release_context, ROLE_LABELS, STATUS_LABELS, price_status_label, model_assets
from .geometry_rules import placement_result
from .configuration import canonical_config, config_labels, masonry_rollaag_applies
from .travel import travel_charge, travel_warning


def cents(value):
    return int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def base_curve_total(curve, area):
    """Casco price in cents from a pricebook baseCurve (see services.catalog.BASE_CURVE_KEYS).

    Decimal throughout, 40 digits, half-up to a multiple of roundTo: the customer's price list rounds its matrix to
    whole euros, and with the exponent 1.1860002 this reproduces all 169 cells of that list exactly.
    """
    with localcontext() as context:
        context.prec = 40
        amount = Decimal(curve["fixed"]) + Decimal(curve["factor"]) * Decimal(area) ** Decimal(curve["exponent"])
        step = Decimal(curve["roundTo"])
        return int((amount / step).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * step)


def selected_quantity(config, key):
    value = config.get(key)
    if key == "sockets":
        return len(config["socketPositions"])
    if isinstance(value, list):
        return len(value)
    if type(value) is bool:
        return int(value)
    if type(value) is int:
        return value
    if value in (None, "none"):
        return 0
    if value == "double-both":
        return 4
    if value in ("both", "double-left", "double-right"):
        return 2
    return 1


def price_config(value):
    with release_context() as release:
        return _price_config(value, release)


def _price_config(value, release):
    supplied_config = value
    config = canonical_config(value)
    catalog, book = get_catalog(), get_pricebook()
    area = Decimal(config["width"]) * Decimal(config["depth"]) / Decimal(10000)
    labels = {entry["key"]: entry for entry in config_labels(config)}
    lines, scope = [], []

    def add(key, label, quantity, unit, unit_price, role="product"):
        total = cents(Decimal(str(quantity)) * unit_price)
        if total:
            lines.append({"id": key, "label": label, "quantity": float(quantity), "unit": unit, "unitPrice": unit_price, "total": total, "role": role})
        return total

    if book.get("baseCurve"):
        # One post at the curve price: the sale order and the request's price rows rebuild each line as quantity ×
        # unit price, and a curve total is no whole-cent price per m². The label stays constant because it also names
        # the shared Odoo product; the dimensions are on the document itself.
        add("base", "Geïsoleerde prefab casco aanbouw", 1, "post", base_curve_total(book["baseCurve"], area))
    else:
        add("base", "Geïsoleerde prefab casco aanbouw", area, "m²", book["basePerM2"])
    add("setup", "Werkvoorbereiding, transport en plaatsing (basis)", 1, "post", book["fixedSetup"], "installation")
    # The kilometres beyond the free radius, as one post (services/travel.py); add() drops it at 0.
    travel = travel_charge(config, book)
    if travel and travel["total"]:
        add("travel", travel["label"], 1, "post", travel["total"], "installation")
    for key, policy in release["policies"].items():
        quantity = selected_quantity(config, key)
        if not quantity or key not in labels:
            continue
        # A masonry rollaag on a facade that is not brick does not exist: the cladding carries on above the frame.
        # No line and no delivery-scope row for it (2.18.0, the owner: "olmadığı halde neden fiyat eklesin").
        if key == "rollaag" and config["rollaag"] == "masonry" and not masonry_rollaag_applies(config):
            continue
        value = config[key]
        option_key = str(value).lower() if isinstance(value, bool) else str(value)
        policy = policy.get("choices", {}).get(option_key, policy)
        item = {"key": key, "label": labels[key]["label"], "value": labels[key]["value"], "quantity": quantity,
                "visualMode": policy["visualMode"], "modelFidelity": policy["modelFidelity"],
                "assetKey": policy.get("assetKey", key), "catalogRevision": release["revision"], "components": []}
        for component in policy["components"]:
            role, status, basis = component["role"], component["status"], component["pricing"]
            count = area if basis == "area" else quantity if basis == "count" else 1
            unit = "m²" if basis == "area" else "stuk" if basis == "count" else "post"
            unit_price = component.get("prices", {}).get(option_key, component.get("unitPrice", 0)) if basis in ("option", "area") else component.get("unitPrice", 0)
            if status != "extra":
                unit_price = 0
            label = f"{labels[key]['label']} · {ROLE_LABELS[role]}: {labels[key]['value']}"
            line_id = key if not any(c["status"] == "extra" for c in item["components"]) else key + "." + role
            total = add(line_id, label, count, unit, unit_price, role) if status == "extra" else 0
            item["components"].append({"role": role, "label": ROLE_LABELS[role], "status": status,
                "statusLabel": "Minderprijs" if total < 0 else STATUS_LABELS[status], "quantity": float(count), "unit": unit, "unitPrice": unit_price, "total": total})
        item["productIncluded"] = any(c["role"] == "product" and c["status"] != "excluded" for c in item["components"])
        if item["visualMode"] in ("representative", "product"):
            item["visualMode"] = "product" if item["productIncluded"] else "representative"
        item["summary"] = "; ".join(f"{c['label']}: {c['statusLabel'].lower()}" for c in item["components"])
        scope.append(item)
    subtotal = sum(line["total"] for line in lines)
    vat = cents(Decimal(subtotal) * Decimal(book["vatRate"]) / 100)
    warnings = [catalog["engineeringNotice"]]
    travel_note = travel_warning(config, book, travel)
    if travel_note:
        warnings.append(travel_note)
    def preparation_included(item):
        return any(c["role"] == "preparation" and c["status"] in {"included", "extra"} for c in item["components"])
    if any(item["key"] in ("heating", "outsideLight", "outsideSocket", "sockets", "switches") and preparation_included(item) and not item["productIncluded"] for item in scope):
        warnings.append("Geselecteerde voorbereidingspunten worden als loze leiding aangelegd. Eindmateriaal, eindmontage en aansluiting zijn niet inbegrepen, tenzij hieronder apart vermeld.")
    ceiling_scope = next((item for item in scope if item["key"] == "ceilingLights"), None)
    if ceiling_scope and not ceiling_scope["productIncluded"]:
        warnings.append("Plafondlampen zijn niet inbegrepen; " + ("de stroompunten worden voorbereid." if preparation_included(ceiling_scope) else "ook de voorbereiding van stroompunten is niet inbegrepen."))
    if config["underfloorHeating"]:
        floor_scope = next((item for item in scope if item["key"] == "underfloorHeating"), None)
        warnings.append("Vloerverwarming: " + ("voorbereiding van de vloer" if floor_scope and preparation_included(floor_scope) else "voorbereiding van de vloer niet inbegrepen") + "; systeem, verdeler en aansluiting zijn uitsluitend inbegrepen wanneer expliciet vermeld in de leveringsomvang.")
    if config["painting"]:
        warnings.append("Schilderwerk wordt indicatief berekend op basis van vloeroppervlak; definitieve wand- en plafondmeting volgt na opname.")
    warnings.append("Contouren en voorbeeldapparaten zijn ter illustratie. De leveringsomvang hieronder is leidend; een modelafbeelding is geen merk- of modeltoezegging.")
    placement = placement_result(config, supplied_config, catalog["geometryRules"], model_assets(config), asset_revision=catalog.get("assetRevision")) if catalog.get("geometryRules", {}).get("version") == 1 else {}
    warnings.extend(dict.fromkeys(item["message"] for item in placement.get("clearedSelections", [])))
    return {"config": config, "schemaVersion": catalog["schemaVersion"], "catalogRevision": release["revision"], "pricebookVersion": book["pricebookVersion"],
            "currency": book["currency"], "priceMode": book["priceMode"], "disclaimer": book["disclaimer"],
            "priceStatusLabel": price_status_label(book, approved=bool(release.get("commercialApproval"))), **placement,
            "areaM2": float(area), "subtotal": subtotal, "vatRate": book["vatRate"], "vat": vat,
            "total": subtotal + vat, "lines": lines, "scope": scope, "warnings": warnings, "labels": list(labels.values())}

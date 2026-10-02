"""Canonical schema validation shared by standalone and Odoo adapters."""
import copy
import hashlib
import json
import re
import unicodedata
import uuid

from .catalog import RETIRED_FIELDS, RETIRED_VALUES, get_catalog, model_assets
from .document_visuals import canonical_document_visuals
from .errors import DomainError
from .geometry_rules import apply_mounting_rules, validate_profile_selection

POSTCODE = re.compile(r"^[1-9][0-9]{3}\s?[A-Z]{2}$")
EMAIL = re.compile(r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def document_config_key(config):
    # Placement postcode does not change geometry and is supplied by the contact
    # step when omitted from the configurator. Keep it outside capture identity.
    return canonical_json({key: value for key, value in config.items() if key != "postcode"})


def normalize_postcode(value, *, required=False):
    if not isinstance(value, str) or len(value) > 16:
        raise ValueError("Vul een geldige Nederlandse postcode in.")
    value = value.strip().upper()
    if not value and not required:
        return ""
    if not POSTCODE.fullmatch(value):
        raise ValueError("Vul een geldige Nederlandse postcode in, bijvoorbeeld 1234 AB.")
    value = value.replace(" ", "")
    return value[:4] + " " + value[4:]


def canonical_config(value):
    catalog = get_catalog()
    if not isinstance(value, dict):
        raise DomainError("De configuratie moet een object zijn.", fields={"config": "Ongeldige configuratie."})
    errors = {}
    # A browser that loaded a catalogue before an upgrade may still send a retired field; ignore it like the client does.
    value = {key: val for key, val in value.items() if key not in RETIRED_FIELDS}
    # A saved design or an older browser may still carry a retired VALUE of a field that stayed (2.16.0: the double
    # outdoor socket). It becomes the single socket on the same side rather than an error the visitor cannot act on.
    value = {key: RETIRED_VALUES.get(key, {}).get(val, val) if isinstance(val, str) else val for key, val in value.items()}
    unknown = set(value) - set(catalog["defaults"])
    if unknown:
        errors["config"] = "Onbekende configuratievelden: " + ", ".join(sorted(unknown)[:10])
    config = copy.deepcopy(catalog["defaults"])
    config.update({key: val for key, val in value.items() if key in config})
    for key, rule in catalog["dimensions"].items():
        val = config[key]
        if type(val) is not int or not rule["min"] <= val <= rule["max"] or (val - rule["min"]) % rule["step"]:
            errors[key] = f"{rule['label']}: kies {rule['min']}–{rule['max']} {rule['unit']} in stappen van {rule['step']}."
    for group in catalog["groups"]:
        for field in group["fields"]:
            key = field["key"]
            val = config[key]
            if field["type"] == "text":
                try:
                    config[key] = normalize_postcode(val)
                except ValueError as exc:
                    errors[key] = str(exc)
            elif field["type"] == "multiselect":
                allowed = [option["id"] for option in field["options"]]
                if not isinstance(val, list) or len(val) > field["maxSelections"] or any(type(item) is not str or item not in allowed for item in val) or len(set(val)) != len(val):
                    errors[key] = f"Kies geldige, unieke posities voor {field['label']}."
                else:
                    config[key] = [item for item in allowed if item in val]
            elif not any(type(val) is type(option["id"]) and val == option["id"] for option in field["options"]):
                errors[key] = f"Kies een geldige optie voor {field['label']}."
    if errors:
        raise DomainError("Controleer de aangegeven configuratievelden.", fields=errors)
    # Validate all supplied values first, then erase options hidden by branch logic.
    for constraint in catalog["constraints"]:
        # A constraint may name a field the catalogue no longer offers (RETIRED_FIELDS): it resets what is still there
        # and skips the rest, instead of failing over a choice nobody can make any more.
        if constraint["field"] not in config:
            continue
        if constraint["type"] == "resetWhen" and config[constraint["field"]] == constraint["equals"]:
            for key in constraint["fields"]:
                if key in config:
                    config[key] = copy.deepcopy(catalog["defaults"][key])
    if catalog.get("schemaVersion") != 2:
        return config
    opening = config["frontOpening"]
    kind = "french" if opening.startswith("french") else "sliding-4" if opening.startswith("sliding-4") else "sliding-2" if opening.startswith("sliding-2") else "folding" if opening.startswith("folding") else "none"
    minimum = catalog.get("openingRules", {}).get("minimumWidthCm", {}).get(kind, 150)
    if config["width"] < minimum:
        raise DomainError("Dit kozijn past niet binnen de gekozen breedte. Kies een smaller kozijn of vergroot de aanbouw.", fields={"width": f"Voor dit kozijn is voorlopig minimaal {minimum} cm breedte nodig."})
    if catalog.get("geometryRules", {}).get("version") == 1:
        validate_profile_selection(config, catalog["geometryRules"])
    normalize_positions(config, value)
    if not config["plaster"]:
        config["painting"] = False
    if config["overhang"] == "none":
        config["overhangSpots"] = 0
    if "roofShade" in config and config["rooflight"] not in {"lean-1", "lean-2", "lean-3"}:
        config["roofShade"] = False
    for control, selected in (("outsideLightControl", config["outsideLight"] != "none"),
                              ("ceilingLightControl", bool(config["ceilingPositions"])),
                              ("spotControl", bool(config["spotPositions"])),
                              ("wallLightControl", bool(config.get("wallLights"))),
                              ("overhangSpotControl", bool(config["overhangSpots"]))):
        if not selected and control in config:
            config[control] = catalog["defaults"][control]
    return config


def normalize_positions(config, supplied):
    """Stable mounting slots, legacy count migration, and roof/radiator clearance."""
    ceiling = ["left", "center", "right"]
    spots = [f"r{row}c{column}" for row in range(1, 4) for column in range(1, 6)]
    if "ceilingPositions" not in supplied:
        config["ceilingPositions"] = ceiling[:config["ceilingLights"]]
    if "spotPositions" not in supplied:
        config["spotPositions"] = spots[:config["spotlights"]]
    if "socketPositions" not in supplied:
        config["socketPositions"] = {"none": [], "left": ["L1"], "right": ["R1"], "both": ["L1", "R1"]}[config["sockets"]]
    if not config["interior"]:
        for key in ("ceilingPositions", "spotPositions", "socketPositions", "wallLights"):
            if key in config:
                config[key] = []
    rules = get_catalog().get("geometryRules")
    if rules and rules.get("version") == 1:
        apply_mounting_rules(config, rules, model_assets(config), asset_revision=get_catalog().get("assetRevision"))
        _sync_position_counts(config)
        return
    roof = config["rooflight"]
    blocked_spots = {"r2c3"} if roof != "none" else set()
    if roof in {"lean-3", "lean-4", "lean-5", "gable-6", "gable-8", "gable-10"}:
        blocked_spots |= {"r2c2", "r2c4"}
    config["spotPositions"] = [p for p in config["spotPositions"] if p not in blocked_spots]
    if roof != "none":
        roof_kind, count = roof.split("-")
        width, depth, wall = config["width"] / 100, config["depth"] / 100, .22
        roof_width = min(width - .85, (int(count) / 2 if roof_kind == "gable" else int(count)) * .72 + .12)
        roof_depth = min(depth - .85, 1.45 if roof_kind == "gable" else 1.15)
        def inside_roof(position):
            row, column = int(position[1]), int(position[3])
            x = -width / 2 + wall + (width - 2 * wall) * column / 6
            z = -depth / 2 + (depth - wall) * row / 4
            return abs(x) < roof_width / 2 + .06 and abs(z + .08) < roof_depth / 2 + .06
        config["spotPositions"] = [p for p in config["spotPositions"] if not inside_roof(p)]
    if roof in {"lean-5", "gable-10"}:
        config["ceilingPositions"] = [p for p in config["ceilingPositions"] if p == "center"]
    blocked_wall = set()
    if config["heating"] in {"left", "both"}:
        blocked_wall.add("L3")
    if config["heating"] in {"right", "both"}:
        blocked_wall.add("R3")
    for key in ("wallLights", "socketPositions"):
        if key in config:
            config[key] = [p for p in config[key] if p not in blocked_wall]
    _sync_position_counts(config)


def _sync_position_counts(config):
    config["ceilingLights"] = len(config["ceilingPositions"])
    config["spotlights"] = len(config["spotPositions"])
    sides = {p[0] for p in config["socketPositions"]}
    config["sockets"] = "both" if len(sides) == 2 else "left" if "L" in sides else "right" if "R" in sides else "none"


def config_labels(config):
    catalog = get_catalog()
    result = []
    for key, rule in catalog["dimensions"].items():
        if not rule.get("hidden"):
            result.append({"key": key, "label": rule["label"], "value": f"{config[key]} {rule['unit']}"})
    for group in catalog["groups"]:
        for field in group["fields"]:
            visibility = field.get("visibleWhen")
            if visibility and config[visibility["field"]] != visibility["equals"]:
                continue
            val = config[field["key"]]
            if field["type"] == "multiselect":
                label = ", ".join(o["label"] for o in field["options"] if o["id"] in val) or "Geen"
            else:
                label = next((o["label"] for o in field.get("options", []) if type(o["id"]) is type(val) and o["id"] == val), str(val))
            if label:
                result.append({"key": field["key"], "label": field["label"], "value": label, "description": field.get("description", "")})
    return result


def clean_text(value, maximum, *, multiline=False):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError(f"Gebruik maximaal {maximum} tekens.")
    value = unicodedata.normalize("NFC", value).strip()
    if any(unicodedata.category(char) in {"Cc", "Cf", "Cs"} and not (multiline and char in "\n\r\t") for char in value):
        raise ValueError("Ongeldige tekens in de invoer.")
    return value


def canonical_contact(value):
    limits = {"name": 120, "firstName": 60, "lastName": 80, "email": 254, "phone": 30, "postcode": 16,
              "houseNumber": 20, "address": 160, "city": 100, "message": 3000}
    if not isinstance(value, dict):
        raise DomainError("Vul uw contactgegevens in.", fields={"contact": "Ongeldige contactgegevens."})
    errors = {}
    unknown = set(value) - set(limits)
    if unknown:
        errors["contact"] = "Onbekende contactvelden."
    contact = {}
    for key, maximum in limits.items():
        try:
            contact[key] = clean_text(value.get(key, ""), maximum, multiline=key == "message")
        except ValueError as exc:
            errors[key] = str(exc)
            contact[key] = ""
    contact["name"] = " ".join(part for part in (contact["firstName"], contact["lastName"]) if part)
    for key in ("firstName", "lastName", "email", "phone", "address", "city", "postcode", "houseNumber"):
        if not contact[key]:
            errors[key] = "Dit veld is verplicht."
    contact["email"] = contact["email"].lower()
    if not EMAIL.fullmatch(contact["email"]):
        errors["email"] = "Vul een geldig e-mailadres in."
    if not re.fullmatch(r"[+()0-9 .-]{7,30}", contact["phone"]) or len(re.sub(r"\D", "", contact["phone"])) < 7:
        errors["phone"] = "Vul een geldig telefoonnummer in."
    if not re.fullmatch(r"[0-9]{1,6}(?:\s?[A-Za-z0-9/-]{1,10})?", contact["houseNumber"]):
        errors["houseNumber"] = "Vul een geldig huisnummer in."
    try:
        contact["postcode"] = normalize_postcode(contact["postcode"], required=True)
    except ValueError as exc:
        errors["postcode"] = str(exc)
    if errors:
        raise DomainError("Controleer uw contactgegevens.", fields=errors)
    return contact


def canonical_quote_payload(payload):
    if not isinstance(payload, dict) or set(payload) - {"config", "contact", "consent", "idempotencyKey", "visuals", "catalogRevision"}:
        raise DomainError("Ongeldige offerteaanvraag.")
    if payload.get("consent") is not True:
        raise DomainError("Geef toestemming om contact op te nemen over deze aanvraag.", fields={"consent": "Toestemming is verplicht."})
    key = payload.get("idempotencyKey")
    try:
        parsed_key = uuid.UUID(key) if isinstance(key, str) else None
        if parsed_key is None or parsed_key.version != 4:
            raise ValueError()
    except (ValueError, AttributeError):
        raise DomainError("Ongeldige aanvraagcode. Vernieuw de pagina.", fields={"idempotencyKey": "Een UUID v4 is vereist."}) from None
    config = canonical_config(payload.get("config"))
    visuals = canonical_document_visuals(payload["visuals"], document_config_key(config)) if "visuals" in payload else None
    contact = canonical_contact(payload.get("contact"))
    if config["postcode"] and config["postcode"] != contact["postcode"]:
        raise DomainError("De postcodes van configuratie en contactgegevens verschillen.", fields={"postcode": "Gebruik dezelfde postcode voor de plaatsing."})
    config["postcode"] = contact["postcode"]
    canonical = {"config": config, "contact": contact, "consent": True}
    if "catalogRevision" in payload:
        if not isinstance(payload["catalogRevision"], str) or len(payload["catalogRevision"]) > 160:
            raise DomainError("Ongeldige catalogusversie.")
        canonical["catalogRevision"] = payload["catalogRevision"]
    # Captures may change JPEG bytes across devices or repeated renders. A retry
    # must return the original immutable quote, not create a new commercial item.
    identity = dict(canonical)
    if visuals is not None:
        canonical["visuals"] = visuals
        identity["documentVisualsVersion"] = visuals["version"]
    return canonical, str(parsed_key), digest(identity)

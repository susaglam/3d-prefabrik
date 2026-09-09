"""Canonical schema validation shared by standalone and Odoo adapters."""
import copy
import hashlib
import json
import re
import unicodedata
import uuid

from .catalog import get_catalog
from .document_visuals import canonical_document_visuals
from .errors import DomainError

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
            elif not any(type(val) is type(option["id"]) and val == option["id"] for option in field["options"]):
                errors[key] = f"Kies een geldige optie voor {field['label']}."
    if errors:
        raise DomainError("Controleer de aangegeven configuratievelden.", fields=errors)
    # Validate all supplied values first, then erase options hidden by branch logic.
    for constraint in catalog["constraints"]:
        if constraint["type"] == "resetWhen" and config[constraint["field"]] == constraint["equals"]:
            for key in constraint["fields"]:
                config[key] = copy.deepcopy(catalog["defaults"][key])
    return config


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
    if not isinstance(payload, dict) or set(payload) - {"config", "contact", "consent", "idempotencyKey", "visuals"}:
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
    # Captures may change JPEG bytes across devices or repeated renders. A retry
    # must return the original immutable quote, not create a new commercial item.
    identity = dict(canonical)
    if visuals is not None:
        canonical["visuals"] = visuals
        identity["documentVisualsVersion"] = visuals["version"]
    return canonical, str(parsed_key), digest(identity)

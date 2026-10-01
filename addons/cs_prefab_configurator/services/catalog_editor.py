"""Lossless helpers for the native catalogue editor; JSON remains the storage format."""
import copy
from decimal import Decimal, InvalidOperation, localcontext


def euro_to_cents(value, *, allow_negative=False):
    """Reject imprecise input instead of silently rounding a commercial price.

    `allow_negative` is only for a product package that is a price REDUCTION (services.catalog.credit_allowed).
    """
    message = ("Voer een EUR-bedrag met maximaal twee decimalen in; een minderprijs is negatief." if allow_negative
               else "Voer een niet-negatief EUR-bedrag met maximaal twee decimalen in.")
    if isinstance(value, bool):
        raise ValueError(message)
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 and not allow_negative or abs(amount) > Decimal("21474836.47"):
            raise ValueError
        with localcontext() as context:
            context.prec = max(28, len(amount.as_tuple().digits) + 2)
            cents = amount * 100
            if cents != cents.to_integral_value():
                raise ValueError
            return int(cents)
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(message) from None


def value_key(value):
    return str(value).lower() if type(value) is bool else str(value)


def same_value(left, right):
    return type(left) is type(right) and left == right


def field_index(catalog):
    return {field["key"]: field for group in catalog["groups"] for field in group["fields"]}


def choice_label(catalog, key, choice):
    field = field_index(catalog).get(key, {})
    return next((option["label"] for option in field.get("options", []) if value_key(option["id"]) == choice), choice)


def patch_fields(catalog, edits):
    """Apply explicit field/choice edits, preserving all other keys and false/zero IDs."""
    result = copy.deepcopy(catalog)
    fields = field_index(result)
    for key, changes in edits.items():
        if key not in fields or set(changes) - {"label", "description", "placeholder", "default", "choices"}:
            raise ValueError("Onbekend catalogusveld of niet-ondersteunde wijziging.")
        field = fields[key]
        for name in ("label", "description", "placeholder"):
            if name in changes:
                if not isinstance(changes[name], str) or name == "label" and not changes[name].strip():
                    raise ValueError("Een keuzenaam is verplicht; toelichting moet tekst zijn.")
                field[name] = changes[name]
        options = {value_key(option["id"]): option for option in field.get("options", [])}
        for option_key, option_changes in changes.get("choices", {}).items():
            if option_key not in options or set(option_changes) - {"label", "description"}:
                raise ValueError("Onbekende of niet-ondersteunde optiewaarde.")
            for name, value in option_changes.items():
                if not isinstance(value, str) or name == "label" and not value.strip():
                    raise ValueError("Een optienaam is verplicht; toelichting moet tekst zijn.")
                options[option_key][name] = value
        if "default" in changes:
            default = changes["default"]
            if field["type"] == "multiselect":
                if not isinstance(default, list) or len(default) != len(set(default)) or any(not any(same_value(value, o["id"]) for o in options.values()) for value in default):
                    raise ValueError("Kies geldige, unieke standaardposities.")
            elif options:
                if not any(same_value(default, option["id"]) for option in options.values()):
                    raise ValueError("Kies een geldige standaardoptie.")
            elif type(default) is not type(result["defaults"][key]):
                raise ValueError("Het type van de standaardwaarde mag niet wijzigen.")
            result["defaults"][key] = copy.deepcopy(default)
    return result


def patch_existing(document, patches):
    """Patch a bounded set of existing paths; callers build the allowlist from source."""
    result = copy.deepcopy(document)
    for path, value in patches:
        if not path:
            raise ValueError("Een document kan niet als geheel worden vervangen.")
        target = result
        for key in path[:-1]:
            target = target[key]
        if path[-1] not in target:
            raise ValueError("Het bronveld bestaat niet meer.")
        target[path[-1]] = copy.deepcopy(value)
    return result

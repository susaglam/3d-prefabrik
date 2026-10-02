"""One immutable catalogue release per request, shared by local and Odoo adapters."""
import copy
from contextlib import contextmanager
from contextvars import ContextVar
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re

from .errors import DomainError

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_RELEASE = ContextVar("prefab_catalog_release", default=None)
DEVICE_KEYS = {"heating", "outsideLight", "outsideSocket", "outsideTap", "ceilingLights", "spotlights", "switches", "sockets", "wallLights", "overhangSpots"}
ROLE_LABELS = {"preparation": "Voorbereiding", "product": "Product", "installation": "Montage", "connection": "Aansluiting"}
STATUS_LABELS = {"excluded": "Niet inbegrepen", "included": "Inbegrepen in casco", "extra": "Apart geprijsd"}
SUPPORTED_ASSETS = {"heating": {"heating", "heating-panel"}, "ceilingLights": {"ceilingLights", "ceiling-dome"}}
# Fields retired by a newer application version. 2.8.1 dropped the separate rollaag toggle: the three finishes are the
# complete choice. Catalogues published (and quote snapshots stored) by earlier versions still carry such fields.
# Fields the application no longer offers. A release that still carries one is served without it
# (retire_legacy_fields), so retiring costs no catalogue republication and no administrator action. 2.16.0 adds the
# three the customer struck from the product: a green roof, sun shading over the daklicht, and wall lighting inside
# ("geen groen dak", "geen zonwering optie", "wandverlichting n.v.t.").
RETIRED_FIELDS = frozenset({"rollaagEnabled", "greenRoof", "roofShade", "wallLights", "wallLightControl"})
# Values retired inside a field that stays. The double outdoor socket goes the same way (2.16.0, "buitenstopcontact
# alleen enkel aanbieden, rechts en links"); a design that still carries one falls back to the single socket on the
# same side, which is what it becomes in the price list too. Keys are field keys, values map retired → replacement.
RETIRED_VALUES = {"outsideSocket": {"double-left": "left", "double-right": "right", "double-both": "both"}}
# Optional casco price curve (2.10.4): casco = fixed + factor × (floor m²)^exponent, rounded to a multiple of roundTo.
# Money in integer eurocents; the exponent a decimal STRING, so it hashes and computes the same everywhere. A pricebook
# without the key prices exactly as before (area × basePerM2), which every release published before 2.10.4 relies on.
BASE_CURVE_KEYS = frozenset({"fixed", "factor", "exponent", "roundTo"})
_EXPONENT = re.compile(r"^[0-9]\.[0-9]{1,12}$|^[0-9]$")
_CENTS_CEILING = 2147483647


def check_base_curve(curve):
    """Raise ValueError (Dutch, for the admin) unless `curve` is a complete, sane casco price curve."""
    if not isinstance(curve, dict) or set(curve) != BASE_CURVE_KEYS:
        raise ValueError("De cascostaffel moet precies vaste basis, factor, groeifactor en afronding bevatten.")
    if any(type(curve[key]) is not int or not 0 <= curve[key] <= _CENTS_CEILING for key in ("fixed", "factor", "roundTo")) or curve["roundTo"] < 1:
        raise ValueError("Cascostaffel: bedragen moeten gehele, niet-negatieve eurocenten zijn en de afronding minstens 1 cent.")
    exponent = curve["exponent"]
    try:
        if not isinstance(exponent, str) or not _EXPONENT.match(exponent) or not Decimal("0.5") <= Decimal(exponent) <= Decimal("2"):
            raise ValueError
    except (InvalidOperation, ValueError):
        raise ValueError("Cascostaffel: de groeifactor is een decimaal getal tussen 0,5 en 2 (bijvoorbeeld 1.186).") from None


def credit_allowed(key, role, pricing):
    """A price REDUCTION (negative package price) is allowed only for a product choice priced per package.

    It carries the price list's 'minderprijs' rules, such as buitenstuc lowering the contract sum by EUR 2.000. Devices,
    per-m², per-piece and fixed-post prices stay non-negative, so a typing error cannot turn a point into a credit.
    """
    return role == "product" and pricing == "option" and key not in DEVICE_KEYS | {"underfloorHeating"}


def _mentions_retired(bundle):
    catalog = bundle.get("catalog") or {}
    if RETIRED_FIELDS & set(catalog.get("defaults") or ()) or RETIRED_FIELDS & set(bundle.get("policies") or ()) or RETIRED_FIELDS & set((bundle.get("pricebook") or {}).get("optionPrices") or ()):
        return True
    for key, retired in RETIRED_VALUES.items():
        prices = ((bundle.get("pricebook") or {}).get("optionPrices") or {}).get(key) or {}
        if retired.keys() & prices.keys():
            return True
    return any(field.get("key") in RETIRED_FIELDS or (field.get("visibleWhen") or {}).get("field") in RETIRED_FIELDS
               or any(option.get("id") in RETIRED_VALUES.get(field.get("key"), {}) for option in field.get("options") or [])
               for group in catalog.get("groups") or [] for field in group.get("fields") or [])


def retire_legacy_fields(bundle):
    """Return the release without retired fields, so an older publication needs no admin republication.

    Removes the default, the field itself, any visibleWhen link to it, its option prices and its supply policy. The
    stored revision is kept: the content served under it merely loses a choice the application no longer supports.
    Bundles without retired fields are returned untouched (no copy).
    """
    if not _mentions_retired(bundle):
        return bundle
    bundle = copy.deepcopy(bundle)
    catalog = bundle["catalog"]
    for key in RETIRED_FIELDS:
        (catalog.get("defaults") or {}).pop(key, None)
        (bundle.get("policies") or {}).pop(key, None)
        ((bundle.get("pricebook") or {}).get("optionPrices") or {}).pop(key, None)
    for key, retired in RETIRED_VALUES.items():
        prices = ((bundle.get("pricebook") or {}).get("optionPrices") or {}).get(key)
        if prices:
            for value in retired:
                prices.pop(value, None)
        choices = ((bundle.get("policies") or {}).get(key) or {}).get("choices")
        if choices:
            for value in retired:
                choices.pop(value, None)
    for group in catalog.get("groups") or []:
        group["fields"] = [field for field in group.get("fields") or [] if field.get("key") not in RETIRED_FIELDS]
        for field in group["fields"]:
            if (field.get("visibleWhen") or {}).get("field") in RETIRED_FIELDS:
                field.pop("visibleWhen")
            retired = RETIRED_VALUES.get(field.get("key"))
            if retired and field.get("options"):
                field["options"] = [option for option in field["options"] if option.get("id") not in retired]
    return bundle


def _read(name):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def default_policies(catalog, book):
    policies = {}
    for key, prices in book["optionPrices"].items():
        device = key in DEVICE_KEYS or key == "underfloorHeating"
        components = [{"role": "preparation" if device else "product", "status": "extra", "pricing": "area" if key in book["perM2"] else "option", "prices": prices, "unitPrice": 0}]
        if device:
            components += [{"role": role, "status": "excluded", "pricing": "count", "unitPrice": 0} for role in ("product", "installation", "connection")]
        policies[key] = {"visualMode": "preparation" if key == "underfloorHeating" else "representative" if device else "product", "modelFidelity": "representative", "assetKey": key, "components": components}
        if not device:
            for value, amount in prices.items():
                if amount == 0 and value not in {"none", "false", "0"}:
                    included = copy.deepcopy({name: value for name, value in policies[key].items() if name != "choices"})
                    included["components"][0]["status"] = "included"
                    policies[key].setdefault("choices", {})[value] = included
    policies["wallLights"] = {"visualMode": "representative", "modelFidelity": "representative", "assetKey": "wallLights", "components": [{"role": "preparation", "status": "extra", "pricing": "count", "unitPrice": 15000}] + [{"role": role, "status": "excluded", "pricing": "count", "unitPrice": 0} for role in ("product", "installation", "connection")]}
    # Position selection may contain more than one point on either wall.
    policies["sockets"]["components"][0].update(pricing="count", unitPrice=15000)
    return policies


def make_release(catalog, pricebook, policies=None, revision=None):
    data = {"catalog": copy.deepcopy(catalog), "pricebook": copy.deepcopy(pricebook), "policies": copy.deepcopy(policies if policies is not None else default_policies(catalog, pricebook))}
    data = retire_legacy_fields(data)
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    data["revision"] = revision or "local-" + hashlib.sha256(encoded.encode()).hexdigest()[:20]
    return data


def default_release():
    return make_release(_read("catalog.json"), _read("pricebook.demo-v1.json"))


def validate_release(bundle, *, allow_unapproved=False):
    """Reject incomplete or unsupported admin publications before they go live."""
    baseline = default_release()
    catalog, book, policies = bundle["catalog"], bundle["pricebook"], bundle["policies"]
    def fail(message):
        raise DomainError("Catalogus niet publiceerbaar: " + message)
    try:
        if catalog["schemaVersion"] != 2 or set(catalog["defaults"]) != set(baseline["catalog"]["defaults"]):
            fail("gebruik het ondersteunde schema 2 met alle bestaande velden.")
        if catalog.get("assetRevision") != baseline["catalog"]["assetRevision"]:
            fail("de modelbibliotheek moet overeenkomen met deze applicatieversie.")
        from .geometry_rules import validate_geometry_rules
        validate_geometry_rules(catalog["geometryRules"])
        original_fields = {f["key"]: f for g in baseline["catalog"]["groups"] for f in g["fields"]}
        fields = [f for g in catalog["groups"] for f in g["fields"]]
        if len(fields) != len(original_fields) or {f["key"] for f in fields} != set(original_fields):
            fail("velden ontbreken, zijn dubbel of worden niet door het model ondersteund.")
        for field in fields:
            original = original_fields[field["key"]]
            if field["type"] != original["type"] or not isinstance(field["label"], str):
                fail("ongeldig veldtype of label: " + field["key"])
            if original.get("options"):
                ids = [(type(o["id"]), o["id"]) for o in field["options"]]
                supported = {(type(o["id"]), o["id"]) for o in original["options"]}
                if not ids or len(set(ids)) != len(ids) or not set(ids).issubset(supported):
                    fail("ongeldige of nog niet gemodelleerde opties: " + field["key"])
        if set(catalog["dimensions"]) != set(baseline["catalog"]["dimensions"]):
            fail("ongeldige maatvelden.")
        for key, rule in catalog["dimensions"].items():
            original = baseline["catalog"]["dimensions"][key]
            if any(type(rule[k]) is not int for k in ("min", "max", "step")) or not original["min"] <= rule["min"] <= rule["max"] <= original["max"] or rule["step"] <= 0:
                fail("maatbereik valt buiten het ondersteunde model: " + key)
        if catalog["constraints"] != baseline["catalog"]["constraints"]:
            fail("wijzigingen in afhankelijke keuzes vereisen een aangepaste modelversie.")
        minimums = catalog["openingRules"]["minimumWidthCm"]
        supported_minimums = baseline["catalog"]["openingRules"]["minimumWidthCm"]
        if set(minimums) != set(supported_minimums) or any(type(v) is not int or not supported_minimums[k] <= v <= catalog["dimensions"]["width"]["max"] for k, v in minimums.items()):
            fail("kozijnregels mogen de voorlopige geometrische ondergrens niet verlagen.")
        if book["currency"] != "EUR" or book["priceMode"] not in {"demonstration", "commercial"}:
            fail("gebruik EUR en een ondersteunde prijsstatus.")
        if book["priceMode"] == "commercial" and not allow_unapproved:
            approval = bundle.get("commercialApproval", {})
            if approval.get("contentRevision") != make_release(catalog, book, policies)["revision"] or not all(approval.get(key) for key in ("reference", "approvedById", "approvedAt")):
                fail("deze exacte commerciële inhoud is nog niet door een bevoegde beheerder goedgekeurd.")
        for key in ("basePerM2", "fixedSetup", "vatRate"):
            if type(book[key]) is not int or book[key] < 0 or key == "vatRate" and book[key] > 100:
                fail("ongeldige basisprijs of btw.")
        if "baseCurve" in book:
            try:
                check_base_curve(book["baseCurve"])
            except ValueError as exc:
                fail(str(exc))
        if not all(isinstance(book[k], str) and book[k].strip() for k in ("pricebookVersion", "disclaimer")):
            fail("prijsboekversie en prijstoelichting zijn verplicht.")
        if not set(baseline["policies"]).issubset(policies) or not set(policies).issubset(original_fields):
            fail("leveringsregels ontbreken of verwijzen naar onbekende velden.")
        by_key = {f["key"]: f for f in fields}
        for key, base_policy in policies.items():
            field = by_key[key]
            allowed = {str(o["id"]).lower() if type(o["id"]) is bool else str(o["id"]) for o in field.get("options", [])}
            choices = base_policy.get("choices", {})
            if not set(choices).issubset(allowed) or choices and field["type"] == "multiselect":
                fail("ongeldige waarde voor een specifieke leveringsregel: " + key)
            for policy in [base_policy, *choices.values()]:
                if policy.get("assetKey", key) not in SUPPORTED_ASSETS.get(key, {key}):
                    fail("alleen het huidige indicatieve model van dit onderdeel is beschikbaar: " + key)
                if policy["visualMode"] not in {"none", "preparation", "product", "representative"} or policy["modelFidelity"] != "representative":
                    fail("niet ondersteunde modelweergave: " + key)
                components = policy["components"]
                roles = [c["role"] for c in components]
                if not roles or len(roles) != len(set(roles)) or not set(roles).issubset(ROLE_LABELS):
                    fail("ongeldige of dubbele leveringscomponent: " + key)
                if key in DEVICE_KEYS | {"underfloorHeating"} and set(roles) != set(ROLE_LABELS):
                    fail("voor voorzieningen zijn voorbereiding, product, montage en aansluiting verplicht: " + key)
                for component in components:
                    prices = component.get("prices", {})
                    if component["status"] not in STATUS_LABELS or component["pricing"] not in {"option", "area", "count", "fixed"}:
                        fail("ongeldige leveringsstatus of prijsgrondslag: " + key)
                    credit = credit_allowed(key, component["role"], component["pricing"])
                    if type(component.get("unitPrice", 0)) is not int or component.get("unitPrice", 0) < 0 or not isinstance(prices, dict) or any(type(v) is not int or v < 0 and not credit for v in prices.values()):
                        fail("prijzen moeten niet-negatieve gehele eurocenten zijn (alleen een productpakket mag een minderprijs hebben): " + key)
                    if component["status"] == "extra" and component["pricing"] in {"option", "area"} and (field["type"] == "multiselect" or not allowed.issubset(prices)):
                        fail("een expliciete pakketprijs ontbreekt voor een optiewaarde: " + key)
        # Import locally to keep the domain dependency graph acyclic.
        from .configuration import canonical_config
        from .pricing import price_config
        with release_context(bundle):
            canonical_config(catalog["defaults"])
            price_config(catalog["defaults"])
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        fail("ongeldige catalogusstructuur (" + type(exc).__name__ + ").")
    return bundle


def current_release():
    return _RELEASE.get() or default_release()


@contextmanager
def release_context(release=None):
    # Stored publications bypass make_release, so retired fields are dropped when the release enters use.
    token = _RELEASE.set(retire_legacy_fields(release or current_release()))
    try:
        yield _RELEASE.get()
    finally:
        _RELEASE.reset(token)


def get_catalog():
    return copy.deepcopy(current_release()["catalog"])


def get_pricebook():
    return copy.deepcopy(current_release()["pricebook"])


def check_revision(revision):
    if revision is not None and (not isinstance(revision, str) or revision != current_release()["revision"]):
        raise DomainError("Het aanbod is bijgewerkt. Controleer de nieuwe prijs en leveringsomvang voordat je verdergaat.", code="catalog_changed", status=409)


def public_catalog():
    with release_context() as release:
        catalog = get_catalog()
        catalog.update({key: release["pricebook"][key] for key in ("pricebookVersion", "currency", "priceMode", "disclaimer")})
        catalog["catalogRevision"] = release["revision"]
        catalog["scopePolicies"] = {key: {"visualMode": p["visualMode"], "modelFidelity": p["modelFidelity"], "productIncluded": any(c["role"] == "product" and c["status"] != "excluded" for c in p["components"])} for key, p in release["policies"].items()}
        catalog["priceStatusLabel"] = price_status_label(release["pricebook"], approved=bool(release.get("commercialApproval")))
        catalog["supportedModels"] = {key: sorted(values) for key, values in SUPPORTED_ASSETS.items()}
        if catalog.get("geometryRules", {}).get("version") == 1:
            from .configuration import canonical_config
            from .geometry_rules import placement_result
            config = canonical_config(catalog["defaults"])
            catalog.update(placement_result(config, {}, catalog["geometryRules"], model_assets(config), asset_revision=catalog.get("assetRevision")))
        return catalog


def price_status_label(book, *, approved=True):
    if book.get("priceMode") == "commercial":
        return "Prijsindicatie op goedgekeurde tarieven" if approved else "Concepttarieven — nog niet goedgekeurd"
    return "Demonstratieprijzen — geen bindende offerte"


def model_assets(config):
    result = {}
    for key in SUPPORTED_ASSETS:
        policy = current_release()["policies"].get(key, {})
        value = str(config.get(key))
        selected = policy.get("choices", {}).get(value, policy)
        result[key] = selected.get("assetKey", key)
    heating = current_release()["policies"].get("heating", {})
    result["heatingChoices"] = {value: heating.get("choices", {}).get(value, heating).get("assetKey", "heating") for value in ("left", "right", "both")}
    return result


def asset_choices():
    catalog = _read("catalog.json")
    fields = {field["key"]: field["label"] for group in catalog["groups"] for field in group["fields"]}
    result = [(key, fields.get(key, key) + " · standaard indicatief model") for key in default_release()["policies"]]
    return result + [("heating-panel", "Radiator · horizontaal paneel (indicatief)"), ("ceiling-dome", "Plafondlamp · koepel (indicatief)")]

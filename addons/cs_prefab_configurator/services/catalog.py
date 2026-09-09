"""Versioned, local catalogue. Pricing is deliberately marked as demonstration."""
import copy
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def get_catalog():
    with (DATA_DIR / "catalog.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def get_pricebook():
    with (DATA_DIR / "pricebook.demo-v1.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def public_catalog():
    catalog = copy.deepcopy(get_catalog())
    pricebook = get_pricebook()
    catalog.update({key: pricebook[key] for key in (
        "pricebookVersion", "currency", "priceMode", "disclaimer"
    )})
    return catalog

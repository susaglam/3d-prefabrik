"""Readable/native sales rows derived only from a frozen request, never today's catalog."""
from decimal import Decimal

ROLE_NAMES = {"product": "Product", "preparation": "Voorbereiding", "installation": "Montage", "connection": "Aansluiting"}
STATUS_NAMES = {"extra": "Apart geprijsd", "included": "Inbegrepen", "excluded": "Niet inbegrepen"}


def sales_rows(snapshot):
    price = snapshot.get("price", {})
    scope = snapshot.get("scope", price.get("scope", []))
    rows = []

    def add(key, name, quantity, unit, unit_price, role="product", status="extra"):
        rows.append({"key": key, "name": name, "quantity": float(quantity), "unit": unit,
                     "unitPrice": int(unit_price), "role": role, "status": status,
                     "roleLabel": ROLE_NAMES.get(role, role), "statusLabel": "Minderprijs" if unit_price < 0 else STATUS_NAMES.get(status, status)})

    # Before version 2, the priced rows are the only frozen source of scope. The posts that belong to no option —
    # casco, startkosten and (2.18.0) the kilometervergoeding — are always taken from the priced rows.
    for line in price.get("lines", []):
        if not scope or line["id"] in {"base", "setup", "travel"}:
            add(line["id"], line["label"], line["quantity"], line["unit"], line["unitPrice"], line.get("role", "product"))
    for item in scope:
        for component in item.get("components", []):
            role, status = component["role"], component["status"]
            add(item["key"] + "." + role,
                f"{item['label']} · {component.get('label', ROLE_NAMES.get(role, role))}: {item['value']}",
                component["quantity"], component["unit"], component["unitPrice"] if status == "extra" else 0, role, status)
    return rows


def row_total(row):
    return float(Decimal(str(row["quantity"])) * Decimal(row["unitPrice"]) / 100)


def request_summary(snapshot, contact):
    lines = [f"{item['label']}: {item['value']}" for item in snapshot.get("labels", [])]
    address = " ".join(str(contact.get(key, "")) for key in ("address", "houseNumber", "postcode", "city")).strip()
    if address:
        lines.insert(0, "Uitvoeringsadres: " + address)
    if contact.get("message"):
        lines.append("Klantopmerking: " + contact["message"])
    return "\n".join(lines)

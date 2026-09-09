"""Dependency-free, paginated PDF and printable HTML from saved snapshots."""
import html

from .pdf_font import bundled_font, font_objects


def money(cents):
    formatted = f"{cents / 100:,.2f}"
    return "EUR " + formatted.replace(",", "~").replace(".", ",").replace("~", ".")


def document_lines(quote):
    snapshot, contact = quote["snapshot"], quote["contact"]
    price = snapshot["price"]
    lines = [("CS PREFAB / AANVRAAGOVERZICHT", "title"), (quote["reference"], "subtitle"),
             ("DEMONSTRATIE - GEEN BINDENDE OFFERTE", "warning"),
             (f"Opgeslagen op {snapshot['createdAt']} | Prijsboek {price['pricebookVersion']}", "body"),
             ("Contactgegevens", "heading"), (contact["name"], "body"),
             (f"{contact['email']} | {contact['phone']}", "body"),
             (f"{contact['address']} {contact['houseNumber']}, {contact['postcode']} {contact['city']}", "body"),
             ("Uw samenstelling", "heading")]
    for label in snapshot["labels"]:
        lines.append((f"{label['label']}: {label['value']}", "body"))
    lines.append(("Indicatieve kostenopbouw", "heading"))
    for line in price["lines"]:
        quantity = f"{line['quantity']:g} {line['unit']}"
        lines.append((f"{line['label']} ({quantity})  {money(line['total'])}", "body"))
    lines.extend([(f"Subtotaal exclusief btw: {money(price['subtotal'])}", "body"),
                  (f"Btw {price['vatRate']}%: {money(price['vat'])}", "body"),
                  (f"Totaal inclusief btw: {money(price['total'])}", "heading"),
                  ("Uitgangspunten en voorbehouden", "heading"), (price["disclaimer"], "body")])
    for warning in price["warnings"]:
        lines.append((warning, "body"))
    if contact.get("message"):
        lines.extend([("Uw opmerking", "heading"), (contact["message"], "body")])
    lines.extend([("Dit overzicht is automatisch opgeslagen. Een adviseur moet de technische haalbaarheid, scope en definitieve prijs nog beoordelen.", "body"),
                  ("Toestemming voor contact vastgelegd bij aanvraag (quote-contact-v1).", "body")])
    return lines


def quote_html(quote):
    elements = []
    tags = {"title": "h1", "subtitle": "h2", "heading": "h3", "warning": "strong", "body": "p"}
    for value, kind in document_lines(quote):
        tag = tags[kind]
        elements.append(f"<{tag}>{html.escape(value)}</{tag}>")
    return ("<!doctype html><html lang='nl'><meta charset='utf-8'><title>Aanvraagoverzicht</title>"
            "<style>body{font:14px/1.5 system-ui;max-width:820px;margin:40px auto;color:#163d35;padding:20px}"
            "h1{font-size:25px}h3{border-bottom:1px solid #ccd6d0;padding-top:18px}p{margin:5px 0}"
            "strong{display:block;background:#fff0cd;padding:12px}@media print{body{margin:0}h3{break-after:avoid}}</style><body>"
            + "".join(elements) + "</body></html>").encode("utf-8")


def quote_pdf(quote):
    """A4 PDF 1.4 with an embedded Unicode TrueType font and frozen footprint."""
    source_lines = document_lines(quote)
    config = quote["snapshot"]["config"]
    plan_strings = ["Schematische plattegrond", "Bestaande woning", "Voorzijde",
                    f"Breedte: {config['width']} cm", f"Diepte: {config['depth']} cm"]
    font = bundled_font()
    fonts, codes = font_objects("".join(value for value, _ in source_lines) + "".join(plan_strings) + "0123456789 |")

    def encoded(value):
        return "<" + "".join(f"{codes[char]:04X}" for char in value) + ">"

    pages = []
    commands = []
    y = 794

    def finish_page():
        nonlocal commands, y
        commands.append(f"BT /F1 8 Tf 0 Tr 45 28 Td {encoded(quote['reference'] + ' | ' + str(len(pages) + 1))} Tj ET")
        pages.append("\n".join(commands).encode("ascii"))
        commands = []
        y = 794

    def draw_plan():
        nonlocal y
        if y < 265:
            finish_page()
        commands.append(f"BT /F1 10 Tf 0 Tr 0.08 0.20 0.17 rg 45 {y - 8} Td {encoded(plan_strings[0])} Tj ET")
        scale = min(280 / config["width"], 115 / config["depth"])
        width, depth = round(config["width"] * scale, 2), round(config["depth"] * scale, 2)
        x, top = 60, y - 39
        bottom = top - depth
        commands.append(f"q 0.94 0.96 0.94 rg 0.12 0.26 0.22 RG 2 w {x} {bottom} {width} {depth} re B Q")
        commands.append(f"q 0.32 0.33 0.32 RG 5 w {x} {top} m {x + width} {top} l S Q")
        if config["frontOpening"] != "none":
            commands.append(f"q 0.24 0.57 0.60 RG 4 w {x + width * .2:.2f} {bottom} m {x + width * .8:.2f} {bottom} l S Q")
        if config["rooflight"] != "none":
            commands.append(f"q 0.77 0.88 0.91 rg 0.24 0.57 0.60 RG 1 w {x + width * .35:.2f} {bottom + depth * .25:.2f} {width * .30:.2f} {depth * .5:.2f} re B Q")
        for label, tx, ty in [(plan_strings[1], x, top + 10), (plan_strings[2], x, bottom - 14),
                              (plan_strings[3], x, bottom - 29), (plan_strings[4], x + width + 12, bottom + depth / 2)]:
            commands.append(f"BT /F1 8 Tf 0 Tr 0.08 0.20 0.17 rg {tx} {ty} Td {encoded(label)} Tj ET")
        y = bottom - 49

    for value, kind in source_lines:
        size = {"title": 19, "subtitle": 13, "heading": 12, "warning": 10, "body": 9}[kind]
        if kind in ("title", "heading", "warning"):
            y -= 10
        wrapped = []
        for paragraph in value.splitlines() or [""]:
            wrapped.extend(font.wrap(paragraph, size))
        required = len(wrapped) * (size + 5) + 6
        if y - required < 55:
            finish_page()
        for line in wrapped:
            if y < 55:
                finish_page()
            color = "0.58 0.28 0.03" if kind == "warning" else "0.08 0.20 0.17"
            render = "0 Tr" if kind == "body" else "2 Tr 0.2 w"
            commands.append(f"BT /F1 {size} Tf {render} {color} rg {color} RG 45 {y} Td {encoded(line)} Tj ET")
            y -= size + 5
        y -= 3
        if value == "Uw samenstelling" and kind == "heading":
            draw_plan()
    if commands:
        finish_page()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""] + fonts
    kids = []
    for stream in pages:
        page_id = len(objects) + 1
        kids.append(f"{page_id} 0 R")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>".encode("ascii"))
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode("ascii")
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    return bytes(output)

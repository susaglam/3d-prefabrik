"""Designed proposal documents made exclusively from a saved quote snapshot."""
import html
from datetime import datetime

from .appearance import PROPOSAL_COLORS
from .pdf_layout import PdfDocument, PAGE_W, INK, MUTED, PAPER, LINE, ACCENT, WHITE

DOCUMENT_VERSION = "proposal-v2"
MARGIN, WIDTH = 38, PAGE_W - 76
GROUPS = (
    ("Buitenzijde", ("facade", "rollaag", "frontOpening", "rooflight", "roofEdge")),
    ("Voorzieningen buiten", ("outsideLight", "outsideSocket", "outsideTap", "drainMaterial", "drainSide")),
    ("Binnenafwerking", ("interior", "plaster", "screed", "underfloorHeating", "heating")),
    ("Elektra binnen", ("ceilingLights", "switches", "spotlights", "sockets")),
    ("Bestaande situatie & uitvoering", ("demolition", "access", "piles")),
)
LABELS = {"facade": "Gevelbekleding", "rollaag": "Afwerking boven kozijn", "frontOpening": "Kozijn voorzijde",
          "rooflight": "Daglicht in het dak", "roofEdge": "Dakrand", "outsideLight": "Buitenverlichting",
          "outsideSocket": "Buitenstopcontact", "outsideTap": "Buitenkraan", "drainMaterial": "Materiaal hemelwaterafvoer",
          "drainSide": "Positie hemelwaterafvoer", "interior": "Binnenafwerking", "plaster": "Stucwerk",
          "screed": "Dekvloer", "underfloorHeating": "Vloerverwarming", "heating": "Radiator",
          "ceilingLights": "Lichtpunten plafond", "switches": "Lichtschakelaars", "spotlights": "Inbouwspots",
          "sockets": "Wandcontactdozen", "demolition": "Geveldoorbraak", "access": "Bereikbaarheid", "piles": "Heipalen"}


def price_status(price):
    """Read the saved status; old snapshots keep their original demonstration copy."""
    return price.get("priceStatusLabel") or (
        "Prijsindicatie op goedgekeurde tarieven" if price.get("priceMode") == "commercial"
        else "DEMONSTRATIE — GEEN BINDENDE OFFERTE"
    )


def commercial_price(price):
    return price.get("priceMode") == "commercial"


def number(value, places=2):
    return f"{value:,.{places}f}".rstrip("0").rstrip(".").replace(",", "~").replace(".", ",").replace("~", ".") if places else str(value)


def money(cents):
    return "€ " + f"{cents / 100:,.2f}".replace(",", "~").replace(".", ",").replace("~", ".")


def date_label(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%d.%m.%Y")
    except (ValueError, TypeError):
        return str(value)


def choice_rows(snapshot):
    labels = {row["key"]: row for row in snapshot["labels"]}
    used = set()
    for title, keys in GROUPS:
        rows = [(labels[key]["label"] if snapshot.get("snapshotVersion", 1) >= 2 else LABELS.get(key, labels[key]["label"]), str(labels[key]["value"])) for key in keys if key in labels]
        used.update(key for key in keys if key in labels)
        if rows:
            yield title, rows
    if snapshot.get("snapshotVersion", 1) >= 2:
        additional = [(row["label"], str(row["value"])) for key, row in labels.items() if key not in used and key not in {"width", "depth", "height", "postcode"}]
        if additional:
            yield "Aanvullende uitvoering en posities", additional


def document_lines(quote):
    """Semantic content also used by integrations that need a text summary."""
    snapshot, contact = quote["snapshot"], quote["contact"]
    price = snapshot["price"]
    lines = [("CS PREFAB / ONTWERPVOORSTEL", "title"), (quote["reference"], "subtitle"),
             (price_status(price), "warning"), (contact["name"], "body")]
    for label in snapshot["labels"]:
        lines.append((f"{label['label']}: {label['value']}", "body"))
    for line in price["lines"]:
        lines.append((f"{line['label']} ({number(line['quantity'])} {line['unit']}) {money(line['total'])}", "body"))
    lines.extend([(f"Totaal inclusief btw: {money(price['total'])}", "heading"), (price["disclaimer"], "body")])
    if commercial_price(price):
        lines.append(("Dit voorstel is een prijsindicatie, geen bindende offerte. De definitieve offerte volgt na opname en technische beoordeling.", "body"))
    lines.extend((warning, "body") for warning in price["warnings"])
    lines.extend((f"{item['label']}: {item['summary']}", "body") for item in snapshot.get("scope", []))
    if contact.get("message"):
        lines.append((contact["message"], "body"))
    return lines


def _fallback_diagram(doc, config, x, y, width, height, *, elevation=False, side=False):
    """Legible native vector fallback for historical records without saved views."""
    doc.rect(x, y, width, height, fill=PAPER, stroke=LINE)
    horizontal = config["depth"] if side else config["width"]
    vertical = config["height"] if elevation else config["depth"]
    scale = min((width - 100) / horizontal, (height - 90) / vertical)
    w, h = horizontal * scale, vertical * scale
    bx, by = x + (width - w) / 2, y + (height - h) / 2 - 5
    doc.rect(bx, by, w, h, fill=WHITE, stroke=INK, weight=2)
    if not elevation:
        doc.line(bx, by, bx + w, by, color=INK, weight=5)
        doc.text(bx + w / 2, by - 12, "Bestaande woning", size=7, color=MUTED, align="center")
    doc.line(bx, by + h + 19, bx + w, by + h + 19, color=MUTED)
    for dx in (bx, bx + w):
        doc.line(dx, by + h + 13, dx, by + h + 24, color=MUTED)
    doc.text(bx + w / 2, by + h + 34, f"{horizontal} cm", size=8, align="center")
    doc.line(bx + w + 17, by, bx + w + 17, by + h, color=MUTED)
    for dy in (by, by + h):
        doc.line(bx + w + 12, dy, bx + w + 22, dy, color=MUTED)
    doc.text(bx + w + 24, by + h / 2 + 3, f"{vertical}", size=7)


def _cover(doc, quote, views):
    snap, contact = quote["snapshot"], quote["contact"]
    config, price = snap["config"], snap["price"]
    doc.new_page("Jouw ontwerp", cover=True)
    doc.text(PAGE_W - 38, 40, quote["reference"], size=7.4, color=MUTED, align="right")
    doc.text(PAGE_W - 38, 55, date_label(snap["createdAt"]), size=8, color=MUTED, align="right")
    doc.text(38, 107, "PERSOONLIJK ONTWERPVOORSTEL", size=8, color=ACCENT, tracking=1.5, bold=True)
    doc.text(38, 151, "Jouw aanbouw,", size=34, bold=True)
    doc.text(38, 193, "tot in detail.", size=34, bold=True)
    hero = views.get("perspective-left") or views.get("perspective-right") or views.get("plan")
    doc.rect(38, 218, WIDTH, 307, fill=PAPER)
    if hero:
        doc.image(hero, 39, 219, WIDTH - 2, 286)
    else:
        _fallback_diagram(doc, config, 38, 218, WIDTH, 287)
    doc.text(50, 513, "Jouw opgeslagen ontwerp · schematische weergave", size=7, color=MUTED)
    metrics = [("BREEDTE", f"{number(config['width'] / 100)} m"),
               ("DIEPTE", f"{number(config['depth'] / 100)} m"),
               ("EXTRA OPPERVLAKTE", f"{number(config['width'] * config['depth'] / 10000)} m²")]
    cell = (WIDTH - 18) / 3
    for i, (label, value) in enumerate(metrics):
        x = 38 + i * (cell + 9)
        doc.rect(x, 542, cell, 65, fill=PAPER)
        doc.text(x + 13, 563, label, size=6.7, color=MUTED, tracking=.7)
        doc.text(x + 13, 591, value, size=20, bold=True)
    doc.text(38, 638, "SAMENGESTELD VOOR", size=7, color=MUTED, tracking=.8)
    # Long customer details continue in full on the final page, without truncation.
    names = doc.wrapped(contact["name"], 11, 280)
    if len(names) <= 2:
        for i, line in enumerate(names):
            doc.text(38, 659 + i * 15, line, size=11, bold=True)
        address = f"{contact['address']} {contact['houseNumber']}\n{contact['postcode']} {contact['city']}"
        address_lines = doc.wrapped(address, 8.5, 280)
        if len(address_lines) <= 3:
            doc.paragraph(38, 681 + (len(names) - 1) * 15, address, width=280, size=8.5, leading=12.5, color=MUTED)
        else:
            doc.text(38, 695, "Volledige projectgegevens achterin dit voorstel.", size=8, color=MUTED)
    else:
        doc.text(38, 659, "Volledige projectgegevens achterin dit voorstel.", size=8, color=MUTED)
    doc.rect(350, 628, PAGE_W - 388, 107, fill=INK)
    doc.text(365, 650, "INDICATIE INCLUSIEF BTW", size=6.4, color=WHITE, tracking=.6)
    doc.text(365, 683, money(price["total"]), size=21, color=WHITE, bold=True)
    cover_note = "Prijsindicatie. Definitieve offerte na technische beoordeling." if commercial_price(price) else "Demoprijzen. Definitieve offerte na technische beoordeling."
    doc.paragraph(365, 704, cover_note, width=176, size=7.1, leading=11, color=WHITE)
    doc.text(38, 763, price_status(price), size=7, color=ACCENT, bold=True, tracking=.4)


def _gallery(doc, views, snapshot=None):
    chosen = [(key, label, note) for key, label, note in (
        ("perspective-right", "Perspectief vanaf rechts", "Gevel, dakrand en kozijn vanuit de andere hoek."),
        ("interior", "Een blik naar binnen", "Dak tijdelijk verborgen om de gekozen indeling zichtbaar te maken.")) if key in views]
    if not chosen:
        return
    doc.new_page("Ruimtelijke impressies")
    doc.section_title("01 / RUIMTELIJKE IMPRESSIES", "Bekijk het van alle kanten.",
                      "Dezelfde samenstelling, vanuit aanvullende standpunten. Materialen en kleuren zijn indicatief.")
    for i, (key, label, note) in enumerate(chosen):
        doc.image_card(views[key], 38, 190 + i * 287, WIDTH, 230, number=f"0{i+2}", label=label, note=note)
    caption = "Contouren: voorbeeldapparaten, niet inbegrepen. Inbegrepen producten kunnen als indicatief model zijn getoond." if (snapshot or {}).get("snapshotVersion", 1) >= 2 else "Impressies tonen het gekozen concept. Aansluitingen en constructie worden bij de opname vastgesteld."
    doc.text(38, 771, caption, size=7, color=MUTED)


def _technical(doc, config, views):
    doc.new_page("Maatvoering & aanzichten")
    doc.section_title("02 / MAATVOERING & AANZICHTEN", "Het ontwerp op papier.",
                      "Schematische tekeningen van de gekozen buitenmaten. Alle getoonde maten zijn in centimeters.")
    if "plan" in views:
        doc.image_card(views["plan"], 38, 190, WIDTH, 268, number="A", label="Schematische plattegrond")
    else:
        _fallback_diagram(doc, config, 38, 190, WIDTH, 268)
        doc.text(38, 475, "A   Schematische plattegrond", size=9.5, bold=True)
    cell = (WIDTH - 15) / 2
    for i, (key, title) in enumerate((("front", "Voorgevel"), ("side", "Rechter zijgevel"))):
        x = 38 + i * (cell + 15)
        if key in views:
            doc.image_card(views[key], x, 501, cell, 171, number="B" if i == 0 else "C", label=title)
        else:
            _fallback_diagram(doc, config, x, 501, cell, 171, elevation=True, side=bool(i))
            doc.text(x, 689, f"{'B' if i == 0 else 'C'}   {title}", size=9.5, bold=True)
    doc.rect(38, 708, WIDTH, 29, fill=PAPER)
    for i, (name, key) in enumerate((("Breedte", "width"), ("Diepte", "depth"), ("Modelhoogte", "height"))):
        doc.text(50 + i * 174, 727, f"{name}: {config[key]} cm", size=8.5, bold=True)
    doc.paragraph(38, 754, "Buitenmaten en openingen volgen het configuratiemodel; wanddiktes en vaste modelhoogte zijn aannames. "
                  "Geen constructie-, vergunning- of productietekening. Niet op schaal afdrukken.", width=WIDTH, size=7.5, leading=11, color=MUTED)


def _specifications(doc, snapshot):
    def page(continued=False):
        doc.new_page("Materialen & voorzieningen")
        return doc.section_title("03 / MATERIALEN & VOORZIENINGEN", "Alles wat je hebt gekozen.",
                                 "Vervolg van je opgeslagen samenstelling." if continued else "Je materiaalkeuzes en voorzieningen, gegroepeerd per onderdeel van de aanbouw.")
    y = page()
    for title, rows in choice_rows(snapshot):
        heights = [max(19, doc.height(value, width=WIDTH - 221, size=8.5, leading=11) + 8,
                       doc.height(label, width=189, size=8.3, leading=11) + 8) for label, value in rows]
        if y + 22 + sum(heights) > 775:
            y = page(True)
        doc.rect(38, y, WIDTH, 22, fill=INK)
        doc.text(50, y + 15, title.upper(), size=7.4, color=WHITE, bold=True, tracking=.5)
        y += 22
        for index, ((label, value), h) in enumerate(zip(rows, heights)):
            if y + h > 775:
                y = page(True)
                doc.rect(38, y, WIDTH, 22, fill=INK)
                doc.text(50, y + 15, title.upper() + " (VERVOLG)", size=7.4, color=WHITE, bold=True)
                y += 22
            doc.rect(38, y, WIDTH, h, fill=PAPER if index % 2 == 0 else WHITE)
            doc.paragraph(50, y + 13, label, width=189, size=8.3, leading=11, color=MUTED)
            doc.paragraph(248, y + 13, value, width=WIDTH - 221, size=8.5, leading=11)
            y += h
        y += 10


def _price(doc, price):
    def page(continued=False):
        doc.new_page("Indicatieve kostenopbouw")
        intro = "De bedragen hieronder horen bij je opgeslagen samenstelling. " + (
            price_status(price) + "." if commercial_price(price) or price.get("priceStatusLabel")
            else "Prijzen zijn demonstratiebedragen."
        )
        y = doc.section_title("04 / INDICATIEVE KOSTENOPBOUW", "Helder opgebouwd.",
                              "Vervolg van de kostenopbouw." if continued else intro)
        doc.rect(38, y, WIDTH, 26, fill=INK)
        for x, label, align in ((49, "ONDERDEEL", "left"), (344, "AANTAL", "right"),
                                 (382, "EENH.", "right"), (463, "PRIJS / EENH.", "right"), (547, "EXCL. BTW", "right")):
            doc.text(x, y + 17, label, size=6.5, color=WHITE, align=align, bold=True)
        return y + 26
    y = page()
    for index, row in enumerate(price["lines"]):
        h = max(22, doc.height(row["label"], width=258, size=8.1, leading=10.5) + 9)
        if y + h > 752:
            y = page(True)
        doc.rect(38, y, WIDTH, h, fill=PAPER if index % 2 == 0 else WHITE)
        doc.paragraph(49, y + 14, row["label"], width=258, size=8.1, leading=10.5)
        for x, value in ((344, number(row["quantity"], 4)), (382, row["unit"]),
                         (463, money(row["unitPrice"])), (547, money(row["total"]))):
            doc.text(x, y + 14, value, size=8, align="right")
        y += h
    if y + 169 > 776:
        doc.new_page("Indicatieve kostenopbouw")
        y = doc.section_title("04 / INDICATIEVE KOSTENOPBOUW", "Je totale investering.", "Samenvatting van de kosten op de voorgaande pagina.")
    y += 17
    doc.line(38, y, PAGE_W - 38, y, color=INK)
    doc.text(293, y + 25, "Subtotaal excl. btw", size=9, color=MUTED)
    doc.text(547, y + 25, money(price["subtotal"]), size=9, align="right")
    doc.text(293, y + 45, f"Btw {price['vatRate']}%", size=9, color=MUTED)
    doc.text(547, y + 45, money(price["vat"]), size=9, align="right")
    doc.rect(281, y + 59, WIDTH - 243, 63, fill=INK)
    doc.text(293, y + 78, "TOTAAL INCLUSIEF BTW", size=7, color=WHITE, tracking=.4)
    doc.text(547, y + 107, money(price["total"]), size=21, color=WHITE, align="right", bold=True)
    doc.text(38, y + 26, "Een transparant vertrekpunt", size=11, bold=True)
    doc.paragraph(38, y + 47, "Dit overzicht geeft inzicht in de gekozen onderdelen. De definitieve scope en prijs volgen na opname en technische beoordeling.",
                  width=212, size=8.5, leading=13, color=MUTED)
    doc.text(38, y + 147, f"Prijsboek: {price['pricebookVersion']} · Bedragen in euro · Afronding per regel", size=7.2, color=MUTED)


def _scope(doc, quote, views):
    snapshot, contact = quote["snapshot"], quote["contact"]
    price = snapshot["price"]

    def page(continued=False):
        doc.new_page("Uitgangspunten & vervolg")
        return doc.section_title("05 / UITGANGSPUNTEN & VERVOLG", "De volgende stap naar jouw aanbouw.",
                                 "Vervolg van de aanvraaggegevens." if continued else "Deze aanvraag is het vertrekpunt voor een gesprek en een uitgewerkte offerte.", size=23)

    y = page()

    def block(title, value):
        nonlocal y
        lines = doc.wrapped(value, 8.5, WIDTH - 27)
        if y + 49 > 774:
            y = page(True)
        doc.text(51, y + 11, title, size=10, bold=True)
        y += 29
        for line in lines:
            if y + 14 > 774:
                y = page(True)
                doc.text(51, y + 11, title + " (vervolg)", size=10, bold=True)
                y += 29
            doc.line(38, y - 9, 38, y + 4, color=ACCENT, weight=1.7)
            doc.text(51, y, line, size=8.5, color=MUTED)
            y += 13
        y += 16

    block("Prijsstatus", price["disclaimer"])
    if commercial_price(price):
        block("Status van dit voorstel", "Dit voorstel is een prijsindicatie, geen bindende offerte. De definitieve offerte volgt na opname en technische beoordeling.")
    for item in snapshot.get("scope", []):
        block(item["label"] + " · leveringsomvang", item["summary"])
    if price["warnings"]:
        block("Aandachtspunten bij je keuzes", "\n".join("• " + value for value in price["warnings"]))
    block("Technische beoordeling", "Een adviseur moet de technische haalbaarheid, fundering, aansluitingen, bereikbaarheid en definitieve scope nog beoordelen. De beelden en maatvoering zijn schematisch; kleuren kunnen afwijken van echte materialen.")
    if not all(key in views for key in ("perspective-left", "perspective-right", "interior")):
        block("Beschikbare tekeningen", "Bij deze aanvraag zijn niet alle 3D-aanzichten opgeslagen. De beschikbare beelden en de schematische maatvoering zijn in dit document opgenomen.")
    if contact.get("message"):
        block("Jouw toelichting", contact["message"])
    details = (f"{contact['name']}\n{contact['address']} {contact['houseNumber']}\n"
               f"{contact['postcode']} {contact['city']}\n{contact['email']}\n{contact['phone']}")
    block("Project- en contactgegevens", details)
    if y + 75 > 771:
        y = page(True)
    cell = (WIDTH - 20) / 3
    for i, (title, note) in enumerate((("01  Ontwerp bespreken", "Wensen, keuzes en situatie doornemen."),
                                       ("02  Technisch beoordelen", "Maten, aansluitingen en uitvoering bepalen."),
                                       ("03  Offerte uitwerken", "Scope en definitieve prijs vastleggen."))):
        x = 38 + i * (cell + 10)
        doc.rect(x, y, cell, 67, fill=PAPER)
        doc.text(x + 10, y + 19, title, size=7.5, bold=True)
        doc.paragraph(x + 10, y + 36, note, width=cell - 20, size=7.5, leading=11, color=MUTED)
    doc.text(38, 780, "Toestemming voor contact vastgelegd bij aanvraag (quote-contact-v1).", size=6.5, color=MUTED)


def build_proposal(quote):
    # "brand" is absent on the standalone server, which has no appearance record
    # and therefore keeps the built-in wordmark. "palette" and "brandName" come from the
    # same place (models/quote.py): the website's vormgeving, or Odoo's document colours.
    doc = PdfDocument(quote["reference"], logo=quote.get("brand"),
                      palette=(quote.get("palette") or {}).get("colors"), brand_name=quote.get("brandName"))
    views = {view["id"]: view for view in quote["snapshot"].get("visuals", {}).get("views", [])}
    _cover(doc, quote, views)
    _gallery(doc, views, quote["snapshot"])
    _technical(doc, quote["snapshot"]["config"], views)
    _specifications(doc, quote["snapshot"])
    _price(doc, quote["snapshot"]["price"])
    _scope(doc, quote, views)
    return doc


def quote_pdf(quote):
    return build_proposal(quote).render()


def quote_html(quote):
    """Accessible printable companion, using the same frozen labels and images."""
    esc = lambda value: html.escape(str(value), quote=True)
    snapshot, contact = quote["snapshot"], quote["contact"]
    config, price = snapshot["config"], snapshot["price"]
    figures = "".join(f"<figure><img src='{esc(v['dataUrl'])}' alt='{esc(v['label'])}'><figcaption>{esc(v['label'])}</figcaption></figure>"
                      for v in snapshot.get("visuals", {}).get("views", []))
    groups = "".join("<h3>" + esc(title) + "</h3><table class='choices'><tbody>" +
                     "".join(f"<tr><th scope='row'>{esc(label)}</th><td>{esc(value)}</td></tr>" for label, value in rows) + "</tbody></table>"
                     for title, rows in choice_rows(snapshot))
    rows = "".join(f"<tr><th scope='row'>{esc(line['label'])}</th><td>{esc(number(line['quantity'], 4))} {esc(line['unit'])}</td>"
                   f"<td>{esc(money(line['unitPrice']))}</td><td>{esc(money(line['total']))}</td></tr>" for line in price["lines"])
    warnings = "".join(f"<li>{esc(value)}</li>" for value in price["warnings"])
    scope_rows = "".join(f"<tr><th scope='row'>{esc(item['label'])}</th><td>{esc(item['summary'])}</td></tr>" for item in snapshot.get("scope", []))
    scope_section = f"<section><h2>Leveringsomvang</h2><p>Contouren zijn voorbeeldapparaten, niet inbegrepen. Product, voorbereiding, montage en aansluiting staan apart vermeld.</p><table>{scope_rows}</table></section>" if scope_rows else ""
    brand = quote.get("brand")
    mark = (f"<img class='logo' src='{esc(brand['dataUrl'])}' alt='{esc(brand['alt'])}'>" if brand
            else f"<strong>{esc(quote.get('brandName') or 'CS prefab')}</strong>")
    content = (f"<header>{mark}<span>{esc(quote['reference'])} · {esc(date_label(snapshot['createdAt']))}</span></header>"
               "<p class='eyebrow'>PERSOONLIJK ONTWERPVOORSTEL</p><h1>Jouw aanbouw,<br>tot in detail.</h1>"
               f"<p>Samengesteld voor <strong>{esc(contact['name'])}</strong></p><p class='status'>{esc(price_status(price))}</p>"
               f"<div class='metrics'><span>Breedte <b>{config['width']} cm</b></span><span>Diepte <b>{config['depth']} cm</b></span>"
               f"<span>Oppervlakte <b>{number(config['width'] * config['depth'] / 10000)} m²</b></span></div>"
               f"<section><h2>Je ontwerp in beeld</h2><div class='gallery'>{figures}</div></section>"
               f"<section><h2>Materialen & voorzieningen</h2>{groups}</section><section><h2>Indicatieve kostenopbouw</h2>"
               f"<table><thead><tr><th>Onderdeel</th><th>Aantal</th><th>Prijs / eenh.</th><th>Excl. btw</th></tr></thead><tbody>{rows}</tbody></table>"
               f"<div class='totals'><p>Subtotaal excl. btw <b>{money(price['subtotal'])}</b></p><p>Btw {price['vatRate']}% <b>{money(price['vat'])}</b></p>"
               f"<p class='grand'>Totaal inclusief btw <b>{money(price['total'])}</b></p></div><p>Prijsboek: {esc(price['pricebookVersion'])}</p></section>"
               f"{scope_section}<section><h2>Uitgangspunten & vervolg</h2><p>{esc(price['disclaimer'])}</p>"
               + ("<p>Dit voorstel is een prijsindicatie, geen bindende offerte. De definitieve offerte volgt na opname en technische beoordeling.</p>" if commercial_price(price) else "") + f"<ul>{warnings}</ul>"
               "<p>Impressies en tekeningen zijn schematisch. Een adviseur moet de technische haalbaarheid, scope en definitieve prijs nog beoordelen.</p>"
               f"<h3>Jouw toelichting</h3><p class='pre'>{esc(contact.get('message', ''))}</p><h3>Project- en contactgegevens</h3>"
               f"<p>{esc(contact['name'])}<br>{esc(contact['address'])} {esc(contact['houseNumber'])}<br>{esc(contact['postcode'])} {esc(contact['city'])}<br>"
               f"{esc(contact['email'])}<br>{esc(contact['phone'])}</p></section><footer>Toestemming voor contact vastgelegd bij aanvraag (quote-contact-v1).</footer>")
    css = """@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:14px/1.55 system-ui,sans-serif;color:#263d34;max-width:920px;margin:40px auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dfe3d8;padding-bottom:18px}header strong{font-size:25px}header .logo{max-height:46px;max-width:230px;width:auto;height:auto}header span,footer{font-size:11px;color:#626d59}.eyebrow{letter-spacing:2px;font-size:11px;color:#9c633e;margin-top:40px}h1{font-size:48px;line-height:1.12}h2{font-size:25px;margin-top:36px}h3{font-size:15px;margin-bottom:8px}h2,h3{break-after:avoid}.status{font-size:11px;color:#9c633e;font-weight:700}.metrics{display:flex;gap:12px;margin:25px 0}.metrics span{flex:1;background:#f6f5f1;padding:15px}.metrics b{display:block;font-size:24px}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:20px}.gallery figure{margin:0;break-inside:avoid}.gallery figure:first-child{grid-column:1/-1}.gallery img{width:100%;display:block;background:#f6f5f1;border:1px solid #dfe3d8}figcaption{font-size:12px;padding-top:7px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:9px 10px;border-bottom:1px solid #dfe3d8}tbody th{font-weight:400}thead{background:#263d34;color:white;display:table-header-group}tbody tr:nth-child(odd){background:#f6f5f1}tr{break-inside:avoid}.choices th{width:40%;color:#626d59}.totals{margin:20px 0 20px auto;max-width:400px;break-inside:avoid}.totals p{display:flex;justify-content:space-between;padding:5px 10px}.grand{background:#263d34;color:white;padding:16px!important}.pre{white-space:pre-wrap;overflow-wrap:anywhere}p,td,th{overflow-wrap:anywhere}footer{margin-top:40px;border-top:1px solid #dfe3d8;padding-top:15px}@media print{body{margin:0;padding:0;font-size:11px}section{break-before:page}h1{font-size:40px}h2{margin-top:0}.gallery img{max-height:100mm;object-fit:contain}.gallery figure:first-child img{max-height:115mm}}"""
    # The css above is written in the pre-2.9.7 colours, which are exactly PROPOSAL_COLORS; each is swapped for
    # the slot this proposal resolved (services.appearance.proposal_palette), so the HTML and the PDF agree.
    colors = (quote.get("palette") or {}).get("colors") or {}
    for slot, default in PROPOSAL_COLORS.items():
        css = css.replace(default, colors.get(slot, default))
    return ("<!doctype html><html lang='nl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            f"<title>{esc(quote['reference'])} — {esc(quote.get('brandName') or 'CS prefab')} ontwerpvoorstel</title><style>{css}</style></head><body>{content}</body></html>").encode("utf-8")

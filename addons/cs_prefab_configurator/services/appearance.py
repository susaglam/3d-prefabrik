"""UI-only appearance values; never part of a priced or frozen release."""
import base64
import re

from .pdf_image import MAX_BYTES as LOGO_MAX_BYTES, MAX_PIXELS as LOGO_MAX_PIXELS, MAX_SIDE as LOGO_MAX_SIDE, ImageError, pdf_image
from .scene_content import scene_content_payload

# The key the proposal header uses for its single brand image object.
LOGO_KEY = "brand-logo"
# Points available to a mark in the proposal header, next to the page margin.
LOGO_BOX = (150, 32)
LOGO_SOURCES = ("wordmark", "odoo", "upload")

COLORS = {
    "action": "#294e40", "on_action": "#ffffff", "text": "#2f3935",
    "heading": "#20302c", "muted": "#657069", "surface": "#ffffff",
    "background": "#f1f1ec", "border": "#dce0d9", "error": "#a43b2d",
}
# The named parts of a proposal image, beside the omgeving switch. Each is one boolean on the vormgeving record,
# one field name here, and one group in static/src/preview.js (DOCUMENT_PARTS), which is where what each one
# covers is written down. `document_surroundings` used to be the only switch and it was too coarse in both
# directions: it could not keep the concrete slab the aanbouw stands on while dropping the terras that reaches
# into the garden, and it did not cover the woning behind the doorbraak at all.
#
# All three default on, and they MUST equal static/src/scene_content.js DOCUMENT_PARTS (tests/test_appearance.py
# reads that file and compares). The slab and the terras are what the aanbouw is delivered onto. `house_room` is
# only the 0,55 m recess behind the doorbraak — the eight-metre living room left with the rest of the woning — and
# it was measured both ways before it was decided: off, you look through the opening at the studio's horizon
# line, and 45 % of the roofless image becomes blank paper seen through the product.
DOCUMENT_PARTS = {"slab": True, "terrace": True, "house_room": True}
# The key each part reaches the browser under (theme.js featuresOf → preview.js documentPartsOf).
BROWSER_PARTS = {"slab": "slab", "terrace": "terrace", "house_room": "houseRoom"}
DOCUMENT_PART_FIELDS = ["document_" + key for key in DOCUMENT_PARTS]
# The 3D view's default render tier (preview.js setQuality): 'auto' measures the device, the other two force one.
# The visitor may still override it on their own device (Weergave → Kwaliteit).
RENDER_QUALITIES = ("auto", "full", "compact")
# The garden boundary styles (static/src/environment.js FENCE_STYLES, drawn by garden_fence.js), default first.
FENCE_STYLES = ("modern", "hedge", "classic")
FONTS = {
    "dm_sans": "'DM Sans', Arial, sans-serif",
    "dm_serif": "'DM Serif Display', Georgia, serif",
    "system": "system-ui, -apple-system, 'Segoe UI', sans-serif",
    "arial": "Arial, Helvetica, sans-serif",
    "georgia": "Georgia, 'Times New Roman', serif",
}


def color(value):
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError("Gebruik een volledige hexkleur, bijvoorbeeld #294e40.")
    return value.lower()


def contrast(left, right):
    def luminance(value):
        channels = [int(color(value)[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        return sum(weight * (v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4)
                   for weight, v in zip((.2126, .7152, .0722), channels))
    a, b = sorted((luminance(left), luminance(right)))
    return (b + .05) / (a + .05)


# The five colours a proposal is printed in when nothing else is set — the constants pdf_layout.py and the
# printable HTML carried before 2.9.7, with ONE correction. The copper accent was #b7754a, and measured against the
# readability rule this module now applies to every slot it printed at 3.7:1 on white and 3.4:1 on the panel: the
# 7-8 pt eyebrows and section numbers of every proposal were below WCAG AA (4.5:1). #9c633e is the same hue with the
# lightness lowered to the first step that passes on both grounds (4.9:1 and 4.5:1). The others already passed.
PROPOSAL_COLORS = {"ink": "#263d34", "muted": "#626d59", "paper": "#f6f5f1", "line": "#dfe3d8", "accent": "#9c633e"}
# Where each slot comes from on the vormgeving record: the same colour does the same job on paper as in the form.
PROPOSAL_FROM_FORM = {"ink": "heading", "muted": "muted", "paper": "background", "line": "border", "accent": "action"}
# Each text slot is measured against the grounds it is really PRINTED on, and only those (WCAG AA, 4.5:1 for
# small text). Ink and muted text sit on white and inside the soft panels (the metrics on the cover, the labels in
# the price table); the accent — eyebrows, section numbers, image numbers, the price status — is only ever printed
# on the white page. Measuring the accent against the panel too refused production's own brand orange #c43f12
# (5.2:1 on white, 4.4:1 on its peach panel it never touches) and printed a copper nobody chose instead.
PROPOSAL_TEXT_GROUNDS = {"ink": ("#ffffff", "paper"), "muted": ("#ffffff", "paper"), "accent": ("#ffffff",)}
PROPOSAL_TEXT_SLOTS = tuple(PROPOSAL_TEXT_GROUNDS)


def _hex(value):
    """A full lowercase #rrggbb, or None. Odoo stores company colours as free text, so nothing is assumed."""
    value = value.strip() if isinstance(value, str) else ""
    return value.lower() if re.fullmatch(r"#[0-9a-fA-F]{6}", value) else None


def proposal_palette(values=None, *, company_primary=None, company_secondary=None):
    """The colours a proposal is printed in: the administrator's, or Odoo's own, never an unreadable one.

    The customer's rule: the PDF takes its colours "from our Odoo theme settings or from the colours we set in our
    admin". Which one depends on the vormgeving's own `mode`, the same switch that decides the form's colours:

    * ``custom`` — the administrator's own colours, slot for slot (heading → ink, action → accent, …).
    * ``odoo``   — Odoo's document colours (Instellingen → Bedrijven → Documentlay-out: primary and secondary
      colour), which Odoo itself prints on its quotations and invoices. Primary becomes the accent, secondary the
      ink. The website theme's own palette is only readable in a browser (theme.js reads computed styles through
      an iframe) and a PDF is built on the server, so the document layout is the one Odoo colour a server can read.
      Slots Odoo does not have fall through to the vormgeving's stored colours.
    * ``brand``  — the vormgeving's stored colours as well: they are the Prefab Partner palette unless someone
      edited them, and "the colours we set in our admin" is exactly that record.

    Every text slot is then checked against white paper and against the panel colour at 4.5:1; one that fails
    falls back to PROPOSAL_COLORS for THAT slot only, and the reason is reported. A pale brand colour thus never
    produces a proposal nobody can read, and it never silently takes the other four colours down with it.
    Returns ``{"colors": {slot: hex}, "source": {slot: where}, "notes": [str]}``.
    """
    values = values or {}
    mode = values.get("mode", "brand")
    colors, source, notes = {}, {}, []
    odoo = {"accent": _hex(company_primary), "ink": _hex(company_secondary)} if mode == "odoo" else {}
    for slot, fallback in PROPOSAL_COLORS.items():
        candidates = [(odoo.get(slot), "odoo"), (_hex(values.get("color_" + PROPOSAL_FROM_FORM[slot])), "vormgeving")]
        colors[slot], source[slot] = next(((value, origin) for value, origin in candidates if value), (fallback, "voorstel"))
    # Paper and rule first: every text slot is measured against the paper it will actually be printed next to.
    # Paper is the soft panel behind the metrics and the image frames; it has to stay close to white.
    if contrast("#ffffff", colors["paper"]) > 1.35:
        notes.append(f"Paneelkleur {colors['paper']} is te donker voor tekst erop; de standaardkleur wordt gebruikt.")
        colors["paper"], source["paper"] = PROPOSAL_COLORS["paper"], "voorstel"
    if contrast("#ffffff", colors["line"]) > 1.9:
        notes.append(f"Lijnkleur {colors['line']} is te donker voor een scheidingslijn; de standaardkleur wordt gebruikt.")
        colors["line"], source["line"] = PROPOSAL_COLORS["line"], "voorstel"
    def worst(color, slot):
        grounds = [colors[ground] if ground in colors else ground for ground in PROPOSAL_TEXT_GROUNDS[slot]]
        return min(contrast(color, ground) for ground in grounds)

    for slot in PROPOSAL_TEXT_SLOTS:
        chosen, fallback = worst(colors[slot], slot), worst(PROPOSAL_COLORS[slot], slot)
        if chosen >= 4.5:
            continue
        # The fallback only replaces a colour it is actually MORE readable than: swapping a brand colour for a
        # default that is no better would lose the brand and gain nothing.
        if fallback > chosen:
            notes.append(f"{slot}: {colors[slot]} is op het papier niet leesbaar ({chosen:.1f}:1, minimaal 4,5:1); "
                         f"de standaardkleur {PROPOSAL_COLORS[slot]} wordt gebruikt.")
            colors[slot], source[slot] = PROPOSAL_COLORS[slot], "voorstel"
        else:
            notes.append(f"{slot}: {colors[slot]} haalt {chosen:.1f}:1 (minimaal 4,5:1), maar de standaardkleur is niet "
                         f"beter; de gekozen kleur blijft staan.")
    return {"colors": colors, "source": source, "notes": notes}


def proposal_logo(data, *, filename="", alt="", strict=True):
    """The brand mark a proposal header must print, or None to keep the built-in wordmark.

    Both proposal renderers read this one result: the hand-composed PDF embeds
    ``data`` as an image object, the QWeb report and the printable HTML use ``dataUrl``.

    The image is fully prepared here, not merely inspected: a header check would accept
    a truncated file that only fails while a customer is downloading the proposal. The
    prepared object is cached, so validating on save also warms the render path.

    ``strict=False`` is for an image outside this addon's control — the Odoo company
    logo, which an administrator can replace at any moment with anything Odoo accepts,
    including an SVG. There the rule is that a proposal must never fail: an image that
    cannot be embedded falls back to the wordmark, exactly like a missing one.
    """
    if not data:
        return None
    data = bytes(data)
    try:
        prepared = pdf_image(data, filename=filename or "")
    except ImageError:
        if strict:
            raise
        return None
    info = {key: value for key, value in prepared.items() if key != "stream"}
    return {**info, "id": LOGO_KEY, "kind": "brand", "data": data, "filename": filename or "",
            "alt": alt or "Logo", "dataUrl": f"data:{info['mime']};base64," + base64.b64encode(data).decode("ascii")}


def logo_summary(mark):
    """One line an administrator can read back: what will be printed, at what size."""
    if not mark:
        return ""
    return f"{mark['label']} · {mark['width']} × {mark['height']} px · {max(1, mark['bytes'] // 1024)} kB"


def exit_link(value):
    """The "Terug naar de website" address: a path on this website or an absolute http(s) address; '' switches it off.

    Anything else is refused rather than cleaned, because this string ends up as a navigation target in the visitor's
    browser: a javascript: or data: URL would run on the website's own origin, and a protocol-relative //host would
    silently leave for another site that the field does not name.
    """
    text = (value or "").strip() if isinstance(value, str) or value in (None, False) else None
    if text is None:
        raise ValueError("Terug naar de website: vul een pad zoals / of een adres met https:// in.")
    if not text:
        return ""
    if len(text) > 500 or any(ch.isspace() or ord(ch) < 32 for ch in text):
        raise ValueError("Terug naar de website: een adres mag geen spaties bevatten en hoogstens 500 tekens lang zijn.")
    if text.startswith("/") and not text.startswith("//"):
        return text
    lowered = text.lower()
    if lowered.startswith("https://") or lowered.startswith("http://"):
        if len(text.split("://", 1)[1].split("/", 1)[0]) == 0:
            raise ValueError("Terug naar de website: na https:// hoort een domeinnaam, zoals https://www.voorbeeld.nl/.")
        return text
    raise ValueError("Terug naar de website: gebruik een pad op deze website dat met / begint (zoals /aanbouw) of een "
                     "volledig adres dat met https:// begint.")


def appearance_payload(values=None):
    values = values or {}
    mode = values.get("mode", "brand")
    if mode not in ("brand", "custom", "odoo"):
        raise ValueError("Onbekende vormgeving.")
    palette = {key: color(values.get("color_" + key, default)) for key, default in COLORS.items()}
    body = values.get("body_font", "dm_sans")
    heading = values.get("heading_font", "dm_sans")
    size = values.get("font_size", 16)
    # Feature flag, default OFF. The default lives here because this function
    # also serves the standalone Python server, which has no Odoo record.
    compare_enabled = bool(values.get("compare_enabled", False))
    # Whether the six proposal images show the aanbouw in its garden or on its own. Default OFF means
    # "on its own", which is what the customer asked for: an Odoo that predates this field, a website
    # with no vormgeving record and the standalone server all print the product alone.
    document_surroundings = bool(values.get("document_surroundings", False))
    # Each part's own default when the key is absent — an Odoo that predates these fields, a website with no
    # vormgeving record and the standalone server all land on the picture the customer asked for.
    document_parts = {BROWSER_PARTS[key]: bool(values.get("document_" + key, default))
                      for key, default in DOCUMENT_PARTS.items()}
    render_quality = values.get("render_quality") or "auto"
    if render_quality not in RENDER_QUALITIES:
        raise ValueError("Kies een ondersteunde weergavekwaliteit: automatisch, hoge kwaliteit of snel.")
    # 2.11.0. Default ON: an Odoo that predates the field, a website without a vormgeving record and the
    # standalone server keep the garden they have always drawn.
    garden_fence = values.get("garden_fence", True) is not False
    exit_url = exit_link(values.get("exit_url", "/"))
    # 2.14.0. Default OFF: the visitor stays on the garden side of the house (static/src/preview.js
    # CAMERA_LIMIT). An administrator switches it on to allow the full tour around the building.
    camera_free_orbit = values.get("camera_free_orbit", False) is True
    # 2.14.1. Default OFF: seen from inside, the room is shown empty (static/src/preview.js applyScenery).
    interior_furniture = values.get("interior_furniture", False) is True
    fence_style = values.get("garden_fence_style") or "modern"
    if fence_style not in FENCE_STYLES:
        raise ValueError("Kies een ondersteunde tuinafscheiding: modern hout, groene haag of klassiek hout.")
    if body not in FONTS or heading not in FONTS:
        raise ValueError("Kies een ondersteund lettertype.")
    if isinstance(size, bool) or not isinstance(size, (int, float)) or not 14 <= size <= 20:
        raise ValueError("De basislettergrootte moet tussen 14 en 20 px liggen.")
    if mode == "custom":
        for key, label in (("text", "Tekst"), ("heading", "Titels"), ("muted", "Toelichtingen"), ("error", "Foutmeldingen")):
            if contrast(palette[key], palette["surface"]) < 4.5:
                raise ValueError(f"{label}: kies meer contrast met de formulierachtergrond (minimaal 4,5:1).")
        if contrast(palette["on_action"], palette["action"]) < 4.5:
            raise ValueError("Knoptekst: kies meer contrast met de actiekleur (minimaal 4,5:1).")
    # Scene content travels in this same payload, under its own key: one fetch, resolved before
    # the first frame. See services/scene_content.py for why it is not an endpoint of its own.
    return {"mode": mode, "colors": palette, "font": FONTS[body], "headingFont": FONTS[heading],
            "fontSize": size, "nativeUrl": "/prefab/theme" if mode == "odoo" else None,
            "compareEnabled": compare_enabled, "documentSurroundings": document_surroundings, "renderQuality": render_quality,
            "gardenFence": garden_fence, "gardenFenceStyle": fence_style, "exitUrl": exit_url,
            "cameraFreeOrbit": camera_free_orbit, "interiorFurniture": interior_furniture,
            "documentParts": document_parts, "sceneContent": scene_content_payload(values)}

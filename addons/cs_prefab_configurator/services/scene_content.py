"""Which illustrative extras the scene offers, per website.

Scene CONTENT, not appearance. Everything listed here is drawn so a visitor can picture the
result — example appliances, garden dressing, the neighbouring houses, a furnished room, the
example windows and door on the existing house's street elevation. None of it is delivered, none
of it carries a price, and none of it appears in a quote line. That is exactly why an
administrator must be able to take any of it out: on one website the example fridge helps, on the
next it raises a question ("is that included?") that costs a phone call.

It rides in the appearance payload rather than an endpoint of its own because the browser has to
know BEFORE the first frame: `applyAppearance()` is awaited before the form renders, and the
scene is built from that same tick. A second round trip would mean an extra popping into view and
then vanishing a moment later — the one failure mode a show/hide switch may not have. It keeps
its own module, its own payload key (``sceneContent``) and its own form section so the separation
from colours and fonts stays visible in the code as well as on the screen.

Three states, not a boolean, because a switch has to answer two questions at once: is the extra
AVAILABLE at all, and what does a visitor who has never chosen see? A pair of booleans per extra
would be ten fields for five extras and would allow the meaningless combination
"unavailable but on by default".
"""

# Order is the order an administrator reads them in, most-noticed first: a visitor sees the
# example appliances and the garden long before they orbit round to the street elevation.
MODES = ("on", "off", "hidden")
DEFAULT_MODE = "on"

# key    — the name the browser reads (static/src/scene_content.js uses exactly these ids)
# field  — the column on cs.prefab.appearance
# label  — how the extra is named to an administrator, for error messages
# control— the visitor control this mode governs, named as the visitor sees it; "" means the
#          extra has no visitor control of its own.
EXTRAS = (
    {"key": "fixtures", "field": "scene_fixtures", "label": "Voorbeeldapparaten",
     "control": "Voorbeeldapparaten tonen"},
    {"key": "garden", "field": "scene_garden", "label": "Tuinaankleding",
     "control": "Tuinaankleding tonen"},
    {"key": "neighbours", "field": "scene_neighbours", "label": "Buurhuizen",
     "control": "Buren tonen"},
    {"key": "interior", "field": "scene_interior", "label": "Inrichting",
     "control": "Inrichting"},
    {"key": "house_openings", "field": "scene_house_openings", "label": "Voorbeeldramen op de straatgevel",
     "control": "Voorbeeldramen op de straatgevel tonen"},
)
# The browser-side key for each extra. `house_openings` reaches the scene as `houseOpenings`,
# which is the marker stage 1 wrote onto the groups themselves (userData.illustrative).
BROWSER_KEYS = {"fixtures": "fixtures", "garden": "garden", "neighbours": "neighbours",
                "interior": "interior", "house_openings": "houseOpenings"}


def scene_content_payload(values=None):
    """The ``sceneContent`` fragment of the public appearance payload.

    A missing value is ``DEFAULT_MODE`` ("on"), so the standalone server — which has no Odoo
    record at all — and any website whose appearance predates this feature keep the scene the
    configurator has always drawn. Defaulting the other way would blank a live website's picture
    the moment this addon is upgraded.
    """
    values = values or {}
    payload = {}
    for extra in EXTRAS:
        mode = values.get(extra["field"], DEFAULT_MODE)
        if mode not in MODES:
            raise ValueError(f"{extra['label']}: kies Tonen, Standaard uit of Uitgeschakeld.")
        payload[BROWSER_KEYS[extra["key"]]] = mode
    return payload

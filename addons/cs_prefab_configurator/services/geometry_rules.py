"""Numeric mounting envelopes shared by catalog validation and server selection rules.

These describe the current indicative renderer, not certified product dimensions.
All coordinates are centimetres; no expressions or executable catalog rules exist.
"""
import copy
import math

from .errors import DomainError

CEILING = ["left", "center", "right"]
SPOTS = [f"r{row}c{col}" for row in range(1, 4) for col in range(1, 6)]
WALL = ["L1", "L2", "L3", "R1", "R2", "R3"]
MIN_OPENINGS = {"none": 150, "french": 210, "sliding-2": 230, "sliding-4": 370, "folding": 370}
# The whole front-opening rule, in cm, in one place. The span is the widest aperture a kozijn family may reach; the
# walls always keep a 45 cm pier on each side, so a narrow extension shrinks the aperture instead of the piers.
# "Geen kozijn" is a SKELETON opening, not a closed wall: the customer fits their own frame later, so the extension
# shows exactly the rough opening a 2-leaf schuifpui would get at this width (hence the shared 320) with only the
# outer frame built - no leaves, no glass, no hardware. Mirrored value for value in static/src/geometry.js.
OPENING_SPAN_CM = {"french": 220, "sliding-2": 320, "sliding-4": 440, "folding": 440, "none": 320}
PIER_MINIMUM_CM = 90


def default_geometry_rules():
    roofs = {}
    for kind, counts in (("lean", range(1, 6)), ("gable", range(2, 11, 2))):
        for count in counts:
            roofs[f"{kind}-{count}"] = {"minWidthCm": int((count / 2 if kind == "gable" else count) * 72 + 97),
                "maxWidthCm": 750, "minDepthCm": 230 if kind == "gable" else 200, "maxDepthCm": 340}
    return {"version": 1, "profileId": "generic-aanbouw-v1", "verification": "indicative",
        "wallThicknessCm": 22, "clearanceCm": {"roof": 5, "wallEdge": 8, "fixture": 5},
        "openingProfiles": {key: {"minWidthCm": value, "maxWidthCm": 750, "minDepthCm": 100, "maxDepthCm": 340} for key, value in MIN_OPENINGS.items()},
        "rooflightProfiles": roofs}


def validate_geometry_rules(rules):
    baseline = default_geometry_rules()
    if not isinstance(rules, dict) or set(rules) != set(baseline) or any(rules[key] != baseline[key] for key in ("version", "profileId", "verification", "wallThicknessCm")):
        raise DomainError("Gebruik het ondersteunde indicatieve geometrieprofiel.")
    if not isinstance(rules["clearanceCm"], dict) or set(rules["clearanceCm"]) != set(baseline["clearanceCm"]):
        raise DomainError("Ongeldige vrije montageruimte.")
    for key, minimum in baseline["clearanceCm"].items():
        value = rules["clearanceCm"][key]
        if type(value) not in (int, float) or not math.isfinite(value) or not minimum <= value <= 40:
            raise DomainError("Vrije montageruimte mag de modelondergrens niet verlagen.")
    for section in ("openingProfiles", "rooflightProfiles"):
        profiles = rules[section]
        if not isinstance(profiles, dict) or set(profiles) != set(baseline[section]):
            raise DomainError("Onbekend of ontbrekend kozijn-/daklichtprofiel.")
        for key, profile in profiles.items():
            bounds = baseline[section][key]
            if not isinstance(profile, dict) or set(profile) != set(bounds) or any(type(value) is not int for value in profile.values()):
                raise DomainError("Profielgrenzen moeten gehele centimeters zijn.")
            for axis in ("Width", "Depth"):
                if not bounds[f"min{axis}Cm"] <= profile[f"min{axis}Cm"] <= profile[f"max{axis}Cm"] <= bounds[f"max{axis}Cm"]:
                    raise DomainError("Een profiel mag alleen het ondersteunde maatbereik begrenzen.")


def opening_kind(value):
    return next((kind for kind in ("sliding-4", "sliding-2", "french", "folding") if value.startswith(kind)), "none")


def opening_aperture_cm(kind, width_cm):
    """Clear width of the front opening in cm; mirrors geometry.js::openingApertureCm."""
    return min(width_cm - PIER_MINIMUM_CM, OPENING_SPAN_CM[kind])


def opening_spec(kind, width_cm, height_cm=280):
    """Aperture plus leaf count for one kozijn, in cm; mirrors geometry.js::openingSpec."""
    return {"kind": kind, "width": opening_aperture_cm(kind, width_cm), "height": min(230, height_cm - 35), "bottom": 7,
            "panelCount": 0 if kind == "none" else 2 if kind in ("french", "sliding-2") else 4, "skeleton": kind == "none"}


def validate_profile_selection(config, rules):
    for field, key, section in (("frontOpening", opening_kind(config["frontOpening"]), "openingProfiles"),
                               ("rooflight", config["rooflight"], "rooflightProfiles")):
        if field == "rooflight" and key == "none":
            continue
        profile = rules[section][key]
        if not profile["minWidthCm"] <= config["width"] <= profile["maxWidthCm"] or not profile["minDepthCm"] <= config["depth"] <= profile["maxDepthCm"]:
            label = "Dit kozijn" if field == "frontOpening" else "Dit daklicht"
            raise DomainError("De gekozen uitvoering past niet binnen het actieve maatprofiel.", fields={field:
                f"{label} vraagt {profile['minWidthCm']}–{profile['maxWidthCm']} cm breedte en {profile['minDepthCm']}–{profile['maxDepthCm']} cm diepte. Dit is een indicatieve modelgrens."})


def _legacy_mounting_state(config, rules, assets=None):
    """Return allowed slots and specific reasons; ceiling fittings take precedence."""
    width, depth, wall = config["width"], config["depth"], rules["wallThicknessCm"]
    back, front = -depth / 2, depth / 2
    gap, edge, roof_gap = (rules["clearanceCm"][key] for key in ("fixture", "wallEdge", "roof"))
    allowed = {key: value for key, value in {"ceilingPositions": list(CEILING), "spotPositions": list(SPOTS), "wallLights": list(WALL), "socketPositions": list(WALL), "heating": ["none", "left", "right", "both"]}.items() if key in config or key == "heating"}
    issues = []
    def exclude(field, position, code, message):
        if position in allowed[field]:
            allowed[field].remove(position)
            issues.append({"field": field, "position": position, "code": code, "message": message})
    roof = config["rooflight"]
    roof_bounds = None
    if roof != "none":
        kind, count = roof.split("-")
        rw = min(width - 85, (int(count) / 2 if kind == "gable" else int(count)) * 72 + 12)
        rd = min(depth - 85, 145 if kind == "gable" else 115)
        roof_bounds = (-rw / 2, rw / 2, -8 - rd / 2, -8 + rd / 2)
    def roof_overlap(x, z, radius):
        return roof_bounds and roof_bounds[0] - radius - roof_gap < x < roof_bounds[1] + radius + roof_gap and roof_bounds[2] - radius - roof_gap < z < roof_bounds[3] + radius + roof_gap
    ceiling_z = min(front - 38, max(back + 28, 35))
    ceiling_points = {key: (factor * (width - 2 * wall) * .30, ceiling_z) for key, factor in (("left", -1), ("center", 0), ("right", 1))}
    for position, (x, z) in ceiling_points.items():
        if roof_overlap(x, z, 15):
            exclude("ceilingPositions", position, "roof_opening", "De plafondlamp raakt de opening of vrije rand van het daklicht.")
        elif not -width / 2 + wall + 15 + edge <= x <= width / 2 - wall - 15 - edge or not back + 15 + edge <= z <= front - wall - 15 - edge:
            exclude("ceilingPositions", position, "ceiling_edge", "Er is onvoldoende vrije plafondruimte voor deze lamp.")
    selected_ceiling = [ceiling_points[key] for key in config["ceilingPositions"] if key in allowed["ceilingPositions"]]
    for position in SPOTS:
        row, col = int(position[1]), int(position[3])
        x = -width / 2 + wall + (width - 2 * wall) * col / 6
        z = back + (depth - wall) * row / 4
        if roof_overlap(x, z, 4.5):
            exclude("spotPositions", position, "roof_opening", "Deze spot raakt de opening of vrije rand van het daklicht.")
        elif any(math.hypot(x - cx, z - cz) < 15 + 4.5 + gap for cx, cz in selected_ceiling):
            exclude("spotPositions", position, "ceiling_fixture", "De spot staat te dicht bij de geselecteerde plafondlamp.")
        elif not back + 4.5 + edge <= z <= front - wall - 4.5 - edge:
            exclude("spotPositions", position, "ceiling_edge", "Er is onvoldoende vrije plafondruimte voor deze spot.")
    wall_z = {key: back + (depth - wall) * {"1": .22, "2": .50, "3": .78}[key[1]] for key in WALL}
    radiator_z = wall_z["L3"]
    radiator_half_width, radiator_half_height, radiator_center = RADIATOR_ENVELOPES_CM.get((assets or {}).get("heating") or "heating", RADIATOR_UNKNOWN_ENVELOPE_CM)
    for side in ("left", "right", "both"):
        side_asset = (assets or {}).get("heatingChoices", {}).get(side, (assets or {}).get("heating"))
        half_width = RADIATOR_ENVELOPES_CM.get(side_asset or "heating", RADIATOR_UNKNOWN_ENVELOPE_CM)[0]
        if not (back + edge <= radiator_z - half_width and radiator_z + half_width <= front - wall - edge):
            exclude("heating", side, "wall_space", "De radiatorpositie heeft onvoldoende wandlengte en vrije montageruimte.")
    heating_sides = set()
    if config["heating"] in allowed["heating"]:
        heating_sides = {"L", "R"} if config["heating"] == "both" else {"L"} if config["heating"] == "left" else {"R"} if config["heating"] == "right" else set()
    for field, half_width, center_y, half_height in [entry for entry in (("socketPositions", 4.2, 35, 4.2), ("wallLights", 3.75, 185, 8.5)) if entry[0] in allowed]:
        for position in WALL:
            z = wall_z[position]
            if not (back + edge <= z - half_width and z + half_width <= front - wall - edge):
                exclude(field, position, "wall_edge", "Deze positie heeft onvoldoende vrije wandruimte.")
            elif position[0] in heating_sides and abs(z - radiator_z) < radiator_half_width + half_width + gap and abs(center_y - radiator_center) < radiator_half_height + half_height + gap:
                exclude(field, position, "radiator_clearance", "Deze positie overlapt de radiator of zijn vrije montageruimte.")
    if not config["interior"]:
        for field in ("ceilingPositions", "spotPositions", "socketPositions", "wallLights"):
            if field in allowed:
                allowed[field] = []
        allowed["heating"] = ["none"]
    return {"allowedPositions": allowed, "positionIssues": issues}


# Heights of the outside fittings in cm, the same in all three placement tiers: the socket ABOVE the tap and the
# tap never moving. Before 2.10 the stacked tier put the tap at 100 and the others at 65, so a width change across
# the tier boundary made the tap jump 35 cm while the socket stayed under it. Must equal static/src/geometry.js
# EXTERIOR_HEIGHTS_CM (tests/test_geometry_profiles.py reads that file and compares).
EXTERIOR_HEIGHTS_CM = {"light": 190, "socket": 105, "tap": 65}
# Every radiator is ANCHORED at 108 cm on its wall slot (the layout point, unchanged since 2.8), and each asset's
# envelope is (half-width, half-height, centre height) in cm — the centre need not be the anchor. The default
# example radiator is 58 x 90 cm from 20 to 110 cm: a customer may fit a very low one, so an example may never block
# the 185 cm wall-light slot above it (customer report 2026-09-18). The 1,64 m column it replaces, envelope
# (29, 95, 108), did. Drawn to the same numbers in static/src/fixtures.js.
RADIATOR_ANCHOR_CM = 108
RADIATOR_ENVELOPES_CM = {"heating": (29, 45, 65), "heating-panel": (47, 32, 108)}
RADIATOR_UNKNOWN_ENVELOPE_CM = (47, 95, 108)


def fixture_layout(config, rules):
    """Fixed coordinates in cm: selections never move another selected fitting.

    Exterior light / socket / tap are placed per side in three tiers; the first tier that
    fits wins, so the front facade is always preferred over the side wall:
    1. Two-axis front: light and socket on the pier axis, tap ``separation`` further toward
       the corner (light 190 / socket 105 / tap 65). Needs both axes inside the pier strip
       and, when the drain is on that side, clear of the drain.
    2. Stacked front: all three on one vertical pier axis (tap 65 / socket 105 / light 190).
       If the drain sits inside the electrical clearance the axis moves toward the opening
       by exactly that clearance; it fits when the electrical width lies inside the strip.
    3. Side wall: one stable utility strip on the adjacent exterior wall; ``available``
       reports whether even that strip fits.
    """
    width, depth, height, wall = config["width"], config["depth"], config.get("height", 280), rules["wallThicknessCm"]
    left, right, back, front = -width / 2, width / 2, -depth / 2, depth / 2
    gap, edge, roof_gap = (rules["clearanceCm"][key] for key in ("fixture", "wallEdge", "roof"))
    radius = 15
    x_min, x_max = left + wall + radius + edge, right - wall - radius - edge
    z_min, z_max = back + radius + edge, front - wall - radius - edge
    ceiling_z = min(z_max, max(z_min, back + (depth - wall) * .68))
    roof_bounds = None
    if config["rooflight"] != "none":
        kind, count = config["rooflight"].split("-")
        rw = min(width - 85, (int(count) / 2 if kind == "gable" else int(count)) * 72 + 12)
        rd = min(depth - 85, 145 if kind == "gable" else 115)
        roof_bounds = [-rw / 2, rw / 2, -8 - rd / 2, -8 + rd / 2]
        # When the front strip fits, all three pendants share its clear axis.
        front_axis = roof_bounds[3] + radius + roof_gap
        if front_axis <= z_max:
            ceiling_z = max(ceiling_z, front_axis)
    # Pendants divide the clear room width in thirds (never closer to a wall than the edge clearance allows).
    clear_left, clear_width = left + wall, width - 2 * wall
    ceiling = {key: [min(x_max, max(x_min, clear_left + clear_width * fraction)), height - 9, ceiling_z]
               for key, fraction in (("left", 1 / 6), ("center", .5), ("right", 5 / 6))}
    spots = {key: [left + wall + (width - 2 * wall) * int(key[3]) / 6, height - 9,
                   back + (depth - wall) * int(key[1]) / 4] for key in SPOTS}
    wall_positions = {}
    for key in WALL:
        x = left + wall + 2.5 if key[0] == "L" else right - wall - 2.5
        z = back + (depth - wall) * {"1": .22, "2": .50, "3": .78}[key[1]]
        wall_positions[key] = {"socket": [x, 35, z], "light": [x, 185, z]}
    heating = {side: [*wall_positions["L3" if side == "left" else "R3"]["socket"]] for side in ("left", "right")}
    for point in heating.values():
        point[1] = RADIATOR_ANCHOR_CM
    kind = opening_kind(config.get("frontOpening", "none"))
    opening_width = opening_aperture_cm(kind, width)
    pier = (width - opening_width) / 2
    separation = max(35, 8.4 + 4.5 + gap + 5)
    exterior, H = {}, EXTERIOR_HEIGHTS_CM
    for side, sign in (("left", -1), ("right", 1)):
        electrical_axis = sign * (width / 2 - pier / 2)
        tap_axis = electrical_axis + sign * separation
        drain_axis = sign * (width / 2 - 12)
        lower, upper = (left + edge, -opening_width / 2 - edge) if side == "left" else (opening_width / 2 + edge, right - edge)
        # Tier 1: two axes on the front — light and socket on the pier axis, tap toward the corner.
        front_fits = lower <= electrical_axis - 8.4 and electrical_axis + 8.4 <= upper and lower <= tap_axis - 4.5 and tap_axis + 4.5 <= upper
        if config.get("drainSide", "right") in (side, "both"):
            front_fits = front_fits and abs(electrical_axis - drain_axis) >= 8.4 + 5 + gap and abs(tap_axis - drain_axis) >= 4.5 + 5 + gap
        # Tier 2: one stacked axis on the front, nudged toward the opening when the drain is too close.
        # The stack only needs to clear the 7.5 cm downpipe itself, so even the narrowest pier keeps it on the front.
        stack_clearance = 8.4 + 3.75 + 3
        axis = sign * (width / 2 - pier / 2)
        if config.get("drainSide", "right") in (side, "both") and abs(axis - drain_axis) < stack_clearance:
            axis = drain_axis - sign * stack_clearance
        stacked_fits = lower <= axis - 8.4 and axis + 8.4 <= upper
        if front_fits:
            exterior[side] = {"surface": "front", "rotation": 0, "available": True,
                "light": [electrical_axis, H["light"], front + 2.5], "socket": [electrical_axis, H["socket"], front + 2.5], "tap": [tap_axis, H["tap"], front + 2.5]}
        elif stacked_fits:
            exterior[side] = {"surface": "front", "rotation": 0, "available": True,
                "light": [axis, H["light"], front + 2.5], "socket": [axis, H["socket"], front + 2.5], "tap": [axis, H["tap"], front + 2.5]}
        else:
            # Tier 3: reserve one stable utility strip on the adjacent exterior wall.
            tap_z = front - max(35, edge + 4.5)
            electrical_z = tap_z - separation
            available = back + edge <= electrical_z - 8.4 and tap_z + 4.5 <= front - edge
            exterior[side] = {"surface": side, "rotation": sign * math.pi / 2, "available": available,
                "light": [sign * (width / 2 + 2.5), H["light"], electrical_z], "socket": [sign * (width / 2 + 2.5), H["socket"], electrical_z],
                "tap": [sign * (width / 2 + 2.5), H["tap"], tap_z]}
    basis = {"width": width, "depth": depth, "height": height, "frontOpening": config.get("frontOpening", "none"), "rooflight": config["rooflight"], "drainSide": config.get("drainSide", "right")}
    return {"version": 2, "units": "cm", "basis": basis, "ceilingPositions": ceiling, "spotPositions": spots,
            "wallPositions": wall_positions, "heating": heating, "exterior": exterior, "roofBounds": roof_bounds}


def mounting_state(config, rules, assets=None, *, asset_revision=None):
    if asset_revision in {"2026-09-13.1", "2026-09-13.2", "2026-09-13.3"}:
        return _legacy_mounting_state(config, rules, assets)
    layout = fixture_layout(config, rules)
    width, depth, height, wall = config["width"], config["depth"], config.get("height", 280), rules["wallThicknessCm"]
    left, right, back, front = -width / 2, width / 2, -depth / 2, depth / 2
    gap, edge, roof_gap = (rules["clearanceCm"][key] for key in ("fixture", "wallEdge", "roof"))
    allowed = {key: value for key, value in {"ceilingPositions": list(CEILING), "spotPositions": list(SPOTS), "wallLights": list(WALL), "socketPositions": list(WALL), "heating": ["none", "left", "right", "both"]}.items() if key in config or key == "heating"}
    issues = []
    def exclude(field, position, code, message):
        if position in allowed[field]:
            allowed[field].remove(position)
            issues.append({"field": field, "position": position, "code": code, "message": message})
    def radiator_envelope(asset):
        return RADIATOR_ENVELOPES_CM.get(asset or "heating", RADIATOR_UNKNOWN_ENVELOPE_CM)
    radiator_z = layout["heating"]["left"][2]
    for side in ("left", "right", "both"):
        asset = (assets or {}).get("heatingChoices", {}).get(side, (assets or {}).get("heating"))
        half_width = radiator_envelope(asset)[0]
        if not (back + edge <= radiator_z - half_width and radiator_z + half_width <= front - wall - edge):
            exclude("heating", side, "wall_space", "De radiatorpositie heeft onvoldoende wandlengte en vrije montageruimte.")
    heating_sides = {"L", "R"} if config["heating"] == "both" else {"L"} if config["heating"] == "left" else {"R"} if config["heating"] == "right" else set()
    if config["heating"] not in allowed["heating"]:
        heating_sides = set()
    radiator_half_width, radiator_half_height, radiator_center = radiator_envelope((assets or {}).get("heating"))
    for field, point_key, half_width, half_height in [entry for entry in (("socketPositions", "socket", 4.2, 4.2), ("wallLights", "light", 3.75, 8.5)) if entry[0] in allowed]:
        for position in WALL:
            _, y, z = layout["wallPositions"][position][point_key]
            if not (back + edge <= z - half_width and z + half_width <= front - wall - edge and edge <= y - half_height and y + half_height <= height - edge):
                exclude(field, position, "wall_edge", "Deze positie heeft onvoldoende vrije wandruimte.")
            elif position[0] in heating_sides and abs(z - radiator_z) < radiator_half_width + half_width + gap and abs(y - radiator_center) < radiator_half_height + half_height + gap:
                exclude(field, position, "radiator_clearance", "Deze elektrische positie overlapt de radiator of zijn vrije montageruimte.")
    def roof_overlap(x, z, radius):
        bounds = layout["roofBounds"]
        return bounds and bounds[0] - radius - roof_gap < x < bounds[1] + radius + roof_gap and bounds[2] - radius - roof_gap < z < bounds[3] + radius + roof_gap
    def roof_space(field, position, radius):
        x, _, z = layout[field][position]
        if not left + wall + radius + edge <= x <= right - wall - radius - edge or not back + radius + edge <= z <= front - wall - radius - edge:
            exclude(field, position, "ceiling_edge", "Er is onvoldoende vrije plafondruimte voor deze lamp.")
        elif roof_overlap(x, z, radius):
            exclude(field, position, "roof_opening", "Deze lamp raakt de opening of vrije rand van het daklicht.")
        elif field == "ceilingPositions" and height - 65 < 108 + radiator_half_height + gap:
            for side in heating_sides:
                radiator_x = layout["heating"]["left" if side == "L" else "right"][0]
                if abs(x - radiator_x) < radius + 16 + gap and abs(z - radiator_z) < radiator_half_width + radius + gap:
                    exclude(field, position, "radiator_clearance", "De hanglamp staat te dicht bij de radiator.")
    for position in CEILING:
        roof_space("ceilingPositions", position, 15)
    # Outer pendants have priority over a crowded additional middle pendant.
    selected = []
    for position in ("left", "right", "center"):
        point = layout["ceilingPositions"][position]
        if position in config["ceilingPositions"] and position in allowed["ceilingPositions"]:
            if any(math.hypot(point[0] - other[0], point[2] - other[2]) < 30 + gap for other in selected):
                exclude("ceilingPositions", position, "ceiling_fixture", "Deze hanglamp staat te dicht bij een andere hanglamp.")
            else:
                selected.append(point)
    for position in CEILING:
        point = layout["ceilingPositions"][position]
        if position not in config["ceilingPositions"] and any(math.hypot(point[0] - other[0], point[2] - other[2]) < 30 + gap for other in selected):
            exclude("ceilingPositions", position, "ceiling_fixture", "Deze hanglamp staat te dicht bij een geselecteerde hanglamp.")
    accepted_spots = []
    for position in SPOTS:
        roof_space("spotPositions", position, 4.5)
        point = layout["spotPositions"][position]
        if any(math.hypot(point[0] - other[0], point[2] - other[2]) < 19.5 + gap for other in selected):
            exclude("spotPositions", position, "ceiling_fixture", "De spot staat te dicht bij de geselecteerde plafondlamp.")
        if position in config["spotPositions"] and position in allowed["spotPositions"]:
            if any(math.hypot(point[0] - other[0], point[2] - other[2]) < 9 + gap for other in accepted_spots):
                exclude("spotPositions", position, "spot_clearance", "Deze spot staat te dicht bij een andere spot.")
            else:
                accepted_spots.append(point)
    for position in SPOTS:
        point = layout["spotPositions"][position]
        if position not in config["spotPositions"] and any(math.hypot(point[0] - other[0], point[2] - other[2]) < 9 + gap for other in accepted_spots):
            exclude("spotPositions", position, "spot_clearance", "Deze spot staat te dicht bij een geselecteerde spot.")
    for field in ("outsideLight", "outsideSocket", "outsideTap"):
        allowed[field] = ["none", "left", "right", "both"] + (["double-left", "double-right", "double-both"] if field == "outsideSocket" else [])
        for value in list(allowed[field]):
            side = value.removeprefix("double-")
            sides = ("left", "right") if side == "both" else (side,) if side != "none" else ()
            if any(not layout["exterior"][key]["available"] for key in sides):
                exclude(field, value, "exterior_space", "Er is onvoldoende vrije gevelruimte voor deze buitenvoorziening.")
    if not config["interior"]:
        for field in ("ceilingPositions", "spotPositions", "socketPositions", "wallLights"):
            if field in allowed:
                allowed[field] = []
        allowed["heating"] = ["none"]
    return {"allowedPositions": allowed, "positionIssues": issues, "fixtureLayout": layout}


def apply_mounting_rules(config, rules, assets=None, *, asset_revision=None):
    state = mounting_state(config, rules, assets, asset_revision=asset_revision)
    if config["heating"] not in state["allowedPositions"]["heating"]:
        config["heating"] = "none"
    for field in ("ceilingPositions", "spotPositions", "socketPositions", "wallLights"):
        if field in config and field in state["allowedPositions"]:
            config[field] = [position for position in config[field] if position in state["allowedPositions"][field]]
    for field in ("outsideLight", "outsideSocket", "outsideTap"):
        if field in state["allowedPositions"] and config[field] not in state["allowedPositions"][field]:
            config[field] = "none"
    return state


def placement_result(config, supplied, rules, assets=None, *, asset_revision=None):
    state = mounting_state(config, rules, assets, asset_revision=asset_revision)
    for issue in state["positionIssues"]:
        value = supplied.get(issue["field"], [])
        issue["selected"] = issue["position"] == value if isinstance(value, str) else issue["position"] in value if isinstance(value, list) else False
    state["clearedSelections"] = [copy.deepcopy(issue) for issue in state["positionIssues"] if issue["selected"]]
    return state

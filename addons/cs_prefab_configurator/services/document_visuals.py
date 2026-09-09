"""Bounded, inert browser captures for immutable quote documents.

These pictures describe a configuration; they never affect its price. Only JPEG
pixel streams are retained, with browser-independent labels and no EXIF metadata.
"""
import base64
import binascii

from .errors import DomainError

VIEW_LABELS = {
    "perspective-left": "Perspectief linksvoor",
    "perspective-right": "Perspectief rechtsvoor",
    "interior": "Interieur / open dak",
    "plan": "Plattegrond",
    "front": "Voorgevel",
    "side": "Zijgevel",
}
MAX_IMAGE_BYTES = 768 * 1024
MAX_VISUAL_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 2_500_000
JPEG_PREFIX = "data:image/jpeg;base64,"


def invalid_visuals(message="De documentbeelden zijn ongeldig. Vernieuw de voorvertoning en probeer opnieuw."):
    return DomainError(message, fields={"visuals": message})


def _jpeg_pixels(data):
    """Validate marker framing and SOF dimensions; drop metadata before storage.

    Parsing framing avoids a native image decoder on public input. Browser canvas
    exports are 8-bit RGB baseline/progressive JPEGs, the formats accepted here.
    The retained stream is embedded as a PDF image and is never executed.
    """
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise invalid_visuals()
    offset, dimensions, scans = 2, None, 0
    kept = [b"\xff\xd8"]
    while offset < len(data):
        start = offset
        if data[offset] != 0xFF:
            raise invalid_visuals()
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            raise invalid_visuals()
        marker = data[offset]
        offset += 1
        if marker == 0xD9:
            if offset != len(data) or dimensions is None or not scans:
                raise invalid_visuals()
            kept.append(b"\xff\xd9")
            return dimensions, b"".join(kept)
        if marker in (0x00, 0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            raise invalid_visuals()
        if offset + 2 > len(data):
            raise invalid_visuals()
        length = int.from_bytes(data[offset:offset + 2], "big")
        end = offset + length
        if length < 2 or end > len(data):
            raise invalid_visuals()
        segment = data[offset + 2:end]
        if marker in (0xC0, 0xC2):
            if dimensions is not None or len(segment) != 15 or segment[0] != 8 or segment[5] != 3:
                raise invalid_visuals()
            height = int.from_bytes(segment[1:3], "big")
            width = int.from_bytes(segment[3:5], "big")
            dimensions = (width, height)
        elif 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            raise invalid_visuals()  # unsupported SOF encoding
        if not (0xE0 <= marker <= 0xEF or marker == 0xFE):
            kept.append(data[start:end])
        offset = end
        if marker == 0xDA:
            if dimensions is None or len(segment) < 6 or segment[0] not in (1, 2, 3) or len(segment) != 4 + 2 * segment[0]:
                raise invalid_visuals()
            scans += 1
            entropy_start = offset
            while offset < len(data):
                next_marker = data.find(b"\xff", offset)
                if next_marker < 0 or next_marker + 1 >= len(data):
                    raise invalid_visuals()
                following = next_marker + 1
                while following < len(data) and data[following] == 0xFF:
                    following += 1
                if following >= len(data):
                    raise invalid_visuals()
                if data[following] == 0x00 or 0xD0 <= data[following] <= 0xD7:
                    offset = following + 1
                    continue
                kept.append(data[entropy_start:next_marker])
                offset = next_marker
                break
    raise invalid_visuals()


def canonical_document_visuals(value, config_key):
    if not isinstance(value, dict) or set(value) - {"version", "configKey", "views", "missingViews"}:
        raise invalid_visuals()
    if type(value.get("version")) is not int or value["version"] != 1:
        raise invalid_visuals("Deze versie van de documentbeelden wordt niet ondersteund. Vernieuw de pagina.")
    if value.get("configKey") != config_key:
        raise invalid_visuals("De documentbeelden horen bij een andere configuratie. Maak de beelden opnieuw.")
    views = value.get("views")
    if not isinstance(views, list) or len(views) > len(VIEW_LABELS):
        raise invalid_visuals()
    missing = value.get("missingViews", [])
    if not isinstance(missing, list) or len(missing) > len(VIEW_LABELS) or any(not isinstance(item, str) or item not in VIEW_LABELS for item in missing):
        raise invalid_visuals()
    sanitized, seen, byte_count = [], set(), 0
    for view in views:
        if not isinstance(view, dict) or set(view) - {"id", "label", "width", "height", "dataUrl"}:
            raise invalid_visuals()
        view_id = view.get("id")
        if not isinstance(view_id, str) or view_id not in VIEW_LABELS or view_id in seen:
            raise invalid_visuals()
        width, height = view.get("width"), view.get("height")
        if any(type(size) is not int or not 256 <= size <= 2000 for size in (width, height)) or width * height > MAX_IMAGE_PIXELS:
            raise invalid_visuals("De documentbeelden hebben ongeldige afmetingen.")
        data_url = view.get("dataUrl")
        if not isinstance(data_url, str) or not data_url.startswith(JPEG_PREFIX):
            raise invalid_visuals()
        encoded = data_url[len(JPEG_PREFIX):]
        if not encoded or len(encoded) > 4 * ((MAX_IMAGE_BYTES + 2) // 3):
            raise invalid_visuals("Een documentbeeld is te groot.")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise invalid_visuals() from None
        byte_count += len(data)
        if len(data) > MAX_IMAGE_BYTES or byte_count > MAX_VISUAL_BYTES:
            raise invalid_visuals("De documentbeelden zijn samen te groot.")
        actual_dimensions, pixels = _jpeg_pixels(data)
        if actual_dimensions != (width, height):
            raise invalid_visuals("De afmetingen van een documentbeeld komen niet overeen.")
        seen.add(view_id)
        sanitized.append({"id": view_id, "label": VIEW_LABELS[view_id], "width": width, "height": height,
                          "dataUrl": JPEG_PREFIX + base64.b64encode(pixels).decode("ascii")})
    order = {view_id: index for index, view_id in enumerate(VIEW_LABELS)}
    sanitized.sort(key=lambda view: order[view["id"]])
    return {"version": 1, "configKey": config_key, "views": sanitized,
            "missingViews": [view_id for view_id in VIEW_LABELS if view_id not in seen]}

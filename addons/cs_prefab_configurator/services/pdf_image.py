"""Brand images turned into PDF image objects, without any imaging dependency.

Only an administrator-supplied mark passes through here: an uploaded logo or the
Odoo company logo. Customer 3D captures keep their own validated JPEG path.

A PNG is decoded with the standard library alone (zlib plus the five PNG filters)
and composited onto white, because a proposal header is white paper and PDF image
objects carry no transparency of their own. A JPEG is handed to the PDF viewer
unchanged: PDF speaks DCTDecode natively, so re-encoding would only lose quality.
"""
from functools import lru_cache
from itertools import accumulate
import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 512 * 1024
# A PNG is unpacked in pure Python, so the pixel budget is a response-time budget:
# measured on this project's reference machine a worst-case (Paeth-filtered) megapixel
# costs about three seconds, once, after which the prepared object is cached per worker.
# The ceiling is set just above Odoo's own image_1024 variant, so a company logo that is
# too large still has a resized Odoo sibling that fits.
MAX_PIXELS = 1_200_000
MAX_SIDE = 1600
PIXEL_LIMIT_LABEL = "1600 px per zijde en 1,2 miljoen pixels in totaal (bijvoorbeeld 1600 × 750 of 1024 × 1024)"
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
DEPTHS = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
# JPEG start-of-frame markers. C4/C8/CC are Huffman/extension tables, not frames.
SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
TYPE_LABELS = {"png": "PNG", "jpeg": "JPEG"}


class ImageError(ValueError):
    """A rejected brand image, with a message meant for the administrator."""


def image_type(data):
    """Detect by content, never by file extension: a renamed file must not pass."""
    if data[:8] == PNG_SIGNATURE:
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    head = data[:512].lstrip()
    if head[:5] == b"<?xml" or head[:4] == b"<svg" or b"<svg" in head:
        return "svg"
    return None


def _png_header(data):
    if len(data) < 33 or data[8:16] != b"\x00\x00\x00\rIHDR":
        raise ImageError("Dit PNG-bestand is beschadigd: de kop (IHDR) ontbreekt. "
                         "Exporteer het logo opnieuw uit je ontwerpprogramma en upload het daarna nog een keer.")
    width, height, depth, color, compression, filtering, interlace = struct.unpack_from(">IIBBBBB", data, 16)
    if color not in CHANNELS or compression or filtering:
        raise ImageError("Dit PNG-bestand gebruikt een variant die niet in een PDF past. "
                         "Exporteer het logo als een gewone PNG (RGB of RGB met transparantie) en upload het opnieuw.")
    if interlace:
        raise ImageError("Dit PNG-bestand is interlaced (Adam7) opgeslagen en kan niet in het voorstel worden gezet. "
                         "Zet in je ontwerpprogramma 'interlaced' uit bij het exporteren en upload het logo opnieuw.")
    if depth not in DEPTHS[color]:
        raise ImageError("Dit PNG-bestand gebruikt een kleurdiepte die niet bij zijn kleurtype hoort en is "
                         "waarschijnlijk beschadigd. Exporteer het logo als 8-bits PNG en upload het opnieuw.")
    return width, height, depth, color


def _jpeg_header(data):
    position = 2
    while position + 4 <= len(data):
        if data[position] != 0xFF:
            break
        marker = data[position + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            position += 2
            continue
        length = struct.unpack_from(">H", data, position + 2)[0]
        if marker in SOF_MARKERS:
            height, width = struct.unpack_from(">HH", data, position + 5)
            components = data[position + 9]
            if components not in (1, 3):
                raise ImageError("Dit JPEG-bestand staat in CMYK-kleuren, die in een voorstel verkeerd worden afgedrukt. "
                                 "Sla het logo op in RGB (of als PNG) en upload het opnieuw.")
            return width, height, "DeviceGray" if components == 1 else "DeviceRGB"
        position += 2 + length
    raise ImageError("Dit JPEG-bestand is beschadigd: de beeldafmetingen ontbreken. "
                     "Exporteer het logo opnieuw en upload het daarna nog een keer.")


def inspect(data, *, filename=""):
    """Cheap header-only check, safe to run on every save of the appearance form."""
    if not data:
        raise ImageError("Er is geen bestand ontvangen. Kies een PNG- of JPEG-bestand en sla opnieuw op.")
    if len(data) > MAX_BYTES:
        raise ImageError(f"Dit logo is {len(data) // 1024} kB en daarmee groter dan de limiet van {MAX_BYTES // 1024} kB. "
                         "Een te groot logo maakt elk voorstel traag om te openen en te mailen. "
                         "Sla het logo op met kleinere afmetingen of als geoptimaliseerde PNG en upload het opnieuw.")
    kind = image_type(data)
    if kind == "svg":
        raise ImageError("Een SVG-logo kan niet in het PDF-voorstel worden ingesloten; het voorstel wordt zonder "
                         "externe programma's opgebouwd en kan alleen pixelbeelden plaatsen. "
                         "Exporteer het logo uit hetzelfde bestand als PNG met transparante achtergrond "
                         "(ongeveer 600 px breed) en upload die PNG.")
    if kind is None:
        name = f" ({filename})" if filename else ""
        raise ImageError(f"Dit bestandstype wordt niet herkend als PNG of JPEG{name}. "
                         "Het voorstel kan alleen die twee formaten insluiten. "
                         "Exporteer het logo als PNG (met transparante achtergrond) of als JPEG en upload het opnieuw.")
    if kind == "png":
        width, height, _depth, _color = _png_header(data)
        colorspace = "DeviceRGB"
    else:
        width, height, colorspace = _jpeg_header(data)
    if not width or not height:
        raise ImageError("Dit beeld heeft geen geldige afmetingen. Exporteer het logo opnieuw en upload het daarna nog een keer.")
    if width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_PIXELS:
        raise ImageError(f"Dit logo is {width} × {height} pixels en daarmee groter dan de limiet van {PIXEL_LIMIT_LABEL}. "
                         "Zo'n beeld kost onnodig veel tijd en ruimte in elk voorstel, terwijl het in de kop maar "
                         "enkele centimeters breed wordt afgedrukt. Schaal het logo naar ongeveer 600 px breed en upload het opnieuw.")
    return {"type": kind, "label": TYPE_LABELS[kind], "mime": "image/" + kind,
            "width": width, "height": height, "colorspace": colorspace, "bytes": len(data)}


@lru_cache(maxsize=1)
def _blend_table():
    """value = round(colour * alpha / 255 + 255 * (1 - alpha / 255)), indexed (alpha << 8) | colour."""
    return bytes((colour * alpha + 255 * (255 - alpha) + 127) // 255
                 for alpha in range(256) for colour in range(256))


def _unfilter(raw, stride, height, bpp):
    """Reverse the five PNG scanline filters in place; the PDF stream carries no filter bytes."""
    if len(raw) < (stride + 1) * height:
        raise ImageError("Dit PNG-bestand is onvolledig opgeslagen. Exporteer het logo opnieuw en upload het daarna nog een keer.")
    out = bytearray(stride * height)
    previous = bytearray(stride)
    for row in range(height):
        start = row * (stride + 1)
        method = raw[start]
        line = bytearray(raw[start + 1:start + 1 + stride])
        if method == 1:
            # Modular addition is associative, so an unmasked running sum per channel
            # gives the same bytes as the byte-by-byte loop, with the loop itself in C.
            for offset in range(bpp):
                line[offset::bpp] = bytes(value & 0xFF for value in accumulate(line[offset::bpp]))
        elif method == 2:
            line = bytearray((above + value) & 0xFF for above, value in zip(previous, line))
        elif method == 3:
            for index in range(stride):
                left = line[index - bpp] if index >= bpp else 0
                line[index] = (line[index] + ((left + previous[index]) >> 1)) & 0xFF
        elif method == 4:
            for index in range(stride):
                left = line[index - bpp] if index >= bpp else 0
                upper_left = previous[index - bpp] if index >= bpp else 0
                up = previous[index]
                estimate = left + up - upper_left
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - upper_left)
                nearest = left if pa <= pb and pa <= pc else up if pb <= pc else upper_left
                line[index] = (line[index] + nearest) & 0xFF
        elif method:
            raise ImageError("Dit PNG-bestand gebruikt een onbekende regelfilter en is waarschijnlijk beschadigd. "
                             "Exporteer het logo opnieuw en upload het daarna nog een keer.")
        out[row * stride:(row + 1) * stride] = line
        previous = line
    return out


def _expand(line, depth, count):
    """Widen sub-byte greyscale or palette samples to one byte each."""
    if depth == 8:
        return line[:count]
    if depth == 16:
        return line[0:count * 2:2]
    per_byte, mask = 8 // depth, (1 << depth) - 1
    values = bytearray(count)
    for index in range(count):
        byte = line[index // per_byte]
        shift = 8 - depth * (index % per_byte + 1)
        values[index] = (byte >> shift) & mask
    return values


def png_rgb(data):
    """Return (width, height, RGB bytes) with any transparency flattened onto white."""
    width, height, depth, color = _png_header(data)
    palette, transparency, pixels = b"", b"", bytearray()
    position = 8
    while position + 8 <= len(data):
        length, kind = struct.unpack_from(">I4s", data, position)
        chunk = data[position + 8:position + 8 + length]
        position += 12 + length
        if kind == b"PLTE":
            palette = chunk
        elif kind == b"tRNS":
            transparency = chunk
        elif kind == b"IDAT":
            pixels += chunk
        elif kind == b"IEND":
            break
    if color == 3 and not palette:
        raise ImageError("Dit PNG-bestand mist zijn kleurtabel (PLTE) en kan niet worden gelezen. "
                         "Exporteer het logo opnieuw en upload het daarna nog een keer.")
    try:
        raw = zlib.decompress(bytes(pixels))
    except zlib.error as exc:
        raise ImageError("Dit PNG-bestand kan niet worden uitgepakt en is waarschijnlijk beschadigd. "
                         "Exporteer het logo opnieuw en upload het daarna nog een keer.") from exc
    channels = CHANNELS[color]
    stride = (width * channels * depth + 7) // 8
    rows = _unfilter(raw, stride, height, max(1, channels * depth // 8))
    blend, scale = _blend_table(), 255 // ((1 << depth) - 1) if depth < 8 else 1
    alpha_map = bytes(transparency[index] if index < len(transparency) else 255 for index in range(256))
    out = bytearray(width * height * 3)
    for row in range(height):
        line = rows[row * stride:(row + 1) * stride]
        target = row * width * 3
        if color == 2 and depth == 8:
            out[target:target + width * 3] = line[:width * 3]
            continue
        if color == 2:
            samples = line[0:width * 6:2]
            out[target:target + width * 3] = samples
            continue
        if color == 6:
            samples = line if depth == 8 else line[0:width * 8:2]
            for index in range(width):
                red, green, blue, alpha = samples[index * 4:index * 4 + 4]
                base = target + index * 3
                shift = alpha << 8
                out[base] = blend[shift | red]
                out[base + 1] = blend[shift | green]
                out[base + 2] = blend[shift | blue]
            continue
        if color == 4:
            samples = line if depth == 8 else line[0:width * 4:2]
            for index in range(width):
                grey, alpha = samples[index * 2:index * 2 + 2]
                value = blend[(alpha << 8) | grey]
                base = target + index * 3
                out[base] = out[base + 1] = out[base + 2] = value
            continue
        samples = _expand(line, depth, width)
        if color == 0:
            for index in range(width):
                value = samples[index] * scale
                base = target + index * 3
                out[base] = out[base + 1] = out[base + 2] = value
            continue
        for index in range(width):
            entry = samples[index]
            alpha, base = alpha_map[entry], target + index * 3
            if alpha == 255:
                out[base:base + 3] = palette[entry * 3:entry * 3 + 3] or b"\x00\x00\x00"
            else:
                shift = alpha << 8
                for offset in range(3):
                    out[base + offset] = blend[shift | palette[entry * 3 + offset]]
    return width, height, bytes(out)


@lru_cache(maxsize=4)
def pdf_image(data, *, filename=""):
    """A ready PDF image object: metadata plus an already-compressed sample stream."""
    info = inspect(data, filename=filename)
    if info["type"] == "jpeg":
        return {**info, "filter": "DCTDecode", "stream": data, "decode_parms": ""}
    try:
        width, height, samples = png_rgb(data)
    except ImageError:
        raise
    except Exception as exc:  # a malformed chunk must read as a rejected image, never as a crash
        raise ImageError("Dit PNG-bestand kon niet worden gelezen en is waarschijnlijk beschadigd. "
                         "Exporteer het logo opnieuw en upload het daarna nog een keer.") from exc
    return {**info, "width": width, "height": height, "colorspace": "DeviceRGB",
            "filter": "FlateDecode", "stream": zlib.compress(samples, 6), "decode_parms": ""}

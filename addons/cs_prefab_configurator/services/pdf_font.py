"""Trusted bundled TrueType font metrics for the dependency-free PDF writer.

The parser reads sfnt/cmap/hmtx metrics from our bundled, unmodified font.
It never parses a customer-uploaded file. Unicode codepoints get a document
CID and an explicit ToUnicode map so stored names survive text extraction.
"""
from functools import lru_cache
from pathlib import Path
import struct
import zlib


class TrueTypeFont:
    def __init__(self, data):
        self.data = data
        self.tables = {}
        count = struct.unpack_from(">H", data, 4)[0]
        for index in range(count):
            tag, _, offset, length = struct.unpack_from(">4sIII", data, 12 + index * 16)
            self.tables[tag.decode("ascii")] = data[offset:offset + length]
        self.units = struct.unpack_from(">H", self.tables["head"], 18)[0]
        self.bbox = struct.unpack_from(">hhhh", self.tables["head"], 36)
        self.ascent, self.descent = struct.unpack_from(">hh", self.tables["hhea"], 4)
        self.metrics_count = struct.unpack_from(">H", self.tables["hhea"], 34)[0]
        self.glyphs = self._read_cmap()

    def _read_cmap(self):
        cmap = self.tables["cmap"]
        count = struct.unpack_from(">H", cmap, 2)[0]
        subtables = []
        for index in range(count):
            platform, encoding, offset = struct.unpack_from(">HHI", cmap, 4 + index * 8)
            fmt = struct.unpack_from(">H", cmap, offset)[0]
            if platform in (0, 3) and fmt in (4, 12):
                subtables.append((fmt, offset))
        # Prefer UCS-4 (format 12), which also contains ordinary BMP characters.
        fmt, offset = max(subtables)
        glyphs = {}
        if fmt == 12:
            groups = struct.unpack_from(">I", cmap, offset + 12)[0]
            for index in range(groups):
                first, last, glyph = struct.unpack_from(">III", cmap, offset + 16 + index * 12)
                for codepoint in range(first, last + 1):
                    glyphs[codepoint] = glyph + codepoint - first
        else:
            count = struct.unpack_from(">H", cmap, offset + 6)[0] // 2
            ends = offset + 14
            starts = ends + count * 2 + 2
            deltas = starts + count * 2
            ranges = deltas + count * 2
            for index in range(count):
                end = struct.unpack_from(">H", cmap, ends + index * 2)[0]
                start = struct.unpack_from(">H", cmap, starts + index * 2)[0]
                delta = struct.unpack_from(">h", cmap, deltas + index * 2)[0]
                range_offset = struct.unpack_from(">H", cmap, ranges + index * 2)[0]
                for codepoint in range(start, min(end, 65534) + 1):
                    glyph = (codepoint + delta) & 65535
                    if range_offset:
                        pos = ranges + index * 2 + range_offset + (codepoint - start) * 2
                        glyph = struct.unpack_from(">H", cmap, pos)[0]
                        glyph = (glyph + delta) & 65535 if glyph else 0
                    glyphs[codepoint] = glyph
        return glyphs

    def scale(self, value):
        return round(value * 1000 / self.units)

    def glyph(self, character):
        return self.glyphs.get(ord(character), 0)

    def width(self, character):
        glyph = min(self.glyph(character), self.metrics_count - 1)
        return self.scale(struct.unpack_from(">H", self.tables["hmtx"], glyph * 4)[0])

    def wrap(self, paragraph, size, max_width=505):
        """Wrap with actual advance widths, including long unbroken names/URLs."""
        lines, current = [], ""
        for word in paragraph.split():
            candidate = current + (" " if current else "") + word
            if sum(self.width(char) for char in candidate) * size / 1000 <= max_width:
                current = candidate
                continue
            if current:
                lines.append(current)
                current = ""
            for char in word:
                if current and sum(self.width(c) for c in current + char) * size / 1000 > max_width:
                    lines.append(current)
                    current = ""
                current += char
        if current or not lines:
            lines.append(current)
        return lines


@lru_cache(maxsize=1)
def bundled_font():
    return TrueTypeFont((Path(__file__).resolve().parent / "fonts" / "DejaVuSans.ttf").read_bytes())


def stream_object(data, *, extra=""):
    compressed = zlib.compress(data)
    return f"<< /Length {len(compressed)} /Filter /FlateDecode {extra} >>\nstream\n".encode("ascii") + compressed + b"\nendstream"


def font_objects(characters):
    """Return six PDF objects starting at 3, and a Unicode-to-CID dictionary."""
    font = bundled_font()
    chars = sorted(set(characters))
    codes = {char: index for index, char in enumerate(chars, 1)}
    glyph_map = b"\x00\x00" + b"".join(struct.pack(">H", font.glyph(char)) for char in chars)
    widths = " ".join(str(font.width(char)) for char in chars)
    bbox = " ".join(str(font.scale(value)) for value in font.bbox)
    cmap = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap", "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def", "/CMapName /CSUnicode def", "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"]
    for start in range(0, len(chars), 100):
        chunk = chars[start:start + 100]
        cmap.append(f"{len(chunk)} beginbfchar")
        cmap.extend(f"<{codes[char]:04X}> <{char.encode('utf-16-be').hex().upper()}>" for char in chunk)
        cmap.append("endbfchar")
    cmap.extend(["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"])
    objects = [
        b"<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 8 0 R >>",
        f"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /CIDToGIDMap 7 0 R /DW 600 /W [1 [{widths}]] >>".encode("ascii"),
        f"<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [{bbox}] /ItalicAngle 0 /Ascent {font.scale(font.ascent)} /Descent {font.scale(font.descent)} /CapHeight 730 /StemV 80 /FontFile2 6 0 R >>".encode("ascii"),
        stream_object(font.data, extra=f"/Length1 {len(font.data)}"),
        stream_object(glyph_map),
        stream_object("\n".join(cmap).encode("ascii")),
    ]
    return objects, codes

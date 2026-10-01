"""Small A4 composition engine: Unicode text, vector rules and saved JPEG views.

All layout coordinates are points measured from the top left. The proposal
renderer supplies trusted snapshot data; images have already passed validation.
No browser, network, external renderer or optional Python packages are required.
"""
import base64

from .appearance import LOGO_BOX, PROPOSAL_COLORS
from .pdf_font import bundled_font, font_objects, stream_object
from .pdf_image import pdf_image

PAGE_W, PAGE_H = 595.28, 841.89
# Palette SLOTS, not colours. Until 2.9.7 these were five hex constants, so every proposal printed the same
# green and copper whatever the website's own colours were. Every drawing op now stores the slot NAME and
# render() resolves it through this document's palette (services.appearance.proposal_palette), so one PdfDocument
# prints in the administrator's colours or in Odoo's and the sixty-odd call sites did not have to change.
# A literal "#rrggbb" still passes straight through, for the few colours that are not brand colours.
INK, MUTED, PAPER, LINE, ACCENT, WHITE = "ink", "muted", "paper", "line", "accent", "white"


def rgb(color):
    return " ".join(f"{int(color[i:i + 2], 16) / 255:.4f}" for i in (1, 3, 5))


class PdfDocument:
    def __init__(self, reference, *, logo=None, palette=None, brand_name=None):
        self.reference = reference
        # A brand mark from services.appearance.proposal_logo, or None for the
        # built-in wordmark. The standalone server has no appearance record and
        # therefore always keeps the wordmark.
        self.logo = logo
        # The company's own name, printed as the wordmark when there is no usable logo. The built-in
        # "CS prefab" mark with its tagline is only for the standalone server, which has no company at all:
        # a website that sells as Prefab Partner must never print somebody else's name on its proposals.
        self.brand_name = (brand_name or "").strip() or None
        # {slot: "#rrggbb"} from proposal_palette()["colors"]; absent slots keep the pre-2.9.7 colours.
        self.colors = {**PROPOSAL_COLORS, WHITE: "#ffffff",
                       **{slot: value for slot, value in (palette or {}).items() if slot in PROPOSAL_COLORS}}
        self.pages, self.images = [], {}
        self.font = bundled_font()
        self.page = None
        self._finished = False

    def new_page(self, section="", *, cover=False):
        self.page = {"section": section, "ops": [], "bounds": []}
        self.pages.append(self.page)
        self.rect(0, 0, PAGE_W, PAGE_H, fill=WHITE)
        self.brand(38, 28)
        if not cover:
            self.text(PAGE_W - 38, 47, "ONTWERPVOORSTEL", size=7, color=MUTED, align="right", tracking=1.2)
            self.line(38, 71, PAGE_W - 38, 71, color=LINE)

    def brand(self, x, y):
        if self.logo:
            return self.brand_image(x, y, *LOGO_BOX)
        if self.brand_name:
            # Shrunk to fit the same box a logo gets, so a long company name never runs into the page label.
            size = 19
            while size > 10 and self.text_width(self.brand_name, size) > LOGO_BOX[0] + 60:
                size -= .5
            return self.text(x, y + 22, self.brand_name, size=size, bold=True)
        self.poly([(x, y + 7), (x + 11, y), (x + 22, y + 7), (x + 22, y + 23),
                   (x + 11, y + 30), (x, y + 23), (x, y + 7), (x + 11, y + 14),
                   (x + 22, y + 7)], color=INK, weight=1.2)
        self.line(x + 11, y + 14, x + 11, y + 30, color=INK, weight=1.2)
        self.text(x + 33, y + 20, "CS prefab", size=19, bold=True)
        self.text(x + 34, y + 32, "RUIMTE OM TE LEVEN", size=5.6, color=MUTED, tracking=1.25)

    def brand_image(self, x, y, width, height):
        """Fit the mark inside the header box: never stretched, left-aligned on the margin."""
        logo = self.logo
        self.images.setdefault(logo["id"], logo)
        scale = min(width / logo["width"], height / logo["height"])
        w, h = logo["width"] * scale, logo["height"] * scale
        self.page["ops"].append(("image", logo["id"], x, y + (height - h) / 2, w, h))

    def text_width(self, value, size, tracking=0):
        return sum(self.font.width(c) for c in str(value)) * size / 1000 + max(0, len(str(value)) - 1) * tracking

    def text(self, x, y, value, *, size=10, color=INK, bold=False, align="left", tracking=0):
        value = str(value)
        width = self.text_width(value, size, tracking)
        if align == "right":
            x -= width
        elif align == "center":
            x -= width / 2
        self.page["ops"].append(("text", x, y, value, size, color, bold, tracking))
        self.page["bounds"].append((x, y - size, x + width, y + size * .24, value))

    def wrapped(self, value, size, width):
        return [line for paragraph in str(value).splitlines() or [""]
                for line in self.font.wrap(paragraph, size, max_width=width)]

    def paragraph(self, x, y, value, *, width, size=9, leading=None, color=INK, bold=False):
        leading = leading or size * 1.5
        for line in self.wrapped(value, size, width):
            self.text(x, y, line, size=size, color=color, bold=bold)
            y += leading
        return y

    def height(self, value, *, width, size=9, leading=None):
        return len(self.wrapped(value, size, width)) * (leading or size * 1.5)

    def rect(self, x, y, width, height, *, fill=None, stroke=None, weight=.6):
        self.page["ops"].append(("rect", x, y, width, height, fill, stroke, weight))

    def line(self, x1, y1, x2, y2, *, color=LINE, weight=.6, dash=None):
        self.poly([(x1, y1), (x2, y2)], color=color, weight=weight, dash=dash)

    def poly(self, points, *, color=INK, weight=.6, fill=None, dash=None):
        self.page["ops"].append(("poly", points, color, weight, fill, dash))

    def image(self, view, x, y, width, height):
        self.images.setdefault(view["id"], view)
        scale = min(width / view["width"], height / view["height"])
        w, h = view["width"] * scale, view["height"] * scale
        self.page["ops"].append(("image", view["id"], x + (width - w) / 2, y + (height - h) / 2, w, h))

    def image_card(self, view, x, y, width, height, *, number, label, note=""):
        self.rect(x, y, width, height, fill=PAPER, stroke=LINE)
        self.image(view, x + 1, y + 1, width - 2, height - 2)
        self.text(x, y + height + 17, number, size=7.5, color=ACCENT, bold=True)
        self.text(x + 22, y + height + 17, label, size=9.5, bold=True)
        if note:
            self.paragraph(x + 22, y + height + 32, note, width=width - 22, size=7.5, color=MUTED, leading=11)

    def section_title(self, number, title, description, *, size=25):
        self.text(38, 100, number, size=8, color=ACCENT, tracking=1.1, bold=True)
        self.text(38, 134, title, size=size, bold=True)
        return self.paragraph(38, 158, description, width=PAGE_W - 76, size=9, color=MUTED, leading=14) + 17

    def footer(self):
        if self._finished:
            return
        for index, page in enumerate(self.pages, 1):
            self.page = page
            self.line(38, 793, PAGE_W - 38, 793, color=LINE)
            self.text(38, 813, self.reference, size=6.5, color=MUTED)
            self.text(PAGE_W / 2, 813, page["section"], size=6.5, color=MUTED, align="center")
            self.text(PAGE_W - 38, 813, f"{index:02d} / {len(self.pages):02d}", size=7, color=MUTED, align="right")
        self._finished = True

    def render(self):
        self.footer()
        # A slot name resolves through this document's palette; a literal hex passes straight through.
        def paint_rgb(color):
            return rgb(self.colors.get(color, color))

        chars = "".join(op[3] for page in self.pages for op in page["ops"] if op[0] == "text")
        fonts, codes = font_objects(chars)
        objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""] + fonts
        image_objects = {}
        for index, (key, view) in enumerate(self.images.items(), 1):
            if view.get("kind") == "brand":
                # An administrator's mark: PNG is unpacked onto white here, JPEG passes through.
                mark = pdf_image(view["data"], filename=view["filename"])
                width, height = mark["width"], mark["height"]
                colorspace, image_filter, data = mark["colorspace"], mark["filter"], mark["stream"]
            else:
                width, height, colorspace, image_filter = view["width"], view["height"], "DeviceRGB", "DCTDecode"
                data = base64.b64decode(view["dataUrl"].split(",", 1)[1])
            image_objects[key] = (f"Im{index}", len(objects) + 1)
            header = (f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
                      f"/ColorSpace /{colorspace} /BitsPerComponent 8 /Filter /{image_filter} /Length {len(data)} >>\nstream\n")
            objects.append(header.encode("ascii") + data + b"\nendstream")

        def encoded(value):
            return "<" + "".join(f"{codes[c]:04X}" for c in value) + ">"

        kids = []
        for page in self.pages:
            commands, used_images = [], set()
            for op in page["ops"]:
                if op[0] == "text":
                    _, x, y, value, size, color, bold, tracking = op
                    render = "2 Tr 0.17 w" if bold else "0 Tr"
                    commands.append(f"BT /F1 {size} Tf {render} {tracking} Tc {paint_rgb(color)} rg {paint_rgb(color)} RG {x:.3f} {PAGE_H - y:.3f} Td {encoded(value)} Tj ET")
                elif op[0] == "rect":
                    _, x, y, w, h, fill, stroke, weight = op
                    paint = "B" if fill and stroke else "f" if fill else "S"
                    colors = (paint_rgb(fill) + " rg " if fill else "") + (paint_rgb(stroke) + " RG " if stroke else "")
                    commands.append(f"q {colors}{weight} w {x:.3f} {PAGE_H-y-h:.3f} {w:.3f} {h:.3f} re {paint} Q")
                elif op[0] == "poly":
                    _, points, color, weight, fill, dash = op
                    path = " ".join(f"{x:.3f} {PAGE_H-y:.3f} {'m' if i == 0 else 'l'}" for i, (x, y) in enumerate(points))
                    paint = "h B" if fill else "S"
                    colors = paint_rgb(color) + " RG " + (paint_rgb(fill) + " rg " if fill else "")
                    pattern = f"[{' '.join(map(str, dash))}] 0 d " if dash else ""
                    commands.append(f"q {colors}{weight} w {pattern}{path} {paint} Q")
                else:
                    _, key, x, y, w, h = op
                    name, _ = image_objects[key]
                    used_images.add(key)
                    commands.append(f"q {w:.3f} 0 0 {h:.3f} {x:.3f} {PAGE_H-y-h:.3f} cm /{name} Do Q")
            resources = " ".join(f"/{image_objects[key][0]} {image_objects[key][1]} 0 R" for key in sorted(used_images))
            page_id = len(objects) + 1
            kids.append(f"{page_id} 0 R")
            objects.append((f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                            f"/Resources << /Font << /F1 3 0 R >> /XObject << {resources} >> >> /Contents {page_id + 1} 0 R >>").encode("ascii"))
            objects.append(stream_object("\n".join(commands).encode("ascii")))
        objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode("ascii")
        output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for index, obj in enumerate(objects, 1):
            offsets.append(len(output))
            output.extend(f"{index} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
        xref = len(output)
        output.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode("ascii"))
        for offset in offsets[1:]:
            output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        output.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
        return bytes(output)

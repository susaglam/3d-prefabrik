"""Appearance never accepts arbitrary CSS or changes a catalogue payload."""
from pathlib import Path
import random
import re
import struct
import sys
import unittest
from unittest import mock
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "addons" / "cs_prefab_configurator"))
from services.appearance import (BROWSER_PARTS, DOCUMENT_PARTS, LOGO_BOX, LOGO_KEY, LOGO_MAX_BYTES, LOGO_MAX_PIXELS,
                                 LOGO_MAX_SIDE, PROPOSAL_COLORS, appearance_payload, color, contrast, logo_summary,
                                 proposal_logo, proposal_palette)
from services.pdf_layout import rgb
from services.svg_raster import is_svg, svg_aspect, svg_to_png
from services.scene_content import BROWSER_KEYS, EXTRAS, MODES, scene_content_payload
from services.documents import build_proposal, quote_html, quote_pdf
from services.pdf_image import ImageError, image_type, inspect, pdf_image, png_rgb
from test_document_visuals import JPEG_RED
from test_documents import saved_quote


def png_chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


def png_bytes(width, height, pixels, *, color_type=6, depth=8, palette=None, transparency=None, filters=(0,)):
    """A genuine PNG, written here so the suite needs no imaging library."""
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    stride = (width * channels * depth + 7) // 8
    bpp = max(1, channels * depth // 8)
    raw = bytearray()
    for row in range(height):
        line = pixels[row * stride:(row + 1) * stride]
        above = pixels[(row - 1) * stride:row * stride] if row else bytes(stride)
        method = filters[row % len(filters)]
        raw.append(method)
        if method == 0:
            raw += line
        elif method == 1:
            raw += bytes((line[i] - (line[i - bpp] if i >= bpp else 0)) & 255 for i in range(stride))
        elif method == 2:
            raw += bytes((line[i] - above[i]) & 255 for i in range(stride))
        elif method == 3:
            raw += bytes((line[i] - (((line[i - bpp] if i >= bpp else 0) + above[i]) >> 1)) & 255 for i in range(stride))
        else:
            for i in range(stride):
                left, up = (line[i - bpp] if i >= bpp else 0), above[i]
                upper_left = above[i - bpp] if i >= bpp else 0
                estimate = left + up - upper_left
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - upper_left)
                raw.append((line[i] - (left if pa <= pb and pa <= pc else up if pb <= pc else upper_left)) & 255)
    body = png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, depth, color_type, 0, 0, 0))
    if palette:
        body += png_chunk(b"PLTE", palette)
    if transparency:
        body += png_chunk(b"tRNS", transparency)
    return b"\x89PNG\r\n\x1a\n" + body + png_chunk(b"IDAT", zlib.compress(bytes(raw))) + png_chunk(b"IEND", b"")


def logo_png(width=240, height=80, *, red=0xE9, green=0x00, blue=0x7A, alpha=255, filters=(0, 1, 2, 3, 4)):
    """A flat brand colour with one fully transparent column, like a real trimmed logo."""
    rows = bytearray()
    for _row in range(height):
        for column in range(width):
            transparent = column < 4
            rows += bytes((0, 255, 0, 0) if transparent else (red, green, blue, alpha))
    return png_bytes(width, height, bytes(rows), color_type=6, filters=filters)


def composed_text(doc):
    return "\n".join(op[3] for page in doc.pages for op in page["ops"] if op[0] == "text")


class AppearanceTests(unittest.TestCase):
    def test_modes_are_ui_only_and_website_native_is_explicit(self):
        brand = appearance_payload()
        custom = appearance_payload({"mode": "custom", "color_action": "#43285F", "body_font": "system", "font_size": 18})
        self.assertEqual(brand["mode"], "brand")
        self.assertEqual(brand["headingFont"], brand["font"])
        self.assertIsNone(brand["nativeUrl"])
        self.assertEqual(custom["colors"]["action"], "#43285f")
        self.assertEqual(custom["fontSize"], 18)
        self.assertEqual(appearance_payload({"mode": "odoo"})["nativeUrl"], "/prefab/theme")
        self.assertFalse(set(brand) & {"price", "config", "catalogRevision", "website_id", "company_id"})
        self.assertEqual(set(brand), {"mode", "colors", "font", "headingFont", "fontSize", "nativeUrl",
                                      "compareEnabled", "documentSurroundings", "documentParts", "sceneContent", "renderQuality",
                                      "gardenFence", "gardenFenceStyle", "cameraFreeOrbit", "interiorFurniture", "exitUrl"})

    def test_garden_fence_defaults_on(self):
        # Vormgeving -> Schutting in de tuin (2.11.0). Missing means ON: an Odoo that predates the field, a website
        # without a vormgeving record and the standalone server keep the garden they have always drawn.
        self.assertIs(appearance_payload()["gardenFence"], True)
        self.assertIs(appearance_payload({"garden_fence": True})["gardenFence"], True)
        self.assertIs(appearance_payload({"garden_fence": False})["gardenFence"], False)

    def test_free_orbit_defaults_off_so_the_visitor_stays_in_front_of_the_house(self):
        # 2.14.0, Vormgeving -> Vrij rondkijken: off, the camera stops level with the gevel (preview.js CAMERA_LIMIT).
        self.assertIs(appearance_payload()["cameraFreeOrbit"], False)
        self.assertIs(appearance_payload({"camera_free_orbit": True})["cameraFreeOrbit"], True)
        for off in (False, None, 0, "", "yes", 1):
            self.assertIs(appearance_payload({"camera_free_orbit": off})["cameraFreeOrbit"], False, off)

    def test_interior_furniture_defaults_off_so_the_room_is_shown_empty_from_inside(self):
        # 2.14.1, Vormgeving -> Meubels in de binnenweergave (static/src/preview.js applyScenery).
        self.assertIs(appearance_payload()["interiorFurniture"], False)
        self.assertIs(appearance_payload({"interior_furniture": True})["interiorFurniture"], True)
        for off in (False, None, 0, "", "yes", 1):
            self.assertIs(appearance_payload({"interior_furniture": off})["interiorFurniture"], False, off)

    def test_garden_fence_style_defaults_to_modern_and_rejects_unknown_styles(self):
        # Vormgeving -> Soort afscheiding (2.12.0): the same three ids as static/src/environment.js FENCE_STYLES.
        self.assertEqual(appearance_payload()["gardenFenceStyle"], "modern")
        self.assertEqual(appearance_payload({"garden_fence_style": False})["gardenFenceStyle"], "modern")
        for style in ("modern", "hedge", "classic"):
            self.assertEqual(appearance_payload({"garden_fence_style": style})["gardenFenceStyle"], style)
        for bad in ("barbed", "MODERN", 1):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                appearance_payload({"garden_fence_style": bad})
        styles = re.search(r"FENCE_STYLES=Object\.freeze\(\[(.*?)\]", (Path(__file__).resolve().parent.parent / "addons/cs_prefab_configurator/static/src/environment.js").read_text(encoding="utf-8")).group(1)
        self.assertEqual(re.findall(r"id:'([a-z]+)'", styles), ["modern", "hedge", "classic"], "one list, two languages")

    def test_exit_url_accepts_site_paths_and_web_addresses_only(self):
        # Vormgeving -> Terug naar de website (2.11.0). The value becomes a navigation target in the visitor's
        # browser, so anything that could run script on the website's origin, or leave for an unnamed host, is refused.
        self.assertEqual(appearance_payload()["exitUrl"], "/")
        for good in ("/", "/aanbouw", "/nl/contact?x=1#top", "https://www.voorbeeld.nl/", "http://voorbeeld.nl", "  /aanbouw  "):
            self.assertEqual(appearance_payload({"exit_url": good})["exitUrl"], good.strip(), good)
        for off in ("", None, False, "   "):
            self.assertEqual(appearance_payload({"exit_url": off})["exitUrl"], "", repr(off))
        for bad in ("javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "//evil.example", "https://",
                    "www.voorbeeld.nl", "/a b", "https://x.nl/\x00", 42, "/" + "a" * 600):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                appearance_payload({"exit_url": bad})

    def test_render_quality_defaults_to_automatic_and_rejects_unknown_tiers(self):
        # Vormgeving -> Weergavekwaliteit 3D. An Odoo that predates the field, a website without a vormgeving record
        # and the standalone server all mean "let the device decide"; only the three named tiers are accepted.
        self.assertEqual(appearance_payload()["renderQuality"], "auto")
        self.assertEqual(appearance_payload({"render_quality": False})["renderQuality"], "auto")
        for tier in ("auto", "full", "compact"):
            self.assertEqual(appearance_payload({"render_quality": tier})["renderQuality"], tier)
        for bad in ("high", "FULL", 1, "ultra"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                appearance_payload({"render_quality": bad})

    def test_compare_flag_defaults_off_and_is_a_strict_boolean(self):
        # The standalone server has no Odoo record, so the OFF default must live in the payload itself.
        self.assertIs(appearance_payload()["compareEnabled"], False)
        self.assertIs(appearance_payload({"mode": "odoo"})["compareEnabled"], False)
        self.assertIs(appearance_payload({"compare_enabled": True})["compareEnabled"], True)
        for raw, expected in ((1, True), (0, False), (None, False), ("", False)):
            with self.subTest(raw=raw):
                self.assertIs(appearance_payload({"compare_enabled": raw})["compareEnabled"], expected)
        # The flag is UI-only: it never alters colours, fonts or the native theme URL.
        with_flag = appearance_payload({"mode": "custom", "compare_enabled": True})
        without_flag = appearance_payload({"mode": "custom"})
        self.assertEqual({k: v for k, v in with_flag.items() if k != "compareEnabled"},
                         {k: v for k, v in without_flag.items() if k != "compareEnabled"})

    def test_proposal_omgeving_defaults_off_and_is_a_strict_boolean(self):
        """The customer's "varsayilan gozukmesin": the aanbouw alone unless an administrator says otherwise.

        The default lives in the payload, not only on the Odoo field, because three readers have no
        record to read: the standalone server, a website whose vormgeving predates this field, and an
        Odoo whose addon was upgraded before its data. All three must print the product on its own.
        """
        self.assertIs(appearance_payload()["documentSurroundings"], False)
        self.assertIs(appearance_payload({"mode": "odoo"})["documentSurroundings"], False)
        self.assertIs(appearance_payload({"document_surroundings": True})["documentSurroundings"], True)
        for raw, expected in ((1, True), (0, False), (None, False), ("", False)):
            with self.subTest(raw=raw):
                self.assertIs(appearance_payload({"document_surroundings": raw})["documentSurroundings"], expected)
        # Two independent switches: the compare panel says nothing about the proposal images, and neither
        # of them touches a colour, a font, the native theme URL or the scene policy.
        with_flag = appearance_payload({"mode": "custom", "document_surroundings": True})
        without_flag = appearance_payload({"mode": "custom"})
        self.assertEqual({k: v for k, v in with_flag.items() if k != "documentSurroundings"},
                         {k: v for k, v in without_flag.items() if k != "documentSurroundings"})
        self.assertIs(appearance_payload({"compare_enabled": True})["documentSurroundings"], False)
        self.assertIs(appearance_payload({"document_surroundings": True})["compareEnabled"], False)

    def test_unsafe_colors_fonts_and_sizes_are_rejected(self):
        for value in ("red", "#fff", "#ffffff;background:url(https://example.test)", "url(test)", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                color(value)
        for values in ({"body_font": "Arial; color:red"}, {"heading_font": "https://example.test/font"},
                       {"mode": "other"}, {"font_size": 13}, {"font_size": 21}, {"font_size": True}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                appearance_payload(values)

    def test_custom_palette_requires_readable_labels_and_buttons(self):
        self.assertAlmostEqual(contrast("#000000", "#ffffff"), 21)
        for field in ("text", "heading", "muted", "error", "action"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                appearance_payload({"mode": "custom", "color_" + field: "#ffffff"})


class SceneContentTests(unittest.TestCase):
    """The illustrative extras an administrator can switch off, and the payload that carries them."""

    def test_every_extra_is_offered_by_default_so_an_upgrade_never_empties_a_live_scene(self):
        # The opposite default from compareEnabled, on purpose: compare is a feature that did not exist, these
        # five have been in the picture since the configurator shipped. A missing value must not blank them.
        payload = scene_content_payload()
        self.assertEqual(set(payload), {"fixtures", "garden", "neighbours", "interior", "houseOpenings"})
        self.assertEqual(set(payload.values()), {"on"})
        self.assertEqual(appearance_payload()["sceneContent"], payload)
        # A record that predates the feature has none of the fields; it still reads as "everything shown".
        self.assertEqual(scene_content_payload({"mode": "custom", "compare_enabled": True}), payload)

    def test_each_admin_field_reaches_the_browser_under_its_own_key(self):
        for extra in EXTRAS:
            for mode in MODES:
                with self.subTest(field=extra["field"], mode=mode):
                    payload = scene_content_payload({extra["field"]: mode})
                    self.assertEqual(payload[BROWSER_KEYS[extra["key"]]], mode)
                    # Switching one extra never moves another.
                    others = {key: value for key, value in payload.items() if key != BROWSER_KEYS[extra["key"]]}
                    self.assertEqual(set(others.values()), {"on"})
        # The tag stage 1 wrote onto the groups themselves is the key the browser reads, not a second spelling.
        self.assertEqual(BROWSER_KEYS["house_openings"], "houseOpenings")

    def test_an_unknown_mode_is_refused_and_the_message_names_the_extra_and_the_choices(self):
        for extra in EXTRAS:
            with self.subTest(field=extra["field"]), self.assertRaises(ValueError) as caught:
                scene_content_payload({extra["field"]: "maybe"})
            message = str(caught.exception)
            self.assertIn(extra["label"], message)
            for choice in ("Tonen", "Standaard uit", "Uitgeschakeld"):
                self.assertIn(choice, message)
        for raw in (True, 1, None, "", "ON"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                scene_content_payload({"scene_garden": raw})

    def test_scene_content_is_independent_of_colours_fonts_and_the_compare_flag(self):
        switched = appearance_payload({"mode": "custom", "color_action": "#43285f", "font_size": 18,
                                       "scene_garden": "hidden", "scene_interior": "off"})
        plain = appearance_payload({"mode": "custom", "color_action": "#43285f", "font_size": 18})
        self.assertEqual({key: value for key, value in switched.items() if key != "sceneContent"},
                         {key: value for key, value in plain.items() if key != "sceneContent"})
        self.assertEqual(switched["sceneContent"],
                         {"fixtures": "on", "garden": "hidden", "neighbours": "on", "interior": "off",
                          "houseOpenings": "on"})
        # Nothing priced, configured or frozen travels with it.
        self.assertFalse(set(switched) & {"price", "config", "catalogRevision"})

    def test_the_native_website_theme_carries_the_same_policy(self):
        # mode='odoo' replaces the colours in the browser from the theme probe; the policy is not a colour.
        self.assertEqual(appearance_payload({"mode": "odoo", "scene_neighbours": "hidden"})["sceneContent"]["neighbours"],
                         "hidden")


class LogoImageTests(unittest.TestCase):
    """The standard-library PNG reader that lets a proposal carry a customer logo."""

    def test_transparency_is_flattened_onto_the_white_page_for_every_png_filter(self):
        # One opaque red, one half transparent blue, one fully transparent green, one white.
        pixels = bytes([255, 0, 0, 255, 0, 0, 255, 128, 0, 255, 0, 0, 255, 255, 255, 255])
        for method in range(5):
            with self.subTest(filter=method):
                width, height, rgb = png_rgb(png_bytes(2, 2, pixels, filters=(method,)))
                self.assertEqual((width, height), (2, 2))
                self.assertEqual(list(rgb), [255, 0, 0, 127, 127, 255, 255, 255, 255, 255, 255, 255])

    def test_every_png_colour_type_reaches_the_same_rgb_contract(self):
        palette = bytes([255, 0, 0, 0, 0, 255, 255, 255, 0])
        cases = (
            (dict(color_type=2, depth=8), bytes([1, 2, 3, 4, 5, 6]), b"\x01\x02\x03\x04\x05\x06"),
            (dict(color_type=2, depth=16), bytes([1, 9, 2, 9, 3, 9, 4, 9, 5, 9, 6, 9]), b"\x01\x02\x03\x04\x05\x06"),
            (dict(color_type=0, depth=8), bytes([0, 255]), b"\x00\x00\x00\xff\xff\xff"),
            (dict(color_type=4, depth=8), bytes([200, 255, 200, 0]), b"\xc8\xc8\xc8\xff\xff\xff"),
            # Palette entry 1 is transparent through tRNS and must land on white, not blue.
            (dict(color_type=3, depth=4, palette=palette, transparency=bytes([255, 0])), bytes([0x01]), b"\xff\x00\x00\xff\xff\xff"),
        )
        for options, pixels, expected in cases:
            with self.subTest(**options):
                self.assertEqual(png_rgb(png_bytes(2, 1, pixels, **options))[2], expected)

    def test_type_detection_reads_content_and_not_the_file_name(self):
        self.assertEqual(image_type(logo_png(8, 8)), "png")
        self.assertEqual(image_type(JPEG_RED), "jpeg")
        self.assertEqual(image_type(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "svg")
        self.assertIsNone(image_type(b"GIF89a" + b"\x00" * 40))
        renamed = inspect(logo_png(8, 8), filename="logo.jpg")
        self.assertEqual((renamed["type"], renamed["mime"]), ("png", "image/png"))

    def test_a_jpeg_logo_is_handed_to_the_viewer_unchanged(self):
        prepared = pdf_image(JPEG_RED, filename="logo.jpg")
        self.assertEqual(prepared["filter"], "DCTDecode")
        self.assertEqual(prepared["stream"], JPEG_RED)
        self.assertEqual((prepared["width"], prepared["height"], prepared["colorspace"]), (256, 256, "DeviceRGB"))


class LogoValidationTests(unittest.TestCase):
    """Every refusal has to name what failed, why it matters and how to repair it."""

    def refusal(self, data, *, filename=""):
        with self.assertRaises(ImageError) as caught:
            proposal_logo(data, filename=filename, strict=True)
        return str(caught.exception)

    def test_oversized_upload_is_refused_with_the_limit_and_a_remedy(self):
        # Incompressible noise, so the file really exceeds the byte limit.
        noise = random.Random(7).randbytes(400 * 400 * 4)
        bulky = png_bytes(400, 400, noise)
        self.assertGreater(len(bulky), LOGO_MAX_BYTES)
        message = self.refusal(bulky)
        self.assertIn(str(LOGO_MAX_BYTES // 1024) + " kB", message)
        self.assertIn("upload het opnieuw", message)

    def test_too_many_pixels_is_refused_even_when_the_file_is_small(self):
        wide = png_bytes(LOGO_MAX_SIDE + 1, 4, bytes(4 * (LOGO_MAX_SIDE + 1) * 4))
        self.assertLess(len(wide), LOGO_MAX_BYTES)
        message = self.refusal(wide)
        self.assertIn(str(LOGO_MAX_SIDE), message)
        self.assertIn("600 px", message)
        square = png_bytes(1500, 1500, bytes(1500 * 1500 * 1), color_type=0, depth=8)
        self.assertGreater(1500 * 1500, LOGO_MAX_PIXELS)
        self.assertIn("miljoen pixels", self.refusal(square))

    def test_svg_and_unknown_types_are_refused_with_an_export_instruction(self):
        svg = self.refusal(b"<svg xmlns='http://www.w3.org/2000/svg'><rect width='10' height='10'/></svg>", filename="merk.svg")
        self.assertIn("SVG", svg)
        self.assertIn("PNG", svg)
        unknown = self.refusal(b"GIF89a" + b"\x00" * 64, filename="merk.gif")
        self.assertIn("merk.gif", unknown)
        self.assertIn("PNG", unknown)
        self.assertIn("JPEG", unknown)

    def test_damaged_and_interlaced_png_are_refused_and_never_crash(self):
        interlaced = bytearray(logo_png(16, 16))
        interlaced[28] = 1
        self.assertIn("interlaced", self.refusal(bytes(interlaced)))
        truncated = logo_png(16, 16)[:60]
        self.assertTrue(self.refusal(truncated))

    def test_a_source_we_do_not_control_falls_back_instead_of_breaking_a_proposal(self):
        # The Odoo company logo may be replaced with anything Odoo accepts, an SVG included.
        for data in (b"", None, b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"GIF89a", logo_png(16, 16)[:40]):
            with self.subTest(data=str(data)[:24]):
                self.assertIsNone(proposal_logo(data, strict=False))

    def test_a_valid_mark_reads_back_what_will_be_printed(self):
        mark = proposal_logo(logo_png(240, 80), filename="merk.png", alt="Voorbeeld BV")
        self.assertEqual((mark["width"], mark["height"], mark["id"]), (240, 80, LOGO_KEY))
        self.assertEqual(mark["alt"], "Voorbeeld BV")
        self.assertTrue(mark["dataUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(logo_summary(mark), f"PNG · 240 × 80 px · {max(1, mark['bytes'] // 1024)} kB")
        self.assertEqual(logo_summary(None), "")


class ProposalLogoTests(unittest.TestCase):
    """One resolved mark, two renderers, and an untouched standalone document."""

    def setUp(self):
        self.quote = saved_quote()
        self.mark = proposal_logo(logo_png(240, 80), filename="merk.png", alt="Voorbeeld BV")

    def branded(self, mark=None):
        return {**self.quote, "brand": mark or self.mark}

    def test_default_keeps_the_built_in_wordmark(self):
        doc = build_proposal(self.quote)
        text = composed_text(doc)
        self.assertIn("CS prefab", text)
        self.assertIn("RUIMTE OM TE LEVEN", text)
        self.assertNotIn(LOGO_KEY, doc.images)

    def test_the_standalone_proposal_is_byte_for_byte_unchanged_without_a_brand(self):
        # The standalone server has no appearance record and never sets "brand".
        self.assertEqual(quote_pdf(self.quote), quote_pdf({**self.quote, "brand": None}))
        self.assertNotIn(b"/Im0", quote_pdf(self.quote))
        self.assertIn("CS prefab", quote_html(self.quote).decode("utf-8"))

    def test_an_uploaded_png_replaces_the_wordmark_on_every_page_of_the_pdf(self):
        doc = build_proposal(self.branded())
        text = composed_text(doc)
        self.assertNotIn("CS prefab", text)
        self.assertNotIn("RUIMTE OM TE LEVEN", text)
        self.assertIn(LOGO_KEY, doc.images)
        placements = [op for page in doc.pages for op in page["ops"] if op[0] == "image" and op[1] == LOGO_KEY]
        self.assertEqual(len(placements), len(doc.pages))
        # The mark is registered once and referenced from every page.
        self.assertEqual(len([key for key in doc.images if key == LOGO_KEY]), 1)

    def test_the_uploaded_pixels_end_up_in_the_pdf_bytes_flattened_onto_white(self):
        pdf = quote_pdf(self.branded())
        prepared = pdf_image(self.mark["data"], filename=self.mark["filename"])
        self.assertIn(prepared["stream"], pdf)
        self.assertIn(b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", pdf)
        samples = zlib.decompress(prepared["stream"])
        self.assertEqual(len(samples), 240 * 80 * 3)
        self.assertEqual(samples[:3], b"\xff\xff\xff")          # trimmed transparent edge over white paper
        self.assertEqual(samples[12:15], bytes((0xE9, 0x00, 0x7A)))  # the brand colour itself

    def test_a_jpeg_mark_travels_as_jpeg_and_a_png_mark_as_flate(self):
        jpeg = quote_pdf(self.branded(proposal_logo(JPEG_RED, filename="merk.jpg")))
        self.assertIn(JPEG_RED, jpeg)
        self.assertIn(b"/Filter /DCTDecode", jpeg)

    def test_the_header_box_keeps_the_aspect_ratio_for_wide_and_tall_marks(self):
        width, height = LOGO_BOX
        for pixels, expected in (((600, 120), 5.0), ((120, 600), 0.2), ((300, 300), 1.0)):
            with self.subTest(pixels=pixels):
                mark = proposal_logo(logo_png(*pixels))
                doc = build_proposal(self.branded(mark))
                _, _, x, y, drawn_width, drawn_height = next(
                    op for op in doc.pages[0]["ops"] if op[0] == "image" and op[1] == LOGO_KEY)
                self.assertAlmostEqual(drawn_width / drawn_height, expected, places=6)
                self.assertLessEqual(round(drawn_width, 6), width)
                self.assertLessEqual(round(drawn_height, 6), height)
                self.assertEqual(x, 38)                        # flush with the page margin, never centred
                self.assertAlmostEqual(y + drawn_height / 2, 28 + height / 2, places=6)

    def test_the_printable_html_companion_shows_the_same_mark(self):
        page = quote_html(self.branded()).decode("utf-8")
        self.assertIn(self.mark["dataUrl"], page)
        self.assertIn("alt='Voorbeeld BV'", page)
        self.assertNotIn("<strong>CS prefab</strong>", page)
        self.assertIn("max-width:230px", page)


class DocumentPartsTests(unittest.TestCase):
    """The three named parts of a proposal image: slab, terras, doorbraak."""

    def test_defaults_reach_the_browser_and_equal_the_browsers_own_copy(self):
        # Two languages, one decision. The browser's copy lives in scene_content.js; this reads that file rather
        # than restating it, so the day one side changes and the other does not, this test is the one that fails.
        payload = appearance_payload()["documentParts"]
        self.assertEqual(payload, {"slab": True, "terrace": True, "houseRoom": True})
        source = (Path(__file__).resolve().parent.parent / "addons/cs_prefab_configurator/static/src/scene_content.js"
                  ).read_text(encoding="utf-8")
        found = re.search(r"export const DOCUMENT_PARTS=Object\.freeze\(\{([^}]*)\}\)", source)
        self.assertTrue(found, "scene_content.js no longer declares DOCUMENT_PARTS in the expected form")
        browser = {key.strip(): value.strip() == "true" for key, value in
                   (pair.split(":") for pair in found.group(1).split(","))}
        self.assertEqual(browser, {BROWSER_PARTS[key]: value for key, value in DOCUMENT_PARTS.items()})

    def test_each_field_reaches_its_own_key_as_a_strict_boolean(self):
        for field, key in (("document_slab", "slab"), ("document_terrace", "terrace"),
                           ("document_house_room", "houseRoom")):
            parts = appearance_payload({field: False})["documentParts"]
            self.assertIs(parts[key], False, field)
            self.assertEqual(sum(value is False for value in parts.values()), 1, f"{field} moved only itself")
            self.assertIs(appearance_payload({field: 1})["documentParts"][key], True)

    def test_the_parts_are_independent_of_the_omgeving_colours_and_scene(self):
        base = appearance_payload()
        changed = appearance_payload({"document_terrace": False, "document_house_room": False})
        self.assertEqual({k: v for k, v in base.items() if k != "documentParts"},
                         {k: v for k, v in changed.items() if k != "documentParts"})


class ProposalPaletteTests(unittest.TestCase):
    """The PDF prints in the administrator's colours or in Odoo's — never in an unreadable one."""

    def test_nothing_chosen_prints_the_colours_every_proposal_printed_before(self):
        palette = proposal_palette()
        self.assertEqual(palette["colors"], PROPOSAL_COLORS)
        self.assertEqual(palette["notes"], [])

    def test_custom_mode_takes_the_administrators_colours_slot_for_slot(self):
        palette = proposal_palette({"mode": "custom", "color_heading": "#1b2a4a", "color_muted": "#4f5b66",
                                    "color_background": "#f3f5f8", "color_border": "#d5dbe3", "color_action": "#8a2c0f"})
        self.assertEqual(palette["colors"], {"ink": "#1b2a4a", "muted": "#4f5b66", "paper": "#f3f5f8",
                                             "line": "#d5dbe3", "accent": "#8a2c0f"})
        self.assertEqual(set(palette["source"].values()), {"vormgeving"})

    def test_odoo_mode_takes_the_document_layout_colours_first(self):
        palette = proposal_palette({"mode": "odoo", "color_action": "#294e40", "color_heading": "#20302c"},
                                   company_primary="#C43F12", company_secondary="#1D2B36")
        self.assertEqual(palette["colors"]["accent"], "#c43f12")
        self.assertEqual(palette["colors"]["ink"], "#1d2b36")
        self.assertEqual(palette["source"]["accent"], "odoo")
        # Slots Odoo does not have come from the vormgeving, not from a hidden default.
        self.assertEqual(palette["source"]["muted"], "voorstel")

    def test_odoo_colours_are_ignored_outside_odoo_mode_and_when_malformed(self):
        self.assertEqual(proposal_palette({"mode": "custom", "color_action": "#294e40"},
                                          company_primary="#c43f12")["colors"]["accent"], "#294e40")
        for junk in ("red", "", None, "#abc", "#12345g", " #c43f12 "):
            accent = proposal_palette({"mode": "odoo"}, company_primary=junk)["colors"]["accent"]
            self.assertEqual(accent, "#c43f12" if junk == " #c43f12 " else PROPOSAL_COLORS["accent"], repr(junk))

    def test_an_unreadable_colour_falls_back_for_its_own_slot_only_and_says_why(self):
        palette = proposal_palette({"mode": "custom", "color_action": "#ffe066", "color_heading": "#12263a"})
        self.assertEqual(palette["colors"]["accent"], PROPOSAL_COLORS["accent"])
        self.assertEqual(palette["colors"]["ink"], "#12263a", "one pale colour never takes the others down")
        self.assertTrue(any("accent" in note and "#ffe066" in note for note in palette["notes"]))
        for slot in ("ink", "muted", "accent"):
            self.assertGreaterEqual(contrast(palette["colors"][slot], "#ffffff"), 4.5, slot)

    def test_production_prints_its_own_brand_orange(self):
        # The live vormgeving as read from production on 2026-09-18. 2.9.8 printed #9c633e copper here because the
        # accent was measured against the peach panel it is never printed on (4.44:1) — and the copper it fell back
        # to was WORSE on that panel (4.23:1). The accent is printed on white only, where #c43f12 is 5.16:1.
        live = {"mode": "custom", "color_action": "#c43f12", "color_heading": "#1a1a1a", "color_muted": "#5b5b5b",
                "color_background": "#fdeae4"}
        palette = proposal_palette(live)
        self.assertEqual(palette["colors"]["accent"], "#c43f12")
        self.assertEqual(palette["colors"]["ink"], "#1a1a1a")
        self.assertEqual(palette["notes"], [])

    def test_a_fallback_never_replaces_a_colour_it_is_not_better_than(self):
        # A muted grey that just misses AA on a strong panel, where the default grey misses it by more.
        palette = proposal_palette({"mode": "custom", "color_muted": "#767676", "color_background": "#f0e2dc"})
        chosen, default = contrast("#767676", "#f0e2dc"), contrast(PROPOSAL_COLORS["muted"], "#f0e2dc")
        if default <= chosen:
            self.assertEqual(palette["colors"]["muted"], "#767676")
            self.assertTrue(any("niet beter" in note for note in palette["notes"]))
        else:
            self.assertEqual(palette["colors"]["muted"], PROPOSAL_COLORS["muted"])

    def test_a_dark_panel_or_rule_colour_is_refused(self):
        palette = proposal_palette({"mode": "custom", "color_background": "#20302c", "color_border": "#657069"})
        self.assertEqual(palette["colors"]["paper"], PROPOSAL_COLORS["paper"])
        self.assertEqual(palette["colors"]["line"], PROPOSAL_COLORS["line"])

    def test_the_pdf_and_the_html_print_the_resolved_colours(self):
        quote = saved_quote()
        colors = proposal_palette({"mode": "odoo"}, company_primary="#8a2c0f", company_secondary="#1b2a4a")["colors"]
        branded = {**quote, "palette": {"colors": colors}}
        doc = build_proposal(branded)
        self.assertEqual(doc.colors["accent"], "#8a2c0f")
        pdf = zlib_streams(quote_pdf(branded))
        self.assertIn(rgb("#8a2c0f").encode(), pdf, "the accent reaches the page content")
        self.assertNotIn(rgb(PROPOSAL_COLORS["accent"]).encode(), pdf, "and the old copper is gone")
        html_page = quote_html(branded).decode("utf-8")
        self.assertIn("#8a2c0f", html_page)
        self.assertNotIn(PROPOSAL_COLORS["accent"], html_page)

    def test_without_a_logo_the_header_prints_the_company_name_not_cs_prefab(self):
        quote = {**saved_quote(), "brandName": "Prefab Partner"}
        text = composed_text(build_proposal(quote))
        self.assertIn("Prefab Partner", text)
        self.assertNotIn("CS prefab", text)
        self.assertNotIn("RUIMTE OM TE LEVEN", text)
        page = quote_html(quote).decode("utf-8")
        self.assertIn("<strong>Prefab Partner</strong>", page)
        self.assertIn("Prefab Partner ontwerpvoorstel", page)


class SvgLogoTests(unittest.TestCase):
    """The pure half of services/svg_raster.py; the rendering itself is proven in Odoo, where wkhtmltoimage is."""

    LOGO = (b'<?xml version="1.0" encoding="UTF-8"?>\n<svg id="a" xmlns="http://www.w3.org/2000/svg" version="1.1" '
            b'viewBox="0 0 652.6 102.2"><polygon points="0 0 10 10"/></svg>')

    def test_svg_is_recognised_by_content_not_by_name(self):
        self.assertTrue(is_svg(self.LOGO))
        self.assertTrue(is_svg(b"  <svg xmlns='http://www.w3.org/2000/svg'/>"))
        for other in (logo_png(20, 10), b"\xff\xd8\xff\xe0", b"<html><body>svg</body></html>", b"", None):
            self.assertFalse(is_svg(other), repr(other)[:30])

    def test_the_aspect_comes_from_the_viewbox_then_the_size(self):
        # Production's real logo: viewBox 652.6 x 102.2.
        self.assertAlmostEqual(svg_aspect(self.LOGO), 652.6 / 102.2, places=6)
        self.assertAlmostEqual(svg_aspect(b'<svg width="300" height="100"></svg>'), 3.0)
        self.assertEqual(svg_aspect(b"<svg></svg>"), 3.0)

    def test_without_the_renderer_it_returns_none_and_never_raises(self):
        with mock.patch("services.svg_raster.shutil.which", return_value=None):
            self.assertIsNone(svg_to_png(self.LOGO + b"<!-- no renderer -->"))
        self.assertIsNone(svg_to_png(logo_png(20, 10)), "a PNG is not an SVG and is never sent to the renderer")
        with mock.patch("services.svg_raster.shutil.which", return_value="C:/nowhere/wkhtmltoimage.exe"):
            self.assertIsNone(svg_to_png(self.LOGO + b"<!-- broken renderer -->"))


def zlib_streams(pdf):
    """Every FlateDecode stream of a PDF, inflated and concatenated: page content is compressed."""
    out = b""
    for match in re.finditer(rb"stream\n(.*?)\nendstream", pdf, flags=re.S):
        try:
            out += zlib.decompress(match.group(1))
        except zlib.error:
            pass
    return out


if __name__ == "__main__":
    unittest.main()

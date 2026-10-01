"""Proposal regression checks; parser/render checks run when optional tools exist.

Full verification:
  uv run --no-project --with pypdf --with pymupdf python -m unittest discover -s tests -p 'test_documents.py' -v
"""
import base64
from contextlib import ExitStack
import copy
import html
from html.parser import HTMLParser
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "addons" / "cs_prefab_configurator"))
from services.configuration import canonical_quote_payload
from services.documents import build_proposal, document_lines, price_status, quote_html, quote_pdf
from services.pdf_layout import PAGE_H, PAGE_W
from services.storage import new_snapshot
from test_document_visuals import JPEG_BLUE, JPEG_RED, VIEW_LABELS, image_view, quote_payload

HAS_PYPDF = importlib.util.find_spec("pypdf") is not None
HAS_PYMUPDF = importlib.util.find_spec("pymupdf") is not None


def saved_quote(config=None, *, view_ids=tuple(VIEW_LABELS), contact_changes=None):
    data = quote_payload(config)
    if view_ids is None:
        data.pop("visuals")
    else:
        data["visuals"]["views"] = [image_view(key, JPEG_RED if index % 2 else JPEG_BLUE)
                                   for index, key in enumerate(view_ids)]
    data["contact"].update(contact_changes or {})
    canonical, _, _ = canonical_quote_payload(data)
    snapshot = new_snapshot(canonical)
    snapshot["createdAt"] = "2026-09-09T12:34:56+00:00"
    return {"reference": "CS-20260909-PDFTEST1", "snapshot": snapshot, "contact": canonical["contact"]}


def maximum_contact():
    return {"firstName": "W" * 60, "lastName": "Ş" * 80, "address": "Straat" + "w" * 154,
            "city": "Stad" + "w" * 96, "email": "a" * 64 + "@" + "b" * 184 + ".test",
            "message": " ".join(f"regel{index:03}Ğ" for index in range(300))}


def commercial_quote():
    """A persisted commercial response, independent of today's active catalogue."""
    quote = saved_quote()
    quote["snapshot"]["price"].update(
        priceMode="commercial", priceStatusLabel="Prijsindicatie op goedgekeurde tarieven",
        pricebookVersion="TARIEVEN-2026-09-GOEDGEKEURD",
        disclaimer="Vastgelegde voorwaarden: transport binnen Nederland inbegrepen; kraankosten na locatieopname.",
        commercialApproval={"approvedBy": "INTERNAL-USER-DO-NOT-PUBLISH", "approvedAt": "2026-09-09T10:00:00Z"},
    )
    return quote


def composed_text(doc):
    return "\n".join(op[3] for page in doc.pages for op in page["ops"] if op[0] == "text")


class HtmlInventory(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.elements, self.images = [], []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))
        if tag == "img":
            self.images.append(dict(attrs))


class ProposalLayoutTests(unittest.TestCase):
    def assert_layout_fits(self, doc):
        """All composed content stays above the footer and text never overlaps."""
        self.assertGreaterEqual(len(doc.pages), 5)
        for index, page in enumerate(doc.pages, 1):
            with self.subTest(page=index, section=page["section"]):
                for x0, y0, x1, y1, value in page["bounds"]:
                    self.assertGreaterEqual(x0, 37.5, value)
                    self.assertLessEqual(x1, PAGE_W - 37.5, value)
                    self.assertGreaterEqual(y0, 20, value)
                    self.assertLessEqual(y1, 790, value)
                for n, a in enumerate(page["bounds"]):
                    for b in page["bounds"][n + 1:]:
                        intersection_width = min(a[2], b[2]) - max(a[0], b[0])
                        intersection_height = min(a[3], b[3]) - max(a[1], b[1])
                        self.assertFalse(intersection_width > .75 and intersection_height > .75,
                                         f"Text overlap on page {index}: {a[4]!r} / {b[4]!r}")
                for op in page["ops"]:
                    if op[0] == "image":
                        _, _, x, y, width, height = op
                        self.assertGreaterEqual(x, 38)
                        self.assertGreaterEqual(y, 71)
                        self.assertLessEqual(x + width, PAGE_W - 38)
                        self.assertLessEqual(y + height, 790)

    def test_all_six_saved_views_are_used_and_document_rendering_is_repeatable(self):
        quote = saved_quote()
        before = copy.deepcopy(quote)
        doc = build_proposal(quote)
        self.assertEqual(set(doc.images), set(VIEW_LABELS))
        self.assertEqual(len([op for page in doc.pages for op in page["ops"] if op[0] == "image"]), 6)
        self.assert_layout_fits(doc)
        first = doc.render()
        self.assertEqual(first, doc.render())
        self.assertEqual(quote, before)
        self.assertEqual(first.count(b"/Subtype /Image"), 6)
        for index, page in enumerate(doc.pages, 1):
            footer = [box[4] for box in page["bounds"] if box[1] > 793]
            self.assertIn(f"{index:02d} / {len(doc.pages):02d}", footer)
            self.assertEqual(len(footer), 3)

    def test_legacy_quote_uses_labeled_vector_plans_and_no_fabricated_3d(self):
        doc = build_proposal(saved_quote(view_ids=None))
        self.assertFalse(doc.images)
        self.assertNotIn("Ruimtelijke impressies", [page["section"] for page in doc.pages])
        text = composed_text(doc)
        self.assertIn("Schematische plattegrond", text)
        self.assertIn("niet alle 3D-aanzichten opgeslagen", text)
        self.assertIn("Breedte: 500 cm", text)
        self.assertIn("Diepte: 300 cm", text)
        self.assert_layout_fits(doc)
        self.assertNotIn(b"/Subtype /Image", doc.render())

    def test_partial_capture_preserves_available_view_and_explains_missing_views(self):
        doc = build_proposal(saved_quote(view_ids=("perspective-left",)))
        self.assertEqual(set(doc.images), {"perspective-left"})
        text = composed_text(doc)
        self.assertIn("Schematische plattegrond", text)
        self.assertIn("niet alle 3D-aanzichten opgeslagen", text)
        self.assert_layout_fits(doc)

    def test_dimension_extremes_and_many_selected_options_fit_with_and_without_images(self):
        selected = {"interior": True, "plaster": True, "screed": True, "underfloorHeating": True,
                    "heating": "both", "ceilingLights": 2, "switches": 2, "spotlights": 12, "sockets": "both"}
        for width, depth in ((150, 100), (750, 340), (750, 100), (150, 340)):
            for views in (tuple(VIEW_LABELS), None):
                with self.subTest(width=width, depth=depth, captured=views is not None):
                    doc = build_proposal(saved_quote(dict(selected, width=width, depth=depth, frontOpening="none"), view_ids=views))
                    self.assert_layout_fits(doc)
                    text = composed_text(doc)
                    self.assertIn(f"Breedte: {width} cm", text)
                    self.assertIn(f"Diepte: {depth} cm", text)

    def test_maximum_customer_details_and_long_message_paginate_without_truncation(self):
        changes = maximum_contact()
        self.assertEqual(len(changes["message"]), 2999)
        self.assertEqual(len(changes["email"]), 254)
        quote = saved_quote({"width": 150, "depth": 340, "frontOpening": "none"}, contact_changes=changes)
        doc = build_proposal(quote)
        self.assert_layout_fits(doc)
        self.assertGreater(len(doc.pages), len(build_proposal(saved_quote()).pages))
        text = composed_text(doc)
        for token in changes["message"].split():
            self.assertEqual(text.count(token), 1, token)
        compact = "".join(text.split())
        for key in ("name", "address", "city", "email", "phone"):
            self.assertIn("".join(quote["contact"][key].split()), compact, key)

    def test_pdf_and_html_read_frozen_snapshot_without_catalog_or_repricing(self):
        quote = saved_quote()
        next(row for row in quote["snapshot"]["labels"] if row["key"] == "facade")["value"] = "Archiefgevel Ünik 2024"
        price = quote["snapshot"]["price"]
        price["pricebookVersion"] = "archief-test-2024"
        price["lines"][0].update(label="Bewaarde prijsregel Ş", quantity=1.5251, unit="m²", unitPrice=12345, total=18828)
        price.update(total=1234567, subtotal=1020304, vat=214263)
        before = copy.deepcopy(quote)
        with ExitStack() as stack:
            for target in ("services.catalog.get_catalog", "services.catalog.get_pricebook",
                           "services.pricing.price_config", "services.storage.price_config"):
                stack.enter_context(patch(target, side_effect=AssertionError("Document must use the saved snapshot")))
            doc = build_proposal(quote)
            pdf, markup = doc.render(), quote_html(quote).decode()
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertEqual(before, quote)
        for value in ("Archiefgevel Ünik 2024", "Bewaarde prijsregel Ş", "archief-test-2024",
                      "1,5251", "€ 123,45", "€ 188,28", "€ 12.345,67"):
            self.assertIn(value, composed_text(doc))
            self.assertIn(value, markup)

    def test_commercial_documents_keep_saved_terms_and_prices_without_demo_copy_or_internal_approval(self):
        quote = commercial_quote()
        quote["snapshot"]["price"]["total"] = 4321098
        before = copy.deepcopy(quote)
        with ExitStack() as stack:
            for target in ("services.catalog.get_catalog", "services.catalog.get_pricebook",
                           "services.pricing.price_config", "services.storage.price_config"):
                stack.enter_context(patch(target, side_effect=AssertionError("Saved commercial documents must not reprice")))
            doc = build_proposal(quote)
            outputs = [composed_text(doc), quote_html(quote).decode(),
                       "\n".join(text for text, _ in document_lines(quote))]
        self.assert_layout_fits(doc)
        self.assertEqual(quote, before)
        for output in outputs:
            compact = " ".join(output.split())
            for expected in (quote["snapshot"]["price"]["priceStatusLabel"],
                             quote["snapshot"]["price"]["disclaimer"], "€ 43.210,98",
                             "geen bindende offerte", "technische beoordeling"):
                self.assertIn(expected, compact)
            self.assertNotIn("demonstratie", output.lower())
            self.assertNotIn("demoprijzen", output.lower())
            self.assertNotIn("INTERNAL-USER-DO-NOT-PUBLISH", output)

    def test_historical_demo_documents_preserve_original_status_and_wording(self):
        for mode in (None, "demonstration"):
            with self.subTest(priceMode=mode):
                quote = saved_quote()
                price = quote["snapshot"]["price"]
                price.pop("priceStatusLabel", None)
                if mode is None:
                    price.pop("priceMode", None)
                else:
                    price["priceMode"] = mode
                before = copy.deepcopy(quote)
                doc = build_proposal(quote)
                text = composed_text(doc)
                for expected in ("DEMONSTRATIE — GEEN BINDENDE OFFERTE", "Demoprijzen.", "Prijzen zijn demonstratiebedragen."):
                    self.assertIn(expected, text)
                self.assertIn("DEMONSTRATIE — GEEN BINDENDE OFFERTE", quote_html(quote).decode())
                self.assertIn(("DEMONSTRATIE — GEEN BINDENDE OFFERTE", "warning"), document_lines(quote))
                self.assertEqual(quote, before)

    def test_commercial_terms_are_escaped_and_long_terms_paginate_completely(self):
        quote = commercial_quote()
        terms = '<script>alert("approved")</script> & ' + " ".join(f"voorwaarde{index:03}" for index in range(420))
        quote["snapshot"]["price"]["disclaimer"] = terms
        doc = build_proposal(quote)
        self.assert_layout_fits(doc)
        text = composed_text(doc)
        for index in range(420):
            self.assertEqual(text.count(f"voorwaarde{index:03}"), 1)
        markup = quote_html(quote).decode()
        self.assertIn(html.escape(terms, quote=True), markup)
        self.assertNotIn("script", [tag for tag, _ in HtmlInventory(markup).elements])

    def test_printable_html_escapes_customer_text_and_has_six_inert_images_and_tables(self):
        message = '<script>alert("x")</script> <img src=x onerror=alert(1)> & "project"'
        quote = saved_quote(contact_changes={"firstName": "<b>Şükrü</b>", "message": message})
        markup = quote_html(quote).decode("utf-8")
        self.assertIn(html.escape(message, quote=True), markup)
        self.assertIn("&lt;b&gt;Şükrü&lt;/b&gt;", markup)
        inventory = HtmlInventory(markup)
        self.assertEqual(len(inventory.images), 6)
        self.assertNotIn("script", [tag for tag, _ in inventory.elements])
        for tag, attributes in inventory.elements:
            self.assertFalse(any(key.startswith("on") for key in attributes), tag)
        self.assertTrue(all(image["src"].startswith("data:image/jpeg;base64,") for image in inventory.images))
        self.assertEqual({image["alt"] for image in inventory.images}, set(VIEW_LABELS.values()))
        self.assertIn("thead", [tag for tag, _ in inventory.elements])
        self.assertGreater(sum(tag == "table" for tag, _ in inventory.elements), 1)


@unittest.skipUnless(HAS_PYPDF, "Optional pypdf independent parser is not installed")
class IndependentPdfContractTests(unittest.TestCase):
    def test_six_real_rgb_jpeg_xobjects_match_the_saved_pixel_streams(self):
        from pypdf import PdfReader
        quote = saved_quote()
        parsed = PdfReader(io.BytesIO(quote_pdf(quote)), strict=True)
        objects = {}
        for page in parsed.pages:
            self.assertAlmostEqual(float(page.mediabox.width), PAGE_W, places=2)
            self.assertAlmostEqual(float(page.mediabox.height), PAGE_H, places=2)
            for ref in page["/Resources"].get("/XObject", {}).values():
                objects[ref.idnum] = ref.get_object()
        self.assertEqual(len(objects), 6)
        saved_data = [base64.b64decode(view["dataUrl"].split(",", 1)[1]) for view in quote["snapshot"]["visuals"]["views"]]
        actual_data = []
        for image in objects.values():
            self.assertEqual(image["/Subtype"], "/Image")
            self.assertEqual(image["/Filter"], "/DCTDecode")
            self.assertEqual(image["/ColorSpace"], "/DeviceRGB")
            self.assertEqual((image["/Width"], image["/Height"], image["/BitsPerComponent"]), (256, 256, 8))
            actual_data.append(image.get_data())
        self.assertCountEqual(actual_data, saved_data)

    def test_unicode_dimensions_and_complete_cost_columns_survive_text_extraction(self):
        from pypdf import PdfReader
        quote = saved_quote({"width": 501, "depth": 299}, contact_changes={
            "firstName": "Şükrü", "lastName": "Çağrı", "message": "İstanbul, ığüşöç — €"})
        text = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(quote_pdf(quote))).pages)
        for value in ("Şükrü Çağrı", "İstanbul, ığüşöç — €", "Breedte: 501 cm", "Diepte: 299 cm",
                      "AANTAL", "EENH.", "PRIJS / EENH.", "EXCL. BTW", "14,9799", "€ 1.350,00"):
            self.assertIn(value, text)
        for warning in (price_status(quote["snapshot"]["price"]), "Geen constructie-", "Niet op schaal afdrukken"):
            self.assertIn(warning, text)

    def test_commercial_pdf_extraction_retains_approved_price_status_and_nonbinding_review(self):
        from pypdf import PdfReader
        quote = commercial_quote()
        parsed = PdfReader(io.BytesIO(quote_pdf(quote)), strict=True)
        text = "\n".join(page.extract_text() for page in parsed.pages)
        compact = " ".join(text.split())
        self.assertIn(quote["snapshot"]["price"]["priceStatusLabel"], compact)
        self.assertIn(quote["snapshot"]["price"]["disclaimer"], compact)
        self.assertIn("geen bindende offerte", compact)
        self.assertIn("technische beoordeling", compact)
        self.assertNotIn("demonstratie", compact.lower())
        self.assertNotIn("demoprijzen", compact.lower())
        self.assertNotIn("INTERNAL-USER-DO-NOT-PUBLISH", compact)

    def test_maximum_length_message_is_complete_in_actual_pdf(self):
        from pypdf import PdfReader
        changes = maximum_contact()
        parsed = PdfReader(io.BytesIO(quote_pdf(saved_quote(contact_changes=changes))))
        text = "\n".join(page.extract_text() for page in parsed.pages)
        for token in changes["message"].split():
            self.assertEqual(text.count(token), 1, token)
        self.assertIn("Project- en contactgegevens", text)
        self.assertIn("Toestemming voor contact", text)


@unittest.skipUnless(HAS_PYMUPDF, "Optional PyMuPDF independent renderer is not installed")
class IndependentPdfRenderTests(unittest.TestCase):
    def test_actual_text_extents_and_all_pages_render_without_clipping(self):
        import pymupdf
        for views in (tuple(VIEW_LABELS), None):
            quote = saved_quote({"width": 150, "depth": 340, "frontOpening": "none"}, view_ids=views, contact_changes=maximum_contact())
            with pymupdf.open(stream=quote_pdf(quote), filetype="pdf") as doc:
                self.assertGreaterEqual(len(doc), 6)
                for number, page in enumerate(doc, 1):
                    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(.5, .5), alpha=False)
                    self.assertGreater(pixmap.width, 290)
                    self.assertGreater(pixmap.height, 410)
                    self.assertTrue(any(value < 220 for value in pixmap.samples))
                    for block in page.get_text("dict")["blocks"]:
                        if block["type"] != 0:
                            continue
                        for line in block["lines"]:
                            for span in line["spans"]:
                                x0, y0, x1, y1 = span["bbox"]
                                self.assertGreaterEqual(x0, 37, (number, span["text"]))
                                self.assertLessEqual(x1, PAGE_W - 37, (number, span["text"]))
                                self.assertGreaterEqual(y0, 20, (number, span["text"]))
                                self.assertLessEqual(y1, 820 if y0 > 793 else 791, (number, span["text"]))


if __name__ == "__main__":
    unittest.main()

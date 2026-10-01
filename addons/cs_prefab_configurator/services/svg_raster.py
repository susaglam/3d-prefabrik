"""Turn an SVG logo into a PNG the proposal PDF can embed, with the renderer Odoo already ships.

Why this exists. The customer's report was "pdf logo hala odoodan almiyor", and the measured cause on production
(2026-09-18) was not a setting at all: the company logo in Odoo is image/svg+xml — every size Odoo keeps of it
(image_1920 … image_128) is the same 3,9 kB SVG — and the hand-composed proposal PDF embeds only PNG and JPEG. So
the logo was refused on every request, silently, and the proposal fell back to text.

The renderer is wkhtmltoimage, which sits next to wkhtmltopdf in every Odoo image because Odoo's own reports need
it (verified in this image: wkhtmltoimage 0.12.6.1 with patched qt). No Python package, no network, no new
dependency. The SVG is put in a page as a data: URI image at exactly the size wanted, the page is rendered with a
transparent background and JavaScript off, and the PNG comes back. pdf_image() later lays any transparency onto the
white paper, exactly as it does for an uploaded PNG.

Every failure — no binary, a timeout, an SVG it cannot draw, an empty result — returns None, and the caller prints
the company name instead: a missing logo may never break a customer's proposal. Results are cached by the SVG's
own sha256, so a logo is rasterised once per worker, not once per PDF.
"""
import base64
import hashlib
import io
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

_logger = logging.getLogger(__name__)

# Tall enough for a 4 cm header mark to print sharp (the PDF box is 150 x 32 pt), small enough for the pixel limits.
TARGET_HEIGHT = 160
MAX_WIDTH = 1600
_CACHE = {}
_CACHE_LIMIT = 16


def is_svg(data):
    """True for SVG content, recognised by what it contains rather than by a file name."""
    head = bytes(data[:4096]).lstrip().lower() if data else b""
    return head.startswith((b"<?xml", b"<svg", b"<!--", b"<!doctype svg")) and b"<svg" in head


def svg_aspect(data):
    """Width / height of the drawing, from its viewBox or its width and height; 3.0 when neither is readable."""
    root = re.search(rb"<svg\b[^>]*>", bytes(data[:8192]), flags=re.I | re.S)
    tag = root.group(0) if root else b""
    box = re.search(rb'viewBox\s*=\s*["\']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)', tag, flags=re.I)
    try:
        if box and float(box.group(2)) > 0:
            return float(box.group(1)) / float(box.group(2))
        width = re.search(rb'\bwidth\s*=\s*["\']\s*([\d.]+)', tag)
        height = re.search(rb'\bheight\s*=\s*["\']\s*([\d.]+)', tag)
        if width and height and float(height.group(1)) > 0:
            return float(width.group(1)) / float(height.group(1))
    except ValueError:
        pass
    return 3.0


def _recompress(png):
    """The same pixels, deflated. wkhtmltoimage writes its PNG UNCOMPRESSED (Qt's writer at quality 94).

    Measured on the clone: a 960 x 160 logo came back as 615 650 bytes — exactly width x height x 4 plus headers —
    and the proposal's logo limit is 512 kB, so a perfectly good rendering was refused one step later and the PDF
    kept printing the company name. PIL is a hard dependency of Odoo itself, so it is always here; if it were not,
    the uncompressed PNG is returned and the size check decides, exactly as before.
    """
    try:
        from PIL import Image
    except ImportError:
        return png
    try:
        with Image.open(io.BytesIO(png)) as image:
            buffer = io.BytesIO()
            image.save(buffer, format="PNG", optimize=True)
        smaller = buffer.getvalue()
    except (OSError, ValueError) as exc:
        _logger.warning("Rasterised SVG logo could not be recompressed (%s); keeping it as rendered", exc)
        return png
    return smaller if len(smaller) < len(png) else png


def svg_to_png(data, *, height=TARGET_HEIGHT, timeout=20):
    """PNG bytes of the SVG at `height` pixels (width follows the drawing), or None. Never raises."""
    if not data or not is_svg(data):
        return None
    key = (hashlib.sha256(bytes(data)).hexdigest(), height)
    if key in _CACHE:
        return _CACHE[key]
    binary = shutil.which("wkhtmltoimage")
    if not binary:
        _logger.info("SVG logo not rasterised: wkhtmltoimage is not installed; the proposal prints the company name")
        return None
    aspect = min(max(svg_aspect(data), 0.2), 12.0)
    width = max(1, min(MAX_WIDTH, round(height * aspect)))
    height = max(1, round(width / aspect)) if width == MAX_WIDTH else height
    source = base64.b64encode(bytes(data)).decode("ascii")
    page = ("<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;padding:0;background:transparent;"
            f"width:{width}px;height:{height}px;overflow:hidden}}img{{display:block;width:{width}px;height:{height}px}}"
            f"</style></head><body><img src='data:image/svg+xml;base64,{source}'></body></html>")
    try:
        with tempfile.TemporaryDirectory(prefix="cs-prefab-logo-") as folder:
            html_path, png_path = Path(folder) / "logo.html", Path(folder) / "logo.png"
            html_path.write_text(page, encoding="utf-8")
            completed = subprocess.run(
                [binary, "--quiet", "--format", "png", "--transparent", "--disable-javascript",
                 "--disable-smart-width", "--width", str(width), "--height", str(height),
                 str(html_path), str(png_path)],
                capture_output=True, timeout=timeout, check=False)
            png = png_path.read_bytes() if png_path.is_file() else b""
    except (OSError, subprocess.SubprocessError) as exc:
        _logger.warning("SVG logo could not be rasterised (%s); the proposal prints the company name", exc)
        return None
    if completed.returncode not in (0, 1) or not png.startswith(b"\x89PNG\r\n\x1a\n"):
        # wkhtmltoimage exits 1 on harmless network warnings, so 1 with a real PNG is a success.
        _logger.warning("SVG logo could not be rasterised (exit %s: %s); the proposal prints the company name",
                        completed.returncode, completed.stderr[-300:])
        return None
    png = _recompress(png)
    if len(_CACHE) >= _CACHE_LIMIT:
        _CACHE.clear()
    _CACHE[key] = png
    return png

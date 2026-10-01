"""Render the cs_prefab_website pages to static HTML so a browser can be pointed at them.

WHY THIS EXISTS. There is no Odoo runtime on this machine, and "the page renders" is not a
claim that survives being made without looking. This script takes the module's own QWeb
templates, its own stylesheet and its own images, and turns them into files Chromium can open
-- so heading order, alt text, link targets, colour contrast, responsive behaviour, axe and
page weight are measured on the real markup instead of asserted about it.

WHAT IT PROVES, AND WHAT IT DOES NOT. Everything below comes from the module: the markup is
the module's templates, the stylesheet is the module's SCSS compiled by dart-sass, the images
are the module's files at the sizes the templates request, and the surrounding CSS is the LIVE
`web.assets_frontend` bundle downloaded from the target instance. What is scaffolding, and is
marked as such wherever it appears:

* the header. Odoo renders it from the website's own menu records and header template; the
  preview draws a representative one from the same menu tree the bootstrap writes, so the page
  has a navigation landmark and the screenshots are worth looking at.
* the colour-combination rules (`o_cc1`..`o_cc5`) and the button colours. The live bundle
  carries the values of the palette that is selected TODAY on the target; the preview
  regenerates them from this module's palette file, which is the palette the bootstrap
  selects. Same source, different moment.
* the records. Projects come from data/projects.json and posts from data/blog_data.xml, read
  as files rather than through the ORM.
* the two blog posts. What this module owns in a post is its `content` body and its meta
  title and description; the frame around it is Odoo's own `website_blog` template, which
  this module does not ship and which cannot render without Odoo. The preview therefore puts
  the body inside this site's header, footer and stylesheet, under an `<h1>` carrying the post
  name -- which is what `website_blog.blog_post_complete` renders there too. So the axe and
  heading-order verdict on `blog-*.html` is a verdict on THE BODY, in this site's CSS. Whether
  Odoo's surrounding blog chrome is itself clean is not this script's claim and stays for the
  clone test.

So: this verifies the module's own work. It does not verify Odoo's theme, Odoo's editor, or
anything that only exists once the module is installed. The Odoo-side tests do that, and they
run for the first time in the clone test.

USAGE
    python scripts/preview_website.py [--out <dir>]

Requires dart-sass (``npm install sass``) and Pillow; it says so and stops if either is absent.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "addons" / "cs_prefab_website"
DEFAULT_OUT = ROOT / "docs" / "verification" / "website" / "preview"

VIEW_FILES = [
    "views/layout_templates.xml",
    "views/seo_templates.xml",
    "views/snippets/s_prefab_usp.xml",
    "views/snippets/s_prefab_diensten.xml",
    "views/snippets/s_prefab_hotspots.xml",
    "views/news_templates.xml",
    "views/page_home.xml",
    "views/page_oplossingen.xml",
    "views/page_overige.xml",
    "views/project_templates.xml",
    "views/offerte_templates.xml",
]

# De menuboom uit models/website.py. Eén bron zou beter zijn; dit script leest hem daarom
# terug uit dat bestand in plaats van hem over te typen -- zie _menu_tree().
MENU_SOURCE = MODULE / "models" / "website.py"

PAGES = [
    ("home", "cs_prefab_website.page_home", "/"),
    ("over-ons", "cs_prefab_website.page_over_ons", "/over-ons"),
    ("oplossingen", "cs_prefab_website.page_oplossingen", "/oplossingen"),
    ("prefab-aanbouw", "cs_prefab_website.page_prefab_aanbouw", "/oplossingen/prefab-aanbouw"),
    ("prefab-dakkapel", "cs_prefab_website.page_prefab_dakkapel", "/oplossingen/prefab-dakkapel"),
    ("prefab-opbouw", "cs_prefab_website.page_prefab_opbouw", "/oplossingen/prefab-opbouw"),
    ("projecten", "cs_prefab_website.projects_index", "/projecten"),
    ("partner-worden", "cs_prefab_website.page_partner_worden", "/partner-worden"),
    ("contact", "cs_prefab_website.page_contact", "/contact"),
    ("nieuws", "cs_prefab_website.news_index", "/nieuws"),
    ("offerte", "cs_prefab_website.offerte_page", "/offerte"),
    ("offerte-prefab-opbouw", "cs_prefab_website.offerte_opbouw_page", "/offerte-prefab-opbouw"),
]

MEDIA_DIRS = ["static/src/media", "static/src/video", "static/src/pdf", "static/src/img"]


# ----------------------------------------------------------------------------
# Kleine recordvervangers
# ----------------------------------------------------------------------------

class Record(dict):
    """A dict that also answers attribute access, so QWeb-ish expressions read naturally."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)

    def __bool__(self):
        return bool(self.get("_truthy", True))


class _MissingIsNone(dict):
    """The namespace QWeb expressions are evaluated in: an unknown name is None, not an error."""

    def __missing__(self, key):
        return None


# ----------------------------------------------------------------------------
# Mini-QWeb
# ----------------------------------------------------------------------------

QWEB_NS = "{http://www.w3.org/1999/xhtml}"
ATTF_RE = re.compile(r"#\{(.+?)\}|\{\{(.+?)\}\}")


class Renderer:
    """Just enough QWeb to render this module's own templates.

    Deliberately small and deliberately strict about what it does NOT understand: an unknown
    directive raises instead of being skipped, because a preview that silently drops a section
    is worse than no preview -- it would report a page as fine that a visitor sees as broken.
    """

    SUPPORTED = {
        "t-call", "t-if", "t-elif", "t-else", "t-foreach", "t-as", "t-out", "t-esc", "t-raw",
        "t-set", "t-value", "t-options", "t-ignore", "t-translation",
    }

    def __init__(self, templates, media_url, missing):
        self.templates = templates
        self.media_url = media_url
        self.missing = missing

    def render(self, xmlid, context):
        node = self.templates.get(xmlid)
        if node is None:
            raise KeyError("unknown template: %s" % xmlid)
        return "".join(self._children(node, context))

    # -- helpers ---------------------------------------------------------

    def _eval(self, expression, context):
        """Evaluate one QWeb expression.

        `eval` with a controlled namespace, in a developer script that only ever reads this
        repository's own templates -- there is no visitor input anywhere near it. The context
        is a dict subclass whose __missing__ returns None, because that is what QWeb itself
        does: core templates rely on `t-if="pager"` being falsy on pages that never pass one,
        and a NameError here would have silently dropped every guarded section.
        """
        scope = _MissingIsNone(context)
        scope["__builtins__"] = {"len": len, "str": str, "int": int, "dict": dict}
        try:
            return eval(expression, scope)  # noqa: S307 - see docstring
        except Exception:
            return None

    def _children(self, node, context):
        out = [html.escape(node.text) if node.text else ""]
        skip_until_end_of_chain = False
        for child in node:
            if child.get("t-elif") is not None or child.get("t-else") is not None:
                if skip_until_end_of_chain:
                    out.append(html.escape(child.tail) if child.tail else "")
                    continue
            rendered, taken = self._node_with_state(child, context)
            out.extend(rendered)
            if child.get("t-if") is not None:
                skip_until_end_of_chain = taken
            elif child.get("t-elif") is not None:
                skip_until_end_of_chain = skip_until_end_of_chain or taken
            elif child.get("t-else") is None:
                skip_until_end_of_chain = False
            out.append(html.escape(child.tail) if child.tail else "")
        return out

    def _node_with_state(self, node, context):
        if node.get("t-if") is not None:
            if not self._eval(node.get("t-if"), context):
                return [], False
        elif node.get("t-elif") is not None:
            if not self._eval(node.get("t-elif"), context):
                return [], False
        return self._node(node, context), True

    def _node(self, node, context):
        if isinstance(node, etree._Comment):
            return []
        for key in node.attrib:
            if key.startswith("t-") and key not in self.SUPPORTED and not key.startswith(
                    ("t-att-", "t-attf-", "t-snippet", "t-thumbnail")):
                raise ValueError("unsupported directive %s on <%s>" % (key, node.tag))

        if node.get("t-foreach") is not None:
            return self._foreach(node, context)
        if node.get("t-set") is not None:
            self._set(node, context)
            return []
        if node.get("t-call") is not None:
            return self._call(node, context)

        tag = node.tag
        if tag == "t":
            body = self._body_or_out(node, context)
            return body

        attrs = self._attributes(node, context)
        opening = "<%s%s>" % (tag, attrs)
        if node.get("t-out") is not None or node.get("t-esc") is not None:
            value = self._eval(node.get("t-out") or node.get("t-esc"), context)
            inner = self._format(value, node.get("t-options"))
        else:
            inner = "".join(self._children(node, context))
        return [opening, inner, "</%s>" % tag]

    def _body_or_out(self, node, context):
        if node.get("t-out") is not None or node.get("t-esc") is not None:
            value = self._eval(node.get("t-out") or node.get("t-esc"), context)
            text = self._format(value, node.get("t-options"))
            if not text and (node.text or len(node)):
                # QWeb falls back to the element body when the value is empty.
                return self._children(node, context)
            return [text]
        return self._children(node, context)

    # De maanden waar Odoo's datumconverter onder nl_NL mee terugkomt. Ze staan hier zodat de
    # voorbeeldweergave dezelfde datum toont als de echte pagina; zonder dit toonde de
    # screenshot 2025-03-07 terwijl de template om "d MMMM yyyy" vraagt, en dan wordt een
    # ontwerpbeslissing beoordeeld op een weergave die nergens bestaat.
    DUTCH_MONTHS = ("januari", "februari", "maart", "april", "mei", "juni",
                    "juli", "augustus", "september", "oktober", "november", "december")

    def _format(self, value, options):
        if value is None or value is False:
            return ""
        if options and "date" in options:
            iso = str(value)[:10]
            if "MMMM" in (options or ""):
                try:
                    year, month, day = (int(part) for part in iso.split("-"))
                    return html.escape("%d %s %d" % (day, self.DUTCH_MONTHS[month - 1], year))
                except (ValueError, IndexError):
                    return html.escape(iso)
            return html.escape(iso)
        if isinstance(value, str) and value.lstrip().startswith("<"):
            return value  # html field, already markup
        return html.escape(str(value))

    def _set(self, node, context):
        name = node.get("t-set")
        if node.get("t-value") is not None:
            context[name] = self._eval(node.get("t-value"), context)
        else:
            context[name] = "".join(self._children(node, context))

    def _call(self, node, context):
        target = node.get("t-call")
        inner = dict(context)
        for child in node:
            if child.get("t-set") is not None:
                self._set(child, inner)
        if target.startswith("cs_prefab_website."):
            return ["".join(self._children(self.templates[target], inner))]
        if target == "website.pager":
            return [self._pager(inner.get("pager"))]
        if target == "website.layout":
            # De schil eromheen levert de voorbeeldweergave zelf; wat hier telt is de inhoud
            # die de pagina aan de layout meegeeft — in QWeb is dat `0`, hier zijn dat gewoon
            # de kinderen van deze <t>.
            return ["".join(self._children(node, inner))]
        return ["<!-- t-call %s (voorbeeldweergave: buiten dit module) -->" % target]

    @staticmethod
    def _pager(pager):
        if not pager or pager.get("page_count", 1) <= 1:
            return ""
        return '<nav aria-label="Paginering"><ul class="pagination"></ul></nav>'

    def _foreach(self, node, context):
        values = self._eval(node.get("t-foreach"), context) or []
        alias = node.get("t-as")
        out = []
        for index, item in enumerate(values):
            scope = dict(context)
            scope[alias] = item
            scope[alias + "_index"] = index
            scope[alias + "_first"] = index == 0
            scope[alias + "_last"] = index == len(values) - 1
            clone = etree.fromstring(etree.tostring(node))
            clone.attrib.pop("t-foreach", None)
            clone.attrib.pop("t-as", None)
            out.extend(self._node(clone, scope))
        return out

    def _attributes(self, node, context):
        attrs = {}
        for key, value in node.attrib.items():
            if key.startswith("t-att-"):
                result = self._eval(value, context)
                if result not in (None, False):
                    attrs[key[6:]] = str(result)
            elif key.startswith("t-attf-"):
                def replace(match):
                    expression = match.group(1) or match.group(2)
                    result = self._eval(expression, context)
                    return "" if result in (None, False) else str(result)
                attrs[key[7:]] = ATTF_RE.sub(replace, value)
            elif not key.startswith("t-"):
                attrs[key] = value
        for key in ("src", "href", "poster", "data-prefab-hero-video"):
            if key in attrs:
                attrs[key] = self.media_url(attrs[key])
        if "srcset" in attrs:
            attrs["srcset"] = ", ".join(
                " ".join([self.media_url(part.split(" ")[0])] + part.split(" ")[1:])
                for part in (candidate.strip() for candidate in attrs["srcset"].split(","))
                if part)
        if "style" in attrs:
            attrs["style"] = re.sub(
                r"url\('([^']+)'\)",
                lambda m: "url('%s')" % self.media_url(m.group(1)),
                attrs["style"])
        return "".join(' %s="%s"' % (k, html.escape(v, quote=True)) for k, v in attrs.items())


# ----------------------------------------------------------------------------
# Media
# ----------------------------------------------------------------------------

def slug(filename):
    stem = "".join(c if c.isalnum() else "_" for c in filename.lower())
    return "media_%s_%s" % (stem, hashlib.sha1(filename.encode()).hexdigest()[:8])


class Media:
    """Resolve the URLs the templates use to real files, at the size they ask for."""

    WEB_IMAGE = re.compile(r"^/web/image/cs_prefab_website\.(?P<slug>[\w]+)"
                           r"(?:/(?P<w>\d+)x(?P<h>\d+))?(?:/(?P<name>[^/?]+))?$")
    WEB_CONTENT = re.compile(r"^/web/content/cs_prefab_website\.(?P<slug>[\w]+)"
                             r"(?:/(?P<name>[^/?]+))?$")
    STATIC = re.compile(r"^/cs_prefab_website/(?P<path>static/.+?)(?:\?.*)?$")
    PROJECT_IMAGE = re.compile(r"^/web/image/cs\.prefab\.project\.image/(?P<id>\d+)/image"
                               r"(?:/(?P<w>\d+)x(?P<h>\d+))?$")

    def __init__(self, out_dir, project_images):
        self.out = out_dir
        self.assets = out_dir / "assets"
        self.assets.mkdir(parents=True, exist_ok=True)
        self.by_slug = {}
        self.missing = []
        self.project_images = project_images
        for directory in MEDIA_DIRS:
            for path in sorted((MODULE / directory).glob("*")):
                if path.is_file():
                    self.by_slug[slug(path.name)] = path
        # The media index keys attachments on the ORIGINAL filename, which differs from the
        # shipped one exactly where a file was re-encoded (logo-2.gif -> logo-2.webp).
        index = json.loads((MODULE / "data" / "media_index.json").read_text(encoding="utf-8"))
        for entry in index["files"]:
            shipped = entry.get("shipped")
            if shipped:
                self.by_slug[slug(entry["filename"])] = MODULE / shipped["path"]

    def url(self, value):
        if not value or not value.startswith(("/web/", "/cs_prefab_website/")):
            return value
        match = self.PROJECT_IMAGE.match(value)
        if match:
            source = self.project_images.get(int(match.group("id")))
            if not source:
                self.missing.append(value)
                return value
            return self._copy(source, match.group("w"), match.group("h"))
        match = self.WEB_IMAGE.match(value) or self.WEB_CONTENT.match(value)
        if match:
            source = self.by_slug.get(match.group("slug"))
            if not source:
                self.missing.append(value)
                return value
            groups = match.groupdict()
            return self._copy(source, groups.get("w"), groups.get("h"))
        match = self.STATIC.match(value)
        if match:
            source = MODULE / match.group("path")
            if not source.exists():
                self.missing.append(value)
                return value
            return self._copy(source, None, None)
        self.missing.append(value)
        return value

    def _copy(self, source, width, height):
        suffix = source.suffix.lower()
        # Root-relatief. Met "assets/x.jpg" wijst een pagina op /projecten/<slug> naar
        # /projecten/assets/x.jpg, en dan laadt geen enkele afbeelding op de detailpagina --
        # inclusief het script, dat dan HTML terugkrijgt en met "Unexpected token '<'" valt.
        if width and height and suffix in (".jpg", ".jpeg", ".png", ".webp"):
            name = "%s-%sx%s%s" % (source.stem, width, height, suffix)
            target = self.assets / name
            if not target.exists():
                self._resize(source, target, int(width), int(height))
            return "/assets/" + name
        target = self.assets / source.name
        if not target.exists():
            shutil.copyfile(source, target)
        return "/assets/" + source.name

    @staticmethod
    def _resize(source, target, width, height):
        """Fit inside the requested box, preserving the ratio -- what /web/image does.

        Animated images are copied untouched: resizing one yields its first frame, and the
        animation would be gone without anything looking wrong.
        """
        from PIL import Image
        with Image.open(source) as image:
            if getattr(image, "n_frames", 1) > 1:
                shutil.copyfile(source, target)
                return
            image.thumbnail((width, height), Image.LANCZOS)
            if image.mode in ("RGBA", "P") and target.suffix.lower() in (".jpg", ".jpeg"):
                image = image.convert("RGB")
            image.save(target, quality=82, optimize=True)


# ----------------------------------------------------------------------------
# Records
# ----------------------------------------------------------------------------

def load_gallery():
    """De galerij: één platte lijst foto's, in de volgorde van data/projects.json.

    Dezelfde volgorde als ``cs.prefab.project._gallery_photos`` in Odoo oplevert -- eerst op
    ``sequence`` van de reeks, daarbinnen op ``sequence`` van de foto -- want dat is hoe de
    twee elkaar controleren: als de ene ooit anders sorteert dan de andere, verschilt de
    voorbeeldweergave zichtbaar van de echte pagina.

    Naam, jaar en verhaal komen NIET uit dit bestand: de bron draagt ze niet, dus de records
    worden leeg aangemaakt. Plaats staat er twee keer wel.
    """
    spec = json.loads((MODULE / "data" / "projects.json").read_text(encoding="utf-8"))
    photos, images, next_id = [], {}, 1
    for series_index, entry in enumerate(
            sorted(spec["projects"], key=lambda item: item.get("sequence", 10)), start=1):
        series = Record(
            id=series_index,
            name="",
            location=entry.get("location") or "",
            year=0,
            story="",
        )
        series["_meta_line"] = lambda record=series: " \u00b7 ".join(
            part for part in (record["name"], record["location"],
                              str(record["year"]) if record["year"] else "") if part)
        for filename, alt in entry["images"]:
            images[next_id] = MODULE / "static" / "src" / "media" / filename
            photos.append(Record(id=next_id, alt=alt, project_id=series))
            next_id += 1
    return photos, images


def load_posts():
    tree = etree.parse(str(MODULE / "data" / "blog_data.xml"))
    posts = []
    for record in tree.iter("record"):
        if record.get("model") != "blog.post":
            continue
        fields = {f.get("name"): f for f in record.iter("field")}
        cover = (fields["cover_properties"].text or "").strip()
        image = ""
        match = re.search(r"url\(([^)]+)\)", cover)
        if match:
            image = match.group(1)
        date = (fields["published_date"].get("eval") or "").strip("'")
        content = fields["content"]
        body = "".join(etree.tostring(c, encoding="unicode") for c in content)
        post = Record(
            name=fields["name"].text,
            teaser=(fields["teaser_manual"].text or "").strip(),
            published_date=date,
            website_url="/blog/nieuws-1/%s" % re.sub(r"[^a-z0-9]+", "-", fields["name"].text.lower()).strip("-"),
            blog_id=Record(name="Nieuws"),
            content=body,
        )
        post["_cs_prefab_cover_image"] = (
            lambda size=None, url=image: re.sub(r"/\d+x\d+/", "/%s/" % size, url, count=1)
            if size else url)
        posts.append(post)
    posts.sort(key=lambda p: p["published_date"], reverse=True)
    return posts


def menu_tree():
    """Read the navigation back out of models/website.py rather than retyping it."""
    source = MENU_SOURCE.read_text(encoding="utf-8")
    block = re.search(r"MENU_TREE = (\[.*?\n\])", source, re.S)
    return eval(block.group(1), {"__builtins__": {}}, {})


# ----------------------------------------------------------------------------
# Schil
# ----------------------------------------------------------------------------

def template_map():
    templates = {}
    for relative in VIEW_FILES:
        tree = etree.parse(str(MODULE / relative))
        for node in tree.getroot().iter("template"):
            if node.get("inherit_id"):
                continue
            templates["cs_prefab_website." + node.get("id")] = node
    return templates


def footer_html(templates, renderer, context):
    tree = etree.parse(str(MODULE / "views" / "layout_templates.xml"))
    for node in tree.getroot().iter("template"):
        if node.get("id") == "prefab_footer":
            branch = node.find(".//t[@t-if]")
            if branch is None:
                return ""
            return "".join(renderer._children(branch, dict(context)))
    return ""


def whatsapp_html():
    tree = etree.parse(str(MODULE / "views" / "layout_templates.xml"))
    for node in tree.getroot().iter("template"):
        if node.get("id") == "prefab_whatsapp":
            # Het hele blok, inclusief de <div role="complementary"> eromheen. Alleen de <a>
            # pakken leverde een zwevende link zonder landmark op -- en dan meldt axe hier iets
            # dat in de echte site niet bestaat, wat een gate onbetrouwbaar maakt.
            wrapper = node.find(".//xpath/div")
            if wrapper is None:
                return ""
            wrapper.attrib.pop("t-if", None)
            return etree.tostring(wrapper, encoding="unicode")
    return ""


def structured_data_html():
    tree = etree.parse(str(MODULE / "views" / "seo_templates.xml"))
    for node in tree.getroot().iter("template"):
        if node.get("id") == "prefab_structured_data":
            script = node.find(".//script")
            return etree.tostring(script, encoding="unicode")
    return ""


def header_html(menu, active_url, media):
    """PREVIEW SCAFFOLDING. Odoo draws the header from its own template and the website's menu
    records; this is a representative stand-in built from the same menu tree the bootstrap
    writes, so the screenshots show a page and not a floating column of sections."""
    items = []
    for entry in menu:
        if entry["url"] == "/offerte":
            continue
        children = entry.get("children") or []
        current = ' aria-current="page"' if entry["url"] == active_url else ""
        if children:
            links = "".join(
                '<li><a class="dropdown-item" href="%s">%s</a></li>' % (c["url"], html.escape(c["name"]))
                for c in children)
            items.append(
                '<li class="nav-item dropdown"><a class="nav-link" href="%s"%s>%s</a>'
                '<ul class="dropdown-menu">%s</ul></li>'
                % (entry["url"], current, html.escape(entry["name"]), links))
        else:
            items.append('<li class="nav-item"><a class="nav-link" href="%s"%s>%s</a></li>'
                         % (entry["url"], current, html.escape(entry["name"])))
    logo = media.url("/cs_prefab_website/static/src/media/logo-prefab_partner.svg")
    return (
        '<header id="top" class="o_prefab_header o_header_standard_preview">'
        '<nav class="navbar navbar-expand-lg container" aria-label="Hoofdnavigatie">'
        '<a class="navbar-brand" href="/"><img src="%s" alt="Prefab Partner" width="170" height="48"/></a>'
        '<button class="navbar-toggler" type="button" aria-expanded="false" aria-label="Menu openen">'
        '<span class="navbar-toggler-icon"></span></button>'
        '<ul class="top_menu navbar-nav ms-auto">%s</ul>'
        '<a class="btn btn-primary ms-lg-3" href="/offerte">Ontwerp je aanbouw</a>'
        '</nav></header>' % (logo, "".join(items)))


PREVIEW_ENTRY_SCSS = """
// Voorbeeldweergave-schil. GEEN onderdeel van het module.
//
// Vier shims zodat de SCSS van het module zonder Bootstrap en zonder Odoo compileert, plus
// een generator die de kleurcombinaties uit HETZELFDE paletbestand afleidt dat de bootstrap
// selecteert. De live bundel die ernaast wordt geladen draagt de combinaties van het palet dat
// vandaag op het doel staat; deze regels zetten ze op het palet van dit module.
$o-color-palettes: ();
$o-selected-color-palettes-names: ();
$zindex-sticky: 1020;
$zindex-fixed: 1030;
$zindex-modal: 1055;

$grid-breakpoints: (xs: 0, sm: 576px, md: 768px, lg: 992px, xl: 1200px, xxl: 1400px);

@mixin media-breakpoint-up($name) {
    @media (min-width: map-get($grid-breakpoints, $name)) { @content; }
}
@mixin media-breakpoint-down($name) {
    @media (max-width: map-get($grid-breakpoints, $name) - .02px) { @content; }
}

@import "palette";
@import "site";

$preview-palette: map-get($o-color-palettes, 'prefabpartner');

@each $index in (1, 2, 3, 4, 5) {
    .o_prefab_site .o_cc#{$index} {
        background-color: map-get($preview-palette, 'o-cc#{$index}-bg');
        color: map-get($preview-palette, 'o-cc#{$index}-text');

        h1, h2, h3, h4, h5, h6 { color: map-get($preview-palette, 'o-cc#{$index}-headings'); }
        a:not(.btn) { color: map-get($preview-palette, 'o-cc#{$index}-link'); }
    }
}

.o_prefab_site {
    background-color: map-get($preview-palette, 'o-cc1-bg');
    color: map-get($preview-palette, 'o-cc1-text');

    a:not(.btn) { color: map-get($preview-palette, 'o-cc1-link'); }

    .btn-primary {
        background-color: map-get($preview-palette, 'o-color-1');
        border-color: map-get($preview-palette, 'o-color-1');
        color: #FFFFFF;
    }

    .btn-secondary {
        background-color: map-get($preview-palette, 'o-color-5');
        border-color: map-get($preview-palette, 'o-color-5');
        color: #FFFFFF;
    }

    .btn-outline-secondary {
        border-color: map-get($preview-palette, 'o-color-5');
        color: map-get($preview-palette, 'o-color-5');
        background-color: transparent;
    }

    .o_header_standard_preview {
        background-color: #FFFFFF;
        box-shadow: 0 1px 0 rgba(0, 0, 0, .1);

        .nav-link { color: #1A1A1A; text-decoration: none; padding: .5rem .85rem; display: block; }
        .nav-link:hover { color: map-get($preview-palette, 'o-color-1'); }
        .navbar { display: flex; align-items: center; gap: 1rem; padding: .75rem 0; }
        .navbar-nav { display: flex; list-style: none; margin: 0; padding: 0; }
        .dropdown-menu { display: none; }
        .navbar-toggler { display: none; }
    }
}

@media (max-width: 991.98px) {
    .o_prefab_site .o_header_standard_preview {
        .navbar-nav { display: none; }
        .navbar-toggler { display: inline-flex; align-items: center; justify-content: center;
            width: 44px; height: 44px; border: 1px solid #1A1A1A; background: transparent;
            border-radius: 4px; }
        .navbar-toggler-icon { display: block; width: 20px; height: 2px; background: #1A1A1A;
            box-shadow: 0 -6px 0 #1A1A1A, 0 6px 0 #1A1A1A; }
    }
}
"""

def blog_body_html(post, media):
    """The post body inside a minimal, faithful stand-in for Odoo's blog post template.

    Only three things are asserted about the frame: a `<main id="wrap">` landmark, an `<h1>`
    carrying the post name, and the publication date -- all three of which
    `website_blog.blog_post_complete` renders as well. Everything else on a real blog post
    (cover, author, share bar, previous/next) is Odoo's and is deliberately absent rather than
    guessed at, because a guess would be axe-checked as if it were the product.
    """
    iso = str(post["published_date"])[:10]
    try:
        year, month, day = (int(part) for part in iso.split("-"))
        date_text = "%d %s %d" % (day, Renderer.DUTCH_MONTHS[month - 1], year)
    except (ValueError, IndexError):
        date_text = iso
    # De inhoud draagt /web/image-adressen; zonder deze herschrijving laadt geen enkele
    # afbeelding in het bericht en meet de gewichtscontrole een pagina die niet bestaat.
    content = re.sub(r'(src|href)="(/web/[^"]+)"',
                     lambda m: '%s="%s"' % (m.group(1), media.url(m.group(2))),
                     post["content"])
    # Dezelfde omhulling als elke andere pagina van dit module (en van Odoo zelf):
    # <div id="wrap" class="oe_page_wrap" role="main">. Met een <main>-element zou de
    # landmarkcontrole op dit bestand iets anders meten dan op de twaalf andere pagina's, en
    # dan vergelijkt de poort twee dingen die niet hetzelfde zijn.
    return (
        '<div id="wrap" class="oe_page_wrap" role="main" tabindex="-1">'
        '<div class="oe_structure"><section class="s_text_block pt40 pb40">'
        '<div class="container o_prefab_measure">'
        '<h1>%s</h1>'
        '<p class="o_prefab_meta"><time datetime="%s">%s</time> | %s</p>'
        '%s'
        '</div></section></div></div>'
    ) % (html.escape(post["name"]), html.escape(iso), html.escape(date_text),
         html.escape(post["blog_id"]["name"]), content)


PAGE_SHELL = """<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{title}</title>
<meta name="description" content="{description}"/>
<link rel="stylesheet" href="/odoo-frontend.css"/>
<link rel="stylesheet" href="/prefab-preview.css"/>
{structured}
</head>
<body class="o_prefab_site">
<a class="o_prefab_skip_link" href="#wrap">Direct naar de inhoud</a>
<div id="wrapwrap">
{header}
{body}
<footer>{footer}</footer>
{whatsapp}
</div>
<script src="/prefab_site.js"></script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    photos, project_images = load_gallery()
    posts = load_posts()
    media = Media(out, project_images)
    templates = template_map()
    renderer = Renderer(templates, media.url, media.missing)
    menu = menu_tree()

    website = Record(cs_prefab_site=True, id=2, name="Prefab Partner")
    website["_cs_prefab_recent_posts"] = lambda limit=2: posts[:limit]

    meta = json.loads(_page_meta())

    shared = {
        "website": website,
        "request": Record(),
        "posts": posts,
        "photos": photos,
        "pager": None,
    }

    written = []
    for name, xmlid, url in PAGES:
        context = dict(shared)
        if xmlid.endswith("projects_index"):
            # De galerij krijgt haar aantal van de controller en niet uit `len()` in het
            # sjabloon: de naamruimte hieronder maakt van een onbekende naam None, en `len` is
            # daarin dus ook None. Alleen deze pagina krijgt hem, want `total` betekent op
            # /nieuws iets anders.
            context["total"] = len(photos)
        body = renderer.render(xmlid, context)
        page_meta = meta.get(url, {})
        html_text = PAGE_SHELL.format(
            title=html.escape(page_meta.get("title", "Prefab Partner")),
            description=html.escape(page_meta.get("description", "")),
            structured=structured_data_html(),
            header=header_html(menu, url, media),
            body=body,
            footer='<div id="footer" class="o_prefab_footer">%s</div>'
                   % footer_html(templates, renderer, shared),
            whatsapp=whatsapp_html(),
            depth="",
        )
        target = out / ("%s.html" % name)
        target.write_text(html_text, encoding="utf-8")
        written.append(target.name)

    # De twee nieuwsberichten. Ze staan niet in PAGES omdat ze geen `website.page` zijn maar
    # `blog.post`-records; zonder deze lus kijkt geen enkele poort ooit naar de tekst die op
    # het best vindbare adres van de site staat.
    post_meta = _post_meta()
    for post in posts:
        slug_name = post["website_url"].rstrip("/").rsplit("/", 1)[-1]
        item = post_meta.get(post["name"], {})
        html_text = PAGE_SHELL.format(
            title=html.escape(item.get("title", post["name"])),
            description=html.escape(item.get("description", "")),
            structured=structured_data_html(),
            header=header_html(menu, "/nieuws", media),
            body=blog_body_html(post, media),
            footer='<div id="footer" class="o_prefab_footer">%s</div>'
                   % footer_html(templates, renderer, shared),
            whatsapp=whatsapp_html(),
            depth="",
        )
        target = out / ("blog-%s.html" % slug_name)
        target.write_text(html_text, encoding="utf-8")
        written.append(target.name)

    _write_styles(out)
    shutil.copyfile(MODULE / "static" / "src" / "js" / "prefab_site.js", out / "prefab_site.js")

    report = {
        "pages": written,
        "missing_urls": sorted(set(media.missing)),
        "assets": len(list((out / "assets").glob("*"))),
    }
    (out / "preview-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 1 if report["missing_urls"] else 0


def _post_meta():
    """Title and description per blog post, read back out of data/blog_data.xml."""
    tree = etree.parse(str(MODULE / "data" / "blog_data.xml"))
    meta = {}
    for record in tree.iter("record"):
        if record.get("model") != "blog.post":
            continue
        fields = {f.get("name"): (f.text or "") for f in record.iter("field")}
        meta[fields.get("name", "")] = {
            "title": fields.get("website_meta_title", ""),
            "description": fields.get("website_meta_description", ""),
        }
    return meta


def _page_meta():
    """Title and description per page, read back out of data/page_data.xml."""
    tree = etree.parse(str(MODULE / "data" / "page_data.xml"))
    meta = {}
    for record in tree.iter("record"):
        if record.get("model") != "website.page":
            continue
        fields = {f.get("name"): (f.text or "") for f in record.iter("field")}
        meta[fields.get("url", "")] = {
            "title": fields.get("website_meta_title", ""),
            "description": fields.get("website_meta_description", ""),
        }
    tree = etree.parse(str(MODULE / "views" / "offerte_templates.xml"))
    for record in tree.iter("record"):
        if record.get("model") != "website.page":
            continue
        fields = {f.get("name"): (f.text or "") for f in record.iter("field")}
        meta[fields.get("url", "")] = {
            "title": fields.get("website_meta_title", ""),
            "description": fields.get("website_meta_description", ""),
        }
    # De twee controllerpagina's dragen hun titel en omschrijving in de controller.
    source = (MODULE / "controllers" / "main.py").read_text(encoding="utf-8")
    for url, block in (("/projecten", "PROJECTS_META"), ("/nieuws", "NEWS_META")):
        section = re.search(block + r" = \{(.*?)\n\}", source, re.S).group(1)
        title = re.search(r'"additional_title":\s*"([^"]+)"', section).group(1)
        description = "".join(re.findall(r'"([^"]*)"\)?\s*,?\s*$', section, re.M))
        meta[url] = {"title": "%s | Prefab Partner" % title, "description": description}
    return json.dumps(meta)


def _write_styles(out):
    scss_dir = MODULE / "static" / "src" / "scss"
    work = out / "_scss"
    work.mkdir(exist_ok=True)
    shutil.copyfile(scss_dir / "prefab_palette.scss", work / "_palette.scss")
    shutil.copyfile(scss_dir / "prefab_site.scss", work / "_site.scss")
    (work / "entry.scss").write_text(PREVIEW_ENTRY_SCSS, encoding="utf-8")
    sass = ROOT / "node_modules" / ".bin" / ("sass.cmd" if sys.platform == "win32" else "sass")
    if not sass.exists():
        raise SystemExit(
            "dart-sass ontbreekt. Installeer het met `npm install sass` en draai dit opnieuw; "
            "zonder compiler kan de voorbeeldweergave de stylesheet van het module niet tonen "
            "en zou de screenshot dus niets bewijzen.")
    subprocess.run([str(sass), "--no-source-map", "--style=expanded",
                    str(work / "entry.scss"), str(out / "prefab-preview.css")],
                   check=True, cwd=str(work))
    bundle = _live_bundle()
    target = out / "odoo-frontend.css"
    if bundle and bundle.exists():
        shutil.copyfile(bundle, target)
        # De bundel verwijst naar /web/assets/<hash>/web.fontawesome.min.woff2 en die fonts
        # dragen elk vinkje en elk icoon op de site. Zonder ze zijn de screenshots gaten in
        # plaats van iconen, en dan is de visuele controle niets waard.
        fonts = bundle.parent / "fonts"
        if fonts.exists():
            for source in fonts.iterdir():
                destination = out / Path(source.name.replace("__", "/"))
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    shutil.copyfile(source, destination)
    elif not target.exists():
        target.write_text("/* live web.assets_frontend bundle not available */",
                          encoding="utf-8")


def _live_bundle():
    """The compiled frontend bundle downloaded from the target, if this machine still has it.

    A path into a session scratchpad, so it is checked rather than assumed: without it the
    preview still renders the module's own stylesheet, and the report says the surrounding
    Odoo CSS was missing instead of quietly showing an unstyled page as if that were the
    design.
    """
    candidates = [
        Path("C:/Users/sukru/AppData/Local/Temp/claude/e--Projeler-cs-prefab-configurator/"
             "eb51b5bd-4fa1-4132-ae45-5df30ca3700b/scratchpad/site/odoo/"
             "web_assets_1_81d240e_web.assets_frontend.min.css"),
    ]
    return next((path for path in candidates if path.exists()), None)


if __name__ == "__main__":
    sys.exit(main())

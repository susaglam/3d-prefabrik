"""The two addresses that are lists of records rather than pages of copy.

``/projecten`` and ``/nieuws`` are controllers and every other page of this site is a
``website.page``. That split is deliberate and it is the only place in this module where a
visitor-facing address is not a page record, so the reason is written here rather than in a
commit message.

**Why not a page.** A ``website.page`` renders a template with no model behind it. To list
projects or posts it would have to query the database from inside ``arch_db`` -- an expression
that works today, is invisible to every static check, and breaks silently the day the context
of a page render changes. A controller puts the query in Python where a test can call it.

**Why not Odoo's Model Pages.** ``website.controller.page`` exists in this build and would give
the customer a builder-editable listing for free, but it builds its own address:
``/model/<name_slugified>``, written literally in ``_compute_url_demo`` and in ``write()``.
``/projecten`` is in the URL contract, so a Model Page would have put a redirect on the most
linked page of the site.

**What the customer can still edit.** Both templates carry ``oe_structure`` regions above and
below the list. The copy is theirs; the list is not deletable by accident. That is the same
trade the offerte pages make with the configurator frame.

**Both routes 404 on any other website of this instance.** Routes are global, records are not.
Without the guard the codesnap site would answer ``/projecten`` with an empty grid and would
carry it into its own sitemap.
"""
import werkzeug

from odoo import http
from odoo.http import request

POSTS_PER_PAGE = 10

# De titel en de omschrijving van de twee overzichtspagina's.
#
# Ze staan hier en niet in een record omdat deze twee adressen geen website.page zijn: er is
# dus geen veld waar de SEO-dialoog van Odoo ze in kwijt kan. `additional_title` is wat
# website.layout gebruikt als er geen expliciete titel is; `prefab_meta_description` en
# `prefab_og_image` worden opgepikt door views/seo_templates.xml.
#
# Op de live site is de omschrijving van /nieuws "Laatste nieuws en update" (24 tekens, en
# "update" hoort "updates" te zijn) en heeft /projecten wél een echte. Die laatste is
# letterlijk overgenomen.
PROJECTS_META = {
    "additional_title": "Projecten",
    "prefab_meta_description": (
        "Van stijlvolle aanbouwen tot functionele opbouwen: wij leveren kwaliteit op maat. "
        "Laat je inspireren en ontdek wat wij voor jou kunnen betekenen."),
    "prefab_og_image": ("/web/image/cs_prefab_website.media_prefab_aanbouw_01_webp_9f2f2f6c"
                        "/1200x900/Prefab-aanbouw-01.webp"),
}
NEWS_META = {
    "additional_title": "Nieuws",
    "prefab_meta_description": (
        "Nieuws en achtergronden over prefab bouwen: onze projecten, onze werkwijze en wat "
        "een prefab aanbouw, dakkapel of opbouw je oplevert."),
    "prefab_og_image": ("/web/image/cs_prefab_website.media_dakkapel_aanbouw_home_jpg_96efff00"
                        "/1200x686/Dakkapel-aanbouw-home.jpg"),
}


def _current_prefab_site(env):
    """The website this module owns, when that is the one being browsed.

    ``get_current_website()`` is what the request already resolved from the host, so this
    compares the browsed site against the flag rather than against a hard-coded id.
    """
    website = env["website"].get_current_website()
    return website if website and website.cs_prefab_site else env["website"].browse()


def sitemap_projects(env, rule, qs):
    """The gallery, once, in the sitemap of the site that owns it.

    One address and not thirty-seven: the gallery is one page. An earlier version gave every
    series its own ``/projecten/<slug>``, but an address is a name and the source carries no
    names -- see ``models/project.py``.

    A plain module-level function rather than a classmethod: Odoo stores whatever is passed to
    ``sitemap=`` and calls it, and a ``classmethod`` object is not callable until it is bound
    to a class, which never happens here.
    """
    website = _current_prefab_site(env)
    if not website:
        return
    if not qs or "/projecten".startswith(qs):
        yield {"loc": "/projecten"}


def sitemap_news(env, rule, qs):
    website = _current_prefab_site(env)
    if not website:
        return
    if not qs or "/nieuws".startswith(qs):
        yield {"loc": "/nieuws"}


class PrefabWebsite(http.Controller):

    @staticmethod
    def _site_or_404():
        website = _current_prefab_site(request.env)
        if not website:
            raise werkzeug.exceptions.NotFound()
        return website

    # ------------------------------------------------------------------
    # Projecten
    # ------------------------------------------------------------------

    @http.route(["/projecten"], type="http", auth="public",
                website=True, sitemap=sitemap_projects, readonly=True)
    def projects(self, **kwargs):
        """De galerij: alle gepubliceerde foto's, plat, in de volgorde van de oude site.

        Eén adres en geen pager. De oude pagina toonde zesendertig foto's op één adres en dat is
        wat dit adres blijft doen; wat de pagina licht houdt is niet minder foto's maar kleinere
        foto's die pas laden als je er bent (zie ``views/project_templates.xml``). Een pager zou
        bovendien de vergroting breken: de pijltjes moeten door de hele galerij kunnen lopen.

        Geen filter op soort meer. De oude site kent geen indeling in soorten; de filterbalk van
        een eerdere versie hing aan een veld dat hier is bedacht, en een filterknop die "Prefab
        dakkapel · 5" zegt is een bewering.
        """
        website = self._site_or_404()
        photos = request.env["cs.prefab.project"]._gallery_photos(website)
        return request.render("cs_prefab_website.projects_index", dict(PROJECTS_META, **{
            "photos": photos,
            # Het aantal komt uit Python en niet uit `len()` in het sjabloon: de
            # voorbeeldweergave (scripts/preview_website.py) evalueert QWeb-expressies in een
            # naamruimte waarin een onbekende naam None is, en `len` is daar dus ook None. Een
            # waarde die de renderer aanlevert werkt in allebei.
            "total": len(photos),
        }))

    # ------------------------------------------------------------------
    # Nieuws
    # ------------------------------------------------------------------

    @http.route(["/nieuws", "/nieuws/page/<int:page>"], type="http", auth="public",
                website=True, sitemap=sitemap_news, readonly=True)
    def news(self, page=1, **kwargs):
        """The news index at the address the old site used.

        The posts themselves stay ``blog.post`` records on Odoo Blog's own addresses -- they get
        the editor, the next/previous navigation and the structured data that come with the app.
        Only the index moves, because ``/nieuws`` is in the URL contract and ``/blog`` is not.
        """
        website = self._site_or_404()
        post_model = request.env["blog.post"]
        blog = request.env["website"]._cs_prefab_news_blog()
        domain = [("blog_id", "=", blog.id)] if blog else [("id", "=", 0)]
        total = post_model.search_count(domain)
        # Het websiterecord dat `_site_or_404()` hierboven al heeft opgehaald, en NIET
        # `request.website`: dat attribuut is in saas~19.4 verdwenen (matrix: "request.website
        # KALDIRILDI", risk high, runtime bevestigd 2026-07-05) en het opvragen ervan gooit
        # AttributeError midden in de route, dus /nieuws antwoordde 500 op een database waar de
        # blog en beide berichten gewoon bestonden. `website.pager()` bestaat nog wel
        # (website/models/website.py:1642 in dit image).
        pager = website.pager(
            url="/nieuws", total=total, page=page, step=POSTS_PER_PAGE, scope=5)
        posts = post_model.search(domain, limit=POSTS_PER_PAGE, offset=pager["offset"])
        return request.render("cs_prefab_website.news_index", dict(NEWS_META, **{
            "posts": posts,
            "pager": pager,
            "blog": blog,
            "total": total,
        }))

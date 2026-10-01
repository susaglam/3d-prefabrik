"""Every old prefabpartner.nl address, and what answers it after the switch.

The map itself is ``data/url_map.json`` -- a decision record, readable without running Odoo,
and compared against the research inventory by a repository test so a forgotten URL is a test
failure rather than a lost search result.

Two things were verified against the saas-19.4 source rather than assumed, and both changed
what this file does:

* **Trailing slashes need no rewrite.** Every WordPress address ends in ``/`` and every Odoo
  page does not, so the obvious move is eleven redirect records. ``_serve_page`` already does
  it: a path that ends in ``/`` and matches no page is 301'd to the same path without the
  slash, before the rewrite table is ever consulted. Eleven records that can never fire are
  not free -- they are eleven rows a later maintainer has to reason about.
* **One rewrite row covers both spellings anyway.** ``_serve_redirect`` searches
  ``url_from in [request_uri, path.rstrip('/'), path + '/', unslugged]``, so a row stored
  without the slash answers the slashed request too.

Every row is scoped to this website. A ``website.rewrite`` with an empty ``website_id``
applies to every website on the instance, which would point the codesnap host's
``/wp-content/...`` at this site's media.
"""
import json
import logging

from odoo import api, models
from odoo.tools import file_open

_logger = logging.getLogger(__name__)

URL_MAP_PATH = "cs_prefab_website/data/url_map.json"


class PrefabUrlMap(models.AbstractModel):
    _name = "cs.prefab.website.urlmap"
    _description = "URL-kaart van de oude prefabpartner.nl"

    @api.model
    def _url_map(self):
        with file_open(URL_MAP_PATH, "r", filter_ext=(".json",)) as handle:
            return json.load(handle)

    @api.model
    def _sync_redirects(self):
        """Create the 301s the map declares, scoped to the Prefab Partner website.

        Idempotent on ``url_from``: an existing row's target is refreshed, which is also how
        stage 2 re-points the two blog-post redirects once the posts exist.
        """
        website = self.env["website"]._cs_prefab_site()
        if not website:
            _logger.warning("cs_prefab_website: no flagged website; redirects skipped")
            return {}
        media = self.env["cs.prefab.website.media"]
        applied = {}
        for entry in self._url_map()["entries"]:
            if entry["kind"] == "media":
                target = media._media_url(entry["media"])
            elif entry["kind"] == "redirect":
                target = entry["to"]
            else:
                # 'page' is answered by a website.page; 'deferred' is a named gap.
                continue
            source = entry["from"].rstrip("/") or "/"
            if source == target:
                # website.rewrite refuses a 301 whose source and target are equal, and it
                # would be a loop in any case.
                continue
            applied[source] = self._cs_prefab_set_redirect(source, target, entry.get("note"))
        _logger.info("cs_prefab_website: %d redirects in place", len(applied))
        return applied

    @api.model
    def _cs_prefab_set_redirect(self, url_from, url_to, note=None):
        """Create or re-point one 301. Returns the target actually stored.

        Public on purpose: this is how a later stage moves the two news-post redirects from
        the interim ``/nieuws`` onto the real Odoo Blog addresses once those records exist.
        """
        website = self.env["website"]._cs_prefab_site()
        if not website:
            return False
        rewrite_model = self.env["website.rewrite"].sudo()
        existing = rewrite_model.search(
            [("website_id", "=", website.id), ("url_from", "=", url_from)], limit=1)
        values = {"name": note or f"Oude prefabpartner.nl-adres {url_from}",
                  "redirect_type": "301", "url_from": url_from, "url_to": url_to,
                  "website_id": website.id, "active": True}
        if existing:
            if existing.url_to != url_to or not existing.active:
                existing.write(values)
            return existing.url_to
        return rewrite_model.create(values).url_to

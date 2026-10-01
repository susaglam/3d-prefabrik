"""One reader for the blog post's cover image, so the news card has a picture.

``blog.post`` stores its cover in ``cover_properties``: a JSON string whose
``background-image`` key holds a CSS ``url(...)`` value rather than a plain path. Odoo's own
templates paint it as a background; a card wants a real ``<img>`` so the browser can lazy-load
it, so the value has to be unwrapped somewhere.

It is unwrapped HERE and not in the template, for the same reason the news query lives in
Python: a ``[4:-1]`` slice inside ``arch_db`` is invisible to every static check and fails
silently the day the stored shape changes. This returns ``False`` when there is no usable
cover, and the template simply renders no figure.
"""
import json
import logging
import re

from odoo import models

_logger = logging.getLogger(__name__)


class BlogPost(models.Model):
    _inherit = "blog.post"

    def _cs_prefab_cover_image(self, size=None):
        """The cover image as a plain URL, or False.

        ``size`` ("800x450") rewrites the size segment of an ``/web/image/<xmlid>/<w>x<h>/<file>``
        address. The same cover serves two very different boxes: the full-bleed header of the
        post itself, where 1200 px is right, and a card of about 360 px in the news grid. One
        stored URL for both means one of them is wrong, and the one that is wrong is the one a
        visitor meets twelve at a time.

        Never raises: this runs while a page is rendering, and a malformed cover must cost a
        picture, not the page.
        """
        self.ensure_one()
        raw = self.cover_properties or ""
        if not raw:
            return False
        try:
            value = (json.loads(raw) or {}).get("background-image") or ""
        except (ValueError, TypeError):
            _logger.warning("cs_prefab_website: post %s has unreadable cover_properties", self.id)
            return False
        value = value.strip()
        if not value.startswith("url(") or not value.endswith(")"):
            return False
        url = value[4:-1].strip().strip("\"'")
        # "none" is what Odoo stores for "no cover", wrapped or not.
        if not url or url == "none":
            return False
        if size:
            url = re.sub(r"/\d+x\d+/", "/%s/" % size, url, count=1)
        return url

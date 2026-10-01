"""New configurator records follow the website switcher instead of always picking the first.

``cs.prefab.catalog.release.website_id`` and ``cs.prefab.appearance.website_id`` both default
to::

    self.env["website"].search([("company_id", "=", self.env.company.id)], limit=1)

``website._order`` is ``"sequence, id"``, so that expression is *always* the first website,
whichever one the sales manager actually has in mind. With one website it can only be right.
With two, every new draft catalogue and every new appearance record silently belongs to the
codesnap site -- and the person who notices is the one wondering why the new site still shows
demonstration prices after they published a catalogue.

The override is deliberately narrow, for three reasons:

* it goes through ``default_get`` rather than redefining ``website_id``, so ``required``,
  ``check_company``, ``ondelete`` and the UNIQUE constraint on the appearance record keep the
  definitions the owning module gave them;
* it only answers when a website is already in scope (the backend website switcher and every
  frontend request put ``website_id`` in the context). Outside both -- a cron, a shell, an
  import, the module's own tests -- it returns *exactly* today's expression;
* it never raises, because this runs while a form is being opened.

It is still a behaviour change to a module that is in production, so it has its own test.
"""
import logging

from odoo import api, models

_logger = logging.getLogger(__name__)


class PrefabWebsiteScopedMixin(models.AbstractModel):
    _name = "cs.prefab.website.scoped"
    _description = "Standaardwebsite voor nieuwe configurator-records"

    @api.model
    def _cs_prefab_default_website(self):
        """The website in scope, falling back to the expression the owning module ships."""
        company = self.env.company
        fallback = self.env["website"].search([("company_id", "=", company.id)], limit=1)
        try:
            current = self.env["website"].get_current_website(fallback=False)
        except Exception:  # noqa: BLE001 - a default must never break a form
            _logger.debug("cs_prefab_website: no current website while computing a default")
            return fallback
        if current and current.company_id == company:
            return current
        return fallback

    @api.model
    def _cs_prefab_scoped_defaults(self, values, fields_list):
        if "website_id" in fields_list:
            website = self._cs_prefab_default_website()
            if website:
                values["website_id"] = website.id
        return values


# The override is repeated on each concrete model rather than inherited from the mixin.
# It is three lines twice instead of three lines once, and it buys the one thing worth
# buying here: the method is on the model's OWN class, so it cannot be skipped because a
# later module happens to place a default_get earlier in the resolution order. A default
# that silently stops being applied is indistinguishable from one that was never written.

class CatalogRelease(models.Model):
    _name = "cs.prefab.catalog.release"
    _inherit = ["cs.prefab.catalog.release", "cs.prefab.website.scoped"]

    @api.model
    def default_get(self, fields_list):
        return self._cs_prefab_scoped_defaults(super().default_get(fields_list), fields_list)


class PrefabAppearance(models.Model):
    _name = "cs.prefab.appearance"
    _inherit = ["cs.prefab.appearance", "cs.prefab.website.scoped"]

    @api.model
    def default_get(self, fields_list):
        return self._cs_prefab_scoped_defaults(super().default_get(fields_list), fields_list)

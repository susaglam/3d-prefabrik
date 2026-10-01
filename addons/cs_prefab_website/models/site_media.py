"""Turn the module's shipped media into ir.attachment records the builder can use.

Why attachments at all, when the files are already served at
``/cs_prefab_website/static/src/media/<name>``: an attachment is what the builder's image
picker lists, what Odoo resizes on demand through ``/web/image/<id>/<w>x<h>``, and what the
customer can replace without a release. A module static file is none of those.

Why NOT attachments for the videos: the builder has no widget that manages a self-hosted MP4,
so an attachment would buy nothing and would put ten megabytes of video in the filestore next
to the ten megabytes already in the module folder. They stay static files with a stable URL.

Three mechanics on this target that are easy to get wrong, all verified against the saas-19.4
source rather than remembered:

* ``ir.attachment.datas`` **no longer exists** and is dropped SILENTLY on write --
  ``_check_contents`` does ``warnings.warn(...); values.pop('datas')``. An XML data file using
  ``<field name="datas" file="..."/>`` therefore creates 91 attachments with no content and no
  error. Content goes in ``raw``, wrapped in ``BinaryBytes``, which is the idiom core itself
  uses (``website/models/assets.py`` writes ``'raw': BinaryBytes(req.content)``).
* Reading ``raw`` back can hand you a lazy file object rather than bytes, so the record is
  compared by ``checksum`` -- a stored sha1 the ORM maintains -- and never by its content.
* ``public=True`` is what makes an attachment appear in the builder's media dialog; its domain
  is ``["|", ["public","=",true], ...]``. ``res_model``/``res_id`` only keep the record out of
  a business record's attachment list.
* **Odoo silently RESIZES an image it is given.** ``ir.attachment._postprocess_contents``
  (ir_attachment.py:376-405 on this target) shrinks any png/jpeg/bmp/tiff wider or taller than
  ``base.image_autoresize_max_px`` (default ``1920x1920``) before storing it, unless the context
  carries ``image_no_postprocess``. Three files here are 2560x250 header banners, so the bytes
  in the filestore were not the bytes in the build: their checksum could never match the file
  and ``_sync_media`` rewrote the same three attachments on EVERY upgrade -- the one thing this
  method promises not to do. WEBP and SVG are skipped by that code, which is why only the three
  JPEGs were affected and why it looked like a fluke rather than a rule.
"""
import hashlib
import json
import logging
import mimetypes
from pathlib import Path

from odoo import api, models
from odoo.tools import file_open

_logger = logging.getLogger(__name__)

MODULE = "cs_prefab_website"
INDEX_PATH = f"{MODULE}/data/media_index.json"

# Guessing a mimetype from a file extension is not reliable enough for a file the browser has
# to render, and Odoo forces anything xml-like to text/plain for users without ir.ui.view
# write access -- which would turn every brand SVG into a text download.
MIMETYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}


def _slug(filename):
    """A stable xmlid suffix. Filenames differ only by case and punctuation, so the digest
    keeps 'Project-2026-1.jpg' and 'project-2026-1.jpg' apart."""
    stem = "".join(character if character.isalnum() else "_" for character in filename.lower())
    return f"media_{stem}_{hashlib.sha1(filename.encode()).hexdigest()[:8]}"


class PrefabSiteMedia(models.AbstractModel):
    _name = "cs.prefab.website.media"
    _description = "Beeldbank van de Prefab Partner-website"

    @api.model
    def _media_index(self):
        with file_open(INDEX_PATH, "r", filter_ext=(".json",)) as handle:
            return json.load(handle)

    @api.model
    def _media_xmlid(self, filename):
        return f"{MODULE}.{_slug(filename)}"

    @api.model
    def _media_attachment(self, filename):
        """The attachment for one shipped file, or an empty recordset."""
        record = self.env.ref(self._media_xmlid(filename), raise_if_not_found=False)
        return record if record and record.exists() else self.env["ir.attachment"].browse()

    @api.model
    def _media_url(self, filename):
        """The stable public URL of a shipped image or document.

        Addressed by xmlid rather than by database id, so a redirect written today keeps
        working after a restore into another database.
        """
        return f"/web/content/{self._media_xmlid(filename)}/{filename}"

    @api.model
    def _media_bytes(self, filename):
        """The bytes of one shipped file, or b"" when it is not in this build.

        Used for the two images that are written onto fields rather than served as
        attachments -- the website logo and the favicon. Returns empty rather than raising:
        a missing brand image is a cosmetic defect, and an install that stops because of one
        is a worse outcome than a site that starts with Odoo's default icon.
        """
        entry = next((item for item in self._media_index()["files"]
                      if item["filename"] == filename and item.get("shipped")), None)
        if not entry:
            _logger.warning("cs_prefab_website: %s is not in the media index", filename)
            return b""
        try:
            with file_open(f"{MODULE}/{entry['shipped']['path']}", "rb") as handle:
                return handle.read()
        except (FileNotFoundError, OSError):
            _logger.error("cs_prefab_website: %s is in the index but not in the build", filename)
            return b""

    @api.model
    def _sync_media(self):
        """Create or refresh one public attachment per shipped image and document.

        Idempotent, and safe to run on every upgrade: a file is rewritten only when its sha1
        differs from the attachment's stored checksum, so an unchanged release touches nothing.

        Deliberately NOT graceful about a missing file: the media index is generated from the
        same tree by scripts/import_site_media.py, so a missing file means the module was
        packaged incompletely and the pages that reference it would render broken images. It
        is logged per file and the rest still installs -- one bad image must not take a
        website down -- but the count is returned so a test can insist on zero.
        """
        index = self._media_index()
        # image_no_postprocess: store the bytes this release ships, not a version Odoo decided
        # to shrink on the way in. See the module docstring -- without it the three 2560x250
        # header banners are resized to 1920px wide, their checksum can never equal the file's,
        # and this method rewrites them on every single upgrade.
        attachment_model = self.env["ir.attachment"].sudo().with_context(image_no_postprocess=True)
        data_model = self.env["ir.model.data"].sudo()
        created = updated = skipped = missing = 0
        for entry in index["files"]:
            if entry.get("duplicate_of") or not entry.get("shipped"):
                skipped += 1
                continue
            if entry["kind"] == "video":
                # Served straight from the module's static folder; see the module docstring.
                skipped += 1
                continue
            filename = entry["filename"]
            relative = entry["shipped"]["path"]
            shipped_name = Path(relative).name
            try:
                with file_open(f"{MODULE}/{relative}", "rb") as handle:
                    content = handle.read()
            except (FileNotFoundError, OSError):
                _logger.error("cs_prefab_website: shipped media missing: %s", relative)
                missing += 1
                continue
            checksum = hashlib.sha1(content).hexdigest()
            values = {
                "name": shipped_name,
                "description": entry.get("alt") or False,
                "mimetype": MIMETYPES.get(Path(shipped_name).suffix.lower())
                            or mimetypes.guess_type(shipped_name)[0] or "application/octet-stream",
                "res_model": "ir.ui.view",
                "res_id": 0,
                "public": True,
                "type": "binary",
            }
            attachment = self._media_attachment(filename)
            if attachment:
                if attachment.checksum != checksum:
                    attachment.with_context(image_no_postprocess=True).write(
                        dict(values, raw=self._binary(content)))
                    updated += 1
                elif any(attachment[key] != value for key, value in values.items()
                         if key in ("name", "public", "mimetype")):
                    attachment.write(values)
                    updated += 1
                continue
            attachment = attachment_model.create(dict(values, raw=self._binary(content)))
            # `_update_xmlids`, and NOT `ir.model.data.create(...)`. A hand-built row is
            # deleted again minutes later, in the same install, and nothing says so.
            #
            # At the end of the module load `ir.model.data._process_end` runs
            # `SELECT ... FROM ir_model_data WHERE module IN %s AND res_id IS NOT NULL AND
            # COALESCE(noupdate,false) != true` and unlinks every record whose xmlid is not in
            # `self.pool.loaded_xmlids` (ir_model.py:2575-2600 in this image). That set is filled
            # by the XML loader and by `_update_xmlids` alone (ir_model.py:2348-2350), so a row
            # written with `create()` satisfies both halves of the condition: noupdate false AND
            # absent from the set. Measured on the clone: 85 attachments created at 18:39:59 and
            # 85 `Deleting <id>@ir.attachment` lines at 18:40:02, after "Module ... loaded".
            #
            # `_update_xmlids` closes both halves at once -- it stamps noupdate and adds the
            # xmlid to the set -- and `noupdate=True` is also the honest flag here: from the
            # moment they exist these attachments are the customer's, exactly like the project
            # series in models/project.py, which registers its xmlids the same way.
            #
            # Called per record rather than batched after the loop on purpose: `_update_xmlids`
            # primes the xmlid cache that `_media_attachment()` reads on the next iteration, so
            # a second index entry for the same filename finds the attachment instead of
            # creating a second one and colliding on ir_model_data's unique (module, name).
            data_model._update_xmlids([{
                "xml_id": self._media_xmlid(filename),
                "record": attachment,
                "noupdate": True,
            }])
            created += 1
        result = {"created": created, "updated": updated, "skipped": skipped, "missing": missing}
        _logger.info("cs_prefab_website: media sync %s", result)
        return result

    @staticmethod
    def _binary(content):
        """Wrap raw bytes the way this Odoo insists on, without hard-failing if it moves.

        saas~19.4 refuses plain bytes on a Binary field ("use BinaryValue instead of bytes").
        The wrapper lives in odoo.tools.binary; importing it lazily means a future rename
        degrades to trying the plain bytes rather than making the module uninstallable.
        """
        try:
            from odoo.tools.binary import BinaryBytes
        except ImportError:  # pragma: no cover - defensive
            _logger.warning("cs_prefab_website: BinaryBytes not available; writing raw bytes")
            return content
        return BinaryBytes(content)

"""2.9.7: proposals print the company's Odoo logo by default, not the built-in CS prefab wordmark.

Until 2.9.7 `logo_source` defaulted to "wordmark", so every vormgeving created without an explicit choice printed
"CS prefab" on the customer's proposals — the report was "pdf logo hala odoodan almiyor". Changing the field
default only reaches records created from now on, so records still on the old default are moved here.

"Still on the old default" is the whole condition, and it is deliberately narrow: a record whose administrator
uploaded their own logo keeps "upload". Nothing else about the record is touched. If the company has no logo,
the proposal prints the company name instead (pdf_layout.PdfDocument.brand), so this can never empty a header.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return
    cr.execute("UPDATE cs_prefab_appearance SET logo_source = 'odoo' WHERE logo_source = 'wordmark' RETURNING id")
    moved = [row[0] for row in cr.fetchall()]
    _logger.info("cs_prefab_configurator 2.9.7: %d vormgeving record(s) moved from the CS prefab wordmark to the "
                 "company's Odoo logo: %s", len(moved), moved)

"""Native draft RFQs from confirmed prefab sales; editable vendor price lists."""
from datetime import datetime, time, timedelta

from markupsafe import Markup, escape
from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import html2plaintext

from .native_sales import QUIET

EXAMPLE_VENDOR = "Prefab voorbeeldleverancier"
REVIEW_SUMMARY = "Prefab-inkoop controleren"
VENDOR_PATH = "via het product (tab Inkoop) of Inkoop → Configuratie → Leveranciersprijslijsten"


class PrefabPurchaseCompany(models.Model):
    _inherit = "res.company"

    prefab_purchase_enabled = fields.Boolean(string="Inkoopaanvragen bij verkoopbevestiging",
        help="Bij het bevestigen van een prefab-verkooporder maakt Odoo per leverancier een concept-inkoopaanvraag. "
             "Een inkoopgebruiker controleert prijzen, aantallen en leverdatum en bevestigt zelf. Uitzetten verwijdert geen bestaande aanvragen.")
    prefab_purchase_vendor_id = fields.Many2one("res.partner", string="Leverancier voor nieuwe prefabproducten", check_company=True,
        help="Wordt eenmalig met prijs 0 toegevoegd aan een prefabproduct dat nog geen leverancier heeft (bij de voorbeeldinrichting of "
             "wanneer een nieuw prefabproduct ontstaat). De inrichting zet verwijderde leveranciers of gewijzigde prijzen niet terug. "
             "Let op: het bevestigen van een inkooporder in Odoo voegt de leverancier van die order wél aan het product toe.")
    prefab_purchase_user_id = fields.Many2one("res.users", string="Inkoopverantwoordelijke", check_company=True,
        domain=[("share", "=", False), ("active", "=", True)],
        help="Ontvangt de controleactiviteiten voor prefab-inkoop. Deze gebruiker heeft inkooprechten nodig en, om leveranciers "
             "van producten te wijzigen, de rol Inkoop: Beheerder of Productbeheer. Zonder geldige keuze wordt de verkoper of beheerder gebruikt.")

    def action_open_prefab_operations(self):
        self.ensure_one()
        self.check_access("read")
        return {"type": "ir.actions.act_window", "name": "Prefab uitvoering en inkoop", "res_model": "res.company",
                "res_id": self.id, "view_mode": "form", "views": [(self.env.ref("cs_prefab_configurator.view_prefab_operations").id, "form")]}

    def action_setup_prefab_operations(self):
        self.ensure_one()
        if not self.env.user.has_group("base.group_system"):
            raise AccessError("Alleen een beheerder met Instellingen-rechten kan de prefab-voorbeeldinrichting uitvoeren. Vraag een beheerder om deze knop te gebruiken.")
        if self not in self.env.companies:
            raise AccessError("Selecteer dit bedrijf eerst in de bedrijvenkiezer; de voorbeeldinrichting werkt alleen voor een actief bedrijf.")
        self.check_access("write")
        self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"prefab-setup:{self.id}",))
        self.invalidate_recordset(["prefab_purchase_vendor_id"])
        if not self.prefab_purchase_vendor_id:
            partners = self.env["res.partner"].with_company(self).with_context(active_test=False, **QUIET)
            vendor = partners.search([("name", "=", EXAMPLE_VENDOR), ("company_id", "=", self.id)], limit=1)
            if vendor and not vendor.active:
                raise UserError("De voorbeeldleverancier '%s' is gearchiveerd. Activeer dit contact of kies bij 'Leverancier voor nieuwe "
                                "prefabproducten' een andere leverancier en voer de inrichting opnieuw uit." % EXAMPLE_VENDOR)
            if not vendor:
                vendor = partners.create({
                    "name": EXAMPLE_VENDOR, "is_company": True, "company_id": self.id,
                    "supplier_rank": 1, "email": False,
                    "comment": "Voorbeeldleverancier voor prefab-inkoopaanvragen. Vervang door de werkelijke leverancier en controleer inkoopprijzen."})
            self.prefab_purchase_vendor_id = vendor
        if self.prefab_purchase_vendor_id.company_id and self.prefab_purchase_vendor_id.company_id != self:
            raise UserError("De gekozen leverancier hoort bij een ander bedrijf. Kies een leverancier van dit bedrijf of een gedeeld contact en voer de inrichting opnieuw uit.")
        self.prefab_purchase_enabled = True
        if not self.prefab_purchase_user_id:
            self.prefab_purchase_user_id = self.env.user
        products = self.env["product.template"].with_company(self).search([("company_id", "=", self.id), ("prefab_item_key", "!=", False)])
        products._prefab_initialize_purchase_vendor()
        self._ensure_prefab_project_template()
        return self.action_open_prefab_operations()


class PrefabPurchaseProduct(models.Model):
    _inherit = "product.template"

    prefab_purchase_seeded = fields.Boolean(string="Prefab-inkoop ingericht", readonly=True, copy=False,
        help="De eenmalige inkoopinrichting is uitgevoerd. Latere wijzigingen aan leveranciers en de optie Inkoop blijven daarna ongemoeid.")

    def _prefab_initialize_purchase_vendor(self):
        for product in self:
            company = product.company_id
            if not product.prefab_item_key or product.prefab_purchase_seeded or not company.prefab_purchase_enabled:
                continue
            vendor = company.prefab_purchase_vendor_id
            if not vendor or not vendor.active or (vendor.company_id and vendor.company_id != company):
                continue
            # Never replace vendor prices or restore a price-list row the user removed.
            existing = product.seller_ids.filtered(lambda seller: not seller.company_id or seller.company_id == company)
            if not existing:
                self.env["product.supplierinfo"].sudo().with_company(company).create({
                    "partner_id": vendor.id, "product_tmpl_id": product.id, "company_id": company.id,
                    "min_qty": 0, "price": 0, "currency_id": company.currency_id.id, "uom_id": product.uom_id.id,
                    "delay": 0, "sequence": 10})
            product.write({"purchase_ok": True, "prefab_purchase_seeded": True})


class PrefabPurchaseSaleLine(models.Model):
    _inherit = "sale.order.line"

    prefab_purchase_processed = fields.Boolean(string="Prefab-inkoop verwerkt", readonly=True, copy=False,
        help="Deze verkoopregel heeft al een inkoopregel opgeleverd. Verwijderde inkoopregels worden niet automatisch teruggezet.")

    def _prefab_purchase_candidate(self):
        return not self.display_type and not self.is_downpayment and not self.is_expense

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        added = lines.filtered(lambda line: line.order_id.state == "sale" and line.order_id.prefab_origin_ref
            and line.order_id.company_id.prefab_purchase_enabled and line._prefab_purchase_candidate() and line.product_uom_qty > 0)
        for order in added.order_id:
            order._prefab_notify_change(["Nieuwe verkoopregel na bevestiging: %s. Gebruik 'Ontbrekende inkoopaanvragen aanvullen' "
                "op het tabblad Prefab-inkoop om deze regel in te kopen." % line.name for line in added.filtered(lambda row: row.order_id == order)])
        return lines

    def write(self, values):
        watched = {"product_uom_qty", "product_uom_id", "product_id"}
        tracked = self.filtered(lambda line: line.order_id.prefab_origin_ref and line.order_id.company_id.prefab_purchase_enabled
            and line._prefab_purchase_candidate() and (line.prefab_purchase_processed or line.order_id.state == "sale")) if watched & values.keys() else self.browse()
        before = {line.id: (line.product_id, line.product_uom_id, line.product_uom_qty) for line in tracked}
        result = super().write(values)
        for order in tracked.order_id:
            messages = []
            for line in tracked.filtered(lambda row: row.order_id == order):
                product, uom, quantity = before[line.id]
                if (product, uom, quantity) == (line.product_id, line.product_uom_id, line.product_uom_qty):
                    continue
                if line.prefab_purchase_processed:
                    # Edits in any state count: cancel → quotation → edit → confirm must not drift silently.
                    messages.append("Verkoopregels gewijzigd: %s van %s %s (%s) naar %s %s (%s). De bestaande inkoopregel is niet aangepast; vergelijk en pas die zo nodig aan."
                        % (line.name, quantity, uom.name, product.display_name, line.product_uom_qty, line.product_uom_id.name, line.product_id.display_name))
                elif order.state == "sale" and quantity <= 0 < line.product_uom_qty:
                    messages.append("Verkoopregel %s heeft na bevestiging een aantal gekregen. Gebruik 'Ontbrekende inkoopaanvragen aanvullen' om deze regel in te kopen." % line.name)
            if messages:
                order._prefab_notify_change(messages)
        return result

    @api.ondelete(at_uninstall=False)
    def _unlink_prefab_notify_purchase_source(self):
        """A deleted sale line leaves its purchase line unlinked; tell the buyer on the purchase document itself."""
        for line in self.sudo().filtered("prefab_purchase_processed"):
            for purchase in line.purchase_line_ids.order_id.filtered(lambda po: po.state != "cancel"):
                purchase.with_context(**QUIET).activity_schedule("mail.mail_activity_data_todo",
                    user_id=(purchase.user_id or line.order_id._prefab_purchase_responsible()).id,
                    summary="Prefab-verkoopregel verwijderd",
                    note=Markup("<p>Verkoopregel %s van %s is verwijderd. De inkoopregel is behouden; controleer of deze moet worden aangepast of verwijderd.</p>")
                        % (escape(line.name), escape(line.order_id.name)))


class PrefabPurchaseSaleOrder(models.Model):
    _inherit = "sale.order"

    prefab_purchase_review = fields.Text(string="Inkoopcontrole", readonly=True, copy=False, groups="base.group_user",
        help="Actuele waarschuwingen van de automatische inkoop, zoals regels zonder geldige leverancier of aanvragen met nulprijzen. "
             "Wordt bijgewerkt telkens wanneer de inkoopaanvragen worden aangevuld.")
    prefab_purchase_company_enabled = fields.Boolean(related="company_id.prefab_purchase_enabled", string="Automatische prefab-inkoop actief")

    def _action_cancel(self):
        confirmed = self.filtered(lambda order: order.prefab_origin_ref and order.state == "sale")
        result = super()._action_cancel()
        for order in confirmed.filtered(lambda row: row.state == "cancel"):
            purchases = self.env["purchase.order"].sudo().search([("prefab_sale_order_id", "=", order.id), ("state", "!=", "cancel")])
            purchases |= order.sudo().order_line.purchase_line_ids.order_id.filtered(lambda po: po.state != "cancel")
            for purchase in purchases:
                purchase.with_context(**QUIET).activity_schedule("mail.mail_activity_data_todo",
                    user_id=order._prefab_purchase_responsible().id, summary="Prefab-verkooporder geannuleerd",
                    note=Markup("<p>Verkooporder %s is geannuleerd. Controleer of deze inkoopaanvraag of bestelling moet worden aangepast of geannuleerd. De inkoopstatus is behouden.</p>") % escape(order.name))
        return result

    def _prefab_purchase_responsible(self):
        self.ensure_one()
        candidates = self.company_id.prefab_purchase_user_id | self.user_id | self.env.ref("base.user_admin")
        allowed = candidates.filtered(lambda user: user.active and not user.share and self.company_id in user.company_ids)
        buyers = allowed.filtered(lambda user: user.with_user(user).has_group("purchase.group_purchase_user"))
        readers = buyers.filtered(lambda user: self.with_user(user).with_context(allowed_company_ids=self.company_id.ids).has_access("read"))
        return readers[:1] or buyers[:1] or allowed[:1] or self.env["res.users"].sudo().search([
            ("active", "=", True), ("share", "=", False), ("company_ids", "in", self.company_id.ids)], limit=1)

    def _prefab_schedule_review(self, messages):
        """One open review activity per order; new messages extend it instead of piling up activities."""
        self.ensure_one()
        messages = list(dict.fromkeys(message for message in messages if message))
        if not messages:
            return
        order = self.sudo().with_company(self.company_id).with_context(**QUIET)
        activity = self.env["mail.activity"].sudo().search([("res_model", "=", "sale.order"), ("res_id", "=", order.id),
            ("summary", "=", REVIEW_SUMMARY)], limit=1)
        paragraphs = lambda rows: Markup("").join(Markup("<p>%s</p>") % row for row in rows)
        if activity:
            note = activity.note or ""
            plain = html2plaintext(note)
            fresh = [message for message in messages if message not in plain and str(escape(message)) not in note]
            if fresh:
                activity.note = Markup(note) + paragraphs(fresh)
            return
        order.activity_schedule("mail.mail_activity_data_todo", user_id=order._prefab_purchase_responsible().id,
            summary=REVIEW_SUMMARY, note=paragraphs(messages))

    def _prefab_notify_purchase(self, messages):
        """Procurement warnings are recomputed on each run and shown on the Prefab-inkoop tab."""
        self.ensure_one()
        messages = list(dict.fromkeys(message for message in messages if message))
        self.sudo().with_context(**QUIET).prefab_purchase_review = "\n".join(messages) or False
        self._prefab_schedule_review(messages)

    def _prefab_notify_change(self, messages):
        """Sales-side changes after purchasing are kept in the chatter history and the review activity."""
        self.ensure_one()
        messages = list(dict.fromkeys(message for message in messages if message))
        if not messages:
            return
        order = self.sudo().with_company(self.company_id).with_context(**QUIET)
        order.message_post(body=Markup("<p>%s</p>") % escape("Prefab-inkoop: controleer de inkoopaanvragen.")
            + Markup("").join(Markup("<p>%s</p>") % message for message in messages), subtype_xmlid="mail.mt_note")
        self._prefab_schedule_review(messages)

    def _prefab_select_seller(self, line, date):
        """Top vendor row by sequence; a zero-priced example row yields to any other valid vendor."""
        self.ensure_one()
        company = self.company_id
        valid = lambda seller: seller.partner_id.active and (not seller.partner_id.company_id or seller.partner_id.company_id == company)
        product = line.product_id
        seller = product._select_seller(quantity=line.product_uom_qty, uom_id=line.product_uom_id, date=date, ordered_by="sequence")
        placeholder = company.prefab_purchase_vendor_id
        if seller and placeholder and seller.partner_id == placeholder and not seller.price:
            others = product._get_filtered_sellers(quantity=line.product_uom_qty, date=date, uom_id=line.product_uom_id).filtered(
                lambda row: row.partner_id != placeholder and valid(row))
            if others:
                seller = others.sorted(lambda row: (row.sequence, row.id))[:1]
        return seller if seller and valid(seller) else self.env["product.supplierinfo"]

    def _ensure_prefab_procurement(self):
        """Use 19.4 native sale_purchase preparation without changing project tracking."""
        purchases = self.env["purchase.order"].sudo().browse()
        for original in self:
            if original.state != "sale" or not original.prefab_origin_ref or not original.company_id.prefab_purchase_enabled:
                continue
            order = original.sudo().with_company(original.company_id).with_context(**QUIET)
            self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"prefab-inkoop:{order.company_id.id}:{order.id}",))
            order.order_line.invalidate_recordset(["prefab_purchase_processed", "purchase_line_ids"])
            Purchase = self.env["purchase.order"].sudo().with_company(order.company_id).with_context(**QUIET)
            responsible = order._prefab_purchase_responsible()
            # One procurement date: vendor validity, native line pricing and selected seller must agree.
            today = fields.Date.context_today(order)
            now = fields.Datetime.now()
            rfq_date = now if now.date() == today else datetime.combine(today, time(12))
            day_start = datetime.combine(rfq_date.date(), time.min)
            warnings, new_orders = [], Purchase.browse()
            for line in order.order_line.filtered(lambda row: row._prefab_purchase_candidate() and row.product_uom_qty > 0):
                if line.prefab_purchase_processed or line.purchase_line_ids:
                    if line.purchase_line_ids and not line.prefab_purchase_processed:
                        line.prefab_purchase_processed = True
                    purchases |= line.purchase_line_ids.order_id
                    continue
                product = line.product_id
                if not product.purchase_ok:
                    if product.prefab_item_key and not product.prefab_purchase_seeded:
                        warnings.append("%s: dit prefabproduct is nog niet voor inkoop ingericht. Een beheerder voert 'Voorbeeldinrichting toepassen' "
                                        "uit onder Prefab → Uitvoering en inkoop, of zet 'Inkoop' aan op het product." % line.name)
                    continue
                seller = order._prefab_select_seller(line, today)
                if not seller:
                    warnings.append("%s: geen geldige leverancier; deze regel is niet ingekocht. Voeg een leverancier toe %s en gebruik daarna "
                                    "'Ontbrekende inkoopaanvragen aanvullen'." % (line.name, VENDOR_PATH))
                    continue
                try:
                    with self.env.cr.savepoint():
                        if not product._select_seller(partner_id=seller.partner_id, quantity=line.product_uom_qty,
                                uom_id=line.product_uom_id, date=rfq_date.date()):
                            raise UserError("geen geldige leveranciersprijs op %s voor %s. Controleer geldigheidsdata en minimale hoeveelheid %s."
                                            % (rfq_date.date(), seller.partner_id.display_name, VENDOR_PATH))
                        po_values = line._purchase_service_prepare_order_values(seller)
                        po_values.update(prefab_sale_order_id=order.id, project_id=order.project_id.id,
                            user_id=responsible.id, date_order=rfq_date, partner_ref=False)
                        # Reuse only this order's own draft RFQ of the same procurement day.
                        po = Purchase.search([
                            ("prefab_sale_order_id", "=", order.id), ("partner_id", "=", po_values["partner_id"]),
                            ("company_id", "=", po_values["company_id"]), ("currency_id", "=", po_values["currency_id"]),
                            ("state", "=", "draft"), ("date_order", ">=", day_start), ("date_order", "<", day_start + timedelta(days=1))], limit=1)
                        created = not po
                        if created:
                            po = Purchase.create(po_values)
                        values = line._purchase_service_prepare_line_values(po)
                        if line.name and line.name not in values["name"]:
                            values["name"] += "\nUitvoering: " + line.name
                        self.env["purchase.order.line"].sudo().with_company(order.company_id).with_context(**QUIET).create(values)
                        line.prefab_purchase_processed = True
                    purchases |= po
                    if created:
                        new_orders |= po
                except (UserError, ValidationError) as error:
                    warnings.append(line.name + ": " + str(error))
            for po in new_orders:
                # Internal guidance stays out of the vendor-facing terms (purchase.order.note).
                po.message_post(body=Markup("<p>Prefab-inkoopaanvraag voor %s. Controleer leverancier, aantallen, inkoopprijzen en leverdatum vóór "
                    "bevestiging. Nulprijzen zijn nog te beoordelen; verkoopprijzen zijn niet als inkoopprijzen overgenomen.</p>") % escape(order.name),
                    subtype_xmlid="mail.mt_note")
                po.activity_schedule("mail.mail_activity_data_todo", user_id=responsible.id,
                    summary="Prefab-inkoopaanvraag beoordelen",
                    note=Markup("<p>Controleer leverancier, hoeveelheden, prijzen en leverdatum voor %s. Deze aanvraag is niet automatisch bevestigd of verzonden.</p>") % escape(order.name))
            zero_orders = purchases.filtered(lambda po: po.prefab_sale_order_id == order and po.state in ("draft", "sent") and po.prefab_needs_price_review)
            if zero_orders:
                warnings.append("Controleer de nulprijzen in " + ", ".join(zero_orders.mapped("name")) + ".")
            order._prefab_notify_purchase(warnings)
        return purchases

    def action_prepare_prefab_procurement(self):
        if not self.env.user.has_group("purchase.group_purchase_user"):
            raise AccessError("Je hebt inkooprechten nodig om inkoopaanvragen aan te vullen. Vraag een beheerder om de rol Inkoop: Gebruiker.")
        self.check_access("write")
        if any(order.company_id not in self.env.companies for order in self):
            raise AccessError("De verkooporder hoort bij een ander bedrijf. Selecteer dat bedrijf in de bedrijvenkiezer en probeer het opnieuw.")
        disabled = self.filtered(lambda order: not order.company_id.prefab_purchase_enabled)
        if disabled:
            raise UserError("Automatische inkoopaanvragen staan uit voor %s. Een beheerder zet 'Inkoopaanvragen bij verkoopbevestiging' aan "
                            "onder Prefab → Uitvoering en inkoop; daarna kun je hier opnieuw aanvullen." % ", ".join(disabled.company_id.mapped("name")))
        purchases = self._ensure_prefab_procurement()
        if len(self) == 1 and purchases:
            return self.action_view_purchase_orders()
        return True


class PrefabPurchaseOrder(models.Model):
    _inherit = "purchase.order"

    prefab_sale_order_id = fields.Many2one("sale.order", string="Prefab-verkooporder", readonly=True, copy=False, check_company=True, index=True,
        help="De bevestigde prefab-verkooporder waarvoor deze inkoopaanvraag automatisch is aangemaakt.")
    prefab_needs_price_review = fields.Boolean(string="Nulprijzen controleren", compute="_compute_prefab_price_review",
        search="_search_prefab_needs_price_review",
        help="Deze prefab-inkoopaanvraag bevat regels zonder inkoopprijs. Vul de overeengekomen prijs in vóór bevestiging.")

    @api.depends("prefab_sale_order_id", "order_line.price_unit", "order_line.product_qty", "order_line.display_type")
    def _compute_prefab_price_review(self):
        for order in self:
            order.prefab_needs_price_review = bool(order.prefab_sale_order_id and any(not line.display_type and line.product_qty > 0 and not line.price_unit for line in order.order_line))

    def _search_prefab_needs_price_review(self, operator, value):
        if operator in ("in", "not in"):
            positive = (True in value) == (operator == "in")
        elif operator in ("=", "!="):
            positive = bool(value) == (operator == "=")
        else:
            return NotImplemented
        zero_line = [("display_type", "=", False), ("product_qty", ">", 0), ("price_unit", "=", 0)]
        if positive:
            return [("prefab_sale_order_id", "!=", False), ("order_line", "any", zero_line)]
        return ["|", ("prefab_sale_order_id", "=", False), ("order_line", "not any", zero_line)]

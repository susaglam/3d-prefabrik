"""Editable native project plans seeded once from a confirmed prefab order."""
from markupsafe import Markup, escape

from odoo import Command, api, fields, models
from odoo.exceptions import UserError, ValidationError


QUIET = dict(mail_create_nosubscribe=True, mail_create_nolog=True,
             mail_auto_subscribe_no_notify=True, tracking_disable=True)
PHASES = [
    ("site", "Opname en maatvoering"),
    ("design", "Ontwerp goedgekeurd"),
    ("production", "Inkoop en productie gereed"),
    ("preparation", "Bouwplaats gereed"),
    ("assembly", "Montage en aansluitingen gereed"),
    ("handover", "Oplevering afgerond"),
]
PLAN = [
    ("site_visit", "Locatie opnemen en uitvoeringsvoorwaarden vastleggen", "site", (),
     "Controleer het uitvoeringsadres, bereikbaarheid, bestaande woning, leidingtracés en plaats voor transport en kraan. Leg foto's, risico's en open vragen vast."),
    ("measurement", "Definitieve maatvoering en technische uitgangspunten controleren", "site", ("site_visit",),
     "Meet de aansluiting en hoogtes in. Controleer de constructieve uitgangspunten, bodem/fundering en eventuele vergunningen met de verantwoordelijke adviseurs. De configurator is geen productietekening."),
    ("design", "Uitvoeringstekeningen en leveringsomvang uitwerken", "design", ("measurement",),
     "Werk maatvoering, kozijnen, daklicht en aansluitdetails uit. Vergelijk de bevestigde order met de oorspronkelijke aanvraag en leg afgesproken afwijkingen en uitgesloten werkzaamheden vast."),
    ("approval", "Ontwerp en uitvoeringsafspraken laten goedkeuren", "design", ("design",),
     "Leg de goedgekeurde tekeningen en uitvoeringsafspraken bij de taak vast. Controleer klantakkoord voordat bestelling of productie wordt vrijgegeven."),
    ("procurement", "Leveranciers en bestellingen controleren", "production", ("approval",),
     "Controleer leveranciers, aantallen, eenheden, inkoopprijzen en levertijden op de bevestigde order. Beoordeel de gekoppelde offerteaanvragen; dit werkplan verzendt of bevestigt geen inkooporders."),
    ("production", "Productie voorbereiden en casco vrijgeven", "production", ("procurement",),
     "Controleer productietekeningen, materialen en productieplanning. Documenteer maatcontrole, compleetheid en transportgereedheid van het casco."),
    ("site_preparation", "Bouwplaats en funderingsaansluiting gereedmelden", "preparation", ("approval",),
     "Stem de afgesproken voorbereiding af: toegang, vrije werkruimte, fundering, peilen en aansluitpunten. Leg vast wie werkzaamheden uitvoert die buiten de bevestigde levering vallen."),
    ("delivery", "Transport, kraan en montagedatum afstemmen", "assembly", ("production", "site_preparation"),
     "Bevestig bereikbaarheid, kraanopstelling, hijsafspraken, levervolgorde en aanwezigheid van de betrokken partijen. Vul pas een deadline in wanneer de datum is afgesproken."),
    ("assembly", "Casco plaatsen en aansluitnaden controleren", "assembly", ("delivery",),
     "Controleer positie, peilen, bevestiging en aansluiting op de bestaande woning. Registreer controle van water- en luchtdichte aansluitingen en eventuele restpunten."),
    ("quality", "Eindcontrole en restpunten uitvoeren", "handover", ("assembly",),
     "Controleer de bevestigde uitvoering, werking van daadwerkelijk geleverde voorzieningen en afwerking. Noteer restpunten met foto's en verantwoordelijken."),
    ("handover", "Opleveren en overdrachtsdossier vastleggen", "handover", ("quality",),
     "Leg het opleverakkoord, instructies, garanties en resterende afspraken vast. Sluit taken en mijlpalen pas af na de betreffende controle."),
]


class PrefabProjectCompany(models.Model):
    _inherit = "res.company"

    prefab_project_template_id = fields.Many2one(
        "project.project", string="Prefab-projectsjabloon", check_company=True,
        domain="[('is_template', '=', True), ('company_id', 'in', [False, id])]",
        help="Bewerk taken, mijlpalen en kolommen in dit native projectsjabloon. Wijzigingen gelden voor nieuwe werkplannen; bestaande projecten blijven behouden. Zonder keuze wordt bij de eerste bevestigde prefab-order een standaardsjabloon aangemaakt.")

    @api.constrains("prefab_project_template_id")
    def _check_prefab_project_template(self):
        for company in self:
            template = company.prefab_project_template_id
            if template and (not template.is_template or template.company_id and template.company_id != company):
                raise ValidationError("Kies een projectsjabloon van dit bedrijf of een gedeeld sjabloon.")

    def _ensure_prefab_project_template(self):
        self.ensure_one()
        company = self.sudo().with_company(self)
        self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"prefab-project-template:{company.id}",))
        company.invalidate_recordset(["prefab_project_template_id"])
        if company.prefab_project_template_id:
            template = company.prefab_project_template_id
            if not template.active or not template.is_template:
                raise UserError("Activeer het gekozen prefab-projectsjabloon of kies een ander sjabloon bij het bedrijf.")
            return template
        env = company.with_context(**QUIET).env
        template = env["project.project"].with_company(company).create({
            "name": "Prefab · standaard uitvoeringsplan", "company_id": company.id,
            "is_template": True, "user_id": False, "privacy_visibility": "employees",
            "allow_milestones": True, "allow_task_dependencies": True,
            "description": "Bewerk dit native sjabloon voor toekomstige prefab-projecten. Kolommen geven de werkstatus aan; mijlpalen groeperen de uitvoeringsfasen. Concrete data en toewijzingen worden per project afgesproken.",
        })
        stages = env["project.task.type"].with_context(default_project_id=template.id).create([
            {"name": name, "sequence": sequence * 10, "fold": fold,
             "project_ids": [Command.set(template.ids)], "user_id": False}
            for sequence, (name, fold) in enumerate([
                ("Te doen", False), ("In uitvoering", False), ("Wacht op informatie", False), ("Afgerond", True)], 1)
        ])
        milestones = env["project.milestone"].create([
            {"name": name, "sequence": index * 10, "project_id": template.id, "prefab_phase": key}
            for index, (key, name) in enumerate(PHASES, 1)
        ])
        phase_ids = {milestone.prefab_phase: milestone.id for milestone in milestones}
        tasks = env["project.task"].with_company(company).create([
            {"name": name, "description": description, "project_id": template.id,
             "company_id": company.id, "stage_id": stages[0].id, "milestone_id": phase_ids[phase],
             "sequence": index * 10, "user_ids": [Command.clear()], "prefab_template_key": key}
            for index, (key, name, phase, _dependencies, description) in enumerate(PLAN, 1)
        ])
        by_key = {task.prefab_template_key: task for task in tasks}
        for key, _name, _phase, dependencies, _description in PLAN:
            if dependencies:
                by_key[key].depend_on_ids = [Command.set([by_key[dependency].id for dependency in dependencies])]
        company.prefab_project_template_id = template
        return template


class PrefabWorkflowMilestone(models.Model):
    _inherit = "project.milestone"

    prefab_phase = fields.Selection(PHASES, string="Prefab-planningsfase",
        help="Koppelt automatisch toegevoegde leveringswerkzaamheden aan de juiste mijlpaal. De naam en planning van de mijlpaal blijven bewerkbaar.")


class PrefabWorkflowTask(models.Model):
    _inherit = "project.task"

    prefab_template_key = fields.Char(readonly=True, copy=True, index=True)
    prefab_scope_key = fields.Char(string="Prefab-onderdeel", readonly=True, copy=False,
        help="Het onderdeel van de bevestigde order (voorbereiding, montage of aansluiting) waarvoor deze taak automatisch is toegevoegd.")
    prefab_source_line_id = fields.Many2one("sale.order.line", string="Bevestigde orderregel", readonly=True, copy=False, check_company=True, ondelete="set null",
        help="De verkoopregel waaruit deze taak is ontstaan. Latere wijzigingen aan de regel passen de taak niet automatisch aan.")
    prefab_order_id = fields.Many2one(related="project_id.prefab_order_id", string="Prefab-verkooporder",
        help="De bevestigde prefab-verkooporder van het project; dit is de bron van de laatst afgesproken uitvoering.")
    prefab_request_id = fields.Many2one(related="project_id.prefab_order_id.prefab_quote_id", string="Oorspronkelijke aanvraag",
        help="De oorspronkelijke configuratoraanvraag van de klant, ter vergelijking met de bevestigde order.")

    def copy_data(self, default=None):
        values = super().copy_data(default=default)
        mapping = self.env.context.get("prefab_stage_mapping", {})
        if mapping:
            for item in values:
                if item.get("stage_id") in mapping:
                    item["stage_id"] = mapping[item["stage_id"]]
        return values


class PrefabWorkflowProject(models.Model):
    _inherit = "project.project"

    prefab_order_id = fields.Many2one("sale.order", string="Prefab-verkooporder", readonly=True, copy=False, check_company=True, ondelete="set null", index=True,
        help="De bevestigde prefab-verkooporder waarvoor dit uitvoeringsproject het werkplan bevat.")
    prefab_workflow_initialized = fields.Boolean(string="Prefab-werkplan aangemaakt", readonly=True, copy=False,
        help="Het standaardwerkplan is eenmalig toegevoegd. Taken die u later afrondt, archiveert of verwijdert, worden niet opnieuw aangemaakt.")
    prefab_workflow_template_id = fields.Many2one("project.project", string="Gebruikt projectsjabloon", readonly=True, copy=False, ondelete="set null",
        help="Het projectsjabloon waaruit de taken en mijlpalen van dit project zijn gekopieerd.")

    @api.model
    def _prefab_default_template(self, company):
        return company._ensure_prefab_project_template()

    def _ensure_prefab_workflow(self, order):
        """Seed once; later native edits, completions and deliberate removals are never replayed."""
        self.ensure_one()
        order.ensure_one()
        if not order.prefab_origin_ref or order.state != "sale":
            return self
        if self.is_template or self.company_id != order.company_id:
            raise UserError("Het prefab-werkplan vereist het uitvoeringsproject van hetzelfde bedrijf als de verkooporder.")
        project = self.sudo().with_company(order.company_id).with_context(**QUIET)
        self.env.cr.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"prefab-project-plan:{project.id}",))
        project.invalidate_recordset(["prefab_workflow_initialized", "prefab_order_id"])
        if project.prefab_order_id and project.prefab_order_id != order:
            raise UserError("Dit project heeft al een werkplan voor een andere prefab-verkooporder.")
        if project.prefab_workflow_initialized:
            return self
        template = order.company_id._ensure_prefab_project_template().with_company(order.company_id).with_context(**QUIET)
        if template.company_id and template.company_id != order.company_id:
            raise UserError("Het prefab-projectsjabloon hoort bij een ander bedrijf.")
        existing = project.env["project.task"].with_context(active_test=False).search([("project_id", "=", project.id)])
        aliases = {"to do": "todo", "te doen": "todo", "in progress": "progress", "in uitvoering": "progress",
                   "in behandeling": "progress", "waiting": "waiting", "wacht op informatie": "waiting",
                   "done": "done", "afgerond": "done", "voltooid": "done"}
        stage_key = lambda stage: aliases.get(stage.name.strip().casefold(), stage.name.strip().casefold())
        existing_stages = {stage_key(stage): stage for stage in project.type_ids}
        stage_mapping, additional_stages = {}, project.env["project.task.type"]
        for stage in template.type_ids:
            matching = existing_stages.get(stage_key(stage))
            if matching:
                stage_mapping[stage.id] = matching.id
            else:
                additional_stages |= stage
        # Enabling native dependencies changes waiting states. Keep existing manual workflows intact.
        may_enable_dependencies = not existing.filtered(lambda task: task.depend_on_ids or task.state == "04_waiting_normal")
        project.write({"prefab_order_id": order.id, "allow_milestones": True,
            "allow_task_dependencies": bool(project.allow_task_dependencies or template.allow_task_dependencies and may_enable_dependencies),
            "type_ids": [Command.link(stage.id) for stage in additional_stages]})
        mapping = {}
        template.milestone_ids.with_context(milestone_mapping=mapping).copy({"project_id": project.id})
        template.with_context(copy_from_template=True, copy_from_project_template=template.id,
            default_project_id=project.id, milestone_mapping=mapping, prefab_stage_mapping=stage_mapping).map_tasks(project.id)
        tasks = project.env["project.task"].with_context(active_test=False).search([("project_id", "=", project.id)]) - existing
        owner = order.user_id.filtered(lambda user: user.active and not user.share and order.company_id in user.company_ids)
        source = Markup('<h4>Bevestigde prefab-opdracht</h4><p><a data-oe-model="sale.order" data-oe-id="%s">%s</a> · %s</p>') % (order.id, escape(order.name), escape(order.prefab_origin_ref))
        if order.prefab_summary:
            source += Markup("<p>%s</p>") % escape(order.prefab_summary).replace("\n", Markup("<br/>"))
        for task in tasks:
            users = task.user_ids.filtered(lambda user: user.active and not user.share and order.company_id in user.company_ids) or owner
            values = {"description": Markup(task.description or "") + source, "partner_id": order.partner_id.id,
                      "user_ids": [Command.set(users.ids)]}
            if project.sale_line_id and project.sale_line_id.is_service and not project.sale_line_id.is_expense:
                values["sale_line_id"] = project.sale_line_id.id
            task.write(values)
        phases = {milestone.prefab_phase: milestone for milestone in project.milestone_ids if milestone.prefab_phase}
        by_key = {task.prefab_template_key: task for task in tasks if task.prefab_template_key}
        initial_stage = project.type_ids.filtered(lambda stage: not stage.fold).sorted("sequence")[:1] or project.type_ids[:1]
        scope_tasks = project.env["project.task"]
        for line in order.order_line.filtered(lambda line: not line.display_type and line.product_uom_qty > 0):
            key = line.prefab_component_key or ""
            role = key.rsplit(".", 1)[-1]
            if role not in ("preparation", "installation", "connection"):
                continue
            phase = "preparation" if role == "preparation" else "assembly"
            if phase not in phases:
                phases[phase] = project.env["project.milestone"].create({"name": dict(PHASES)[phase],
                    "project_id": project.id, "sequence": dict((key, index * 10) for index, (key, _name) in enumerate(PHASES, 1))[phase], "prefab_phase": phase})
            description = Markup("<p>%s</p><p>Bevestigd aantal: %s %s. Voer uitsluitend de werkzaamheden van deze orderregel uit. Productlevering, montage en aansluiting worden afzonderlijk afgesproken.</p>") % (escape(line.name), escape(str(line.product_uom_qty)), escape(line.product_uom_id.name))
            values = {"name": line.name, "description": description + source, "project_id": project.id,
                "company_id": order.company_id.id, "partner_id": order.partner_id.id,
                "stage_id": initial_stage.id, "milestone_id": phases[phase].id,
                "sequence": 200 + line.sequence, "user_ids": [Command.set(owner.ids)],
                "prefab_scope_key": key, "prefab_source_line_id": line.id}
            if line.is_service and not line.is_expense:
                values["sale_line_id"] = line.id
            dependency = by_key.get("approval" if phase == "preparation" else "assembly")
            if dependency and project.allow_task_dependencies:
                values["depend_on_ids"] = [Command.set(dependency.ids)]
            task = project.env["project.task"].create(values)
            scope_tasks |= task
        quality = by_key.get("quality")
        if quality and scope_tasks and project.allow_task_dependencies:
            quality.depend_on_ids = [Command.link(task.id) for task in scope_tasks]
        project.write({"prefab_workflow_initialized": True, "prefab_workflow_template_id": template.id})
        return self

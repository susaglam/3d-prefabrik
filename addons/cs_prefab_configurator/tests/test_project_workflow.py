"""Native project template, scope and retry contracts on the actual Odoo ORM."""
from datetime import datetime
from unittest.mock import patch

from odoo import Command
from odoo.exceptions import UserError, ValidationError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user

from . import test_native_sales as native_fixtures
from ..models.project_workflow import PLAN, PHASES, QUIET


@tagged("post_install", "-at_install", "prefab_project_workflow")
class TestPrefabProjectWorkflow(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.company.prefab_project_template_id = False
        cls.website = cls.env["website"].search([("company_id", "=", cls.company.id)], limit=1)
        if not cls.website:
            cls.website = cls.env["website"].create({"name": "Prefab workplan test website", "company_id": cls.company.id})
        cls.sales_user = new_test_user(cls.env, login="prefab_workplan_responsible", name="Prefab workplan responsible",
            email=False, groups="sales_team.group_sale_salesman,project.group_project_user",
            company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)])
        cls.company.prefab_sales_user_id = cls.sales_user
        cls.stage = cls.env["crm.stage"].create({"name": "Prefab workplan CRM review", "is_won": False})

    _make_quote = native_fixtures.TestPrefabNativeSales._make_quote

    def _order(self, config=None):
        quote = self._make_quote(config)
        quote._ensure_native_documents()
        return quote.sale_order_id

    def _tasks(self, project):
        return self.env["project.task"].with_context(active_test=False).search([("project_id", "=", project.id)])

    def _confirm_without_plan(self, order):
        with patch.object(type(self.env["project.project"]), "_ensure_prefab_workflow", return_value=self.env["project.project"]):
            order.with_context(**QUIET).action_confirm()
        return order.project_id or order.order_line.project_id[:1]

    def test_draft_orders_do_not_create_templates_or_plans(self):
        order = self._order()
        project = self.env["project.project"].create({"name": "Draft review only", "company_id": self.company.id})
        count = self.env["project.project"].search_count([("is_template", "=", True)])
        project._ensure_prefab_workflow(order)
        self.assertFalse(project.prefab_workflow_initialized)
        self.assertFalse(self._tasks(project))
        self.assertFalse(self.company.prefab_project_template_id)
        self.assertEqual(self.env["project.project"].search_count([("is_template", "=", True)]), count)

    def test_confirmation_populates_native_plan_milestones_links_and_valid_owner(self):
        order = self._order({"interior": True, "heating": "left", "outsideTap": "left"})
        quote, original_stage = order.prefab_quote_id, order.opportunity_id.stage_id
        snapshot = quote.snapshot_json
        last_mail = self.env["mail.mail"].search([], order="id desc", limit=1).id or 0
        order.with_context(**QUIET).action_confirm()
        project = order.project_id
        self.assertTrue(project.prefab_workflow_initialized)
        self.assertEqual(project.prefab_order_id, order)
        self.assertTrue(project.prefab_workflow_template_id.is_template)
        self.assertEqual(project.prefab_workflow_template_id, self.company.prefab_project_template_id)
        tasks = self._tasks(project)
        self.assertEqual(set(tasks.filtered("prefab_template_key").mapped("prefab_template_key")), {row[0] for row in PLAN})
        self.assertEqual(set(project.milestone_ids.mapped("prefab_phase")), {row[0] for row in PHASES})
        # sale_project links its four native columns (To Do/In Progress/Done/Cancelled); the template
        # reuses the equivalents and adds only its unmatched waiting column.
        self.assertEqual(len(project.type_ids), 5)
        self.assertEqual((project.type_ids & project.prefab_workflow_template_id.type_ids).mapped("name"), ["Wacht op informatie"])
        self.assertTrue(all(task.prefab_order_id == order and task.prefab_request_id == quote for task in tasks))
        self.assertTrue(all(task.company_id == self.company and task.partner_id == order.partner_id for task in tasks))
        self.assertTrue(all(task.user_ids == self.sales_user for task in tasks))
        self.assertFalse(tasks.filtered("date_deadline"))
        self.assertTrue(all(order.prefab_origin_ref in str(task.description) for task in tasks))
        self.assertEqual(order.opportunity_id.stage_id, original_stage)
        self.assertEqual(quote.snapshot_json, snapshot)
        # Native activity assignment may notify internal responsibles; nothing may reach the customer or portal users.
        mails = self.env["mail.mail"].search([("id", ">", last_mail)])
        described = [(mail.subject, mail.model, mail.recipient_ids.mapped("name"), mail.email_to) for mail in mails]
        self.assertFalse(mails.filtered(lambda mail: order.partner_id in mail.recipient_ids
            or (order.partner_id.email and order.partner_id.email in (mail.email_to or ""))), described)
        self.assertTrue(all(partner.user_ids and not any(partner.user_ids.mapped("share")) for partner in mails.recipient_ids), described)
        self.assertFalse(mails.filtered("email_to"), described)

    def test_scope_tasks_follow_current_confirmed_lines_and_exclude_illustrative_products(self):
        order = self._order({"interior": True, "heating": "left", "outsideTap": "left"})
        removed = order.order_line.filtered(lambda line: line.prefab_component_key == "heating.preparation")
        self.assertTrue(removed)
        removed.unlink()
        expected = order.order_line.filtered(lambda line: not line.display_type and line.product_uom_qty > 0
            and (line.prefab_component_key or "").rsplit(".", 1)[-1] in ("preparation", "installation", "connection"))
        order.with_context(**QUIET).action_confirm()
        tasks = self._tasks(order.project_id).filtered("prefab_scope_key")
        self.assertEqual(set(tasks.mapped("prefab_source_line_id").ids), set(expected.ids))
        self.assertNotIn("heating.preparation", tasks.mapped("prefab_scope_key"))
        self.assertNotIn("heating.installation", tasks.mapped("prefab_scope_key"))
        self.assertNotIn("outsideTap.product", tasks.mapped("prefab_scope_key"))
        self.assertTrue(all(task.sale_line_id == task.prefab_source_line_id for task in tasks))
        self.assertTrue(all(task.milestone_id.prefab_phase in ("preparation", "assembly") for task in tasks))

    def test_existing_manual_tasks_and_columns_survive_initialization_and_reconfirmation(self):
        order = self._order()
        project = self._confirm_without_plan(order)
        # sale_project already linked its native columns; rename them the way a Dutch database shows them.
        columns = project.type_ids.sorted(lambda item: (item.sequence, item.id))
        self.assertEqual(len(columns), 4)
        for index, (column, (name, fold)) in enumerate(zip(columns, [
                ("To Do", False), ("In behandeling", False), ("Voltooid", False), ("Geannuleerd", True)]), 1):
            column.write({"name": name, "sequence": index * 5, "fold": fold})
        stage = columns[:1]
        original_columns = columns.read(["name", "sequence", "fold", "write_date"])
        manual = self.env["project.task"].with_context(**QUIET).create({
            "name": "Door planner ingevoerde taak", "project_id": project.id, "stage_id": stage.id,
            "description": "Niet vervangen", "date_deadline": datetime(2027, 1, 7, 12),
            "user_ids": [Command.set(self.sales_user.ids)]})
        fields = ["name", "description", "stage_id", "state", "date_deadline", "user_ids", "active", "write_date"]
        before = manual.read(fields)
        project._ensure_prefab_workflow(order)
        self.assertEqual(manual.read(fields), before)
        self.assertEqual(len(project.type_ids.filtered(lambda item: item.name in ("To Do", "Te doen"))), 1)
        self.assertTrue(columns <= project.type_ids)
        self.assertEqual(len(project.type_ids), 5)
        self.assertEqual(columns.read(["name", "sequence", "fold", "write_date"]), original_columns)
        generated = self._tasks(project) - manual
        completed = generated[:1]
        completed.write({"name": "Handmatig afgerond", "state": "1_done"})
        generated[1:2].write({"active": False})
        generated[2:3].unlink()
        milestone = project.milestone_ids[:1]
        milestone.write({"name": "Handmatig vrijgegeven", "is_reached": True})
        remaining = self._tasks(project)
        task_state = remaining.read(fields)
        milestone_state = project.milestone_ids.read(["name", "is_reached", "reached_date", "write_date"])
        project._ensure_prefab_workflow(order)
        order.locked = False
        order.with_context(**QUIET)._action_cancel()
        order.with_context(**QUIET).action_draft()
        order.with_context(**QUIET).action_confirm()
        self.assertEqual(self._tasks(project).ids, remaining.ids)
        self.assertEqual(remaining.read(fields), task_state)
        self.assertEqual(project.milestone_ids.read(["name", "is_reached", "reached_date", "write_date"]), milestone_state)

    def test_native_template_edits_apply_to_new_projects_and_not_existing_plans(self):
        template = self.company._ensure_prefab_project_template()
        custom = self.env["project.task"].with_context(**QUIET).create({
            "name": "Eigen controle uit projectsjabloon", "project_id": template.id,
            "stage_id": template.type_ids[:1].id, "milestone_id": template.milestone_ids[:1].id})
        first = self._order()
        first.with_context(**QUIET).action_confirm()
        copied = self._tasks(first.project_id).filtered(lambda task: task.name == custom.name)
        self.assertEqual(len(copied), 1)
        custom.name = "Bijgewerkte controle voor volgende projecten"
        second = self._order()
        second.with_context(**QUIET).action_confirm()
        self.assertEqual(copied.name, "Eigen controle uit projectsjabloon")
        self.assertEqual(len(self._tasks(second.project_id).filtered(lambda task: task.name == custom.name)), 1)
        self.assertEqual(first.project_id.prefab_workflow_template_id, second.project_id.prefab_workflow_template_id)

    def test_foreign_template_and_reusing_a_project_for_another_order_are_rejected(self):
        other_company = self.env["res.company"].create({"name": "Other workplan company"})
        foreign = self.env["project.project"].sudo().with_company(other_company).create({
            "name": "Foreign template", "company_id": other_company.id, "is_template": True})
        with self.assertRaises((ValidationError, UserError)), self.cr.savepoint():
            self.company.prefab_project_template_id = foreign
        first, second = self._order(), self._order()
        first.with_context(**QUIET).action_confirm()
        second.with_context(**QUIET).action_confirm()
        with self.assertRaises(UserError):
            first.project_id._ensure_prefab_workflow(second)

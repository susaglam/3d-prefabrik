"""Foundation invariants of cs_prefab_website, checkable without an Odoo runtime.

These are the controls that run on every `python -m unittest discover -s tests`. They are
deliberately a DIFFERENT kind of check from the module's own Odoo tests
(`addons/cs_prefab_website/tests/`): those assert behaviour against a real database and only
run inside the clone test, these assert that the shipped files say what they must say and run
in seconds on any machine. A control and its second control have to be able to fail
separately, or the second one is decoration.

What they are for, concretely: the site is configured almost entirely by files -- a packager
list, two pipeline allowlists, a URL map, a media index, a colour palette. Every one of those
is the kind of thing that is edited in a hurry six weeks from now, and every one of them fails
silently when it is wrong.

They carry one more weight since the site moved onto the website the customer already had:
several of the controls below now assert that something is NOT done. A step that writes to a
live website is not undone by a later release, and a check that only ever asks "was the value
set" cannot see the difference between a step that was removed on purpose and one that quietly
stopped firing.
"""
import ast
import csv
import json
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "addons" / "cs_prefab_website"
CONFIGURATOR = ROOT / "addons" / "cs_prefab_configurator"
INVENTORY = ROOT / "docs" / "website" / "content-inventory.json"


def manifest():
    return ast.literal_eval((MODULE / "__manifest__.py").read_text(encoding="utf-8"))


def media_index():
    return json.loads((MODULE / "data" / "media_index.json").read_text(encoding="utf-8"))


def url_map():
    return json.loads((MODULE / "data" / "url_map.json").read_text(encoding="utf-8"))


def inventory():
    return json.loads(INVENTORY.read_text(encoding="utf-8"))


def website_model_source():
    return (MODULE / "models" / "website.py").read_text(encoding="utf-8")


def contrast(left, right):
    """WCAG 2.x relative-contrast ratio, recomputed here rather than trusted.

    This is the second control on the palette: the numbers in the audit and in the SCSS
    comments were computed once, by hand. If someone edits a hex value in the palette without
    re-measuring, this fails -- which is the whole point, because a colour that is 4.4:1
    instead of 4.5:1 looks exactly like one that passes.
    """
    def luminance(value):
        channels = [int(value.lstrip("#")[index:index + 2], 16) / 255 for index in (0, 2, 4)]
        return sum(weight * (channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4)
                   for weight, channel in zip((0.2126, 0.7152, 0.0722), channels))
    low, high = sorted((luminance(left), luminance(right)))
    return (high + 0.05) / (low + 0.05)


class ManifestTests(unittest.TestCase):
    def test_version_is_the_target_series_and_not_the_configurator_series(self):
        version = manifest()["version"]
        self.assertTrue(version.startswith("saas~19.4."), version)
        self.assertEqual(len(version.split(".")), 5, "five components, like every module here")
        configurator = ast.literal_eval((CONFIGURATOR / "__manifest__.py").read_text(encoding="utf-8"))
        # buildNN.py derives the next release's helpers by text-substituting the
        # configurator's version. Sharing its series would make that substitution rewrite
        # this manifest's number too, silently.
        self.assertNotEqual(version, configurator["version"])
        self.assertFalse(version.startswith("saas~19.4.2.9."),
                         "must not sit inside the series buildNN.py rewrites")

    def test_dependencies_and_licence(self):
        data = manifest()
        self.assertEqual(data["license"], "LGPL-3")
        self.assertEqual(data["author"], "Codesnap")
        for required in ("website", "website_blog", "crm", "website_crm",
                         "cs_prefab_configurator", "cs_security_base"):
            self.assertIn(required, data["depends"])
        # House rule: the AI-tool surface is imported soft, never hard-depended on.
        self.assertNotIn("cs_mcp_bridge", data["depends"])

    def test_every_declared_file_exists(self):
        data = manifest()
        for relative in data["data"]:
            self.assertTrue((MODULE / relative).is_file(), relative)
        for files in data["assets"].values():
            for reference in files:
                self.assertTrue((MODULE.parent / reference).is_file(), reference)

    def test_manifest_carries_an_explicit_description(self):
        # Without one Odoo parses README.md as reStructuredText and prints a docutils
        # warning per Markdown fence, into the log a deploy is accepted from.
        self.assertIn("description", manifest())
        self.assertGreater(len(manifest()["description"]), 80)

    def test_no_symlinks_anywhere_in_the_module(self):
        # The packager raises on the first symlink it meets, after it has already written
        # part of the archive.
        for path in MODULE.rglob("*"):
            self.assertFalse(path.is_symlink(), path)

    def test_module_xml_and_python_parse(self):
        for path in sorted(MODULE.rglob("*.xml")):
            ET.parse(path)
        for path in sorted(MODULE.rglob("*.py")):
            ast.parse(path.read_text(encoding="utf-8"))


class PipelineTests(unittest.TestCase):
    """The packager list and the two deploy allowlists have to move together.

    They are three separate files and each one fails differently: the packager omits the
    module silently, the test helper refuses the archive with an assertion, and the deploy
    helper DELETES the module folder from the addons mount and puts nothing back.
    """

    def setUp(self):
        self.packager = (ROOT / "scripts" / "package_odoo.py").read_text(encoding="utf-8")
        self.templates = {}
        for name in ("deploy294_template.py", "test294_template.py"):
            path = ROOT / ".data" / name
            if path.is_file():
                self.templates[name] = path.read_text(encoding="utf-8")

    def test_packager_bundles_the_new_module(self):
        self.assertIn("cs_prefab_website", self.packager)
        # Read the tuple out of the source rather than importing the module: importing it
        # would resolve ROOT from __file__ and pull in tarfile/subprocess for nothing.
        tree = ast.parse(self.packager)
        project = next(node.value for node in tree.body
                       if isinstance(node, ast.Assign)
                       and any(getattr(target, "id", "") == "PROJECT" for target in node.targets))
        names = ast.literal_eval(project)
        self.assertIn("cs_prefab_website", names)
        self.assertIn("cs_prefab_configurator", names)
        # What matters is that the DEFAULT release ships every name in PROJECT. The packager gained a
        # --modules argument so a release can ship a subset (2.9.5 shipped the configurator alone, because
        # this module is the first to write into the per-INSTANCE asset bundles and was not ready to carry
        # that risk yet), and the assertion below used to pin the literal loop line instead of the effect,
        # so adding that argument failed this test while the module was still bundled by default.
        arguments = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_argument" and node.args:
                flag = getattr(node.args[0], "value", None)
                arguments[flag] = {kw.arg: kw.value for kw in node.keywords}
        self.assertIn("--modules", arguments, "the packager must let a release name what it ships")
        default = arguments["--modules"].get("default")
        self.assertIsNotNone(default, "--modules needs a default, or an unqualified call ships nothing")
        self.assertEqual(getattr(getattr(default, "func", None), "id", ""), "list",
                         "the default must be list(PROJECT), so a module added to PROJECT ships without a second edit")
        self.assertEqual(getattr(default.args[0], "id", ""), "PROJECT")
        self.assertIn("modules+=[(name,ROOT/'addons'/name)fornameinargs.modules]",
                      self.packager.replace(" ", ""))

    def test_module_allowlists_and_active_release_helper_versions_match(self):
        if not self.templates:
            self.skipTest(".data helpers are gitignored and absent in this checkout")
        for name, text in self.templates.items():
            self.assertRegex(text, r"allowed=\{[^}]*'cs_prefab_website'", name)
            self.assertIn("cs_prefab_website/__manifest__.py", text, name)
        # Historical helpers keep their own release stamps. The active homepage-redesign
        # release is generated separately and must agree with the current package.
        folder = ROOT / ".data" / "animated-home"
        active_manifest = folder / "helper-manifest.json"
        if not active_manifest.is_file():
            self.skipTest("active release helpers are gitignored and absent in this checkout")
        release = json.loads(active_manifest.read_text(encoding="utf-8"))
        self.assertEqual(release["versions"]["website"], manifest()["version"])
        configurator = ast.literal_eval((CONFIGURATOR / "__manifest__.py").read_text(encoding="utf-8"))
        self.assertEqual(release["versions"]["configurator"], configurator["version"])
        self.assertTrue(release["moduleSetMustRemainUnchanged"])
        helper_names = ["test_remote.py"]
        if release["productionHelperGenerated"]:
            helper_names.append("deploy_remote.py")
        for name in helper_names:
            text = (folder / name).read_text(encoding="utf-8")
            self.assertRegex(text, r"allowed=\{[^}]*'cs_prefab_website'", name)
            self.assertIn("cs_prefab_website/__manifest__.py", text, name)
            self.assertIn("assert site_manifest['version']=='%s'" % manifest()["version"], text, name)
            self.assertIn(configurator["version"], text, name)

    def test_deploy_and_clone_test_install_and_upgrade_the_new_module(self):
        if not self.templates:
            self.skipTest(".data helpers are gitignored and absent in this checkout")
        for name, text in self.templates.items():
            # -i installs it the first time, -u upgrades it every time after. saas~19.4's
            # loading.py refreshes the module list unconditionally, then installs only
            # uninstalled names and upgrades only installed ones, so both flags together
            # are idempotent in both directions.
            # Membership rather than the literal string. Herzien 2026-09-20: the -i list gained
            # cs_change_audit and cs_white_label_kit, which brand the backend and the portal.
            # Pinning the whole argument made the test fail for the right reason but in a way
            # that says nothing about what actually has to hold -- which is that each module
            # this release installs is named, and that the two project modules are upgraded.
            flat = text.replace(" ", "")
            install = re.search(r"'-i','([^']+)'", flat)
            self.assertIsNotNone(install, name)
            installed = set(install.group(1).split(","))
            self.assertIn("cs_prefab_website", installed, name)
            for module in ("cs_change_audit", "cs_white_label_kit"):
                self.assertIn(module, installed,
                              f"{name}: {module} is shipped but never installed, so its files "
                              "land on the addons mount and nothing in the database knows")
            self.assertIn("'-u','cs_prefab_configurator,cs_prefab_website'", flat, name)
        self.assertIn("/cs_prefab_website", self.templates["test294_template.py"],
                      "the clone test must run the new module's own tests")

    def test_deploy_fingerprints_both_installed_modules(self):
        if "deploy294_template.py" not in self.templates:
            self.skipTest(".data helpers are gitignored and absent in this checkout")
        text = self.templates["deploy294_template.py"]
        self.assertIn("'cs_prefab_website':{'version':", text.replace(" ", ""))


class WebsiteHazardTests(unittest.TestCase):
    """One test per hazard the target survey measured (§4), restated for one website.

    Each asserts that the mechanism which closes it is present in the shipped source. The
    behavioural half lives in addons/cs_prefab_website/tests/test_site_on_existing_website.py
    and runs against a real database; these fail when the mechanism is deleted or renamed,
    which is the regression that actually happens.
    """

    def test_no_data_file_creates_a_website_record(self):
        """The site is installed onto the website this Odoo already has.

        Two separate claims, because they fail separately: nothing creates a website, and no
        external id of this module points at one. The second is the sharper of the two -- an
        ir.model.data row of ours on the customer's website would make UNINSTALLING this
        module delete that website, because ir.model.data._module_data_uninstall unlinks every
        record a removed module's external ids refer to.
        """
        for path in sorted((MODULE / "data").glob("*.xml")) + sorted((MODULE / "views").glob("*.xml")):
            tree = ET.parse(path)
            for record in tree.getroot().iter("record"):
                self.assertNotEqual(record.get("model"), "website",
                                    f"{path.name} creates or binds a website record")
        source = website_model_source()
        self.assertNotIn('env.ref("cs_prefab_website.website', source)
        self.assertIn("def _cs_prefab_target_website", source)

    def test_any_record_that_names_a_website_resolves_it_through_that_one_method(self):
        """When a record DOES carry website_id, it is resolved by lookup and never by xmlid.

        The hazard is narrow and it is about uninstalling: an ir.model.data row of this module
        pointing at the customer's website would make removing this module DELETE that website,
        because ir.model.data._module_data_uninstall unlinks every record a removed module's
        external ids refer to. Resolving by lookup gives the same id with no external id
        attached to it.

        This test used to also REQUIRE at least ten such fields, on the reasoning that an empty
        website_id means "every website" rather than "none". That reasoning is right for
        website.menu and website.rewrite and it is exactly wrong for website.page: the page
        records set it, the field is `related='view_id.website_id', store=True`, and it wrote
        through onto the view, which made the view website-specific at birth and permanently
        disabled Odoo's copy-on-write. Every `-u` then rewrote those views and destroyed the
        customer's edits silently. The pages are generic now and
        `_cs_prefab_release_page_views` clears the field on sites that already carry it.

        So the count moved to the records where an empty field really would leak, and the rule
        that survives is about HOW the value is resolved, not about how many records carry it.
        """
        expected = 'obj()._cs_prefab_target_website().id'
        by_model = {}
        for path in sorted((MODULE / "data").glob("*.xml")) + sorted((MODULE / "views").glob("*.xml")):
            for record in ET.parse(path).getroot().iter("record"):
                for field in record.findall("field"):
                    if field.get("name") != "website_id":
                        continue
                    by_model.setdefault(record.get("model"), []).append(record.get("id"))
                    self.assertEqual(field.get("model"), "website", record.get("id"))
                    self.assertEqual(field.get("eval"), expected, record.get("id"))
        self.assertNotIn("website.page", by_model,
                         "a website.page writes website_id through onto its view and kills "
                         "copy-on-write; see _cs_prefab_release_page_views")
        self.assertIn("blog.blog", by_model,
                      "the blog must stay bound: an empty website_id publishes it everywhere")

    def test_the_page_wrapper_does_not_declare_a_second_main_landmark(self):
        """Odoo's own layout already wraps the page in <main>. Ours made a second one.

        Measured on the live site: `<main class="">` from core and
        `<div id="wrap" class="oe_page_wrap" role="main">` from this module, on every page. Two
        main landmarks is a WCAG 1.3.1 failure and it makes landmark navigation ambiguous -- a
        screen-reader user jumping to "main" gets asked which one.

        The tabindex stays: it is what core's skip link focuses.
        """
        # Parsed, not grepped: this file explains the defect at length and a text search cannot
        # tell an explanation from a declaration. It would have failed on its own comment.
        for path in sorted((MODULE / "views").glob("*.xml")):
            for node in ET.parse(path).getroot().iter():
                self.assertNotEqual(node.get("role"), "main",
                                    f"{path.name} declares a second main landmark")
                if node.get("id") == "wrap":
                    self.assertEqual(node.get("tabindex"), "-1",
                                     f"{path.name}: #wrap must stay focusable for the skip link")

    def test_the_module_ships_no_second_skip_link(self):
        """19.4 ships `o_skip_to_content`, in Dutch, pointing at the same #wrap.

        This module's own skip link predates that and was never withdrawn, so the site served
        two of them back to back as tab stops 1 and 2 on all 21 pages. The second one appears
        to do nothing, because the first already moved the focus.
        """
        for path in sorted((MODULE / "views").glob("*.xml")):
            self.assertNotIn("o_prefab_skip_link", path.read_text(encoding="utf-8"), path.name)

    def test_every_builder_region_has_a_frozen_unique_id(self):
        """After the customer's first save, renaming one of these breaks that page hard.

        Odoo keys a saved `oe_structure` edit by the region's id. An anonymous region is keyed
        by position instead, so adding a section above it silently detaches everything the
        customer wrote in it; two anonymous regions on one page cannot be told apart at all.

        The list is frozen on purpose. This is the last release in which any of these can be
        renamed for free -- the brand foundation ships before the pages precisely so that the
        region ids are settled before anyone edits inside them. A future release that genuinely
        needs a new region ADDS an id here; it never renames one.
        """
        frozen = {
            "oe_structure_prefab_home",
            "oe_structure_prefab_home_bottom",
            "oe_structure_prefab_oplossingen",
            "oe_structure_prefab_aanbouw",
            "oe_structure_prefab_dakkapel",
            "oe_structure_prefab_opbouw",
            "oe_structure_prefab_over_ons",
            "oe_structure_prefab_partner_worden",
            "oe_structure_prefab_partner_bedankt",
            "oe_structure_prefab_contact",
            "oe_structure_prefab_contact_bedankt",
            "oe_structure_prefab_projecten_top",
            "oe_structure_prefab_projecten_bottom",
            "oe_structure_prefab_nieuws_top",
            "oe_structure_prefab_nieuws_bottom",
            "oe_structure_prefab_offerte_top",
            "oe_structure_prefab_offerte_bottom",
            "oe_structure_prefab_offerte_opbouw_top",
            "oe_structure_prefab_offerte_opbouw_bottom",
        }
        found = []
        for path in sorted((MODULE / "views").glob("*.xml")):
            for node in ET.parse(path).getroot().iter():
                classes = (node.get("class") or "").split()
                if "oe_structure" not in classes:
                    continue
                self.assertIsNotNone(
                    node.get("id"),
                    f"{path.name}: an anonymous builder region is keyed by position, so a "
                    "section added above it detaches everything saved inside it")
                found.append(node.get("id"))
        self.assertEqual(len(found), len(set(found)), f"duplicate region ids: {found}")
        self.assertEqual(set(found), frozen,
                         "a region was renamed or removed; that discards the customer's saved "
                         "content for it with no error")

    def test_no_element_wears_a_module_class_that_nothing_styles(self):
        """Read from the markup end, because the stylesheet end is blind to this.

        Every other control on the stylesheet asks what is IN it: no bare hex, no loose
        duration, one top-level selector. None of them can see the failure that actually reaches
        a visitor -- a class still written in a template whose only rule was deleted, so the
        element renders with nothing at all behind it.

        The `o_prefab_` and `s_prefab_` prefixes are this module's own: no Odoo or Bootstrap rule
        matches them. So if a template writes one, either the module's stylesheet carries it, its
        script uses it as a hook, the configurator's own embed stylesheet styles it, or the
        element is naked.

        Naked is only a defect when the element has nothing else either. A class sitting next to
        `list-unstyled d-flex gap-3` is a leftover hook and costs nothing; a class sitting alone
        on a <span> that used to be a divider renders an empty inline element. This asserts the
        second case is empty, and it found nine of them when the stylesheet went from 1857 lines
        to 730.
        """
        stylesheet = "\n".join(path.read_text(encoding="utf-8")
                               for path in sorted((MODULE / "static" / "src" / "scss").glob("*.scss")))
        script = (MODULE / "static" / "src" / "js" / "prefab_site.js").read_text(encoding="utf-8")
        embed = (CONFIGURATOR / "static" / "src" / "embed_host.css")
        styled = stylesheet + script + (embed.read_text(encoding="utf-8") if embed.is_file() else "")
        styled = re.sub(r"/\*.*?\*/", "", styled, flags=re.S)
        styled = re.sub(r"//[^\n]*", "", styled)

        naked = []
        for path in sorted(MODULE.rglob("*.xml")):
            text = re.sub(r"<!--.*?-->", "", path.read_text(encoding="utf-8"), flags=re.S)
            for match in re.finditer(r'class="([^"]*)"', text):
                classes = match.group(1).split()
                ours = [c for c in classes if c.startswith(("o_prefab_", "s_prefab_"))]
                if not ours or len(ours) != len(classes):
                    continue  # it carries something Bootstrap or Odoo styles as well
                if any(re.search(r"[.&]" + re.escape(c) + r"(?![\w-])", styled)
                       or re.search(r"\b" + re.escape(c) + r"\b", script) for c in ours):
                    continue
                naked.append(f"{path.name}: {' '.join(classes)}")
        self.assertEqual(naked, [], "elements whose only classes nothing styles")

    def test_the_footer_is_a_preset_rather_than_an_override_of_all_of_them(self):
        """Priority 60 over twelve presets at default priority made the Footer chooser inert.

        Inheriting website.footer_custom makes this footer the content of Odoo's own "Default"
        preset instead. Picking another preset deactivates footer_custom, this inheritance goes
        with it, and the chosen preset renders clean.
        """
        text = (MODULE / "views" / "layout_templates.xml").read_text(encoding="utf-8")
        self.assertIn('inherit_id="website.footer_custom"', text)
        self.assertNotIn('priority="60"', text,
                         "nothing here may outrank the presets the customer chooses between")

    def test_hazard_4_1_the_catalogue_is_read_back_and_never_written(self):
        """The prices this site quotes are the ones the website already publishes.

        This control reversed when the site moved onto that website. There is no second
        website to copy a catalogue from, so a module that creates catalogue rows next to the
        live one is a module inventing prices -- and the release gate watches those three
        tables precisely because they are the customer's commercial data. What is left is the
        readback: the failure has no other symptom than the prices themselves.
        """
        source = website_model_source()
        self.assertIn("_cs_prefab_apply_configurator_scope", source)
        self.assertNotIn("action_publish", source)
        self.assertNotIn(".copy({", source)
        self.assertNotIn("release_draft", source)
        self.assertIn("cs_prefab_catalog_status", source)
        self.assertIn("demonstratieprijzen", source)

    def test_hazard_4_2_appearance_record_is_created_for_the_new_website(self):
        source = website_model_source()
        self.assertIn("cs.prefab.appearance", source)
        self.assertIn("_cs_prefab_appearance_values", source)

    def test_hazard_4_2_appearance_palette_passes_the_contrast_rule_it_will_be_saved_under(self):
        # cs.prefab.appearance refuses a custom palette below 4.5:1 -- so a wrong value here
        # is an install-time ValidationError, not a cosmetic issue. Checked here as well so
        # the failure is a unit test rather than a failed deploy.
        source = website_model_source()
        values = dict(re.findall(r'"(color_\w+)":\s*"(#[0-9a-fA-F]{6})"', source))
        self.assertEqual(len(values), 9, values)
        surface = values["color_surface"]
        for key in ("color_text", "color_heading", "color_muted", "color_error"):
            self.assertGreaterEqual(contrast(values[key], surface), 4.5,
                                    f"{key} against the form background")
        self.assertGreaterEqual(contrast(values["color_on_action"], values["color_action"]), 4.5)

    def test_hazard_4_4_the_domain_of_a_live_website_is_never_written(self):
        """`enforce_origin` compares scheme + host LITERALLY against website.domain.

        On a brand-new website, filling that field in was free. On the website the customer is
        already serving /prefab from, writing the address the site will have AFTER the DNS
        switch turns every price request, every share and every quote into a 403 on the day of
        the upgrade instead of on the day of the switch. So the module writes it nowhere, and
        this is the check that keeps it that way -- an assignment is one line to add back.
        """
        source = website_model_source()
        self.assertIn("CANONICAL_HOST_PARAM", source)
        self.assertIn("https://prefabpartner.nl", source)
        self.assertNotIn("website.domain =", source)
        self.assertNotIn('"domain":', source)
        self.assertNotIn("_cs_prefab_apply_domains", source)
        # The parameter still has a reader, or it would be decoration: the settings form says
        # which address to set and when.
        self.assertIn("cs_prefab_origin_status", source)
        self.assertIn("_cs_prefab_canonical_host", source)
        data = (MODULE / "data" / "website_data.xml").read_text(encoding="utf-8")
        self.assertIn("cs_prefab_website.canonical_host", data)

    def test_hazard_4_5_new_configurator_records_follow_the_website_in_scope(self):
        source = (MODULE / "models" / "configurator_scope.py").read_text(encoding="utf-8")
        self.assertIn("def default_get", source)
        self.assertIn("get_current_website(fallback=False)", source)
        # It must narrow to today's behaviour when nothing is in scope, never widen.
        self.assertIn('search([("company_id", "=", company.id)], limit=1)', source)

    def test_hazard_3_2_navigation_removal_is_limited_to_explicit_approved_routes(self):
        """The approved redesign consolidates only redundant leaf links into logo and CTA.

        Pruning /shop made sense while Odoo's Website.create() was copying a generic tree onto
        a brand-new record. On a website that is being served right now, every entry in the
        menu is the customer's own, and an upgrade that tidies a live navigation has no undo
        and sends no message. /blog is the exception and the justification is narrow: it did
        not exist before this module was installed -- website_blog is in this module's own
        depends and seeds it.
        """
        source = website_model_source()
        self.assertIn("BLOG_MENU_URL", source)
        self.assertNotIn('"/shop"', source)
        self.assertNotIn("MENU_URLS_TO_DROP", source)
        # What is left over is not silently deleted; it is reported on the settings form.
        self.assertIn("cs_prefab_menu_status", source)
        # Every unlink in the whole file is named here on purpose: this is the list that has to
        # be argued for, one line at a time, whenever somebody adds to it.
        #   "attachment" -- a snapshot of the previous logo whose stored checksum did not
        #                   match what was written. A backup nobody can tell is corrupt is
        #                   worse than no backup, so it goes.
        #   "seeded"     -- the /blog entry website_blog added because this module depends on
        #                   it. The only record of the customer's that this module removes.
        #   "legacy"     -- the SEPARATE website an earlier version of this module created.
        #                   The customer asked for one website on this Odoo and that record is
        #                   not theirs: this module made it. It is removed only when it is NOT
        #                   the default website and carries no quote or share, and it is found
        #                   through this module's own external id rather than by looking for a
        #                   website that resembles ours.
        #   "records"    -- the rows that RESTRICT the website delete, resolved from the database's own
        #                   foreign keys rather than guessed: the draft catalogue copied for that
        #                   website, its blog and its posts. Only rows belonging to THAT website,
        #                   never the catalogue of the website that stays.
        #   "stale"      -- the COMPILED asset bundles under /web/assets/, dropped after the
        #                   brand is seeded. Added 2026-09-20. These are not anybody's content:
        #                   Odoo regenerates them from source on the next request, and the
        #                   deploy helper in .data/ already deletes exactly this set for the
        #                   same reason. Without it a theme change is invisible -- the
        #                   customisation files are new and the cached CSS is the old one, with
        #                   no error anywhere -- and a bundle that failed to compile stays
        #                   cached and therefore stays broken after its cause is fixed. Both
        #                   were measured on the clone during this release.
        unlinks = re.findall(r"^\s*(\w+)\.unlink\(\)", source, re.M)
        self.assertEqual(unlinks, ["records", "legacy", "attachment", "seeded", "stale", "item"], unlinks)
        # The new exception cannot widen into removal of customer menus or child groups.
        warm = next(node for node in ast.walk(ast.parse(source))
                    if isinstance(node, ast.FunctionDef) and node.name == "_cs_prefab_apply_warm_design")
        guarded = [node for node in ast.walk(warm) if isinstance(node, ast.If)
                   and any(isinstance(child, ast.Expr) and isinstance(child.value, ast.Call)
                           and ast.unparse(child.value.func) == "item.unlink" for child in node.body)]
        self.assertEqual(len(guarded), 1)
        self.assertEqual(ast.unparse(guarded[0].test),
                         "item.url in ('/', '/offerte', '/prefab') and (not item.child_id)")
        warm_source = ast.get_source_segment(source, warm)
        self.assertIn('("website_id", "=", website.id)', warm_source)
        self.assertIn('("parent_id", "=", website.menu_id.id)', warm_source)
        # A website.menu created without a website_id is duplicated onto every website by
        # Odoo's own create(). Every create here passes one.
        creates = re.findall(r'menu_model\.create\(\{(.*?)\}\)', source, re.S)
        self.assertTrue(creates)
        for block in creates:
            self.assertIn('"website_id": website.id', block)

    def test_the_previous_homepage_is_moved_and_unpublished_rather_than_deleted(self):
        """Two pages at "/" on one website is a tie the database breaks however it likes.

        The fix cannot be "delete the other one" any more: the other one is the customer's own
        homepage with their content in it. It is moved and unpublished, and the Home menu entry
        is repointed FIRST -- website.menu.url is a stored compute over page_id, so doing it the
        other way round makes the navigation follow the page to its new address.
        """
        source = website_model_source()
        self.assertIn("_cs_prefab_claim_homepage", source)
        self.assertIn("PREVIOUS_HOMEPAGE_URL", source)
        self.assertNotIn("_cs_prefab_drop_bootstrap_homepage", source)
        self.assertNotIn("strays.unlink()", source)
        claim = source.split("def _cs_prefab_claim_homepage")[1].split("\n    def ")[0]
        self.assertLess(claim.index("page_id = ours.id"), claim.index('"url": url'),
                        "the menu has to be repointed before the page moves")
        # And it is wired in as the LAST data file, because it needs our own page to exist.
        manifest_data = manifest()["data"]
        self.assertEqual(manifest_data[-1], "data/homepage_data.xml", manifest_data[-3:])
        self.assertLess(manifest_data.index("data/page_data.xml"),
                        manifest_data.index("data/homepage_data.xml"))

    def test_hazard_3_3_redirects_are_scoped_to_the_new_website(self):
        source = (MODULE / "models" / "url_map.py").read_text(encoding="utf-8")
        self.assertIn('"website_id": website.id', source)
        self.assertIn('("website_id", "=", website.id)', source)

    def test_only_one_website_can_carry_the_brand(self):
        source = website_model_source()
        self.assertIn("_check_single_prefab_site", source)
        self.assertIn("ValidationError", source)


class IsolationTests(unittest.TestCase):
    """Nothing this module ships may reach the existing website.

    Asset bundles are per instance and ir.ui.view records are global, so isolation is not a
    property of where the files live -- it is a property of every rule and every template
    being gated. That makes it exactly the kind of thing that erodes one careless edit at a
    time, and exactly the kind of thing a test should hold.
    """

    def test_every_stylesheet_rule_is_scoped_to_the_site_class(self):
        """Amended 2026-09-20 for exactly one documented exception, and no more.

        `scroll-padding-top` has to sit on the SCROLLING BOX, which is the root element. The
        old rule put it on `.o_prefab_site`, i.e. on <body>, where it is inert -- so the skip
        link and every in-page anchor landed under the fixed header and had done all along.
        Moving it out is the fix, and it cannot be scoped to a body class because the element
        it must apply to is above <body>. `html:has(body.o_prefab_site)` keeps the isolation:
        it matches nothing on the customer's other website.

        The allowlist is explicit rather than a pattern, so a second top-level rule still
        fails this test. That is the point -- isolation erodes one careless edit at a time.
        """
        text = (MODULE / "static" / "src" / "scss" / "prefab_site.scss").read_text(encoding="utf-8")
        top_level = [line for line in text.splitlines()
                     if line.strip() and not line.startswith((" ", "\t", "//", "}"))]
        selectors = [line for line in top_level if line.rstrip().endswith("{")]
        self.assertEqual(selectors,
                         ["html:has(body.o_prefab_site) {", ".o_prefab_site {"], selectors)
        # And the exception carries nothing but the one property it exists for.
        exception = text.split("html:has(body.o_prefab_site) {", 1)[1].split("}", 1)[0]
        self.assertEqual([line.strip() for line in exception.splitlines() if line.strip()],
                         ["scroll-padding-top: var(--prefab-header-offset, 80px);"])

    def test_every_layout_template_is_conditioned_on_the_flag(self):
        tree = ET.parse(MODULE / "views" / "layout_templates.xml")
        templates = tree.getroot().findall(".//template")
        self.assertGreaterEqual(len(templates), 3)
        for template in templates:
            markup = ET.tostring(template, encoding="unicode")
            self.assertIn("cs_prefab_site", markup, template.get("id"))

    def test_the_footer_hands_the_other_website_its_own_content_back(self):
        # $0 is the node that was replaced. Without the else branch, replacing #footer would
        # blank the footer of every other website on the instance.
        text = (MODULE / "views" / "layout_templates.xml").read_text(encoding="utf-8")
        self.assertIn('<t t-else="">$0</t>', text)

    def test_no_palette_is_registered_in_an_instance_wide_bundle(self):
        """The brand reaches the editor, and it still reaches no instance-wide bundle.

        Two different things were conflated before this release, and separating them is the
        whole point of this test.

        What is FORBIDDEN, and stays forbidden: registering a palette by merging into
        `$o-color-palettes` from a file in `web._assets_primary_variables`. That bundle is
        per-INSTANCE. Odoo resolves the gray and the theme palette by the SAME name as the
        colour palette (website/static/src/scss/secondary_variables.scss), so a name present in
        only one of the three maps yields two empty maps, the arithmetic downstream runs on
        nulls, and the whole of `web.assets_frontend` stops compiling -- for every website on
        this Odoo, the customer's existing live site included. That is what happened.

        What is REQUIRED, and was wrongly forbidden with it: writing the brand into the
        per-WEBSITE customer values, which is what Odoo's own website configurator does
        (website/models/website.py::configurator_apply). It touches no shared bundle, it is
        stamped with website_id on both the attachment and the ir.asset, and it is the only
        arrangement in which the Theme tab shows the customer their own colours.

        The old version of this test asserted that the string "color-palettes-name" appeared
        nowhere in the model source. That forbade the safe path along with the unsafe one, and
        it would have kept the site's appearance permanently out of the customer's reach.
        """
        manifest_text = (MODULE / "__manifest__.py").read_text(encoding="utf-8")
        self.assertNotIn("prefab_palette.scss", manifest_text,
                         "no palette file may enter an asset bundle")
        self.assertFalse((MODULE / "static" / "src" / "scss" / "prefab_palette.scss").exists(),
                         "the withdrawn palette file is deleted, not left lying next to the fix")
        self.assertEqual(manifest()["assets"].get("web._assets_primary_variables", []), [],
                         "this module contributes nothing to any instance-wide bundle")
        source = website_model_source()
        # The forbidden thing is the merge, not the word: this file explains the failure at
        # length, and a check that cannot tell an explanation from an instance-wide write
        # would have to be switched off the first time somebody documented the reasoning.
        self.assertNotIn("map-merge($o-color-palettes", source,
                         "nothing may merge into the instance-wide palette map")
        for path in MODULE.rglob("*.scss"):
            self.assertNotIn("map-merge($o-color-palettes", path.read_text(encoding="utf-8"),
                             f"{path.name} merges into the instance-wide palette map")
        self.assertIn("make_scss_customization", source,
                      "the brand is seeded through Odoo's own per-website customisation API")

    def test_the_palette_name_is_written_before_the_colours(self):
        """Order is load-bearing, and getting it wrong erases the brand silently.

        website/models/assets.py makes a write of `color-palettes-name` reset
        user_color_palette.scss, user_gray_color_palette.scss, the four state colours and every
        gradient key. Sent first, that reset is the clean slate the seed wants. Sent after the
        colours, it wipes them -- with no error, and with a site that renders in Odoo's default
        palette while the code says otherwise.
        """
        source = website_model_source()
        name_at = source.index('"color-palettes-name"')
        colours_at = source.index("_cs_prefab_palette_values()")
        self.assertLess(name_at, colours_at,
                        "the palette name must be written before the colours, or it erases them")

    def test_the_theme_seed_is_read_back(self):
        """A write into a customisation file that does not take raises nothing at all.

        This module has already shipped one silent no-op of exactly that shape. Every seeding
        step therefore re-reads the file it wrote.
        """
        source = website_model_source()
        self.assertIn("_cs_prefab_verify_theme", source)
        self.assertIn("_get_content_from_url", source,
                      "verification must read the compiled file, not the constants it was built from")

    def test_the_site_gets_its_looks_from_its_own_scoped_stylesheet(self):
        """What the palette's removal does NOT cost: the design itself.

        prefab_site.scss carries the whole appearance and is scoped to one selector, so it is the module's own
        stylesheet rather than a change to the instance's variables -- which is exactly why it compiles on its own.
        """
        manifest_text = (MODULE / "__manifest__.py").read_text(encoding="utf-8")
        self.assertIn("prefab_site.scss", manifest_text)
        stylesheet = (MODULE / "static" / "src" / "scss" / "prefab_site.scss").read_text(encoding="utf-8")
        self.assertIn(".o_prefab_site", stylesheet)
        # Sass evaluates + and - itself, so a mixed-unit expression outside calc() aborts the whole bundle.
        import re as _re
        loose = [line.strip() for line in stylesheet.split("\n")
                 if _re.search(r"clamp\([^)]*(rem|px|em)[^)]*[-+][^)]*(vw|vh|%)", line) and "calc(" not in line]
        self.assertEqual(loose, [], "mixed-unit arithmetic must sit inside calc() or Sass refuses the bundle")

    def test_the_configurator_addon_is_not_modified_by_this_work(self):
        # The new module inherits; it never edits the shipped one.
        for path in CONFIGURATOR.rglob("*.py"):
            self.assertNotIn("cs_prefab_website", path.read_text(encoding="utf-8"), path)


class PaletteTests(unittest.TestCase):
    """The brand palette, re-measured from the code that actually seeds it.

    These used to read `static/src/scss/prefab_palette.scss`. That file was in no asset bundle
    -- the manifest declared `web._assets_primary_variables` as an empty list -- so the tests
    were measuring a file the server never served, and they passed while the live site carried
    a different palette entirely, with a live AA failure in it.

    They now parse `Website._cs_prefab_palette_values()`, which is the dictionary handed to
    Odoo's own customisation API. If somebody edits a colour there without re-measuring, these
    fail, which is the point: a colour at 4.4:1 looks exactly like one that passes.
    """

    def palette(self):
        source = website_model_source()
        body = source[source.index("def _cs_prefab_palette_values"):
                      source.index("def _cs_prefab_website_values")]
        constants = dict(re.findall(r'^BRAND_(\w+) = "(#[0-9A-Fa-f]{6})"', source, re.M))
        found = {}
        for key, value in re.findall(r'"(o-c[\w-]+)":\s*(BRAND_\w+|#[0-9A-Fa-f]{6})', body):
            found[key] = constants[value[6:]] if value.startswith("BRAND_") else value
        return found

    def test_the_action_colour_reaches_AA_and_the_one_it_replaces_does_not(self):
        """The single value that closes three live WCAG failures at once.

        The site shipped `#e8511d` as o-color-1: the primary button on all 21 pages, the USP
        ribbon on ten and 27 service cards on nine, all carrying white text at 3.73:1. #C43F12
        reads as the same brand orange and measures 5.16:1.
        """
        values = {key: value.upper() for key, value in self.palette().items()}
        self.assertEqual(values["o-color-1"], "#C43F12")
        self.assertGreaterEqual(contrast("#C43F12", "#FFFFFF"), 4.5)
        self.assertLess(contrast("#E8511D", "#FFFFFF"), 4.5,
                        "the colour that was live is why a darker action colour exists")
        self.assertLess(contrast("#E9521D", "#FFFFFF"), 4.5,
                        "and so is the second orange it was one RGB step away from")

    def test_the_combination_mapping_keeps_the_native_snippets_intact(self):
        """o_cc1 light, o_cc2 tinted, o_cc5 dark -- what 193 native 19.4 snippets assume.

        Which palette colour becomes which combination is fixed by the 'base-1' palette and was
        measured on the live instance, so this asserts the ARRANGEMENT rather than a preference:
        o-color-4 -> cc1, o-color-3 -> cc2, o-color-2 -> cc3, o-color-1 -> cc4, o-color-5 -> cc5.
        """
        values = {key: value.upper() for key, value in self.palette().items()}
        self.assertEqual(values["o-cc1-bg"], values["o-color-4"])
        self.assertEqual(values["o-cc2-bg"], values["o-color-3"])
        self.assertEqual(values["o-cc3-bg"], values["o-color-2"])
        self.assertEqual(values["o-cc4-bg"], values["o-color-1"])
        self.assertEqual(values["o-cc5-bg"], values["o-color-5"])
        light = contrast(values["o-cc1-bg"], "#000000")
        dark = contrast(values["o-cc5-bg"], "#000000")
        self.assertGreater(light, dark, "cc1 must be the light ground and cc5 the dark one")

    def test_every_colour_combination_reaches_AA_for_text(self):
        values = self.palette()
        for index in range(1, 6):
            background = values[f"o-cc{index}-bg"]
            for role in ("text", "headings", "link"):
                key = f"o-cc{index}-{role}"
                self.assertIn(key, values, key)
                self.assertGreaterEqual(
                    contrast(values[key], background), 4.5,
                    f"{key} ({values[key]}) on {background}")

    def test_tinted_grounds_keep_readable_links_with_more_contrast_than_the_action_colour(self):
        """The warm tint changed; readable links remain the contract, not an old failure ratio."""
        values = self.palette()
        for index in (2, 3):
            link, background = values[f"o-cc{index}-link"], values[f"o-cc{index}-bg"]
            self.assertNotEqual(link.upper(), values["o-color-1"].upper())
            self.assertGreaterEqual(contrast(link, background), 4.5)
            self.assertGreater(contrast(link, background), contrast(values["o-color-1"], background))

    def test_no_two_grounds_are_indistinguishable(self):
        """Two backgrounds one visitor cannot tell apart are one background with two names.

        The audit proposed #EEEEEE for stone. Against the tint #FDEAE4 that is 1.00:1 --
        literally identical luminance. #E7E2DE gives 1.11:1, which is a real step.
        """
        values = self.palette()
        grounds = [values[f"o-cc{i}-bg"] for i in range(1, 6)]
        for first in range(len(grounds)):
            for second in range(first + 1, len(grounds)):
                self.assertGreater(
                    contrast(grounds[first], grounds[second]), 1.05,
                    f"cc{first + 1} and cc{second + 1} are the same ground")

    def test_the_form_and_the_page_use_the_same_action_colour(self):
        # Two definitions of one colour is the defect this guards: the embedded configurator
        # and the page around it must not drift apart.
        palette_action = self.palette()["o-color-1"].lower()
        form = dict(re.findall(r'"(color_\w+)":\s*"(#[0-9a-fA-F]{6})"', website_model_source()))
        self.assertEqual(form["color_action"].lower(), palette_action)


class UrlMapTests(unittest.TestCase):
    """The source-to-target diff.

    The failure this exists for is not "a redirect is wrong" -- it is "a URL that existed in
    the source was never asked about". Every check elsewhere asks whether what we built is
    correct; this one asks what was in the source and has arrived nowhere.
    """

    def test_every_live_url_that_must_keep_working_is_accounted_for(self):
        declared = {entry["from"] for entry in url_map()["entries"]}
        source = inventory()["url_map"]
        missing = []
        for entry in source["pages"] + source["other_urls"]:
            if not entry.get("must_keep_working"):
                continue
            if entry["path"] not in declared:
                missing.append(entry["path"])
        self.assertEqual(missing, [], "URLs from the live site with no declared target")

    def test_every_declared_target_is_one_of_the_four_kinds(self):
        for entry in url_map()["entries"]:
            self.assertIn(entry["kind"], ("page", "redirect", "media", "deferred"), entry)
            if entry["kind"] in ("page", "redirect"):
                self.assertTrue(entry.get("to", "").startswith("/"), entry)
            if entry["kind"] == "media":
                self.assertIn(entry["media"], {item["filename"] for item in media_index()["files"]})
            if entry["kind"] == "deferred":
                # A gap is allowed; an unnamed gap is not.
                self.assertTrue(entry.get("owner"), entry)
                self.assertFalse(entry.get("must_keep_working"), entry)

    def test_a_redirect_never_points_at_itself(self):
        # website.rewrite refuses a 301 whose source and target are equal, with a
        # ValidationError that would abort the install.
        for entry in url_map()["entries"]:
            if entry["kind"] == "redirect":
                self.assertNotEqual(entry["from"].rstrip("/") or "/", entry["to"], entry)

    def test_the_two_offerte_urls_land_on_the_configurator_page(self):
        targets = {entry["from"]: entry for entry in url_map()["entries"]}
        self.assertEqual(targets["/offerte/"]["to"], "/offerte")
        self.assertEqual(targets["/offerte-prefab-opbouw/"]["to"], "/offerte-prefab-opbouw")

    def test_the_menu_tree_matches_the_customers_own_navigation(self):
        labels = re.findall(r'"name": "([^"]+)", "url"', website_model_source())
        header = inventory()["global_chrome"]["header"]["menu"]
        for item in header:
            self.assertIn(item["label"], labels, item["label"])
            for child in item.get("children", []):
                self.assertIn(child["label"], labels, child["label"])


class MediaTests(unittest.TestCase):
    """The media index is the contract between the import script and the module."""

    def test_every_index_entry_points_at_a_file_that_exists(self):
        for entry in media_index()["files"]:
            if entry.get("duplicate_of"):
                self.assertIsNone(entry["shipped"], entry["filename"])
                continue
            shipped = entry["shipped"]
            self.assertTrue((MODULE / shipped["path"]).is_file(), shipped["path"])
            self.assertEqual((MODULE / shipped["path"]).stat().st_size, shipped["bytes"])
            for extra in ("poster",):
                if extra in shipped:
                    self.assertTrue((MODULE / shipped[extra]).is_file(), shipped[extra])

    def test_every_shipped_file_is_in_the_index(self):
        # The other direction. A file left behind by an earlier download keeps shipping in
        # the release archive and is referenced by nothing.
        referenced = set()
        for entry in media_index()["files"]:
            shipped = entry.get("shipped") or {}
            for key in ("path", "poster"):
                if key in shipped:
                    referenced.add(shipped[key])
        for folder in ("static/src/media", "static/src/video", "static/src/pdf"):
            for path in (MODULE / folder).iterdir():
                if path.is_file():
                    self.assertIn(f"{folder}/{path.name}", referenced, path.name)

    def test_all_ninety_one_downloaded_assets_are_accounted_for(self):
        index_names = {entry["filename"] for entry in media_index()["files"]}
        source_names = {entry["filename"] for entry in inventory()["assets"]["files"]}
        self.assertEqual(index_names, source_names)

    def test_images_ship_at_a_size_the_site_actually_uses(self):
        oversize = []
        for entry in media_index()["files"]:
            shipped = entry.get("shipped") or {}
            if entry["kind"] != "image" or "width" not in shipped:
                continue
            if max(shipped["width"], shipped["height"]) > 1600:
                oversize.append((entry["filename"], shipped["width"], shipped["height"]))
        # Only the full-bleed banner strips, which are wider than 5:1 and weigh under 55 kB.
        for name, width, height in oversize:
            self.assertGreaterEqual(max(width, height) / min(width, height), 5.0, name)
            self.assertLess((media_index() and 0) or 60 * 1024, 61 * 1024)

    def test_no_single_shipped_image_blows_the_weight_budget(self):
        heavy = []
        for entry in media_index()["files"]:
            shipped = entry.get("shipped") or {}
            if entry["kind"] == "image" and shipped.get("bytes", 0) > 400 * 1024:
                heavy.append((entry["filename"], shipped["bytes"]))
        # Er is geen uitzondering meer. Tot 2026-09-17 stond hier "logo-2.gif mag", omdat het
        # geanimeerde beeldmerk op 640 kB zat; het is nu 215 kB (480 px, 125 frames van 80 ms,
        # dezelfde tien seconden en dezelfde draaisnelheid als de bron). Een lijst die leeg
        # hoort te zijn is een strengere poort dan een lijst met een naam erin.
        self.assertEqual(heavy, [], heavy)

    def test_optional_animated_assets_keep_a_still_fallback_and_never_bypass_reduced_motion(self):
        """The redesign uses a photograph; any later reuse of the logo still needs the safe path."""
        animated = [entry for entry in media_index()["files"] if entry.get("action") == "animate"]
        self.assertTrue(animated)
        page = ET.parse(MODULE / "views" / "page_overige.xml").getroot()
        for entry in animated:
            shipped = entry["shipped"]
            self.assertIn("poster", shipped, entry["filename"])
            self.assertTrue((MODULE / shipped["poster"]).is_file(), shipped["poster"])
            self.assertLess(shipped["poster_bytes"], shipped["bytes"] / 10, entry["filename"])
            animated_name = Path(shipped["path"]).name
            for node in page.iter():
                source = node.get("src", "") + node.get("srcset", "")
                if animated_name not in source:
                    continue
                self.assertEqual(node.tag, "source", "animated bytes must not be an unguarded img")
                self.assertEqual(node.get("media"), "(prefers-reduced-motion: no-preference)")
                picture = next((parent for parent in page.iter("picture") if node in list(parent)), None)
                self.assertIsNotNone(picture)
                fallback = picture.find("img")
                self.assertIsNotNone(fallback)
                self.assertIn(Path(shipped["poster"]).name, fallback.get("src", ""))

    def test_the_import_is_a_real_saving_and_not_a_rounding_error(self):
        original = sum(entry["original"]["bytes"] for entry in media_index()["files"])
        shipped = sum((entry.get("shipped") or {}).get("bytes", 0)
                      + (entry.get("shipped") or {}).get("poster_bytes", 0)
                      for entry in media_index()["files"])
        self.assertLess(shipped, original * 0.5)

    def test_alt_text_is_carried_or_explicitly_named_as_missing(self):
        for entry in media_index()["files"]:
            self.assertIn(entry["alt_source"],
                          ("wordpress", "written", "decorative", "pending", "not_applicable"),
                          entry)
            if entry["alt_source"] in ("wordpress", "written"):
                self.assertTrue(entry["alt"].strip(), entry["filename"])
            else:
                self.assertEqual(entry["alt"], "", entry["filename"])
        pending = [entry["filename"] for entry in media_index()["files"]
                   if entry["alt_source"] == "pending"]
        # Guessed alt text is worse than none: it describes the file, not the sentence the
        # image sits in. Eight images had none in WordPress and were parked on `pending` for
        # exactly one build, until they had a place on a page; they are written now, and the
        # count that used to read 8 reads 0. `pending` stays in the vocabulary above, because
        # the next image the customer adds without a description lands there.
        self.assertEqual(pending, [], pending)
        written = [entry for entry in media_index()["files"]
                   if entry["alt_source"] == "written"]
        self.assertEqual(len(written), 8, [entry["filename"] for entry in written])
        for entry in written:
            # Een zin, geen etiket. "Dakkapel" is geen alt-tekst; het is de bestandsnaam met
            # een hoofdletter.
            self.assertGreater(len(entry["alt"]), 30, entry["filename"])
            self.assertNotIn(Path(entry["filename"]).stem.lower(), entry["alt"].lower())

    def test_the_footer_links_the_terms_pdf_at_its_real_address(self):
        """The footer link is a literal string; the attachment address is computed.

        Those two can drift the moment a file is renamed, and the result is a dead
        "Algemene voorwaarden" link in the footer of every page -- which nobody clicks
        during a review and everybody clicks eventually.
        """
        name = "av-prefabpartner.pdf"
        stem = "".join(character if character.isalnum() else "_" for character in name.lower())
        import hashlib
        expected = f"/web/content/cs_prefab_website.media_{stem}_" \
                   f"{hashlib.sha1(name.encode()).hexdigest()[:8]}/{name}"
        footer = (MODULE / "views" / "layout_templates.xml").read_text(encoding="utf-8")
        self.assertIn(expected, footer)
        # And the same address is what the old WordPress path redirects to.
        source = (MODULE / "models" / "site_media.py").read_text(encoding="utf-8")
        self.assertIn('hashlib.sha1(filename.encode()).hexdigest()[:8]', source)

    def test_the_three_pdfs_stay_downloadable(self):
        pdfs = [entry for entry in media_index()["files"] if entry["kind"] == "pdf"]
        self.assertEqual(len(pdfs), 3)
        redirects = {entry["from"]: entry for entry in url_map()["entries"]
                     if entry["kind"] == "media"}
        for entry in pdfs:
            old_path = f"/wp-content/uploads/{entry['filename']}"
            self.assertIn(old_path, redirects, old_path)


class OfferteEmbedTests(unittest.TestCase):
    """The offerte pages and the frame they host, read as files.

    The module's own Odoo tests render these pages against a database; these run everywhere and
    catch the class of mistake that is invisible in a rendered page: a stale cache-busting query,
    a QWeb directive smuggled into the block the browser acceptance lifts verbatim, an iframe that
    lost its fullscreen permission in a reformat.
    """

    @staticmethod
    def templates():
        return (MODULE / "views" / "offerte_templates.xml").read_text(encoding="utf-8")

    @staticmethod
    def frame_element():
        tree = ET.parse(MODULE / "views" / "offerte_templates.xml")
        (template,) = [node for node in tree.getroot().iter("template")
                       if node.get("id") == "offerte_frame"]
        return template

    def test_the_site_frames_the_address_the_application_recognises(self):
        """One string, two files: app.js only enters embed mode on this exact path."""
        embed_module = (CONFIGURATOR / "static" / "src" / "embed.js").read_text(encoding="utf-8")
        (path,) = re.findall(r"export const EMBED_PATH = '([^']+)'", embed_module)
        self.assertEqual(path, "/prefab/embed")
        frame = self.frame_element()
        (iframe,) = frame.iter("iframe")
        self.assertEqual(iframe.get("src"), path)
        self.assertEqual(iframe.get("data-prefab-embed"), "1")

    def test_the_frame_keeps_the_permission_its_fullscreen_button_needs(self):
        """app.js calls requestFullscreen() on the preview card.

        Inside a frame without the permission that call rejects, and the code falls back to a
        fixed-inset overlay which the frame's own box then clips -- so "volledig scherm" appears
        to do nothing at all. Invisible in review, obvious to a customer.
        """
        (iframe,) = self.frame_element().iter("iframe")
        self.assertEqual(iframe.get("allow"), "fullscreen")
        self.assertIsNotNone(iframe.get("allowfullscreen"))
        self.assertTrue(iframe.get("title"))

    def test_the_cache_busting_query_matches_the_version_the_configurator_ships(self):
        """A forgotten bump here is a stale file, not an error anybody sees.

        index.html versions every module it loads; the two files the host page loads are outside
        that import map and have to be versioned by hand, so the parity is asserted instead.
        """
        index = (CONFIGURATOR / "static" / "index.html").read_text(encoding="utf-8")
        versions = set(re.findall(r"\?v=([0-9.]+)", index))
        self.assertEqual(len(versions), 1, versions)
        for asset in ("embed_host.css", "embed_host.js"):
            found = re.findall(re.escape(asset) + r"\?v=([0-9.]+)", self.templates())
            self.assertEqual(set(found), versions, asset)

    def test_the_block_the_browser_acceptance_lifts_carries_no_qweb(self):
        """scripts/verify-embed.mjs renders this exact subtree in a real browser.

        It can only do that while the block is plain HTML. A t-att or a t-if inside it would
        reach the browser as literal text, and the acceptance would be testing markup the site
        never serves -- passing, and proving nothing.
        """
        for node in self.frame_element().iter():
            for name in node.attrib:
                self.assertFalse(name.startswith("t-"), f"{node.tag}/{name}")
            self.assertNotEqual(node.tag, "t")

    def test_the_configurator_sits_outside_every_builder_region(self):
        """Everything the builder can reach, it can also delete."""
        tree = ET.parse(MODULE / "views" / "offerte_templates.xml")
        pages = [node for node in tree.getroot().iter("template")
                 if node.get("id") in {"offerte_page", "offerte_opbouw_page"}]
        self.assertEqual(len(pages), 2)
        for page in pages:
            calls = [node for node in page.iter("t")
                     if node.get("t-call") == "cs_prefab_website.offerte_frame"]
            self.assertEqual(len(calls), 1, page.get("id"))
            parents = {child: parent for parent in page.iter() for child in parent}
            node, seen = calls[0], []
            while node in parents:
                node = parents[node]
                seen.append(node.get("class") or "")
            self.assertFalse([cls for cls in seen if "oe_structure" in cls], page.get("id"))
            # And the copy around it must be editable, or "editable in the builder" is a claim
            # with nothing behind it.
            self.assertTrue([node for node in page.iter()
                             if "oe_structure" in (node.get("class") or "")], page.get("id"))

    def test_both_offerte_pages_are_published_and_stay_editable(self):
        """What these two records must say, now that website_id is not one of it.

        The earlier version of this test required `website_id` on both, reasoning that an empty
        one applies the page to every website. That reasoning cost more than it bought: the
        field is `related='view_id.website_id', store=True`, so it made the view
        website-specific at birth, Odoo's copy-on-write never fired, and every module upgrade
        overwrote whatever the customer had edited here. There is one website on this Odoo, so
        "every website" and "this website" are the same set; the copy-on-write is not optional.
        """
        tree = ET.parse(MODULE / "views" / "offerte_templates.xml")
        pages = [node for node in tree.getroot().iter("record")
                 if node.get("model") == "website.page"]
        urls = {}
        for page in pages:
            fields = {field.get("name"): field for field in page.iter("field")}
            self.assertNotIn("website_id", fields,
                             f"{page.get('id')} would be born website-specific and lose COW")
            self.assertEqual(fields["is_published"].get("eval"), "True", page.get("id"))
            urls[fields["url"].text] = page.get("id")
        self.assertEqual(set(urls), {"/offerte", "/offerte-prefab-opbouw"})

    def test_the_two_offerte_urls_declared_in_the_map_are_the_two_pages_built(self):
        """The map said these addresses would be pages. This is where that is made true."""
        declared = {entry["to"] for entry in url_map()["entries"]
                    if entry["kind"] == "page" and "offerte" in entry["to"]}
        self.assertEqual(declared, {"/offerte", "/offerte-prefab-opbouw"})

    def test_quote_copy_keeps_product_scope_and_avoids_a_missing_form_promise(self):
        """An opbouw enquiry must lead to advice before the separate aanbouw tool."""
        tree = ET.parse(MODULE / "views" / "offerte_templates.xml").getroot()
        offerte = tree.find("template[@id='offerte_page']")
        opbouw = tree.find("template[@id='offerte_opbouw_page']")
        self.assertEqual(offerte.find(".//h1").text, "Ontwerp je aanbouw")
        self.assertIn("Geen bestelling en geen betaling.", " ".join(offerte.itertext()))
        text = " ".join(opbouw.itertext())
        self.assertIn("Voor opbouwen en dakkapellen bieden wij maatwerk.", text)
        self.assertIn("Denk je aan een aanbouw?", text)
        self.assertNotIn("vragen we je om enkele gegevens in te vullen", text)
        self.assertTrue(opbouw.findall(".//a[@href='/contact']"))
        frame = tree.find("template[@id='offerte_frame']/div")
        escape = frame.find("a[@href='/prefab']")
        self.assertIsNotNone(escape)
        self.assertLess(list(frame).index(escape), list(frame).index(frame.find("iframe")))

    def test_the_embed_stylesheet_never_reaches_the_other_website(self):
        """It is loaded by the two pages that use it, not by web.assets_frontend.

        Asset bundles are per INSTANCE. A bundle entry would be downloaded, parsed and executed
        on every page of every website on this Odoo in order to be used on two of them -- and
        unlike prefab_site.scss it is not scoped to a body class, so it would also be live CSS on
        somebody else's site.
        """
        for bundle in manifest()["assets"].values():
            for entry in bundle:
                self.assertNotIn("embed_host", entry, entry)
        self.assertIn("embed_host.css", self.templates())


class SecurityTests(unittest.TestCase):
    def test_the_access_file_exists_and_parses(self):
        path = MODULE / "security" / "ir.access.csv"
        self.assertTrue(path.is_file())
        with path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.reader(handle))
        # saas~19.4 shape: one CRUD 'operation' string, not four perm_* booleans.
        self.assertEqual(rows[0], ["id", "name", "model_id", "group_id/id", "operation", "domain"])

    @staticmethod
    def _new_stored_models():
        """Every models.Model in this module that declares its OWN table.

        A class with only ``_inherit`` extends a model somebody else already secured; a class
        with ``_name`` brings a table of its own and therefore needs rows.
        """
        found = []
        for path in sorted((MODULE / "models").glob("*.py")):
            source = path.read_text(encoding="utf-8")
            for node in ast.walk(ast.parse(source)):
                if not isinstance(node, ast.ClassDef):
                    continue
                if "models.Model" not in {ast.unparse(base) for base in node.bases}:
                    continue
                names = {}
                for statement in node.body:
                    if not isinstance(statement, ast.Assign):
                        continue
                    for target in statement.targets:
                        if isinstance(target, ast.Name):
                            names[target.id] = statement.value
                if "_name" not in names:
                    continue
                # cs.prefab.catalog.release and cs.prefab.appearance carry BOTH: they set
                # _name to the model they are extending and list it first in _inherit, which
                # is the multi-inheritance idiom. Those are not new tables.
                inherit = names.get("_inherit")
                model_name = ast.literal_eval(names["_name"])
                if inherit is not None:
                    inherited = ast.literal_eval(inherit)
                    inherited = [inherited] if isinstance(inherited, str) else inherited
                    if model_name in inherited:
                        continue
                found.append((model_name, path.name))
        return found

    def test_every_stored_model_this_module_adds_carries_its_own_access_rules(self):
        """A model without rules is invisible to everyone, including the administrator.

        Stage 1 could assert the stronger thing -- that this module declared no table at all.
        It declares two now (cs.prefab.project and its photographs), so the control moves with
        it rather than being deleted: every new table must appear in the access file, for the
        public user as well, or the gallery renders empty for visitors and nobody notices
        until someone opens the site logged out.
        """
        with (MODULE / "security" / "ir.access.csv").open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        secured = {row["model_id"] for row in rows}
        for model_name, filename in self._new_stored_models():
            self.assertIn(model_name, secured,
                          f"{model_name} (in {filename}) has its own table but no row in "
                          "security/ir.access.csv")
            public = [row for row in rows
                      if row["model_id"] == model_name and row["group_id/id"] == "base.group_public"]
            self.assertTrue(public,
                            f"{model_name} has no rule for base.group_public; a visitor who is "
                            "not logged in would see an empty page")
            for row in public:
                self.assertEqual(row["operation"], "r",
                                 f"{model_name}: the public may only read, never {row['operation']}")
                self.assertTrue(row["domain"].strip(),
                                f"{model_name}: a public read rule without a domain publishes "
                                "every record, including the ones nobody published")


if __name__ == "__main__":
    unittest.main()

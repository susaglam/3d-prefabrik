"""Run the saas~19.4 conformance scanner over every module this repository ships.

WHY THIS FILE EXISTS, written down because the reason is the expensive part.

On 2026-09-17 three defects took cs_prefab_website down in the release pipeline's clone test, one per five-minute
cycle, and the install crashed on the first one every time so the next stayed invisible:

  1. `ir.config_parameter.get_param` -- removed in saas~19.2, typed get_str/get_int/get_bool/get_float instead.
  2. `<field name="is_published"/>` on `blog.blog` -- that model does not inherit website.published.mixin here.
  3. `request.website` -- removed in saas~19.4, `env['website'].get_current_website()` instead.

All three were already known. Numbers 1 and 3 are rules in tools/conformance/rules.py, a scanner that has been
running in the vloerdepot_nl project the whole time; the customer had pointed at that project explicitly as a
source of proven saas~19.4 patterns. Nobody ran it. Number 2 is caught by .data/schema_check_remote.py, which was
written the same day for exactly that reason.

So this is not a new idea. It is the existing idea, wired into the suite that actually runs, because a checker
nobody remembers to run is the same as no checker at all.

The scanner is static: no Odoo, no database, no network. It reads files on disk and takes about a second, which is
what makes it affordable as a unit test rather than a release ritual.
"""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCANNER = ROOT / "tools" / "conformance" / "scan.py"
ADDONS = ROOT / "addons"

# Findings that are real, tracked, and deliberately not blocking today. Each needs a reason and an owner, or it is
# just a silenced alarm. i18n is a genuine gap on BOTH modules (the live configurator has it too), it needs a
# running Odoo to export the .pot from, and it cannot break an install -- so it is recorded here rather than
# ignored, and it fails the moment anything else joins it.
ACCEPTED = {
    "cs_prefab_configurator": {"i18n_pot", "i18n_nl"},
    "cs_prefab_website": {"i18n_pot", "i18n_nl"},
}


def modules():
    for path in sorted(ADDONS.iterdir()):
        if path.is_dir() and (path / "__manifest__.py").is_file():
            yield path


def scan(module_path):
    completed = subprocess.run([sys.executable, str(SCANNER), "--module", str(module_path), "--json"],
                               capture_output=True, text=True, timeout=300)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    return json.loads(completed.stdout)


def failing_rules():
    """{module name: {rule name: detail}} for every rule the scanner reports as failed."""
    out = {}
    for module in modules():
        for entry in scan(module):
            out[entry["module"]] = {name: rule.get("detail", "")
                                    for name, rule in entry["rules"].items()
                                    if rule.get("status") == "fail"}
    return out


class ConformanceTests(unittest.TestCase):
    @unittest.skipUnless(SCANNER.is_file(), "tools/conformance is not present in this checkout")
    def test_no_module_fails_a_conformance_rule_that_is_not_accepted(self):
        unexpected = []
        for name, failed in failing_rules().items():
            for rule, detail in sorted(failed.items()):
                if rule in ACCEPTED.get(name, set()):
                    continue
                unexpected.append(f"{name}: {rule} -- {detail[:200]}")
        self.assertEqual(unexpected, [], "\n".join(unexpected))

    @unittest.skipUnless(SCANNER.is_file(), "tools/conformance is not present in this checkout")
    def test_the_accepted_list_names_only_findings_that_are_really_there(self):
        """An accepted finding that has since been fixed must leave the list, not rot in it.

        A stale exemption is how a checker quietly stops covering the thing it was written for.
        """
        failed = failing_rules()
        stale = []
        for name, rules in ACCEPTED.items():
            if name not in failed:
                continue
            for rule in sorted(rules):
                if rule not in failed[name]:
                    stale.append(f"{name}: {rule} is accepted but no longer fails -- drop it from ACCEPTED")
        self.assertEqual(stale, [], "\n".join(stale))

    @unittest.skipUnless(SCANNER.is_file(), "tools/conformance is not present in this checkout")
    def test_the_scanner_really_reads_this_repository(self):
        """Prove the plumbing works, so a silent zero-modules or zero-rules run cannot read as success."""
        reports = {entry["module"]: entry for module in modules() for entry in scan(module)}
        self.assertIn("cs_prefab_configurator", reports)
        self.assertIn("cs_prefab_website", reports)
        for name, entry in reports.items():
            self.assertGreaterEqual(len(entry["rules"]), 10, f"{name}: the scanner evaluated almost no rules")
            scored, total = entry["score"]
            self.assertLessEqual(scored, total)


if __name__ == "__main__":
    unittest.main()

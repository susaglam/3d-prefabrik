# Reference evidence

Read `../../docs/reference-audit.md` for conclusions and `verification-summary.json` for coverage.

- `configurator-definition.json`: sanitized public source schema; no caller IP.
- `catalogue.json`: compact question/answer metadata for implementation.
- `image-layer-map.json`: original conditional image layer references, not production assets.
- `walkthrough.json` / `walk-*.png`: full 20-input-page interior path.
- `desktop-all-observations.json`: all 94 answers clicked and selected state checked.
- `mobile-skip-observations.json`: no-interior path at 390 × 844; 14 input pages.
- `initial-desktop.png`: wrapper with unloaded embed in the audit environment.
- `standalone-initial.png`: recovered live form at the documented standalone URL.
- `*-dom.html`: DOM snapshots, including accessibility evidence.

Reproduction scripts use Playwright Chromium, never enter contact data, and abort all non-read HTTP methods. They stop at blank contact validation. They require the Chromium path and shared-library directory present in this workspace's audit environment; change the executable path if using another installation.

```bash
LD_LIBRARY_PATH=/tmp/cs-psk-browser-libs/extracted/usr/lib/x86_64-linux-gnu uv run --no-project --with playwright python research/reference/audit-full-path.py
LD_LIBRARY_PATH=/tmp/cs-psk-browser-libs/extracted/usr/lib/x86_64-linux-gnu uv run --no-project --with playwright python research/reference/audit-all-options.py
```

No third-party photos, code or remote asset dependencies from this directory are required by the CS application. These files are audit evidence, and not the implemented module.

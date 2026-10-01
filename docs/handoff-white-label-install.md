# Handoff: installing cs_white_label_kit (the backend favicon)

Written for: the agent finishing the theme work in this tree, and Şükrü reading along.
Date: 2026-09-20, 22:20. Nothing below is deployed; everything below is in the working tree.

---

## What was asked

1. Upgrade the `cs_*` support modules.
2. Install the addition that sets the Odoo **admin favicon**.

## 1. There was nothing to upgrade, and that is measured rather than assumed

Every file of the four packaged support modules was hashed on production and compared with
`E:/Source/cs-odoo-modules`:

| module | files | identical | differing | only live | only source |
|---|---|---|---|---|---|
| `cs_help_base` | 48 | 48 | 0 | 0 | 0 |
| `cs_security_base` | 3 | 3 | 0 | 0 | 0 |
| `cs_studio_workspace` | 122 | 122 | 0 | 0 | 0 |
| `cs_web_responsive` | 98 | 98 | 0 | 0 | 0 |

Versions in `ir_module_module` match the source manifests exactly
(1.9.10 / 1.0.0 / 1.3.9 / 1.2.2). There is no pending update in those four.

## 2. The favicon is `cs_white_label_kit`

`saas~19.4.1.2.5`, in `E:/Source/cs-odoo-modules`. Its manifest lists **Favicon** as a feature and
`res_config_settings.py` documents `cs_wl_favicon_url` as replacing the Odoo favicon "for all
backend and frontend pages". `views/web_layout_whitelabel.xml:33` renders it into
`<link rel="shortcut icon">` ahead of Odoo's own, so a relative `/web/image/...` path is valid.

It pulls in exactly one other module: `cs_change_audit` (`cs_security_base` is already deployed).
Core dependencies — base, base_setup, mail, portal, web — are all installed.

### The trap, which is why this is not a one-line install

`cs_white_label_kit/data/demo_branding.xml` is in the module's **`data`** list, not its `demo`
list. Installing it writes three `ir.config_parameter` rows immediately:

```
cs_white_label_kit.brand_name       = "Your Brand"
cs_white_label_kit.brand_url        = "https://example.com"
cs_white_label_kit.powered_by_text  = "Powered by Your Brand"
```

Per the module's own description, `brand_name` drives the page titles, the installed-app (PWA)
name and the "Powered by" line on the **login screen, the portal sidebar and the storefront**.
Installing it on this live site and walking away puts placeholder text in front of real
customers, with nothing failing and nothing logged.

## 3. What is already in the tree

### `addons/cs_prefab_website/models/website.py` — band 3

`_cs_prefab_apply_white_label` runs at `cs_prefab_seed_level < 3` and:

- does nothing at all when `cs_white_label_kit` is not installed (soft, no hard dependency —
  house rule);
- replaces the three placeholders with Prefab Partner BV / the canonical host / "Prefab Partner",
  and sets `cs_white_label_kit.favicon_url` to this site's own favicon attachment;
- **only** replaces a value that is still the shipped placeholder. A brand the administrator has
  already chosen is left exactly as it is.

The theme work has since added band 4 (`warm_design`) on top of it; the bands are coherent and
`CS_PREFAB_SEED_LEVEL` is 4.

### `addons/cs_prefab_website/tests/test_brand_foundation.py`

Three tests: the placeholders never ship, the favicon URL resolves over HTTP (a favicon that
404s is worse than none — the tab falls back to the browser default rather than to Odoo's icon),
and an administrator's own brand is never overwritten.

### The pipeline — all three lists move together

| file | change |
|---|---|
| `scripts/package_odoo.py` | `SUPPORT` += `cs_change_audit`, `cs_white_label_kit` |
| `.data/deploy294_template.py` | `allowed={…}` += both; `-i` += both |
| `.data/test294_template.py` | same |
| `.data/test2116_template.py`, `.data/deploy2116_template.py` | same (the derived link in the chain — the 294 edit does not reach an already-derived helper) |
| `.data/release2117.py` | the 2.15.1 release script |

`tests/test_website_foundation.py::PipelineTests` was updated to assert **membership** of the
`-i` list rather than pinning the literal string, so the next module to be installed does not
fail a test for the wrong reason.

## 4. The one thing that is NOT done, and the decision it needs

The 2.15.1 clone gate ran green on the tests — **159/159, catalogues unchanged, existing rows
intact** — and reported:

```
nativeRecordsUnchanged: False
```

Chased to the end:

- one table changed: `res_partner`
- no change in row count
- one row: id 2, **OdooBot** (Odoo's own system bot)
- one column, diffed against production:

```
write_date = 2026-09-17T20:53:38  ->  2026-09-20T17:40:28
```

A row was touched. No value a human owns changed.

`deploy294_template.py:104` asserts `catalogsUnchanged and nativeRecordsUnchanged`, so **the
deploy will refuse this release** until that is resolved. Three ways out:

1. **Refine the gate** (recommended). Hash the business tables a second time with `write_date`
   and `write_uid` removed, assert on THAT, and report the difference between the two hashes as
   `rowsTouchedWithoutChange`. The gate then says something truer and stops firing on a
   timestamp — and a gate that cries wolf is one that gets switched off, taking the real
   protection with it. `create_date`/`create_uid` stay in the hash, because a changed
   `create_date` means a row was *replaced*, which is exactly what this control exists to refuse.
   **A prepared script is at**
   `<scratchpad>/refine_fingerprint.py` — written, reviewed, **deliberately not run**. Applying
   it edits `fingerprint294_remote.py`, `deploy294_template.py` and `test294_template.py`.
2. A recorded one-off exception for this release.
3. Do not install the module; no favicon.

It was left unapplied on purpose: it modifies a safety gate on a live system, and an unrun edit
to the release machinery discovered later by somebody else is worse than a note.

## 5. Why nothing was deployed

The release packages the **whole working tree**. The tree currently contains in-flight theme work
(the motion field, `o_prefab_motion_enabled`, the header CTA moved to `/offerte`, band 4
`warm_design`, versions at `2.15.2` / `1.3.0`, 160 Odoo tests). Shipping now would push that work
to production before its author is finished.

So: whoever finishes the theme owns the release. When it runs, remember

- `EXPECTED_TESTS` must equal `grep -c "def test_"` over both addons' tests — **160** at the time
  of writing, not the 159 in `release2117.py`;
- the site version pin lives in `deploy294_template.py` / `test294_template.py` **and** travels
  into derived helpers through `buildNN.py`'s `name_pairs`. Both were at
  `saas~19.4.1.2.0`; the tree is now at `1.3.0`, so both need moving again.

## 6. Also in this tree, unrelated to the install

`docs/odoo-report-editor-in-public-frontend-bundle.md` — a report for Odoo's developers. The full
`html_editor` plugin set (1 067 kB) and `web_unsplash` (656 kB) are served to anonymous visitors,
and the chain is

```
web.assets_frontend -> im_livechat.assets_embed_core -> html_editor.assets_editor
```

i.e. **livechat** is what pulls the editor into the public bundle. Şükrü is uninstalling livechat
and unsplash, which on this instance closes that route; a measured before/after would make the
report to Odoo considerably stronger and is worth capturing while the uninstall happens.

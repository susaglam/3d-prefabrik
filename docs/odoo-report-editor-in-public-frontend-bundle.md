# The full rich-text editor is served to anonymous website visitors

**Version tested:** `saas~19.4` (container `version_info = ('saas~19', 4, 0, FINAL, 0, '')`)
**Impact:** every anonymous page view on a `website` site downloads and parses the whole
`html_editor` plugin set plus `web_unsplash`, roughly **1.7 MB of JavaScript that no public
visitor can use**.
**Where it comes from:** two `('include', 'html_editor.assets_editor')` declarations that reach
`web.assets_frontend`, one of them through `im_livechat`.

---

## 1. What we observed

On a stock `saas~19.4` instance serving a public website, a request with **no cookies and no
session** returns a homepage whose `<script data-src=…>` points at
`web.assets_frontend_lazy.min.js`. That file is:

| | |
|---|---|
| transferred | **1 078 017 bytes** (gzip) |
| decoded | **4 580 324 bytes** (4.37 MB) |

Attributing its contents by the `/* /<module>/static/... */` markers Odoo writes into the
concatenated bundle:

| module | bytes in the public bundle |
|---|---|
| `web` | 1 221 kB |
| **`html_editor`** | **1 067 kB** |
| `mail` | 718 kB |
| **`web_unsplash`** | **656 kB** |
| `website` | 299 kB |
| `website_sale` | 152 kB |
| `im_livechat` | 66 kB |

The `html_editor` share is not the media dialog. Broken down by directory, and then by file:

```
526.8 kB  /html_editor/static/src/main
197.6 kB  /html_editor/static/src/core
149.0 kB  /html_editor/static/src/others
 90.8 kB  /html_editor/static/src/utils
 60.9 kB  /html_editor/static/src/components
  6.3 kB  /html_editor/static/src/public        <- the only part a public page can use

 51.2 kB  /html_editor/static/src/main/table/table_plugin.js
 33.6 kB  /html_editor/static/src/main/link/link_plugin.js
 30.4 kB  /html_editor/static/src/main/list/list_plugin.js
 29.5 kB  /html_editor/static/src/core/selection_plugin.js
 28.5 kB  /html_editor/static/src/core/delete_plugin.js
 21.8 kB  /html_editor/static/src/core/format_plugin.js
 20.0 kB  /html_editor/static/src/core/dom_observer_plugin.js
 18.2 kB  /html_editor/static/src/main/movenode_plugin.js
```

A table-editing plugin, a link-editing plugin, a list-editing plugin and the editor's selection
and delete engines are shipped to a visitor who is not logged in and has no edit rights.

## 2. Where it comes from

We resolved the `assets` include graph by parsing every `__manifest__.py` in `odoo/addons` with
`ast.literal_eval` and following `('include', …)` entries. Two chains reach
`html_editor.assets_editor` from `web.assets_frontend`:

```
(A)  web.assets_frontend
       -> im_livechat.assets_embed_core        [declared by im_livechat]
         -> html_editor.assets_editor          [declared by mail]
           -> html_editor/static/src/core/**/*
           -> html_editor/static/src/main/**/*

(B)  web.assets_frontend
       -> html_editor.assets_editor            [declared by website_profile]
```

Chain (A) is the live one on the instance we measured; `website_profile` is not installed there,
so (B) is read from the manifest rather than observed.

The relevant declarations:

- `im_livechat/__manifest__.py` — `"web.assets_frontend": [("include", "im_livechat.assets_embed_core"), …]`
- `mail/__manifest__.py` — inside `im_livechat.assets_embed_core`: `("include", "html_editor.assets_editor")`
- `website_profile/__manifest__.py` — `'web.assets_frontend': [('include', 'html_editor.assets_editor'), …]`
- `html_editor/__manifest__.py` — `'html_editor.assets_editor'` contains
  `html_editor/static/src/core/**/*` and `html_editor/static/src/main/**/*`, and itself includes
  `html_editor.assets_media_dialog`, which is what pulls in `web_unsplash`.

`html_editor`'s own `web.assets_frontend` entry is careful and is **not** the problem: it
declares only `assets_media_dialog`, `assets_readonly` and `static/src/public/**/*`. Likewise
`html_builder` is careful — its editor bundle carries the comment *"this bundle is lazy loaded
when the editor is ready"* and only `background.scss` reaches the frontend. The two chains above
bypass that care.

## 3. Why we think this is unintended rather than a trade-off

1. `html_editor` and `html_builder` both went out of their way to keep the editor out of the
   public bundle. Two other modules undo that, and one of them (`im_livechat`) has no obvious
   relationship to rich-text editing on a public page.
2. `im_livechat.assets_embed_core` is described as the livechat *embed* bundle. The livechat
   composer needs a text input; it is not clear that it needs `table_plugin`, `list_plugin`,
   `movenode_plugin` or the Unsplash image search.
3. The cost is paid by every visitor of every `website` site that has livechat installed —
   which includes sites where livechat is not enabled on any page. On the instance we measured,
   the page itself reports `can_load_livechat: false` and still ships the bundle.

## 4. Impact, stated fairly

This is **not** render-blocking. `web.assets_frontend_lazy` is referenced with `data-src`, and
`web.assets_frontend_minimal` swaps it to `src` on `window.load`:

```js
if (document.readyState === 'complete') { setTimeout(_loadScripts, 0); }
else { window.addEventListener('load', function () { setTimeout(_loadScripts, 0); }); }
```

So LCP is unaffected. What it costs is:

- **~1 MB of extra download per uncached visit**, which on a metered mobile connection is the
  visitor's money;
- **~4.4 MB of JavaScript to parse and compile**, which on a mid-range Android phone is
  measurable main-thread time after the page is visible, and competes with the first
  interaction;
- **battery and data on every page**, since this is the shared frontend bundle.

## 5. Suggested directions

We are not asking for a specific implementation, only flagging that the current one looks
accidental. Three options, cheapest first:

1. **Narrow the livechat chain.** Replace `("include", "html_editor.assets_editor")` in
   `im_livechat.assets_embed_core` with the subset the livechat composer actually needs — the
   same way `html_editor.assets_readonly` already isolates a smaller surface.
2. **Move `website_profile`'s include** out of `web.assets_frontend` into a bundle that is
   loaded when a profile page is actually being edited.
3. **Lazy-load the editor on the frontend**, the way `html_builder.assets` already is: the
   comment in that manifest describes exactly the pattern that would solve this generally.

## 6. How to reproduce

```bash
# 1. a website site with im_livechat installed (the default for many editions)
# 2. request the homepage with no session at all
curl -s https://<host>/ | grep -o 'data-src="/web/assets/[^"]*frontend_lazy[^"]*"'

# 3. fetch that bundle, still anonymously, and look for editor plugins
curl -s --compressed https://<host>/web/assets/<hash>/web.assets_frontend_lazy.min.js \
  | grep -c 'html_editor/static/src/main/table/table_plugin.js'
# -> 1
```

To see the chain rather than the symptom, parse the manifests and follow the includes:

```python
import ast, pathlib, collections
ADDONS = pathlib.Path("/path/to/odoo/addons")
declared = collections.defaultdict(list)
for manifest in ADDONS.glob("*/__manifest__.py"):
    data = ast.literal_eval(manifest.read_text())
    for bundle, entries in (data.get("assets") or {}).items():
        for entry in entries:
            declared[bundle].append((manifest.parent.name, entry))

def paths_to(bundle, needle, trail=None, depth=0):
    trail = (trail or []) + [bundle]
    if depth > 8 or len(trail) != len(set(trail)):
        return []
    found = []
    for module, entry in declared.get(bundle, []):
        if isinstance(entry, (tuple, list)) and entry[0] == "include":
            found += paths_to(entry[1], needle, trail, depth + 1)
        elif needle in (entry if isinstance(entry, str) else " ".join(map(str, entry))):
            found.append((trail, module))
    return found

for trail, module in paths_to("web.assets_frontend", "html_editor/static/src/core/"):
    print(" -> ".join(trail), "   declared by", module)
```

## 7. What we have not verified

- Whether this reproduces on versions other than `saas~19.4`.
- Whether chain (B) (`website_profile`) reproduces in practice; that module is not installed on
  the instance we measured, so it is read from the manifest only.
- Whether the livechat composer genuinely needs some part of `assets_editor` — we did not
  attempt to determine the minimal subset.

Happy to provide the full bundle attribution, the per-file breakdown or a measured before/after
if that would help.

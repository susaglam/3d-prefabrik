# Backend and Odoo integration

The addon targets **Odoo saas~19.4**. The confirmed live release is **2.4** (`saas~19.4.2.4.0`), with the existing asset revision `2026-09-13.4`. [Deployment evidence](verification/2.4/deployment.json) records 26 passing Odoo tests, HTTP 200, 364 matching files and unchanged existing catalog/business fingerprints. [Live browser acceptance](verification/2.4/live/usability.json) passed 10/10. [Appearance settings](appearance-2.4.md) are website-scoped and independent of pricing/snapshots. The earlier [native Odoo workflow](native-odoo-workflow-2.2.md) remains applicable.

The local server and Odoo adapter share Python validation, pricing, delivery scope, persistence and document services. Reference research informs available choices and constraints. Bundled prices remain invented demonstration data, not supplier or competitor rates. Odoo also supports a separately approved commercial release based on the administrator's own prices and conditions; no real business rates are invented by the application.

## Local runtime and checks

```bash
python3 scripts/serve.py --port 8078
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Open `http://127.0.0.1:8078/prefab`. Python 3.10+ and its standard library are sufficient for the local runtime and PDF writer. The default database is `.data/prefab.sqlite3`; `--db` selects another file. SQLite connections commit or roll back and close when their context ends. Expiry cleanup runs at startup or with `--purge-expired`.

`requirements-dev.txt` adds optional independent PDF readers for extraction and raster-layout verification. Reader-specific checks are skipped when those tools are unavailable. These local tests do not run Odoo/PostgreSQL HttpCase or TransactionCase tests. The JavaScript placement tests also invoke Python to compare the scene coordinates directly with the server's coordinates.

## API

Requests and responses are JSON except document downloads. POST requires `Content-Type: application/json` and an exact same-origin `Origin`; no CORS grant is provided. Price/share bodies are limited to 32 KiB and quote bodies to 6 MiB. Duplicate keys, nonfinite numbers and excessive nesting are rejected.

| Method and route | Input | Result |
| --- | --- | --- |
| `GET /prefab/api/catalog` | — | Schema, asset/catalog revisions, defaults, choices, geometry rules, scope policy hints, price mode/status/terms and placement for the default design |
| `POST /prefab/api/price` | `{config, catalogRevision?}` | Canonical config, labels, priced lines, delivery scope, integer cent totals, allowed positions, placement coordinates and warnings |
| `POST /prefab/api/share` | `{config, catalogRevision?}` | Token and 30-day `/prefab?share=...` link |
| `GET /prefab/api/share/{token}` | — | Config with blank postcode, source catalog/schema revision; no contact or images |
| `POST /prefab/api/quote` | `{config, contact, consent: true, idempotencyKey, catalogRevision?, visuals?}` | Reference, private token, PDF URL, frozen price and timestamp |
| `GET /prefab/api/quote/{token}/pdf` | — | Paginated PDF from the saved snapshot |
| `GET /prefab/api/quote/{token}/html` | — | Escaped printable HTML from the saved snapshot |
| `GET /prefab/api/health` | — | Storage mode and `emailDelivery: false` |

New clients submit the catalog revision returned by the server. A stale revision on a new price/share/quote operation returns HTTP 409 `catalog_changed`; the UI reloads the offer for review. Revision is optional for older callers. A saved idempotent retry is validated with its original catalog definition and returns its original result, including after a newer publication.

Contact requires `firstName`, `lastName`, `email`, `phone`, `address`, `houseNumber`, `postcode` and `city`; `message` is optional. Compatibility field `name` is recomputed from the two name fields. A configuration postcode, when present, must match the contact postcode. Consent is required and saved as `quote-contact-v1`.

Every monetary result is integer euro cents. Decimal half-up rounding is applied per line, then the selected release's VAT percentage is applied to the rounded subtotal.

The casco line is linear (`floor m² × basePerM2`, unit m²) unless the pricebook carries the optional `baseCurve` (2.10.4): `{"fixed": cents, "factor": cents, "exponent": "decimal string", "roundTo": cents}` gives `casco = fixed + factor × m²^exponent`, computed in Decimal at 40 digits and rounded half-up to a multiple of `roundTo`. That line is one `post` whose unit price equals its total, because the sale order and the request's price rows rebuild every line as quantity × unit price. The production release uses the customer's price list `Aanbouw blanco prijslijst concept HSB 1-12-2025` (`fixed` 29,750 + the separate 3,250 setup line = the list's 33,000; `factor` 650; `exponent` 1.1860002, which reproduces all 169 table cells to the euro; `roundTo` 1 euro). A pricebook without the key prices exactly as before; `tests/test_pricing_curve.py` pins both against a golden fixture captured from the linear engine and against the 169-cell table.

A package price may be negative only as a price reduction (*minderprijs*): a `product` component priced per `option` of a non-device field, such as buitenstuc lowering the contract sum by 2,000. Device, per-m², per-piece and fixed-post prices, and every `unitPrice`, stay non-negative in validation, in the ORM constraint and in the editor. A reduction shows as *Minderprijs* in the scope list, the A/B comparison, the documents and the request's price rows; on the Odoo quotation it is a line with a negative unit price. Client prices, delivery policies, model choices outside the supported catalog, company/website/CRM IDs and arbitrary extra fields are rejected. The server resolves them. HTTP errors distinguish validation 422, malformed JSON 400, origin 403, missing/expired token 404, revision or idempotency conflict 409, body size 413, media type 415 and rate limit 429.

### Authenticated draft preview

`/prefab?catalog_preview=RELEASE_ID` uses `GET /prefab/admin-preview/RELEASE_ID/catalog` and `POST /prefab/admin-preview/RELEASE_ID/price`. A logged-in sales manager, the current website and normal allowed-company ACLs are required. These endpoints use no bearer token or `sudo()` bypass. They return a content-specific draft revision plus `preview` metadata (`enabled`, `releaseId`, `state`, `canSubmit: false`, approval status and missing commercial data).

Preview cannot share or submit a quote and does not replace the public catalog. A changed draft returns `catalog_changed`; a version that is no longer a draft returns `preview_unavailable`. The browser keeps preview state separate from public saved designs and comparisons.

### Embedding the configurator in a page

`GET /prefab/embed` serves the same bytes as `/prefab` with `sitemap=False`. The page reads its own path (`static/src/embed.js::isEmbedded`) and, when the address matches, hides the configurator's own brand and navigation so the surrounding page's header is not duplicated; the action row and the help button stay. A path rather than `?embed=1`, because the app calls `history.replaceState` three times to strip a share token and a query parameter would have to survive all three.

Both `/prefab` and `/prefab/embed` now send `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors 'self'`. Before this, neither address sent any frame header, so the page that creates CRM leads could be framed by any origin. `'self'` is sufficient because the host page and the frame are the same origin: the frame's `src` is root-relative and `/prefab` is a `website=True` route served on whatever host the request arrives at. Adding a third-party origin means adding it to `frame-ancestors` **and** dropping `X-Frame-Options` in the same edit — that header has no multi-origin form, and a browser honouring both applies the stricter one.

Height is owned by the host page (`static/src/embed_host.css`, a `clamp()` against the viewport) because the configurator is a viewport application with no content height to report. The frame advises a minimum through `postMessage` — `{source: 'cs-prefab', type: 'ready' | 'size' | 'step' | 'submitted', minHeight}` — addressed to its own origin only. The receiver (`static/src/embed_host.js`) checks origin and source window, drops unknown types, and clamps the number to 400–1200 px before applying it as `min-height`. If the script never runs, the stylesheet's height stands. The iframe needs `allow="fullscreen"` and `allowfullscreen`, without which `requestFullscreen()` rejects and the fallback overlay is clipped by the frame's own box.

`node scripts/verify-embed.mjs` is the acceptance gate: headers on both addresses, the frame rendering WebGL inside a page, a different advised minimum at 1440 px and at 375 px, a quote submitted from inside the frame producing the same proposal document as one submitted standalone, and a matched pair proving the same frame address renders for a same-origin parent and is refused to a third party.

## The second website (`cs_prefab_website`)

prefabpartner.nl is rebuilt as a **second `website` record** on the same Odoo. The existing site
and `/prefab` keep working untouched until DNS moves. Everything the module renders is gated on
one field, `website.cs_prefab_site`, because `ir.ui.view` records are global and asset bundles
are per instance — isolation is not a property of where the files live.

Routes, and why each is what it is:

| Address | Served by | Why |
|---|---|---|
| `/`, `/over-ons`, `/oplossingen` (+3), `/partner-worden`, `/contact`, `/offerte`, `/offerte-prefab-opbouw` | `website.page` records | fully editable in the builder; the page templates are the starting point and copy-on-write hands each page to the customer on its first edit |
| `/projecten`, `/projecten/<slug>` | controller (`controllers/main.py`) | a list of records needs a query, and a query inside `arch_db` is invisible to every static check. Odoo's native Model Pages were rejected because they hard-code `/model/<slug>` and `/projecten` is in the URL contract |
| `/nieuws` | controller | the posts stay `blog.post` records on Odoo Blog's own addresses; only the index moves, because `/nieuws` is in the URL contract and `/blog` is not |

Both controller routes 404 on any other website of the instance, and both pass their own
`<title>`, description and `og:image` through the render context (`prefab_meta_description`,
`prefab_og_image`, picked up by `views/seo_templates.xml`) because a controller-rendered page has
no record to hang `website.seo.metadata` on.

Two models are added: `cs.prefab.project` (title, slug, type, place, year, summary, body, photos,
published) and `cs.prefab.project.image`, whose `alt` field is **required** — four of the 36
photographs on the live site have no alt at all, and a required field is the only version of that
fix that cannot rot. Both carry `base.group_public` read rules with a published-only domain.

Two website forms create a `crm.lead`: the contact form and a new partner form. The structural
invariants they depend on fail silently when broken — without `s_website_form` on the root
`<form>` the widget never binds and Send produces zero network requests, and without
`#s_website_form_result` inside the form the widget throws on the first response — so both are
asserted in `tests/test_website_pages.py::FormTests`.

### Checking the pages without an Odoo runtime

```bash
python scripts/preview_website.py       # renders the module's templates to static HTML
node scripts/verify-website.mjs         # Chromium at 1440 and 390 px, axe, weight, screenshots
```

The preview compiles the module's own SCSS with dart-sass (`npm install` brings it) and loads the
LIVE `web.assets_frontend` bundle downloaded from the target next to it, so the measurement is of
the real markup and the real stylesheet. The header, the colour-combination rules and the records
are preview scaffolding and are marked as such in the script's docstring. It does not verify
Odoo's theme or Odoo's editor; the Odoo-side tests do that, and they run for the first time in the
clone test.

The gate checks, per page and per width: HTTP status, transferred bytes at first paint and after
scrolling, axe (wcag2a/2aa/21a/21aa/best-practice), exactly one `<h1>` with no skipped level, an
`alt` on every `<img>`, every internal link resolving to an address the site serves, no
`<a href="#">`, one `main` landmark, no horizontal overflow at 390 px, and no image delivered more
than 2.2× the size it is displayed at. Evidence lands in `docs/verification/website/`.

## Catalog, scope and positions

Schema 2 retains existing configuration identifiers and adds explicit fields. It supports 13 facades, 11 existing combined opening/type/color choices, a separate `openingMaterial`, 11 rooflight choices, `greenRoof`, `overhang`, `roofShade`, `painting`, exterior service variants, and positioned interior fittings. Existing `*-black` identifiers remain black; unspecified legacy frame material stays `unspecified`.

Dimensions remain 150–750 cm wide, 100–340 cm deep and a schematic fixed height of 280 cm. Opening minima are provisional geometry checks, not manufacturer approvals: none 150, French 210, two-panel sliding 230, four-panel sliding/folding 370 cm. Admin publications may narrow supported geometry; new model types require implementation.

The four UI steps are structure/exterior, interior, site/scope, and summary/quote. Interior off resets its dependent values after validating supplied types. Painting requires plaster; shade is restricted to `lean-1/2/3`; overhang spots require an overhang. `rollaagEnabled` defaults to true for older inputs; false removes its charge/scope while preserving the `rollaag` finish for later restoration.

| Selection array | Values | Legacy compatibility field |
| --- | --- | --- |
| `ceilingPositions` | `left`, `center`, `right` | `ceilingLights` count |
| `spotPositions` | `r1c1` through `r3c5` | `spotlights` count |
| `socketPositions` | `L1`, `L2`, `L3`, `R1`, `R2`, `R3` | `sockets` side selection |
| `wallLights` | Same six wall slots | New field |

Arrays, when supplied, are authoritative. Older counts/sides derive initial positions. Duplicates, unknown positions and wrong types produce 422. Valid but conflicting selections are removed in the successful response config. `allowedPositions`, `positionIssues` and `clearedSelections` explain availability and any removed choices; the UI adopts that config. Socket preparation is charged per selected position, not merely per selected wall.

In the 2.3 source, numeric model envelopes check roof openings, wall/ceiling edges, selected pendants, spots and radiator clearance. A pendant row uses the clear front ceiling strip when it fits; a rooflight does not automatically remove the middle pendant when there is room for it. Accepted pendants take precedence over nearby spots. A very narrow room can fit the outer pendants while rejecting an additional middle pendant. Radiator checks use the selected column or panel model: an electrical socket can fit below a short panel while the same location overlaps a tall radiator. The radiator's own mechanical preparation connections are separate from electrical sockets.

The exterior lamp and socket share a vertical axis at their own heights. The tap sits at least 35 cm sideways toward the corner, with separate checks for the rain pipe and opening edges. If the front wall pier cannot fit the group, all fittings on that side use the adjacent exterior sidewall. The tap is nearer the front corner; the electrical axis is farther back. If the sidewall also lacks room, the selection is disabled with an explanation. These distances describe the indicative model and are not electrical or construction approval.

### Shared fixture layout

For the new asset revision, pricing includes `fixtureLayout` with `version: 2` and `units: 'cm'`. Coordinates are fixed by dimensions, roof, opening, rain-pipe side and geometry rules; selecting a different lamp or spot does not move the other positions.

| Layout field | Contents |
| --- | --- |
| `basis` | Width, depth, height, `frontOpening`, `rooflight`, `drainSide`; identifies the configuration the packet belongs to |
| `ceilingPositions` | `left`, `center`, `right` mapped to `[x, y, z]` |
| `spotPositions` | Fifteen `r1c1`–`r3c5` coordinates |
| `wallPositions` | Each `L1`–`R3` slot has separate `socket` and `light` coordinates |
| `heating` | Left and right radiator coordinates |
| `exterior` | Left/right groups with `surface`, radian `rotation`, `available`, `light`, `socket`, `tap` |
| `roofBounds` | Roof opening bounds `[left, right, back, front]`, or null |

`buildGeometry(config, {fixtureLayout, scope, geometryRules})` converts the packet to metres once. It accepts a server packet only when its basis matches the current dimensions and selections; integer-centimetre comparison avoids binary floating-point drift. Without a matching packet, the same numeric formulas generate a local preview. The scene and plan use the resulting fixture positions. The shared `underfloorLoops` route is a representative floor illustration; hiding examples also hides preparation-only floor loops, while an explicitly supplied product depiction can remain visible.

Each selected scope item has `key`, `label`, `value`, `quantity`, `catalogRevision`, `visualMode`, `modelFidelity`, `assetKey`, `productIncluded`, `components` and `summary`. Component roles are `preparation`, `product`, `installation` and `connection`.

| Component status | Commercial meaning | Additional amount |
| --- | --- | --- |
| `excluded` | Not supplied in this selection | Zero |
| `included` | Bundled in the casco price | Zero; remains visible in scope |
| `extra` | Supplied as a separately priced component | Server rate, using option/count/area/fixed basis |

Radiators, taps, lights, sockets and switches default to excluded products. Their preparation can be charged independently. Floor-heating preparation means preparing/lowering the floor, not promising installed pipes or connection. Warnings consult the saved component statuses; excluded preparation must not be described as installed.

`visualMode` is separate from commercial scope: representative device, product depiction, preparation point or none. Hiding examples does not change the order. Current model fidelity is `representative`. Supported alternatives are `heating`/`heating-panel` and `ceilingLights`/`ceiling-dome`; other components use their supported generic key. Catalog `assetRevision` identifies the renderer library and participates in the release hash.

## Odoo catalog administration

`cs.prefab.catalog.release` is scoped to company and website. Sales managers use **Prefab → Catalogus en levering** to create drafts. The normal interface uses native EUR fields, named choices/defaults, descriptions, numeric geometry limits and component statuses. A published catalog opens read-only; **Bewerken via nieuw concept** copies it into an editable draft. Raw JSON appears only in the read-only developer diagnosis tab.

The native editor uses temporary records and an explicit **Wijzigingen toepassen** action. It patches only edited fields into the existing catalog/pricebook and component price tables, preserving reference metadata, existing overrides and untouched values. Opening or applying an unchanged editor does not regenerate a release. A source hash and parent row lock reject stale workbooks instead of overwriting another session. Sub-cent price inputs are rejected, and negative ones everywhere except a product package line marked *Minderprijs toegestaan*. The **Basisprijzen** page edits the optional casco price curve (switch, fixed base, factor per m², growth exponent, rounding); switching it off removes the key, and an unchanged apply never adds one.

**Leveringsprijzen** contains the actual component rates used for customer pricing. **Referentieprijzen** edits the underlying base option tables; these do not automatically replace existing component overrides. Status and pricing basis remain separate: an included component adds zero even when a rate is retained for a future separately priced state. Named choices can create a full per-choice delivery rule by copying the standard rule. Internally, `value_key='*'` is the common rule; a specific value such as `left` or `both` replaces its whole policy. Multi-position fields share a policy and quantity.

Publishing validates schema/geometry, device roles, integer prices (non-negative outside product-package reductions), a complete `baseCurve` when present, and explicit option rates. EUR demonstration releases remain the default. A commercial draft additionally requires a non-demo pricebook version, source/decision reference, conditions and explicit confirmations of rates, scope and VAT. **Concept controleren** validates the draft; **Commercieel goedkeuren** attests its exact content; publication is a separate action. The approval hash includes company/website context. Content, component, company or website changes invalidate approval; a no-op editor save does not.

One frozen release supplies validation, pricing, scope and quote creation within a request. Publication retires the previous release for that website; record locks and a transaction advisory lock serialize mutations/publication. Published release data and children cannot be edited, deleted or moved to another release. See the [native administration workflow](native-odoo-workflow-2.2.md).

The local server uses the same bundled JSON and policy resolver but has no Odoo admin interface. With no published Odoo catalog for a website, the adapter uses that bundled demonstration release.

## Snapshots, retries and privacy

New quotes store `snapshotVersion: 2`, `catalogRevision`, `assetRevision`, the catalog definition for original-schema retry validation, canonical config, frozen labels, full price, independent scope, timestamp and consent. In 2.3, the full `price.fixtureLayout` packet and the complete `modelPolicies` asset resolver, including per-choice overrides, are included in that immutable snapshot. PDF/HTML, native request projections and CRM descriptions use the saved scope, including zero-extra-cost included items. They do not consult current prices when reopening a request.

Legacy snapshots without the new schema remain unchanged. The original v1 catalog is kept in `catalog.legacy-v1.json` for retry validation. Schema-2 snapshots with known asset revisions `2026-09-13.1`, `.2` or `.3` retain their previous mounting normalization; `.4` uses the new layout. This distinction is forwarded through catalog/default placement, configuration normalization and pricing. It prevents a retry of an old quote from silently adopting new ceiling rules. Old label semantics and saved images remain intact. A share opens a design for current review/pricing and is not a frozen commercial quote. Historical shares without metadata return a null catalog revision and schema `1.0`.

Retry normalization uses the frozen model resolver. For historical snapshots it restores selected assets from saved scope and can identify a rejected radiator model from uniquely matching saved availability evidence. It never searches candidate payload hashes or changes the historical snapshot. If both the original model policy and sufficient geometry evidence are missing, an old retry can conservatively fail with a conflict; the original quote remains intact.

The UUIDv4 submission key is unique within company/website. SQLite serializes lookup/create in one transaction and rejects snapshot updates with a trigger. Odoo uses a PostgreSQL advisory lock and unique constraint; snapshot fields are immutable while workflow state remains editable. A changed request with a reused UUID returns `idempotency_conflict` without exposing the old private token.

Six document views can be saved: `perspective-left`, `perspective-right`, `interior`, `plan`, `front`, `side`. `configKey` is sorted compact canonical JSON without postcode. JPEG framing, size and metadata are checked; labels are fixed by the server. This cannot authenticate the meaning of client pixels. Image limits are 768 KiB each, 4 MiB combined, 256–2000 pixels per side and at most 2.5 million pixels. Capture version participates in retry identity; changing JPEG bytes does not replace the original bundle. WebGL fallback supplies technical diagrams; absent old 3D captures are not invented.

Share and PDF tokens contain 256 bits of randomness and expire after 30 and 90 days respectively. PDF URLs expose private contact data and must stay confidential. Private/API responses use `no-store` and `no-referrer`; proxy/Odoo access logs must redact token paths. Public and portal users have no model grants. Limits are 10 quotes/hour, 30 shares/hour, 240 prices/minute and 300 reads/minute per process/IP; multi-worker deployments need corresponding proxy limits. The configurator does not automatically send or confirm a sales quotation; users can perform those actions in native Odoo.

## Odoo adapter and verification

Dependencies are `website`, `crm`, `sale_management`, `sale_crm` and `sale_project`. The adapter resolves the website with `get_current_website()`; this exact target uses `fallback=None`. Odoo 19.4 security uses `ir.access.csv`, with group grants and company restrictions, rather than removed `ir.rule`/`ir.model.access` models. Public lookups and writes are bound to the resolved company/website. Privileged adapter and native synchronization operations derive records and prices from validated requests; the catalog editor/preview applies ordinary manager and company access checks.

A submission creates an immutable request and CRM opportunity, then links a customer and a filled native draft sales quotation. CRM receives the saved selections, scope and price status; initial expected revenue is zero for demonstration pricing, or the approved commercial subtotal. Included items become zero-priced sales lines, extra items carry saved quantities/rates and excluded scope appears as a note. Native Odoo handles company taxes, fiscal positions and units (`m²`, unit and `Post`). Product Unit precision is at least four decimals so, for example, 501 × 299 cm retains 14.9799 m².

Missing business settings, such as a matching company sales tax, leave the submitted request available with a visible synchronization error and a responsible-user activity. They do not cause a guessed tax to be used. Synchronization can be retried from Odoo. Existing linked documents and user-edited sales lines are retained; only an untouched empty CRM draft is eligible for automatic filling.

When a user confirms the native sales quotation, the base service's native `sale_project` tracking creates or reuses the project. The CRM stage is preserved. A follow-up activity asks the responsible user to review that stage; reconfirming does not duplicate the project or recreate a completed follow-up. Native customer/order changes do not rewrite the submitted snapshot. The request form exposes readable contact, selection, price and image rows plus links to customer, CRM, sale and project. See [the confirmed 2.2 workflow and acceptance](native-odoo-workflow-2.2.md).

The daily cron removes expired private requests/shares, not CRM leads, customer cards or sales documents. Native quotation images are separate Odoo attachments and can remain with the commercial document after the private configurator link expires.

The public PDF uses the bundled standard-library writer and DejaVu Sans font. The internal Print menu uses QWeb and the target's wkhtmltopdf stack. Both document paths need separate acceptance. Images and labels come from the snapshot; long scope/specification tables paginate. Source and earlier PDF evidence is retained in [PDF design](pdf-design.md) and [historical Odoo PDF verification](pdf-odoo-verification.md).

On a prepared disposable clone, run the actual adapter suite:

```bash
odoo-bin --database=YOUR_DISPOSABLE_DB --update=cs_prefab_configurator \
  --test-enable --test-tags=/cs_prefab_configurator --stop-after-init --workers=0 --max-cron-threads=0
```

The source suite contains eight HttpCase tests, eight catalog-editor TransactionCase tests and nine native-sales TransactionCase tests. They cover HTTP/CRM/PDF, actual QWeb PDF rendering, immutable visual snapshots, website isolation, input controls, approval and draft preview, lossless native catalog editing, populated quotations, project/activity behavior and role access. Fixtures select or create a website for the test company; no demo website XML ID is required.

The published 2.4 source passed 109 standalone Python tests, 86 JavaScript tests, 26 Odoo tests on the exact-image clone, five document-capture scenarios, five reset regressions and ten live browser checks. Native appearance editing and actual website CSS/fonts were checked in the isolated clone. [Current evidence](verification/2.4/README.md) records scope and results; earlier native workflow and deployment reports remain historical evidence.

For the supplied Coolify startup, deploy the root `addons/requirements.txt` as `/mnt/extra-addons/requirements.txt`. It includes `cs_prefab_configurator/requirements.txt`; module-level files are not discovered automatically. The module currently needs no additional pip packages. Mount, backup and rollout details are in [deployment notes](deployment.md).

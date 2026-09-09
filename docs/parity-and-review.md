# Implementation parity and independent review

Reviewed 2026-09-09 against the public Prefab Partner definition and the working local application at `http://127.0.0.1:8078/prefab`. Reference conclusions and original browser evidence are in [reference-audit.md](reference-audit.md). This is an independent review; application, preview and backend fixes were assigned to their respective owners.

## Catalogue parity

The canonical catalogue preserves **all 22 source option questions and all 94 source answers**, including source question/answer identifiers. An automated comparison checks sets of answer IDs, uniqueness of canonical IDs and presence of every product field in the guided UI. The remaining source questions are width, depth and nine contact fields, making **33 source questions in total**.

| Source behavior | Implemented representation | Review |
|---|---|---|
| Width 150–750 cm, depth 100–340 cm, step 1 | Number inputs, sliders and increment buttons | Exact catalogue range; validated on server |
| 13 façade choices | Native radios with procedural material swatches | All mapped |
| 3 soldier course / panel choices | Native radios | All mapped |
| 11 frame configurations | Native radios with SVG diagrams | All mapped |
| 8 rooflight variants | Native radios with SVG diagrams | All mapped |
| 2 roof trims | Native radios | All mapped |
| Exterior light 4 / socket 3 / tap 3 options | Native radios grouped under Buiten | All mapped |
| Downpipe material 2 / side 2 options | Separate native radios | All mapped |
| Interior yes/no branch | Toggle choice and eight conditional fields | All mapped; hidden values reset |
| Plaster and screed yes/no | Native radios | All mapped |
| Underfloor heating yes/no; radiator 4 options | Native radios | All mapped |
| Ceiling points 0–2, switches 0–2, spots 0–12 | Numeric counters | Typed numeric values preserve all original choices |
| Interior socket 4 options | Native radios | All mapped |
| Demolition yes/no; rear access yes/no | Native radios | All mapped |
| Piles 2, 3, 4 or 6 | Native radios with numeric IDs | All mapped; only these four values are valid |
| First name, last name, email, telephone, street, house number, postcode, city | Eight labeled contact inputs | Present and required in UI |
| Optional note | Labeled textarea | Present |

The source's 20 input pages are grouped into seven clearer sections and a contact dialog. This is an intentional workflow improvement, preserving the individual choices. The local app starts with a usable 500 × 300 cm configuration and explicit defaults; the source starts with empty required dimensions. A fixed 280 cm height is an implementation assumption, constrained in the catalogue and disclosed as schematic. These are not claimed as source-provided manufacturing defaults.

The source is an image-layer quote request form. The new 3D scene and SVG plan are original procedural geometry driven by canonical configuration keys; no third-party image URLs are production dependencies. Exterior left/right is defined from the garden, with model axes front `+z`, left `-x`, up `+y`. Frame dimensions, wall thickness, roof thickness and heights remain schematic rather than manufacturing data.

## Findings and resolution tracking

| Finding | Evidence / consequence | Resolution status |
|---|---|---|
| Preview enlarged minimum valid dimensions | Initial geometry clamped width to 200 and depth to 150, while catalogue permits 150 × 100 cm | Resolved: exact source ranges now used; minimum-size solids, apertures and all roof variants covered by passing geometry tests |
| Draft accepted nonexistent five-pile choice | Initial numeric fallback accepted `piles:5` within min/max although not in options; server subsequently rejected quote/price | Parent fixed option membership before numeric fallback; regression test passes |
| Contact validator threw for malformed types | `firstName:123` previously invoked `.trim()` on a number | Parent added typed string handling; malformed-field regression passes |
| Contact accepted punctuation-only phone and arbitrary house number | Frontend accepted values that backend rejects | Parent added digit count and address-number checks; regression coverage added |
| Email frontend/backend divergence | `<name>@example.test` initially passed frontend but was rejected by backend | Resolved: frontend excludes angle brackets; regression passes |
| Keyboard focus lost after option changes | Actual browser: focus façade radio, ArrowRight; selected value changes to `brick-black`, active element becomes `BODY` | Resolved and rerun in Chromium: repeated ArrowRight retains the selected radio focus; repeated counter Enter also works |
| Closed contact modal caused async exception | Intercepted quote response with delayed 503, closed dialog and opened privacy; pageerror: `Cannot set properties of null (setting 'textContent')` | Resolved and rerun: delayed intercepted 503 is handled without a pageerror after replacing the dialog with privacy |
| Shared design edits overwritten on reload | Initial `initialize` always prioritizes `?share=` over locally saved edits | Resolved and rerun: first edit detaches share query; imported 430 cm, edited 610 cm, reloaded 610 cm |
| Network price failure poisoned subsequent edit state | Fetch rejection had no `fields`; assigning undefined caused next edit to throw | Resolved and rerun with actual request abortion: next width edit recovers price and preview |
| Summary edit-link crash | Generic tab updater also selected summary links lacking a step-number node | Resolved and rerun: summary Gevel edit returns to step 2 without runtime error |
| Source required address/city absent in server required-field list | UI requires street/city, initial direct API accepted omissions | Resolved in server code: firstName, lastName, address and city are now required alongside the other contact fields; frontend sends separate names |

The asynchronous error reproduction used browser interception and created no server quote. Local runtime tests use reserved `example.test` contact data and do not send external messages.

## Data flow and commercial scope

One canonical catalogue feeds frontend defaults, option lists and Python validation. Price requests carry only configuration. Server pricing generates integer-cent line items and is authoritative; the UI does not send a proposed price. Request sequence numbers discard stale price responses. The UI labels totals as **Voorbeeldprijs**, explains the demonstration price book in the price dialog and summary, and says the local demo does not send email. The source's promise of an email within 24 hours is intentionally not reused as a working delivery guarantee.

The implementation preserves the reference's meaningful scope exclusions: lighting/switch/socket and radiator selections refer to prepared conduits or connection points; light fixtures are excluded. Underfloor-heating text excludes connection to the existing installation. Pile selection is described as provisional and subject to a constructor's assessment. It does not turn the source's rough area table into an engineering design.

Browser drafts save the normalized configuration without postcode or contact details. Shared links strip postcode server-side and have separate unguessable tokens; quote records carry contact details and private document tokens. The local service sends `no-store` on API documents, `no-referrer`, a same-origin CSP and no external fonts/scripts. Draft import ignores unknown fields, contact payloads, prototype-shaped keys, invalid dimensions, unsupported options and wrong primitive types.

Quote submission uses a fingerprinted UUID v4 idempotency key. The database prevents duplicate keys, saves immutable snapshots, enforces expiry on reads and separates share data from contact records. The frontend keeps contact details in memory while the dialog is open/closed to support corrections, without adding them to local draft storage. Production business identity, real price book, delivery and retention operations remain explicit deployment work rather than features proven by this local review.

## Tests added

`tests/frontend/model.test.mjs` covers behavior that can fail across storage, UI and server boundaries:

1. Exact source catalogue/answer coverage and typed option identity.
2. Full centimeter ranges and fixed schematic height.
3. Corrupt/null/array drafts, injected unknown fields, contact removal and prototype-shaped objects.
4. Boundary, fractional, string, boolean and non-finite dimension values.
5. Preservation of numeric zero/counts and boolean false choices.
6. Rejection of a five-pile draft and wrong typed IDs.
7. Clearing all eight hidden interior fields without mutating the input or exterior selections.
8. Contact presence, syntax and malformed-type handling.
9. HTML escaping for text/attribute contexts, Unicode labels and zero-valued option labels.

Command: `node --test tests/frontend/model.test.mjs`. Tests intentionally compare public behavior and source coverage, not implementation text. Final outcomes and rerun observations are appended after repairs.

## Verification outcome after repairs

`node --test tests/frontend/*.test.mjs` passed **29/29 tests**: 18 catalogue/model/validation tests and 11 geometry tests. The saved TAP log is `docs/verification/model-and-geometry.tap`.

All **6/6 targeted actual-browser interaction checks passed**, with zero page errors and unchanged app/model/geometry source hashes during the run. Checks are implemented in `scripts/verify-interactions.mjs`, with results and exact app/model/geometry hashes in `docs/verification/interactions-review.json`. They exercise keyboard focus, imported share edit/reload, async dialog replacement, offline pricing recovery, summary editing and corrupt-draft recovery at the minimum valid dimensions. These tests intercept all quote submissions; one local share record is created per complete test run. They neither create a quote nor send email.

The initial failing minimum-size browser assertion in this verification script came from an audit fixture using numeric version `1` instead of catalogue version string `"1.0"`; the application correctly ignored the incompatible draft. The fixture now reads the actual catalogue version. This was an audit-test correction, not an application defect.

The source and implementation both offer schematic choices rather than a construction approval. Local functional parity, generated quote/PDF flow and catalogue correctness are distinct from untested Odoo deployment, a confirmed commercial price book and real email delivery.

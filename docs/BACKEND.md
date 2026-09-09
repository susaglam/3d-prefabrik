# Backend and Odoo integration

The same Python services validate and price configurations in the local server and the Odoo adapter. The public catalogue reproduces the observed questionnaire choices. The price book is independently invented demonstration data: the reference configurator exposes no customer price calculation. The current module must not be presented as an approved commercial quotation system.

## Run locally

```bash
python3 scripts/serve.py --port 8069
```

Open `http://127.0.0.1:8069/prefab`. Python 3.10 or later is sufficient; the runtime uses the standard library, including a real PDF writer. The default database is `.data/prefab.sqlite3`; it survives process restarts. The process binds to localhost by default. `--db /path/to/file.sqlite3` chooses a separate database. A trusted reverse proxy can use `--public-origin https://your-domain.example`; the browser Origin must match exactly. This development HTTP server is not a production application server.

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/serve.py --purge-expired
```

`requirements-dev.txt` contains only the optional independent `pypdf` parser for PDF verification. The renderer itself does not require it. Without that parser, the two independent PDF extraction tests are explicitly marked skipped. SQLite expiry cleanup runs at startup or on the explicit purge command; schedule the latter daily if the local server stays running.

## API

Requests and responses are JSON except document downloads. POST requests require `Content-Type: application/json` and an exact same-origin `Origin` header. There is no CORS grant. Payloads are limited to 32 KiB; duplicate JSON keys, nonfinite values and excessive nesting are rejected.

| Method and route | Input | Result |
| --- | --- | --- |
| `GET /prefab/api/catalog` | — | Version, defaults, dimensions, grouped option labels, visibility/reset rule, demo disclaimer |
| `POST /prefab/api/price` | `{config}` | Canonical config, labels, line items, area, integer cent totals and warnings |
| `POST /prefab/api/share` | `{config}` | Random token and `/prefab?share=...` link; 30-day lifetime |
| `GET /prefab/api/share/{token}` | — | Configuration only; postcode blank; no contact record |
| `POST /prefab/api/quote` | `{config, contact, consent: true, idempotencyKey: UUIDv4}` | Reference, private token, PDF URL, frozen price and timestamp |
| `GET /prefab/api/quote/{token}/pdf` | — | Actual paginated A4 PDF generated from the saved snapshot |
| `GET /prefab/api/quote/{token}/html` | — | Escaped printable HTML from the saved snapshot |
| `GET /prefab/api/health` | — | Storage mode and readiness; `emailDelivery: false` |

The canonical contact object requires `firstName`, `lastName`, `email`, `phone`, `address`, `houseNumber`, `postcode` and `city`; `message` is optional. `name` is accepted for frontend compatibility and recomputed from the two required name fields. The configuration postcode may be blank before submission; if supplied it must equal the contact postcode. Email addresses and Dutch postcodes are normalized. Contact consent is required and stored with wording version `quote-contact-v1`; no marketing consent is inferred.

All monetary fields (`subtotal`, `vat`, `total`, `unitPrice`, line `total`) are **integer euro cents**. Every line is rounded half-up in Decimal arithmetic, then VAT is calculated on the summed rounded net lines. Client totals, line prices, scope IDs and arbitrary extra fields are rejected. Only the server price book controls calculation. The demonstration book uses a flat 21% example rate; production tax treatment must be established for the actual goods and services before replacing it.

Errors use `{error: {code, message, fields}}`. Validation uses HTTP 422, malformed JSON 400, origin mismatch 403, unknown/expired tokens 404, a reused UUID with different data 409, oversized input 413, incorrect content type 415 and rate limits 429.

## Catalogue and branch behavior

`addons/cs_prefab_configurator/data/catalog.json` preserves the source question and answer UUIDs as provenance and the Dutch labels/descriptions. The source permits width 150–750 cm and depth 100–340 cm, in whole centimeters. Height is a fixed 280 cm schematic rendering assumption, hidden from the dimensional inputs. This is not a measured construction drawing.

There are 13 facade choices, 11 combined frame/door/color choices, eight rooflights, the original roof trims, rollaag choices, exterior service positions, drain choices, interior finish/electrical choices, wall opening, rear access and 2/3/4/6 pile choices. No unobserved side-window/material/glazing options are silently added. Pile count is a customer selection and is not inferred from dimensions without an engineering rule.

When `interior` is false, all eight hidden interior values reset to defaults on the server. Invalid supplied options are rejected first, even in the hidden branch. This prevents stale selections being charged after a user skips the interior. The preserved wording distinguishes empty conduits, prepared lamp points and floor-heating preparation from final installation/connection.

## Saved requests and privacy

Each quote freezes the canonical configuration, Dutch selection labels, the full price result, pricebook/schema versions, the timestamp and contact consent. Documents read this snapshot and do not reprice against a newer book. The local database prevents updates through an immutable-row trigger. Odoo blocks updates to frozen quote fields through the ORM; workflow state remains editable.

The UUID is unique within company/website scope. A retry with identical normalized customer/configuration data returns the existing result. A collision with different customer or configuration data returns 409 and never reveals the original private token. SQLite serializes lookup/create in one write transaction; Odoo uses a PostgreSQL transaction advisory lock plus a database unique constraint. No browser-supplied company, website or CRM identifiers are accepted.

Share tokens contain 256 bits of randomness and expire in 30 days. They expose only the configuration with postcode removed. Private PDF tokens also contain 256 bits of randomness and expire in 90 days. The PDF includes contact information: treat its URL as confidential. API responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; local logs omit bearer tokens and body data. Reverse-proxy logs must likewise redact quote/share token paths. Odoo's default Werkzeug access logger includes paths; configure `--log-handler=werkzeug:WARNING` or equivalent access-log redaction before deployment. Public/portal Odoo users have no model ACLs.

Per-IP limits are 10 quote submissions/hour, 30 shares/hour, 240 prices/minute and 300 API reads/minute. The limiter is bounded and process-local; Odoo deployments with multiple workers need corresponding shared limits at the reverse proxy. It does not send email or call external services. The UI must not claim that an email was sent.

## Odoo adapter

The addon targets the same `saas~19.3` series as the sibling product configurator, with dependencies `website` and `crm`. Add this repository's `addons` directory to `addons_path`, install `cs_prefab_configurator`, and open `/prefab`. Static assets are served through Odoo's normal `/cs_prefab_configurator/static/` route.

The selected website determines company and website scope on every lookup/create. The public controller builds only validated values and uses `sudo()` solely inside that scope. An accepted request creates one CRM opportunity and one linked immutable request in the same database transaction. The CRM description contains the saved choices and demo qualification; expected revenue remains zero while prices are demonstrations. No automated mail is triggered. Sales staff can read requests and update workflow state; sales managers can remove records. Company rules apply to backoffice reads.

An internal QWeb report is available from the request's Print menu; the public PDF route uses the dependency-free renderer, so it does not depend on wkhtmltopdf. A daily cron removes expired quote/share records. CRM leads have a separate retention lifecycle and are not removed by this cron; configure retention for those customer records in the target organisation.

The public PDF embeds the bundled, licensed DejaVu Sans TrueType font with explicit Unicode character maps. Turkish names such as `Şükrü Çağrı` survive both rendering and extraction, verified with two independent PDF readers. Its dimensioned footprint is generated from the frozen configuration. Font coverage is finite; complex-script shaping and characters outside DejaVu Sans coverage are not supported by this compact renderer. The sample PDF and visually reviewed first page are in `docs/verification/backend/` and contain synthetic contact details.

## Verification performed on 2026-09-09

The standalone suite has 30 tests; all 30 passed in the isolated Python environment with `pypdf 6.18.0`. A standard-library-only run passes 28 tests and explicitly skips the two optional parser tests. A new PostgreSQL 16 cluster on port 55478 and a clean upstream Odoo `saas-19.3` checkout at `b01000720dc5bbbdc250eb92997f1815501dcfda` were used to install this module and its dependencies successfully. The separate Odoo HttpCase suite passed all three actual HTTP/ORM tests, including CRM creation, idempotency, frozen records, public ACL denial, cross-company/website share and PDF isolation, origin checks, input rejection and internal QWeb HTML rendering.

The command for the addon suite in any prepared disposable Odoo environment is:

```bash
odoo-bin --database=YOUR_DISPOSABLE_DB --update=cs_prefab_configurator \
  --test-tags=/cs_prefab_configurator --stop-after-init --max-cron-threads=0
```

The evidence file is `docs/verification/backend/backend-results.json`. The separate browser evidence covers the standalone server and the actual Odoo storefront. No existing database, running project or production service was modified for this rehearsal.

The isolated source, Python environment, PostgreSQL data and logs were retained under `/tmp/cs-prefab-*` for inspection. They are disposable rehearsal resources, not a durable deployment. To restart that same prepared environment on this workstation:

```bash
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/cs-prefab-pgdata \
  -l /tmp/cs-prefab-postgres.log -o '-p 55478 -h 127.0.0.1 -k /tmp' start
/tmp/cs-prefab-odoo-venv/bin/python /tmp/cs-prefab-odoo-19.3/odoo-bin \
  --addons-path=/tmp/cs-prefab-odoo-19.3/addons,/mnt/e/Projeler/cs_prefab_configurator/addons \
  --db_host=127.0.0.1 --db_port=55478 --db_user=sukru --database=cs_prefab_isolated \
  --data-dir=/tmp/cs-prefab-odoo-data --http-interface=127.0.0.1 --http-port=8079 \
  --max-cron-threads=0 --log-handler=werkzeug:WARNING \
  --logfile=/tmp/cs-prefab-odoo-browser-final.log
```

Open `http://127.0.0.1:8079/prefab`. To rerun the three Odoo integration tests, append `--update=cs_prefab_configurator --test-tags=/cs_prefab_configurator --stop-after-init` to that server command. To repeat every standalone test including independent PDF parsing, run `/tmp/cs-prefab-odoo-venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v` from this repository. Stop only this isolated PostgreSQL cluster with `/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/cs-prefab-pgdata stop -m fast` after stopping its Odoo process.

Before a production deployment, replace and approve the demo price book, confirm the precise scope of every install/connection item, set the website domain, configure TLS and proxy rate limits/log redaction, establish CRM ownership/retention and perform the deployment on an isolated clone of the actual target database first. No live site deployment or contact submission to the reference vendor is part of this implementation.

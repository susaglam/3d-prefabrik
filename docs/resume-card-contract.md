# The resume card: one contract, every configurator

Written for: whoever implements the "Je ontwerp staat klaar" bar on the website, and whoever writes
the next configurator (dakkapel, veranda) that wants to appear in it.

Status: agreed with the customer 2026-09-21, not yet implemented. The bar itself is version 2.15.0.

## Why a contract at all

The visitor's draft lives in their own browser, in a shape that belongs to the configurator that
wrote it — `cs-prefab-design-v1` today is `{version, config, savedAt}` and the aanbouw's `config` is
nobody else's business. A dakkapel will save something else entirely.

So the bar does not read drafts. Each configurator **publishes a resume card**: one small, flat
record that says "there is an unfinished design, here is what it is called, what it costs and where
to continue it". The bar reads only that. Adding a configurator later touches no website code.

    Draft  = the configurator's own business, its own key, its own shape.
    Card   = the shared contract, one key, this document.

## The key and the shape

    localStorage['cs-resume-v1'] = {
      "aanbouw": {
        "label":    "Aanbouw",                    // what the visitor sees beside the price
        "url":      "/prefab",                    // where continuing takes them (same origin)
        "total":    7557000,                      // cents, incl. btw; omit when unknown
        "revision": "odoo-1-1-14-ddc17ebcbc24",   // catalogue revision the total was priced on
        "savedAt":  "2026-09-21T00:12:05.441Z"    // ISO, when the draft was last touched
      }
    }

Rules for the writer (the configurator):

1. Write the card in the same place the draft is persisted, and only when the visitor has actually
   changed something — a card for the untouched default design is an invitation to nothing.
2. Remove your own key on reset, and after a quote has been submitted: somebody who has sent a
   request must not be chased by a bar asking them to finish it.
3. Never put personal data in the card. No postcode, no name, no e-mail. The draft itself already
   strips the postcode (`persist()` in app.js) and the card carries less than the draft does.
4. Keep the card small and flat. It is read on every page of the website; it is not a second store.

Rules for the reader (the website bar):

1. Read `cs-resume-v1`, take the most recent entry by `savedAt`. One entry is shown in 2.15.0;
   the shape already allows "+1 ander ontwerp" later without another migration.
2. Show the price only when `revision` matches the catalogue the site is serving now. A total priced
   on an older catalogue is not wrong by a little, it is unverifiable — show the label alone.
3. Never show the bar on the configurator's own page (`url` is the current path), nor in the
   administrator's preview, nor when the switch below is off.
4. Anything unreadable — absent key, bad JSON, unknown fields — means no bar, silently. A broken
   card may never break a page.

## Settled behaviour (2026-09-21)

| Question | Decision |
|---|---|
| Copy | Title **"Je ontwerp staat klaar"** — product-neutral on purpose, because dakkapel and veranda follow. Under it: `label · price`, e.g. "Aanbouw · € 75.570". |
| Price | The visitor's own saved total, no "vanaf": it is what their design came to, not a starting price. Hidden when the catalogue revision has moved on. |
| Stale after | 30 days. Older than that, no bar. |
| Dismissal | The × hides it for 7 days, per product: dismissing the aanbouw bar does not silence a dakkapel design made afterwards. A fresh save clears the dismissal. |
| After a quote is sent | No bar. The configurator removes its card on submit; the visitor has their quote link and their e-mail. |
| Which pages | Every page of the prefab website except the configurator itself. Predictable beats clever. |
| Admin switch | Vormgeving → "Doorgaan-melding tonen", default **on**. One switch for every configurator, not one per product. |
| Placement | Bottom right on desktop, bottom edge on a phone, above any existing bottom bar and inside the safe area. Slide-in respects `prefers-reduced-motion`. |

## Where the code goes

- Website module, site bundle, **two new files**: `static/src/js/resume_bar.js` and
  `static/src/scss/resume_bar.scss`, plus two lines in `__manifest__.py`. Deliberately not inside
  `prefab_site.js` / `prefab_site.scss`: the theme pass is working in those files.
- The bundle is downloaded by every website on the instance, so the script stays small and returns
  on its first line when `.o_prefab_site` is absent — the same rule the existing site script follows.
- Configurator module: write and clear the card where the draft is written and cleared.
- One test pins that both sides use the same key and field names, the way the Python and JS option
  lists are pinned to each other today.

## What proves it works

- Frontend unit tests: the reader's rules — most recent entry wins, stale entry ignored, dismissal
  window honoured per product, bad JSON ignored, price hidden on a revision mismatch.
- A browser proof: with a card present the bar appears on a site page and not on `/prefab`; the
  arrow lands on the card's `url`; the × keeps it away on the next page load.
- An Odoo test for the switch, like every other Vormgeving field.
- Clone gate: `EXPECTED_TESTS` 144 → 145.

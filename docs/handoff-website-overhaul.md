# Handoff: website overhaul (start here in the new chat)

Written for: the next Claude Code session in this repo, and Şükrü reading along.

Paste the prompt at the bottom into the new chat. Everything above it is what that session
needs to know before it touches anything.

---

## 1. Where things are

| | |
|---|---|
| Repo | `E:\Projeler\cs_prefab_configurator` (branch `main`, nothing committed since `f3da26e`) |
| Configurator addon | `addons/cs_prefab_configurator` — version `saas~19.4.2.14.1`, live |
| Website addon | `addons/cs_prefab_website` — version `saas~19.4.1.0.0`, **this is the overhaul target** |
| Live | <https://prefabpartner.codesnap.nl> (`/prefab` = the configurator, the site pages = the website module) |
| Intended domain | `https://prefabpartner.nl` — set as a parameter, **not** yet written into `website.domain`; DNS has not been switched |
| Support modules | `E:/Source/cs-odoo-modules` (cs_security_base, cs_help_base, cs_studio_workspace, cs_web_responsive) — packaged with every release |

## 2. What the website module already is

`addons/cs_prefab_website` builds prefabpartner.nl as a **second website record inside the same
Odoo**, isolated by one field: `website.cs_prefab_site`. Every template, asset bundle and style
rule is gated on it, so website 1 (the existing one, with `/prefab`) is untouched. Read
`addons/cs_prefab_website/README.md` first — it explains that isolation and why the domain field
is a precondition rather than a preference.

What it ships today:

- `views/` — `layout_templates.xml` (header/footer), `page_home.xml`, `page_oplossingen.xml`,
  `page_overige.xml`, `project_templates.xml` + `project_views.xml` (gallery as editable records),
  `news_templates.xml` (Odoo Blog), `offerte_templates.xml` (quote pages), `seo_templates.xml`,
  `snippets/`
- `data/` — `website_data.xml` (bootstrap: palette, menus, fonts), `page_data.xml`, `blog_data.xml`,
  `project_data.xml` + `projects.json`, `media_data.xml` + `media_index.json`,
  `redirect_data.xml` + `url_map.json` (a target for every old WordPress URL)
- `static/src/` — `scss/`, `js/`, `img/`, `media/`, `video/`, `pdf/`
- `tests/` — `test_pages.py`, `test_offerte_pages.py`, `test_site_on_existing_website.py`
  (63 Odoo tests; the configurator adds 81, so the clone gate expects **144**)

## 3. Rules that are not optional

These have all cost time at least once. The global `CLAUDE.md` carries them; this is the short list
that actually bites in this repo.

1. **No heredocs and no unquoted backticks in Bash.** A global hook blocks heredocs; unquoted `=>`
   or `>` in a command silently creates zero-byte junk files named after source fragments. Write a
   script into the scratchpad and run the file. Never `python -` (it hangs on stdin).
2. **Sweep junk before packaging.** `find addons scripts tests -type f -size 0` — the hook still
   produces these; the scratchpad has `sweep_tree.py`.
3. **Production deploys only through the guarded pipeline** in `.data/` (gitignored). Each release
   is derived from the previous one by a one-pass regex map (scratchpad `derive_releaseNNNN.py`),
   then run as `PYTHONIOENCODING=utf-8 python -u .data/releaseNNNN.py`. It bumps, tests, packages,
   clones production, runs the Odoo tests on the clone, uploads, deploys, and proves the live site.
   After "RELEASE x.y.z DONE": `python remote.py cleanupNNNN_remote.py` from `.data/`.
4. **`EXPECTED_TESTS` must match** `grep -c "def test_"` over both addons' tests (144 today).
5. **Tests read defaults from the field, never from the live record.** The clone runs on production
   data, where an administrator has already changed settings — two releases failed on exactly that.
   Browser proofs set the state they measure and put the administrator's value back.
6. **Commit only when asked.** Nothing in this session was committed; the working tree carries every
   change from 2.12.0 → 2.14.1.
7. **Frontend tests:** run them one file per process with the memory guard
   (`scratchpad/run_frontend_guarded.py`), never plain `node --test tests/frontend/*` — a failing
   assert on a three.js object once took Node to 20 GB.

## 4. Useful scripts (all read-only unless they say otherwise)

| Script | What it proves |
|---|---|
| `scripts/verify-toolbar.mjs` | 60 browser checks: camera, dialogs, phone menu, camera limits |
| `scripts/verify-website.mjs` | the website module's own pages in a browser |
| `scripts/measure-ground-contact.mjs` | what stands above the ground it should be standing on |
| `scripts/measure-hidden-geometry.mjs` | scene cost, limited vs free camera |
| `scripts/render-roof.mjs`, `render-fences.mjs` | close-ups into `docs/verification/` |
| `PREFAB_ORIGIN=https://prefabpartner.codesnap.nl node scripts/verify-*.mjs` | runs any of them against the live site |

## 5. What just shipped (so the new session does not redo it)

2.12.0 → 2.14.1, all live: garden fence styles that step aside when they block the aanbouw; the roof
(membrane, outlet, rounded downpipe bends, daktrim depth and corners, upstand against the house);
white lines removed at the base, the house corner and the roofs; a longer terrace with the garden set
and planters moved off the building; everything standing on the ground; the camera held on the garden
side outside and inside the room indoors (admin: Vormgeving → **Vrij rondkijken**, default off); the
example furniture hidden in the interior view (admin: **Meubels in de binnenweergave**, default off);
the street elevation not built at all while the camera is limited (−147 meshes on a terraced scene).

## 6. Open item, not started

**Kilometervergoeding transport.** The module has no transport fee at all: no postcode-based line in
the catalogue or in `services/pricing.py` (the postcode is only collected in the contact form). A
competitor shows `€45 × 63,6 KM` on its postcode step. To build it we need from the customer: the
origin (factory) postcode, the €/km rate, whether it is one-way or return — and a decision on the
distance source: an embedded NL PC4 centroid table with a ~1.25 road factor (no external service, a
few km off) or a real routing service (accurate, external dependency). Prices themselves come from
the customer's HSB Excel (demonstration mode), so the fee has to land in that pipeline, not beside it.

---

## 7. Paste this into the new chat

> Website'i komple elden geçireceğiz. Başlamadan önce `docs/handoff-website-overhaul.md` dosyasını
> oku; repoyu, `addons/cs_prefab_website` modülünü ve yayın hattının kurallarını orada anlattım.
>
> İlk turda kod yazma. Önce şunu yap: canlı siteyi (https://prefabpartner.codesnap.nl) ve website
> modülünün bugünkü sayfalarını incele, bana sayfa sayfa ne olduğunu, neyin eksik veya zayıf
> olduğunu çıkar. Sonra elden geçirme için bir plan öner: hangi sayfalar, hangi sırayla, hangi
> ölçütlerle. Hedefleri ve kısıtları birlikte netleştirelim, ondan sonra uygulamaya geçeriz.

# Sources and third-party notices

The application code, geometry, material swatches, procedural textures and CS Prefab interface were independently implemented for this project. No PrefabPartner or ReuzenPanda runtime, branding, photo layers or proprietary 3D assets are used by the running application.

- **Functional research:** [PrefabPartner quote page](https://prefabpartner.nl/offerte/) and its publicly delivered [standalone questionnaire](https://directsamenstellen.nl/28befe23-1200-4d1c-8092-e48a83477820). Observation date: 9 September 2026. Reference screenshots and response captures are retained under `research/reference/` as audit evidence. Dutch option names and question/answer identifiers are mapped to the canonical catalogue. Research artifacts are not required by the deployed addon.
- **Three.js 0.180.0:** [upstream](https://github.com/mrdoob/three.js), MIT. Included license: `addons/cs_prefab_configurator/static/vendor/THREE-LICENSE.txt`. OrbitControls import specifier is rewritten to its locally hosted module; runtime logic is unchanged.
- **DM Sans / DM Serif Display:** [Google Fonts repository](https://github.com/google/fonts), SIL Open Font License 1.1. Locally hosted font subsets and OFL notices are included in `static/vendor/`. Browsers make no Google Fonts requests.
- **DejaVu Sans:** [upstream font project](https://dejavu-fonts.github.io/). The unmodified TrueType font used by the PDF renderer is bundled at `services/fonts/DejaVuSans.ttf`; its full Bitstream Vera license and public-domain DejaVu change notice are in `services/fonts/LICENSE.txt`. PDF generation embeds the font and a Unicode character map, including support verified for Dutch and Turkish names.
- **Playwright and axe-core:** development verification tools only, installed through the locked npm development dependencies. They are not loaded by the product.

Alternative research and primary source links: [architecture-and-alternatives.md](docs/architecture-and-alternatives.md). Existing `CS_Product_Configurator` was inspected without modification; supplier catalogues, secrets and manufacturer geometries were not copied.

# Configurator visual system

The implemented /prefab surface follows the [surface brief](docs/configurator-design-brief.md) and [product context](PRODUCT.md).

- Typeface: locally hosted DM Sans, regular for explanatory copy and 500-600 for controls, labels and headings. Tabular numerals for dimensions and money.
- Main colors: ink #20302c, body #2f3935, supporting text #657069, paper #ffffff, stone #f1f1ec, borders #dce0d9, action/selection #294e40, error #a43b2d, keyboard focus #967246.
- Composition: 76 px header; flexible scene plus 426 px choices column at normal desktop widths. 62 px header and a compact scene above the choices below 800 px.
- Controls: restrained 4-5 px corners, thin borders, 44 px principal targets, 150 ms state transitions. No ornamental shadows on work panels.
- Hierarchy: page-stage title, field-group title, field label, short explanatory text. Step numbers communicate the actual four-step sequence; decorative kickers and marketing slogans are absent.
- Scope: textual included/illustrative states beside the field and in a component-level scope list. Renderer contour treatment is explanatory and must not be confused with disabled selection.
- Browser surfaces: deliberate selection, caret and focus colors; thin scrollbars in the choices pane; reduced-motion behavior.
- Brand asset: user-supplied SVG copied to the addon's local vendor assets; no external font dependency.
- Inspection: the existing scene toolbar contains material detail; selected fixture fields provide a 3D close view. Scene selection opens the same native field controls, preserving keyboard focus.
- Comparison: an expandable section inside the summary, using compact A/B rows and a readable three-column table. No separate overlay, decorative snapshot cards or persisted price promises.
- Admin preview: a restrained concept banner, visibly unavailable proposal actions and no customer-local-storage activity. Price status and disclaimer follow the response, including an approved commercial price mode when configured.
- Resilience: a text status above the scene explains a WebGL fallback or recovered 3D. Garden decoration and example-device checkboxes remain view controls; source modules and CSS use an explicit release version for cache updates.
- Form continuity: keep the clicked option and panel scroll position stable while recalculating. Multiple fixture selections do not advance the form or move the camera. Explicit 3D inspection shares the field heading; it stays on one line.
- Unavailable choices: a muted card and lock distinguish positions that do not fit. One group note explains the convention; pointer or keyboard activation explains the individual reason. Keep blocking errors near their field until corrected. Mobile notifications sit over the preview, leaving choices exposed.
- Dimension inputs: ranges, numeric entries and increment buttons share the selected opening/roof profile limits and the administrator's measurement step.
- Appearance: these brand defaults remain the baseline. The independent website appearance record can inherit actual Odoo website colors/body-heading-button fonts or provide nine custom colors and local/system fonts at 14–20 px. Use appearance tokens for form text, backgrounds, boundaries and actions; preserve readable text and button contrast. See [appearance settings](docs/appearance-2.4.md).

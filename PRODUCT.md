# Product context

Updated 13 September 2026 from the approved development roadmap and implementation request.

## Product and audience

A Dutch language prefab house-extension configurator for homeowners discussing a potential project with their partner and a supplier. The primary product is Aanbouw. The same application runs locally and as an Odoo addon, with saas~19.4 as the target runtime.

The user must be able to change dimensions, exterior, interior and installation positions; inspect the resulting shape; understand delivery scope; and save a personal proposal. A proposal is not an order or payment.

## Product truth

- Width and depth change the shared metric geometry used for 3D, plans and documents. The 2.80 m height and product details remain indicative until technical assessment.
- The server validates selections, computes prices and resolves delivery scope. Browser prices and device visibility are never authoritative.
- Preparation, device delivery, installation and connection are distinct scope components. A device may be included in the base price, separately charged, or excluded.
- Excluded example devices are clearly marked as illustrative. Hiding them is a view preference and does not change the proposal.
- Included does not mean an indicative visual model is a confirmed product model.
- Commercial amounts use a demonstration pricebook. No approved supplier prices or production guarantees are inferred from competitor material.
- Designs can be saved locally without contact details, shared through a time limited link, or submitted with contact details for a persistent PDF proposal.
- Old stored proposals preserve their recorded scope and imagery. Catalogue revisions must be reviewed before a new submission.
- Two local comparison slots contain configurations only. Opening a comparison fetches the current catalogue and reprices both designs on the server, including delivery scope; stale totals are removed when a catalogue change is detected.
- Scene selection opens the matching configuration field. Fixture and material close views, garden decoration visibility and illustrative device visibility do not alter commercial selections.
- A real WebGL context loss keeps the design editable in the accessible 2D plan. When WebGL returns, the current configuration remains intact and 3D can be reopened.
- An authenticated catalogue administrator can preview a draft release. This mode uses dedicated catalogue and price endpoints, does not read or write the customer draft or comparison, and cannot share or submit a proposal.

## Confirmed design commitments

Use the user supplied logo-prefab_partner.svg as the customer facing logo. Keep the product experience calm, precise and architectural. The dynamic building leads the composition; avoid a marketing hero, repeated slogans, decorative cards and gradients. Realistic materials and geometry must preserve product truth.

Four stages: exterior and structure; interior; site and delivery scope; summary and personal proposal. Mobile must expose the model, first dimensional input and next action within the initial viewport.

The summary hosts an inline A/B comparison with current totals, changed choices and component-level scope. It does not interrupt configuration with an extra wizard or modal.

## Decisions that remain commercial

Approved pricebook, material and fixture models, installation/connection inclusions, feasible production profiles, and additional product families require business configuration. The interface must describe the published configuration honestly.

See [development roadmap](docs/development-roadmap-2026-09-13.md) for scope and acceptance scenarios.

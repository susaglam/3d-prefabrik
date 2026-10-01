/**
 * Fields that deliberately have NO pickable object in the 3D scene, and fields that deliberately share one object
 * with another field. Both the audit probe (.data/scene_links_probe.mjs) and the gate
 * (tests/frontend/scene_links.test.mjs) read this file, so a new exception has to be written down here — it can
 * never appear by accident because a mesh lost its tag.
 *
 * Reasons are in Dutch: they are quoted verbatim in docs/verification/2.9/scene-links.json, which the customer's
 * own reviewer reads.
 */

/** key -> reason. A priced field listed here is accepted as unlinked by the gate. */
export const UNLINKED_FIELDS = {
  // --- priced, but nothing is built that the customer could point at ---
  demolition: 'Geen eigen object: de geveldoorbraak zit in de bestaande woning. Die woning staat in de scène als context en wordt niet geleverd, dus een klik erop mag geen keuze openen.',
  access: 'Geen object: dit beschrijft de bereikbaarheid van het perceel (achterom ja/nee), niet iets dat gebouwd wordt.',
  piles: 'Geen object: de heipalen zitten onder het maaiveld en worden niet getekend.',

  // --- priced, but the object belongs to the field it shares with (see SHARED_OBJECTS) ---
  drainSide: 'Deelt de regenpijp met "Regenbuis materiaal". Eén pijp kan maar één veld openen; de klik opent de kaart Voorzieningen buiten met Plaatsing direct onder Materiaal.',

  // --- not priced: maat, poort en bedieningen ---
  width: 'Geen los object: de maat ís de hele aanbouw. Elk vlak dat je aanwijst hoort al bij een ander veld, dus een klik op "de aanbouw" zou altijd een ander veld overrulen.',
  depth: 'Geen los object: zie breedte.',
  height: 'Geen los object en geen eigen prijs: de hoogte verandert dezelfde wanden die al aan Gevelbekleding hangen.',
  postcode: 'Geen object: administratief veld voor de plaatsingslocatie.',
  interior: 'Zelf geen object, maar wél het doel van elke klik binnen zolang "Aanbouw binnen" nog niet aan staat: de binnenvelden zijn dan verborgen en de klik opent de poort in plaats van niets te doen.',
};

/** field -> the field whose object it shares. The gate accepts these as covered by that object. */
export const SHARED_OBJECTS = {drainSide: 'drainMaterial'};

/**
 * Fields whose tag follows what is VISIBLE instead of being fixed to one mesh. Recorded so a reviewer understands
 * why the same wall answers to a different field in two configurations.
 */
export const VISIBLE_FINISH_RULE = {
  plaster: 'De binnenwanden, het plafond en de dagkanten dragen "plaster" zolang er geen schilderwerk is gekozen (gipsplaat of stucwerk).',
  painting: 'Zodra stucwerk én schilderwerk zijn gekozen, dragen dezelfde vlakken "painting": je klikt op de afwerking die je ziet. Beide velden staan in dezelfde kaart Wanden & vloer.',
};

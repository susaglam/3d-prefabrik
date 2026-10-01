/**
 * Which illustrative extras this website offers, and what a visitor who has never chosen sees.
 *
 * "Illustratief" means: drawn so the customer can picture the result, never delivered, never priced, never in a
 * quote line. The five families are the example appliances, the garden dressing, the neighbouring houses, the
 * furnished-room scenario and the example windows and door on the existing house's street elevation. The admin
 * policy that governs them arrives in the appearance payload under `sceneContent` (services/scene_content.py).
 *
 * Three states per extra, not a boolean, because one switch has to answer two questions:
 *   'on'     — in the picture; a visitor with a control of their own can still switch it off.
 *   'off'    — available, but a visitor who has never chosen starts without it.
 *   'hidden' — not drawn at all, AND the visitor's control disappears. A control that is present but powerless
 *              is a riddle; a control that is absent is an answer.
 *
 * The visitor always wins over 'off' and never over 'hidden'. A visitor's stored choice is never REWRITTEN by the
 * policy — a website that switches an extra off and back on again finds every visitor's own choice intact, because
 * clamping happens on the way to the scene (sceneState) and not on the way to localStorage.
 */
import {defaultEnvironment} from './environment.js';

export const SCENE_MODES=Object.freeze(['on','off','hidden']);
export const DEFAULT_SCENE_MODE='on';

/**
 * The inventory itself, in the order an administrator reads it. `control` names the visitor control this extra
 * governs, exactly as the visitor sees it, so a help text and a test can quote one source instead of two.
 */
export const SCENE_EXTRAS=Object.freeze([
 Object.freeze({id:'fixtures',label:'Voorbeeldapparaten',control:'Voorbeeldapparaten tonen'}),
 Object.freeze({id:'garden',label:'Tuinaankleding',control:'Tuinaankleding tonen'}),
 Object.freeze({id:'neighbours',label:'Buurhuizen',control:'Buren tonen'}),
 Object.freeze({id:'interior',label:'Inrichting',control:'Inrichting'}),
 Object.freeze({id:'houseOpenings',label:'Voorbeeldramen op de straatgevel',control:'Voorbeeldramen op de straatgevel tonen'}),
]);
export const SCENE_EXTRA_IDS=Object.freeze(SCENE_EXTRAS.map(extra=>extra.id));
/** Everything on. What every website has drawn since the configurator shipped, and what a missing payload means. */
export const DEFAULT_SCENE_CONTENT=Object.freeze(Object.fromEntries(SCENE_EXTRA_IDS.map(id=>[id,DEFAULT_SCENE_MODE])));

/**
 * Unknown keys are dropped and any unknown mode falls back to 'on'.
 *
 * The fallback direction is deliberate and is the opposite of the `compare` feature flag's: `compare` is a feature
 * that did not exist before, so a 404 or an outdated API must not switch it on. These five have always been in the
 * picture, so a 404 or an outdated API must not switch them OFF — an unreachable endpoint may never blank a live
 * website's scene.
 */
export function normalizeSceneContent(input){
 const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 return Object.freeze(Object.fromEntries(SCENE_EXTRA_IDS.map(id=>
  [id,SCENE_MODES.includes(source[id])?source[id]:DEFAULT_SCENE_MODE])));
}

/** Whether the visitor's own control for this extra should exist at all. */
export function extraAvailable(policy,id){return normalizeSceneContent(policy)[id]!=='hidden';}

/**
 * The state a visitor who has never chosen anything starts in, under this policy. Feeds normalizeEnvironment's
 * `base` for the two persisted flags and the scenario, and seeds the two session-only checkboxes directly.
 */
export function sceneDefaults(policy){
 const modes=normalizeSceneContent(policy),shipped=defaultEnvironment();
 const on=id=>modes[id]==='on';
 return Object.freeze({
  fixtures:on('fixtures'),
  garden:on('garden'),
  renderNeighbours:on('neighbours')&&shipped.renderNeighbours!==false,
  scenario:on('interior')?shipped.scenario:'none',
  showHouseOpenings:on('houseOpenings')&&shipped.showHouseOpenings!==false,
 });
}

/**
 * What the scene actually shows, given the visitor's own state. Only 'hidden' overrules the visitor; 'on' and 'off'
 * have already had their say through sceneDefaults, so at this point the visitor's value simply stands.
 *
 * An absent value counts as shown, so a caller that has not been seeded yet gets the scene the configurator has
 * always drawn rather than an empty one.
 */
/**
 * The named parts of a PROPOSAL IMAGE, beside the omgeving switch — what stays in the picture once the garden,
 * the woning and the buren have gone. They live in this module and not in preview.js for one reason: theme.js
 * reads them off the appearance payload before the first frame and must not pull in three.js to do it, and a
 * second copy of a default is how two parts of one program come to disagree about what the customer asked for.
 *
 * What each covers is written down at preview.js DOCUMENT_PARTS, which is where the geometry is.
 *
 * All three default ON, for different reasons, and `houseRoom` was measured both ways before it was decided.
 *
 * The slab and the terras are what the aanbouw is DELIVERED onto; a picture without them shows a building
 * floating, and the customer said the terras may stay ("bahceye uzanan beton zemin kalabilir"). `houseRoom` is
 * the 0,55 m recess behind the doorbraak (preview.js DOORBRAAK_REVEAL) — NOT the eight-metre living room, which
 * left with the rest of the woning and is what "sadece prefabrik alani gozuksun" was about: its floor alone was
 * 22,1 % of het beeld zonder dak. Off, the aanbouw has no rear wall at all, you look through the opening at the
 * studio, the join between its ground and its paper runs across the inside of the product as a hard line, and
 * 45,1 % of that same image becomes blank paper seen THROUGH the aanbouw (25,4 % with the recess). The opening in
 * the customer's own wall is part of what is being paid for; the switch is there for a bare product.
 */
export const DOCUMENT_PARTS=Object.freeze({slab:true,terrace:true,houseRoom:true});
export const DOCUMENT_PART_IDS=Object.freeze(Object.keys(DOCUMENT_PARTS));
/** Unknown keys dropped, non-booleans replaced by the shipped default. */
export function normalizeDocumentParts(input){
 const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 return Object.freeze(Object.fromEntries(Object.entries(DOCUMENT_PARTS)
  .map(([id,fallback])=>[id,typeof source[id]==='boolean'?source[id]:fallback])));
}

export function sceneState(policy,chosen){
 const modes=normalizeSceneContent(policy),state=chosen&&typeof chosen==='object'?chosen:{};
 const flag=(id,key)=>modes[id]!=='hidden'&&state[key]!==false;
 return Object.freeze({
  fixtures:flag('fixtures','fixtures'),
  garden:flag('garden','garden'),
  renderNeighbours:flag('neighbours','renderNeighbours'),
  scenario:modes.interior==='hidden'?'none':(state.scenario||'none'),
  showHouseOpenings:flag('houseOpenings','showHouseOpenings'),
 });
}

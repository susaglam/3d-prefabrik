/**
 * The one table of facade-finish colours.
 *
 * A finish shows up in three places that have to agree: the picker chip for the aanbouw (model.js MATERIALS), the
 * picker chip for the existing house (environment.js FACADE_FINISHES) and the wall the scene actually renders
 * (preview.js). Until 2.9.6 each of the three spelled out its own hex, so the house chip promised '#b88873' for
 * brick-red while the aanbouw chip — the one the "Picker chip truth" gate grades — said '#765a53', for the very
 * same scanned wall. Two chips, one brick, and no test that could ever see the disagreement.
 *
 * This module is a LEAF on purpose: it imports nothing. model.js (the quote/draft layer), environment.js (the house
 * and garden layer, and through it preview.js) and preview.js itself all import it, and none of them drags the
 * others in behind it — a hex must not cost the 3D scene the contact-validation layer.
 *
 * `color` is the CHIP colour: what the customer clicks in the form, and the only preview they get of a finish they
 * have not selected yet. For the four scanned bricks and the wood finishes it sits DELIBERATELY lighter than the
 * rendered wall (a chip at wall brightness reads as mud on a white form) — see the chipDeltaE00 budget comment in
 * scripts/verify-rendering.mjs, which bounds the spread of that offset. For the coated finishes (pvc, stucwerk)
 * there is no colour scan and the chip colour IS the material tint: preview.js multiplies the plaster scan by
 * `render-white`/`render-grey` straight from this table, so the house's two stucwerk chips cannot drift from the
 * house's two stucwerk walls at all.
 *
 * `type` is the swatch pattern the form draws behind the colour (styles.css `.material-swatch.brick` etc.); it is
 * exported as `type` for model.js MATERIALS and read as `pattern` by environment.js, which is what those two
 * call-sites already named it.
 */
export const FINISHES = Object.freeze({
 // ---- Aanbouw AND existing house: the four scanned bricks ---------------------------------------------------
 // brick-red was #926557 (a leftover from before red_brick_03 shipped): sampled against the actual scanned wall it
 // was the one swatch clearly out of family (dE76 ~14-16 vs the rendered brick, double every other finish's ~2-9).
 // #765a53 was the same front-lit clay colour brightened for chip legibility by the same amount the other three
 // bricks already carry. 2.17.0 made "Baksteen rood" the owner's lighter salmon brick (brick_red_diffuse.jpg, the lit
 // front face renders #c79b8d against the reference's #c79b8e), so the chip follows it: a shade above the lit wall.
 'brick-red':Object.freeze({color:'#c4958c',type:'brick'}),
 // 2.18.0: black and yellow sat just over the picker gate's budget (dE00 9.6 / 9.9, verify-rendering.mjs) and white
 // close to it: their chips were darker than either wall renders. Each now sits between the lit aanbouw wall and the
 // lit house wall it stands for (black #5c5c61 / #54555a, white #e8e6eb / #e4e3e8, yellow #d1bc9a / #cab794).
 'brick-black':Object.freeze({color:'#56575b',type:'brick'}),
 'brick-white':Object.freeze({color:'#e2e1e2',type:'brick'}),
 'brick-yellow':Object.freeze({color:'#c8b38f',type:'brick'}),
 // ---- Aanbouw only: cladding and coatings the existing house is never offered --------------------------------
 'wood-horizontal':Object.freeze({color:'#b78d60',type:'wood-h'}),
 'wood-vertical':Object.freeze({color:'#bb9568',type:'wood-v'}),
 // The open cladding renders #b48b5f / #b0895d lit; the chip keeps a shade darker for the gaps between the boards.
 'open-vertical':Object.freeze({color:'#a9845a',type:'open-v'}),
 'open-horizontal':Object.freeze({color:'#a9845a',type:'open-h'}),
 'pvc-black':Object.freeze({color:'#343633',type:'pvc'}),
 'pvc-green':Object.freeze({color:'#354b40',type:'pvc'}),
 'pvc-cream':Object.freeze({color:'#e6dfca',type:'pvc'}),
 'pvc-anthracite':Object.freeze({color:'#555956',type:'pvc'}),
 render:Object.freeze({color:'#e7e3da',type:'render'}),
 // ---- Existing house only: stucwerk, where the chip colour IS the wall tint ----------------------------------
 // Measured with the beige house_plaster diffuse underneath: a tint can only ever darken, so these are the values
 // that land the wall on white respectively grey rather than on the scan's own taupe (#9e8c78). preview.js reads
 // them from here; before 2.9.6 it carried its own copies of both.
 'render-white':Object.freeze({color:'#e4e1d9',type:'render'}),
 'render-grey':Object.freeze({color:'#b9bdbc',type:'render'}),
});

/** The thirteen codes the aanbouw's "Gevelbekleding" offers, in catalog.json's own order (model.js MATERIALS). */
export const PREFAB_FACADES=Object.freeze(['brick-red','brick-black','brick-white','brick-yellow','wood-horizontal','wood-vertical','open-vertical','open-horizontal','pvc-black','pvc-green','pvc-cream','pvc-anthracite','render']);

/** Never throws on an unknown code: an edited store or a stale screenshot script gets the neutral swatch grey. */
export function finishColor(code){return FINISHES[code]?.color??'#a6a59e';}

/**
 * One colour `by`/255 darker per channel. It exists for exactly one job: the neighbouring houses wear the owner's
 * stucwerk one shade darker so the party line still reads in flat light. Those two tints used to be their own
 * hexes in preview.js ('#dcd9d1' / '#b2b6b5', i.e. -8 and -7); deriving them removes the last two copies of a
 * house colour, at the cost of moving render-grey's neighbour by 1/255 (dE00 0.3 — below anything a screen shows).
 */
export function shadeHex(hex,by){return '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,parseInt(hex.slice(i,i+2),16)-by)).toString(16).padStart(2,'0')).join('');}

/** Changes are grouped by their physical effect, independent of commercial metadata. */
const SHELL=['width','depth','height','frontOpening','openingMaterial','rooflight','roofEdge','rollaag','greenRoof','overhang','roofShade','interior','plaster','painting','screed','underfloorHeating','drainMaterial','drainSide'];
const FITTINGS=['heating','outsideLight','outsideSocket','outsideTap','ceilingLights','ceilingPositions','spotlights','spotPositions','socketPositions','sockets','wallLights','switches','overhangSpots','ceilingLightControl','spotControl','wallLightControl'];
const equal=(a,b,keys)=>keys.every(key=>JSON.stringify(a[key])===JSON.stringify(b[key]));
export function sceneChange(previous,next){
    if(!previous||!equal(previous,next,SHELL))return 'structure';
    if(previous.facade!==next.facade)return 'material';
    if(!equal(previous,next,FITTINGS))return 'fixtures';
    return 'none';
}
export function canonicalFixtureKey(key){
    return ({ceilingLights:'ceilingPositions',spotlights:'spotPositions',sockets:'socketPositions'})[key]||key;
}

/** Ancestor visibility matters: hidden example groups must not keep optical effects. */
export function visibleLightEffectCount(root){
    let count=0;
    root?.traverse(object=>{
        if(!object.userData.lightEffect)return;
        for(let parent=object;parent;parent=parent.parent)if(!parent.visible)return;
        count++;
    });
    return count;
}

/**
 * Live-view render tier (decision 2.9, "realistic live view without a render step").
 *   'full'    = MSAA×4 HalfFloat composer with GTAO (desktop-class GPU, wide container).
 *   'compact' = direct render, lighter shadow map, no composer (phones, narrow containers, WebGL1, no float targets).
 * Pure: the caller measures the device and passes the facts; re-evaluate on a pixel-ratio change and when the
 * container resize crosses 600 px.
 *   forced        'full' | 'compact' wins over every measurement (document capture, tests, overrides); anything else = auto.
 *   width         container CSS width in px; below 600 the composer memory is not worth it.
 *   webgl2        renderer.capabilities.isWebGL2.
 *   halfFloat     EXT_color_buffer_float or EXT_color_buffer_half_float (needed for the HalfFloat MSAA target).
 *   coarsePointer matchMedia('(pointer: coarse)').matches.
 *   shortSide     min(screen.width, screen.height) in CSS px; a coarse pointer with a short side under 800 px is a phone,
 *                 a touch laptop or desktop touch screen (short side ≥ 800) keeps the full tier.
 *   maxSamples    renderer.capabilities.maxSamples — accepted for symmetry with getSceneInfo().rendering.maxSamples but
 *                 NEVER gates the tier: three.js clamps the MSAA sample count itself and setupComposer probes the
 *                 framebuffer (an incomplete target degrades to the direct render, never a black canvas).
 * Unknown capabilities are never assumed: a missing webgl2/halfFloat/width yields 'compact'; a missing shortSide is not a phone.
 */
export function renderTier({width=0,webgl2=false,halfFloat=false,coarsePointer=false,shortSide=Infinity,forced=null}={}){
    if(forced==='full'||forced==='compact')return forced;
    const w=width==null?0:Number(width),s=shortSide==null?Infinity:Number(shortSide);
    const wide=w>=600,phone=!!coarsePointer&&s<800;
    return !!webgl2&&!!halfFloat&&wide&&!phone?'full':'compact';
}

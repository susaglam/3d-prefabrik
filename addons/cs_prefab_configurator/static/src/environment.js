/**
 * "Woning & tuin": how the existing house and garden are drawn around the extension. Purely visual —
 * it is stored on the device (localStorage), never sent with a quote, and never changes the price.
 */
import {FINISHES} from './finishes.js';
export const ENVIRONMENT_STORAGE_KEY='cs-prefab-environment-v1';
export const HOUSE_TYPES=Object.freeze([{id:'terraced',label:'Rijwoning'},{id:'semi',label:'Twee-onder-een-kap'},{id:'detached',label:'Vrijstaand'}]);
/**
 * What the existing house can be finished in. Since 2.9.6 that is ALL FOUR scanned bricks — the customer's request
 * was that the house can be given every baksteen the aanbouw can, and a red-or-yellow-only list quietly said no to
 * half of them while preview.js was already able to build any of the four (`makeExistingHouse` routes every
 * `brick*` code straight to the aanbouw's own `facade()` material). The two stucwerk finishes stay; no wood or pvc
 * is offered, because those are cladding for a new aanbouw, not a finish a Dutch 1970s rijwoning is ever found in.
 * Order and labels follow catalog.json's "Gevelbekleding" so the same brick is called the same thing in both forms.
 *
 * `color` and `pattern` drive the swatch tile in the dialog and come from finishes.js — the SAME table the aanbouw
 * chip (model.js MATERIALS) and the scene's own house tint read, so the tile you pick is the wall you get. Before
 * 2.9.6 this list carried its own hexes and brick-red's chip here (#b88873) and in the aanbouw form (#765a53) were
 * two different bricks.
 */
export const FACADE_FINISHES=Object.freeze(['brick-red','brick-black','brick-white','brick-yellow','render-white','render-grey'].map(id=>Object.freeze({
 id,label:{'brick-red':'Baksteen rood','brick-black':'Baksteen zwart','brick-white':'Baksteen wit','brick-yellow':'Baksteen geel','render-white':'Stucwerk wit','render-grey':'Stucwerk grijs'}[id],
 color:FINISHES[id].color,pattern:FINISHES[id].type})));
/**
 * The garden boundary (2.12.0, garden_fence.js draws them). Most-used first: the modern slat fence is the default the
 * customer asked for ("çit tasarımımız çok eski bir görünüm veriyor … modern olabilir"); a green hedge ("yeşil çit de ayrı
 * bir hava katmış"); the weathered vertical schutting of every earlier release last.
 */
export const FENCE_STYLES=Object.freeze([{id:'modern',label:'Modern hout'},{id:'hedge',label:'Groene haag'},{id:'classic',label:'Klassiek hout'}].map(style=>Object.freeze(style)));
export const DEFAULT_FENCE_STYLE='modern';
export const FLOOR_FINISHES=Object.freeze([{id:'laminate',label:'Laminaat'},{id:'herringbone',label:'Visgraat'},{id:'concrete',label:'Kaal beton'}]);
export const ALIGNMENTS=Object.freeze([{id:'left',label:'Links'},{id:'center',label:'Midden'},{id:'right',label:'Rechts'}]);
export const SCENARIOS=Object.freeze([{id:'none',label:'Leeg'},{id:'living',label:'Woonkamer'},{id:'bedroom',label:'Slaapkamer'},{id:'youth',label:'Jeugdkamer'}]);
export const FACADE_WIDTH_MIN=400,FACADE_WIDTH_MAX=1500,FACADE_WIDTH_EXTRA=110;

/**
 * Copy for the neighbour toggle in the "Woning & tuin" form. Since 2.9 it is a LIVE-view toggle: off hides the
 * neighbouring houses (`neighbourGroup`) in the live 3D view without a rebuild, which is cheaper on phones.
 * The storage key and the property name `renderNeighbours` are kept so stored settings keep working.
 */
export const NEIGHBOUR_TOGGLE=Object.freeze({name:'renderNeighbours',label:'Buren tonen',help:'Zet uit om de buurhuizen te verbergen; sneller op telefoons.',defaultOn:true});

/**
 * Copy for the street-elevation toggle, added in 2.9.6 beside the neighbour toggle and for the same reason: both
 * are about how the EXISTING house is drawn around the aanbouw, which is exactly what this dialog is for. It is
 * deliberately not a third checkbox under the beeld — that strip is for what the visitor looks at every minute,
 * and the street elevation is only in frame when they orbit round the house.
 * The help was cut to two sentences in 2.10.7, when the dialog had to fit one screen without a scrollbar; it keeps
 * both facts: these are not your real windows, and the garden-side ones stay.
 */
export const HOUSE_OPENINGS_TOGGLE=Object.freeze({name:'showHouseOpenings',label:'Voorbeeldramen op de straatgevel tonen',help:'Zodat de straatkant geen blinde muur is; het zijn niet de echte ramen van je woning. De ramen aan de tuinkant blijven staan.',defaultOn:true});

/**
 * facadeWidth null = extension width + 110 cm; it only matters when wider than the extension and the house is not terraced.
 * renderNeighbours (default on) shows the neighbouring houses in the live view; off hides them without a rebuild.
 * showHouseOpenings (default on) shows the example windows and door on the street elevation.
 * fenceStyle (2.12.0) is the garden boundary: the website's default until the visitor picks one in Woning en tuin.
 */
export function defaultEnvironment(){return {houseType:'terraced',facadeWidth:null,alignment:'center',facadeFinish:'brick-red',floorFinish:'laminate',scenario:'living',renderNeighbours:true,showHouseOpenings:true,fenceStyle:DEFAULT_FENCE_STYLE};}

/**
 * Unknown keys are dropped and any invalid value falls back to its default, so a stale or edited store can never
 * break the scene.
 *
 * `base` exists for the admin policy (scene_content.js): a website whose administrator set an extra to "Standaard
 * uit" wants a visitor who has NEVER chosen to start with it off, while a visitor who did choose keeps their own
 * value. Passing the policy's defaults as the base is exactly that distinction — a key that is absent from the
 * store takes the policy's value, a key that is present keeps the visitor's. Callers that know nothing about the
 * policy keep the shipped defaults and are unaffected.
 */
export function normalizeEnvironment(input,base=defaultEnvironment()){
 const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const shipped=defaultEnvironment();
 // A caller-supplied base is policy, not gospel: a value it cannot justify falls back to the shipped default,
 // so a malformed policy can never put an unknown id into the scene.
 const pick=(key,list)=>[source[key],base?.[key],shipped[key]].find(value=>list.some(item=>item.id===value));
 const flag=key=>typeof source[key]==='boolean'?source[key]:base?.[key]!==false;
 const raw=source.facadeWidth,width=raw===null||raw===undefined||raw===''?NaN:Number(raw);
 const facadeWidth=Number.isInteger(width)&&width>=FACADE_WIDTH_MIN&&width<=FACADE_WIDTH_MAX?width:null;
 return {houseType:pick('houseType',HOUSE_TYPES),facadeWidth,alignment:pick('alignment',ALIGNMENTS),facadeFinish:pick('facadeFinish',FACADE_FINISHES),floorFinish:pick('floorFinish',FLOOR_FINISHES),scenario:pick('scenario',SCENARIOS),renderNeighbours:flag('renderNeighbours'),showHouseOpenings:flag('showHouseOpenings'),fenceStyle:pick('fenceStyle',FENCE_STYLES)};
}

/** The part of the environment that changes the built scene (house and garden); floor finish, scenario and the neighbour toggle are applied separately. */
export function sceneEnvironmentKey(env){const e=normalizeEnvironment(env);return [e.houseType,e.facadeWidth,e.alignment,e.facadeFinish,e.fenceStyle].join('|');}

/** Effective facade width in centimetres for an extension `widthCm` wide: never narrower than the extension itself. */
export function facadeWidthCm(env,widthCm){
 const e=normalizeEnvironment(env),width=Math.round(Number(widthCm)||0);
 if(e.houseType==='terraced')return width;
 return Math.max(width,e.facadeWidth??width+FACADE_WIDTH_EXTRA);
}

/**
 * Plot layout in metres for the preview: where the house facade, the neighbours and the garden boundaries sit
 * relative to the extension bounds `b` (x runs left→right seen from the garden, z from house to garden).
 * Terraced: neighbours continue the facade on both sides and the party lines are the garden boundaries.
 * Semi: a neighbour on the left only; the right boundary runs 1,2 m beside the extension (or the house, if wider).
 * Detached: no neighbours, the house is `facadeWidth` wide and aligned to the extension per `alignment`.
 */
export function houseLayout(env,model){
 const e=normalizeEnvironment(env),b=model.bounds,width=b.right-b.left,reach=5.5,houseDepth=5.2,margin=1.2;
 const own=facadeWidthCm(e,Math.round(width*100))/100,extra=Math.max(0,own-width);
 const left=e.houseType==='terraced'?b.left:e.alignment==='left'?b.left:e.alignment==='right'?b.right-own:b.left-extra/2;
 const right=left+own;
 const neighbours=e.houseType==='terraced'?[-1,1]:e.houseType==='semi'?[-1]:[];
 const boundaryLeft=neighbours.includes(-1)?left-.05:Math.min(b.left-margin,left-.05);
 const boundaryRight=neighbours.includes(1)?right+.05:Math.max(b.right+margin,right+.05);
 return {type:e.houseType,finish:e.facadeFinish,width:own,extra,left,right,neighbours,reach,houseDepth,boundaryLeft,boundaryRight,
  roofLeft:neighbours.includes(-1)?left-reach:left,roofRight:neighbours.includes(1)?right+reach:right};
}

function storeOf(store){try{return store===undefined?globalThis.localStorage:store;}catch{return null;}}
/**
 * Never throws: without storage (private mode, node, blocked cookies) the defaults are returned.
 * `base` carries the admin policy's defaults (see normalizeEnvironment); it only fills keys the store does not have.
 */
export function loadEnvironment(store,base){
 try{const s=storeOf(store),raw=s?.getItem(ENVIRONMENT_STORAGE_KEY);return normalizeEnvironment(raw?JSON.parse(raw):null,base);}
 catch{return normalizeEnvironment(null,base);}
}
/** Returns whether the environment was written; a missing or full store is not an error for the visitor. */
export function saveEnvironment(env,store){
 const normalized=normalizeEnvironment(env);
 try{const s=storeOf(store);if(!s)return false;s.setItem(ENVIRONMENT_STORAGE_KEY,JSON.stringify(normalized));return true;}
 catch{return false;}
}

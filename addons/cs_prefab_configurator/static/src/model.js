import {FINISHES, PREFAB_FACADES} from './finishes.js';
export const STORAGE_KEY = 'cs-prefab-design-v1';
export const COMPARISON_STORAGE_KEY = 'cs-prefab-comparison-v1';
export const money = cents => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(cents / 100);
export const preciseMoney = cents => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR'}).format(cents / 100);
export const metric = cm => new Intl.NumberFormat('nl-NL', {minimumFractionDigits:2,maximumFractionDigits:2}).format(cm / 100);
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export const STEPS = [
 {label:'Buitenzijde',short:'Buiten',title:'Stel je aanbouw samen',description:'Begin met de buitenmaten. Kies daarna de materialen en de verbinding met je tuin.',icon:'home',fields:['width','depth','facade','rollaag','openingMaterial','frontOpening','rooflight','roofEdge','overhang','overhangSpots','overhangSpotControl','outsideLight','outsideLightControl','outsideSocket','outsideTap','drainMaterial','drainSide']},
 {label:'Binnenzijde',short:'Binnen',title:'Richt de binnenzijde in',description:'Kies de afwerking en de plaatsen voor verwarming en elektra. De leveringsomvang staat bij iedere voorziening.',icon:'floor',fields:['interior','plaster','painting','screed','underfloorHeating','heating','ceilingPositions','ceilingLights','ceilingLightControl','spotPositions','spotlights','spotControl','socketPositions','sockets','switches']},
 {label:'Situatie & levering',short:'Situatie',title:'De aansluiting op je woning',description:'Geef de situatie ter plaatse aan en controleer wat er bij je keuzes wordt geleverd.',icon:'shield',fields:['demolition','access','piles']},
 {label:'Jouw voorstel',short:'Voorstel',title:'Controleer je ontwerp',description:'Je keuzes, de leveringsomvang en de voorbeeldberekening op één plek.',icon:'list',fields:[]}];
export const INTERIOR_FIELDS = ['plaster','painting','screed','underfloorHeating','heating','ceilingPositions','ceilingLights','ceilingLightControl','spotPositions','spotlights','spotControl','socketPositions','sockets','switches'];
/**
 * The aanbouw's thirteen "Gevelbekleding" chips: {color, type} per catalog facade code, in catalog.json's order.
 * The colours themselves live in finishes.js — one table for the aanbouw chip, the house chip and the wall the
 * scene renders — so this is a VIEW on that table, never a second copy of it. Shape and keys are unchanged; the
 * "Picker chip truth" gate still walks exactly this object.
 */
export const MATERIALS = Object.freeze(Object.fromEntries(PREFAB_FACADES.map(code => [code, FINISHES[code]])));
export function fieldsOf(catalog) { return Object.fromEntries(catalog.groups.flatMap(g => g.fields).map(f => [f.key, f])); }
/**
 * Values retired by a newer application version and what a saved design that still carries one becomes. The mirror
 * of services/catalog.py RETIRED_VALUES: the server maps these too, but the browser normalises the draft first, and
 * without this table it dropped a saved double socket to "none" before the server ever saw it (2.16.2 live audit).
 */
export const RETIRED_VALUES = Object.freeze({outsideSocket: Object.freeze({'double-left': 'left', 'double-right': 'right', 'double-both': 'both'})});
export function normalizedDraft(input, catalog) {
  const result = structuredClone(catalog.defaults);
 if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
 const fields = fieldsOf(catalog);
 for (const [key, saved] of Object.entries(input)) {
   if (!(key in result) || key === 'postcode') continue;
   const value = Object.hasOwn(RETIRED_VALUES[key] || {}, saved) ? RETIRED_VALUES[key][saved] : saved;
   const dimension = catalog.dimensions[key];
   if (dimension) {if (typeof value === 'number' && Number.isInteger(value) && value>=dimension.min && value<=dimension.max) result[key]=value;continue;}
   const field=fields[key]; if(!field) continue;
    if(field.type==='multiselect') {
      if(Array.isArray(value)&&value.every(item=>field.options.some(option=>option.id===item))&&new Set(value).size===value.length&&value.length<=(field.maxSelections??field.options.length)) result[key]=field.options.filter(option=>value.includes(option.id)).map(option=>option.id);
    }
    else if (field.options?.length) {if(field.options.some(option=>option.id===value)) result[key]=value;}
   else if (field.type==='boolean' && typeof value==='boolean') result[key]=value;
   else if (['number','integer'].includes(field.type) && Number.isInteger(value) && value >= field.min && value <= field.max) result[key]=value;
 }
  for(const [positions,count] of [['ceilingPositions','ceilingLights'],['spotPositions','spotlights']]) {
    if(fields[positions]&&!Object.hasOwn(input,positions)&&Number.isInteger(result[count]))result[positions]=fields[positions].options.slice(0,result[count]).map(option=>option.id);
  }
  if(fields.socketPositions&&!Object.hasOwn(input,'socketPositions'))result.socketPositions=({left:['L2'],right:['R2'],both:['L2','R2']})[result.sockets]||[];
  return normalizeInterior(result,catalog.defaults);
}
export function normalizeInterior(config, defaults) {
 const result={...config};
 if(!result.interior) for(const key of INTERIOR_FIELDS) if(Object.hasOwn(defaults,key))result[key]=Array.isArray(defaults[key])?[...defaults[key]]:defaults[key];
 if(!result.plaster&&Object.hasOwn(defaults,'painting'))result.painting=false;
 if(result.overhang==='none'){result.overhangSpots=0;if(Object.hasOwn(defaults,'overhangSpotControl'))result.overhangSpotControl=defaults.overhangSpotControl;}
 if(Array.isArray(result.ceilingPositions))result.ceilingLights=result.ceilingPositions.length;
 if(Array.isArray(result.spotPositions))result.spotlights=result.spotPositions.length;
 if(Array.isArray(result.socketPositions)){const left=result.socketPositions.some(p=>p.startsWith('L')),right=result.socketPositions.some(p=>p.startsWith('R'));result.sockets=left&&right?'both':left?'left':right?'right':'none';}
 for(const [key,active] of [['outsideLightControl',result.outsideLight!=='none'],['ceilingLightControl',result.ceilingLights>0],['spotControl',result.spotlights>0]])if(!active&&Object.hasOwn(defaults,key))result[key]=defaults[key];
 return result;
}
export function labelFor(fields,key,value) {
 if(Array.isArray(value))return value.length?value.map(id=>fields[key]?.options?.find(option=>option.id===id)?.label||id).join(', '):'Geen';
 const option=fields[key]?.options?.find(o=>o.id===value);
 return option?.label ?? (typeof value==='boolean' ? (value?'Ja':'Nee') : String(value));
}

/** Presentation visibility never joins the commercial configuration or saved quote. */
export function fieldIsVisible(key,config,fields) {
 if(INTERIOR_FIELDS.includes(key)&&!config.interior)return false;
 if(key==='painting')return !!config.plaster;
 if(['overhangSpots','overhangSpotControl'].includes(key)&&config.overhang==='none')return false;
 if(key==='overhangSpotControl')return config.overhangSpots>0;
 if(key==='outsideLightControl')return config.outsideLight!=='none';
 if(key==='ceilingLightControl')return config.ceilingLights>0;
 if(key==='spotControl')return config.spotlights>0;
 if(key==='ceilingLights'&&fields.ceilingPositions)return false;
 if(key==='spotlights'&&fields.spotPositions)return false;
 if(key==='sockets'&&fields.socketPositions)return false;
 return true;
}
export function validDimensions(config,catalog) {
 return Object.entries(catalog.dimensions).every(([key,d])=>Number.isInteger(config[key])&&config[key]>=d.min&&config[key]<=d.max);
}

/** Comparison persistence contains configurations only; prices and scope are always refreshed. */
export function comparisonDrafts(input,catalog) {
 const slots={A:null,B:null};
 if(!input||typeof input!=='object'||Array.isArray(input))return slots;
 for(const slot of ['A','B']){
  const value=input[slot]?.config;
  if(value&&typeof value==='object'&&!Array.isArray(value))slots[slot]=normalizedDraft(value,catalog);
 }
 return slots;
}
export function comparisonRows(a,b,catalog) {
 const left=normalizedDraft(a,catalog),right=normalizedDraft(b,catalog),fields=fieldsOf(catalog);
 const keys=[...new Set(STEPS.slice(0,3).flatMap(item=>item.fields))];
 return keys.filter(key=>JSON.stringify(left[key])!==JSON.stringify(right[key])&&(fieldIsVisible(key,left,fields)||fieldIsVisible(key,right,fields))).map(key=>({
  key,label:catalog.dimensions[key]?.label||fields[key]?.label||key,
  a:catalog.dimensions[key]?`${left[key]} cm`:labelFor(fields,key,left[key]),
  b:catalog.dimensions[key]?`${right[key]} cm`:labelFor(fields,key,right[key]),
 }));
}
export function validateContact(contact) {
 contact=Object.fromEntries(Object.entries(contact && typeof contact==='object' ? contact : {}).map(([k,v])=>[k,typeof v==='string'?v.trim():'']));
 const errors={};
 for(const [key,label] of Object.entries({firstName:'voornaam',lastName:'achternaam',phone:'telefoonnummer',address:'straat',houseNumber:'huisnummer',city:'woonplaats'})) if(!contact[key]?.trim()) errors[key]=`Vul je ${label} in.`;
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.email||'')) errors.email='Vul een geldig e-mailadres in.';
 if(!/^[1-9][0-9]{3}\s?[A-Za-z]{2}$/.test(contact.postcode||'')) errors.postcode='Gebruik een Nederlandse postcode, bijvoorbeeld 1234 AB.';
 if(contact.phone && (!/^[+()\d\s.-]{8,30}$/.test(contact.phone)||!/^\d{8,15}$/.test(contact.phone.replace(/\D/g,''))))errors.phone='Vul een geldig telefoonnummer in.';
 if(contact.houseNumber && !/^\d{1,6}[a-zA-Z]?(?:[ -][a-zA-Z0-9]{1,8})?$/.test(contact.houseNumber))errors.houseNumber='Vul een geldig huisnummer in, bijvoorbeeld 12 of 12 A.';
 return errors;
}

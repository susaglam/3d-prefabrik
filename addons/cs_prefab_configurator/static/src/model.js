export const STORAGE_KEY = 'cs-prefab-design-v1';
export const money = cents => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(cents / 100);
export const preciseMoney = cents => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR'}).format(cents / 100);
export const metric = cm => new Intl.NumberFormat('nl-NL', {minimumFractionDigits:2,maximumFractionDigits:2}).format(cm / 100);
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export const STEPS = [
 {label:'Afmetingen',short:'Maat',title:'Maak ruimte voor je plannen.',description:'Een fijne woonkeuken, een grotere woonkamer of een plek voor jezelf. Hoeveel ruimte wil jij erbij?',icon:'ruler',fields:['width','depth']},
 {label:'Gevel',short:'Gevel',title:'Een buitenkant die bij je past.',description:'Sluit aan op je woning of kies een nieuw karakter. Jij bepaalt de uitstraling.',icon:'home',fields:['facade','rollaag']},
 {label:'Kozijn & dak',short:'Licht',title:'Laat het buitenleven binnen.',description:'Kies je verbinding met de tuin en laat het daglicht zijn werk doen.',icon:'sun',fields:['frontOpening','rooflight','roofEdge']},
 {label:'Buiten',short:'Buiten',title:'Ook buiten goed geregeld.',description:'Denk alvast aan de praktische details. Links en rechts zijn gezien vanuit de tuin.',icon:'leaf',fields:['outsideLight','outsideSocket','outsideTap','drainMaterial','drainSide']},
 {label:'Binnen',short:'Binnen',title:'Van extra ruimte naar jouw plek.',description:'Bepaal hoe ver we de binnenzijde voor je voorbereiden. De details bespreken we bij de opname.',icon:'light',fields:['interior','plaster','screed','underfloorHeating','heating','ceilingLights','switches','spotlights','sockets']},
 {label:'Situatie',short:'Situatie',title:'Een goede basis begint hier.',description:'Vertel ons iets over de bestaande woning en de bereikbaarheid van je tuin.',icon:'shield',fields:['demolition','access','piles']},
 {label:'Jouw voorstel',short:'Voorstel',title:'Dit wordt jouw extra ruimte.',description:'Controleer je ontwerp en bewaar een persoonlijk voorstel met alle keuzes op een rij.',icon:'list',fields:[]},
];
export const INTERIOR_FIELDS = ['plaster','screed','underfloorHeating','heating','ceilingLights','switches','spotlights','sockets'];
export const MATERIALS = {
 'brick-red':{color:'#926557',type:'brick'},'brick-black':{color:'#454241',type:'brick'},'brick-white':{color:'#dedbd1',type:'brick'},'brick-yellow':{color:'#b79b6c',type:'brick'},
 'wood-horizontal':{color:'#b78d60',type:'wood-h'},'wood-vertical':{color:'#bb9568',type:'wood-v'},'open-vertical':{color:'#98734c',type:'open-v'},'open-horizontal':{color:'#98734c',type:'open-h'},
 'pvc-black':{color:'#343633',type:'pvc'},'pvc-green':{color:'#354b40',type:'pvc'},'pvc-cream':{color:'#e6dfca',type:'pvc'},'pvc-anthracite':{color:'#555956',type:'pvc'},render:{color:'#e7e3da',type:'render'}
};
export function fieldsOf(catalog) { return Object.fromEntries(catalog.groups.flatMap(g => g.fields).map(f => [f.key, f])); }
export function normalizedDraft(input, catalog) {
 const result = {...catalog.defaults};
 if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
 const fields = fieldsOf(catalog);
 for (const [key, value] of Object.entries(input)) {
   if (!(key in result) || key === 'postcode') continue;
   const dimension = catalog.dimensions[key];
   if (dimension) {if (typeof value === 'number' && Number.isInteger(value) && value>=dimension.min && value<=dimension.max) result[key]=value;continue;}
   const field=fields[key]; if(!field) continue;
   if (field.options?.length) {if(field.options.some(option=>option.id===value)) result[key]=value;}
   else if (field.type==='boolean' && typeof value==='boolean') result[key]=value;
   else if (['number','integer'].includes(field.type) && Number.isInteger(value) && value >= field.min && value <= field.max) result[key]=value;
 }
 return normalizeInterior(result,catalog.defaults);
}
export function normalizeInterior(config, defaults) {
 const result={...config};
 if(!result.interior) for(const key of INTERIOR_FIELDS) result[key]=defaults[key];
 return result;
}
export function labelFor(fields,key,value) {
 const option=fields[key]?.options?.find(o=>o.id===value);
 return option?.label ?? (typeof value==='boolean' ? (value?'Ja':'Nee') : String(value));
}
export function validDimensions(config,catalog) {
 return Object.entries(catalog.dimensions).every(([key,d])=>Number.isInteger(config[key])&&config[key]>=d.min&&config[key]<=d.max);
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

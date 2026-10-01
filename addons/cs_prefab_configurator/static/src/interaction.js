/** Shared dimension constraints for sliders, typed values and increment buttons. */
export const openingKind = value => ['sliding-4','sliding-2','french','folding'].find(kind=>String(value).startsWith(kind))||'none';

function profiles(config,catalog){
 const kind=openingKind(config.frontOpening),rules=catalog.geometryRules||{};
 return [
  {field:'frontOpening',id:config.frontOpening,profile:{...rules.openingProfiles?.[kind],minWidthCm:Math.max(catalog.openingRules?.minimumWidthCm?.[kind]||0,rules.openingProfiles?.[kind]?.minWidthCm||0)}},
  ...(config.rooflight&&config.rooflight!=='none'?[{field:'rooflight',id:config.rooflight,profile:rules.rooflightProfiles?.[config.rooflight]||{}}]:[]),
 ];
}

export function dimensionLimits(config,catalog,key){
 const original=catalog.dimensions[key],axis=key==='width'?'Width':key==='depth'?'Depth':null;
 let min=original.min,max=original.max;const sources=[];
 if(axis)for(const item of profiles(config,catalog)){
  const low=item.profile['min'+axis+'Cm']??min,high=item.profile['max'+axis+'Cm']??max;
  if(low>original.min||high<original.max)sources.push(item.field);
  min=Math.max(min,low);max=Math.min(max,high);
 }
 // Range controls use the same step grid as the numeric field, including odd admin bounds.
 min=original.min+Math.ceil((min-original.min)/original.step)*original.step;
 max=original.min+Math.floor((max-original.min)/original.step)*original.step;
 const increment=Math.max(1,Math.round(10/original.step))*original.step;
 return {...original,min,max,increment,sources,available:min<=max};
}

export function dimensionValue(value,limits){
 if(value===''||!Number.isFinite(Number(value))||!limits.available)return null;
 const snapped=limits.min+Math.round((Number(value)-limits.min)/limits.step)*limits.step;
 return Math.max(limits.min,Math.min(limits.max,snapped));
}

export function profileConstraint(key,id,config,catalog){
 if(!['frontOpening','rooflight'].includes(key))return '';
 const proposed={...config,[key]:id};
 const item=profiles(proposed,catalog).find(item=>item.field===key);
 if(!item)return '';
 const label=key==='frontOpening'?'Deze pui':'Dit daklicht',p=item.profile;
 for(const [dimension,axis,name] of [['width','Width','breedte'],['depth','Depth','diepte']]){
  const min=p['min'+axis+'Cm'],max=p['max'+axis+'Cm'];
  if(min&&config[dimension]<min)return `${label} vraagt minimaal ${min} cm ${name}. Vergroot de aanbouw of kies een kleinere uitvoering.`;
  if(max&&config[dimension]>max)return `${label} past tot ${max} cm ${name}. Verklein de aanbouw of kies een andere uitvoering.`;
 }
 return '';
}

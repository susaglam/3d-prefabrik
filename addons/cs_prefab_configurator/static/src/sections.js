/** Section cards (plan 2.9 row 10): pure helpers for status, header summary and the one-open-per-step rule. No DOM here so they are unit-testable. */

/**
 * The section cards per step, in the order the panel renders them, and the fields each step renders BEFORE its
 * cards. Data rather than markup, and it lives here rather than in app.js so the cursor's decisions can be tested
 * against the real steps instead of against a copy that drifts.
 */
export const STEP_SECTIONS=[
 [
  {id:'facade',title:'Gevel & voorpui',keys:['facade','rollaag','openingMaterial','frontOpening']},
  {id:'roof',title:'Dak & daglicht',keys:['rooflight','roofShade','greenRoof','roofEdge','overhang','overhangSpots','overhangSpotControl']},
  {id:'outside',title:'Voorzieningen buiten',keys:['outsideLight','outsideLightControl','outsideSocket','outsideTap','drainMaterial','drainSide']},
 ],
 [
  {id:'finish',title:'Wanden & vloer',keys:['plaster','painting','screed']},
  {id:'heating',title:'Verwarming',keys:['underfloorHeating','heating']},
  {id:'ceiling',title:'Plafondverlichting',keys:['ceilingPositions','ceilingLights','ceilingLightControl','spotPositions','spotlights','spotControl']},
  {id:'wall',title:'Wandverlichting & elektra',keys:['wallLights','wallLightControl','socketPositions','sockets','switches']},
 ],
 [{id:'site',title:'Situatie ter plaatse',keys:['demolition','access','piles']}],
 [],
];
export const STEP_LEAD_KEYS=[['width','depth'],['interior'],[],[]];

const EMPTY=[undefined,null,false,'','none',0];
/** A section is done when every visible field carries a real choice, or when the person has already looked at it (a deliberate "Nee" is a choice too). */
export function sectionDone(values,visited=false){
 if(visited)return true;
 return values.length>0&&values.every(value=>Array.isArray(value)?value.length>0:!EMPTY.includes(value));
}
/** Header line: all selected labels joined, cut at a label boundary so the card header stays two lines at most. */
export function sectionSummary(labels,max=72){
 const items=labels.map(label=>String(label??'').trim()).filter(Boolean),separator=' · ';
 const full=items.join(separator);
 if(full.length<=max)return full;
 const kept=[];let length=0;
 for(const item of items){const extra=(kept.length?separator.length:0)+item.length;if(kept.length&&length+extra>max-2)break;kept.push(item);length+=extra;}
 let text=kept.join(separator);
 if(text.length>max-2)text=text.slice(0,max-2).trimEnd();
 return text+' …';
}
/** The open section of a step is the most recently added id (Set keeps insertion order); null when none of the step's ids is present. */
export function openGroupId(set,ids){
 let open=null;
 for(const id of set)if(ids.includes(id))open=id;
 return open;
}
/** The section after `current` in the step, or null when `current` is the last one (the caller then moves to the next step). */
export function nextGroupId(ids,current){
 const index=ids.indexOf(current);
 return index>=0&&index<ids.length-1?ids[index+1]:null;
}

/**
 * THE CURSOR (plan 2.9.7). The footer's primary button walks the visitor to their next CHOICE instead of to the
 * next step, and only becomes "verder naar <stap>" once no choice of this step is left unseen. These four helpers
 * decide WHICH choice and WHAT the button says; the scroll and the focus stay in app.js, so every row of the
 * state table is unit-testable without a DOM.
 *
 * "Seen" is the caller's Set, keyed by field key: a field is added when it has rested in the panel's reading area
 * or when the visitor changed a control inside it. It is never un-set, which is what makes going back to change
 * an earlier answer unable to re-arm the button — the loop trap is closed structurally rather than by a guard.
 */

/** Every choice of a step in document order: the step's own lead fields (maten, "Aanbouw binnen") first, then the fields of its sections. */
export function stepChoiceKeys(sections,lead,isVisible=()=>true){
 return [...(lead||[]),...(sections||[]).flatMap(section=>section.keys||[])].filter(key=>isVisible(key));
}

/** The cursor itself: the first choice the visitor has not had in front of them yet, or null when the step is exhausted. */
export function nextChoice(keys,seen){
 return (keys||[]).find(key=>!seen.has(key))??null;
}

/** How many choices are still unseen — the number the footer note carries ("Nog 4 keuzes in deze stap"). */
export function remainingChoices(keys,seen){
 return (keys||[]).reduce((total,key)=>total+(seen.has(key)?0:1),0);
}

/**
 * Where the button goes. A choice inside the section that is already open is reached as a FIELD and the label
 * names the field; a choice in a closed section is reached as the SECTION, because the visitor is about to meet a
 * whole new card and its header is the landmark they will actually read. Lead fields belong to no section and are
 * always fields.
 */
export function choiceDestination(key,sections,openId,fieldLabel=value=>value){
 const section=(sections||[]).find(item=>(item.keys||[]).includes(key));
 if(section&&section.id!==openId)return {kind:'section',id:section.id,label:section.title};
 return {kind:'field',id:key,label:fieldLabel(key)};
}

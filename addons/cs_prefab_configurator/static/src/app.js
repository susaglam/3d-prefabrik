import {icon,rooflightIcon,openingIcon,houseTypeIcon,alignmentIcon} from './icons.js';
import {fenceIcon} from './house_type_icons.js';
import {scenarioIcon,qualityIcon} from './view_icons.js';
import {viewpointIcon,toolIcon} from './scene_icons.js';
import {dimensionLimits,dimensionValue,profileConstraint} from './interaction.js';
import {applyAppearance,getFeatures,getSceneContent} from './theme.js';
import {STEPS,STORAGE_KEY,COMPARISON_STORAGE_KEY,INTERIOR_FIELDS,MATERIALS,money,preciseMoney,metric,escapeHTML as esc,fieldsOf,normalizedDraft,normalizeInterior,labelFor,validDimensions,validateContact,fieldIsVisible,comparisonDrafts,comparisonRows} from './model.js';
import {STEP_SECTIONS,STEP_LEAD_KEYS,sectionDone,sectionSummary,openGroupId,stepChoiceKeys,nextChoice,remainingChoices,choiceDestination} from './sections.js';
import {FENCE_STYLES,HOUSE_TYPES,FACADE_FINISHES,FLOOR_FINISHES,ALIGNMENTS,SCENARIOS,NEIGHBOUR_TOGGLE,HOUSE_OPENINGS_TOGGLE,FACADE_WIDTH_MIN,FACADE_WIDTH_MAX,ENVIRONMENT_STORAGE_KEY,defaultEnvironment,normalizeEnvironment,loadEnvironment,saveEnvironment,facadeWidthCm} from './environment.js';
import {extraAvailable,sceneDefaults,sceneState} from './scene_content.js';
import {isEmbedded,startEmbedBridge} from './embed.js';

const API='/prefab/api';
const previewCatalogId=new URLSearchParams(location.search).get('catalog_preview'),adminPreview=previewCatalogId!==null;
// A path rather than a query parameter: the three history.replaceState calls below strip ?share=
// from the URL, and the first one that forgot to carry an ?embed=1 through would silently
// un-embed the page mid-session. A path survives every one of them.
const embedded=isEmbedded(location.pathname);
const catalogAPI=adminPreview?'/prefab/admin-preview/'+encodeURIComponent(previewCatalogId):API;
let catalog, fields, config, price=null, step=0, preview, currentMode='3d', priceTimer, priceSequence=0, pricePending=true, priceError='', savedAt=null, errors={}, contact={}, result=null, submitting=false, requestKey=null, dimensionsVisible=false, roofVisible=true, examplesVisible=true, currentView='perspective', catalogChanged=false;
const expandedGroups=new Set(['dimensions','facade']);
let decorVisible=true,webglProblem=false,comparison={A:null,B:null},comparisonOpen=false,comparisonBusy=false,comparisonError='',comparisonPrices=null,comparisonSequence=0,catalogReadSequence=0;
let designGeneration=0;
let environment=defaultEnvironment(),environmentWidth=null;
/**
 * The admin policy for the illustrative extras, read once from the appearance payload (theme.js). Until
 * applyAppearance() has run it is "everything on", which is the scene the configurator has always drawn.
 *
 * `environment` stays the VISITOR's own state and is never clamped in place: an extra the admin switched to
 * 'Uitgeschakeld' is taken out on the way to the scene (sceneState), so the visitor's stored choice survives
 * untouched and returns the day the admin switches it back on.
 */
let scenePolicy=getSceneContent();
const extraOn=id=>extraAvailable(scenePolicy,id);
/**
 * What a visitor who never chose starts with: the scene policy's defaults plus the website's default garden boundary
 * (Vormgeving → Soort afscheiding, 2.12.0). A visitor's own Woning en tuin choice, once made, is kept over it.
 */
function environmentBase(){return {...sceneDefaults(scenePolicy),fenceStyle:getFeatures().gardenFenceStyle};}
/**
 * The one place the four synchronous extras reach the 3D scene; every control calls this instead of the preview
 * directly. Only what actually changed is pushed: setExamplesVisible walks the whole scene graph and redraws the
 * 2D plan, which is not something to do on every keystroke in the gevelbreedte field. setEnvironment is always
 * called because it also carries the house type and width, and it guards itself.
 */
let lastScene=null;
function syncSceneContent({force=false}={}){
 const state=sceneState(scenePolicy,{...environment,fixtures:examplesVisible,garden:decorVisible});
 const previous=force?null:lastScene;
 if(previous?.fixtures!==state.fixtures)preview?.setExamplesVisible?.(state.fixtures);
 if(previous?.garden!==state.garden)preview?.setDecorVisible?.(state.garden);
 preview?.setEnvironment?.({...environment,renderNeighbours:state.renderNeighbours});
 if(previous?.showHouseOpenings!==state.showHouseOpenings)preview?.setIllustrativeVisible?.('houseOpenings',state.showHouseOpenings);
 lastScene=state;
 return state;
}
/** The scenario is loaded asynchronously, so it is pushed separately and its failure is the visitor's to see. */
function syncScenario({announce=false}={}){
 const scenario=sceneState(scenePolicy,environment).scenario;
 return Promise.resolve(preview?.setScenario?.(scenario)).catch(error=>{
  if(announce)toast('De inrichting kon niet worden geladen.');else console.warn('Scenario not loaded',error);
 });
}
// The facade close-up: while it is open a small card over the scene names the material you are looking at.
let materialCloseUp=false;
const activeRequests=new Set();
const $=selector=>document.querySelector(selector);
const app=$('#app');
const modal=$('#modal');
let lastFocus=null;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
$('#year').textContent=new Date().getFullYear();
// Both before the catalogue request. The class first, because shell() does not run until the
// catalogue has loaded and the visitor would otherwise watch the site's logo appear twice for a
// second. The bridge second, so the host page can size the frame while the configurator loads.
// Null when the page is not framed, which is what makes calling it unconditional safe.
if(embedded)document.body.classList.add('embedded');
const embedBridge=embedded?startEmbedBridge({win:window,doc:document}):null;
async function api(path, body, {timeoutMs=15000}={}) {
 if(adminPreview&&!['/catalog','/price'].includes(path))throw new Error('Conceptvoorbeelden kunnen niet worden gedeeld of als voorstel opgeslagen.');
 const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),timeoutMs);
 activeRequests.add(controller);
 try {
   const response=await fetch(`${adminPreview?catalogAPI:API}${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:controller.signal});
   if(!response.headers.get('content-type')?.includes('json')){const error=new Error(adminPreview?'Log in als catalogusbeheerder om dit concept te bekijken.':'De server kon je aanvraag niet beantwoorden. Probeer het opnieuw.');error.code=adminPreview?'authentication_required':'invalid_response';throw error;}
   const data=await response.json();
   if(!response.ok){const error=new Error(data.error?.message||'Dat lukte niet. Probeer het opnieuw.');error.fields=data.error?.fields||{};error.code=data.error?.code;throw error;}
   return data;
 } catch(error){if(error.name==='AbortError')throw new Error('De verbinding duurt te lang. Probeer het opnieuw.');throw error;}finally{clearTimeout(timeout);activeRequests.delete(controller);}
}
function toast(message,{kind='info'}={}) {
 const el=$('#toast'),scene=$('.preview-scene');
 // An open modal dialog sits in the browser's top layer, above everything in <body>: a toast raised from inside it
 // (Weergave → Kwaliteit says what it did) must join the dialog or it is drawn under the backdrop, unseen.
 const host=modal.open?modal:document.body;if(el.parentElement!==host)host.append(el);
 // On phones, explanations sit over the preview and leave unfinished form choices visible.
 if(scene)el.style.setProperty('--toast-top',`${Math.max(70,scene.getBoundingClientRect().top+8)}px`);
 el.textContent=message;el.dataset.kind=kind;el.classList.add('visible');
 clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),6500);
}
function openModal(title,body,cls='') {
 lastFocus=document.activeElement;
 $('#modal-content').innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Venster sluiten">${icon('close')}</button></div><div class="modal-body ${cls}">${body}</div>`;
 if(!modal.open)modal.showModal();
}
function closeModal(){modal.close();lastFocus?.focus({preventScroll:true});}
modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
function fieldLabel(key){return fields[key]?.label || key;}
function selectedLabel(key){return labelFor(fields,key,config[key]);}
function demoPricing(){return (price?.priceMode||catalog?.priceMode||'demonstration')!=='commercial';}
function pricingDisclaimer(){return price?.disclaimer||(demoPricing()?'Deze berekening gebruikt een voorbeeldprijsboek. De definitieve prijs en uitvoering worden bevestigd na controle van je woning.':'De uitvoering en definitieve prijs worden bevestigd na controle van je woning.');}


function shell() {
 document.body.classList.toggle('admin-preview',adminPreview);
 // The host page has its own header and its own logo; repeating both 200 px lower reads as a
 // mistake. Only the action row survives, and "Hoe werkt het?" moves to the tool button that the
 // phone layout already uses for it, so nothing becomes unreachable.
 document.body.classList.toggle('embedded',embedded);
 document.querySelectorAll('.header-actions button').forEach(button=>button.hidden=adminPreview&&button.dataset.action!=='reset');
 $('.reset-header').disabled=false;$('.reset-header').hidden=true; // shown by updateResetButton once something changed
 if(adminPreview){$('.brand').href='/odoo';$('.brand-title').textContent='Catalogusvoorbeeld';}
 const tabs=STEPS.map((item,index)=>'<button class="step-tab" data-step="'+index+'" aria-label="Stap '+(index+1)+': '+esc(item.label)+'"><span class="step-number">'+(index+1)+'</span><span class="step-label">'+esc(item.label)+'</span><span class="step-short">'+esc(item.short)+'</span></button>').join('');
 app.innerHTML=(adminPreview?'<div class="admin-preview-bar" role="status"><strong>Conceptcatalogus</strong><span>Alleen voor controle · delen en voorstellen zijn niet beschikbaar.</span><a href="/odoo">Terug naar Odoo '+icon('arrow')+'</a></div>':'')+'<div class="workspace"><section class="preview-card" aria-label="Jouw ontwerp">'+
 '<div class="preview-status" id="preview-status" role="status" hidden></div>'+
 // The size chip and the view control float over the scene's top corners so the picture keeps the full card height.
 '<div class="preview-stage"><div class="preview-top"><div class="scene-heading"><span>Aanbouw</span><strong id="preview-size"></strong></div><div class="scene-modes-wrap">'+
 // 2.11.0, phones: ONE button naming the current mode ("Buiten ▾"); a tap shows the three (setModesMenu). On a
 // wider screen the button is not shown and the segmented control stands as it always did.
 '<button type="button" class="modes-toggle" data-action="modes-menu" aria-expanded="false" aria-haspopup="true" aria-label="Buiten, binnen of plattegrond kiezen"><span class="modes-current">Buiten</span>'+icon('chevron')+'</button>'+
 '<div class="segmented scene-modes" role="group" aria-label="Weergave">'+
 '<button data-scene-view="perspective" class="active" aria-pressed="true">Buiten</button><button data-scene-view="interior" aria-pressed="false">Binnen</button><button data-mode="2d" aria-pressed="false">Plan</button></div></div></div>'+
 '<div class="preview-scene" id="preview-scene"><div class="preview-loading">Je ontwerp wordt opgebouwd…</div></div>'+
 // Shown only while a phone's preview is compact (setPreviewCompact): the one way back that is always in reach.
 '<button type="button" class="preview-expand" data-action="preview-expand" hidden aria-label="Groter beeld" title="Groter beeld">'+icon('chevron')+'<span>Groter beeld</span></button>'+
 // The camera tools and the Weergave/fullscreen pair float over the scene's bottom corners in the same glass
 // language as .preview-top, so the toolbar costs the picture no height; only the two plates catch the pointer.
 // Since 2.10.7 the tools are small isometric drawings (scene_icons.js) with a label only the phone's fold-away
 // list shows; on a wider screen .tool-list is display:contents and the row reads as it always did.
 '<div class="preview-toolbar"><div class="camera-tools" role="group" aria-label="Camera en maatvoering">'+
 // A word beside the ≡ (2.10.9): a bare ≡ reads as the site menu, and beside the sliders icon both were "lines".
 // 2.11.0: on a phone EVERY button of the scene sits in this one menu — the camera tools, Weergave and volledig
 // scherm (placeViewTools moves those two in) — so it is named for all of them: "Opties", not "Camera".
 '<button class="tool-button tools-toggle" data-action="tools-menu" aria-expanded="false" aria-controls="tool-list" aria-label="Opties voor het beeld" title="Opties">'+icon('menu')+'<span class="tools-toggle-label">Opties</span></button>'+
 '<div class="tool-list" id="tool-list">'+
 '<div class="viewpoints"><button class="tool-button" data-action="viewpoints" aria-haspopup="true" aria-expanded="false" aria-label="Standpunt kiezen" title="Standpunt kiezen">'+toolIcon('viewpoints')+toolLabel('Standpunt')+'</button>'+viewpointsMenu()+'</div>'+
 '<button class="tool-button" data-action="environment" aria-label="Woning en tuin instellen" title="Woning en tuin">'+toolIcon('environment')+toolLabel('Woning en tuin')+'</button>'+
 '<button class="tool-button" data-action="material-detail" aria-label="Gevelmateriaal van dichtbij" title="Materiaal van dichtbij">'+toolIcon('material-detail')+toolLabel('Materiaal van dichtbij')+'</button>'+
 '<button class="tool-button" data-action="dimensions" aria-pressed="false" aria-label="Maatlijnen tonen" title="Maatlijnen">'+toolIcon('dimensions')+toolLabel('Maatlijnen')+'</button>'+
 '<button class="tool-button active" data-action="roof" aria-pressed="true" aria-label="Dak tonen" title="Dak verbergen">'+toolIcon('roof')+toolLabel('Dak verbergen')+'</button>'+
 '<button class="tool-button" data-action="reset-camera" aria-label="Camera herstellen" title="Camera herstellen">'+toolIcon('reset-camera')+toolLabel('Camera herstellen')+'</button>'+
 // Hulp last (2.11.0): it explains the others, so it follows them.
 '<button class="tool-button mobile-help" data-action="process" aria-label="Hulp bij het ontwerpen" title="Hulp">'+toolIcon('process')+toolLabel('Hulp')+'</button>'+
 '</div>'+materialCallout()+
 '</div><span class="rotate-hint">Sleep om te draaien · scroll om te zoomen</span>'+
 '<div class="view-tools" role="group" aria-label="Weergave-opties en volledig scherm">'+
 // Still data-action="view-strip", so every script that opens Weergave finds it; it now opens the Weergave dialog.
 '<button class="tool-button strip-toggle" data-action="view-strip" aria-haspopup="dialog" aria-expanded="false" aria-label="Weergave-opties" title="Weergave: voorbeelden, tuin, vloer, inrichting en kwaliteit">'+icon('sliders')+'<span class="strip-toggle-label">Weergave</span>'+toolIcon('weergave')+toolLabel('Weergave')+'</button>'+
 '<button class="tool-button fullscreen-button" data-action="fullscreen" aria-label="Ontwerp op volledig scherm" title="Volledig scherm">'+icon('expand')+toolIcon('fullscreen')+toolLabel('Volledig scherm')+'</button></div></div></div>'+
 '</section><section class="choices-card" id="step-panel" aria-label="Keuzes voor je aanbouw"><nav class="steps" aria-label="Stappen van je ontwerp">'+tabs+'</nav><div id="panel-content"></div><div id="panel-footer"></div></section></div>';
 renderStep();updatePreviewLabel();watchPanelScroll();placeViewTools();setupExit();updateModesToggle();
 matchMedia('(max-width:800px)').addEventListener?.('change',()=>{placeViewTools();setModesMenu(false);setToolsMenu(false);});
 app.setAttribute('aria-busy','false');
}

function updateTabs(){document.querySelectorAll('.step-tab').forEach(el=>{const i=Number(el.dataset.step);el.classList.toggle('active',i===step);el.classList.toggle('completed',i<step);if(i===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');el.querySelector('.step-number').innerHTML=i<step?icon('check'):i+1;
 // Section counter ("2/3 secties") for the three choice steps; the review step has no sections.
 const progress=i<3&&config&&fields?stepProgress(i):null,label='Stap '+(i+1)+': '+STEPS[i].label;
 let count=el.querySelector('.step-count');if(!count){count=document.createElement('span');count.className='step-count';el.append(count);}
 if(progress?.total){count.textContent=progress.done+'/'+progress.total+' secties';count.hidden=false;el.setAttribute('aria-label',label+' · '+progress.done+' van '+progress.total+' secties gekozen');}
 else{count.textContent='';count.hidden=true;el.setAttribute('aria-label',label);}});}
function dimensionField(key) {
 const d=dimensionLimits(config,catalog,key),value=config[key];
 const hint=d.sources.length?'Binnen het bereik van je gekozen pui en daklicht.':'Buitenmaat van je aanbouw.';
 return `<div class="dimension-field" data-dimension="${key}" tabindex="-1" role="group" aria-labelledby="${key}-label"><div class="field-heading"><label id="${key}-label" for="${key}">${d.label}</label><span>${metric(d.min)} – ${metric(d.max)} m</span></div><div class="number-control"><button data-adjust="${key}" data-delta="-${d.increment}" aria-label="${d.label} ${d.increment} centimeter kleiner" ${value<=d.min?'disabled':''}>${icon('minus')}</button><div><input id="${key}" data-config="${key}" type="number" inputmode="numeric" min="${d.min}" max="${d.max}" step="${d.step}" value="${value}" aria-describedby="${key}-hint ${key}-error"><span>cm</span></div><button data-adjust="${key}" data-delta="${d.increment}" aria-label="${d.label} ${d.increment} centimeter groter" ${value>=d.max?'disabled':''}>${icon('plus')}</button></div><input class="dimension-slider" type="range" data-range="${key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${value}" aria-label="${d.label} in centimeter" aria-valuetext="${value} centimeter" aria-describedby="${key}-hint" style="--fill:${(value-d.min)/Math.max(1,d.max-d.min)*100}%"><p class="dimension-hint" id="${key}-hint">${esc(hint)}</p><p class="field-error" id="${key}-error">${esc(errors[key]||'')}</p></div>`;
}

const descriptions={
 facade:'Kies de materiaalsoort en afwerking. Kleur en structuur in het beeld zijn indicatief.',
 rollaag:'Boven de voorpui: de gevel loopt door (rollaag), of een wit of zwart paneel tot aan de daktrim.',
 frontOpening:'De buitenmaat en de gekozen pui moeten bij elkaar passen.',
 openingMaterial:'Kies het materiaal van de kozijnen. Een eerder ontwerp kan nog zonder materiaalkeuze zijn opgeslagen.',
 rooflight:'Kies het type en de verdeling van het glas.',
 roofShade:'Zonwering voor een geschikt daklicht.',
 greenRoof:'Sedum op het dak. De definitieve dakopbouw wordt technisch beoordeeld.',
 overhang:'Een overstek aan de tuinzijde, met optionele lichtpunten.',
 outsideLight:'Kies de zijde van de lichtpunten, gezien vanuit de tuin.',
 outsideSocket:'Kies de gewenste aansluitpunten, gezien vanuit de tuin.',
 outsideTap:'Kies de plaats van de buitenkraan.',
 interior:'Neem de binnenafwerking en aansluitpunten mee in je ontwerp.',
 underfloorHeating:'Vloervoorbereiding en levering van een systeem zijn afzonderlijke onderdelen van de leveringsomvang.',
 heating:'Kies de wand voor de verwarmingsvoorziening.',
 ceilingPositions:'Kies één of meer plaatsen. Links en rechts zijn gezien vanuit de tuin.',
 spotPositions:'Kies de spotposities in het plafond. De bovenste rij ligt bij de bestaande woning.',
 wallLights:'Kies de wandposities, gezien vanuit de tuin.',
 socketPositions:'Kies de wandposities, gezien vanuit de tuin.',
 ceilingLights:'Aantal plafondpunten.',switches:'Aantal schakelpunten.',spotlights:'Aantal spotpunten.',
 piles:'Richtlijn op basis van de vloeroppervlakte: 2 heipalen tot 10 m² · 3 tot 15 m² · 4 tot 25 m² · 6 tot 40 m².\nWij controleren het aantal bij de opname.',
 demolition:'Moet de bestaande achtergevel worden geopend?',
 access:'Hoe is de achterzijde van je woning bereikbaar?',
};
const groups=STEP_SECTIONS;
/*
 * 2.10.8, the customer: "rakamları arttırıp ya da eksilttiğimde ter illustratie mesajı kaybolup geliyor … ekran
 * yüksekliği sürekli hareket ediyor". Every +/− started a price round trip, and while it ran the whole step was
 * redrawn WITHOUT the scope notes and lock states, which came back ~300 ms later: two height jumps per click.
 * `price` still holds the last answer the server gave while the next one is on its way, so everything that reads
 * it now keeps showing that answer (stale-while-revalidate) and is only replaced when the new answer differs.
 */
function knownPrice(){return priceError?null:price;}
function scopeFor(key) {
 const aliases={ceilingPositions:'ceilingLights',spotPositions:'spotlights',socketPositions:'sockets'},scope=knownPrice()?.scope;
 return scope?.find(item=>item.key===key)||scope?.find(item=>item.key===aliases[key]);
}
function scopeStatus(item) {
 if(!item)return '';
 return item.productIncluded?'Inbegrepen'+(item.modelFidelity==='representative'?' · model indicatief':''):'Ter illustratie · niet inbegrepen';
}
/** Whether this field asks for anything at all, from the design itself — the answer while the server is still counting. */
function fieldActive(key){const value=config?.[key];return Array.isArray(value)?value.length>0:typeof value==='number'?value>0:!['none',false,null,undefined,''].includes(value);}
/**
 * The scope note as ONE line with the long explanation behind a tap ("nowrap olması, mesaj kısaltılabilir, belki
 * tıklanınca daha uzun açıklama gösterilebilir"). Five states; the short text names the state, the long one says
 * what it means for the delivery and the price.
 */
// Copy from the visual/accessibility review (2026-09-19), kept on "Ter illustratie" so the note, the help legend and
// the Weergave legend keep one word for one thing. The long text repeats the short one, so an ellipsis cuts nothing.
// 2.10.9 (CRO review, approved by the customer): "Inbegrepen" is the rule, so it is said ONCE per step (SCOPE_POLICY)
// and a field only carries a note when it is an exception to that rule — the notes that matter are no longer hidden
// among a dozen identical "Inbegrepen · model indicatief" lines, and every field sheds ~30 px.
const SCOPE_POLICY={short:'Alles inbegrepen, tenzij anders vermeld',long:'Alles wat je in deze stap kiest, zit in je voorstel en in de prijs. Staat er bij een keuze “Ter illustratie”, dan is wat je in het beeld ziet een voorbeeld; wat wel geleverd wordt, staat erbij. Getoonde modellen zijn indicatief: merk, type en kleur stemmen we af bij de opname.'};
const SCOPE_COPY={
 'prep-extra':{short:'Ter illustratie · voorbereiding apart',long:'Het apparaat in het beeld is een voorbeeld en wordt niet geleverd. De voorbereiding (leiding en aansluitpunt) leggen we wel aan, als aparte post in je voorstel.'},
 'prep-included':{short:'Ter illustratie · incl. voorbereiding',long:'Het apparaat in het beeld is een voorbeeld en wordt niet geleverd. De voorbereiding (leiding en aansluitpunt) zit in de prijs.'},
 illustrative:{short:'Ter illustratie · niet inbegrepen',long:'Alleen getoond om de ruimte te laten zien; niet geleverd en niet in de prijs. Voorbeelden verbergen kan via Weergave.'},
};
function scopeState(key){
 const item=scopeFor(key);
 if(!item||!(pricePending?fieldActive(key):item.quantity>0))return null;
 if(item.productIncluded)return null; // the rule, said once per step by SCOPE_POLICY
 const preparation=item.components?.find(part=>part.role==='preparation'&&part.status!=='excluded');
 return preparation?(preparation.status==='extra'?'prep-extra':'prep-included'):'illustrative';
}
const openScopes=new Set(); // Notes the visitor opened stay open across the redraws a price round trip causes.
document.addEventListener('toggle',event=>{const note=event.target;if(note.matches?.('.field-scope[data-scope]')){if(note.open)openScopes.add(note.dataset.scope);else openScopes.delete(note.dataset.scope);}},true);
/** One line, the explanation behind a tap. check = inbegrepen, eye = ter illustratie: the help legend's two marks. */
function scopeNote(id,copy,included,state=''){
 return '<details class="field-scope '+(included?'included':'illustrative')+'" data-scope="'+esc(id)+'"'+(state?' data-state="'+state+'"':'')+(openScopes.has(id)?' open':'')+'>'+
  '<summary>'+icon(included?'check':'eye')+'<span class="scope-short">'+esc(copy.short)+'</span>'+icon('chevron','scope-more')+'</summary>'+
  '<p class="scope-detail">'+esc(copy.long)+'</p></details>';
}
function scopeLine(key) {
 const state=scopeState(key);
 return state?scopeNote(key,SCOPE_COPY[state],false,state):'';
}
/** One place for the note in every kind of field, so a redraw and an in-place update never disagree on where it sits. */
function placeScope(container,markup){
 const error=container.querySelector(':scope > .field-error'),count=container.querySelector(':scope > .count-body');
 if(error)error.insertAdjacentHTML('beforebegin',markup);else if(count)count.insertAdjacentHTML('afterend',markup);else container.insertAdjacentHTML('beforeend',markup);
}
function optionImage(key,id) {
 if(key==='facade') {const material=MATERIALS[id];return '<span class="material-swatch '+(material?.type||'')+'" style="--material:'+(material?.color||'#a6a59e')+'"></span>';}
 if(key==='frontOpening')return openingIcon(String(id));
 if(key==='rooflight') {
  return rooflightIcon(id);
 }
 if(key.endsWith('Control'))return icon(id.startsWith('dimmed')?'dimmer':'switch','control-option-icon');
 return '';
}

function optionsFor(field,key){
 if(field.options?.length)return field.options;
 if(typeof config[key]==='boolean')return [{id:false,label:key==='interior'?'Alleen de buitenzijde':'Nee'},{id:true,label:key==='interior'?'Ook de binnenzijde':'Ja'}];
 return [];
}

function renderField(key) {
 const field=fields[key];if(!field||!fieldIsVisible(key,config,fields))return '';
 let options=optionsFor(field,key);
 if(['wallLights','socketPositions'].includes(key))options=[...options].sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1))||a.id.localeCompare(b.id));
 const area=config.width*config.depth/10000;
 const description=(descriptions[key]||field.description||'')+(key==='piles'?'\nVoor jouw '+esc(area.toLocaleString('nl-NL',{maximumFractionDigits:2}))+' m² adviseren wij '+recommendedPiles(area)+' heipalen.':'');
 const focusKey=({ceilingPositions:'ceilingLights',spotPositions:'spotlights',socketPositions:'sockets'})[key]||key;
 const canFocus=['outsideLight','outsideSocket','outsideTap','heating','ceilingLights','spotlights','sockets','wallLights','switches','overhangSpots','ceilingLightControl','spotControl','wallLightControl'].includes(focusKey)&&(Array.isArray(config[key])?config[key].length>0:typeof config[key]==='number'?config[key]>0:!['none',false,null,undefined].includes(config[key]));
 const help=description?'<p class="field-description">'+esc(description)+'</p>':'';
 const inspect=key==='facade'?'<button class="field-preview text-button" data-action="material-detail" aria-label="Gevelmateriaal bekijken in 3D">'+icon('material')+'<span>3D bekijken</span></button>':canFocus?'<button class="field-preview text-button" data-focus-option="'+focusKey+'" aria-label="'+esc(field.label)+' bekijken in 3D">'+icon('eye')+'<span>3D bekijken</span></button>':'';
 const numeric=typeof config[key]==='number'&&!catalog.dimensions[key]&&key!=='piles';
 if(numeric) {
  const max=field.max??Math.max(...options.map(option=>Number(option.id)).filter(Number.isFinite),1),min=field.min??0;
  return '<div class="field-block count-field" data-field="'+key+'" tabindex="-1" role="group" aria-labelledby="'+key+'-label"><div class="field-head"><label id="'+key+'-label" for="'+key+'">'+esc(field.label)+'</label>'+inspect+'</div><div class="count-body"><div>'+help+'</div><div class="counter"><button data-count="'+key+'" data-delta="-1" aria-label="Minder '+esc(field.label)+'" '+(config[key]<=min?'disabled':'')+'>'+icon('minus')+'</button><input id="'+key+'" data-config="'+key+'" type="number" min="'+min+'" max="'+max+'" step="1" value="'+config[key]+'" aria-label="'+esc(field.label)+'"><button data-count="'+key+'" data-delta="1" aria-label="Meer '+esc(field.label)+'" '+(config[key]>=max?'disabled':'')+'>'+icon('plus')+'</button></div></div>'+scopeLine(key)+'</div>';
 }
 const multiple=field.type==='multiselect',visual=['facade','frontOpening','rooflight'].includes(key);
 let unavailableCount=0;
 const renderOption=option=>{
  const selected=multiple?config[key]?.includes(option.id):config[key]===option.id;
  const label=esc(option.label);
  let reason=profileConstraint(key,option.id,config,catalog),unavailable=!!reason;
  const allowed=knownPrice()?.allowedPositions?.[key]; // the last answer while the next is pending: no lock blinks
  if(allowed&&!allowed.includes(option.id)){unavailable=true;reason=price.positionIssues?.find(issue=>issue.field===key&&issue.position===option.id)?.message||'Past niet bij de huidige indeling';}
  if(unavailable)unavailableCount++;
  return '<label class="option-card '+(selected?'selected ':'')+(visual?'visual-card ':'')+(multiple?'position-option':'')+(unavailable?' unavailable':'')+'" '+(unavailable?'role="button" tabindex="0" aria-disabled="true" aria-label="'+label+' — niet beschikbaar" aria-describedby="'+key+'-availability" data-unavailable="'+esc(reason)+'"':'')+'><input type="'+(multiple?'checkbox':'radio')+'" name="'+key+'" data-config="'+key+'" value="'+esc(option.id)+'" '+(selected?'checked ':'')+(unavailable?'disabled ':'')+'><span class="option-check">'+(unavailable?icon('lock'):selected?icon('check'):'')+'</span>'+optionImage(key,String(option.id))+'<span class="option-title">'+label+(key==='piles'&&option.id===recommendedPiles(config.width*config.depth/10000)?' <span class="option-badge">Aanbevolen</span>':'')+'</span></label>';
 };
 let choices='';
 const familyMarkup=(title,items,detail='')=>'<div class="material-family"><h2 class="option-family-title">'+esc(title)+'</h2>'+(detail?'<p class="option-family-description">'+esc(detail)+'</p>':'')+'<div class="option-grid visual-grid">'+items.map(renderOption).join('')+'</div></div>';
 if(key==='facade') {
  for(const [name,prefixes] of [['Steen',['brick']],['Hout',['wood','open']],['Kunststof',['pvc']],['Stucwerk',['render']]]) {
   const family=options.filter(option=>prefixes.some(prefix=>String(option.id).startsWith(prefix)));
   if(family.length)choices+=familyMarkup(name,family);
  }
 } else if(key==='rooflight'){
  const without=options.filter(option=>option.id==='none');
  if(without.length)choices='<div class="option-grid roof-none">'+without.map(renderOption).join('')+'</div>';
  for(const [prefix,title,detail] of [['lean-','Lessenaar','Eén hellend glasvlak'],['gable-','Zadeldak','Twee hellende glasvlakken met een nok']]){
   const family=options.filter(option=>String(option.id).startsWith(prefix)).sort((a,b)=>Number(a.id.split('-')[1])-Number(b.id.split('-')[1]));
   if(family.length)choices+=familyMarkup(title,family,detail);
  }
 } else {
  choices='<div class="option-grid '+(visual?'visual-grid ':'')+(multiple?'position-grid '+(key==='spotPositions'?'ceiling-grid':key==='ceilingPositions'?'three-positions':'wall-grid'):'')+'">'+options.map(renderOption).join('')+'</div>';
  if(multiple)choices='<div class="placement-board"><span class="placement-side">Bestaande woning</span>'+choices+'<span class="placement-side">Tuinzijde</span></div><p class="position-count">'+(config[key]?.length||0)+' geselecteerd'+(field.maxSelections?' · maximaal '+field.maxSelections:'')+'</p>';
 }
 const selection=visual?'<p class="current-choice"><span>Gekozen</span><strong>'+esc(selectedLabel(key))+'</strong></p>':'';
 const availability=unavailableCount?'<p class="availability-note" id="'+key+'-availability">'+icon('lock')+'<span>Vergrendeld = past hier niet. Tik voor uitleg.</span></p>':'';
 // aria-labelledby, not the legend: the legend also holds the "3D bekijken" button, so the fieldset's accessible
 // name used to compute as "Gevelbekleding3D bekijken" — audible nonsense the moment the cursor focuses the group.
 return '<fieldset class="field-block" data-field="'+key+'" tabindex="-1" aria-labelledby="'+key+'-label"><legend class="field-head"><span id="'+key+'-label">'+esc(field.label)+'</span>'+inspect+'</legend>'+selection+help+choices+availability+scopeLine(key)+'<p class="field-error" id="'+key+'-error">'+esc(errors[key]||'')+'</p></fieldset>';
}
/** Section cards: one open per step (the most recently added id in expandedGroups wins), a ✓ once every field has a choice or the section was looked at. */
const visitedGroups=new Set();let visitedGeneration=0;
function visited(){if(visitedGeneration!==designGeneration){visitedGroups.clear();visitedGeneration=designGeneration;}return visitedGroups;} // A reset starts a new generation, so visits do not survive "Opnieuw beginnen".
function groupKeys(group){return group.keys.filter(key=>fields[key]&&fieldIsVisible(key,config,fields));}
function visibleGroups(index=step){return (groups[index]||[]).filter(group=>groupKeys(group).length);}
function groupStatus(group){const keys=groupKeys(group);return {done:sectionDone(keys.map(key=>config[key]),visited().has(group.id)),summary:sectionSummary(keys.map(selectedLabel),48)};}
function statusMarkup(group){return groupStatus(group).done?'<span class="section-status done" role="img" aria-label="Sectie gereed">'+icon('check')+'</span>':'<span class="section-status pending">nog te kiezen</span>';}
function stepProgress(index){const list=visibleGroups(index);return {done:list.filter(group=>groupStatus(group).done).length,total:list.length};}
/** Keeps one id per step in expandedGroups (other code adds ids freely) and counts the open section as visited. */
function resolveOpenGroup(index=step){const ids=visibleGroups(index).map(group=>group.id),open=openGroupId(expandedGroups,ids);for(const id of ids)if(id!==open)expandedGroups.delete(id);if(open)visited().add(open);return open;}
function refreshSectionStatus(){for(const group of visibleGroups()){const node=$('[data-group="'+group.id+'"] > summary .section-status');if(node)node.outerHTML=statusMarkup(group);}updateTabs();}
/**
 * The choices on the card that is OPEN are being looked at: the visitor either opened it themselves or the cursor
 * walked them there and scrolled it to the top. The IntersectionObserver cannot see that on a phone — its root margin
 * discounts the bottom 25% of a panel only ~376 px tall, so a field on the open card never counted as read and the
 * cursor kept pointing at the card the visitor was already standing on. Measured live, kozijn card open:
 * 390 px said "nog 9 keuzes · Naar Kozijn" where 1440 px said "nog 8 · Naar Daklicht". The flow may not depend on
 * screen size; the observer still earns its keep on a tall panel where several cards are visible at once.
 */
function markOpenGroupSeen(id){
 const group=visibleGroups().find(entry=>entry.id===id);
 if(!group)return;
 for(const key of groupKeys(group))if(choiceVisible(key))markSeen(key);
}
/** Opening a section closes the others of the step; the clicked header stays where the finger was. */
function openSection(details,open){
 const id=details.dataset.group;expandedGroups.delete(id);
 if(!open)return;
 expandedGroups.add(id);visited().add(id);
 const summary=details.querySelector(':scope > summary'),panel=$('#panel-content'),top=summary?.getBoundingClientRect().top;
 for(const other of document.querySelectorAll('details.choice-group[open]'))if(other!==details)other.open=false;
 if(panel&&summary&&Number.isFinite(top))panel.scrollTop+=summary.getBoundingClientRect().top-top;
 refreshSectionStatus();markOpenGroupSeen(id);
}
/**
 * THE CURSOR. The footer's primary button walks the visitor to their next CHOICE and only becomes "verder naar
 * <stap>" once no choice of this step is left unseen. It replaces both the per-section "Volgende sectie" rows
 * (which pointed at a header the visitor could already see) and the footer's old unconditional step jump.
 *
 * Read the decision logic in sections.js; what lives here is the part that needs the DOM — which node to scroll
 * to, how far, and what to focus once it is there.
 */
const seenChoices=new Set();let seenGeneration=0;
function seen(){if(seenGeneration!==designGeneration){seenChoices.clear();seenGeneration=designGeneration;}return seenChoices;} // Cleared only by "Opnieuw beginnen", like visitedGroups.
function choiceVisible(key){return catalog?.dimensions?.[key]?true:!!fields?.[key]&&fieldIsVisible(key,config,fields);}
function choiceKeys(index=step){return catalog&&fields&&config?stepChoiceKeys(visibleGroups(index),STEP_LEAD_KEYS[index],choiceVisible):[];}
function choiceLabel(key){return catalog?.dimensions?.[key]?.label||fieldLabel(key);}
function currentOpenGroup(){return openGroupId(expandedGroups,visibleGroups().map(group=>group.id));} // resolveOpenGroup() with its side effects left out: the footer only reads.
function choiceNode(key){return $('[data-field="'+CSS.escape(key)+'"],[data-dimension="'+CSS.escape(key)+'"]');}

/**
 * Where "back" goes, and what it is called (2.16.0: "geri butonu da isim ile bir önceki seçime dönebilsin"). Inside a
 * step that is the previous CHOICE, by name — now that a card is a choice, "vorige stap" was the wrong grain and an
 * unlabelled arrow said nothing about what it would undo. At the first choice of a step it is the step before it.
 */
function backDestination(){
 const list=visibleGroups(),open=currentOpenGroup();
 const index=list.findIndex(group=>group.id===open);
 if(index>0)return {action:'goto-group',id:list[index-1].id,label:list[index-1].title};
 if(step>0)return {action:'previous',label:STEPS[step-1].short};
 return null;
}
function backButton(){
 const destination=backDestination();
 if(!destination)return '';
 const group=destination.action==='goto-group'?' data-group="'+esc(destination.id)+'"':'';
 return '<button class="button back-button" data-action="'+destination.action+'"'+group+' aria-label="Terug naar '+esc(destination.label)+'">'
  +icon('back')+'<span class="back-label">'+esc(destination.label)+'</span></button>';
}
/** What the primary button is right now: its label, its data-action and the number the footer note carries. */
function footerAction(){
 if(step===STEPS.length-1)return {action:'contact',label:adminPreview?'Alleen conceptcontrole':'Persoonlijk voorstel maken',remaining:0};
 const keys=choiceKeys(),key=nextChoice(keys,seen());
 if(key===null)return {action:'next',label:'Verder naar '+STEPS[step+1].short.toLowerCase(),remaining:0};
 return {action:'goto-choice',key,label:'Naar '+choiceDestination(key,visibleGroups(),currentOpenGroup(),choiceLabel).label,remaining:remainingChoices(keys,seen())};
}
/** The tab row counts SECTIONS; this line is the only place that says how many CHOICES are left. It yields to the storage reassurance the moment the cursor retires — which is exactly when the visitor is about to leave the step. */
function footerNote(action){
 if(adminPreview)return 'Wijzigingen in dit voorbeeld worden niet opgeslagen';
 if(step===STEPS.length-1)return 'Met je contactgegevens · geen bestelling of betaling';
 if(action.action==='goto-choice')return 'Nog '+action.remaining+' keuze'+(action.remaining===1?'':'s')+' in deze stap';
 return 'Je ontwerp wordt automatisch op dit apparaat bewaard';
}
function primaryButton(action){
 const last=step===STEPS.length-1;
 return '<button class="button primary next-button" data-action="'+action.action+'"'+(action.key?' data-choice="'+esc(action.key)+'"':'')+' '+((pricePending||priceError||adminPreview)&&last?'disabled':'')+'><span class="next-text"><span class="next-kicker">'+esc(footerKicker(action))+'</span><span class="next-label">'+esc(action.label)+'</span></span>'+icon('arrow')+'</button>';
}
/** The phone's one-row footer has no room for the note line; its gist rides on the button as a small top line. */
function footerKicker(action){
 if(adminPreview)return 'Conceptvoorbeeld';
 if(step===STEPS.length-1)return 'Geen bestelling of betaling';
 if(action.action==='goto-choice')return 'Volgende · nog '+action.remaining+' keuze'+(action.remaining===1?'':'s');
 return 'Deze stap is klaar';
}
/** The cursor moves on every scroll, so the button and the note are patched in place — rebuilding the footer ~28 times per design would fight the aria-live price element. */
function updateFooterAction(){
 const button=$('#panel-footer .next-button');if(!button)return;
 // The way back follows the open card (2.16.0), so it is refreshed here rather than only on a full footer render:
 // walking to the next choice changes what "terug" means, and the button has to say so.
 const actions=$('#panel-footer .step-actions'),back=actions?.querySelector('.back-button'),wanted=backButton();
 if(actions&&(back?back.outerHTML:'')!==wanted){
  if(back)back.remove();
  if(wanted)actions.insertAdjacentHTML('afterbegin',wanted);
 }
 const action=footerAction(),label=button.querySelector('.next-label'),note=$('#panel-footer .footer-note'),text=footerNote(action);
 if(label&&label.textContent!==action.label)label.textContent=action.label;
 const kicker=button.querySelector('.next-kicker'),kick=footerKicker(action);if(kicker&&kicker.textContent!==kick)kicker.textContent=kick;
 if(button.dataset.action!==action.action)button.dataset.action=action.action;
 if(action.key)button.dataset.choice=action.key;else delete button.dataset.choice;
 if(note&&note.textContent!==text)note.textContent=text;
}

/**
 * A choice is "seen" once its top edge has rested in the panel's reading area (the panel inset 25% at the bottom)
 * for 300 ms, or the moment the visitor changes a control inside it. Arriving is what retires a field, so the
 * button never points at something already on screen — and because seen is never un-set, going back to change an
 * earlier answer cannot re-arm it. One observer, re-attached after every render; the set lives outside the DOM
 * because renderStep() rebuilds the panel on every config change.
 */
const DWELL_MS=300;let choiceObserver=null;const dwellTimers=new Map();
function stopDwell(key){const timer=dwellTimers.get(key);if(timer!==undefined){clearTimeout(timer);dwellTimers.delete(key);}}
function clearDwell(){for(const timer of dwellTimers.values())clearTimeout(timer);dwellTimers.clear();}
function markSeen(key){if(!key||seen().has(key))return;seen().add(key);stopDwell(key);updateFooterAction();}
function observeChoices(){
 const panel=$('#panel-content');if(!panel)return;
 // Without an IntersectionObserver there is no honest way to know what was read, so nothing is: the cursor stays
 // on the first choice and the button still works. Graceful degradation, never a dead button.
 if(typeof IntersectionObserver!=='function')return;
 choiceObserver=choiceObserver||new IntersectionObserver(entries=>{
  for(const entry of entries){
   const key=entry.target.dataset.field||entry.target.dataset.dimension;
   if(!key||seen().has(key)){stopDwell(key);continue;}
   if(entry.isIntersecting){if(!dwellTimers.has(key))dwellTimers.set(key,setTimeout(()=>markSeen(key),DWELL_MS));}
   else stopDwell(key);
  }
 },{root:panel,rootMargin:'0px 0px -25% 0px',threshold:0});
 choiceObserver.disconnect();clearDwell();
 for(const block of panel.querySelectorAll('[data-field],[data-dimension]'))choiceObserver.observe(block);
}

/**
 * The only motion the cursor adds, and it is movement the visitor asked for. Repeated register (~28 presses in a
 * complete design): 200 ms for trips under one panel height, 260 ms for the long ones, and an instant jump when
 * the visitor asked for reduced motion — byte for byte what the old "Volgende sectie" did for everyone.
 */
let scrollTween=0,motionTokens=null;
function cancelScrollTween(){if(scrollTween){cancelAnimationFrame(scrollTween);scrollTween=0;}}
function scrollDuration(distance,height){
 if(!motionTokens){
  const style=getComputedStyle(document.documentElement),ms=(name,fallback)=>{const value=parseFloat(style.getPropertyValue(name));return Number.isFinite(value)&&value>0?value:fallback;};
  motionTokens={near:ms('--dur-scroll',200),far:ms('--dur-scroll-far',260)};
 }
 return distance<=height?motionTokens.near:motionTokens.far;
}
function tweenPanelTo(target){
 const panel=$('#panel-content');if(!panel)return;
 cancelScrollTween();
 const to=Math.max(0,Math.min(panel.scrollHeight-panel.clientHeight,Math.round(target))),from=panel.scrollTop,distance=to-from;
 if(Math.abs(distance)<1||window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||typeof requestAnimationFrame!=='function'){panel.scrollTop=to;return;}
 const duration=scrollDuration(Math.abs(distance),panel.clientHeight||1),start=performance.now();
 const frame=now=>{
  const progress=Math.min(1,(now-start)/duration);
  panel.scrollTop=from+distance*(1-Math.pow(1-progress,3));
  if(progress<1)scrollTween=requestAnimationFrame(frame);
  else{scrollTween=0;panel.scrollTop=to;}
 };
 scrollTween=requestAnimationFrame(frame);
}

/** Was nextSection()'s body: the destination section opens, the others of the step close, its header lands at the top of the panel and takes focus. */
function openChoiceSection(id){
 const target=$('[data-group="'+CSS.escape(id)+'"]'),panel=$('#panel-content'),summary=target?.querySelector(':scope > summary');
 if(!target||!summary||!panel)return false;
 for(const other of document.querySelectorAll('details.choice-group[open]'))if(other!==target){other.open=false;expandedGroups.delete(other.dataset.group);}
 target.open=true;expandedGroups.delete(id);expandedGroups.add(id);visited().add(id);refreshSectionStatus();
 tweenPanelTo(panel.scrollTop+summary.getBoundingClientRect().top-panel.getBoundingClientRect().top-12);
 summary.focus({preventScroll:true});
 markOpenGroupSeen(id);
 return true;
}
/** Focus moves with preventScroll because the tween owns the scrolling; a named <fieldset>/role=group IS the announcement, so there is no toast and no extra live region. */
function focusChoice(node){
 const panel=$('#panel-content');
 if(panel)tweenPanelTo(panel.scrollTop+node.getBoundingClientRect().top-panel.getBoundingClientRect().top-8);
 node.focus({preventScroll:true});
}
/** A destination that has gone (a field a concurrent render removed) retires itself and hands the press on, so the button can never point at nothing. */
function goToChoice(key){
 for(let attempt=0;key&&attempt<4;attempt++){
  if(choiceKeys().includes(key)){
   const destination=choiceDestination(key,visibleGroups(),currentOpenGroup(),choiceLabel);
   if(destination.kind==='section'?openChoiceSection(destination.id):(node=>node?(focusChoice(node),true):false)(choiceNode(key)))return;
   markSeen(key);
  }
  key=nextChoice(choiceKeys(),seen());
 }
 updateFooterAction();
}
// No "Volgende sectie" row: the section ends at its last field's bottom rule and the next card's header follows,
// which is what the visitor was already looking at. Dropping the row also promotes that last field to :last-child,
// so styles.css sheds its divider and its bottom margin by itself.
function renderGroup(group,index=0) {
 const keys=groupKeys(group);
 if(!keys.length)return '';
 return '<details class="choice-group section-card" data-group="'+group.id+'" '+(expandedGroups.has(group.id)?'open':'')+'><summary><span class="section-index" aria-hidden="true">'+(index+1)+'</span><span class="section-text"><span class="section-title">'+esc(group.title)+'</span><small>'+esc(groupStatus(group).summary)+'</small></span>'+statusMarkup(group)+icon('chevron')+'</summary><div class="group-fields">'+keys.map(renderField).join('')+'</div></details>';
}
function renderStep(focus=false) {
 cancelScrollTween(); // A render mid-flight must not fight preservePanelPosition for the scroll offset.
 resolveOpenGroup();updateTabs();updateResetCameraLabel();syncSelectableKeys();
 const item=STEPS[step];
 let content='';
 if(step===0)content='<div class="dimension-grid">'+dimensionField('width')+dimensionField('depth')+'</div><div class="area-line"><span>Buitenmaten · hoogte 2,80 m</span><strong id="area-number">'+(config.width*config.depth/10000).toLocaleString('nl-NL')+' m²</strong></div>';
 if(step===1)content+=renderField('interior');
 if(step<3)content+=visibleGroups().map((group,index)=>renderGroup(group,index)).join('');
 if(step===1&&!config.interior)content+='<div class="interior-placeholder"><h2>Alleen de buitenzijde</h2><p>Je kunt de binnenzijde zelf laten afwerken. Kies hierboven de binnenafwerking om voorzieningen te plaatsen.</p><button class="text-button" data-scene-view="interior">Bekijk de binnenruimte '+icon('arrow')+'</button></div>';
 if(step===2)content+='<div class="scope-panel"><h2>Wat wordt er geleverd?</h2><p>Voorbereiding, apparaat, montage en aansluiting staan afzonderlijk vermeld.</p><div id="scope-content">'+renderScope()+'</div></div>';
 if(step===3)content=renderSummary();
 const policy=step<3?scopeNote('policy',SCOPE_POLICY,true):''; // the "Inbegrepen" rule, once per choice step
 $('#panel-content').innerHTML='<div class="panel-heading"><h1 tabindex="-1" id="step-title">'+esc(item.title)+'</h1><p>'+esc(item.description)+'</p>'+policy+'</div><div class="panel-fields">'+content+'</div>';
 $('#panel-content').scrollTop=0;
 // The open card counts as seen the moment the step is on screen, for the same reason it does when the visitor opens
 // one: at load nothing fires a toggle event, so on a phone the very first press of the forward button was spent
 // marking the card already open ("Naar Gevelbekleding" while Gevelbekleding was open, measured live at 390 px).
 renderFooter();observeChoices();markOpenGroupSeen(currentOpenGroup());
 document.querySelectorAll('[data-focus-option],[data-action="material-detail"]').forEach(button=>button.disabled=currentMode==='2d');
 if(focus)$('#step-title').focus({preventScroll:true});
}
function renderFooter() {
 if(!$('#panel-footer'))return;
 updateResetButton();
 const action=footerAction();
 // On a phone the footer is ONE row (styles.css): the price with "Demoprijs" right under it — the CRO review's
 // condition: that word never leaves the amount — and the button, whose small top line carries what the separate
 // note line said. The desktop keeps its two rows; the short caption and the kicker are simply not shown there.
 const caption=price?.priceStatusLabel||(demoPricing()?'Voorbeeldprijs incl. btw':'Prijsindicatie incl. btw');
 $('#panel-footer').innerHTML='<div class="price-peek"><div><span class="price-caption">'+esc(caption)+'</span><span class="price-caption-short" title="'+esc(caption)+'">'+(demoPricing()?'Demoprijs':'Incl. btw')+'</span><button data-action="pricing">Prijsopbouw</button></div><strong class="price-value '+(pricePending?'pending':'')+(pricePending&&price?' refreshing':'')+'" aria-live="polite">'+(pricePending?(price?money(price.total):'Berekenen…'):priceError?'Niet beschikbaar':price?money(price.total):'—')+'</strong></div>'+
 (priceError?'<p class="api-error" role="alert">'+(catalogChanged?'Het aanbod is bijgewerkt.':Object.keys(errors).length?'Controleer de gemarkeerde keuzes.':'Berekening niet beschikbaar.')+' <button data-action="'+(catalogChanged?'reload-catalog':'retry-price')+'">'+(catalogChanged?'Nieuwe versie bekijken':'Opnieuw proberen')+'</button></p>':'')+
 '<div class="step-actions">'+backButton()+primaryButton(action)+'</div><p class="footer-note">'+esc(footerNote(action))+'</p>';
}
function renderScope() {
 if(pricePending&&!price)return '<p class="scope-loading" role="status">De leveringsomvang wordt berekend…</p>'; // first load only; later the last list stays
 if(priceError)return '<p class="api-error">De leveringsomvang is nog niet beschikbaar. Controleer je keuzes en bereken opnieuw.</p>';
 const items=price?.scope?.filter(item=>item.quantity>0)||[];
 if(!items.length)return '<p class="scope-empty">Er zijn nog geen aanvullende voorzieningen gekozen.</p>';
 const statusLabels={included:'Inbegrepen',extra:'Apart berekend',excluded:'Niet inbegrepen'};
 return '<div class="scope-list">'+items.map(item=>'<details class="scope-item"><summary><span>'+esc(item.label)+'<small>'+esc(scopeStatus(item))+'</small></span><span class="scope-quantity">'+item.quantity+'×</span>'+icon('chevron')+'</summary><dl>'+item.components.map(part=>'<div><dt>'+esc(part.label)+'</dt><dd>'+esc(part.status==='extra'&&part.total<0?'Minderprijs':statusLabels[part.status]||part.status)+(part.status==='extra'?' · '+preciseMoney(part.total||0):'')+'</dd></div>').join('')+'</dl></details>').join('')+'</div>';
}
function renderSummary() {
 return '<div class="summary-dimensions"><strong>'+metric(config.width)+' × '+metric(config.depth)+' m</strong><span>'+(config.width*config.depth/10000).toLocaleString('nl-NL')+' m² · buitenmaten</span><button class="text-button" data-step="0">Wijzig maten '+icon('edit')+'</button></div>'+
 (adminPreview||!getFeatures().compare?'':'<div id="comparison-content">'+renderComparison()+'</div>')+STEPS.slice(0,3).map((item,index)=>'<section class="summary-section"><div class="summary-heading"><h2>'+esc(item.label)+'</h2><button data-step="'+index+'" aria-label="'+esc(item.label)+' aanpassen">Wijzig '+icon('edit')+'</button></div><dl>'+item.fields.filter(key=>fields[key]&&fieldIsVisible(key,config,fields)).map(key=>'<div><dt>'+esc(fieldLabel(key))+'</dt><dd>'+esc(selectedLabel(key))+'</dd></div>').join('')+'</dl></section>').join('')+
 '<section class="scope-panel"><h2>Leveringsomvang</h2><div id="scope-content">'+renderScope()+'</div></section>'+
 '<p class="notice">'+esc(pricingDisclaimer())+'</p>'+
 (adminPreview?'':'<div class="summary-sharing"><button class="button ghost" data-action="save">'+icon('save')+'Ontwerp bewaren</button><button class="button ghost" data-action="share">'+icon('share')+'Deellink maken</button></div>');
}

function updatePreviewLabel(){if($('#preview-size'))$('#preview-size').textContent=`${metric(config.width)} × ${metric(config.depth)} m`;}

/**
 * The standpoints the camera can take, split the way a visitor thinks about them: four from the garden
 * side and three from inside. The popover is a small card in the same language as the form's sections —
 * a heading per group and a check on the standpoint you are looking through right now.
 */
const VIEWPOINT_GROUPS=[
 // The opening standpoint looks from the RIGHT since 2.10.7 ("varsayılan konum soldan değil sağdan olsun");
 // 'perspective-right' stays a valid view name for old links and scripts and draws the same picture.
 {title:'Buiten',views:[['perspective','Tuin rechts'],['perspective-left','Tuin links'],['front','Voorgevel'],['top','Van boven']]},
 // 'Doorsnede' (was 'Open doorsnede'): under a drawing that already shows the open box, one word fits a phone tile.
 {title:'Binnen',views:[['interior','Binnen'],['ceiling','Plafond'],['cutaway','Doorsnede']]}];
// Since 2.10.7 each standpoint is a drawing (scene_icons.js): the same aanbouw every time, with the eye moving to
// where the camera will stand — "bakış açıları için de alakalı ikon tasarımı … daklicht penceresindeki gibi".
function viewpointsMenu(){
 return '<div class="viewpoints-menu" id="viewpoints-menu" hidden role="group" aria-label="Standpunten">'+
  VIEWPOINT_GROUPS.map(group=>'<p class="viewpoints-title">'+esc(group.title)+'</p><div class="viewpoints-grid">'+
   group.views.map(([view,label])=>'<button data-view="'+view+'" aria-pressed="false"><span class="viewpoint-check" aria-hidden="true">'+icon('check')+'</span>'+viewpointIcon(view)+'<span class="viewpoint-label">'+esc(label)+'</span></button>').join('')+'</div>').join('')+
  '</div>';
}
/** The name under a camera tool; only the phone's fold-away list shows it, a wider screen has the tooltip. */
function toolLabel(text){return '<span class="tool-label">'+esc(text)+'</span>';}
/** One popover replaces separate view buttons; it closes on choice, outside click or Escape. */
function toggleViewpoints(open) {
 const menu=$('#viewpoints-menu'),button=$('[data-action="viewpoints"]');if(!menu||!button)return;
 const next=open===undefined?menu.hidden:!!open;
 menu.hidden=!next;button.setAttribute('aria-expanded',String(next));button.classList.toggle('active',next);
 // The scene starts on a standpoint nobody clicked, so the popover marks the current one when it opens.
 if(next){closeMaterialCallout();menu.querySelectorAll('[data-view]').forEach(item=>{const selected=item.dataset.view===currentView;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});menu.querySelector('button.active,button')?.focus({preventScroll:true});}
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest?.('.viewpoints'))toggleViewpoints(false);});

/**
 * The card behind the "Materiaal van dichtbij" button. The button used to move the camera and say nothing,
 * so the close-up left you guessing which of the fifteen facades you were looking at. The card names it,
 * repeats the one caveat that matters and offers the way back — the same glass plate as the toolbar itself.
 */
function materialCallout(){
 return '<div class="material-callout" id="material-callout" role="status" hidden>'+
  '<p class="callout-label">Gevelmateriaal van dichtbij</p>'+
  '<p class="callout-name" id="material-callout-name"></p>'+
  '<p class="callout-note">Kleur en structuur in het beeld zijn indicatief.</p>'+
  '<button type="button" class="text-button" data-action="close-material">Terug naar het overzicht'+icon('arrow')+'</button></div>';
}
function openMaterialCallout(){
 const box=$('#material-callout');if(!box)return;
 // Shown first, named second: a live region only announces what changes while it is present.
 materialCloseUp=true;toggleViewpoints(false);box.hidden=false;updateMaterialCallout();
}
function updateMaterialCallout(){const name=$('#material-callout-name');if(name)name.textContent=selectedLabel('facade');}
function closeMaterialCallout(){materialCloseUp=false;const box=$('#material-callout');if(box)box.hidden=true;}
// Dragging the scene orbits away from the close-up, so the card must not keep claiming you are still in it.
document.addEventListener('pointerdown',event=>{if(materialCloseUp&&event.target.closest?.('.preview-scene'))closeMaterialCallout();});

/**
 * Weergave → Kwaliteit. The administrator sets the default (Vormgeving → Weergavekwaliteit 3D); a visitor's own
 * choice is a device setting, kept in this browser only and never part of the design or the quote.
 */
const QUALITY_STORAGE_KEY='cs-prefab-quality-v1';
// On a strong computer Hoog and Snel look almost alike (measured on the live site: 13 % of the pixels change) while Snel
// draws a frame 1.7-2.1× faster — so a click must SAY what it did, or it reads as a button that does nothing
// ("Snel tıklıyorum ama değişmiyor", 2026-09-19). The titles explain the choice before the click, the toast after it.
const QUALITIES=[{id:'auto',label:'Automatisch',title:'De configurator kiest de kwaliteit die bij dit apparaat past'},
 {id:'full',label:'Hoog',title:'Zachte schaduwen, gladde randen en scherpe texturen'},
 {id:'compact',label:'Snel',title:'Lichtere texturen en geen zachte schaduwen: soepeler op oudere computers en telefoons'}];
function qualityToast(choice,tier){
 if(choice==='full')return 'Hoge kwaliteit staat aan: zachte schaduwen, gladde randen en scherpe texturen.';
 if(choice==='compact')return 'Snelle weergave staat aan: lichtere texturen en geen zachte schaduwen. Op een snelle computer zie je weinig verschil; de grafische kaart doet wel tot twee keer minder werk.';
 return 'Automatisch: dit apparaat krijgt '+(tier==='compact'?'de snelle weergave.':'hoge kwaliteit.');
}
let renderQuality='auto';
function storedQuality(){
 try{const stored=localStorage.getItem(QUALITY_STORAGE_KEY);if(QUALITIES.some(quality=>quality.id===stored))return stored;}catch{/* Storage may be unavailable. */}
 return getFeatures().renderQuality||'auto';
}
/**
 * Weergave is a dialog since 2.10.7. The customer (2026-09-19): "weergave varsayılan açık olmasın … önizleme ekranını
 * daraltmak yerine o da diğerleri gibi bir dialogda görsel seçicilerle bezenmiş olabilir". The strip under the picture
 * cost the preview its height and opened by default on a desktop; the dialog opens only on request and draws each
 * choice as a picture, like "Woning en tuin". Every choice keeps the data-action it had in the strip, so the existing
 * handlers serve it unchanged and updateEnvironmentChips() keeps marking the current one.
 */
const APP_ASSET_VERSION=new URL(import.meta.url).searchParams.get('v')||'';
function swatchUrl(file){const url=new URL('./assets/materials/'+file,import.meta.url);if(APP_ASSET_VERSION)url.searchParams.set('v',APP_ASSET_VERSION);return url.href;}
// The scanned floor itself, not a painted guess: the same 512 px maps the compact renderer draws with.
const FLOOR_SWATCHES={laminate:'laminate_floor_diffuse_512.jpg',herringbone:'parquet_herringbone_diffuse_512.jpg',concrete:'concrete_screed_diffuse_512.jpg'};
const QUALITY_NOTES={auto:'Past zich aan dit apparaat aan',full:'Zachte schaduwen en scherpe texturen',compact:'Lichter en soepeler op oudere apparaten'};
function viewPanel(){
 const choice=(action,item,active,picture,note='')=>'<button type="button" class="option-card visual-card view-choice'+(item.id===active?' active':'')+'" data-action="'+action+'" data-'+action+'="'+esc(item.id)+'" aria-pressed="'+(item.id===active)+'"'+(item.title?' title="'+esc(item.title)+'"':'')+'>'+
  '<span class="option-check">'+icon('check')+'</span>'+picture+'<span class="option-title">'+esc(item.label)+'</span>'+(note?'<span class="view-note">'+esc(note)+'</span>':'')+'</button>';
 const grid=(cls,items)=>'<div class="option-grid visual-grid view-grid '+cls+'">'+items+'</div>';
 const toggles=sceneToggles();
 // Two columns on a wide screen, so the whole dialog fits one screen: what the room shows (vloer, inrichting) on the
 // first row, how it is drawn (kwaliteit) and what else is in the picture on the second.
 return '<div class="environment-form view-panel">'+
  '<p class="env-intro">Alleen voor het beeld: je keuzes, leveringsomvang en prijs veranderen er niet van.</p>'+
  '<div class="view-columns">'+
  '<fieldset class="env-block"><legend>Vloer</legend>'+grid('view-grid-3',FLOOR_FINISHES.map(item=>choice('floor-finish',item,environment.floorFinish,'<span class="floor-swatch" style="background-image:url(\''+swatchUrl(FLOOR_SWATCHES[item.id]||FLOOR_SWATCHES.laminate)+'\')"></span>')).join(''))+'</fieldset>'+
  (extraOn('interior')?'<fieldset class="env-block"><legend>Inrichting</legend>'+grid('view-grid-4',SCENARIOS.map(item=>choice('scenario',item,environment.scenario,scenarioIcon(item.id))).join(''))+'</fieldset>':'')+
  '<fieldset class="env-block"><legend>Kwaliteit</legend>'+grid('view-grid-3',QUALITIES.map(item=>choice('render-quality',item,renderQuality,qualityIcon(item.id),QUALITY_NOTES[item.id])).join(''))+'</fieldset>'+
  (toggles?'<fieldset class="env-block"><legend>In het beeld</legend><div class="view-toggles">'+toggles+'</div>'+sceneLegend()+'</fieldset>':'')+
  '</div>'+
  '<div class="view-foot">'+(toggles?'':sceneLegend())+
  '<button type="button" class="chip replay-chip" data-action="replay-underfloor" hidden>'+icon('rotate')+'<span>Vloerverwarming opnieuw tonen</span></button>'+
  '<button type="button" class="text-button" data-action="visual-help">'+icon('info')+'<span>Zo lees je het beeld</span></button></div>'+
  '<div class="env-actions"><button type="button" class="button primary" data-action="close-modal">Klaar</button></div></div>';
}
function openViewDialog(){
 openModal('Weergave',viewPanel(),'view-modal');updateUnderfloorReplay();
 const button=$('[data-action="view-strip"]');button?.setAttribute('aria-expanded','true');button?.classList.add('active');
}
modal.addEventListener('close',()=>{
 const button=$('[data-action="view-strip"]');button?.setAttribute('aria-expanded','false');button?.classList.remove('active');
 // A toast that joined the dialog (toast()) goes back to the page, so it keeps showing out its time.
 const note=$('#toast');if(note?.parentElement===modal)document.body.append(note);
});
/**
 * On a phone the seven camera tools covered the bottom of a picture that is only a third of the screen tall: "mobilde
 * alt ikonların hepsi birden gözükmesin, sandviç menü gibi açılabilirler". Below 800 px they fold behind one menu
 * button and open as a labelled list; any tool closes the list again except Standpunt, whose tiles then take the
 * list's place. On a wider screen the list is display:contents and nothing changes.
 */
function setToolsMenu(open){
 const tools=$('.camera-tools'),toggle=$('[data-action="tools-menu"]');if(!tools||!toggle)return;
 if(tools.classList.contains('open')===open)return;
 tools.classList.toggle('open',open);toggle.setAttribute('aria-expanded',String(open));toggle.classList.toggle('active',open);
 toggle.innerHTML=icon(open?'close':'menu')+'<span class="tools-toggle-label">'+(open?'Sluiten':'Opties')+'</span>';toggle.setAttribute('aria-label',open?'Opties sluiten':'Opties voor het beeld');
 if(!open)toggleViewpoints(false);
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest?.('.camera-tools'))setToolsMenu(false);});
/*
 * 2.10.9, phones only: the preview gives its height to the form while the visitor works in it. Measured before: the
 * form had 309-313 px (37-39 %) of a phone screen. Four reviews agreed on the WHAT; the mechanism is the WebGL one's:
 *  - a SNAP between two heights, taken only when the form has come to rest (no finger down, no scroll tween) — never a
 *    height that follows the scroll, which would resize the canvas every frame and fight iOS momentum;
 *  - in the same frame the form's scrollTop drops by exactly what the preview gave, so nothing moves under the finger;
 *  - back to full size at the top of the form, on a step change (renderStep scrolls to the top), and on anything that
 *    asks to LOOK: "3D bekijken", Buiten/Binnen/Plan, the camera menu, the expand button, fullscreen. After such an
 *    explicit expand the preview stays big until the visitor scrolls again themselves (compactHold).
 * No animation: this happens many times per visit (CLAUDE.md §6, frequency register).
 */
const COMPACT_PREVIEW=150; // px; the CRO review's floor: below ~150 a tapped choice no longer visibly changes anything
// userScrolled: a real gesture moved the form since the last settle — a finger dragging, a wheel, a scroll key.
// 2.11.0, the customer: "önizleme ekranı formda bir alan değiştiğinde ya da navigasyondan ilerlediğimizde otomatik
// küçülüyor … ekranı küçültme formdaki tıklamalarda". A tap on a field redraws the step and restores its scroll
// offset, and the "Naar …" button tweens the form: both fire scroll events without anybody scrolling, and both used
// to shrink the preview. Only a gesture counts now; a tap is not one (touchstart alone no longer clears compactHold).
let previewCompact=false,fingerDown=false,compactHold=false,settleTimer=0,userScrolled=false;
const phoneLayout=()=>matchMedia('(max-width:800px)').matches;
function setPreviewCompact(next,{keepContent=true}={}){
 const card=$('.preview-card'),panel=$('#panel-content');if(!card||!panel)return;
 next=!!next&&phoneLayout()&&!document.fullscreenElement&&!card.classList.contains('expanded');
 if(next===previewCompact)return;
 const before=card.getBoundingClientRect().height;
 previewCompact=next;card.classList.toggle('is-compact',next);
 const delta=before-card.getBoundingClientRect().height;
 // Collapsing moves the form's top up by delta; expanding moves it down. Scrolling by the same amount keeps the
 // content where it was — except at the very top, where there is nothing to scroll and the preview simply returns.
 if(keepContent&&delta)panel.scrollTop=Math.max(0,panel.scrollTop-delta);
 for(const part of card.querySelectorAll('.scene-heading,.preview-toolbar'))part.inert=next;
 if(next){setToolsMenu(false);toggleViewpoints(false);closeMaterialCallout();}
 const expand=$('[data-action="preview-expand"]');if(expand)expand.hidden=!next;
}
function settlePanel(){
 const panel=$('#panel-content'),card=$('.preview-card');if(!panel||!card||fingerDown||scrollTween||!phoneLayout())return;
 if(previewCompact){if(panel.scrollTop<=0)setPreviewCompact(false,{keepContent:false});return;}
 if(!userScrolled)return;
 userScrolled=false;
 const gain=card.getBoundingClientRect().height-COMPACT_PREVIEW;
 // Not worth it on a short phone whose preview is already ~180 px; and only once the form is well past the gain,
 // so the compensated scrollTop stays clear of the top and cannot bounce straight back.
 if(!compactHold&&gain>=60&&panel.scrollTop>gain+48)setPreviewCompact(true);
}
function watchPanelScroll(){
 const panel=$('#panel-content');if(!panel)return;
 const schedule=()=>{clearTimeout(settleTimer);settleTimer=setTimeout(settlePanel,160);};
 const user=()=>{compactHold=false;userScrolled=true;};
 panel.addEventListener('scroll',schedule,{passive:true});
 panel.addEventListener('touchstart',()=>{fingerDown=true;},{passive:true});
 panel.addEventListener('touchmove',()=>{if(fingerDown)user();},{passive:true});
 for(const type of ['touchend','touchcancel'])panel.addEventListener(type,()=>{fingerDown=false;schedule();},{passive:true});
 panel.addEventListener('wheel',user,{passive:true});
 // Scroll keys only, and not while typing: arrows in a number field change the value, they do not scroll.
 panel.addEventListener('keydown',event=>{if(['PageDown','PageUp','End','Home',' '].includes(event.key)&&!event.target.closest?.('input,textarea,select'))user();});
 matchMedia('(max-width:800px)').addEventListener?.('change',event=>{if(!event.matches)setPreviewCompact(false,{keepContent:false});});
}
/*
 * 2.11.0, phones: "önizlemedeki binnen/buiten/plan tek düğme olsun, tıklayınca 3 düğme gözüksün". The three stay
 * in the DOM (every script and handler keeps its [data-scene-view]/[data-mode]); on a phone they fold behind one
 * button that names the current one.
 */
function setModesMenu(open){
 const wrap=$('.scene-modes-wrap'),toggle=$('[data-action="modes-menu"]');if(!wrap||!toggle)return;
 wrap.classList.toggle('open',open);toggle.setAttribute('aria-expanded',String(open));
}
function updateModesToggle(){const active=$('.scene-modes button.active'),label=$('.modes-current');if(label)label.textContent=active?.textContent||'Buiten';}
document.addEventListener('pointerdown',event=>{if(!event.target.closest?.('.scene-modes-wrap'))setModesMenu(false);});
/*
 * 2.11.0, phones: "alttaki butonları da tek menüye düşür". Weergave and volledig scherm move INTO the Opties list
 * on a phone (before Hulp, which stays last) and back into their own plate on a wider screen. The same two nodes
 * move — never copies — so every handler, every aria state and every script's [data-action] still finds exactly one.
 */
function placeViewTools(){
 const list=$('#tool-list'),plate=$('.view-tools'),help=$('#tool-list [data-action="process"]');if(!list||!plate)return;
 const phone=phoneLayout();
 for(const selector of ['[data-action="view-strip"]','[data-action="fullscreen"]']){
  const button=$(selector);if(!button)continue;
  if(phone&&button.parentElement!==list)list.insertBefore(button,help);
  else if(!phone&&button.parentElement!==plate)plate.append(button);
 }
 plate.hidden=phone;
}
/** "Opnieuw beginnen sadece değişiklik varsa gözüksün": the button shows once the design differs from the defaults. */
function designChanged(){
 if(!catalog?.defaults||!config)return false;
 const defaults=catalog.defaults;
 return Object.keys({...defaults,...config}).some(key=>key!=='postcode'&&JSON.stringify(config[key]??null)!==JSON.stringify(defaults[key]??null));
}
function updateResetButton(){const button=$('.reset-header');if(button)button.hidden=!designChanged();}
/*
 * The way back to the website (2.11.0). The customer: "kullanıcının siteye dönebilmesi için bağlantı yok … logoya
 * tıklandığında siteye dönsün … formu kaydedildiğine ve daha sonra devam edilebileceğine dair bilgi verip onayladıktan
 * sonra formdan çıkabilsin … iframe ile gömüyorsa ona göre istediği yere linkleyebilmeli admin kısmından". The address
 * is Vormgeving → Terug naar de website (services/appearance.py exit_link; theme.js safeExitUrl re-checks it).
 */
function exitUrl(){return adminPreview?'':getFeatures().exitUrl||'';}
function setupExit(){
 const brand=$('.brand'),url=exitUrl();if(!brand||adminPreview)return;
 if(url){brand.href=url;brand.dataset.action='exit';brand.setAttribute('aria-label','Prefab Partner — terug naar de website');}
 else{brand.removeAttribute('href');delete brand.dataset.action;}
 // Framed on another website the logo is hidden (the host has its own), so the way back is a header button there.
 if(embedded&&url&&!$('.exit-header'))$('.header-actions')?.insertAdjacentHTML('afterbegin','<button class="button ghost compact exit-header" data-action="exit" aria-label="Terug naar de website">'+icon('back')+'<span>Terug naar de website</span></button>');
}
function openExitDialog(){
 if(!exitUrl())return;
 const saved=persist();
 openModal('Terug naar de website?','<p>'+(saved
  ?'Je ontwerp is op dit apparaat bewaard. Open de configurator later op dit apparaat, dan staat het voor je klaar en kun je verder waar je gebleven was.'
  :'Je ontwerp kon op dit apparaat niet worden bewaard. Wil je later verder, maak dan eerst een deellink via “Delen”.')+'</p>'+
  '<div class="exit-actions"><button type="button" class="button primary" data-action="exit-confirm">Naar de website</button><button type="button" class="button ghost" data-action="close-modal">Verder ontwerpen</button></div>','exit-modal');
}
function leaveConfigurator(){
 const url=exitUrl();if(!url)return;
 persist();
 // In a frame the WHOLE window leaves, not just the frame. Top navigation from a click is allowed for a frame; a
 // sandbox that forbids it throws, and a target=_top link is the fallback the browser may still honour.
 if(embedded&&window.top!==window){
  try{window.top.location.href=url;return;}catch{/* fall through */}
  const link=document.createElement('a');link.href=url;link.target='_top';link.rel='noopener';document.body.append(link);link.click();link.remove();return;
 }
 location.href=url;
}
/** Anything that asks to look at the scene gets the full preview back, and keeps it until the visitor scrolls again. */
function expandPreviewFor(button){
 if(!previewCompact||!button.matches('[data-scene-view],[data-mode],[data-focus-option],[data-action="material-detail"],[data-action="tools-menu"],[data-action="preview-expand"],[data-action="fullscreen"]'))return;
 compactHold=true;setPreviewCompact(false);
}
// Standpunt keeps the list open: on a phone its tiles take the list's place (styles.css), and choosing one closes both.
document.addEventListener('click',event=>{
 const hit=event.target.closest?.('.camera-tools [data-action],.camera-tools [data-view]');
 if(hit&&$('.camera-tools')?.classList.contains('open')&&!['tools-menu','viewpoints'].includes(hit.dataset.action))setToolsMenu(false);
});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 if($('#viewpoints-menu')&&!$('#viewpoints-menu').hidden){toggleViewpoints(false);$('[data-action="viewpoints"]')?.focus();}
 else if($('.camera-tools')?.classList.contains('open')){setToolsMenu(false);$('[data-action="tools-menu"]')?.focus();}
});

/** Piles are a customer preference; the guideline follows the floor area and is confirmed at the site survey. */
function recommendedPiles(area){return area<10?2:area<=15?3:area<=25?4:6;}

/* "Woning & tuin" and the Weergave dialog: a device setting for the picture only, never part of the quote. */
/**
 * The two checkboxes under the beeld. A control whose extra the administrator switched off is not drawn at all —
 * a disabled checkbox that still says "Voorbeeldapparaten tonen" promises something the website no longer does.
 */
function sceneToggles(){
 const box=(setting,checked,label,cls='')=>'<label class="example-toggle'+(cls?' '+cls:'')+'"><input type="checkbox" data-view-setting="'+setting+'"'+(checked?' checked':'')+'><span>'+esc(label)+'</span></label>';
 return (extraOn('fixtures')?box('examples',examplesVisible,'Voorbeeldapparaten tonen'):'')+
  (extraOn('garden')?box('decor',decorVisible,'Tuinaankleding tonen','decor-toggle'):'');
}
/**
 * The legend names only what is actually in the picture, so it never points at something the admin removed.
 * Each part carries its own number, because "Tuin is ter illustratie" and "Voorbeelden zijn ter illustratie" are
 * both single-item sentences and they do not take the same verb.
 */
function sceneLegend(){
 const parts=[extraOn('fixtures')&&['voorbeelden',true],extraOn('garden')&&['tuin',false],extraOn('interior')&&['inrichting',false]].filter(Boolean);
 if(!parts.length)return '';
 const words=parts.map(([word])=>word),naming=words.length===1?words[0]:words.slice(0,-1).join(', ')+' en '+words.at(-1);
 const verb=parts.length>1||parts[0][1]?'zijn':'is';
 return '<span class="scene-legend">'+esc(naming.charAt(0).toUpperCase()+naming.slice(1)+' '+verb+' ter illustratie')+'</span>';
}
function updateEnvironmentChips(){
 for(const [action,value] of [['floor-finish',environment.floorFinish],['scenario',environment.scenario],['render-quality',renderQuality]])document.querySelectorAll('[data-action="'+action+'"]').forEach(button=>{const active=button.getAttribute('data-'+action)===value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 updateUnderfloorReplay();
}
/** The replay button only shows while the design includes underfloor heating; the animation itself lives in the preview. */
function updateUnderfloorReplay(){const button=$('[data-action="replay-underfloor"]');if(button)button.hidden=!(config?.interior&&config?.underfloorHeating);}
/** Called whenever the design changes: a facade set to "zelfde als aanbouw" follows the extension width; the replay chip follows the heating choice. */
function syncEnvironmentWithDesign(){
 const width=config?.width;
 if(Number.isFinite(width)&&environmentWidth!==null&&width!==environmentWidth&&environment.facadeWidth!==null&&environment.facadeWidth<=environmentWidth)applyEnvironment({...environment,facadeWidth:Math.max(FACADE_WIDTH_MIN,width)});
 if(Number.isFinite(width))environmentWidth=width;
 updateUnderfloorReplay();
}
function applyEnvironment(next,{rerenderForm=false}={}){
 // The visitor's own choice is what is stored, exactly as they made it. The admin policy is applied afterwards,
 // on the way to the scene, so switching an extra off never quietly rewrites what this visitor had chosen.
 environment=normalizeEnvironment(next,environmentBase());saveEnvironment(environment);
 syncSceneContent();
 if(rerenderForm){const form=$('#environment-form');if(form){const active=document.activeElement,selector=active?.name?'[name="'+active.name+'"]'+(active.type==='radio'?'[value="'+CSS.escape(active.value)+'"]':''):null;form.outerHTML=environmentPanel();if(selector)$('#environment-form '+selector)?.focus({preventScroll:true});}}
}
/**
 * "Woning en tuin". Since 2.9.3 it is built from the same parts as the form: option tiles with a drawing for the
 * house type, the swatch tiles the Gevelbekleding field uses for the finish, and a field that does not apply
 * explains itself in its own place instead of sitting greyed out under a separate footnote — a disabled control
 * with the reason three lines away is a riddle, not an answer.
 * Every name, id and data attribute the scripts use is unchanged: houseType, facadeWidth, sameWidth, alignment,
 * facadeFinish, renderNeighbours and #env-facade-width; showHouseOpenings joined them in 2.9.6.
 *
 * The two scenery blocks at the end are the visitor's half of the admin show/hide: each is present only while
 * this website offers that extra (scene_content.js).
 */
function environmentPanel(){
 const terraced=environment.houseType==='terraced',detached=environment.houseType==='detached',width=facadeWidthCm(environment,config.width),sameWidth=!terraced&&width===config.width;
 const tile=(name,item,value,inner)=>'<label class="option-card visual-card'+(item.id===value?' selected':'')+'"><input type="radio" name="'+name+'" value="'+esc(item.id)+'" '+(item.id===value?'checked':'')+'><span class="option-check">'+(item.id===value?icon('check'):'')+'</span>'+inner+'<span class="option-title">'+esc(item.label)+'</span></label>';
 const houseTiles='<div class="option-grid visual-grid env-house-grid">'+HOUSE_TYPES.map(item=>tile('houseType',item,environment.houseType,houseTypeIcon(item.id))).join('')+'</div>';
 const fenceTiles='<div class="option-grid visual-grid env-fence-grid">'+FENCE_STYLES.map(item=>tile('fenceStyle',item,environment.fenceStyle,fenceIcon(item.id))).join('')+'</div>';
 const finishTiles='<div class="option-grid visual-grid env-finish-grid">'+FACADE_FINISHES.map(item=>tile('facadeFinish',item,environment.facadeFinish,'<span class="material-swatch '+esc(item.pattern||'')+'" style="--material:'+esc(item.color||'#a6a59e')+'"></span>')).join('')+'</div>';
 const alignChips='<div class="chip-group panel-chips align-chips" role="radiogroup" aria-label="Plaats van de aanbouw">'+ALIGNMENTS.map(item=>'<label class="chip'+(item.id===environment.alignment?' active':'')+'"><input type="radio" name="alignment" value="'+esc(item.id)+'" '+(item.id===environment.alignment?'checked':'')+'>'+alignmentIcon(item.id)+'<span>'+esc(item.label)+'</span></label>').join('')+'</div>';
 const explain=text=>'<p class="env-na">'+esc(text)+'</p>';
 // One shape for both scenery checkboxes, so the label and the hint can only come from the toggle's own copy.
 const checkField=toggle=>'<label class="env-check"><input type="checkbox" name="'+toggle.name+'" '+(environment[toggle.name]?'checked':'')+'><span>'+esc(toggle.label)+'</span></label><p class="env-hint">'+esc(toggle.help)+'</p>';
 // 2.10.7, the customer: "woning tuin dialog ayarları desktopta bile scrollbar çıkıyor … tek ekrana sığdırabilir misin.
 // ayrıca ilişki sıralamasını da yapabilirsin". Six stacked blocks became two columns, and every control now stands
 // next to the one it depends on, in the order a choice ripples through:
 //   type woning → buren (a vrijstaand house has none)  →  gevelbreedte → plaats (only a wider gevel lets it move)
 //   gevelafwerking → straatkant (both: how the existing house itself looks)
 // A rijwoning answers width AND place at once, so it gets one explanation instead of two.
 const widthControls=terraced?explain('Een rijwoning loopt van woningscheidende muur tot muur: de gevel is zo breed als je aanbouw, dus er valt niets in te stellen of te verschuiven.')
  :'<div class="env-width"><input id="env-facade-width" name="facadeWidth" type="number" inputmode="numeric" min="'+FACADE_WIDTH_MIN+'" max="'+FACADE_WIDTH_MAX+'" step="10" value="'+width+'" '+(sameWidth?'disabled':'')+' aria-label="Gevelbreedte in centimeter"><span>cm</span><label class="env-check"><input type="checkbox" name="sameWidth" '+(sameWidth?'checked':'')+'><span>Zelfde als aanbouw</span></label></div>'+
   '<p class="env-hint">'+(sameWidth?'De gevel volgt je aanbouw. Haal het vinkje weg voor een bredere gevel.':'Standaard 1,10 m breder dan je aanbouw ('+FACADE_WIDTH_MIN+' – '+FACADE_WIDTH_MAX+' cm).')+'</p>'+
   '<p class="env-sub">Plaats van de aanbouw in de gevel</p>'+
   (sameWidth?explain('Maak de gevel breder dan je aanbouw om hem te kunnen verschuiven.'):alignChips);
 return '<form id="environment-form" class="environment-form env-compact" novalidate>'+
  '<p class="env-intro">Zo staat je aanbouw in het beeld. Alleen voor de weergave: je keuzes, leveringsomvang en prijs veranderen er niet van.</p>'+
  '<div class="env-columns"><div class="env-column">'+
  '<fieldset class="env-block"><legend>Type woning</legend>'+houseTiles+'<p class="env-hint">'+(terraced?'De aanbouw vult de breedte tussen de woningscheidende muren; de buren lopen door.':environment.houseType==='semi'?'Buren aan de linkerkant; rechts een zijtuin met schutting.':'Geen buren; de tuin is rondom omheind.')+'</p>'+
   // The example-scenery switches are omitted entirely when the administrator switched the extra off: an extra
   // that no longer exists has nothing to explain. A vrijstaand house has no neighbours, and the hint above says so.
   (extraOn('neighbours')&&!detached?'<div class="env-toggle">'+checkField(NEIGHBOUR_TOGGLE)+'</div>':'')+'</fieldset>'+
  '<fieldset class="env-block"><legend>Gevelbreedte van je woning</legend>'+widthControls+'</fieldset>'+
  '</div><div class="env-column">'+
  '<fieldset class="env-block"><legend>Gevelafwerking van je woning</legend><p class="env-hint">Je bestaande woning, niet de gevelbekleding van je aanbouw.</p>'+finishTiles+
   // 2.14.1: the example windows on the street elevation are only drawn — and only worth offering — when the
   // camera may leave the garden side (Vormgeving → Vrij rondkijken). Limited, that elevation is never in frame.
   (extraOn('houseOpenings')&&getFeatures().cameraFreeOrbit?'<div class="env-toggle">'+checkField(HOUSE_OPENINGS_TOGGLE)+'</div>':'')+'</fieldset>'+
  // 2.12.0: the garden boundary, only while this website draws one (Vormgeving → Schutting in de tuin). Whatever the
  // style, a panel that would stand in front of the aanbouw steps aside for the camera (preview.js).
  (getFeatures().gardenFence?'<fieldset class="env-block"><legend>Tuinafscheiding</legend>'+fenceTiles+'<p class="env-hint">Staat een stuk voor je aanbouw, dan verdwijnt het uit beeld.</p></fieldset>':'')+
  '</div></div>'+
  '<div class="env-actions"><button type="button" class="button primary" data-action="close-modal">Klaar</button></div></form>';
}
/** Every control applies immediately; the form is only re-rendered when its own structure changes (type, "zelfde als aanbouw"). */
function environmentFormChanged(target,eventType){
 const form=target.closest('#environment-form');if(!form)return;
 const next={...environment};let rerender=false;
 // Every tile choice re-renders: the selected tile is marked with a class, so without it the tick would stay
 // on the previous choice. Only the width field is left alone — re-rendering under a typing caret is worse.
 if(target.name==='houseType'){next.houseType=target.value;rerender=true;}
 else if(target.name==='alignment'){next.alignment=target.value;rerender=true;}
 else if(target.name==='facadeFinish'){next.facadeFinish=target.value;rerender=true;}
 else if(target.name==='fenceStyle'){next.fenceStyle=target.value;rerender=true;}
 else if(target.name===NEIGHBOUR_TOGGLE.name||target.name===HOUSE_OPENINGS_TOGGLE.name)next[target.name]=target.checked;
 else if(target.name==='sameWidth'){next.facadeWidth=target.checked?Math.max(FACADE_WIDTH_MIN,config.width):null;rerender=true;}
 else if(target.name==='facadeWidth'){
  const value=Number(target.value);
  if(!(Number.isInteger(value)&&value>=FACADE_WIDTH_MIN&&value<=FACADE_WIDTH_MAX)){if(eventType==='change'){target.value=facadeWidthCm(environment,config.width);toast('Kies een gevelbreedte tussen '+FACADE_WIDTH_MIN+' en '+FACADE_WIDTH_MAX+' cm.');}return;}
  next.facadeWidth=value;
 } else return;
 applyEnvironment(next,{rerenderForm:rerender});
}
document.addEventListener('input',e=>{if(e.target.closest?.('#environment-form'))environmentFormChanged(e.target,'input');});
document.addEventListener('change',e=>{if(e.target.closest?.('#environment-form')&&e.target.name==='facadeWidth')environmentFormChanged(e.target,'change');});

function setPreviewMode(mode) {
 const available=preview?.getSceneInfo().webglAvailable!==false;
 currentMode=mode==='3d'&&available?'3d':'2d';preview?.setMode(currentMode);
 document.querySelectorAll('[data-mode]').forEach(button=>{const selected=button.dataset.mode===currentMode;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
 document.querySelectorAll('[data-scene-view]').forEach(button=>{const selected=currentMode==='3d'&&(button.dataset.sceneView==='interior'?['interior','cutaway','ceiling'].includes(currentView):!['interior','cutaway','ceiling'].includes(currentView));button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));button.disabled=!available;});
 document.querySelectorAll('[data-view],[data-focus-option],[data-action="material-detail"],[data-action="roof"],[data-action="reset-camera"]').forEach(button=>button.disabled=currentMode==='2d');
 if(currentMode==='2d')closeMaterialCallout();
 const hint=$('.rotate-hint');if(hint)hint.textContent=currentMode==='3d'?'Sleep om te draaien · scroll om te zoomen':'Plattegrond op schaal';
 updateModesToggle(); // the phone's one "Buiten ▾" button names the mode that is now active
}
function setSceneView(view) {
 currentView=view;closeMaterialCallout();setPreviewMode('3d');preview?.setView(view);
 if(preview?.getSceneInfo().webglAvailable!==false){webglProblem=false;updatePreviewStatus();}
 document.querySelectorAll('[data-view]').forEach(button=>{const selected=button.dataset.view===view;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
 updateResetCameraLabel();
}
/** The roof toggle carries its own state in the glyph: the slab sits on the walls, or it is lifted clear of them. */
/** Framing a detail puts the roof back on (preview.applyCameraFrame); the button has to say so, now that it draws its state. */
function syncRoofButton(){const actual=preview?.getSceneInfo?.().roofVisible;if(typeof actual==='boolean'&&actual!==roofVisible){roofVisible=actual;updateRoofButton();}}
function updateRoofButton(button=$('[data-action="roof"]')){
 if(!button)return;
 button.classList.toggle('active',roofVisible);button.setAttribute('aria-pressed',String(roofVisible));
 button.title=roofVisible?'Dak verbergen':'Dak tonen';
 button.innerHTML=toolIcon(roofVisible?'roof':'roof-off')+toolLabel(button.title);
}
/** The camera reset returns to the full interior view on the interior step, and to the garden view elsewhere. */
function updateResetCameraLabel(){
 const button=$('[data-action="reset-camera"]');if(!button)return;
 const label=step===1?'Terug naar het volledige binnenaanzicht':'Camera herstellen';
 button.setAttribute('aria-label',label);button.title=label;
}
function controlSelector(element){
 if(!element)return null;
 if(element.id)return '#'+CSS.escape(element.id);
 if(element.name)return 'input[name="'+CSS.escape(element.name)+'"][value="'+CSS.escape(element.value)+'"]';
 for(const attribute of ['data-range','data-count','data-adjust','data-focus-option','data-action','data-field','data-dimension'])if(element.hasAttribute(attribute))return '['+attribute+'="'+CSS.escape(element.getAttribute(attribute))+'"]'+(element.hasAttribute('data-delta')?'[data-delta="'+element.dataset.delta+'"]':'');
 const group=element.closest('[data-group]');return element.matches('summary')&&group?'[data-group="'+group.dataset.group+'"] > summary':null;
}
/** Replacing dependent fields must not move a person away from the point they are editing. */
function preservePanelPosition(update){
 const panel=$('#panel-content');if(!panel){update();return;}
 cancelScrollTween(); // Choosing an option in the field the cursor just landed on must not leave a tween writing scrollTop behind us.
 const active=panel.contains(document.activeElement)?document.activeElement:null,selector=controlSelector(active);
 const anchor=active?.closest('.option-card')||active?.closest('[data-field],[data-dimension],[data-group]')||[...panel.querySelectorAll('[data-field],[data-dimension]')].find(el=>el.getBoundingClientRect().bottom>panel.getBoundingClientRect().top);
 const anchorSelector=anchor?.matches('.option-card')&&selector?selector:anchor?.dataset.field?'[data-field="'+anchor.dataset.field+'"]':anchor?.dataset.dimension?'[data-dimension="'+anchor.dataset.dimension+'"]':anchor?.dataset.group?'[data-group="'+anchor.dataset.group+'"]':null;
 const top=anchor?.getBoundingClientRect().top,scroll=panel.scrollTop,windowX=window.scrollX,windowY=window.scrollY;
 update();panel.scrollTop=scroll;
 const replacement=anchorSelector?$(anchorSelector):null,nextAnchor=anchor?.matches('.option-card')?replacement?.closest('.option-card'):replacement;
 if(nextAnchor&&Number.isFinite(top))panel.scrollTop+=nextAnchor.getBoundingClientRect().top-top;
 if(active&&!active.isConnected&&selector){const next=$(selector);(next?.disabled?next.closest('[data-unavailable]'):next)?.focus({preventScroll:true});}
 if(window.scrollX!==windowX||window.scrollY!==windowY)window.scrollTo(windowX,windowY);
}
function renderErrors(){
 for(const node of document.querySelectorAll('#panel-content .field-error')){
  const key=node.id.replace(/-error$/,'');node.textContent=errors[key]||'';
  const control=$('#'+CSS.escape(key));if(control){if(errors[key])control.setAttribute('aria-invalid','true');else control.removeAttribute('aria-invalid');}
 }
}
function refreshFields(keys){
 preservePanelPosition(()=>{for(const key of keys){const field=$('[data-field="'+CSS.escape(key)+'"]');if(field)field.outerHTML=renderField(key);}});
 document.querySelectorAll('[data-focus-option],[data-action="material-detail"]').forEach(button=>button.disabled=currentMode==='2d');
 observeChoices();markOpenGroupSeen(currentOpenGroup()); // The replaced nodes are new elements; the old ones were being watched.
}
function updateResolvedScope() {
 preview?.setScope?.(!pricePending&&!priceError?price?.scope||[]:[]);
 if(!pricePending&&!priceError&&price?.allowedPositions){
  refreshFields(Object.keys(price.allowedPositions));
 }
 preservePanelPosition(()=>{const scope=$('#scope-content');if(scope)scope.innerHTML=renderScope();
 // Only a note whose state really changed is touched: an unchanged note keeps its node (and its open explanation),
 // so a price answer that confirms what was already on screen moves nothing.
 document.querySelectorAll('[data-field]').forEach(container=>{
  const key=container.dataset.field,note=container.querySelector('.field-scope'),state=scopeState(key);
  if((note?.dataset.state||null)===state)return;
  note?.remove();if(state)placeScope(container,scopeLine(key));
 });});renderErrors();
}

function persist(){
 if(adminPreview)return false;
 try{savedAt=new Date();localStorage.setItem(STORAGE_KEY,JSON.stringify({version:catalog.schemaVersion,config:{...config,postcode:''},savedAt:savedAt.toISOString()}));if($('#save-status'))$('#save-status').textContent=`Op dit apparaat bewaard om ${savedAt.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`;return true;}catch{if($('#save-status'))$('#save-status').textContent='Opslaan op dit apparaat niet beschikbaar. Gebruik een deellink.';return false;}
}

function resetDesign(){
 if(!catalog)return;
 designGeneration++;priceSequence++;comparisonSequence++;catalogReadSequence++;
 clearTimeout(priceTimer);for(const controller of activeRequests)controller.abort();activeRequests.clear();
 config=structuredClone(catalog.defaults);price=null;pricePending=true;priceError='';catalogChanged=false;
 contact={};result=null;requestKey=null;submitting=false;errors={};savedAt=null;step=0;
 comparison={A:null,B:null};comparisonOpen=false;comparisonBusy=false;comparisonError='';comparisonPrices=null;
 // Starting over returns the extras to what THIS website offers, not to what the configurator ships with.
 const startWith=environmentBase();
 dimensionsVisible=false;roofVisible=true;examplesVisible=startWith.fixtures;decorVisible=startWith.garden;currentView='perspective';
 expandedGroups.clear();expandedGroups.add('dimensions');expandedGroups.add('facade');
 if(!adminPreview){try{localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(COMPARISON_STORAGE_KEY);}catch{/* Reset still works when browser storage is unavailable. */}}
 const url=new URL(location.href);url.searchParams.delete('share');history.replaceState({},'',url.pathname+url.search+url.hash);
 if(modal.open)modal.close();$('#modal-content').replaceChildren();lastFocus=null;
 clearTimeout(toast.timer);$('#toast').classList.remove('visible');
 $('.preview-card')?.classList.remove('expanded');if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
 preview?.setPlacement?.(null);preview?.setScope?.([]);preview?.update(config);
 preview?.setDimensions(false);preview?.setRoofVisible(true);
 // "Woning & tuin" and the indicative chips return to their defaults with the design.
 environment=normalizeEnvironment(null,startWith);environmentWidth=null;if(!adminPreview){try{localStorage.removeItem(ENVIRONMENT_STORAGE_KEY);}catch{/* Storage may be unavailable. */}}
 syncSceneContent({force:true});preview?.setFloorFinish?.(environment.floorFinish);syncScenario();syncEnvironmentWithDesign();updateEnvironmentChips();
 document.querySelectorAll('[data-view-setting="examples"]').forEach(input=>input.checked=examplesVisible);
 document.querySelectorAll('[data-view-setting="decor"]').forEach(input=>input.checked=decorVisible);
 document.querySelectorAll('[data-action="dimensions"]').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false');});
 updateRoofButton();closeMaterialCallout();
 webglProblem=preview?.getSceneInfo().webglAvailable===false;setSceneView('perspective');updatePreviewStatus();
 updatePreviewLabel();renderStep(true);schedulePrice(true);preview?.resize();
 toast('Je begint opnieuw met de standaardkeuzes.');
}

function schedulePrice(immediate=false) {
 if($('#toast').dataset.kind==='error')$('#toast').classList.remove('visible');
 // The 3D keeps the last confirmed scope until the new answer arrives (updateResolvedScope). Emptying it here made
 // every +/− rebuild the fixtures twice — once as bare placeholders, once as they were — a visible blink per click.
 const sequence=++priceSequence;pricePending=true;priceError='';errors={};catalogChanged=false;renderErrors();renderFooter();clearTimeout(priceTimer);
 priceTimer=setTimeout(async()=>{
  try {
   const data=await api('/price',{config,catalogRevision:catalog.catalogRevision});if(sequence!==priceSequence)return;
   price=data;pricePending=false;priceError='';errors={};
   const normalized=data.config?normalizedDraft(data.config,catalog):config;
   const changed=Object.keys(config).filter(key=>JSON.stringify(config[key])!==JSON.stringify(normalized[key]));
   if(changed.length){config=normalized;preview?.update(config);persist();preservePanelPosition(()=>renderStep());toast('Je keuzes zijn aangepast aan de beschikbare ruimte en de bijbehorende voorzieningen.');}
   preview?.setPlacement?.(data.fixtureLayout||null);renderFooter();updateResolvedScope();
  } catch(error) {
   if(sequence!==priceSequence)return;
   pricePending=false;priceError=error.message;errors=error.fields||{};catalogChanged=error.code==='catalog_changed';
   if(catalogChanged)invalidateComparison();
   renderErrors();renderFooter();updateResolvedScope();toast(error.message,{kind:'error'});
  }
 },immediate?0:260);
}

function changeConfig(key,value,{rerender=true}={}) {
 seen().add(key); // Touching a control is the other way a choice retires; renderFooter() below reads the new set.
 const url=new URL(location.href);if(url.searchParams.has('share')){url.searchParams.delete('share');history.replaceState({},'',url.pathname+url.search+url.hash);}
 const previousArea=config.width*config.depth/10000;
 config=normalizeInterior({...config,[key]:value},catalog.defaults);result=null;requestKey=null;errors={};
 // The pile count follows the area guideline until the customer picks a different number themselves.
 if(['width','depth'].includes(key)&&config.piles===recommendedPiles(previousArea))config.piles=recommendedPiles(config.width*config.depth/10000);
 preview?.setPlacement?.(null);
 if(validDimensions(config,catalog))preview?.update(config);
 updatePreviewLabel();persist();schedulePrice();syncEnvironmentWithDesign();syncSelectableKeys();
 if(rerender)preservePanelPosition(()=>renderStep());
 else {refreshFields(['frontOpening','rooflight']);renderErrors();}
 // Exterior choices frame what changed; the interior camera stays put — "3D bekijken" is the explicit way to zoom in.
 // "Geen overstek" is one of the four pictures being compared (2.17.0: every overstek choice from the same standing
 // view), so it frames like the others instead of leaving the camera wherever the previous card had put it.
 if(currentMode==='3d'&&['facade','frontOpening','rooflight','roofShade','overhang','outsideLight','outsideSocket','outsideTap'].includes(key)&&(key==='overhang'||(value!==false&&value!=='none'))){
  // Comparing facades from close up is the whole point of the close-up: picking the next one must not pull the
  // camera back out. The rebuild re-applies the same frame (preview.refreshCameraFocus), so only the name changes.
  if(materialCloseUp&&key==='facade')updateMaterialCallout();
  else{closeMaterialCallout();preview?.focusOption?.(key,{automatic:true});currentView=preview?.getSceneInfo().view||currentView;}
 }
}
function commitDimension(key,raw,{rerender=true}={}){
 const limits=dimensionLimits(config,catalog,key),value=dimensionValue(raw,limits);
 if(value===null){const input=$('#'+key);if(input)input.value=config[key];toast('Vul een maat in tussen '+limits.min+' en '+limits.max+' cm.');return;}
 const corrected=Number(raw)!==value;
 changeConfig(key,value,{rerender});
 const input=$('#'+key),range=$('[data-range="'+key+'"]');if(input)input.value=value;
 if(range){range.value=value;range.style.setProperty('--fill',((value-limits.min)/Math.max(1,limits.max-limits.min)*100)+'%');range.setAttribute('aria-valuetext',value+' centimeter');}
 for(const button of document.querySelectorAll('[data-adjust="'+key+'"]'))button.disabled=Number(button.dataset.delta)<0?value<=limits.min:value>=limits.max;
 if($('#area-number'))$('#area-number').textContent=(config.width*config.depth/10000).toLocaleString('nl-NL',{maximumFractionDigits:2})+' m²';
 if(corrected)toast('Maat aangepast naar '+value+' cm. '+(limits.sources.length?'Je gekozen pui of daklicht vraagt dit bereik. Kies een andere uitvoering voor een kleinere maat.':'Beschikbaar bereik: '+limits.min+'–'+limits.max+' cm.'));
}
function goStep(next){
 if(next===step)return;
 if(!validDimensions(config,catalog)){toast('Controleer eerst de afmetingen.');return;}
 step=Math.max(0,Math.min(STEPS.length-1,next));if(step===1){expandedGroups.add('finish');if(currentMode==='3d')setSceneView('interior');}else if(step===0&&currentMode==='3d')setSceneView('perspective');else if(step===2)expandedGroups.add('site');renderStep(true);
 embedBridge?.step(step,STEPS[step].label);
}

function renderComparison() {
 const ready=!!comparison.A&&!!comparison.B;
 const table=(rows,caption)=>'<table class="comparison-table"><caption>'+esc(caption)+'</caption><thead><tr><th scope="col">Keuze</th><th scope="col">Ontwerp A</th><th scope="col">Ontwerp B</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+esc(row.label)+'</th><td>'+esc(row.a)+'</td><td>'+esc(row.b)+'</td></tr>').join('')+'</tbody></table>';
 let outcome='';
 if(comparisonPrices){
  const delta=comparisonPrices.B.total-comparisonPrices.A.total,rows=comparisonRows(comparison.A,comparison.B,catalog);
  const scopes=new Map();for(const slot of ['A','B'])for(const row of comparisonPrices[slot].scope||[]){if(!scopes.has(row.key))scopes.set(row.key,{label:row.label});scopes.get(row.key)[slot]=row;}
  const status={included:'inbegrepen',extra:'apart berekend',excluded:'niet inbegrepen'};
  const describe=row=>row?row.quantity+'× · '+row.components.map(part=>part.label+': '+(part.status==='extra'&&part.total<0?'minderprijs':status[part.status]||part.status)+(part.status==='extra'?' ('+preciseMoney(part.total||0)+')':'')).join('; '):'Niet gekozen';
  const scopeRows=[...scopes.values()].map(row=>({label:row.label,a:describe(row.A),b:describe(row.B)}));
  outcome='<div class="comparison-outcome"><p class="comparison-note">Beide ontwerpen zijn opnieuw berekend met de huidige catalogus.</p>'+table([{label:'Totaal incl. btw',a:money(comparisonPrices.A.total),b:money(comparisonPrices.B.total)},...rows],'Prijs en verschillen')+'<p class="comparison-difference">'+(delta===0?'Beide ontwerpen hebben dezelfde prijs.':'Ontwerp B is '+money(Math.abs(delta))+' '+(delta>0?'duurder':'voordeliger')+' dan A.')+'</p>'+(rows.length?'':'<p class="comparison-note">De zichtbare keuzes zijn gelijk.</p>')+'<details class="comparison-scope"><summary>Leveringsomvang vergelijken</summary>'+table(scopeRows,'Onderdelen per ontwerp')+'</details><div class="comparison-use"><button class="button ghost" data-comparison-use="A">Verder met A</button><button class="button ghost" data-comparison-use="B">Verder met B</button></div></div>';
 }
 return '<details class="comparison-panel" '+(comparisonOpen?'open':'')+'><summary><span>Twee ontwerpen vergelijken</span>'+icon('copy')+'</summary><p class="comparison-note">Bewaar een variant als A, pas je ontwerp aan en bewaar de tweede variant als B.</p><div class="comparison-slots">'+['A','B'].map(slot=>'<div><span><strong>Ontwerp '+slot+'</strong><small>'+ (comparison[slot]?metric(comparison[slot].width)+' × '+metric(comparison[slot].depth)+' m':'Nog geen ontwerp')+'</small></span><button class="text-button" data-comparison-save="'+slot+'">'+(comparison[slot]?'Vervang door huidig ontwerp':'Bewaar huidig ontwerp')+'</button></div>').join('')+'</div><button class="button ghost comparison-refresh" data-action="compare-refresh" '+(!ready||comparisonBusy?'disabled':'')+'>'+icon('copy')+(comparisonBusy?'Beide ontwerpen berekenen…':'Vergelijk A en B')+'</button>'+(comparisonError?'<p class="api-error" role="alert">'+esc(comparisonError)+'</p>':'')+outcome+'<p class="comparison-note">Alleen op dit apparaat. Vergelijken verandert je huidige ontwerp niet.</p></details>';
}
function updateComparison(){const container=$('#comparison-content');if(container)container.innerHTML=renderComparison();}
function invalidateComparison(){comparisonPrices=null;comparisonSequence++;comparisonBusy=false;comparisonError='De catalogus is gewijzigd. Vergelijk opnieuw om de actuele prijzen te bekijken.';updateComparison();}
function persistComparison(){
 if(adminPreview)return false;
 try{localStorage.setItem(COMPARISON_STORAGE_KEY,JSON.stringify({version:catalog.schemaVersion,...Object.fromEntries(['A','B'].map(slot=>[slot,comparison[slot]?{config:comparison[slot]}:null]))}));return true;}catch{return false;}
}
function saveComparison(slot){
 if(adminPreview||!['A','B'].includes(slot))return;
 comparison[slot]=normalizedDraft(config,catalog);comparisonSequence++;comparisonPrices=null;comparisonError='';comparisonBusy=false;comparisonOpen=true;
 const saved=persistComparison();updateComparison();$('[data-comparison-save="'+slot+'"]')?.focus({preventScroll:true});toast(saved?'Je huidige ontwerp is bewaard als '+slot+'.':'Ontwerp '+slot+' blijft beschikbaar zolang dit venster open is.');
}
async function refreshComparison(){
 if(adminPreview||!comparison.A||!comparison.B)return;
 const sequence=++comparisonSequence,snapshots=structuredClone(comparison),restoreFocus=document.activeElement?.dataset.action==='compare-refresh';comparisonBusy=true;comparisonError='';comparisonPrices=null;comparisonOpen=true;updateComparison();
 try{
  const catalogSequence=++catalogReadSequence,currentCatalog=await api('/catalog');if(sequence!==comparisonSequence||catalogSequence!==catalogReadSequence)return;
  if(currentCatalog.catalogRevision!==catalog.catalogRevision){catalog=currentCatalog;fields=fieldsOf(catalog);config=normalizedDraft(config,catalog);result=null;requestKey=null;preview?.setPlacement?.(null);preview?.update(config);persist();renderStep();schedulePrice(true);}
  const revision=currentCatalog.catalogRevision;
  const values=await Promise.all(['A','B'].map(slot=>api('/price',{config:normalizedDraft(snapshots[slot],currentCatalog),catalogRevision:revision})));
  if(sequence!==comparisonSequence)return;
  if(values.some(value=>value.catalogRevision&&value.catalogRevision!==revision))throw new Error('De catalogus is tijdens het vergelijken gewijzigd. Vergelijk opnieuw.');
  comparison={A:normalizedDraft(values[0].config,currentCatalog),B:normalizedDraft(values[1].config,currentCatalog)};
  comparisonPrices={A:values[0],B:values[1],revision};persistComparison();
 }catch(error){if(sequence!==comparisonSequence)return;comparisonError=error.code==='catalog_changed'?'De catalogus is gewijzigd. Vergelijk opnieuw om beide actuele prijzen te bekijken.':error.message;}
 finally{if(sequence===comparisonSequence){comparisonBusy=false;updateComparison();if(restoreFocus&&document.activeElement===document.body)$('[data-action="compare-refresh"]')?.focus({preventScroll:true});}}
}
function useComparison(slot){
 if(adminPreview||!comparison[slot]||!comparisonPrices)return;
 config=normalizedDraft(comparison[slot],catalog);result=null;requestKey=null;errors={};
 const url=new URL(location.href);url.searchParams.delete('share');history.replaceState({},'',url.pathname+url.search+url.hash);
 preview?.setPlacement?.(null);preview?.update(config);updatePreviewLabel();persist();renderStep();schedulePrice(true);toast('Je werkt nu verder met ontwerp '+slot+'.');
}
/**
 * Which fields a click in the 3D scene can open right now. The preview only highlights and only answers clicks for
 * these, so every object that shows the pointer cursor really does move the form — no dead spots.
 * An interior field with "Aanbouw binnen" still off is not dead: the click opens that gate instead (see below).
 */
/**
 * Which fields a click in the 3D scene can open right now. The preview highlights and answers clicks only for these,
 * so every object that shows the pointer cursor really does move the form — no dead spots.
 * An interior field with "Aanbouw binnen" still off is not dead: the click opens that gate instead (sceneTarget).
 */
function selectableSceneKeys(){
 const keys=[...new Set(groups.flat().flatMap(group=>group.keys).concat('interior'))];
 return keys.filter(key=>fields[key]&&(fieldIsVisible(key,config,fields)||(INTERIOR_FIELDS.includes(key)&&fieldIsVisible('interior',config,fields))));
}
function syncSelectableKeys(){preview?.setSelectableKeys?.(selectableSceneKeys());}
/** The field a tagged object really opens: position fields carry the count, hidden interior fields open their gate. */
function sceneTarget(key){
 const actual=({ceilingLights:'ceilingPositions',spotlights:'spotPositions',sockets:'socketPositions'})[key]||key;
 // The inside of a bare shell: the finish fields stay hidden until the customer chooses to have the interior done,
 // so the click opens that choice instead of doing nothing at all.
 return INTERIOR_FIELDS.includes(actual)&&!config.interior?'interior':actual;
}
function selectSceneOption(key){
 const actual=sceneTarget(key);
 const targetStep=actual==='interior'?1:groups.findIndex(items=>items.some(group=>group.keys.includes(actual)));
 if(targetStep<0||!fieldIsVisible(actual,config,fields))return;
 const group=groups[targetStep].find(item=>item.keys.includes(actual));
 if(group)expandedGroups.add(group.id);
 step=targetStep;renderStep();
 const field=$('[data-field="'+CSS.escape(actual)+'"]');if(!field)return;
 const panel=$('#panel-content');panel.scrollTop+=field.getBoundingClientRect().top-panel.getBoundingClientRect().top-12;
 const focus=field.querySelector('input:checked:not(:disabled)')||field.querySelector('input:not(:disabled)')||field.querySelector('button:not(:disabled)');focus?.focus({preventScroll:true});
}
function focusSceneOption(key){
 if(!preview||preview.getSceneInfo().webglAvailable===false)return;
 closeMaterialCallout();
 setPreviewMode('3d');preview.focusOption?.(key);currentView=preview.getSceneInfo().view||currentView;setPreviewMode('3d');syncRoofButton();
}
function updatePreviewStatus(){
 const status=$('#preview-status');if(!status)return;
 const available=preview?.getSceneInfo().webglAvailable!==false;
 status.hidden=!webglProblem;
 if(webglProblem)status.innerHTML=available?'3D is weer beschikbaar. <button data-scene-view="perspective">Bekijk in 3D</button>':'3D is tijdelijk niet beschikbaar. Je kunt je ontwerp in 2D blijven aanpassen.';
}
function priceBreakdown(){
 if(!price||pricePending||priceError){toast('Wacht tot de berekening is afgerond.');return;}
 openModal(demoPricing()?'Je voorbeeldprijs, uitgelegd':'Je prijsopbouw',`<p class="notice">${esc(pricingDisclaimer())}</p><div class="breakdown-list">${price.lines.map(line=>`<div><span>${esc(line.label)}<small>${line.quantity} ${esc(line.unit)}</small></span><strong>${preciseMoney(line.total)}</strong></div>`).join('')}<div><span>Subtotaal excl. btw</span><strong>${preciseMoney(price.subtotal)}</strong></div><div><span>Btw ${price.vatRate}%</span><strong>${preciseMoney(price.vat)}</strong></div><div class="breakdown-total"><span>Totaal incl. btw</span><strong>${preciseMoney(price.total)}</strong></div></div><p class="muted">Prijsboek: ${esc(price.pricebookVersion)}. Definitieve prijs na controle van de locatie, constructie en commerciële prijsafspraken.</p>${price.warnings?.length?`<ul class="warnings">${price.warnings.map(x=>`<li>${esc(typeof x==='string'?x:x.message)}</li>`).join('')}</ul>`:''}`);
}
function contactForm(){
 if(adminPreview){toast('Dit concept is alleen beschikbaar voor controle. Publiceer de catalogus voordat klanten een voorstel kunnen maken.');return;}
 if(result){showResult();return;}
 const inputs=[['firstName','Voornaam','given-name','text'],['lastName','Achternaam','family-name','text'],['email','E-mailadres','email','email'],['phone','Telefoonnummer','tel','tel'],['address','Straat','address-line1','text'],['houseNumber','Huisnummer','address-line2','text'],['postcode','Postcode','postal-code','text'],['city','Woonplaats','address-level2','text']];
 openModal('Maak je persoonlijke voorstel',`<p>Bewaar je ontwerp en berekening als persoonlijk PDF-voorstel. Je aanvraag wordt in deze omgeving geregistreerd.</p><form id="quote-form" novalidate><div class="contact-grid">${inputs.map(([key,label,autocomplete,type])=>`<div class="contact-field"><label for="contact-${key}">${label} <span>*</span></label><input id="contact-${key}" name="${key}" type="${type}" autocomplete="${autocomplete}" maxlength="${key==='houseNumber'?20:key==='postcode'?7:120}" required value="${esc(contact[key]||'')}" ${key==='postcode'?'placeholder="1234 AB"':''} aria-describedby="contact-error-${key}"><p class="field-error" id="contact-error-${key}"></p></div>`).join('')}</div><div class="contact-field"><label for="contact-message">Opmerking <span class="optional">optioneel</span></label><textarea id="contact-message" name="message" rows="3" maxlength="2000" placeholder="Vertel gerust iets over je plannen…">${esc(contact.message||'')}</textarea></div><label class="consent"><input type="checkbox" name="consent" required ${contact.consent?'checked':''}><span>Ik geef toestemming om mijn gegevens voor dit voorstel te verwerken. <button type="button" data-action="privacy-inline">Privacygegevens</button></span></label><p id="contact-error-consent" class="field-error"></p><div id="quote-error" class="api-error" role="alert"></div><button type="submit" class="button primary submit-button">Voorstel opslaan & PDF maken ${icon('arrow')}</button><p class="form-note">Geen betaling. Er wordt vanuit de lokale demo geen e-mail verzonden.</p></form>`);
 $('#quote-form').addEventListener('input',e=>{const key=e.target.name;if(!key)return;contact[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;const valid=key==='consent'?contact.consent:!validateContact(contact)[key];if(valid){e.target.removeAttribute('aria-invalid');const error=$('#contact-error-'+CSS.escape(key));if(error)error.textContent='';}});
 $('#quote-form').addEventListener('submit',submitQuote);
}
async function submitQuote(e){
 e.preventDefault();if(submitting)return;
 if(adminPreview)return;
 const form=e.currentTarget;for(const [key,value] of new FormData(form))contact[key]=typeof value==='string'?value.trim():value;contact.consent=form.elements.consent.checked;
 const validation=validateContact(contact);if(!contact.consent)validation.consent='Geef toestemming om je voorstel te kunnen bewaren.';
 form.querySelectorAll('.field-error').forEach(el=>el.textContent='');form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
 if(Object.keys(validation).length){for(const [key,message] of Object.entries(validation)){const el=$(`#contact-error-${key}`);if(el)el.textContent=message;form.elements[key]?.setAttribute('aria-invalid','true');}form.elements[Object.keys(validation)[0]]?.focus();return;}
 submitting=true;const button=form.querySelector('[type="submit"]');button.disabled=true;form.querySelector('#quote-error').textContent='';
 let progress=form.querySelector('#quote-progress');
 if(!progress){progress=document.createElement('p');progress.id='quote-progress';progress.className='form-note';progress.setAttribute('role','status');button.insertAdjacentElement('afterend',progress);}
 const updateProgress=(label,detail='')=>{if(form.isConnected){button.textContent=label;progress.textContent=detail;}};
 updateProgress('Je ontwerp wordt gecontroleerd…');
 const payloadContact={firstName:contact.firstName,lastName:contact.lastName,name:`${contact.firstName} ${contact.lastName}`,email:contact.email,phone:contact.phone,postcode:contact.postcode,houseNumber:contact.houseNumber,address:contact.address,city:contact.city,message:contact.message||''};
 // Freeze the submitted design before any network or rendering work; the live design stays editable.
 const submittedConfig=JSON.stringify(config),snapshotConfig=JSON.parse(submittedConfig);
 const fingerprint=JSON.stringify([snapshotConfig,payloadContact]);if(!requestKey||requestKey.fingerprint!==fingerprint)requestKey={fingerprint,key:crypto.randomUUID()};
 const attempt=requestKey,generation=designGeneration,current=()=>generation===designGeneration;
 try{
  if(!attempt.config){const checked=await api('/price',{config:snapshotConfig,catalogRevision:catalog.catalogRevision});if(!current())return;attempt.config=checked.config;attempt.scope=checked.scope||[];attempt.fixtureLayout=checked.fixtureLayout;attempt.catalogRevision=checked.catalogRevision||catalog.catalogRevision;}
  if(!attempt.visuals){
   updateProgress('Je ontwerpbeelden worden gemaakt…','We leggen drie ruimtelijke aanzichten, de plattegrond en twee gevelaanzichten vast.');
   const {captureDocumentViews}=await import('./document_capture.js');
   if(!current())return;
   // The live preview lends its measured tier and frees its post-processing targets while the second context renders.
   // The proposal images take the visitor's house and garden setting, clamped by the admin policy like everything
   // else. `documentMode` already drops the furniture, the tuin and the neighbours from every proposal view, and
   // the straatgevel is in none of the six frames, so in practice only the house type and finish survive here —
   // but it is clamped anyway, so there is one rule for what the scene may contain and not two.
   const stored=loadEnvironment(undefined,environmentBase()),allowed=sceneState(scenePolicy,stored);
   const captured=await captureDocumentViews(attempt.config,{scope:attempt.scope,fixtureLayout:attempt.fixtureLayout,
    environment:{...stored,renderNeighbours:allowed.renderNeighbours,scenario:allowed.scenario,showHouseOpenings:allowed.showHouseOpenings},
    livePreview:preview});
   if(!current())return;
   if(!['plan','front','side'].every(id=>captured.views.some(view=>view.id===id)))throw new Error('De technische tekeningen konden niet volledig worden gemaakt. Probeer het opnieuw.');
   attempt.visuals=captured;
  }
  const missing3D=attempt.visuals.missingViews.some(id=>['perspective-left','perspective-right','interior'].includes(id));
  updateProgress('Je voorstel wordt bewaard…',missing3D?'3D is hier niet beschikbaar. De beschikbare technische tekeningen worden toegevoegd.':`${attempt.visuals.views.length} ontwerpbeelden en je keuzes worden aan je voorstel toegevoegd.`);
  const received=await api('/quote',{config:attempt.config,contact:payloadContact,consent:true,idempotencyKey:attempt.key,visuals:attempt.visuals,catalogRevision:attempt.catalogRevision},{timeoutMs:45000});
  if(!current())return;
  const record={...received,documentViewCount:attempt.visuals.views.length,documentMissingViews:attempt.visuals.missingViews};
  if(JSON.stringify(config)===submittedConfig)result=record;
  showResult(record);
 }
 catch(error){if(!current())return;if(error.code==='catalog_changed'){catalogChanged=true;priceError=error.message;pricePending=false;invalidateComparison();renderFooter();updateResolvedScope();}const errorBox=form.querySelector('#quote-error');if(form.isConnected&&modal.open){errorBox.textContent=error.message;progress.textContent='Je ingevulde gegevens zijn behouden.';for(const[key,message]of Object.entries(error.fields||{})){const normalized=key.replace(/^contact\./,'');const el=form.querySelector(`#contact-error-${CSS.escape(normalized)}`);if(el)el.textContent=message;}}else toast(`Voorstel niet opgeslagen: ${error.message}`);button.disabled=false;button.innerHTML=`Opnieuw proberen ${icon('arrow')}`;}
 finally{if(current())submitting=false;}
}
function showResult(record=result){
 const missing3D=record.documentMissingViews?.some(id=>['perspective-left','perspective-right','interior'].includes(id));
 const documentNote=missing3D?'De beschikbare technische tekeningen zijn toegevoegd. Deze browser kon de 3D-aanzichten niet vastleggen.':record.documentViewCount?'Inclusief 3D-aanzichten, een plattegrond met maatvoering en gevelaanzichten.':'';
 openModal('Je ontwerp is bewaard.',`<div class="success-state"><div class="success-icon">${icon('check')}</div><h3>Je persoonlijke voorstel staat klaar</h3><p>Je voorstel <strong>${esc(record.reference)}</strong> is geregistreerd. Download de PDF met je keuzes en berekening.</p>${documentNote?`<p class="document-status">${esc(documentNote)}</p>`:''}<a class="button primary" href="${esc(record.pdfUrl)}" download>Download mijn voorstel ${icon('download')}</a><p class="notice">Er is geen e-mail verzonden vanuit deze lokale omgeving. Bewaar de PDF; de commerciële prijs en technische uitvoering vragen nog bevestiging.</p><button class="text-button" data-action="close-modal">Terug naar mijn ontwerp</button></div>`);
 // The host page may want to show its own confirmation or count the conversion without reaching
 // into the frame. Only the reference travels; no contact data crosses the boundary.
 embedBridge?.submitted(record.reference);
}
async function share(){
 if(adminPreview){toast('Een conceptcatalogus kan niet met klanten worden gedeeld.');return;}
 if(!validDimensions(config,catalog)){toast('Controleer eerst de afmetingen.');return;}
 const generation=designGeneration;
 try{const data=await api('/share',{config,catalogRevision:catalog.catalogRevision});if(generation!==designGeneration)return;const link=new URL(data.url||`/prefab?share=${encodeURIComponent(data.token)}`,location.origin).href;
 openModal('Deel je ontwerp',`<p>Met deze link bekijk je dit ontwerp op elk apparaat. Je contactgegevens staan er niet in.</p><label class="share-label" for="share-url">Link naar jouw ontwerp</label><div class="share-input"><input id="share-url" readonly value="${esc(link)}"><button class="button primary" data-action="copy-link">${icon('copy')} Kopiëren</button></div><p class="muted">Wie de link heeft, kan deze versie van je ontwerp bekijken. Bewerkingen worden als een eigen ontwerp opgeslagen.</p>`);
 }catch(error){if(generation===designGeneration)toast(`Delen is niet gelukt: ${error.message}`);}
}
/**
 * The help behind the info button. Three numbered cards in the same language as the form sections, followed by a
 * legend of the buttons that float over the scene — the icons were redrawn in 2.9.3 and this is where a visitor
 * can read what each one does instead of hovering seven times to find out.
 */
// The legend draws each tool with the SAME picture as its button (scene_icons.js since 2.10.7): one concept, one
// drawing, wherever it appears.
const TOOL_LEGEND=[
 [toolIcon('viewpoints'),'Standpunten','Kies van welke kant je kijkt: uit de tuin, van voren, van boven of van binnen.'],
 [toolIcon('environment'),'Woning en tuin','Stel in hoe je bestaande woning en de tuin eromheen worden getekend.'],
 [toolIcon('material-detail'),'Materiaal van dichtbij','Zoom in op de gevelbekleding die je gekozen hebt.'],
 [toolIcon('process'),'Hulp','Dit venster.'],
 [toolIcon('dimensions'),'Maatlijnen','Zet de maten in het beeld aan of uit.'],
 [toolIcon('roof'),'Dak tonen of verbergen','Haal het dak eraf om in de ruimte te kijken.'],
 [toolIcon('reset-camera'),'Camera herstellen','Terug naar het standaardstandpunt.'],
 [icon('sliders'),'Weergave',()=>{
  // Names only the controls this website actually offers, so the legend never points at a knob that is not there.
  const parts=[extraOn('fixtures')&&'voorbeeldapparaten',extraOn('garden')&&'tuinaankleding','vloer',extraOn('interior')&&'inrichting','beeldkwaliteit'].filter(Boolean);
  return (parts.slice(0,-1).join(', ')+(parts.length>1?' en ':'')+parts.at(-1)).replace(/^./,first=>first.toUpperCase())+'.';
 }],
 [icon('expand'),'Volledig scherm','Bekijk je ontwerp op het hele scherm.']];
function helpPanel(){
 const steps=[['Maak het jouw ontwerp','Kies de buitenmaten, materialen en voorzieningen. Bekijk direct hoe je keuzes samenkomen.'],
  ['Bewaar je persoonlijke voorstel','Download alle keuzes met een transparante voorbeeldberekening. Deel je ontwerp met je partner.'],
  ['Controleer de uitvoering samen','Een adviseur beoordeelt de locatie, fundering, constructie, materiaalkeuzes en definitieve prijs voordat je een opdracht geeft.']];
 return '<ol class="help-steps">'+steps.map(([title,text],index)=>'<li class="help-card"><span class="section-index" aria-hidden="true">'+(index+1)+'</span><span class="help-text"><strong>'+esc(title)+'</strong><span>'+esc(text)+'</span></span></li>').join('')+'</ol>'+
  '<h3 class="help-title">De knoppen bij het beeld</h3>'+
  '<ul class="help-legend">'+TOOL_LEGEND.map(([art,title,text])=>'<li><span class="help-legend-icon" aria-hidden="true">'+art+'</span><span class="help-text"><strong>'+esc(title)+'</strong><span>'+esc(typeof text==='function'?text():text)+'</span></span></li>').join('')+'</ul>'+
  '<button class="text-button" data-action="privacy">Over je gegevens</button>';
}
/** The help behind "Zo lees je het beeld" in the Weergave dialog: what "inbegrepen" and "ter illustratie" mean. */
function visualHelpPanel(){
 // The "ter illustratie" half only exists while this website shows example appliances at all.
 const terms=[['check','Inbegrepen','Het apparaat wordt geleverd. Montage en aansluiting staan apart in de leveringsomvang.'],
  extraOn('fixtures')&&['eye','Ter illustratie','Een voorbeeldapparaat wordt als contour getoond. Dat apparaat wordt niet geleverd; voorbereidingen kunnen wel onderdeel van je voorstel zijn.']].filter(Boolean);
 return '<p>De afmetingen veranderen mee met je keuzes. Kleuren, aansluitingen en modeldetails zijn indicatief; de uitvoering wordt bij de opname gecontroleerd.</p>'+
  '<ul class="help-legend">'+terms.map(([name,title,text])=>'<li><span class="help-legend-icon" aria-hidden="true">'+icon(name)+'</span><span class="help-text"><strong>'+esc(title)+'</strong><span>'+esc(text)+'</span></span></li>').join('')+'</ul>'+
  (extraOn('fixtures')?'<p class="muted">Voorbeeldapparaten tonen of verbergen verandert je keuzes, prijs of leveringsomvang niet.</p>':'');
}
function privacy(inline=false){
 const body='<p>Je ontwerp wordt zonder contactgegevens in de lokale opslag van je browser bewaard. Via “Opnieuw beginnen” kun je het verwijderen.</p><p>Een deellink bevat alleen je ontwerpkeuzes. Bij het opslaan van een persoonlijk voorstel worden je naam, contactgegevens, locatie en keuzes in de database van deze installatie opgeslagen om het voorstel te maken.</p><p>De lokale demo verstuurt geen marketing of e-mail. Het PDF-adres is privé: deel het alleen met mensen die je gegevens mogen zien. De beheerder moet vóór publieke ingebruikname de bedrijfsgegevens, bewaartermijn en het contactpunt voor inzage/verwijdering invullen.</p>';
 if(inline){const old=$('#inline-privacy');if(old)old.remove();else $('.consent').insertAdjacentHTML('afterend',`<div id="inline-privacy" class="inline-privacy">${body}</div>`);}else openModal('Over je gegevens',body);
}
document.addEventListener('click',async e=>{
 const unavailable=e.target.closest('[data-unavailable]');if(unavailable){e.preventDefault();toast(unavailable.dataset.unavailable);return;}
 const button=e.target.closest('button,[data-action]');if(!button||button.disabled)return;
 expandPreviewFor(button);
 if(button.closest('.scene-modes'))setModesMenu(false); // a mode chosen from the phone's three closes them
 if(button.dataset.step!==undefined){goStep(Number(button.dataset.step));return;}
 if(button.dataset.mode){setPreviewMode(button.dataset.mode);return;}
 if(button.dataset.sceneView){setSceneView(button.dataset.sceneView);return;}
 if(button.dataset.view){setSceneView(button.dataset.view);toggleViewpoints(false);return;}
 if(button.dataset.focusOption){focusSceneOption(button.dataset.focusOption);return;}
 if(button.dataset.comparisonSave){saveComparison(button.dataset.comparisonSave);return;}
 if(button.dataset.comparisonUse){useComparison(button.dataset.comparisonUse);return;}
 if(button.dataset.adjust){const key=button.dataset.adjust;commitDimension(key,Number(config[key])+Number(button.dataset.delta));return;}
 if(button.dataset.count){const key=button.dataset.count;changeConfig(key,Math.max(0,Math.min(fields[key].max??Math.max(...optionsFor(fields[key],key).map(option=>Number(option.id)).filter(Number.isFinite),1),config[key]+Number(button.dataset.delta))));return;}
 switch(button.dataset.action){
 case 'modes-menu':setModesMenu(!$('.scene-modes-wrap')?.classList.contains('open'));break;
 case 'exit':e.preventDefault();openExitDialog();break;
 case 'exit-confirm':leaveConfigurator();break;
 case 'compare-refresh':await refreshComparison();break;
 case 'material-detail':if(preview?.getSceneInfo().webglAvailable!==false){setPreviewMode('3d');preview?.focusMaterial?.();currentView=preview?.getSceneInfo().view||'perspective';setPreviewMode('3d');syncRoofButton();openMaterialCallout();}break;
 case 'close-material':closeMaterialCallout();setSceneView(step===1?'interior':'perspective');$('[data-action="material-detail"]')?.focus({preventScroll:true});break;
 case 'next':goStep(step+1);break;case 'previous':goStep(step-1);break;
 case 'goto-choice':goToChoice(button.dataset.choice);break;
 case 'goto-group':openChoiceSection(button.dataset.group);renderFooter();break;
 case 'save':if(config){toast(persist()?'Je ontwerp is op dit apparaat bewaard. Je kunt hier later verder.':'Bewaren is in deze browser niet beschikbaar. Gebruik Delen om je ontwerp te bewaren.');}break;
 case 'share':await share();break;case 'contact':contactForm();break;case 'pricing':priceBreakdown();break;case 'retry-price':schedulePrice(true);break;
 case 'close-modal':closeModal();break;case 'privacy':privacy();break;case 'privacy-inline':privacy(true);break;
 case 'copy-link':{const generation=designGeneration;try{await navigator.clipboard.writeText($('#share-url').value);if(generation===designGeneration)button.innerHTML=`${icon('check')} Gekopieerd`;}catch{if(generation===designGeneration){$('#share-url')?.select();toast('Selecteer en kopieer de link.');}}break;}
 case 'process':openModal('Zo werkt de configurator',helpPanel(),'help-modal');break;
 case 'reset':if(config)openModal('Opnieuw beginnen?','<p>Je huidige ontwerp, ingevulde contactgegevens en vergelijkingen op dit apparaat worden gewist. Je begint weer met de standaardkeuzes.</p><p class="muted">Eerder gemaakte voorstellen en deellinks blijven bestaan.</p><div class="modal-actions"><button class="button ghost" data-action="close-modal">Verder met dit ontwerp</button><button class="button primary" data-action="confirm-reset">Opnieuw beginnen</button></div>');break;
 case 'confirm-reset':resetDesign();break;
 case 'reset-camera':setSceneView(step===1?'interior':'perspective');break;
 case 'viewpoints':toggleViewpoints();break;
 case 'view-strip':openViewDialog();break;
 case 'tools-menu':setToolsMenu(!$('.camera-tools')?.classList.contains('open'));break;
 case 'environment':openModal('Woning en tuin',environmentPanel(),'environment-modal');break;
 case 'floor-finish':applyEnvironment({...environment,floorFinish:button.dataset.floorFinish});updateEnvironmentChips();preview?.setFloorFinish?.(environment.floorFinish);break;
 case 'scenario':applyEnvironment({...environment,scenario:button.dataset.scenario});updateEnvironmentChips();syncScenario({announce:true});break;
 case 'render-quality':renderQuality=QUALITIES.some(quality=>quality.id===button.dataset.renderQuality)?button.dataset.renderQuality:'auto';
  try{localStorage.setItem(QUALITY_STORAGE_KEY,renderQuality);}catch{/* The choice still applies for this visit. */}
  updateEnvironmentChips();preview?.setQuality?.(renderQuality);toast(qualityToast(renderQuality,preview?.quality));break;
 // The replay button lives in the Weergave dialog since 2.10.7: close it first, or the loops are laid behind the backdrop.
 case 'replay-underfloor':if(modal.open)closeModal();preview?.playUnderfloorAnimation?.();break;
 case 'reload-catalog':{
  const sequence=++catalogReadSequence;
  try{
   const updated=await api('/catalog');if(sequence!==catalogReadSequence)break;
   catalog=updated;fields=fieldsOf(catalog);comparisonPrices=null;comparisonSequence++;comparisonBusy=false;
   config=normalizedDraft(config,catalog);requestKey=null;result=null;preview?.setPlacement?.(null);preview?.update(config);updatePreviewLabel();persist();renderStep();schedulePrice(true);
   toast('De catalogus is bijgewerkt. Controleer je keuzes en de nieuwe leveringsomvang.');
  }catch(error){if(sequence===catalogReadSequence)toast('Bijwerken is niet gelukt: '+error.message);}break;
 }
 case 'visual-help':openModal('Zo lees je het ontwerp',visualHelpPanel(),'help-modal');break;
 case 'dimensions':dimensionsVisible=!dimensionsVisible;preview?.setDimensions(dimensionsVisible);button.classList.toggle('active',dimensionsVisible);button.setAttribute('aria-pressed',dimensionsVisible);break;
 case 'roof':roofVisible=!roofVisible;preview?.setRoofVisible(roofVisible);updateRoofButton(button);break;
 case 'fullscreen':try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.preview-card').requestFullscreen();}catch{$('.preview-card').classList.toggle('expanded');preview?.resize();}break;
 }
});
document.addEventListener('change',e=>{
 const target=e.target,key=target.dataset.config;if(target.dataset.viewSetting==='examples'){examplesVisible=target.checked;syncSceneContent();return;}if(target.dataset.viewSetting==='decor'){decorVisible=target.checked;syncSceneContent();return;}if(!key||!config)return;
 let value=target.value;
 if(target.type==='checkbox'&&fields[key]?.type==='multiselect'){const values=new Set(config[key]||[]);target.checked?values.add(value):values.delete(value);if(values.size>(fields[key].maxSelections??fields[key].options.length)){target.checked=false;toast('Kies maximaal '+fields[key].maxSelections+' posities.');return;}value=fields[key].options.filter(option=>values.has(option.id)).map(option=>option.id);}
 else if(target.type==='radio'){const option=optionsFor(fields[key],key).find(o=>String(o.id)===value);if(option)value=option.id;}
 else if(target.type==='number')value=Number(value);
 if(catalog.dimensions[key]){commitDimension(key,target.value);return;}
 if(target.type==='number'&&!catalog.dimensions[key]&&(!Number.isInteger(value)||value<Number(target.min)||value>Number(target.max))){target.value=config[key];toast('Kies een geldig aantal.');return;}
 changeConfig(key,value);
});
document.addEventListener('input',e=>{
 const target=e.target,key=target.dataset.range;if(!key)return;
 commitDimension(key,target.value,{rerender:false});
});
document.addEventListener('toggle',e=>{const group=e.target.dataset?.group;if(group)openSection(e.target,e.target.open);if(e.target.classList?.contains('comparison-panel')&&e.target.isConnected)comparisonOpen=e.target.open;},true);

document.addEventListener('keydown',e=>{const unavailable=e.target.closest('[data-unavailable]');if(unavailable&&['Enter',' '].includes(e.key)){e.preventDefault();toast(unavailable.dataset.unavailable);return;}if(e.key==='Escape'&&$('.preview-card')?.classList.contains('expanded')){$('.preview-card').classList.remove('expanded');preview?.resize();}});

async function initialize(){
 const generation=designGeneration;
 try{
 await applyAppearance();
 // The admin policy for the illustrative extras rides in that same payload, so it is known before the first
 // frame: no extra ever appears and then vanishes a round trip later.
 scenePolicy=getSceneContent();
 renderQuality=storedQuality();
 const startWith=environmentBase();
 examplesVisible=startWith.fixtures;decorVisible=startWith.garden;
 if(adminPreview)document.querySelectorAll('.header-actions button').forEach(button=>button.hidden=true);
 catalog=await api('/catalog');if(adminPreview&&catalog.preview?.enabled!==true)throw new Error('Dit conceptvoorbeeld is niet beschikbaar voor je account.');fields=fieldsOf(catalog);config=structuredClone(catalog.defaults);let restored=false;
 const token=new URLSearchParams(location.search).get('share');
 if(!adminPreview&&token){try{const shared=await api(`/share/${encodeURIComponent(token)}`);config=normalizedDraft(shared.config,catalog);restored=true;}catch(error){toast(`Deellink kon niet worden geladen: ${error.message}`);}}
 else if(!adminPreview){try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));if(saved?.config){config=normalizedDraft(saved.config,catalog);restored=true;}}catch{/* Ignore corrupt or unavailable local draft. */}}
 if(!adminPreview){try{comparison=comparisonDrafts(JSON.parse(localStorage.getItem(COMPARISON_STORAGE_KEY)),catalog);}catch{comparison={A:null,B:null};}}
 // The policy's defaults only fill keys this visitor never chose; a key that IS in the store keeps their value.
 environment=loadEnvironment(undefined,startWith);environmentWidth=config.width;
 shell();schedulePrice(true);syncEnvironmentWithDesign();
 // The preview is built from the CLAMPED environment, not the stored one: an extra the administrator switched
 // off is never built and then hidden, it is simply not there.
 try{const {Preview}=await import('./preview.js');$('#preview-scene').replaceChildren();preview=new Preview($('#preview-scene'),{quality:renderQuality==='auto'?undefined:renderQuality,gardenFence:getFeatures().gardenFence,cameraLimit:!getFeatures().cameraFreeOrbit,interiorFurniture:getFeatures().interiorFurniture,environment:{...environment,renderNeighbours:sceneState(scenePolicy,environment).renderNeighbours},onReady:({mode})=>{setPreviewMode(mode);updatePreviewStatus();},onError:()=>{webglProblem=true;setPreviewMode('2d');updatePreviewStatus();toast('3D is hier niet beschikbaar. Je kunt je ontwerp in 2D bekijken.');}});preview.onSelect?.(selectSceneOption);preview.setSelectableKeys?.(selectableSceneKeys());preview.update(config);preview.setPlacement?.(price?.fixtureLayout||null);preview.setScope?.(price?.scope||[]);syncSceneContent({force:true});preview.setFloorFinish?.(environment.floorFinish);syncScenario();preview.onResetCamera=()=>setSceneView(step===1?'interior':'perspective');
   window.__prefabPreview=preview;}catch(error){$('#preview-scene').innerHTML=`<div class="preview-unavailable">${icon('plan')}<p>De preview is niet beschikbaar.</p><p>Je kunt je ontwerp wel samenstellen en bewaren.</p></div>`;console.error('Preview initialization failed',error);}
 if(restored&&generation===designGeneration)toast(token?'Gedeeld ontwerp geladen. Maak het gerust verder van jou.':'Welkom terug. Je bewaarde ontwerp staat klaar.');
 }catch(error){app.setAttribute('aria-busy','false');app.innerHTML=`<div class="load-error">${icon('alert')}<h1>${adminPreview?'Dit conceptvoorbeeld is niet beschikbaar.':'We kunnen je ontwerp nog niet laden.'}</h1><p>${esc(error.message)}</p>${adminPreview?'<a class="button ghost" href="/web/login?redirect='+encodeURIComponent(location.pathname+location.search)+'">Inloggen als beheerder</a>':''}<button class="button primary" id="reload">Opnieuw proberen ${icon('rotate')}</button></div>`;$('#reload').addEventListener('click',initialize);}
}
initialize();

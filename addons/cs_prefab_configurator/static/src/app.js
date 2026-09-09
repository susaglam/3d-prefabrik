import {icon} from './icons.js';
import {STEPS,STORAGE_KEY,INTERIOR_FIELDS,MATERIALS,money,preciseMoney,metric,escapeHTML as esc,fieldsOf,normalizedDraft,normalizeInterior,labelFor,validDimensions,validateContact} from './model.js';

const API='/prefab/api';
let catalog, fields, config, price=null, step=0, preview, currentMode='3d', priceTimer, priceSequence=0, pricePending=true, priceError='', savedAt=null, errors={}, contact={}, result=null, submitting=false, requestKey=null, dimensionsVisible=true, roofVisible=true;
const $=selector=>document.querySelector(selector);
const app=$('#app');
const modal=$('#modal');
let lastFocus=null;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
$('#year').textContent=new Date().getFullYear();
async function api(path, body) {
 const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),15000);
 try {
   const response=await fetch(`${API}${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:controller.signal});
   const data=await response.json();
   if(!response.ok){const error=new Error(data.error?.message||'Dat lukte niet. Probeer het opnieuw.');error.fields=data.error?.fields||{};throw error;}
   return data;
 } catch(error){if(error.name==='AbortError')throw new Error('De verbinding duurt te lang. Probeer het opnieuw.');throw error;}finally{clearTimeout(timeout);}
}
function toast(message) {const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4500);}
function openModal(title,body,cls='') {
 lastFocus=document.activeElement;
 $('#modal-content').innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Venster sluiten">${icon('close')}</button></div><div class="modal-body ${cls}">${body}</div>`;
 if(!modal.open)modal.showModal();
}
function closeModal(){modal.close();lastFocus?.focus();}
modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
function fieldLabel(key){return fields[key]?.label || key;}
function selectedLabel(key){return labelFor(fields,key,config[key]);}

function shell() {
 app.innerHTML=`<section class="intro"><div><p class="eyebrow"><span></span> JOUW HUIS. MEER MOGELIJKHEDEN.</p><h1>Meer ruimte. <em>Helemaal van jou.</em></h1><p>Ontwerp je prefab aanbouw en zie je ideeën tot leven komen.</p></div><div class="intro-note">${icon('home')}<span>Van eerste idee<br><strong>naar een goed plan.</strong></span></div></section>
 <nav class="steps" aria-label="Stappen van je ontwerp">${STEPS.map((s,i)=>`<button class="step-tab" data-step="${i}" aria-label="Stap ${i+1}: ${s.label}"><span class="step-number">${i+1}</span><span class="step-label">${s.label}</span><span class="step-short">${s.short}</span>${i<STEPS.length-1?'<span class="step-line"></span>':''}</button>`).join('')}</nav>
 <div class="workspace"><section class="preview-card" aria-label="Jouw ontwerp"><div class="preview-top"><div class="live-label"><span></span> JOUW ONTWERP <small id="preview-size"></small></div><div class="segmented" role="group" aria-label="Weergave"><button data-mode="3d" class="active" aria-pressed="true">${icon('cube')}3D</button><button data-mode="2d" aria-pressed="false">${icon('plan')}2D</button></div></div>
 <div class="preview-scene" id="preview-scene"><div class="preview-loading">Je ontwerp wordt opgebouwd…</div></div>
 <div class="preview-floating"><span class="design-tag">${icon('leaf')} Jouw prefab aanbouw</span><button class="icon-button" data-action="fullscreen" aria-label="Ontwerp op volledig scherm">${icon('expand')}</button></div>
 <div class="preview-toolbar"><div class="camera-tools"><button class="tool-button" data-view="perspective" aria-label="Perspectief" title="Perspectief">${icon('cube')}</button><button class="tool-button" data-view="front" aria-label="Vooraanzicht" title="Vooraanzicht">${icon('home')}</button><button class="tool-button" data-view="top" aria-label="Bovenaanzicht" title="Bovenaanzicht">${icon('plan')}</button><span class="tool-divider"></span><button class="tool-button active" data-action="dimensions" aria-pressed="true" aria-label="Maatlijnen tonen" title="Maatlijnen">${icon('ruler')}</button><button class="tool-button active" data-action="roof" aria-pressed="true" aria-label="Dak tonen" title="Dak tonen of verbergen">${icon('roof')}</button><button class="tool-button" data-action="reset-camera" aria-label="Camera herstellen" title="Camera herstellen">${icon('rotate')}</button></div><span class="rotate-hint">Sleep om rond te kijken</span></div>
 <div class="preview-bottom"><span>${icon('info')} Schematische weergave · definitieve uitvoering na opname</span><button data-action="share">${icon('share')} Delen</button></div>
 </section><section class="choices-card" id="step-panel" aria-label="Keuzes voor je aanbouw"><div id="panel-content"></div><div id="panel-footer"></div></section></div>
 <section class="confidence"><span>${icon('ruler')} Maatwerk begint bij jouw wensen</span><span>${icon('shield')} Alle keuzes helder op een rij</span><span>${icon('save')} Bewaar en ga later verder</span></section>
 <div class="project-bar"><div><span class="project-dot"></span><span id="save-status">Je ontwerp wordt op dit apparaat bewaard</span></div><button data-action="reset">Opnieuw beginnen ${icon('undo')}</button></div>`;
 renderStep();updatePreviewLabel();
 app.setAttribute('aria-busy','false');
}
function updateTabs(){document.querySelectorAll('.step-tab').forEach(el=>{const i=Number(el.dataset.step);el.classList.toggle('active',i===step);el.classList.toggle('completed',i<step);if(i===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');el.querySelector('.step-number').innerHTML=i<step?icon('check'):i+1;});}
function dimensionField(key) {
 const d=catalog.dimensions[key],value=config[key];
 return `<div class="dimension-field"><div class="field-heading"><label for="${key}">${d.label}</label><span>${metric(d.min)} – ${metric(d.max)} m</span></div><div class="number-control"><button data-adjust="${key}" data-delta="-10" aria-label="${d.label} 10 centimeter kleiner">${icon('minus')}</button><div><input id="${key}" data-config="${key}" type="number" inputmode="numeric" min="${d.min}" max="${d.max}" step="${d.step}" value="${value}" aria-describedby="${key}-error"><span>cm</span></div><button data-adjust="${key}" data-delta="10" aria-label="${d.label} 10 centimeter groter">${icon('plus')}</button></div><input class="dimension-slider" type="range" data-range="${key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${value}" aria-label="${d.label} in centimeter" aria-valuetext="${value} centimeter" style="--fill:${(value-d.min)/(d.max-d.min)*100}%"><p class="field-error" id="${key}-error">${esc(errors[key]||'')}</p></div>`;
}
const descriptions={
 facade:'De kleur en structuur zijn een eerste indruk. De exacte afwerking kiezen we samen.',
 rollaag:'De horizontale afwerking direct boven het kozijn.',
 frontOpening:'De indeling in de preview past zich aan je gekozen breedte aan.',
 rooflight:'Meer licht van boven. Het aantal vakken bepaalt de indeling van het daklicht.',
 outsideLight:'Voorbereiding met een loze leiding; de armatuur is niet inbegrepen.',
 outsideSocket:'Voorbereiding met een loze leiding; geen aangesloten stopcontact.',
 outsideTap:'Kies de gewenste kant voor de buitenkraan.',
 interior:'Wil je ook de binnenafwerking en aansluitpunten samenstellen?',
 underfloorHeating:'Ruimte in de vloer voorbereiden; aansluiting op de bestaande verwarming is niet inbegrepen.',
 heating:'Positie van de loze leidingen voor verwarming.',
 ceilingLights:'Voorbereide stroompunten; lampen zijn niet inbegrepen.',
 switches:'Voorbereiding met loze leidingen.',sockets:'Voorbereiding met loze leidingen.',
 piles:'Je voorlopige voorkeur. De constructeur bepaalt het definitieve aantal op basis van bodem en belasting.',
 demolition:'Moet de bestaande buitenmuur worden geopend om de aanbouw met je woning te verbinden?',
 access:'Is de tuin via een zijpad of achterom bereikbaar?',
};
function optionImage(key,id) {
 if(key==='facade'){const m=MATERIALS[id];return `<span class="material-swatch ${m?.type||''}" style="--material:${m?.color||'#b4afa3'}"></span>`;}
 if(key==='frontOpening') {
   const white=String(id).endsWith('white'),panels=id==='none'?0:(id.includes('4')||id.includes('folding')?4:2),bars=id.includes('bars');
   return `<svg class="opening-swatch" viewBox="0 0 124 78" aria-hidden="true"><rect x="6" y="9" width="112" height="62" fill="#dbd7cc"/>${panels?`<rect x="14" y="17" width="96" height="54" fill="#b7c8c7" stroke="${white?'#fff':'#3e4745'}" stroke-width="4"/>${Array.from({length:panels-1},(_,i)=>`<path d="M${14+(i+1)*96/panels} 17v54" stroke="${white?'#fff':'#3e4745'}" stroke-width="3"/>`).join('')}${bars?`<path d="M14 35h96M14 53h96M38 17v54M86 17v54" stroke="${white?'#fff':'#3e4745'}" stroke-width="1.5"/>`:''}${id.includes('french')?'<path d="m17 20 42 46V20m7 0v46l41-46" stroke="#718583" stroke-width=".8" fill="none"/>':''}`:'<path d="M6 25h112M6 41h112M6 57h112M24 9v16m24 0v16m24 0v16m24 0v14" stroke="#c1bcaf"/>'}</svg>`;
 }
 if(key==='rooflight'){
   const n=Number(String(id).split('-')[1]||0),gable=String(id).startsWith('gable');
   return `<svg class="roof-swatch" viewBox="0 0 124 74" aria-hidden="true"><path d="m10 51 43-25 61 18-43 24Z" fill="#d5d2c8"/>${n?`<path d="m26 47 28-24 46 14-29 24Z" fill="#bdcecc" stroke="#53625e" stroke-width="2"/>${gable?'<path d="m40 35 47 14M26 47l14-12 14-12m17 38 16-12 13-12" fill="none" stroke="#53625e" stroke-width="1.5"/>':''}${Array.from({length:(gable?n/2:n)-1},(_,i)=>{const k=(i+1)/(gable?n/2:n);return `<path d="M${26+45*k} ${47+14*k}l28-24" stroke="#53625e" stroke-width="1.5"/>`;}).join('')}`:'<path d="m48 42 24 7" stroke="#aaa99e" stroke-width="2"/>'}</svg>`;
 }
 return '';
}
function optionsFor(field,key){
 if(field.options?.length)return field.options;
 if(typeof config[key]==='boolean')return [{id:false,label:key==='interior'?'Alleen de buitenzijde':'Nee'},{id:true,label:key==='interior'?'Ook de binnenzijde':'Ja'}];
 return [];
}
function renderField(key) {
 const field=fields[key];if(!field)return '';
 const opts=optionsFor(field,key),visual=['facade','frontOpening','rooflight'].includes(key);
 const countKeys=['ceilingLights','switches','spotlights'];
 if(countKeys.includes(key)) {
 const max=key==='spotlights'?12:2;
 return `<div class="field-block count-field"><div><label for="${key}">${esc(field.label)}</label>${descriptions[key]?`<p class="field-description">${esc(descriptions[key])}</p>`:''}</div><div class="counter"><button data-count="${key}" data-delta="-1" aria-label="Minder ${esc(field.label)}" ${config[key]===0?'disabled':''}>${icon('minus')}</button><input id="${key}" data-config="${key}" type="number" min="0" max="${max}" step="1" value="${config[key]}" aria-label="${esc(field.label)}"><button data-count="${key}" data-delta="1" aria-label="Meer ${esc(field.label)}" ${config[key]===max?'disabled':''}>${icon('plus')}</button></div></div>`;
 }
 return `<fieldset class="field-block" data-field="${key}"><legend>${esc(field.label)}</legend>${descriptions[key]?`<p class="field-description">${esc(descriptions[key])}</p>`:''}<div class="option-grid ${visual?'visual-grid':''} ${key==='facade'?'materials-grid':''} ${opts.length<=2?'two-options':''}">${opts.map(o=>{const selected=config[key]===o.id;return `<label class="option-card ${selected?'selected':''} ${visual?'visual-card':''}"><input type="radio" name="${key}" data-config="${key}" value="${esc(o.id)}" ${selected?'checked':''}><span class="option-check">${selected?icon('check'):''}</span>${optionImage(key,String(o.id))}<span class="option-title">${esc(o.label)}</span></label>`;}).join('')}</div><p class="field-error">${esc(errors[key]||'')}</p></fieldset>`;
}
function renderStep(focus=false) {
 updateTabs();
 const s=STEPS[step];
 let content='';
 if(step===0)content=`${dimensionField('width')}${dimensionField('depth')}<div class="area-card"><span>${icon('plan')} Jouw extra leefruimte</span><strong id="area-number">${new Intl.NumberFormat('nl-NL',{maximumFractionDigits:2}).format(config.width*config.depth/10000)} <small>m²</small></strong></div><div class="tip">${icon('info')}<p>Meet de gewenste buitenmaten. De definitieve maten en de vaste voorbeeldhoogte van 2,80 m worden bij de opname gecontroleerd.</p></div>`;
 else if(step===6)content=renderSummary();
 else content=s.fields.filter(key=>!INTERIOR_FIELDS.includes(key)||config.interior).map(renderField).join('');
 if(step===4&&!config.interior)content+=`<div class="interior-placeholder">${icon('floor')}<h3>Een basis voor jouw eigen afwerking.</h3><p>Je kunt de binnenzijde zelf laten afwerken. Wil je alvast aansluitpunten en afwerking kiezen? Zet de binnenzijde hierboven aan.</p></div>`;
 if(step===5)content+=`<div class="tip">${icon('info')}<p>Bereikbaarheid, kraanopstelling, bodemonderzoek en constructie worden beoordeeld voordat je een definitieve offerte ontvangt.</p></div>`;
 $('#panel-content').innerHTML=`<div class="panel-heading"><div class="step-eyebrow">STAP ${step+1} VAN ${STEPS.length}<span>${icon(s.icon)}</span></div><h2 tabindex="-1" id="step-title">${s.title}</h2><p>${s.description}</p></div><div class="panel-fields">${content}</div>`;
 $('#panel-content').scrollTop=0;
 renderFooter();
 if(focus)$('#step-title').focus({preventScroll:true});
}
function renderFooter(){
 if(!$('#panel-footer'))return;
 $('#panel-footer').innerHTML=`<div class="price-peek"><div><span class="price-caption">${icon('info')} Voorbeeldprijs incl. btw</span><button data-action="pricing">Bekijk de opbouw</button></div><strong class="price-value ${pricePending?'pending':''}" aria-live="polite">${pricePending?'Berekenen…':priceError?'Niet beschikbaar':price?money(price.total):'—'}</strong></div>${priceError?`<p class="api-error" role="alert">${esc(priceError)} <button data-action="retry-price">Opnieuw proberen</button></p>`:''}<div class="step-actions">${step>0?`<button class="button back-button" data-action="previous" aria-label="Vorige stap">${icon('back')}</button>`:''}<button class="button primary next-button" data-action="${step===6?'contact':'next'}" ${(pricePending||priceError)&&step===6?'disabled':''}>${step===6?'Bewaar mijn voorstel':`Verder naar ${STEPS[step+1].label.toLowerCase()}`}${icon('arrow')}</button></div><p class="footer-note">${step===6?'Vrijblijvend · geen bestelling of betaling':'Je kunt je keuzes altijd nog aanpassen'}</p>`;
}
function renderSummary(){
 return `<div class="summary-hero"><span>JOUW PREFAB AANBOUW</span><strong>${metric(config.width)} × ${metric(config.depth)} <small>m</small></strong><p>${(config.width*config.depth/10000).toLocaleString('nl-NL')} m² extra mogelijkheden</p></div>${STEPS.slice(1,6).map((s,i)=>`<section class="summary-section"><div class="summary-heading"><h3>${s.label}</h3><button data-step="${i+1}" aria-label="${s.label} aanpassen">${icon('edit')} Wijzig</button></div><dl>${s.fields.filter(key=>(!INTERIOR_FIELDS.includes(key)||config.interior)&&fields[key]).map(key=>`<div><dt>${esc(fieldLabel(key))}</dt><dd>${esc(selectedLabel(key))}</dd></div>`).join('')}</dl></section>`).join('')}<div class="tip">${icon('info')}<p>Deze berekening gebruikt een voorbeeldprijsboek. Materiaalkeuze, montage, transport en constructie moeten commercieel worden bevestigd. Dit voorstel is geen bindende offerte.</p></div>`;
}
function updatePreviewLabel(){if($('#preview-size'))$('#preview-size').textContent=`${metric(config.width)} × ${metric(config.depth)} m`;}
function setPreviewMode(mode){
 const available=preview?.getSceneInfo().webglAvailable!==false;
 currentMode=mode==='3d'&&available?'3d':'2d';preview?.setMode(currentMode);
 document.querySelectorAll('[data-mode]').forEach(button=>{button.classList.toggle('active',button.dataset.mode===currentMode);button.setAttribute('aria-pressed',button.dataset.mode===currentMode);button.disabled=button.dataset.mode==='3d'&&!available;});
 document.querySelectorAll('[data-view],[data-action="roof"],[data-action="reset-camera"]').forEach(button=>button.disabled=currentMode==='2d');
 $('.rotate-hint').textContent=currentMode==='3d'?'Sleep om rond te kijken':'Plattegrond op schaal';
}
function persist(){
 try{savedAt=new Date();localStorage.setItem(STORAGE_KEY,JSON.stringify({version:catalog.schemaVersion,config:{...config,postcode:''},savedAt:savedAt.toISOString()}));if($('#save-status'))$('#save-status').textContent=`Op dit apparaat bewaard om ${savedAt.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`;return true;}catch{if($('#save-status'))$('#save-status').textContent='Opslaan op dit apparaat niet beschikbaar. Gebruik een deellink.';return false;}
}
function schedulePrice(immediate=false){
 const sequence=++priceSequence;pricePending=true;priceError='';renderFooter();clearTimeout(priceTimer);
 priceTimer=setTimeout(async()=>{try{
   const data=await api('/price',{config});if(sequence!==priceSequence)return;
   price=data;pricePending=false;priceError='';errors={};renderFooter();
 }catch(error){if(sequence!==priceSequence)return;pricePending=false;priceError=error.message;errors=error.fields||{};renderFooter();}},immediate?0:260);
}
function changeConfig(key,value,{rerender=true}={}) {
 const active=document.activeElement,scrollTop=$('#panel-content')?.scrollTop||0;
 let restoreSelector=active?.id?`#${CSS.escape(active.id)}`:active?.name?`input[name="${CSS.escape(active.name)}"][value="${CSS.escape(active.value)}"]`:null;
 for(const attr of ['data-count','data-adjust'])if(active?.hasAttribute(attr))restoreSelector=`[${attr}="${CSS.escape(active.getAttribute(attr))}"][data-delta="${active.dataset.delta}"]`;
 const url=new URL(location.href);if(url.searchParams.has('share')){url.searchParams.delete('share');history.replaceState({},'',url.pathname+url.search+url.hash);}
 config=normalizeInterior({...config,[key]:value},catalog.defaults);result=null;requestKey=null;delete errors[key];
 if(validDimensions(config,catalog))preview?.update(config);
 updatePreviewLabel();persist();schedulePrice();
 if(rerender){renderStep();$('#panel-content').scrollTop=scrollTop;if(restoreSelector)$(restoreSelector)?.focus({preventScroll:true});}
}
function goStep(next){
 if(next===step)return;
 if(!validDimensions(config,catalog)){toast('Controleer eerst de afmetingen.');return;}
 step=Math.max(0,Math.min(STEPS.length-1,next));renderStep(true);
 if(matchMedia('(max-width: 760px)').matches)$('#step-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function priceBreakdown(){
 if(!price||pricePending||priceError){toast('Wacht tot de berekening is afgerond.');return;}
 openModal('Je voorbeeldprijs, uitgelegd',`<p class="notice">Dit is een demonstratieprijsboek, geen bevestigde verkoopprijs. Alle bedragen hieronder zijn voorbeeldbedragen.</p><div class="breakdown-list">${price.lines.map(line=>`<div><span>${esc(line.label)}<small>${line.quantity} ${esc(line.unit)}</small></span><strong>${preciseMoney(line.total)}</strong></div>`).join('')}<div><span>Subtotaal excl. btw</span><strong>${preciseMoney(price.subtotal)}</strong></div><div><span>Btw ${price.vatRate}%</span><strong>${preciseMoney(price.vat)}</strong></div><div class="breakdown-total"><span>Totaal incl. btw</span><strong>${preciseMoney(price.total)}</strong></div></div><p class="muted">Prijsboek: ${esc(price.pricebookVersion)}. Definitieve prijs na controle van de locatie, constructie en commerciële prijsafspraken.</p>${price.warnings?.length?`<ul class="warnings">${price.warnings.map(x=>`<li>${esc(typeof x==='string'?x:x.message)}</li>`).join('')}</ul>`:''}`);
}
function contactForm(){
 if(result){showResult();return;}
 const inputs=[['firstName','Voornaam','given-name','text'],['lastName','Achternaam','family-name','text'],['email','E-mailadres','email','email'],['phone','Telefoonnummer','tel','tel'],['address','Straat','address-line1','text'],['houseNumber','Huisnummer','address-line2','text'],['postcode','Postcode','postal-code','text'],['city','Woonplaats','address-level2','text']];
 openModal('Je plan verdient een volgende stap.',`<p>Bewaar je ontwerp en voorbeeldberekening als persoonlijk PDF-voorstel. Je aanvraag wordt in deze omgeving geregistreerd.</p><form id="quote-form" novalidate><div class="contact-grid">${inputs.map(([key,label,autocomplete,type])=>`<div class="contact-field"><label for="contact-${key}">${label} <span>*</span></label><input id="contact-${key}" name="${key}" type="${type}" autocomplete="${autocomplete}" maxlength="${key==='houseNumber'?20:key==='postcode'?7:120}" required value="${esc(contact[key]||'')}" ${key==='postcode'?'placeholder="1234 AB"':''} aria-describedby="contact-error-${key}"><p class="field-error" id="contact-error-${key}"></p></div>`).join('')}</div><div class="contact-field"><label for="contact-message">Opmerking <span class="optional">optioneel</span></label><textarea id="contact-message" name="message" rows="3" maxlength="2000" placeholder="Vertel gerust iets over je plannen…">${esc(contact.message||'')}</textarea></div><label class="consent"><input type="checkbox" name="consent" required ${contact.consent?'checked':''}><span>Ik geef toestemming om mijn gegevens voor dit voorstel te verwerken. <button type="button" data-action="privacy-inline">Privacygegevens</button></span></label><p id="contact-error-consent" class="field-error"></p><div id="quote-error" class="api-error" role="alert"></div><button type="submit" class="button primary submit-button">Voorstel opslaan & PDF maken ${icon('arrow')}</button><p class="form-note">Geen betaling. Er wordt vanuit de lokale demo geen e-mail verzonden.</p></form>`);
 $('#quote-form').addEventListener('input',e=>{if(e.target.name)contact[e.target.name]=e.target.type==='checkbox'?e.target.checked:e.target.value;});
 $('#quote-form').addEventListener('submit',submitQuote);
}
async function submitQuote(e){
 e.preventDefault();if(submitting)return;
 const form=e.currentTarget;for(const [key,value] of new FormData(form))contact[key]=typeof value==='string'?value.trim():value;contact.consent=form.elements.consent.checked;
 const validation=validateContact(contact);if(!contact.consent)validation.consent='Geef toestemming om je voorstel te kunnen bewaren.';
 form.querySelectorAll('.field-error').forEach(el=>el.textContent='');form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
 if(Object.keys(validation).length){for(const [key,message] of Object.entries(validation)){const el=$(`#contact-error-${key}`);if(el)el.textContent=message;form.elements[key]?.setAttribute('aria-invalid','true');}form.elements[Object.keys(validation)[0]]?.focus();return;}
 submitting=true;const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='Je voorstel wordt bewaard…';$('#quote-error').textContent='';
 const payloadContact={firstName:contact.firstName,lastName:contact.lastName,name:`${contact.firstName} ${contact.lastName}`,email:contact.email,phone:contact.phone,postcode:contact.postcode,houseNumber:contact.houseNumber,address:contact.address,city:contact.city,message:contact.message||''};
 const fingerprint=JSON.stringify([config,payloadContact]);if(!requestKey||requestKey.fingerprint!==fingerprint)requestKey={fingerprint,key:crypto.randomUUID()};
 const submittedConfig=JSON.stringify(config);
 try{const received=await api('/quote',{config,contact:payloadContact,consent:true,idempotencyKey:requestKey.key});if(JSON.stringify(config)===submittedConfig)result=received;showResult(received);}
 catch(error){const errorBox=form.querySelector('#quote-error');if(form.isConnected&&modal.open){errorBox.textContent=error.message;for(const[key,message]of Object.entries(error.fields||{})){const normalized=key.replace(/^contact\./,'');const el=form.querySelector(`#contact-error-${CSS.escape(normalized)}`);if(el)el.textContent=message;}}else toast(`Voorstel niet opgeslagen: ${error.message}`);button.disabled=false;button.innerHTML=`Opnieuw proberen ${icon('arrow')}`;}
 finally{submitting=false;}
}
function showResult(record=result){openModal('Je ontwerp is bewaard.',`<div class="success-state"><div class="success-icon">${icon('check')}</div><p class="eyebrow">EEN MOOI BEGIN</p><h3>Jouw extra ruimte begint hier.</h3><p>Je voorstel <strong>${esc(record.reference)}</strong> is geregistreerd. Download de PDF met je keuzes en voorbeeldberekening.</p><a class="button primary" href="${esc(record.pdfUrl)}" download>Download mijn voorstel ${icon('download')}</a><p class="notice">Er is geen e-mail verzonden vanuit deze lokale omgeving. Bewaar de PDF; de commerciële prijs en technische uitvoering vragen nog bevestiging.</p><button class="text-button" data-action="close-modal">Terug naar mijn ontwerp</button></div>`);}
async function share(){
 if(!validDimensions(config,catalog)){toast('Controleer eerst de afmetingen.');return;}
 try{const data=await api('/share',{config});const link=new URL(data.url||`/prefab?share=${encodeURIComponent(data.token)}`,location.origin).href;
 openModal('Een goed idee kun je delen.',`<p>Met deze link bekijk je dit ontwerp op elk apparaat. Je contactgegevens staan er niet in.</p><label class="share-label" for="share-url">Link naar jouw ontwerp</label><div class="share-input"><input id="share-url" readonly value="${esc(link)}"><button class="button primary" data-action="copy-link">${icon('copy')} Kopiëren</button></div><p class="muted">Wie de link heeft, kan deze versie van je ontwerp bekijken. Bewerkingen worden als een eigen ontwerp opgeslagen.</p>`);
 }catch(error){toast(`Delen is niet gelukt: ${error.message}`);}
}
function privacy(inline=false){
 const body='<p>Je ontwerp wordt zonder contactgegevens in de lokale opslag van je browser bewaard. Via “Opnieuw beginnen” kun je het verwijderen.</p><p>Een deellink bevat alleen je ontwerpkeuzes. Bij het opslaan van een persoonlijk voorstel worden je naam, contactgegevens, locatie en keuzes in de database van deze installatie opgeslagen om het voorstel te maken.</p><p>De lokale demo verstuurt geen marketing of e-mail. Het PDF-adres is privé: deel het alleen met mensen die je gegevens mogen zien. De beheerder moet vóór publieke ingebruikname de bedrijfsgegevens, bewaartermijn en het contactpunt voor inzage/verwijdering invullen.</p>';
 if(inline){const old=$('#inline-privacy');if(old)old.remove();else $('.consent').insertAdjacentHTML('afterend',`<div id="inline-privacy" class="inline-privacy">${body}</div>`);}else openModal('Over je gegevens',body);
}
document.addEventListener('click',async e=>{
 const button=e.target.closest('button,[data-action]');if(!button||button.disabled)return;
 if(button.dataset.step!==undefined){goStep(Number(button.dataset.step));return;}
 if(button.dataset.mode){setPreviewMode(button.dataset.mode);return;}
 if(button.dataset.view){preview?.setView(button.dataset.view);return;}
 if(button.dataset.adjust){const key=button.dataset.adjust,d=catalog.dimensions[key],value=Math.max(d.min,Math.min(d.max,(Number(config[key])||d.min)+Number(button.dataset.delta)));changeConfig(key,value);return;}
 if(button.dataset.count){const key=button.dataset.count;changeConfig(key,Math.max(0,Math.min(key==='spotlights'?12:2,config[key]+Number(button.dataset.delta))));return;}
 switch(button.dataset.action){
 case 'next':goStep(step+1);break;case 'previous':goStep(step-1);break;
 case 'save':if(config){toast(persist()?'Je ontwerp is op dit apparaat bewaard. Je kunt hier later verder.':'Bewaren is in deze browser niet beschikbaar. Gebruik Delen om je ontwerp te bewaren.');}break;
 case 'share':await share();break;case 'contact':contactForm();break;case 'pricing':priceBreakdown();break;case 'retry-price':schedulePrice(true);break;
 case 'close-modal':closeModal();break;case 'privacy':privacy();break;case 'privacy-inline':privacy(true);break;
 case 'copy-link':try{await navigator.clipboard.writeText($('#share-url').value);button.innerHTML=`${icon('check')} Gekopieerd`;}catch{$('#share-url').select();toast('Selecteer en kopieer de link.');}break;
 case 'process':openModal('Van idee naar extra ruimte.',`<ol class="process-list"><li><strong>Maak het jouw ontwerp</strong><p>Kies de buitenmaten, materialen en voorzieningen. Bekijk direct hoe je keuzes samenkomen.</p></li><li><strong>Bewaar je persoonlijke voorstel</strong><p>Download alle keuzes met een transparante voorbeeldberekening. Deel je ontwerp met je partner.</p></li><li><strong>Controleer de uitvoering samen</strong><p>Een adviseur beoordeelt de locatie, fundering, constructie, materiaalkeuzes en definitieve prijs vóór een opdracht.</p></li></ol>`);break;
 case 'reset':openModal('Opnieuw beginnen?',`<p>Je huidige ontwerp op dit apparaat wordt vervangen door de standaardkeuzes. Je opgeslagen voorstellen en deellinks blijven bestaan.</p><div class="modal-actions"><button class="button ghost" data-action="close-modal">Toch bewaren</button><button class="button primary" data-action="confirm-reset">Nieuw ontwerp</button></div>`);break;
 case 'confirm-reset':config={...catalog.defaults};contact={};result=null;requestKey=null;step=0;history.replaceState({},'',location.pathname);preview?.update(config);updatePreviewLabel();persist();schedulePrice(true);renderStep();closeModal();toast('Je kunt met een nieuw ontwerp beginnen.');break;
 case 'reset-camera':preview?.resetCamera();break;
 case 'dimensions':dimensionsVisible=!dimensionsVisible;preview?.setDimensions(dimensionsVisible);button.classList.toggle('active',dimensionsVisible);button.setAttribute('aria-pressed',dimensionsVisible);break;
 case 'roof':roofVisible=!roofVisible;preview?.setRoofVisible(roofVisible);button.classList.toggle('active',roofVisible);button.setAttribute('aria-pressed',roofVisible);break;
 case 'fullscreen':try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.preview-card').requestFullscreen();}catch{$('.preview-card').classList.toggle('expanded');preview?.resize();}break;
 }
});
document.addEventListener('change',e=>{
 const target=e.target,key=target.dataset.config;if(!key||!config)return;
 let value=target.value;
 if(target.type==='radio'){const option=optionsFor(fields[key],key).find(o=>String(o.id)===value);if(option)value=option.id;}
 else if(target.type==='number')value=Number(value);
 if(catalog.dimensions[key]){
   const d=catalog.dimensions[key];if(target.value===''||!Number.isInteger(value)||value<d.min||value>d.max){errors[key]=`Kies een hele waarde tussen ${d.min} en ${d.max} cm.`;target.setAttribute('aria-invalid','true');$(`#${key}-error`).textContent=errors[key];target.value=config[key];return;}
 }
 if(['ceilingLights','switches','spotlights'].includes(key)&&(!Number.isInteger(value)||value<0||value>(key==='spotlights'?12:2))){target.value=config[key];toast('Kies een geldig aantal.');return;}
 changeConfig(key,value);
});
document.addEventListener('input',e=>{
 const target=e.target,key=target.dataset.range;if(!key)return;
 const value=Number(target.value),d=catalog.dimensions[key];$(`#${key}`).value=value;target.style.setProperty('--fill',`${(value-d.min)/(d.max-d.min)*100}%`);target.setAttribute('aria-valuetext',`${value} centimeter`);
 changeConfig(key,value,{rerender:false});if($('#area-number'))$('#area-number').innerHTML=`${(config.width*config.depth/10000).toLocaleString('nl-NL',{maximumFractionDigits:2})} <small>m²</small>`;
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('.preview-card')?.classList.contains('expanded')){$('.preview-card').classList.remove('expanded');preview?.resize();}});

async function initialize(){
 try{
 catalog=await api('/catalog');fields=fieldsOf(catalog);config={...catalog.defaults};let restored=false;
 const token=new URLSearchParams(location.search).get('share');
 if(token){try{const shared=await api(`/share/${encodeURIComponent(token)}`);config=normalizedDraft(shared.config,catalog);restored=true;}catch(error){toast(`Deellink kon niet worden geladen: ${error.message}`);}}
 else{try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));if(saved?.version===catalog.schemaVersion&&saved.config){config=normalizedDraft(saved.config,catalog);restored=true;}}catch{/* Ignore corrupt or unavailable local draft. */}}
 shell();schedulePrice(true);
 try{const {Preview}=await import('./preview.js');$('#preview-scene').replaceChildren();preview=new Preview($('#preview-scene'),{onReady:({mode})=>setPreviewMode(mode),onError:()=>{setPreviewMode('2d');toast('3D is hier niet beschikbaar. Je kunt je ontwerp in 2D bekijken.');}});preview.update(config);window.__prefabPreview=preview;}catch(error){$('#preview-scene').innerHTML=`<div class="preview-unavailable">${icon('plan')}<p>De preview is niet beschikbaar.</p><p>Je kunt je ontwerp wel samenstellen en bewaren.</p></div>`;console.error('Preview initialization failed',error);}
 if(restored)toast(token?'Gedeeld ontwerp geladen. Maak het gerust verder van jou.':'Welkom terug. Je bewaarde ontwerp staat klaar.');
 }catch(error){app.setAttribute('aria-busy','false');app.innerHTML=`<div class="load-error">${icon('alert')}<h1>We kunnen je ontwerp nog niet laden.</h1><p>${esc(error.message)}</p><button class="button primary" id="reload">Opnieuw proberen ${icon('rotate')}</button></div>`;$('#reload').addEventListener('click',initialize);}
}
initialize();

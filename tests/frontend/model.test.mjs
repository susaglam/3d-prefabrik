import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STEPS, INTERIOR_FIELDS, fieldsOf, normalizedDraft, normalizeInterior, validDimensions, validateContact, escapeHTML, labelFor, fieldIsVisible} from '../../addons/cs_prefab_configurator/static/src/model.js';

const catalog = JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json', import.meta.url)));
const reference = JSON.parse(readFileSync(new URL('../../research/reference/configurator-definition.json', import.meta.url))).configurator;
const fields = fieldsOf(catalog);
const validContact = () => ({firstName:'Zoë', lastName:"D’Haene", email:'zoe@example.test', phone:'+31 6 12345678', address:'Nieuwe Gracht', houseNumber:'12-A', postcode:'1234 AB', city:'Utrecht', message:'Een werkplek met daglicht.'});

test('every source choice has exactly one canonical field and answer mapping', () => {
  const source = reference.steps.flatMap(step=>step.questions).filter(question=>question.metaData.answers);
  assert.equal(source.length,22);
  let answers=0;
  for (const question of source) {
    const matches=Object.values(fields).filter(field=>field.referenceQuestionId===question.id);
    assert.equal(matches.length,1,`Question ${question.name} must have one canonical mapping`);
    const field=matches[0];
    assert.deepEqual(new Set(field.options.filter(option=>option.referenceAnswerId).map(option=>option.referenceAnswerId)),new Set(question.metaData.answers.map(answer=>answer.id)),question.name);
    assert.equal(new Set(field.options.map(option=>`${typeof option.id}:${option.id}`)).size,field.options.length,`Duplicate canonical ids in ${field.key}`);
    answers+=field.options.filter(option=>option.referenceAnswerId).length;
  }
  assert.equal(answers,94);
});

test('every canonical product choice appears in the guided UI', () => {
  const visibleKeys=new Set(STEPS.flatMap(step=>step.fields));
  for (const field of Object.values(fields).filter(field=>field.referenceQuestionId)) assert.ok(visibleKeys.has(field.key),field.key);
});

test('source centimeter boundaries are preserved, with a separate fixed schematic height', () => {
  const source=reference.steps.flatMap(step=>step.questions).filter(q=>q.type==='NUMBER');
  for (const [key,label] of [['width','Breedte'],['depth','Diepte']]) {
    const rule=source.find(q=>q.name===label).metaData;
    assert.equal(catalog.dimensions[key].min,Number(rule.min));
    assert.equal(catalog.dimensions[key].max,Number(rule.max));
    assert.equal(catalog.dimensions[key].step,Number(rule.step));
  }
  assert.equal(catalog.dimensions.height.min,280);
  assert.equal(catalog.dimensions.height.max,280);
  assert.equal(catalog.dimensions.height.hidden,true);
});

test('missing, corrupt and array drafts recover to fresh canonical defaults', () => {
  for (const value of [undefined,null,false,17,'{"width":750}',[],[750,340]]) {
    const restored=normalizedDraft(value,catalog);
    assert.deepEqual(restored,catalog.defaults);
    assert.notEqual(restored,catalog.defaults);
  }
});

test('draft import discards untrusted fields, contact data and prototype-shaped keys', () => {
  const corrupt=JSON.parse('{"width":620,"email":"private@example.test","postcode":"1234 AB","contact":{"name":"Private"},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"price":1}');
  const restored=normalizedDraft(corrupt,catalog);
  assert.equal(restored.width,620);
  assert.equal(restored.postcode,'');
  assert.equal(Object.hasOwn(restored,'email'),false);
  assert.equal(Object.hasOwn(restored,'contact'),false);
  assert.equal(Object.hasOwn(restored,'__proto__'),false);
  assert.equal(Object.hasOwn(restored,'price'),false);
  assert.equal({}.polluted,undefined);
  assert.deepEqual(Object.keys(restored).sort(),Object.keys(catalog.defaults).sort());
});

test('draft import accepts inclusive dimension bounds and rejects coercion/non-finite numbers', () => {
  for(const [key,rule] of Object.entries(catalog.dimensions)) {
    for(const value of [rule.min,rule.max]) assert.equal(normalizedDraft({[key]:value},catalog)[key],value);
    for(const value of [rule.min-1,rule.max+1,NaN,Infinity,-Infinity,String(rule.min),null,true,[],{},rule.min+.5]) assert.equal(normalizedDraft({[key]:value},catalog)[key],catalog.defaults[key],`${key}: ${String(value)}`);
  }
});

test('draft import preserves all canonical numeric and boolean option types', () => {
  for(const key of ['piles','ceilingLights','switches','spotlights','interior','plaster','screed','underfloorHeating','demolition']) {
    for(const option of fields[key].options) {
      const restored=normalizedDraft({interior:true,[key]:option.id},catalog);
      assert.equal(restored[key],option.id,`${key} ${option.id}`);
      assert.equal(typeof restored[key],typeof option.id);
    }
  }
});

test('discrete pile catalogue never imports a nonexistent five-pile option', () => {
  assert.equal(normalizedDraft({piles:5},catalog).piles,catalog.defaults.piles);
  for(const key of ['piles','ceilingLights','switches','spotlights']) {
    const valid=fields[key].options.at(-1).id;
    assert.equal(normalizedDraft({interior:true,[key]:String(valid)},catalog)[key],catalog.defaults[key]);
  }
});

test('unknown and object option values cannot be rendered as product selections', () => {
  for(const key of ['facade','rooflight','frontOpening','outsideSocket','access']) for(const value of ['<img src=x onerror=alert(1)>','unknown',{id:fields[key].options[0].id},['none']]) assert.equal(normalizedDraft({[key]:value},catalog)[key],catalog.defaults[key]);
});

test('turning off interior clears all priced hidden choices without changing exterior choices or inputs', () => {
  const selected={...catalog.defaults,interior:false,facade:'wood-vertical',outsideLight:'both',plaster:true,screed:true,underfloorHeating:true,heating:'both',ceilingLights:2,switches:2,spotlights:2,sockets:'both',ceilingPositions:['left','center'],spotPositions:['r1c1','r1c2'],socketPositions:['L2','R2']};
  const before=structuredClone(selected);
  const normalized=normalizeInterior(selected,catalog.defaults);
  for(const key of INTERIOR_FIELDS) assert.deepEqual(normalized[key],catalog.defaults[key],key);
  assert.equal(normalized.facade,'wood-vertical');assert.equal(normalized.outsideLight,'both');
  assert.deepEqual(selected,before);assert.notEqual(normalized,selected);
  const enabled=normalizeInterior({...selected,interior:true},catalog.defaults);
  assert.equal(enabled.spotlights,2);assert.equal(enabled.heating,'both');
});

test('hidden interior payloads from stored drafts are cleared on restore', () => {
  const restored=normalizedDraft({interior:false,spotlights:12,plaster:true,sockets:'both'},catalog);
  assert.equal(restored.spotlights,0);assert.equal(restored.plaster,false);assert.equal(restored.sockets,'none');
});

test('dimension validation rejects unsupported model states and accepts the full source interval', () => {
  assert.ok(validDimensions({...catalog.defaults,width:150,depth:100},catalog));
  assert.ok(validDimensions({...catalog.defaults,width:750,depth:340},catalog));
  for(const change of [{width:149},{width:751},{depth:99},{depth:341},{height:281},{width:150.5},{width:'500'},{depth:NaN},{height:undefined}]) assert.equal(validDimensions({...catalog.defaults,...change},catalog),false);
});

test('contact validation accepts ordinary Dutch addresses and international notation', () => {
  assert.deepEqual(validateContact(validContact()),{});
  assert.deepEqual(validateContact({...validContact(),postcode:'1234ab',houseNumber:'12 bis',phone:'0031 6 12345678'}),{});
});

test('contact validation reports all missing required fields', () => {
  assert.deepEqual(Object.keys(validateContact({})).sort(),['firstName','lastName','email','phone','address','houseNumber','postcode','city'].sort());
  const empty=Object.fromEntries(Object.keys(validContact()).map(key=>[key,'   ']));
  for(const key of ['firstName','lastName','email','phone','address','houseNumber','postcode','city']) assert.ok(validateContact(empty)[key],key);
});

test('contact validation rejects syntactically invalid email, phone, postcode and house number', () => {
  const cases=[['email','name@'],['email','name@example'],['email','<name>@example.test'],['phone','........'],['phone','123'],['phone','abcd12345678'],['postcode','0000 AB'],['postcode','12345 AB'],['postcode','1234 ABC'],['houseNumber','banana'],['houseNumber','12<script>']];
  for(const [key,value] of cases) assert.ok(validateContact({...validContact(),[key]:value})[key],`${key}: ${value}`);
});

test('malformed contact field types produce field errors instead of throwing', () => {
  for(const key of ['firstName','lastName','email','phone','address','houseNumber','postcode','city']) for(const value of [null,123,{},[],true]) {
    let errors;assert.doesNotThrow(()=>{errors=validateContact({...validContact(),[key]:value});},`${key}: ${value}`);
    assert.ok(errors[key],`${key}: ${value}`);
  }
});

test('HTML escaping protects both attribute and text contexts without losing ordinary text', () => {
  assert.equal(escapeHTML('<img src=x onerror="alert(1)"> & \'quote\''),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quote&#39;');
  assert.equal(escapeHTML('Zoë & D’Haene'),'Zoë &amp; D’Haene');
  assert.equal(escapeHTML(null),'');assert.equal(escapeHTML(undefined),'');assert.equal(escapeHTML(0),'0');
});

test('labels resolve typed numeric/boolean options without truthiness errors', () => {
  assert.equal(labelFor(fields,'spotlights',0),'Geen');
  assert.equal(labelFor(fields,'spotlights',12),'12 spotjes');
  assert.equal(labelFor(fields,'piles',6),'6 heipalen');
  assert.equal(labelFor(fields,'interior',false),'Dit is niet nodig');
  assert.equal(labelFor(fields,'interior',true),'Stel aanbouw binnenzijde samen');
});


test('multiselect imports reject invalid or duplicate placements and derive commercial counts', () => {
 const selected=normalizedDraft({interior:true,ceilingPositions:['right','left'],spotPositions:['r1c1','r3c5'],socketPositions:['L1','R2'],ceilingLights:999,spotlights:999},catalog);
 assert.deepEqual(selected.ceilingPositions,['left','right']);
 assert.equal(selected.ceilingLights,2);assert.equal(selected.spotlights,2);assert.equal(selected.sockets,'both');
 for(const value of [['L1','L1'],['unknown'],[null],{L1:true},'L1'])assert.deepEqual(normalizedDraft({interior:true,socketPositions:value},catalog).socketPositions,[]);
 selected.socketPositions.push('R3');assert.deepEqual(catalog.defaults.socketPositions,[]);
});

test('legacy counts migrate to placements only when the new placement array is absent', () => {
 assert.equal(normalizedDraft({interior:true,spotlights:12},catalog).spotPositions.length,12);
 const explicit=normalizedDraft({interior:true,spotlights:12,spotPositions:[]},catalog);
 assert.deepEqual(explicit.spotPositions,[]);assert.equal(explicit.spotlights,0);
 assert.deepEqual(normalizedDraft({interior:true,sockets:'both'},catalog).socketPositions,['L2','R2']);
});

test('dependent product choices clear while view preferences cannot enter a commercial draft', () => {
 const restored=normalizedDraft({interior:true,plaster:false,painting:true,overhang:'none',overhangSpots:5,rooflight:'none',roofShade:true,examplesVisible:false,scope:[{productIncluded:true}]},catalog);
 assert.equal(restored.painting,false);assert.equal(restored.overhangSpots,0);
 // 2.16.0: zonwering is retired, so a draft that still carries one loses the key altogether rather than
 // keeping a false that no field can show (services/catalog.py RETIRED_FIELDS).
 assert.equal(Object.hasOwn(restored,'roofShade'),false);
 assert.equal(Object.hasOwn(restored,'examplesVisible'),false);assert.equal(Object.hasOwn(restored,'scope'),false);
 assert.equal(fieldIsVisible('painting',restored,fields),false);assert.equal(fieldIsVisible('ceilingLights',restored,fields),false);
 assert.equal(fieldIsVisible('socketPositions',restored,fields),true);
 assert.equal(labelFor(fields,'socketPositions',['L1','R2']),fields.socketPositions.options.find(o=>o.id==='L1').label+', '+fields.socketPositions.options.find(o=>o.id==='R2').label);
});

test('the rollaag toggle is retired: old drafts drop it, keep their finish, and the field is always shown', () => {
 const legacy=normalizedDraft({rollaagEnabled:false,rollaag:'panel-black'},catalog);
 assert.equal(Object.hasOwn(legacy,'rollaagEnabled'),false,'the retired key never reaches the server');assert.equal(legacy.rollaag,'panel-black');
 assert.equal(fieldIsVisible('rollaag',legacy,fields),true);
 assert.equal(Object.hasOwn(catalog.defaults,'rollaagEnabled'),false);assert.equal(fields.rollaagEnabled,undefined);
 assert.equal(fields.rollaag.visibleWhen,undefined,'the finish no longer depends on a toggle');
 assert.ok(!STEPS[0].fields.includes('rollaagEnabled')&&STEPS[0].fields.includes('rollaag'));
});

import test from 'node:test';import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {FINISHES,PREFAB_FACADES,finishColor,shadeHex} from '../../addons/cs_prefab_configurator/static/src/finishes.js';
import {MATERIALS} from '../../addons/cs_prefab_configurator/static/src/model.js';
import {FACADE_FINISHES} from '../../addons/cs_prefab_configurator/static/src/environment.js';

const src=fileURLToPath(new URL('../../addons/cs_prefab_configurator/static/src/',import.meta.url));
const catalog=JSON.parse(await readFile(fileURLToPath(new URL('../../addons/cs_prefab_configurator/data/catalog.json',import.meta.url)),'utf8'));
const facadeField=catalog.groups.flatMap(group=>group.fields).find(field=>field.key==='facade');

test('finishes.js is the catalogue of every facade code the aanbouw offers plus the two the house adds',()=>{
 assert.deepEqual(PREFAB_FACADES,facadeField.options.map(option=>option.id),'the aanbouw list IS catalog.json, in its order');
 assert.deepEqual(Object.keys(FINISHES),[...PREFAB_FACADES,'render-white','render-grey'],'stucwerk wit/grijs exist only for the existing house');
 for(const [code,finish] of Object.entries(FINISHES)){
  assert.match(finish.color,/^#[0-9a-f]{6}$/,`${code}: a full lowercase hex, so a string compare is a colour compare`);
  assert.ok(finish.type.length>0,`${code}: a swatch pattern`);
  assert.ok(Object.isFrozen(finish),`${code}: frozen, so no caller can retint the shared table`);
 }
 assert.ok(Object.isFrozen(FINISHES));
 assert.equal(finishColor('brick-black'),FINISHES['brick-black'].color);
 assert.equal(finishColor('gold'),'#a6a59e','an unknown code never throws; it gets the neutral swatch grey');
});

test('model.js MATERIALS is a view on that table, not a second copy of it',()=>{
 assert.deepEqual(Object.keys(MATERIALS),PREFAB_FACADES);
 for(const code of PREFAB_FACADES)assert.equal(MATERIALS[code],FINISHES[code],`${code}: the very same object, so the two can never drift`);
 assert.ok(Object.isFrozen(MATERIALS));
});

test('every house finish chip is the same colour as the aanbouw chip for the same finish',()=>{
 for(const item of FACADE_FINISHES){
  assert.ok(FINISHES[item.id],`${item.id}: a known finish`);
  assert.equal(item.color,FINISHES[item.id].color,`${item.id}: chip colour comes from the one table`);
  assert.equal(item.pattern,FINISHES[item.id].type,`${item.id}: swatch pattern comes from the one table`);
  assert.ok(Object.isFrozen(item));
 }
 // The customer's request in one assertion: every baksteen the aanbouw can wear, the existing house can wear too.
 const bricks=PREFAB_FACADES.filter(code=>code.startsWith('brick'));
 assert.deepEqual(FACADE_FINISHES.filter(item=>item.id.startsWith('brick')).map(item=>item.id),bricks);
 for(const item of FACADE_FINISHES.filter(item=>item.id.startsWith('brick')))
  assert.equal(item.label,facadeField.options.find(option=>option.id===item.id).label,`${item.id}: the same brick is called the same thing in both forms`);
 assert.deepEqual(FACADE_FINISHES.filter(item=>!item.id.startsWith('brick')).map(item=>item.id),['render-white','render-grey'],'no wood or pvc on a 1970s rijwoning');
});

test('shadeHex darkens by a whole step per channel and clamps instead of wrapping',()=>{
 assert.equal(shadeHex('#e4e1d9',8),'#dcd9d1','the stucwerk-wit neighbour tint preview.js used to hardcode');
 assert.equal(shadeHex('#b9bdbc',8),'#b1b5b4','the stucwerk-grijs neighbour, 1/255 off the hardcoded #b2b6b5 it replaces');
 assert.equal(shadeHex('#000000',8),'#000000','clamped at black, never wrapped to white');
 assert.equal(shadeHex('#ffffff',-8),'#ffffff','clamped at white');
 assert.equal(shadeHex('#0a0b0c',0),'#0a0b0c');
});

/**
 * The ratchet. Everything above compares the three tables to each other and would still pass if a fourth copy of a
 * hex appeared somewhere new — which is exactly how brick-red ended up with two different chips in the first place.
 * This one has a different failure mode: it reads the source and fails on the LITERAL, wherever it is written.
 * Comments are stripped first (a block comment naming a retired hex is documentation, not a second truth).
 */
test('no finish colour is spelled out anywhere in static/src except finishes.js',async()=>{
 const files=(await readdir(src)).filter(name=>name.endsWith('.js')&&name!=='finishes.js');
 assert.ok(files.length>10,'the scan actually found the source tree');
 const colours=[...new Set(Object.values(FINISHES).map(finish=>finish.color))];
 const offenders=[];
 for(const name of files){
  const code=(await readFile(join(src,name),'utf8')).replaceAll(/\/\*[\s\S]*?\*\//g,'').replaceAll(/^[ \t]*(\/\/|\*).*$/gm,'');
  for(const colour of colours)if(code.toLowerCase().includes(colour))offenders.push(`${name} carries ${colour}`);
 }
 assert.deepEqual(offenders,[],'import it from finishes.js instead of writing the hex again');
});

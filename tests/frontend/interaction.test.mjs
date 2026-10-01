import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dimensionLimits,dimensionValue,profileConstraint} from '../../addons/cs_prefab_configurator/static/src/interaction.js';
const catalog=JSON.parse(readFileSync(new URL('../../addons/cs_prefab_configurator/data/catalog.json',import.meta.url)));
test('selected sliding door enforces 230 cm in every dimension commit and unlocks after choosing no opening',()=>{
 const config={...catalog.defaults,frontOpening:'sliding-2-black',rooflight:'none'};
 const limits=dimensionLimits(config,catalog,'width');assert.equal(limits.min,230);
 for(const value of [150,229,'229',200])assert.equal(dimensionValue(value,limits),230);
 assert.equal(dimensionValue(231,limits),231);assert.equal(dimensionValue('',limits),null);
 assert.equal(dimensionLimits({...config,frontOpening:'none'},catalog,'width').min,150);
});
test('opening choices immediately reflect current width and administrator profile limits',()=>{
 const local=structuredClone(catalog);local.geometryRules.openingProfiles['sliding-2'].minWidthCm=245;
 const config={...catalog.defaults,width:244,frontOpening:'none',rooflight:'none'};
 assert.match(profileConstraint('frontOpening','sliding-2-white',config,local),/245 cm/);
 assert.equal(profileConstraint('frontOpening','sliding-2-white',{...config,width:245},local),'');
 assert.match(profileConstraint('frontOpening','folding-black',{...config,width:230},local),/370 cm/);
});
test('selected roof and opening jointly bound width and depth, including administrator upper bounds',()=>{
 const local=structuredClone(catalog);local.geometryRules.openingProfiles['sliding-2'].maxWidthCm=600;
 const config={...catalog.defaults,frontOpening:'sliding-2-black',rooflight:'gable-8'};
 assert.equal(dimensionLimits(config,local,'width').min,385);
 assert.equal(dimensionLimits(config,local,'width').max,600);
 assert.equal(dimensionLimits(config,local,'depth').min,230);
 assert.equal(dimensionValue(210,dimensionLimits(config,local,'depth')),230);
 assert.match(profileConstraint('frontOpening','sliding-2-black',{...config,width:601},local),/600 cm/);
});
test('an empty intersection is reported and step alignment never slips below a profile minimum',()=>{
 const local=structuredClone(catalog);local.dimensions.width.step=10;
 const config={...catalog.defaults,frontOpening:'none',rooflight:'lean-2'};
 assert.equal(dimensionLimits(config,local,'width').min,250);
 assert.equal(dimensionValue(249,dimensionLimits(config,local,'width')),250);
 local.geometryRules.openingProfiles.none.maxWidthCm=200;
 assert.equal(dimensionLimits(config,local,'width').available,false);
 assert.equal(dimensionValue(250,dimensionLimits(config,local,'width')),null);
});
test('dimension buttons move in both directions with a 25 cm administrator step',()=>{
 const local=structuredClone(catalog);local.dimensions.width.step=25;
 const limits=dimensionLimits({...catalog.defaults,frontOpening:'none',rooflight:'none'},local,'width');
 assert.equal(limits.increment,25);
 assert.equal(dimensionValue(300+limits.increment,limits),325);
 assert.equal(dimensionValue(300-limits.increment,limits),275);
 assert.equal(dimensionValue(limits.max+limits.increment,limits),limits.max);
 assert.equal(dimensionValue(limits.min-limits.increment,limits),limits.min);
});
test('button increments use the nearest positive step multiple and preserve an odd administrator grid',()=>{
 for(const [step,increment]of [[1,10],[4,12],[6,12],[7,7],[25,25]]){
  const local=structuredClone(catalog);Object.assign(local.dimensions.width,{min:151,step});
  const limits=dimensionLimits({...catalog.defaults,frontOpening:'french-black',rooflight:'none'},local,'width');
  assert.equal(limits.increment,increment);
  const value=limits.min+increment*3,larger=dimensionValue(value+limits.increment,limits),smaller=dimensionValue(value-limits.increment,limits);
  assert.equal(larger-value,increment);assert.equal(value-smaller,increment);
  assert.equal((larger-151)%step,0);assert.equal((smaller-151)%step,0);
 }
});

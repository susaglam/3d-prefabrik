import test from 'node:test';import assert from 'node:assert/strict';
import {renderTier} from '../../addons/cs_prefab_configurator/static/src/render_state.js';

// Two reference devices: a 1440 px desktop with a discrete GPU and a 390 px phone (touch, WebGL2 with float targets).
const desktop={width:1440,webgl2:true,halfFloat:true,maxSamples:8,coarsePointer:false,shortSide:1080};
const phone={width:390,webgl2:true,halfFloat:true,maxSamples:4,coarsePointer:true,shortSide:390};

test('a capable desktop gets the full tier, a phone the compact tier',()=>{
 assert.equal(renderTier(desktop),'full');
 assert.equal(renderTier(phone),'compact');
});

test('forced wins over every measurement; anything that is not exactly full/compact is auto',()=>{
 assert.equal(renderTier({...phone,forced:'full'}),'full','document capture forces full on a phone');
 assert.equal(renderTier({...desktop,forced:'compact'}),'compact','tier parity screenshots force compact on a desktop');
 assert.equal(renderTier({...phone,webgl2:false,halfFloat:false,forced:'full'}),'full','forced full even without float targets: the composer framebuffer probe is the safety net');
 for(const forced of [null,undefined,'','auto','FULL','Full',' full',1,true,{}]){
  assert.equal(renderTier({...desktop,forced}),'full',`desktop, forced ${String(forced)}`);
  assert.equal(renderTier({...phone,forced}),'compact',`phone, forced ${String(forced)}`);
 }
 assert.equal(renderTier({...desktop,forced:'COMPACT'}),'full','forced is case-sensitive');
});

test('WebGL1 or missing float render targets fall back to compact',()=>{
 assert.equal(renderTier({...desktop,webgl2:false}),'compact');
 assert.equal(renderTier({...desktop,halfFloat:false}),'compact');
 assert.equal(renderTier({...desktop,webgl2:undefined}),'compact','an unknown capability is never assumed');
 assert.equal(renderTier({...desktop,halfFloat:undefined}),'compact');
 assert.equal(renderTier({...desktop,webgl2:null,halfFloat:null}),'compact');
});

test('the container must be at least 600 CSS px wide',()=>{
 assert.equal(renderTier({...desktop,width:599}),'compact');
 assert.equal(renderTier({...desktop,width:599.9}),'compact');
 assert.equal(renderTier({...desktop,width:600}),'full');
 assert.equal(renderTier({...desktop,width:601}),'full');
 for(const width of [0,-1,NaN,undefined,null,'abc'])assert.equal(renderTier({...desktop,width}),'compact',`width ${String(width)}`);
 assert.equal(renderTier({...desktop,width:'800'}),'full','a numeric string (dataset/query override) is accepted');
});

test('touch devices: a short side under 800 px is a phone; a wide touch screen keeps the full tier',()=>{
 assert.equal(renderTier({...desktop,coarsePointer:true,shortSide:390}),'compact','phone in landscape with a wide container is still a phone');
 assert.equal(renderTier({...desktop,coarsePointer:true,shortSide:799}),'compact');
 assert.equal(renderTier({...desktop,coarsePointer:true,shortSide:800}),'full','tablet / touch laptop');
 assert.equal(renderTier({...desktop,coarsePointer:true,shortSide:1080}),'full','desktop with a touch screen');
 assert.equal(renderTier({...desktop,coarsePointer:false,shortSide:390}),'full','a small screen with a mouse is not a phone');
 assert.equal(renderTier({...desktop,coarsePointer:true,shortSide:undefined}),'full','an unknown screen size is not assumed to be a phone');
 assert.equal(renderTier({...desktop,coarsePointer:true,shortSide:null}),'full');
 assert.equal(renderTier({...desktop,coarsePointer:true,shortSide:NaN}),'full');
 assert.equal(renderTier({...desktop,coarsePointer:'yes',shortSide:390}),'compact','coarsePointer is read as a boolean');
});

test('maxSamples is reported alongside the tier and never gates it',()=>{
 for(const maxSamples of [0,1,2,4,8,16,undefined,null])assert.equal(renderTier({...desktop,maxSamples}),'full',`maxSamples ${String(maxSamples)}`);
 assert.equal(renderTier({...phone,maxSamples:16}),'compact');
});

test('only the two tier names are ever returned; no facts at all means compact',()=>{
 assert.equal(renderTier(),'compact');
 assert.equal(renderTier({}),'compact');
 assert.equal(renderTier(undefined),'compact');
 // Second control with a different failure pattern: the full grid against the decision-document rule.
 const widths=[0,599,600,1440],bools=[false,true],sides=[390,799,800,1440];
 let full=0,compact=0;
 for(const width of widths)for(const webgl2 of bools)for(const halfFloat of bools)for(const coarsePointer of bools)for(const shortSide of sides){
  const tier=renderTier({width,webgl2,halfFloat,coarsePointer,shortSide});
  assert.ok(tier==='full'||tier==='compact',tier);
  const expected=webgl2&&halfFloat&&width>=600&&!(coarsePointer&&shortSide<800)?'full':'compact';
  assert.equal(tier,expected,JSON.stringify({width,webgl2,halfFloat,coarsePointer,shortSide}));
  if(tier==='full')full++;else compact++;
 }
 assert.equal(full,2*1*1*(4+2),'2 wide widths × webgl2 × halfFloat × (fine pointer: 4 sides + coarse: 2 wide sides)');
 assert.equal(full+compact,widths.length*2*2*2*sides.length);
});

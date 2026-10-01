import test from 'node:test';import assert from 'node:assert/strict';
import {houseTypeIcon,alignmentIcon} from '../../addons/cs_prefab_configurator/static/src/house_type_icons.js';
import {HOUSE_TYPES,ALIGNMENTS} from '../../addons/cs_prefab_configurator/static/src/environment.js';

const count=(markup,pattern)=>markup.match(pattern)?.length||0;
// Your own house is drawn with the ink stroke; the neighbours with the light one.
const own=markup=>count(markup,/stroke="#5f6e6a"/g);

test('every house type in the catalogue has its own drawing, and an unknown id falls back to the row',()=>{
 for(const {id} of HOUSE_TYPES){
  const markup=houseTypeIcon(id);
  assert.match(markup,/^<svg class="house-type-icon" viewBox="0 0 112 64"/,id);
  assert.match(markup,new RegExp(`data-house-type="${id}"`),id);
  assert.match(markup,/aria-hidden="true"/,id+': the tile label carries the meaning, the drawing is decorative');
  assert.ok(own(markup)>0,id+': your own house is drawn in ink');
 }
 for(const id of ['','castle',undefined,null,'TERRACED'])assert.match(houseTypeIcon(id),/data-house-type="terraced"/,String(id));
});

test('the three drawings differ in exactly the thing the choice is about: the neighbours',()=>{
 const terraced=houseTypeIcon('terraced'),semi=houseTypeIcon('semi'),detached=houseTypeIcon('detached');
 const walls=markup=>count(markup,/<rect [^>]*height="25"/g),fences=markup=>count(markup,/stroke="#b2b9b0"/g);
 assert.equal(walls(terraced),3,'a row: your house between two neighbours');
 assert.equal(walls(semi),2,'a pair: one neighbour');
 assert.equal(walls(detached),1,'free standing: no neighbour wall');
 assert.equal(fences(terraced),0,'a row has no side garden to fence');
 assert.equal(fences(semi),1,'one free side');
 assert.equal(fences(detached),2,'fenced left and right');
 assert.notEqual(terraced,semi);assert.notEqual(semi,detached);
});

test('the roof crosses the party wall, because that is what the type names mean',()=>{
 // The row shares one ridge line at y = 16 across all three bays; the pair meets in one apex over the party wall.
 assert.equal(count(houseTypeIcon('terraced'),/,16 /g)+count(houseTypeIcon('terraced'),/,16"/g),6,'three roof stretches at the same ridge height');
 assert.match(houseTypeIcon('semi'),/48,13/,'the pair ridge sits over the party wall at x = 48');
 assert.equal(count(houseTypeIcon('semi'),/48,13/g),2,'both halves meet at that one apex');
});

test('the alignment mark moves the extension along the facade and defaults to the middle',()=>{
 const x=id=>alignmentIcon(id).match(/<rect x="([\d.]+)" y="6\.2"/)?.[1]??null;
 const positions=ALIGNMENTS.map(item=>x(item.id));
 assert.deepEqual(positions,['3','13.5','24'],'left, center, right in catalogue order');
 assert.equal(new Set(positions).size,3,'each position is visibly different');
 for(const {id} of ALIGNMENTS)assert.match(alignmentIcon(id),new RegExp(`data-alignment="${id}"`),id);
 for(const id of ['','middle',undefined,0])assert.match(alignmentIcon(id),/data-alignment="center"/,String(id));
});

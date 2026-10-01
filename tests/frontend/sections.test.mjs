import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionDone,sectionSummary,openGroupId,nextGroupId} from '../../addons/cs_prefab_configurator/static/src/sections.js';

test('a section is done when every field has a real choice or when it was visited',()=>{
 assert.equal(sectionDone(['brick-red','continue','sliding-2-black']),true);
 assert.equal(sectionDone(['brick-red','none']),false);
 assert.equal(sectionDone([false,'left']),false);
 assert.equal(sectionDone([true,'left']),true);
 assert.equal(sectionDone([[],'both']),false);
 assert.equal(sectionDone([['L1'],'both']),true);
 assert.equal(sectionDone([0,'both']),false);
 assert.equal(sectionDone([2,'both']),true);
 assert.equal(sectionDone([],false),false);
 assert.equal(sectionDone(['none',false],true),true);
});

test('the header summary joins all labels and truncates at a label boundary',()=>{
 assert.equal(sectionSummary(['Baksteen rood','Rollaag','Zwart']),'Baksteen rood · Rollaag · Zwart');
 assert.equal(sectionSummary(['Baksteen rood','',null,'Zwart']),'Baksteen rood · Zwart');
 const long=sectionSummary(['Baksteen rood genuanceerd','Rollaag doorlopend','Aluminium zwart','Schuifpui 4-delig zwart'],40);
 assert.equal(long,'Baksteen rood genuanceerd …');
 assert.ok(long.length<=40);
 const single=sectionSummary(['Een uitzonderlijk lange optienaam die niet past'],20);
 assert.ok(single.endsWith(' …'));assert.ok(single.length<=20);
 assert.equal(sectionSummary([]),'');
});

test('the most recently added id of a step is the open one; other steps are ignored',()=>{
 const set=new Set(['dimensions','facade']);
 assert.equal(openGroupId(set,['facade','roof','outside']),'facade');
 set.add('roof');
 assert.equal(openGroupId(set,['facade','roof','outside']),'roof');
 assert.equal(openGroupId(set,['finish','heating']),null);
 set.delete('roof');set.add('roof');set.add('finish');
 assert.equal(openGroupId(set,['facade','roof','outside']),'roof');
 assert.equal(openGroupId(set,['finish','heating']),'finish');
});

test('next section follows the visible order and is null after the last one',()=>{
 const ids=['facade','roof','outside'];
 assert.equal(nextGroupId(ids,'facade'),'roof');
 assert.equal(nextGroupId(ids,'roof'),'outside');
 assert.equal(nextGroupId(ids,'outside'),null);
 assert.equal(nextGroupId(ids,'missing'),null);
 assert.equal(nextGroupId([],'facade'),null);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {viewpointIcon,toolIcon,TOOL_DRAWINGS,STANDPOINT_VIEWS} from '../../addons/cs_prefab_configurator/static/src/scene_icons.js';
import {scenarioIcon,qualityIcon} from '../../addons/cs_prefab_configurator/static/src/view_icons.js';
import {SCENARIOS} from '../../addons/cs_prefab_configurator/static/src/environment.js';

// The standpoints the popover offers (app.js VIEWPOINT_GROUPS) and the tools the toolbar draws (app.js shell()).
const VIEWS=['perspective','perspective-left','front','top','interior','ceiling','cutaway'];
const TOOLS=['viewpoints','environment','material-detail','process','dimensions','roof','roof-off','reset-camera','weergave','fullscreen'];
const body=markup=>markup.replace(/^<svg[^>]*>/,'');
const viewBox=markup=>markup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
/** Every explicit coordinate a drawing places (polygon corners, circle extents, line ends), as [x, y] pairs. */
function placed(markup){
 const out=[];
 for(const [,list] of markup.matchAll(/points="([^"]+)"/g))for(const pair of list.trim().split(/\s+/))out.push(pair.split(',').map(Number));
 for(const [,cx,cy,r] of markup.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g))out.push([+cx-+r,+cy-+r],[+cx+ +r,+cy+ +r]);
 for(const [,x1,y1,x2,y2] of markup.matchAll(/x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g))out.push([+x1,+y1],[+x2,+y2]);
 return out;
}

test('every standpoint of the popover has its own drawing, and an unknown view falls back to the opening one',()=>{
 assert.deepEqual([...STANDPOINT_VIEWS],VIEWS,'the gallery list is the popover list');
 const drawings=new Set();
 for(const view of VIEWS){
  const markup=viewpointIcon(view);
  assert.match(markup,/^<svg class="viewpoint-icon" viewBox="0 0 96 68"/,view);
  assert.match(markup,new RegExp('data-standpoint="'+view+'"'),view);
  assert.doesNotMatch(markup,/NaN|undefined/,view);
  drawings.add(body(markup));
 }
 assert.equal(drawings.size,VIEWS.length,'no two standpoints look the same');
 assert.equal(body(viewpointIcon('perspective-right')),body(viewpointIcon('perspective')),'the old right-hand name draws the opening standpoint');
 assert.match(viewpointIcon('nonsense'),/data-standpoint="perspective"/);
});

test('a standpoint drawing never carries data-view: the app treats every [data-view] as a standpoint button',()=>{
 // 2.10.7, measured: with data-view on the svg the popover counted 14 "buttons" for 7 tiles, setSceneView stamped
 // aria-pressed on the drawings, and a script's [data-view=front] matched two elements.
 for(const view of VIEWS)assert.doesNotMatch(viewpointIcon(view),/data-view=/,view);
});

test('every standpoint drawing, eye included, stays inside its box',()=>{
 for(const view of VIEWS){
  const markup=viewpointIcon(view),[width,height]=viewBox(markup),points=placed(markup);
  assert.ok(points.length>20,view);
  for(const [x,y] of points)assert.ok(x>=0&&x<=width&&y>=0&&y<=height,`${view}: ${x},${y} outside ${width}×${height}`);
 }
});

test('the aanbouw keeps one size and place in every outside standpoint, so only the eye moves',()=>{
 // The eye is the only <circle> pair and the cone the only polygon with opacity; everything before it is the scene.
 const scene=view=>body(viewpointIcon(view)).split('<polygon points').filter(part=>!part.includes('opacity=".45"')).slice(0,8).join();
 for(const view of ['perspective-left','front','top'])assert.equal(scene(view),scene('perspective'),view);
});

test('every camera tool has its own drawing inside a 40 × 32 box, and an unknown action falls back',()=>{
 assert.deepEqual([...TOOL_DRAWINGS].sort(),[...TOOLS].sort());
 const drawings=new Set();
 for(const action of TOOLS){
  const markup=toolIcon(action),[width,height]=viewBox(markup);
  assert.match(markup,/^<svg class="tool-icon" viewBox="0 0 40 32"/,action);
  assert.match(markup,new RegExp('data-tool="'+action+'"'),action);
  assert.doesNotMatch(markup,/NaN|undefined|data-view=/,action);
  for(const [x,y] of placed(markup))assert.ok(x>=-.01&&x<=width+.01&&y>=-.01&&y<=height+.01,`${action}: ${x},${y} outside ${width}×${height}`);
  drawings.add(body(markup));
 }
 assert.equal(drawings.size,TOOLS.length,'no two tools look the same');
 assert.notEqual(body(toolIcon('roof')),body(toolIcon('roof-off')),'the roof button draws its state');
 assert.match(toolIcon('nonsense'),/data-tool="viewpoints"/);
});

test('the Weergave drawings cover every scenario and quality, with a fallback for unknown ids',()=>{
 for(const {id} of SCENARIOS)assert.match(scenarioIcon(id),new RegExp('^<svg class="scenario-icon" viewBox="0 0 112 64".*data-id="'+id+'"'),id);
 assert.match(scenarioIcon('garage'),/data-id="none"/);
 assert.equal(new Set(SCENARIOS.map(({id})=>body(scenarioIcon(id)))).size,SCENARIOS.length);
 for(const id of ['auto','full','compact'])assert.match(qualityIcon(id),new RegExp('^<svg class="quality-icon".*data-id="'+id+'"'),id);
 assert.match(qualityIcon('ultra'),/data-id="auto"/);
 for(const markup of [...SCENARIOS.map(({id})=>scenarioIcon(id)),qualityIcon('auto'),qualityIcon('full'),qualityIcon('compact')])assert.doesNotMatch(markup,/data-view=|NaN|undefined/);
});

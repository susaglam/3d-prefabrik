import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceTokens, contrast, rgb, applyAppearance, getFeatures, getSceneContent, safeExitUrl } from '../../addons/cs_prefab_configurator/static/src/theme.js';
import { DEFAULT_SCENE_CONTENT ,DOCUMENT_PARTS} from '../../addons/cs_prefab_configurator/static/src/scene_content.js';

test('native CSS colors map to form tokens with actual website typefaces',()=>{
  const tokens=appearanceTokens({colors:{action:'rgb(81, 38, 113)',text:'rgb(20, 20, 20)',surface:'rgb(255,255,255)'},font:'Roboto, sans-serif',headingFont:'Georgia, serif',buttonFont:'Inter, sans-serif',fontSize:18});
  assert.equal(tokens['--green'],'#512671'); assert.equal(tokens['--text'],'#141414');
  assert.equal(tokens['--font'],'Roboto, sans-serif'); assert.equal(tokens['--font-heading'],'Georgia, serif');
  assert.equal(tokens['--font-button'],'Inter, sans-serif'); assert.equal(tokens['--font-size'],'18px');
  assert.ok(contrast(tokens['--on-action'],tokens['--green'])>=4.5);
});
test('unreadable native colors are repaired and malformed appearance cannot become CSS',()=>{
  const tokens=appearanceTokens({colors:{surface:'#ffffff',muted:'#dddddd',action:'#ffffff',on_action:'#ffffff',text:'url(https://example.test)'},font:'Arial; background:red',headingFont:'<style>bad</style>',fontSize:60});
  assert.ok(contrast(tokens['--muted'],tokens['--paper'])>=4.5);
  assert.ok(contrast(tokens['--on-action'],tokens['--green'])>=4.5);
  assert.ok(contrast(tokens['--focus'],tokens['--paper'])>=3);
  assert.ok(contrast(tokens['--action-ink'],tokens['--paper'])>=4.5);
  assert.equal(tokens['--font-size'],'20px'); assert.match(tokens['--font'],/DM Sans/);
  assert.match(tokens['--font-heading'],/DM Sans/); assert.equal(rgb('rgba(0,0,0,0)'),null);
});
test('standalone appearance endpoint absence preserves incumbent stylesheet and keeps features off',async()=>{
  const previous=globalThis.fetch,document={documentElement:{dataset:{},style:{setProperty(){throw new Error('Brand must retain CSS');}}}};
  globalThis.fetch=async()=>({ok:false,status:404});
  try {
    // A missing endpoint leaves the compare panel OFF and every illustrative extra ON: the two flags default in
    // opposite directions on purpose (a new feature must not switch itself on; a live scene must not go empty).
    assert.deepEqual(await applyAppearance({document}),{mode:'brand',fallback:false,
      features:{compare:false,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'},sceneContent:DEFAULT_SCENE_CONTENT});
    assert.equal(document.documentElement.dataset.appearance,'brand');
    assert.deepEqual(getFeatures(),{compare:false,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'});
    assert.deepEqual(getSceneContent(),DEFAULT_SCENE_CONTENT);
  }
  finally { globalThis.fetch=previous; }
});
/**
 * The scene policy travels in the appearance payload, on purpose: applyAppearance() is awaited before the form
 * renders, so the admin's show/hide is known before the first frame and no extra ever appears and then vanishes.
 */
test('the illustrative-extras policy arrives in the appearance payload and is exposed through getSceneContent',async()=>{
  const previous=globalThis.fetch,document={documentElement:{dataset:{},style:{setProperty(){}}}};
  try {
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',
      sceneContent:{fixtures:'on',garden:'hidden',neighbours:'off',interior:'on',houseOpenings:'hidden'}})});
    const applied=await applyAppearance({document});
    assert.deepEqual(applied.sceneContent,{fixtures:'on',garden:'hidden',neighbours:'off',interior:'on',houseOpenings:'hidden'});
    assert.deepEqual(getSceneContent(),applied.sceneContent);
    // A native (Odoo-theme) appearance replaces the colours from the theme probe, never the policy.
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'custom',colors:{},sceneContent:{garden:'hidden'}})});
    assert.deepEqual((await applyAppearance({document})).sceneContent,{...DEFAULT_SCENE_CONTENT,garden:'hidden'});
    // An outdated API, a nonsense value or a network failure leaves the scene as it has always been drawn.
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',sceneContent:{garden:'weg'}})});
    assert.deepEqual((await applyAppearance({document})).sceneContent,DEFAULT_SCENE_CONTENT);
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand'})});
    assert.deepEqual((await applyAppearance({document})).sceneContent,DEFAULT_SCENE_CONTENT);
    globalThis.fetch=async()=>{throw new Error('offline');};
    assert.deepEqual((await applyAppearance({document})).sceneContent,DEFAULT_SCENE_CONTENT);
  }
  finally { globalThis.fetch=previous; }
});
test('compare flag is read from the appearance payload and exposed through getFeatures',async()=>{
  const previous=globalThis.fetch,document={documentElement:{dataset:{},style:{setProperty(){throw new Error('Brand must retain CSS');}}}};
  assert.deepEqual(getFeatures(),{compare:false,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'});
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',compareEnabled:true})});
  try {
    const applied=await applyAppearance({document});
    assert.equal(applied.mode,'brand'); assert.equal(applied.features.compare,true);
    assert.deepEqual(getFeatures(),{compare:true,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'});
    // Only a literal true switches the feature on; truthy strings from an outdated API do not.
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',compareEnabled:'true'})});
    assert.equal((await applyAppearance({document})).features.compare,false);
    assert.deepEqual(getFeatures(),{compare:false,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'});
    // A network failure after a previous enable resets to the safe default.
    globalThis.fetch=async()=>{throw new Error('offline');};
    assert.deepEqual((await applyAppearance({document})).features,{compare:false,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'});
  }
  finally { globalThis.fetch=previous; }
});

/**
 * The omgeving in the proposal images is an ADMIN decision with no visitor control, so it rides with the feature
 * flags rather than with `sceneContent`: those five default ON so an upgrade never empties a live picture, this one
 * has to default OFF. A 404, a timeout, an Odoo that predates the field and a truthy string all mean "the aanbouw
 * alone", which is the state the customer asked for.
 */
test('the proposal-image omgeving flag defaults off and only a literal true switches it on',async()=>{
  const previous=globalThis.fetch,document={documentElement:{dataset:{},style:{setProperty(){}}}};
  try {
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',documentSurroundings:true})});
    assert.equal((await applyAppearance({document})).features.documentSurroundings,true);
    assert.equal(getFeatures().documentSurroundings,true);
    for(const value of ['true',1,'on',{},null,undefined]) {
      globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',documentSurroundings:value})});
      assert.equal((await applyAppearance({document})).features.documentSurroundings,false,String(value));
    }
    globalThis.fetch=async()=>({ok:false,status:404,json:async()=>({})});
    assert.equal((await applyAppearance({document})).features.documentSurroundings,false,'a 404 shows the aanbouw alone');
    globalThis.fetch=async()=>{throw new Error('offline');};
    assert.equal((await applyAppearance({document})).features.documentSurroundings,false,'and so does an offline browser');
    // It is an independent switch: turning the compare panel on says nothing about the proposal images.
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',compareEnabled:true})});
    assert.deepEqual(getFeatures.call(null)&&(await applyAppearance({document})).features,{compare:true,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'});
  }
  finally { globalThis.fetch=previous; }
});
test('actual Odoo orange uses black when both brand ink and white fail contrast',()=>{
  const nativeOrange='#e8511d';
  assert.ok(contrast('#ffffff',nativeOrange)<4.5);
  assert.ok(contrast('#20302c',nativeOrange)<4.5);
  const tokens=appearanceTokens({colors:{action:nativeOrange,on_action:'#ffffff'}});
  assert.equal(tokens['--green'],nativeOrange);
  assert.equal(tokens['--on-action'],'#000000');
  assert.ok(contrast(tokens['--on-action'],tokens['--green'])>=4.5);
});

/**
 * Vormgeving -> Weergavekwaliteit 3D reaches the page as renderQuality. Only the three named tiers pass; anything else,
 * including a missing payload, is automatic, so an old or unreachable backend never forces a tier on a visitor.
 */
test('the administrator render quality default passes only the three named tiers',async()=>{
  const previous=globalThis.fetch,document={documentElement:{dataset:{},style:{setProperty(){}}}};
  try {
    for(const [value,expected] of [['full','full'],['compact','compact'],['auto','auto'],['high','auto'],[1,'auto'],[null,'auto'],[undefined,'auto']]) {
      globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({mode:'brand',renderQuality:value})});
      assert.equal((await applyAppearance({document})).features.renderQuality,expected,String(value));
      assert.equal(getFeatures().renderQuality,expected);
    }
  } finally { globalThis.fetch=previous; }
});

test('the way back to the website is re-checked in the browser with the server rule (2.11.0)', () => {
  // services/appearance.py exit_link refuses these on save; the browser applies the same rule to whatever arrives,
  // so a payload can never hand the logo a script, a protocol-relative host or a malformed address.
  for (const good of ['/', '/aanbouw', '/nl/contact?x=1#top', 'https://www.voorbeeld.nl/', 'http://voorbeeld.nl']) assert.equal(safeExitUrl(good), good);
  assert.equal(safeExitUrl(''), '', 'empty switches the way back off');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', '//evil.example', 'data:text/html,x', 'https://', 'www.voorbeeld.nl', '/a b', undefined, null, 42])
    assert.equal(safeExitUrl(bad), '/', String(bad));
});

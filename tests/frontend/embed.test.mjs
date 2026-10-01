import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {EMBED_PATH,MESSAGE_SOURCE,MIN_HEIGHT_WIDE,MIN_HEIGHT_NARROW,HEIGHT_FLOOR,HEIGHT_CEILING,
 isEmbedded,minimumHeight,clampAdvisedHeight,readAdvice,startEmbedBridge,connectEmbedFrame}
 from '../../addons/cs_prefab_configurator/static/src/embed.js';

const root=new URL('../../',import.meta.url);

test('only the embed path itself is the embed path',()=>{
 assert.equal(isEmbedded('/prefab/embed'),true);
 assert.equal(isEmbedded('/prefab/embed/'),true);
 assert.equal(isEmbedded('/prefab'),false);
 assert.equal(isEmbedded('/prefab/'),false);
 // The one that would quietly turn a typo into an embedded page.
 assert.equal(isEmbedded('/prefab/embedded'),false);
 assert.equal(isEmbedded('/prefab/embed/extra'),false);
 assert.equal(isEmbedded(''),false);
 assert.equal(isEmbedded(undefined),false);
 assert.equal(isEmbedded('/'),false);
});

test('the advised minimum follows the layout, not the content',()=>{
 assert.equal(minimumHeight(false),MIN_HEIGHT_WIDE);
 assert.equal(minimumHeight(true),MIN_HEIGHT_NARROW);
 assert.ok(MIN_HEIGHT_NARROW<MIN_HEIGHT_WIDE);
 assert.ok(HEIGHT_FLOOR<MIN_HEIGHT_NARROW&&MIN_HEIGHT_WIDE<HEIGHT_CEILING);
});

test('the host clamps every number it is given and refuses everything that is not one',()=>{
 assert.equal(clampAdvisedHeight(700),700);
 assert.equal(clampAdvisedHeight(12),HEIGHT_FLOOR);
 assert.equal(clampAdvisedHeight(99999),HEIGHT_CEILING);
 assert.equal(clampAdvisedHeight(620.4),620);
 for(const bad of ['800',null,undefined,NaN,Infinity,-Infinity,{},[],true])
  assert.equal(clampAdvisedHeight(bad),null,String(bad));
});

test('a message is accepted only from our own origin, from this frame, under our own namespace',()=>{
 const frameWindow={};
 const good={origin:'https://prefabpartner.nl',source:frameWindow,
  data:{source:MESSAGE_SOURCE,type:'size',minHeight:700}};
 const options={expectedOrigin:'https://prefabpartner.nl',frameWindow};
 assert.deepEqual(readAdvice(good,options),{type:'size',minHeight:700});
 // A different origin: the whole point of the check.
 assert.equal(readAdvice({...good,origin:'https://kwaadaardig.example'},options),null);
 // Right origin, wrong frame: an advert or a second embed on the same page.
 assert.equal(readAdvice({...good,source:{}},options),null);
 // Somebody else's postMessage traffic.
 assert.equal(readAdvice({...good,data:{type:'size',minHeight:700}},options),null);
 assert.equal(readAdvice({...good,data:{source:'other',type:'size'}},options),null);
 assert.equal(readAdvice({...good,data:'size'},options),null);
 assert.equal(readAdvice({...good,data:null},options),null);
 // An unknown type is dropped rather than forwarded to the host.
 assert.equal(readAdvice({...good,data:{source:MESSAGE_SOURCE,type:'navigate',url:'/x'}},options),null);
 // Fails closed when the caller forgets to say what origin it expects.
 assert.equal(readAdvice(good,{frameWindow}),null);
 assert.equal(readAdvice(good,{}),null);
 assert.equal(readAdvice(good),null);
 assert.equal(readAdvice(null,options),null);
});

test('only named fields survive the boundary, and they are bounded',()=>{
 const frameWindow={};
 const options={expectedOrigin:'https://prefabpartner.nl',frameWindow};
 const message=data=>({origin:'https://prefabpartner.nl',source:frameWindow,data:{source:MESSAGE_SOURCE,...data}});
 const step=readAdvice(message({type:'step',index:2,label:'x'.repeat(400),html:'<img onerror=1>'}),options);
 assert.deepEqual(Object.keys(step).sort(),['index','label','minHeight','type']);
 assert.equal(step.label.length,80);
 assert.equal(readAdvice(message({type:'step',index:'2'}),options).index,null);
 const submitted=readAdvice(message({type:'submitted',reference:'y'.repeat(200)}),options);
 assert.equal(submitted.reference.length,64);
 assert.equal(readAdvice(message({type:'submitted',reference:{}}),options).reference,'');
});

/** A minimal DOM double: enough surface for the bridge, nothing that pretends to be a browser. */
function fakeWindow({parent=null,narrow=false,origin='https://prefabpartner.nl'}={}){
 const listeners=new Map(),media={matches:narrow,addEventListener(){},removeEventListener(){}};
 return {parent,location:{origin},matchMedia:()=>media,media,
  addEventListener:(type,fn)=>listeners.set(type,fn),
  removeEventListener:type=>listeners.delete(type),
  dispatch:(type,event)=>listeners.get(type)?.(event),
  listenerCount:()=>listeners.size};
}

test('the bridge stays silent on a page that is not framed',()=>{
 const win=fakeWindow();win.parent=win;
 assert.equal(startEmbedBridge({win,doc:{body:null}}),null);
});

test('the frame announces itself to its parent, addressed to its own origin only',()=>{
 const sent=[];
 const win=fakeWindow({parent:{postMessage:(data,target)=>sent.push({data,target})}});
 const bridge=startEmbedBridge({win,doc:{body:null}});
 assert.equal(sent.length,1);
 assert.equal(sent[0].data.type,'ready');
 assert.equal(sent[0].data.source,MESSAGE_SOURCE);
 assert.equal(sent[0].data.minHeight,MIN_HEIGHT_WIDE);
 // Addressed to our own origin: a cross-origin parent is simply not delivered to, which is the
 // designed outcome rather than a channel nobody specified.
 assert.equal(sent[0].target,'https://prefabpartner.nl');
 bridge.step(1,'Afwerking');
 bridge.submitted('CS-20260917-ABCD');
 assert.deepEqual(sent.slice(1).map(item=>item.data.type),['step','submitted']);
 // Re-advising the same height says nothing; the parent is not woken for a non-change.
 bridge.advise();
 assert.equal(sent.length,3);
 // A window resize is one of the three triggers, and dispose() has to give it back.
 assert.equal(win.listenerCount(),1);
 bridge.dispose();
 assert.equal(win.listenerCount(),0);
});

test('a parent that refuses the message does not take the configurator down with it',()=>{
 const win=fakeWindow({parent:{postMessage(){throw new Error('geblokkeerd');}}});
 assert.doesNotThrow(()=>startEmbedBridge({win,doc:{body:null}}));
});

test('the host applies a clamped min-height and ignores everything else',()=>{
 const frame={style:{},dataset:{},contentWindow:{},getBoundingClientRect:()=>({top:10})};
 const win=fakeWindow();
 const seen=[];
 const stop=connectEmbedFrame(frame,{win,onAdvice:advice=>seen.push(advice.type)});
 win.dispatch('message',{origin:win.location.origin,source:frame.contentWindow,
  data:{source:MESSAGE_SOURCE,type:'size',minHeight:99999}});
 assert.equal(frame.style.minHeight,HEIGHT_CEILING+'px');
 win.dispatch('message',{origin:'https://kwaadaardig.example',source:frame.contentWindow,
  data:{source:MESSAGE_SOURCE,type:'size',minHeight:400}});
 assert.equal(frame.style.minHeight,HEIGHT_CEILING+'px');
 assert.deepEqual(seen,['size']);
 stop();
 assert.equal(win.listenerCount(),0);
});

test('the host page loads the same module the frame does, at the same version',async()=>{
 // Two ends of one protocol. The failure this catches is a renamed namespace or a changed bound
 // on one side only -- which produces silence, not an error.
 const host=await readFile(new URL('addons/cs_prefab_configurator/static/src/embed_host.js',root),'utf8');
 assert.match(host,/import\('\.\/embed\.js'/);
 assert.match(host,/import\.meta\.url/);
 assert.match(host,/connectEmbedFrame/);
 assert.match(host,/iframe\[data-prefab-embed\]/);
 // It must not carry its own copy of anything embed.js defines.
 assert.ok(!host.includes(MESSAGE_SOURCE),'the namespace belongs to embed.js alone');
 assert.ok(!/\b(400|1200|560|620)\b/.test(host),'the height bounds belong to embed.js alone');
});

test('the shipped page and the shipped stylesheet agree on the embed address and the bounds',async()=>{
 const template=await readFile(new URL('addons/cs_prefab_website/views/offerte_templates.xml',root),'utf8');
 assert.ok(template.includes('src="'+EMBED_PATH+'"'),'the site frames the route the app recognises');
 const css=await readFile(new URL('addons/cs_prefab_configurator/static/src/embed_host.css',root),'utf8');
 // The stylesheet is the fallback height, so its floor may not sit below what the frame will ask
 // for: a clamp that starts under MIN_HEIGHT_WIDE would make the script's advice load-bearing.
 assert.ok(css.includes('clamp('+MIN_HEIGHT_WIDE+'px'),'desktop clamp starts at the usable minimum');
 assert.ok(css.includes('min-height: '+MIN_HEIGHT_NARROW+'px'),'phone fallback holds the stacked minimum');
 assert.ok(css.includes('100dvh'),'dvh, so a collapsing phone URL bar does not overshoot');
});

/** UI-only website appearance. Pricing, catalogues and saved designs do not use it. */
import {FENCE_STYLES} from './environment.js';
import {DEFAULT_SCENE_CONTENT,normalizeSceneContent,DOCUMENT_PARTS,normalizeDocumentParts} from './scene_content.js';
const FENCE_STYLE_IDS=FENCE_STYLES.map(style=>style.id);
const BRAND = Object.freeze({ action:'#294e40', on_action:'#ffffff', text:'#2f3935', heading:'#20302c', muted:'#657069', surface:'#ffffff', background:'#f1f1ec', border:'#dce0d9', error:'#a43b2d' });
const BRAND_FONT = "'DM Sans', Arial, sans-serif";
const BRAND_HEADING = BRAND_FONT;

export function rgb(value) {
  if (/^#[\da-f]{6}$/i.test(value || '')) return [1,3,5].map(i => parseInt(value.slice(i,i+2),16));
  const match = /^(?:rgb|rgba)\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value || '');
  if (!match || (match[4] !== undefined && Number(match[4]) < .01)) return null;
  const channels=match.slice(1,4).map(Number);
  return channels.every(n=>Number.isFinite(n)&&n>=0&&n<=255) ? channels : null;
}
export function contrast(left,right) {
  const luminance = value => rgb(value)?.map(n => n/255).reduce((sum,n,i)=>sum+[.2126,.7152,.0722][i]*(n<=.04045?n/12.92:((n+.055)/1.055)**2.4),0);
  const a=luminance(left),b=luminance(right);
  return a==null||b==null ? 0 : (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
function hex(channels) { return '#'+channels.map(n=>Math.round(n).toString(16).padStart(2,'0')).join(''); }
function blend(a,b,ratio) { return hex(rgb(a).map((n,i)=>n*ratio+rgb(b)[i]*(1-ratio))); }
function opaque(value,fallback) { return rgb(value) ? hex(rgb(value)) : fallback; }
function readable(foreground,background,minimum=4.5) {
  if(contrast(foreground,background)>=minimum) return foreground;
  if(contrast('#20302c',background)>=minimum) return '#20302c';
  // Mid-tone website colors can fail with both the brand ink and white.
  // Of pure black and white, one always clears normal-text contrast (4.5:1).
  return contrast('#000000',background)>=contrast('#ffffff',background) ? '#000000' : '#ffffff';
}

export function appearanceTokens(config) {
  const input=config?.colors || {};
  const p=Object.fromEntries(Object.entries(BRAND).map(([key,value])=>[key,opaque(input[key],value)]));
  // Keep native site hues while repairing illegible text combinations. Also
  // protects the UI if an outdated or external API supplies invalid values.
  for(const key of ['text','heading','muted','error']) p[key]=readable(p[key],p.surface);
  p.on_action=readable(p.on_action,p.action);
  const safeFont = value => typeof value==='string' && value.length<=300 && !/[;{}<>\\]/.test(value) ? value : null;
  return {
    '--ink':p.heading,'--text':p.text,'--muted':p.muted,'--paper':p.surface,
    '--page':p.background,'--stone':p.background,'--soft':blend(p.action,p.surface,.035),
    '--line':p.border,'--green':p.action,'--accent':p.action,'--green-soft':blend(p.action,p.surface,.07),
    '--danger':p.error,'--error':p.error,'--focus':readable(p.action,p.surface,3),'--on-action':p.on_action,
    '--action-ink':readable(p.action,p.surface),
    '--font':safeFont(config?.font)||BRAND_FONT,'--font-heading':safeFont(config?.headingFont)||BRAND_HEADING,
    '--font-button':safeFont(config?.buttonFont)||safeFont(config?.font)||BRAND_FONT,
    '--font-size':`${Math.min(20,Math.max(14,Number(config?.fontSize)||16))}px`,
  };
}

function copyNativeFonts(source,target,families) {
  const wanted=families.join(',').toLowerCase().split(',').map(v=>v.trim().replace(/^['"]|['"]$/g,''));
  const copied=[];
  const visit = (sheet,depth=0) => {
    if(depth>3 || copied.length>64) return;
    let rules; try { rules=sheet.cssRules; } catch { return; }
    for(const rule of rules) {
      if(rule.type===3 && rule.styleSheet) visit(rule.styleSheet,depth+1);
      if(rule.type!==5) continue;
      const family=rule.style.getPropertyValue('font-family').trim().replace(/^['"]|['"]$/g,'').toLowerCase();
      if(!wanted.includes(family)) continue;
      let safe=true;
      const css=rule.cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g,(_all,_quote,path)=>{
        try {
          const url=new URL(path,sheet.href||source.URL);
          if(url.origin!==location.origin || !['http:','https:'].includes(url.protocol)) { safe=false; return ''; }
          return `url("${url.href.replaceAll('"','%22')}")`;
        } catch { safe=false; return ''; }
      });
      if(safe && copied.length<64) copied.push(css);
    }
  };
  for(const sheet of source.styleSheets) visit(sheet);
  target.getElementById('prefab-native-fonts')?.remove();
  if(copied.length) {
    const style=target.createElement('style'); style.id='prefab-native-fonts'; style.textContent=copied.join('\n'); target.head.append(style);
  }
}

function nativeAppearance(document,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const frame=document.createElement('iframe');
    frame.title='Website vormgeving'; frame.setAttribute('aria-hidden','true'); frame.tabIndex=-1;
    frame.hidden=true; frame.setAttribute('sandbox','allow-same-origin'); frame.src='/prefab/theme';
    let settled=false;
    const finish=(error,value)=>{
      if(settled) return; settled=true; clearTimeout(timer); frame.remove(); error?reject(error):resolve(value);
    };
    const timer=setTimeout(()=>finish(new Error('Theme timeout')),timeoutMs);
    frame.onerror=()=>finish(new Error('Theme unavailable'));
    frame.onload=()=>{
      try {
        const source=frame.contentDocument,win=frame.contentWindow;
        const style=id=>{ const element=source.getElementById(`prefab-theme-${id}`); if(!element) throw new Error('Theme probe missing'); return win.getComputedStyle(element); };
        const body=style('text'),heading=style('heading'),action=style('action'),surface=style('surface');
        if(!source.querySelector('link[rel="stylesheet"]') || !rgb(action.backgroundColor)) throw new Error('Theme CSS unavailable');
        const paper=opaque(surface.backgroundColor,opaque(win.getComputedStyle(source.body).backgroundColor,BRAND.surface));
        const config={mode:'odoo',colors:{surface:paper,text:body.color,heading:heading.color,muted:style('muted').color,
          action:action.backgroundColor,on_action:action.color,border:style('border').borderTopColor,
          background:style('soft').backgroundColor,error:style('error').color},
          font:body.fontFamily,headingFont:heading.fontFamily,buttonFont:action.fontFamily,fontSize:parseFloat(body.fontSize)};
        copyNativeFonts(source,document,[config.font,config.headingFont,config.buttonFont]);
        finish(null,config);
      } catch(error) { finish(error); }
    };
    document.body.append(frame);
  });
}

/** Admin feature flags served next to the appearance. Every flag defaults OFF so
 *  a 404, a timeout or an outdated API never switches a feature on by accident. */
const DEFAULT_FEATURES=Object.freeze({compare:false,documentSurroundings:false,documentParts:DOCUMENT_PARTS,renderQuality:'auto',gardenFence:true,gardenFenceStyle:'modern',cameraFreeOrbit:false,interiorFurniture:false,exitUrl:'/'});
/** The administrator's default 3D render quality (services/appearance.py RENDER_QUALITIES); anything else is 'auto'. */
export const RENDER_QUALITIES=Object.freeze(['auto','full','compact']);
let lastFeatures=DEFAULT_FEATURES;
/** `documentSurroundings` decides whether the six proposal images stand in the garden or show the aanbouw alone
 *  (document_capture.js). It belongs with the flags and not with `sceneContent` for the default's sake: the scene
 *  policy defaults everything ON so an upgrade never empties a live picture, and this one has to default OFF —
 *  the customer asked for the omgeving to be absent unless an administrator asks for it.
 *
 *  `documentParts` names what stays in a picture the omgeving has left: the concrete slab under the aanbouw, the
 *  terras reaching into the garden, and the half metre of the woning behind the doorbraak. These are the ONLY
 *  flags in this object that do not default to false, and deliberately so: an unreachable endpoint may not leave
 *  a building floating. The list and its defaults are scene_content.js DOCUMENT_PARTS — one copy, read here. */
function featuresOf(payload) {
  return Object.freeze({compare:payload?.compareEnabled===true,
    documentSurroundings:payload?.documentSurroundings===true,
    documentParts:normalizeDocumentParts(payload?.documentParts),
    renderQuality:RENDER_QUALITIES.includes(payload?.renderQuality)?payload.renderQuality:'auto',
    // 2.11.0. The schutting defaults ON like every scenery default (an unreachable endpoint never blanks the garden);
    // the exit address is re-checked here with the server's own rule, so a payload can never hand the logo a script.
    gardenFence:payload?.gardenFence!==false,
    // 2.12.0: the website's default boundary style; anything unknown is the modern fence (environment.js FENCE_STYLES).
    gardenFenceStyle:FENCE_STYLE_IDS.includes(payload?.gardenFenceStyle)?payload.gardenFenceStyle:'modern',
    // 2.14.0: off keeps the visitor in front of the house (preview.js CAMERA_LIMIT); on lifts every limit
    // but the ground. Default off, like every other flag here: an unreachable endpoint never opens it up.
    cameraFreeOrbit:payload?.cameraFreeOrbit===true,
    // 2.14.1: the example furniture is left out of the binnenweergave unless an administrator asks for it.
    interiorFurniture:payload?.interiorFurniture===true,
    exitUrl:safeExitUrl(payload?.exitUrl)});
}
/** services/appearance.py exit_link, mirrored: a site path (not //host) or an absolute http(s) address; else '/'. */
export function safeExitUrl(value){
  if(value==='')return '';
  if(typeof value!=='string'||/\s/.test(value))return '/';
  if(value.startsWith('/')&&!value.startsWith('//'))return value;
  return /^https?:\/\/[^/]/i.test(value)?value:'/';
}
/** Flags from the most recent applyAppearance() call; everything false before it runs. */
export function getFeatures() { return lastFeatures; }

/** Which illustrative extras this website offers (scene_content.js). Same fetch, its own key, opposite default:
 *  an unreachable endpoint leaves the scene as it has always been drawn instead of emptying it. */
let lastSceneContent=DEFAULT_SCENE_CONTENT;
/** The admin policy from the most recent applyAppearance() call; everything 'on' before it runs. */
export function getSceneContent() { return lastSceneContent; }

/** Called once before the form renders; development server has no Odoo endpoint. */
export async function applyAppearance({document=globalThis.document,timeoutMs=2500}={}) {
  lastFeatures=DEFAULT_FEATURES; lastSceneContent=DEFAULT_SCENE_CONTENT;
  if(!document) return {mode:'brand',fallback:false,features:lastFeatures,sceneContent:lastSceneContent};
  const deadline=Date.now()+timeoutMs;
  let config={mode:'brand'},fallback=false;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch('/prefab/api/appearance',{signal:controller.signal,credentials:'same-origin',cache:'no-store'});
    if(response.ok) {
      const received=await response.json();
      if(['brand','odoo','custom'].includes(received.mode)) { config=received; lastFeatures=featuresOf(received); lastSceneContent=normalizeSceneContent(received.sceneContent); }
    }
  } catch { /* Local preview or unavailable preferences retain the brand. */ }
  finally { clearTimeout(timer); }
  if(config.mode==='odoo') {
    // Native colours replace the config, not the flags and not the scene policy: both were decided by
    // the admin record, the theme probe only supplies CSS values.
    try { config=await nativeAppearance(document,Math.max(1,deadline-Date.now())); }
    catch { config={mode:'brand'}; fallback=true; }
  }
  // Brand leaves the incumbent stylesheet untouched; a native/custom appearance
  // replaces only explicit tokens, never component structure or scene materials.
  if(config.mode!=='brand') for(const [key,value] of Object.entries(appearanceTokens(config))) document.documentElement.style.setProperty(key,value);
  document.documentElement.dataset.appearance=config.mode;
  if(fallback) document.documentElement.dataset.appearanceFallback='native-unavailable';
  return {mode:config.mode,fallback,features:lastFeatures,sceneContent:lastSceneContent};
}

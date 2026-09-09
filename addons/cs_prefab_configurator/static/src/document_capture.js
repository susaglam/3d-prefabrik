import { Preview } from './preview.js';
import { buildGeometry, documentPlanSvg, elevationSvg } from './geometry.js';

const BACKGROUND='#fbfaf6';
const VIEW_SPECS=Object.freeze([
    {id:'perspective-left',label:'Tuinperspectief links',kind:'3d'},
    {id:'perspective-right',label:'Tuinperspectief rechts',kind:'3d'},
    {id:'interior',label:'Ruimtelijk overzicht zonder dak',kind:'3d'},
    {id:'plan',label:'Plattegrond met buitenmaten',kind:'plan'},
    {id:'front',label:'Voorgevel vanuit de tuin',kind:'elevation'},
    {id:'side',label:'Rechter zijgevel',kind:'elevation'},
]);

/** Contact postcodes never affect the geometry snapshot or its identity. */
export function documentConfigKey(config) {
    const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
        ?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])])):value;
    const {postcode,...design}=config;
    return JSON.stringify(ordered(design));
}

function asJpeg(canvas,quality) {
    let dataUrl=canvas.toDataURL('image/jpeg',quality);
    // Keep each RGB JPEG comfortably inside the API's 768 KiB decoded-image limit.
    for(let q=quality-.1;dataUrl.length>760*1024*4/3&&q>=.45;q-=.1)dataUrl=canvas.toDataURL('image/jpeg',q);
    if(!dataUrl.startsWith('data:image/jpeg;base64,')||dataUrl.length>768*1024*4/3)throw new Error('De ontwerpafbeelding kon niet worden vastgelegd.');
    return dataUrl;
}

function newCanvas(width,height) {
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('Deze browser kan geen ontwerpafbeeldingen maken.');
    context.fillStyle=BACKGROUND;context.fillRect(0,0,width,height);
    return {canvas,context};
}

async function rasterizeSvg(svg,width,height,quality) {
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
    try {
        const source=new Image();
        await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('De technische tekening kon niet worden geladen.')),10000);
            source.onload=()=>{clearTimeout(timer);resolve();};
            source.onerror=()=>{clearTimeout(timer);reject(new Error('De technische tekening kon niet worden geladen.'));};
            source.src=url;
        });
        const {canvas,context}=newCanvas(width,height);context.drawImage(source,0,0,width,height);
        return asJpeg(canvas,quality);
    } finally {URL.revokeObjectURL(url);}
}

/**
 * Capture a frozen document bundle from a canonical configuration. Uses a separate renderer,
 * so an orbiting camera, hidden roof or active 2D tab can never leak into the saved proposal.
 * No browser screenshot, page content, contact data or external asset is included.
 */
export async function captureDocumentViews(config,{width=1440,height=960,quality=.88,include3D=true}={}) {
    const snapshot=JSON.parse(JSON.stringify(config));
    const configKey=documentConfigKey(snapshot),model=buildGeometry(snapshot),views=[],missingViews=[];
    width=Math.max(256,Math.min(2000,Math.round(Number(width)||1440)));
    height=Math.max(256,Math.min(2000,Math.round(Number(height)||960)));
    if(width*height>2500000){const reduction=Math.sqrt(2500000/(width*height));width=Math.floor(width*reduction);height=Math.floor(height*reduction);}
    quality=Math.max(.55,Math.min(.93,Number(quality)||.88));
    let isolated,container;
    try {
        if(include3D) {
            container=document.createElement('div');container.dataset.documentCapture='true';
            container.setAttribute('aria-hidden','true');container.inert=true;
            container.style.cssText=`position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;pointer-events:none;overflow:hidden;`;
            document.body.append(container);
            try {
                isolated=new Preview(container,{pixelRatio:1,observeResize:false,initialConfig:snapshot});
                if(isolated.renderer&&!isolated.failed){
                    isolated.scene.background.set(BACKGROUND);isolated.scene.fog.color.set(BACKGROUND);
                }
            } catch { /* The technical drawings remain available on devices without WebGL. */ }
        }
        for(const spec of VIEW_SPECS) {
            try {
                let dataUrl;
                if(spec.kind==='3d') {
                    if(!isolated?.setDocumentView(spec.id))throw new Error('3D niet beschikbaar');
                    // Copy the completed WebGL frame onto an opaque RGB canvas, never the live preview canvas.
                    const {canvas,context}=newCanvas(width,height);
                    context.drawImage(isolated.renderer.domElement,0,0,width,height);
                    dataUrl=asJpeg(canvas,quality);
                } else {
                    const svg=spec.kind==='plan'?documentPlanSvg(model):elevationSvg(model,spec.id);
                    dataUrl=await rasterizeSvg(svg,width,height,quality);
                }
                views.push(Object.freeze({id:spec.id,label:spec.label,width,height,dataUrl}));
            } catch {missingViews.push(spec.id);}
            // Keep the submit progress message responsive between the six independent captures.
            await new Promise(resolve=>setTimeout(resolve,0));
        }
    } finally {
        isolated?.destroy();container?.remove();
    }
    return Object.freeze({version:1,configKey,views:Object.freeze(views),missingViews:Object.freeze(missingViews)});
}

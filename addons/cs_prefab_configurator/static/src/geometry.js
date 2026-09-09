/** One metric, schematic model for the 3D scene, accessible plan and exports. */
export function buildGeometry(config = {}) {
    const cm = (value, fallback, low, high) => {
        const n = Number(value);
        return Math.max(low, Math.min(high, Number.isFinite(n) && n > 0 ? n : fallback)) / 100;
    };
    const width = cm(config.width, 500, 150, 750);
    const depth = cm(config.depth, 300, 100, 340);
    const height = cm(config.height, 280, 280, 280);
    const wall = .22, floor = .12, roofThickness = .16;
    const bounds = {left: -width / 2, right: width / 2, back: -depth / 2, front: depth / 2};
    const openingCode = typeof config.frontOpening === 'string' ? config.frontOpening : 'french-black';
    const kind = openingCode.startsWith('french') ? 'french' : openingCode.startsWith('sliding-4') ? 'sliding-4'
        : openingCode.startsWith('sliding-2') ? 'sliding-2' : openingCode.startsWith('folding') ? 'folding' : 'none';
    const openingWidth = kind === 'none' ? 0 : Math.min(width - .9, {french: 2.2, 'sliding-2': 3.2, 'sliding-4': 4.4, folding: 4.4}[kind]);
    const openingHeight = Math.min(2.3, height - .35);
    const opening = {kind, width: openingWidth, height: openingHeight, bottom: .07,
        x: 0, z: bounds.front - wall / 2, frame: openingCode.endsWith('white') ? '#efede6' : '#303432',
        bars: openingCode.includes('bars'), panelCount: kind === 'none' ? 0 : kind === 'french' || kind === 'sliding-2' ? 2 : 4};
    const box = (key, x, y, z, w, h, d, role = 'wall') => ({key, center: [x,y,z], size: [w,h,d], role});
    const walls = [
        box('left', bounds.left + wall / 2, height / 2, 0, wall, height, depth),
        box('right', bounds.right - wall / 2, height / 2, 0, wall, height, depth),
    ];
    if (kind === 'none') walls.push(box('front', 0, height / 2, opening.z, width - 2 * wall, height, wall));
    else {
        const pier = (width - openingWidth) / 2;
        walls.push(box('front-left', bounds.left + pier / 2, height / 2, opening.z, pier, height, wall),
            box('front-right', bounds.right - pier / 2, height / 2, opening.z, pier, height, wall),
            box('front-header', 0, (height + openingHeight + opening.bottom) / 2, opening.z,
                openingWidth, height - openingHeight - opening.bottom, wall));
    }
    const panels = Array.from({length: opening.panelCount}, (_, i) => ({
        index: i, x: -openingWidth / 2 + (i + .5) * openingWidth / opening.panelCount,
        width: openingWidth / opening.panelCount, height: openingHeight, bottom: opening.bottom,
        z: opening.z, bars: opening.bars,
    }));
    const roofCode = typeof config.rooflight === 'string' ? config.rooflight : 'none';
    const match = /^(lean|gable)-(\d+)$/.exec(roofCode);
    const roofKind = match && ((match[1] === 'lean' && +match[2] >= 1 && +match[2] <= 4)
        || (match[1] === 'gable' && [4,6,8].includes(+match[2]))) ? match[1] : 'none';
    const roofCount = roofKind === 'none' ? 0 : Number(match[2]);
    const roofWidth = roofCount ? Math.min(width - .85, (roofKind === 'gable' ? roofCount / 2 : roofCount) * .72 + .12) : 0;
    const roofDepth = roofCount ? Math.min(depth - .85, roofKind === 'gable' ? 1.45 : 1.15) : 0;
    const rooflight = {kind: roofKind, panelCount: roofCount, width: roofWidth, depth: roofDepth,
        x: 0, z: -.08, baseY: height + roofThickness / 2 + .16,
        rise: roofKind === 'gable' ? Math.min(.38,roofDepth*.28) : Math.min(.28,roofDepth*.25),
        opening: roofCount ? {left: -roofWidth / 2, right: roofWidth / 2, back: -.08 - roofDepth / 2, front: -.08 + roofDepth / 2} : null,
        panels: []};
    if (roofCount) {
        const perSide = roofKind === 'gable' ? roofCount / 2 : roofCount;
        for (let side = 0; side < (roofKind === 'gable' ? 2 : 1); side++) {
            for (let i = 0; i < perSide; i++) {
                const x0 = -roofWidth / 2 + i * roofWidth / perSide, x1 = x0 + roofWidth / perSide;
                const back = rooflight.opening.back, front = rooflight.opening.front, middle = rooflight.z;
                const y0 = rooflight.baseY, y1 = y0 + rooflight.rise;
                const z0 = roofKind === 'lean' || side === 0 ? back : middle;
                const z1 = roofKind === 'lean' || side === 1 ? front : middle;
                const ya = roofKind === 'lean' || side === 0 ? y0 : y1;
                const yb = roofKind === 'lean' || side === 0 ? y1 : y0;
                rooflight.panels.push({index: rooflight.panels.length, points: [[x0,ya,z0],[x1,ya,z0],[x1,yb,z1],[x0,yb,z1]]});
            }
        }
    }
    const roof = [];
    if (!roofCount) roof.push(box('roof', 0, height, 0, width + .08, roofThickness, depth + .08, 'roof'));
    else {
        const o = rooflight.opening;
        roof.push(box('roof-left', (bounds.left + o.left) / 2 - .02, height, 0,
            o.left - bounds.left + .04, roofThickness, depth + .08, 'roof'),
            box('roof-right', (bounds.right + o.right) / 2 + .02, height, 0,
                bounds.right - o.right + .04, roofThickness, depth + .08, 'roof'),
            box('roof-back', 0, height, (bounds.back + o.back) / 2 - .02,
                roofWidth, roofThickness, o.back - bounds.back + .04, 'roof'),
            box('roof-front', 0, height, (bounds.front + o.front) / 2 + .02,
                roofWidth, roofThickness, bounds.front - o.front + .04, 'roof'));
    }
    const markers = [];
    const positions = value => value === 'both' ? ['left','right'] : ['left','right'].includes(value) ? [value] : [];
    for (const [field,type,y] of [['outsideLight','lighting-conduit',1.9],['outsideSocket','socket-conduit',.5],['outsideTap','water-conduit',.65]]) {
        for (const side of positions(config[field])) markers.push({type,side,
            position:[side === 'left' ? bounds.left + .22 : bounds.right - .22,y,bounds.front + .015]});
    }
    for (const side of positions(config.heating)) markers.push({type:'heating-conduit',side,
        position:[side === 'left' ? bounds.left + wall + .025 : bounds.right - wall - .025,.35,0]});
    for (const side of positions(config.sockets)) markers.push({type:'interior-socket-conduit',side,
        position:[side === 'left' ? bounds.left + wall + .025 : bounds.right - wall - .025,.45,depth * .15]});
    const drainSide = config.drainSide === 'left' ? 'left' : 'right';
    const drain = {side:drainSide,material:config.drainMaterial === 'zinc' ? 'zinc' : 'pvc',
        x:drainSide === 'left' ? bounds.left + .12 : bounds.right - .12,z:bounds.front + .1,height:height - .06};
    return {version:1,units:'m',axes:{front:'+z',left:'-x',up:'+y'},width,depth,height,wall,floor,roofThickness,
        area:Math.round(width * depth * 100) / 100,bounds,opening,panels,walls,roof,rooflight,markers,drain,
        facade:config.facade || 'wood-vertical',roofEdge:config.roofEdge || 'anthracite',rollaag:config.rollaag || 'masonry',
        interior:!!config.interior,plaster:!!config.plaster,screed:!!config.screed,underfloorHeating:!!config.underfloorHeating,
        ceilingLights:Math.max(0,Math.min(2,Math.trunc(Number(config.ceilingLights)||0))),
        switches:Math.max(0,Math.min(2,Math.trunc(Number(config.switches)||0))),
        spotlights:Math.max(0,Math.min(12,Math.trunc(Number(config.spotlights)||0)))};
}

const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function planSvg(model, dimensions = true) {
    const m = model, padding = .85;
    const view = [m.bounds.left-padding,m.bounds.back-padding,m.width+padding*2,m.depth+padding*2];
    const rect = (x,z,w,d,attrs='') => `<rect x="${x}" y="${z}" width="${w}" height="${d}" ${attrs}/>`;
    const walls = m.walls.filter(w => w.key !== 'front-header').map(w => rect(w.center[0]-w.size[0]/2,w.center[2]-w.size[2]/2,w.size[0],w.size[2],'fill="#626e62"')).join('');
    const doors = m.panels.map(p => {
        const y = m.bounds.front-.11, x = p.x-p.width/2;
        let result = rect(x+.02,y,p.width-.04,.05,'fill="#b4c3bc" stroke="#344b42" stroke-width=".025"');
        if (m.opening.kind === 'french') {
            const hinge = p.index === 0 ? x : x+p.width, end = p.index === 0 ? x+p.width : x;
            result += `<path d="M${hinge} ${y}v${-p.width} M${end} ${y}A${p.width} ${p.width} 0 0 ${p.index===0?0:1} ${hinge} ${y-p.width}" fill="none" stroke="#7b8c7c" stroke-width=".017" stroke-dasharray=".05 .035"/>`;
        }
        return result;
    }).join('');
    const r = m.rooflight;
    const rooflight = r.panelCount ? rect(-r.width/2,r.z-r.depth/2,r.width,r.depth,'fill="#e7eeee" fill-opacity=".65" stroke="#8c9c90" stroke-width=".02" stroke-dasharray=".08 .06"')
        + r.panels.map(p=>`<path data-rooflight-panel="${p.index}" d="M${p.points.map(point=>`${point[0]} ${point[2]}`).join('L')}Z" fill="none" stroke="#a1ada5" stroke-width=".012"/>`).join('') : '';
    const wLabel = `${Math.round(m.width*100)} cm`, dLabel = `${Math.round(m.depth*100)} cm`;
    const dimensionLines = dimensions ? `<g fill="none" stroke="#66796a" stroke-width=".015"><path d="M${m.bounds.left} ${m.bounds.front+.2}v.35m0-.13h${m.width}m0-.22v.35 M${m.bounds.left-.2} ${m.bounds.back}h-.35m.13 0v${m.depth}m-.13 0h.35"/></g><g fill="#344b42" font-family="system-ui,sans-serif" font-size=".18" text-anchor="middle"><text x="0" y="${m.bounds.front+.68}">${wLabel}</text><text x="${m.bounds.left-.58}" y="0" transform="rotate(-90 ${m.bounds.left-.58} 0)">${dLabel}</text></g>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(' ')}" role="img" aria-label="Plattegrond van je aanbouw, ${esc(wLabel)} breed en ${esc(dLabel)} diep" style="width:100%;height:100%;display:block"><title>Plattegrond van je aanbouw</title><desc>Buitenmaten ${wLabel} bij ${dLabel}. ${m.opening.panelCount} panelen in de voorpui. ${r.panelCount} daklichtpanelen. Bovenzijde sluit aan op de bestaande woning.</desc><rect x="${view[0]}" y="${view[1]}" width="${view[2]}" height="${view[3]}" fill="#f1f0e9"/><g transform="translate(0 ${m.bounds.back-.05})"><path d="M${m.bounds.left-.18} 0h${m.width+.36}" stroke="#b5b8ad" stroke-width=".09" stroke-dasharray=".16 .065"/><text x="0" y="-.24" text-anchor="middle" font-size=".16" fill="#626d59" font-family="system-ui,sans-serif">BESTAANDE WONING</text></g>${rect(m.bounds.left+m.wall,m.bounds.back,m.width-m.wall*2,m.depth-m.wall,'fill="#e5e0d3"')}${rooflight}${walls}${doors}<text x="0" y="${r.panelCount?m.bounds.front-.65:0}" text-anchor="middle" fill="#4d6153" font-family="system-ui,sans-serif" font-size=".32" font-weight="500">${m.area.toLocaleString('nl-NL')} m²</text>${dimensionLines}</svg>`;
}

const drawingNumber = value => Number(value.toFixed(2));
const centimetres = value => `${Math.round(value * 100)} cm`;
const drawingColours = {
    'brick-red':'#b88873','brick-black':'#777a72','brick-white':'#e6e3da','brick-yellow':'#d1bd91',
    'pvc-black':'#565c56','pvc-green':'#6b7d6b','pvc-cream':'#ddd7c2','pvc-anthracite':'#777f76',
    render:'#e8e3d6',
};

function drawingDimension(x1,y1,x2,y2,label,offset) {
    const horizontal=y1===y2,stroke='#526c5e';
    let lines,text;
    if(horizontal) {
        const y=y1+offset;
        lines=`M${x1} ${y1}V${y+14} M${x2} ${y2}V${y+14} M${x1} ${y}H${x2} M${x1-8} ${y+8}l16 -16 M${x2-8} ${y+8}l16 -16`;
        text=`x="${(x1+x2)/2}" y="${y-18}"`;
    } else {
        const x=x1+offset;
        lines=`M${x1} ${y1}H${x-14} M${x2} ${y2}H${x-14} M${x} ${y1}V${y2} M${x-8} ${y1+8}l16 -16 M${x-8} ${y2+8}l16 -16`;
        text=`x="${x-18}" y="${(y1+y2)/2}" transform="rotate(-90 ${x-18} ${(y1+y2)/2})"`;
    }
    return `<g data-dimension="${esc(label)}"><path d="${lines}" fill="none" stroke="${stroke}" stroke-width="2"/><text ${text} text-anchor="middle" fill="${stroke}" font-size="32" font-weight="500">${esc(label)}</text></g>`;
}

function drawingSheet(title,description,content) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="960" viewBox="0 0 1440 960" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(description)}</desc><defs><pattern id="wall-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#e3e8e2"/><path d="M0 0V12" stroke="#a8b8ac" stroke-width="2"/></pattern><pattern id="brick" width="64" height="28" patternUnits="userSpaceOnUse"><path d="M0 0H64 M0 14H64 M0 0V14 M32 14V28 M64 0V14" fill="none" stroke="#f6f4ee" stroke-opacity=".64" stroke-width="2"/></pattern><pattern id="horizontal" width="30" height="24" patternUnits="userSpaceOnUse"><path d="M0 24H30" stroke="#556553" stroke-opacity=".3" stroke-width="2"/></pattern><pattern id="vertical" width="24" height="30" patternUnits="userSpaceOnUse"><path d="M24 0V30" stroke="#556553" stroke-opacity=".3" stroke-width="2"/></pattern></defs><rect width="1440" height="960" fill="#fbfaf6"/><g font-family="Arial, sans-serif">${content}</g></svg>`;
}

/** Dimensioned print drawing, generated from exactly the same solids as the live 3D preview. */
export function documentPlanSvg(model) {
    const m=model,s=Math.min(1060/m.width,550/m.depth),left=(1440-m.width*s)/2,top=(820-m.depth*s)/2;
    const X=x=>drawingNumber(left+(x-m.bounds.left)*s),Y=z=>drawingNumber(top+(z-m.bounds.back)*s);
    const bottom=Y(m.bounds.front),right=X(m.bounds.right),rect=(x,y,w,h,attrs)=>`<rect x="${x}" y="${y}" width="${drawingNumber(w)}" height="${drawingNumber(h)}" ${attrs}/>`;
    let content=rect(left,top,m.width*s,m.depth*s,'fill="#f2efe4"');
    content+=`<path d="M${left-20} ${top-10}H${right+20}" stroke="#84988b" stroke-width="5" stroke-dasharray="17 10"/><text x="720" y="${top-46}" text-anchor="middle" fill="#61776a" font-size="26" letter-spacing="2">BESTAANDE WONING</text>`;
    for(const wall of m.walls.filter(w=>w.key!=='front-header'))content+=rect(X(wall.center[0]-wall.size[0]/2),Y(wall.center[2]-wall.size[2]/2),wall.size[0]*s,wall.size[2]*s,'fill="url(#wall-hatch)" stroke="#405e4b" stroke-width="3"');
    const r=m.rooflight;
    if(r.panelCount) {
        content+=rect(X(-r.width/2),Y(r.z-r.depth/2),r.width*s,r.depth*s,'fill="#e6eeee" stroke="#8ca699" stroke-width="2" stroke-dasharray="12 8"');
        for(const p of r.panels)content+=`<path data-rooflight-panel="${p.index}" d="M${p.points.map(point=>`${X(point[0])} ${Y(point[2])}`).join('L')}Z" fill="none" stroke="#8ca699" stroke-width="2" stroke-dasharray="8 6"/>`;
    }
    for(const p of m.panels) {
        const x=X(p.x-p.width/2),y=Y(m.bounds.front-.11),width=p.width*s;
        content+=rect(x+2,y,width-4,7,`data-plan-panel="${p.index}" fill="#c1d4ce" stroke="#405e4b" stroke-width="2"`);
        if(m.opening.kind==='french') {
            const hinge=p.index===0?x:x+width,end=p.index===0?x+width:x;
            content+=`<path data-door-swing="${p.index}" d="M${hinge} ${y}V${y-width} M${end} ${y}A${width} ${width} 0 0 ${p.index===0?0:1} ${hinge} ${y-width}" fill="none" stroke="#809889" stroke-width="2" stroke-dasharray="9 6"/>`;
        }
        // Sliding/folding handing is not configured: show closed panels without an invented travel direction.
    }
    const areaY=r.panelCount?Math.min(bottom-58,Y(r.z+r.depth/2)+58):top+m.depth*s/2+15;
    content+=`<text x="720" y="${areaY}" text-anchor="middle" fill="#405e4b" font-size="42" font-weight="500">${esc(m.area.toLocaleString('nl-NL'))} m²</text>`;
    content+=drawingDimension(left,bottom,right,bottom,centimetres(m.width),85)+drawingDimension(left,top,left,bottom,centimetres(m.depth),-85);
    content+=`<text x="720" y="${Math.min(925,bottom+144)}" text-anchor="middle" fill="#87958b" font-size="25" letter-spacing="2">TUINZIJDE</text>`;
    return drawingSheet('Plattegrond',`Buitenmaten ${centimetres(m.width)} bij ${centimetres(m.depth)}. ${m.opening.panelCount} panelen in de voorpui, ${r.panelCount} daklichtpanelen. Stippellijnen tonen het daklicht boven de ruimte.`,content);
}

/** Front is viewed from the garden (+z); side is the right facade (+x). */
export function elevationSvg(model,view='front') {
    if(!['front','side'].includes(view))throw new Error(`Unknown elevation: ${view}`);
    const m=model,front=view==='front',span=front?m.width:m.depth;
    const s=Math.min(1040/span,510/(m.height+.7)),left=(1440-span*s)/2,base=720;
    const X=x=>drawingNumber(left+x*s),Y=y=>drawingNumber(base-y*s);
    const rect=(x,y,w,h,attrs)=>`<rect x="${x}" y="${y}" width="${drawingNumber(w)}" height="${drawingNumber(h)}" ${attrs}/>`;
    const colour=drawingColours[m.facade]||'#c6ae89';
    const texture=m.facade.startsWith('brick')?'brick':m.facade==='render'?null:m.facade.includes('horizontal')?'horizontal':'vertical';
    let content=`<path d="M${left-35} ${base+2}H${left+span*s+35}" stroke="#97a89a" stroke-width="3"/>`;
    content+=rect(left,Y(m.height),span*s,m.height*s,`fill="${colour}" stroke="#405849" stroke-width="3"`);
    if(texture)content+=rect(left,Y(m.height),span*s,m.height*s,`fill="url(#${texture})"`);
    content+=rect(left-5,Y(m.height+.125),span*s+10,.16*s,`fill="${m.roofEdge==='aluminium'?'#c7cec7':'#5e6e62'}" stroke="#4c6052" stroke-width="2"`);
    if(m.rollaag!=='masonry')content+=rect(left,Y(m.height-.05),span*s,.2*s,`fill="${m.rollaag==='panel-white'?'#edece5':'#5a685d'}"`);
    if(front&&m.opening.panelCount) {
        const o=m.opening,openingLeft=(m.width-o.width)/2;
        content+=rect(X(openingLeft),Y(o.height+o.bottom),o.width*s,o.height*s,`fill="#dce8e4" stroke="${o.frame}" stroke-width="8"`);
        for(const p of m.panels) {
            const x=p.x+m.width/2;
            content+=`<path data-front-panel="${p.index}" d="M${X(x-p.width/2)} ${Y(o.bottom)}V${Y(o.bottom+o.height)} M${X(x+p.width/2)} ${Y(o.bottom)}V${Y(o.bottom+o.height)}" stroke="${o.frame}" stroke-width="5"/>`;
            if(p.bars)content+=`<path d="M${X(x)} ${Y(o.bottom)}V${Y(o.bottom+o.height)} M${X(x-p.width/2)} ${Y(o.bottom+o.height*.34)}H${X(x+p.width/2)} M${X(x-p.width/2)} ${Y(o.bottom+o.height*.67)}H${X(x+p.width/2)}" stroke="${o.frame}" stroke-width="3"/>`;
            if(o.kind==='french')content+=`<path d="M${X(x-p.width/2)} ${Y(o.bottom)}L${X(x+p.width/2)} ${Y(o.bottom+o.height/2)}L${X(x-p.width/2)} ${Y(o.bottom+o.height)}" fill="none" stroke="#91a99b" stroke-width="2" stroke-dasharray="9 6"/>`;
        }
        content+=drawingDimension(X(openingLeft),base,X(openingLeft+o.width),base,centimetres(o.width),72);
    }
    const r=m.rooflight;
    if(r.panelCount) {
        const y0=r.baseY,y1=y0+r.rise;
        if(front) {
            const x0=(m.width-r.width)/2,x1=x0+r.width;
            content+=`<path d="M${X(x0)} ${Y(m.height+.08)}V${Y(y1)}H${X(x1)}V${Y(m.height+.08)}" fill="#dfebe6" fill-opacity=".65" stroke="#6a8171" stroke-width="3"/>`;
            const count=r.kind==='gable'?r.panelCount/2:r.panelCount;
            for(let i=1;i<count;i++)content+=`<path d="M${X(x0+r.width*i/count)} ${Y(y0)}V${Y(y1)}" stroke="#6a8171" stroke-width="2"/>`;
        } else {
            const x0=r.z-r.depth/2-m.bounds.back,x1=x0+r.depth,middle=(x0+x1)/2;
            const top=r.kind==='gable'?`${X(x0)} ${Y(y0)}L${X(middle)} ${Y(y1)}L${X(x1)} ${Y(y0)}`:`${X(x0)} ${Y(y0)}L${X(x1)} ${Y(y1)}`;
            content+=`<path data-rooflight-profile="${r.kind}" d="M${X(x0)} ${Y(m.height+.08)}L${top}V${Y(m.height+.08)}Z" fill="#dfebe6" stroke="#6a8171" stroke-width="3"/>`;
        }
    }
    if(front) {
        const drainX=X(m.drain.x+m.width/2);
        content+=`<path data-drain-side="${m.drain.side}" d="M${drainX} ${Y(m.drain.height)}V${Y(.12)}l10 8" fill="none" stroke="${m.drain.material==='zinc'?'#9ba99d':'#6b7b6d'}" stroke-width="8"/>`;
        for(const marker of m.markers.filter(item=>!item.type.startsWith('interior')&&!item.type.startsWith('heating')))content+=`<circle data-connection="${marker.type}" cx="${X(marker.position[0]+m.width/2)}" cy="${Y(marker.position[1])}" r="6" fill="#bd9463" stroke="#6a765d" stroke-width="2"/>`;
    } else {
        content+=`<path d="M${left-12} ${base}V${Y(m.height+.62)}" stroke="#99aa9e" stroke-width="4" stroke-dasharray="12 8"/><text x="${left-37}" y="${Y(m.height/2)}" text-anchor="middle" transform="rotate(-90 ${left-37} ${Y(m.height/2)})" fill="#8a9b8e" font-size="23" letter-spacing="1">BESTAANDE WONING</text>`;
        if(m.drain.side==='right')content+=`<path d="M${X(span)+9} ${Y(m.drain.height)}V${Y(.12)}" stroke="#7b8c7d" stroke-width="8"/>`;
    }
    content+=drawingDimension(left,base,X(span),base,centimetres(span),front&&m.opening.panelCount?142:87)+drawingDimension(left,Y(m.height),left,base,centimetres(m.height),-100);
    const title=front?'Voorgevel vanuit de tuin':'Rechter zijgevel';
    return drawingSheet(title,`${title}. Buitenmaat ${centimetres(span)}, wandhoogte ${centimetres(m.height)}. Kozijn- en daklichtmaten zijn schematisch.`,content);
}

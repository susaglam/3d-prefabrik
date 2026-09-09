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

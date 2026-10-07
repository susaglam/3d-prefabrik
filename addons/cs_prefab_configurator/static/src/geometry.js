/**
 * The whole front-opening rule, in cm, in one place. The span is the widest aperture a kozijn family may reach; the
 * walls always keep a 45 cm pier on each side, so a narrow extension shrinks the aperture instead of the piers.
 * "Geen kozijn" is a SKELETON opening, not a closed wall: the customer fits their own frame later, so the extension
 * shows exactly the rough opening a 2-leaf schuifpui would get at this width (hence the shared 320) with only the
 * outer frame built — no leaves, no glass, no hardware. Mirrored value for value in services/geometry_rules.py.
 * Openslaande deuren span 440 since 2.17.0: the customer's reference is two doors between two wide side lights
 * (kozijn/openslaande deur wit), not the pair of doors alone that a 220 cm aperture held.
 */
export const OPENING_SPAN_CM = {french: 440, 'sliding-2': 320, 'sliding-4': 440, folding: 440, none: 320};
export const PIER_MINIMUM_CM = 90;
export const openingApertureCm = (kind, widthCm) => Math.min(widthCm - PIER_MINIMUM_CM, OPENING_SPAN_CM[kind]);
/** Aperture plus leaf count for one kozijn, in cm — the unit the Python twin is compared against. */
/**
 * Heights of the outside fittings in cm, the same in all three placement tiers. The socket sits ABOVE the tap and
 * the tap never moves: before 2.10 the stacked tier put the tap at 100 and the others at 65, so widening the
 * aanbouw across the tier boundary made the tap jump 35 cm while the socket stayed under it (customer report).
 * services/geometry_rules.py EXTERIOR_HEIGHTS_CM carries the same three numbers; tests hold them equal.
 */
export const EXTERIOR_HEIGHTS_CM=Object.freeze({light:190,socket:105,tap:65});
/** Every radiator is anchored at 108 cm on its wall slot; services/geometry_rules.py RADIATOR_ANCHOR_CM is the same. */
export const RADIATOR_ANCHOR_CM=108;
/**
 * The visible face of the daktrim, in metres relative to the top of the roof slab: the coated aluminium profile is a
 * 5 cm face, the zinc roll hangs a skirt down to 5 cm under the slab top. preview.js buildRoofEdge draws exactly these
 * faces; the hopper below hangs from the lower edge, so both read the same numbers from here.
 */
export const DAKTRIM_FACE=Object.freeze({anthracite:Object.freeze({top:.015,bottom:-.035}),aluminium:Object.freeze({top:.015,bottom:-.035}),zinc:Object.freeze({top:-.02,bottom:-.05})});
/**
 * The vergaarbak (hopper head) of a downpipe on an aanbouw without overstek (2.17.0, the owner with photographs: the
 * pipe does not turn into the wall under the roof edge; a zijuitloop leaves the roof through the EDGE, under the
 * uninterrupted daktrim, into an open hopper screwed to the facade directly under the trim). Sized from the owner's
 * reference render (measured: 1.46 x the pipe wide, 1.66 x deep, 2.45 x tall, open top, flat back, tapered front and
 * sides) against Dutch catalogue parts (Wavin model 2: 198 x 148 x 252 mm; zinc "junior": 185 x 145 x 200 mm).
 * top / bottom are [width along the wall, depth out of it] in metres; gap is the air under the trim.
 */
export const HOPPER=Object.freeze({height:.20,top:Object.freeze([.13,.16]),bottom:Object.freeze([.105,.14]),gap:.004});

/**
 * The sightlines of each kozijn family in metres, measured off the customer's reference renders (kozijn/*.png,
 * rectified to front elevations: docs/verification/kozijn-ref/). head / jamb / mullion are the outer frame; stile /
 * rail / bottomRail the sash around a pane; `back` is how far a sash's FRONT face lies behind the frame's front face.
 *  sliding  fixed sash practically flush (5 mm), the sliding leaf on the inner track 75 mm back — it slides INSIDE;
 *           a 14 mm frame-colour lip on a dark dorpel with a 42 mm face, in both colours
 *  folding  all five leaves in one plane 50 mm back, standing on a light threshold (no bottom frame member) that runs
 *           34 mm out in front of the frame and 214 mm behind it, in both colours
 *  french   two side lights glazed straight into the frame (glass 62 mm back, a 75 mm sill member under it), a 78 mm
 *           kozijnstijl to each door; the doors flush with the frame, hinge stile 89 and meeting stile 95 mm, a 187 mm
 *           bottom rail, glass 65 mm back; a 20 mm onderdorpel over a dark drempel that stands 35 mm proud. The roedes
 *           version and the aluminium profile ("wit-alu") are the same doors in other sightlines (frenchBars,
 *           frenchAluminium); the deurkruk is a satin-silver lever on a round rosette with a cylinder rosette under it
 * grille is the ventilatierooster: an 89 mm housing in the frame colour with one row of dark slots in its lower half.
 * preview.js makeOpening builds the 3D from these numbers and elevationSvg draws with them, so the two agree.
 */
export const KOZIJN=Object.freeze({
    // An independent re-measurement (docs/verification/kozijn-ref/, check) settled the head at 52-54, the lip at 15
    // and the dorpel face at 40 mm, a dark warm grey in both colours.
    sliding:Object.freeze({head:.053,jamb:.055,lip:.015,sill:'#3b3532',sillFace:.04,sillProud:.01,stile:.095,rail:.088,bottomRail:.125,
        sash:.071,fixedBack:.005,slidingBack:.075,frameDepth:.16}),
    // A second, independent measurement of the harmonicapui (its own camera model) put the stiles at 77-83 mm, about
    // 12% narrower than the 88 mm top rail, and the jamb at 65 mm; the first pass had read both a little wide.
    folding:Object.freeze({head:.087,jamb:.065,threshold:'#eae8e6',stile:.08,rail:.088,bottomRail:.104,doorBottomRail:.111,
        sash:.06,back:.05,frameDepth:.14}),
    french:Object.freeze({head:.089,jamb:.07,mullion:.078,lip:.02,sill:'#423a34',sillFace:.04,sillProud:.035,lightSill:.075,lightBack:.062,
        stile:.089,meetingStile:.095,rail:.094,bottomRail:.187,sash:.1,glassBack:.065,back:0,frameDepth:.12,meeting:.0045}),
    // Met roedes: every section on the same 88 mm bottom member, so panes and bars line up across the front. The top
    // rail measures 91; it is held at the grille's 89 so a door's pane starts where a side light's does.
    frenchBars:Object.freeze({head:.079,jamb:.066,lightSill:.088,rail:.089,bottomRail:.088}),
    frenchAluminium:Object.freeze({head:.054,jamb:.032,mullion:.059,lightSill:.04,bottomRail:.09}),
    // Slots about 33 x 18 mm at a 37 mm pitch behind 4-5 mm dividers; pulls 57-62 x 105-110 mm round a 40 x 82 pocket.
    grille:Object.freeze({height:.089,slot:.018,pitch:.037,below:.0565,divider:.0045}),
    pull:Object.freeze({width:.058,height:.108,proud:.012,y:.92,foldingY:.93}),
    lever:Object.freeze({y:.879,cylinder:.814,rose:.022,proud:.004,length:.132,height:.016,reach:.049,color:'#dcdbd8'}),
    bars:3,
});
/** The sightlines one kozijn is built and drawn with: its family's, for openslaande deuren with the roedes and alu versions. */
export function kozijnProfile(kind, {bars = false, material = ''} = {}) {
    const family = kind.startsWith('sliding') ? 'sliding' : kind === 'folding' ? 'folding' : 'french';
    if (family !== 'french') return {family, ...KOZIJN[family]};
    return {family, ...KOZIJN.french, ...(bars ? KOZIJN.frenchBars : {}), ...(material === 'aluminium' ? KOZIJN.frenchAluminium : {})};
}
/** The members above and below one section's glass: a sash's rails, or a side light's head and sill member. */
export function sectionMembers(profile, section) {
    if (profile.family === 'french' && section.role === 'fixed') return {top: 0, bottom: profile.lightSill};
    if (profile.family === 'folding' && section.role === 'door') return {top: profile.rail, bottom: profile.doorBottomRail};
    return {top: profile.rail, bottom: profile.bottomRail};
}

export function openingSpec(kind, widthCm, heightCm = 280) {
    const width = openingApertureCm(kind, widthCm);
    return {kind, width, height: Math.min(230, heightCm - 35), bottom: 7,
        panelCount: openingLayout(kind, width / 100).length, skeleton: kind === 'none'};
}

/**
 * What each kozijn IS, section by section, left to right as seen from the garden (2.17.0). The owner: "kapıları tam
 * olarak istediğim gibi yapmamışsın; olmayacak her yere havalandırma koymuşsun; kapı kollarını kendin uydurmuşsun;
 * sürgülüleri dışarıdan sürgülüymüş gibi göstermişsin; openslaande deur bizimkinde 2 kanat ama orijinalinde farklı".
 * The customer's reference renders (kozijn/*.png) were rectified to front elevations and measured
 * (docs/verification/kozijn-ref/): this is what they show, and the 3D, the option icons and the drawings all read it.
 *
 *  role    'fixed' glass in the frame, a 'sliding' leaf (it runs on the INNER track, behind the fixed pane), a
 *          'folding' leaf, a 'door' (a hinged leaf: the doors of openslaande deuren, the loopdeur of a harmonicapui)
 *  grille  the ventilatierooster: on the fixed panes and the loopdeur only — never on a leaf you slide, fold or open
 *          as a pair (the owner crossed out the ones we drew on the sliding leaves)
 *  handle  null, {type:'pull', edge} (the small flush pull of a schuifpui or a harmonicapui) or {type:'lever', edge}
 *          (the deurkruk of a swing door); `edge` is the stile it sits on
 *  hinge   the stile a door hangs on; opens: where a leaf goes ('left' / 'right' for sliding and folding, 'out' for a
 *          door — Dutch garden doors open outward, as the references show)
 *
 * Shares are of the aperture. Openslaande deuren keep their doors at a door's width and give the rest to the two side
 * lights; on an aperture too narrow for side lights the two doors share it (FRENCH_DOORS).
 */
export const OPENING_LAYOUTS = Object.freeze({
    'sliding-2': Object.freeze([
        {role: 'sliding', share: .5, handle: {type: 'pull', edge: 'left'}, opens: 'right'},
        {role: 'fixed', share: .5, grille: true}]),
    'sliding-4': Object.freeze([
        {role: 'fixed', share: .25, grille: true},
        {role: 'sliding', share: .25, handle: {type: 'pull', edge: 'right'}, opens: 'left'},
        {role: 'sliding', share: .25, handle: {type: 'pull', edge: 'left'}, opens: 'right'},
        {role: 'fixed', share: .25, grille: true}]),
    folding: Object.freeze([
        {role: 'folding', share: .2, opens: 'left'}, {role: 'folding', share: .2, opens: 'left'},
        {role: 'folding', share: .2, opens: 'left'}, {role: 'folding', share: .2, opens: 'left', handle: {type: 'pull', edge: 'right'}},
        {role: 'door', share: .2, hinge: 'right', opens: 'out', grille: true, handle: {type: 'pull', edge: 'left'}}]),
});
/**
 * Openslaande deuren, in metres: each door a door's width (the reference: 0,90 m), the side lights take the rest but
 * never less than sideMin. Where that leaves a door narrower than `min`, there are no side lights and the two doors
 * share the aperture. services/geometry_rules.py FRENCH_DOORS carries the same numbers.
 */
export const FRENCH_DOORS = Object.freeze({door: .9, min: .6, sideMin: .35});

/** The sections of one kozijn in an aperture of `width` metres, left to right, with their x centre and width. */
export function openingLayout(kind, width) {
    let parts = OPENING_LAYOUTS[kind];
    if (kind === 'french') {
        // The right-hand door is the active one: the deurkruk on its meeting stile, the left door bolted (reference).
        const door = Math.min(FRENCH_DOORS.door, (width - 2 * FRENCH_DOORS.sideMin) / 2), side = (width - 2 * door) / 2;
        const doors = [{role: 'door', hinge: 'left', opens: 'out'}, {role: 'door', hinge: 'right', opens: 'out', handle: {type: 'lever', edge: 'left'}}];
        // 1e-9: 1,9 - 0,7 is 1,1999999999999997 in floating point, and the Python twin decides the same case in cm.
        parts = door >= FRENCH_DOORS.min - 1e-9
            ? [{role: 'fixed', share: side / width, grille: true}, ...doors.map(d => ({...d, share: door / width})), {role: 'fixed', share: side / width, grille: true}]
            : doors.map(d => ({...d, share: .5}));
    }
    if (!parts || !(width > 0)) return [];
    let left = -width / 2;
    return parts.map((part, index) => {
        const w = part.share * width, section = {index, role: part.role, x: left + w / 2, width: w, grille: !!part.grille,
            handle: part.handle ? {...part.handle} : null, hinge: part.hinge || null, opens: part.opens || null};
        left += w;
        return section;
    });
}

/** Fixed mounting coordinates in cm. Kept in parity with services/geometry_rules.py. */
export function buildFixtureLayout(config, rules = {}) {
    const width=config.width,depth=config.depth,height=config.height??280,wall=rules.wallThicknessCm??22;
    const left=-width/2,right=width/2,back=-depth/2,front=depth/2;
    const gap=rules.clearanceCm?.fixture??5,edge=rules.clearanceCm?.wallEdge??8,roofGap=rules.clearanceCm?.roof??5;
    const xMin=left+wall+15+edge,xMax=right-wall-15-edge,zMin=back+15+edge,zMax=front-wall-15-edge;
    let ceilingZ=Math.min(zMax,Math.max(zMin,back+(depth-wall)*.68)),roofBounds=null;
    const roofMatch=/^(lean|gable)-(\d+)$/.exec(config.rooflight??'none');
    if(roofMatch&&((roofMatch[1]==='lean'&&+roofMatch[2]>=1&&+roofMatch[2]<=5)||(roofMatch[1]==='gable'&&[2,4,6,8,10].includes(+roofMatch[2])))) {
        const [,kind,countText]=roofMatch,count=Number(countText);
        const rw=Math.min(width-85,(kind==='gable'?count/2:count)*72+12),rd=Math.min(depth-85,kind==='gable'?145:115);
        roofBounds=[-rw/2,rw/2,-8-rd/2,-8+rd/2];
        const frontAxis=roofBounds[3]+15+roofGap;
        if(frontAxis<=zMax)ceilingZ=Math.max(ceilingZ,frontAxis);
    }
    // Pendants divide the clear room width in thirds (never closer to a wall than the edge clearance allows).
    const clearLeft=left+wall,clearWidth=width-2*wall;
    const ceilingPositions=Object.fromEntries([['left',1/6],['center',.5],['right',5/6]].map(([key,fraction])=>[key,[Math.min(xMax,Math.max(xMin,clearLeft+clearWidth*fraction)),height-9,ceilingZ]]));
    const spotPositions={},wallPositions={},heating={};
    for(let row=1;row<=3;row++)for(let col=1;col<=5;col++)spotPositions[`r${row}c${col}`]=[left+wall+(width-2*wall)*col/6,height-9,back+(depth-wall)*row/4];
    for(const side of ['L','R'])for(let slot=1;slot<=3;slot++){
        const x=side==='L'?left+wall+2.5:right-wall-2.5,z=back+(depth-wall)*({1:.22,2:.5,3:.78}[slot]);
        wallPositions[`${side}${slot}`]={socket:[x,35,z],light:[x,185,z]};
    }
    for(const side of ['left','right']){const point=wallPositions[side==='left'?'L3':'R3'].socket;heating[side]=[point[0],RADIATOR_ANCHOR_CM,point[2]];}
    const opening=config.frontOpening??'none';
    const kind=['sliding-4','sliding-2','french','folding'].find(value=>opening.startsWith(value))??'none';
    const openingWidth=openingApertureCm(kind,width);
    const pier=(width-openingWidth)/2,separation=Math.max(35,8.4+4.5+gap+5),exterior={},H=EXTERIOR_HEIGHTS_CM;
    for(const [side,sign] of [['left',-1],['right',1]]) {
        const electricalAxis=sign*(width/2-pier/2),tapAxis=electricalAxis+sign*separation,drainAxis=sign*(width/2-12);
        const [lower,upper]=side==='left'?[left+edge,-openingWidth/2-edge]:[openingWidth/2+edge,right-edge];
        const drainHere=[side,'both'].includes(config.drainSide??'right');
        let frontFits=lower<=electricalAxis-8.4&&electricalAxis+8.4<=upper&&lower<=tapAxis-4.5&&tapAxis+4.5<=upper;
        if(drainHere)frontFits=frontFits&&Math.abs(electricalAxis-drainAxis)>=8.4+5+gap&&Math.abs(tapAxis-drainAxis)>=4.5+5+gap;
        // Tier 2: one axis on the front pier with the fittings stacked vertically (garden-facing whenever possible).
        // The stack only needs to clear the 7.5 cm downpipe itself, so even the narrowest pier keeps it on the front.
        const stackClearance=8.4+3.75+3;
        let stackedAxis=electricalAxis;
        if(drainHere&&Math.abs(stackedAxis-drainAxis)<stackClearance)stackedAxis=drainAxis-sign*stackClearance;
        const stackedFits=lower<=stackedAxis-8.4&&stackedAxis+8.4<=upper;
        if(frontFits)exterior[side]={surface:'front',rotation:0,available:true,light:[electricalAxis,H.light,front+2.5],socket:[electricalAxis,H.socket,front+2.5],tap:[tapAxis,H.tap,front+2.5]};
        else if(stackedFits)exterior[side]={surface:'front',rotation:0,available:true,light:[stackedAxis,H.light,front+2.5],socket:[stackedAxis,H.socket,front+2.5],tap:[stackedAxis,H.tap,front+2.5]};
        else {
            const tapZ=front-Math.max(35,edge+4.5),electricalZ=tapZ-separation;
            exterior[side]={surface:side,rotation:sign*Math.PI/2,available:back+edge<=electricalZ-8.4&&tapZ+4.5<=front-edge,
                light:[sign*(width/2+2.5),H.light,electricalZ],socket:[sign*(width/2+2.5),H.socket,electricalZ],tap:[sign*(width/2+2.5),H.tap,tapZ]};
        }
    }
    return {version:2,units:'cm',basis:{width,depth,height,frontOpening:opening,rooflight:config.rooflight,drainSide:config.drainSide??'right'},ceilingPositions,spotPositions,wallPositions,heating,exterior,roofBounds};
}

/** Shared indicative pipe route, above the finished floor; no product supply implied. */
export function underfloorRoute(model) {
    const {bounds,wall}=model,padding=.18,y=.098;
    const left=bounds.left+wall+padding,right=bounds.right-wall-padding,back=bounds.back+padding,front=bounds.front-wall-padding;
    if(right-left<.20||front-back<.20)return {points:[],bounds:{left,right,back,front}};
    const runs=Math.max(2,Math.floor((right-left)/.18)),points=[];
    for(let index=0;index<runs;index++) {
        const x=left+(right-left)*index/(runs-1),start=index%2===0?back:front,end=index%2===0?front:back;
        points.push([x,y,start],[x,y,end]);
    }
    const rounded=[points[0]];
    for(let index=1;index<points.length-1;index++) {
        const previous=points[index-1],corner=points[index],next=points[index+1];
        const before=Math.hypot(corner[0]-previous[0],corner[2]-previous[2]),after=Math.hypot(next[0]-corner[0],next[2]-corner[2]);
        const radius=Math.min(.065,before/2,after/2);
        const start=[corner[0]-(corner[0]-previous[0])*radius/before,y,corner[2]-(corner[2]-previous[2])*radius/before];
        const end=[corner[0]+(next[0]-corner[0])*radius/after,y,corner[2]+(next[2]-corner[2])*radius/after];
        rounded.push(start);
        for(let step=1;step<=4;step++){
            const t=step/4,u=1-t;
            rounded.push([u*u*start[0]+2*u*t*corner[0]+t*t*end[0],y,u*u*start[2]+2*u*t*corner[2]+t*t*end[2]]);
        }
    }
    rounded.push(points[points.length-1]);
    return {points:rounded,bounds:{left,right,back,front}};
}

/** One metric, schematic model for the 3D scene, accessible plan and exports. */
export function buildGeometry(config = {}, {fixtureLayout=null,scope=[],geometryRules={}}={}) {
    const cm = (value, fallback, low, high) => {
        const n = Number(value);
        return Math.max(low, Math.min(high, Number.isFinite(n) && n > 0 ? n : fallback)) / 100;
    };
    const width = cm(config.width, 500, 150, 750);
    const depth = cm(config.depth, 300, 100, 340);
    const height = cm(config.height, 280, 280, 280);
    const wall = .22, floor = .12, roofThickness = .16;
    const bounds = {left: -width / 2, right: width / 2, back: -depth / 2, front: depth / 2};
    const layoutConfig={...config,width:Math.round(width*100),depth:Math.round(depth*100),height:Math.round(height*100),frontOpening:typeof config.frontOpening==='string'?config.frontOpening:'french-black',rooflight:typeof config.rooflight==='string'?config.rooflight:'none',drainSide:config.drainSide??'right'};
    const matchesLayout=fixtureLayout?.version===2&&fixtureLayout?.units==='cm'&&Object.entries(fixtureLayout.basis??{}).length===6&&Object.entries(fixtureLayout.basis).every(([key,value])=>layoutConfig[key]===value);
    const layout=matchesLayout?fixtureLayout:buildFixtureLayout(layoutConfig,geometryRules),metres=point=>point.map(value=>value/100);
    const openingCode = typeof config.frontOpening === 'string' ? config.frontOpening : 'french-black';
    const kind = openingCode.startsWith('french') ? 'french' : openingCode.startsWith('sliding-4') ? 'sliding-4'
        : openingCode.startsWith('sliding-2') ? 'sliding-2' : openingCode.startsWith('folding') ? 'folding' : 'none';
    // Same rule as openingApertureCm, in metres: dividing the cm constants keeps the exact doubles the metric model
    // has always used, where a round-trip through centimetres would drift on a fractional imported width.
    const openingWidth = Math.min(width - PIER_MINIMUM_CM / 100, OPENING_SPAN_CM[kind] / 100);
    const openingHeight = Math.min(2.3, height - .35);
    const sections = openingLayout(kind, openingWidth);
    const opening = {kind, width: openingWidth, height: openingHeight, bottom: .07,
        x: 0, z: bounds.front - wall / 2, frame: openingCode.endsWith('white') ? '#efede6' : '#303432',
        bars: openingCode.includes('bars'), panelCount: sections.length, skeleton: kind === 'none'};
    const box = (key, x, y, z, w, h, d, role = 'wall') => ({key, center: [x,y,z], size: [w,h,d], role});
    const walls = [
        box('left', bounds.left + wall / 2, height / 2, 0, wall, height, depth),
        box('right', bounds.right - wall / 2, height / 2, 0, wall, height, depth),
    ];
    // Every kozijn, "geen kozijn" included, leaves a real hole in the front wall: two piers and a header over it.
    const pier = (width - openingWidth) / 2;
    walls.push(box('front-left', bounds.left + pier / 2, height / 2, opening.z, pier, height, wall),
        box('front-right', bounds.right - pier / 2, height / 2, opening.z, pier, height, wall),
        box('front-header', 0, (height + openingHeight + opening.bottom) / 2, opening.z,
            openingWidth, height - openingHeight - opening.bottom, wall));
    // One panel per SECTION of the product (openingLayout): fixed panes, sliding and folding leaves and doors, each
    // with its role, grille, handle and hinge — the 3D, the icons and the drawings build from these, not from slices.
    const panels = sections.map(section => ({...section, height: openingHeight, bottom: opening.bottom,
        z: opening.z, bars: opening.bars}));
    const roofCode = typeof config.rooflight === 'string' ? config.rooflight : 'none';
    const match = /^(lean|gable)-(\d+)$/.exec(roofCode);
    const roofKind = match && ((match[1] === 'lean' && +match[2] >= 1 && +match[2] <= 5)
        || (match[1] === 'gable' && [2,4,6,8,10].includes(+match[2]))) ? match[1] : 'none';
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
                // Lean-to: high edge against the house (back), falling toward the garden so water runs off.
                const ya = roofKind === 'lean' ? y1 : side === 0 ? y0 : y1;
                const yb = roofKind === 'lean' ? y0 : side === 0 ? y1 : y0;
                rooflight.panels.push({index: rooflight.panels.length, points: [[x0,ya,z0],[x1,ya,z0],[x1,yb,z1],[x0,yb,z1]]});
            }
        }
    }
    // The roof slab stays flush with the wall faces; an overstek is a boeiboord band around three walls that carries
    // the roof 20 cm past the garden side only (never over the neighbours), its underside in the same finish and
    // the daktrim on top of it.
    const overhang=['pvc-white','pvc-anthracite','wood-white'].includes(config.overhang)?config.overhang:'none';
    const overhangDepth=overhang==='none'?0:.20,fasciaHeight=overhang==='none'?0:.32,fascia=.035;
    // The slab always ends just inside the visible edge: behind the facade band or the boeiboord (no coplanar faces).
    const roofReach=overhang==='none'?-.012:overhangDepth-fascia,sideInset=overhang==='none'?.012:fascia;
    const roofFront=bounds.front+roofReach,slabDepth=depth+roofReach,roofZ=(bounds.back+roofFront)/2;
    const roofLeft=bounds.left+sideInset,roofRight=bounds.right-sideInset;
    const roof = [];
    if (!roofCount) roof.push(box('roof', 0, height, roofZ, roofRight - roofLeft, roofThickness, slabDepth, 'roof'));
    else {
        const o = rooflight.opening;
        roof.push(box('roof-left', (roofLeft + o.left) / 2, height, roofZ,
            o.left - roofLeft, roofThickness, slabDepth, 'roof'),
            box('roof-right', (roofRight + o.right) / 2, height, roofZ,
                roofRight - o.right, roofThickness, slabDepth, 'roof'),
            box('roof-back', 0, height, (bounds.back + o.back) / 2,
                roofWidth, roofThickness, o.back - bounds.back, 'roof'),
            box('roof-front', 0, height, (roofFront + o.front) / 2,
                roofWidth, roofThickness, roofFront - o.front, 'roof'));
    }
    const markers = [];
    const positions = value => {const side=String(value||'').replace(/^double-/, '');return side === 'both' ? ['left','right'] : ['left','right'].includes(side) ? [side] : [];};
    for (const [field,type,y] of [['outsideLight','lighting-conduit',1.9],['outsideSocket','socket-conduit',1.05],['outsideTap','water-conduit',.65]]) {
        for (const side of positions(config[field])) if(layout.exterior[side].available)markers.push({type,side,surface:layout.exterior[side].surface,
            position:metres(layout.exterior[side][field==='outsideLight'?'light':field==='outsideSocket'?'socket':'tap'])});
    }
    for (const side of positions(config.heating)) markers.push({type:'heating-conduit',side,
        position:[side === 'left' ? bounds.left + wall + .025 : bounds.right - wall - .025,.35,0]});
    for (const side of positions(config.sockets)) markers.push({type:'interior-socket-conduit',side,
        position:[side === 'left' ? bounds.left + wall + .025 : bounds.right - wall - .025,.45,depth * .15]});
    const drainSide = config.drainSide === 'left' ? 'left' : 'right';
    // The downpipe takes its water at the roof EDGE, never through a hole in the roof floor: a kiezelbak on the
    // membrane drains through the inner face of the edge (2.17.0). Without an overstek the tube runs out under the
    // uninterrupted daktrim into a hopper (HOPPER) on the facade directly under the trim, and the pipe hangs from it.
    // With an overstek the pipe stands against the facade UNDER the overstek and goes up into the soffit, where the tube
    // meets it inside the overstek — the opening in the edge lies right above it (2.18.3, the owner: "onun içeriden
    // olması lazım ... şu anki müşterim o şekilde montaj yapmıyor": the vergaarbak on the boeiboord with a zwanenhals of
    // 2.18.2 is not how they fit it). `height` is the top of the PIPE where it is seen: the hopper's outlet, or the soffit.
    const trimBottom = height + roofThickness / 2 + (DAKTRIM_FACE[config.roofEdge] || DAKTRIM_FACE.anthracite).bottom;
    const hopper = overhang === 'none' ? {top: trimBottom - HOPPER.gap, bottom: trimBottom - HOPPER.gap - HOPPER.height, face: bounds.front, z: bounds.front + .1} : null;
    const drain = {side:drainSide,material:['zinc','pvc-black'].includes(config.drainMaterial) ? config.drainMaterial : 'pvc',
        x:drainSide === 'left' ? bounds.left + .12 : bounds.right - .12,z:bounds.front + .1,hopper,
        height:hopper ? hopper.bottom : height + roofThickness / 2 - fasciaHeight};
    const drains=config.drainSide==='both'?[-1,1].map(sign=>({...drain,side:sign<0?'left':'right',x:sign*(width/2-.12)})):[drain];
    const fixtures=[];
    const add=(id,key,kind,position,rotation=0,room='interior',extra={})=>fixtures.push({id,key,kind,position,rotation,room,...extra});
    for(const [field,kind,y] of [['outsideLight','wall-light',1.9],['outsideSocket','socket',1.05],['outsideTap','tap',.65]]) {
        for(const side of positions(config[field])) {
            const mount=layout.exterior[side];
            if(mount.available)add(`${field}-${side}`,field,kind,metres(mount[field==='outsideLight'?'light':field==='outsideSocket'?'socket':'tap']),mount.rotation,'outside',{side,surface:mount.surface,double:String(config[field]).startsWith('double-')});
        }
    }
    const selections=(field,valid,fallback=[])=>Array.isArray(config[field])?[...new Set(config[field])].filter(v=>valid.includes(v)):fallback;
    const wallIds=['L1','L2','L3','R1','R2','R3'];
    const wallPoint=(id,type)=>metres(layout.wallPositions[id][type]);
    const ceilingPositions=selections('ceilingPositions',['left','center','right'],Number(config.ceilingLights)===1?['center']:Number(config.ceilingLights)>=2?['left','right']:[]);
    const spotIds=Array.from({length:15},(_,i)=>`r${Math.floor(i/5)+1}c${i%5+1}`);
    const spotPositions=selections('spotPositions',spotIds,spotIds.slice(0,Math.max(0,Math.min(15,Number(config.spotlights)||0))));
    const socketPositions=selections('socketPositions',wallIds,positions(config.sockets).map(side=>side==='left'?'L2':'R2'));
    const wallLights=selections('wallLights',wallIds);
    if(config.interior){
        for(const side of positions(config.heating))add(`heating-${side}`,'heating','radiator',metres(layout.heating[side]),side==='left'?Math.PI/2:-Math.PI/2,'interior',{side});
        for(const id of socketPositions)add(`socket-${id}`,'sockets','socket',wallPoint(id,'socket'),id[0]==='L'?Math.PI/2:-Math.PI/2);
        for(const id of wallLights)add(`wall-light-${id}`,'wallLights','wall-light',wallPoint(id,'light'),id[0]==='L'?Math.PI/2:-Math.PI/2);
        // Switches sit in one column per side wall next to the connection with the house, like beside a room door.
        const controlColumn={left:0,right:0};
        const controlPoint=(side,index)=>[side==='left'?bounds.left+wall+.028:bounds.right-wall-.028,1.05,bounds.back+.30+index*.09];
        const controlled={ceilingLightControl:ceilingPositions.length,spotControl:spotPositions.length,wallLightControl:wallLights.length};
        for(const field of ['ceilingLightControl','spotControl','wallLightControl']){
            const value=String(config[field]||''),side=value.endsWith('-left')?'left':value.endsWith('-right')?'right':null;
            if(!side||!controlled[field])continue;
            const kind=value.startsWith('dimmed')?'dimmer':'switch';
            add(`${field}-${side}`,field,kind,controlPoint(side,controlColumn[side]++),side==='left'?Math.PI/2:-Math.PI/2,'interior',{side});
        }
        for(let i=0;i<Math.max(0,Math.min(2,Number(config.switches)||0));i++){
            const side=controlColumn.left<=controlColumn.right?'left':'right';
            add(`switch-${i}`,'switches','switch',controlPoint(side,controlColumn[side]++),side==='left'?Math.PI/2:-Math.PI/2,'interior',{side});
        }
        for(const id of ceilingPositions)add(`ceiling-${id}`,'ceilingLights','pendant',metres(layout.ceilingPositions[id]),0,'ceiling');
        for(const id of spotPositions)add(`spot-${id}`,'spotlights','spot',metres(layout.spotPositions[id]),0,'ceiling');
    }
    const overhangSpots=overhang==='none'?0:Math.max(0,Math.min(6,Math.trunc(Number(config.overhangSpots)||0)));
    const soffitY=height+roofThickness/2-fasciaHeight;
    for(let i=0;i<overhangSpots;i++)add(`overhang-spot-${i}`,'overhangSpots','spot',[bounds.left+width*(i+1)/(overhangSpots+1),soffitY-.004,bounds.front+overhangDepth/2],0,'overhang');
    const floorRoute=underfloorRoute({bounds,wall});
    return {version:2,units:'m',axes:{front:'+z',left:'-x',up:'+y'},width,depth,height,wall,floor,roofThickness,fixtureLayout:layout,
        area:Math.round(width * depth * 100) / 100,bounds,opening,panels,walls,roof,rooflight,markers,drain,drains,fixtures,
        openingMaterial:config.openingMaterial||'unspecified',greenRoof:!!config.greenRoof,overhang,overhangDepth,fasciaHeight,overhangSpots,
        roofShade:!!config.roofShade&&['lean-1','lean-2','lean-3'].includes(roofCode),painting:!!config.plaster&&!!config.painting,
        ceilingPositions,spotPositions,socketPositions,wallLights,
        facade:config.facade || 'wood-vertical',roofEdge:config.roofEdge || 'anthracite',rollaag:config.rollaag || 'masonry',
        interior:!!config.interior,plaster:!!config.plaster,screed:!!config.screed,underfloorHeating:!!config.underfloorHeating,
        underfloorLoops:config.interior&&config.underfloorHeating&&floorRoute.points.length?[floorRoute.points]:[],
        ceilingLights:ceilingPositions.length,
        switches:Math.max(0,Math.min(2,Math.trunc(Number(config.switches)||0))),
        spotlights:spotPositions.length};
}

const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function underfloorPlanMarkup(model,scope,examplesVisible=true,interactive=false) {
    if(!model.underfloorLoops?.length)return '';
    const row=scope.find(item=>item.key==='underfloorHeating');
    if(row?.visualMode==='none')return '';
    const supplied=row?.visualMode!=='preparation'&&(row?.productIncluded===true||row?.components?.some(c=>c.role==='product'&&['included','extra'].includes(c.status)));
    if(!supplied&&!examplesVisible)return '';
    const label=supplied?'Vloerverwarmingsleidingen · inbegrepen, indicatief model':'Vloerverwarmingsleidingen · ter illustratie, geen productlevering';
    const paths=model.underfloorLoops.map(points=>`<polyline points="${points.map(([x,,z])=>`${x},${z}`).join(' ')}" fill="none" stroke="#aa754b" stroke-width=".011" stroke-opacity="${supplied?.58:.40}"${supplied?'':' stroke-dasharray=".055 .025"'} stroke-linejoin="round" stroke-linecap="round"/>`).join('');
    return `<g data-option-key="underfloorHeating" data-underfloor-loop="true"${interactive?` tabindex="0" role="button" aria-label="${esc(label)}"`:''}><title>${esc(label)}</title>${paths}</g>`;
}

function fixturePlanMarkup(m,scope,examplesVisible,interactive){
    const rect=(x,z,w,d,attrs='')=>`<rect x="${x}" y="${z}" width="${w}" height="${d}" ${attrs}/>`;
    const names={heating:'Radiator',outsideTap:'Buitenkraan',outsideLight:'Buitenlicht',outsideSocket:'Buitenstopcontact',ceilingLights:'Plafondlamp',spotlights:'Spot',sockets:'Stopcontact',wallLights:'Wandlamp',switches:'Schakelaar',overhangSpots:'Overstekspot',ceilingLightControl:'Bediening plafondlicht',spotControl:'Bediening spots',wallLightControl:'Bediening wandlicht'};
    const keys={ceilingLights:'ceilingPositions',spotlights:'spotPositions',sockets:'socketPositions'};
    const fittings=(m.fixtures||[]).map(f=>{
        const row=scope.find(item=>item.key===f.key),included=row?.productIncluded===true,preparation=row?.components?.some(c=>c.role==='preparation'&&['included','extra'].includes(c.status));
        if(row?.visualMode==='none')return '';
        const point=row?.visualMode==='preparation'||(!included&&!examplesVisible);
        if(point&&!preparation)return '';
        const [x,,z]=f.position,label=`${names[f.key]||f.key} · ${point?'voorbereiding':included?'inbegrepen':'ter illustratie, niet inbegrepen'}`;
        const attrs=`fill="${point?'#936a37':included?'#496354':'none'}" stroke="#365548" stroke-width=".014"${!included&&!point?' stroke-dasharray=".035 .018"':''}`;
        let symbol;
        if(point&&f.kind==='radiator')symbol=`<path d="M${x-.018} ${z-.025}h.036 M${x-.018} ${z+.025}h.036" stroke="#936a37" stroke-width=".018"/><title>Radiatoraansluitingen · geen stopcontact</title>`;
        else if(point)symbol=`<circle cx="${x}" cy="${z}" r=".028" ${attrs}/>`;
        else if(f.kind==='radiator'){const w=row?.assetKey==='heating-panel'?.90:.58;symbol=rect(x-(x<0?0:.13),z-w/2,.13,w,attrs);}
        else if(['pendant','spot','wall-light'].includes(f.kind))symbol=`<circle cx="${x}" cy="${z}" r="${f.kind==='pendant'?.10:.05}" ${attrs}/><path d="M${x-.035} ${z}h.07 M${x} ${z-.035}v.07" stroke="#365548" stroke-width=".01"/>`;
        else symbol=rect(x-.035,z-.035,.07,.07,attrs);
        return `<g data-option-key="${keys[f.key]||f.key}"${interactive?` tabindex="0" role="button" aria-label="${esc(label)}" style="cursor:pointer"`:''}><title>${esc(label)}</title>${symbol}</g>`;
    }).join('');
    return fittings;
}

export function planSvg(model, dimensions = true, {scope=[],examplesVisible=true,interactive=false}={}) {
    // A door swings out into the garden (Dutch garden doors open outward), so the view grows by its width.
    const m = model, padding = .85, swing = doorSwing(m);
    const view = [m.bounds.left-padding,m.bounds.back-padding,m.width+padding*2,m.depth+padding*2+swing];
    const rect = (x,z,w,d,attrs='') => `<rect x="${x}" y="${z}" width="${w}" height="${d}" ${attrs}/>`;
    const walls = m.walls.filter(w => w.key !== 'front-header').map(w => rect(w.center[0]-w.size[0]/2,w.center[2]-w.size[2]/2,w.size[0],w.size[2],'fill="#626e62"')).join('');
    // One mark per section as built (openingLayout): glass on the frame line, a sliding leaf on the inner track behind
    // it, a door with its swing drawn from the hinge it hangs on.
    const doors = m.panels.map(p => {
        const y = m.bounds.front-.11-(p.role === 'sliding' ? .05 : 0), x = p.x-p.width/2;
        let result = rect(x+.02,y,p.width-.04,.05,`data-plan-role="${p.role}" fill="#b4c3bc" stroke="#344b42" stroke-width=".025"`);
        if (p.role === 'door') {
            const hinge = p.hinge === 'left' ? x : x+p.width, end = p.hinge === 'left' ? x+p.width : x, out = m.bounds.front-.06;
            result += `<path d="M${hinge} ${out}v${p.width} M${end} ${out}A${p.width} ${p.width} 0 0 ${p.hinge === 'left' ? 1 : 0} ${hinge} ${out+p.width}" fill="none" stroke="#7b8c7c" stroke-width=".017" stroke-dasharray=".05 .035"/>`;
        }
        return result;
    }).join('');
    // "Geen kozijn": the gap between the piers is the opening; the dashed band is the outer frame the customer supplies.
    const skeleton = m.opening.skeleton && m.opening.width > 0
        ? `<g data-skeleton-opening="true"><title>Alleen buitenkozijn · kozijn door klant</title>${rect(-m.opening.width/2,m.bounds.front-.11,m.opening.width,.05,'fill="none" stroke="#3b403e" stroke-width=".02" stroke-dasharray=".06 .04"')}</g>` : '';
    const r = m.rooflight;
    const rooflight = r.panelCount ? rect(-r.width/2,r.z-r.depth/2,r.width,r.depth,'fill="#e7eeee" fill-opacity=".65" stroke="#8c9c90" stroke-width=".02" stroke-dasharray=".08 .06"')
        + r.panels.map(p=>`<path data-rooflight-panel="${p.index}" d="M${p.points.map(point=>`${point[0]} ${point[2]}`).join('L')}Z" fill="none" stroke="#a1ada5" stroke-width=".012"/>`).join('') : '';
    const wLabel = `${Math.round(m.width*100)} cm`, dLabel = `${Math.round(m.depth*100)} cm`;
    const fittings=underfloorPlanMarkup(m,scope,examplesVisible,interactive)+fixturePlanMarkup(m,scope,examplesVisible,interactive);
    const dimensionLines = dimensions ? `<g fill="none" stroke="#66796a" stroke-width=".015"><path d="M${m.bounds.left} ${m.bounds.front+swing+.2}v.35m0-.13h${m.width}m0-.22v.35 M${m.bounds.left-.2} ${m.bounds.back}h-.35m.13 0v${m.depth}m-.13 0h.35"/></g><g fill="#344b42" font-family="system-ui,sans-serif" font-size=".18" text-anchor="middle"><text x="0" y="${m.bounds.front+swing+.68}">${wLabel}</text><text x="${m.bounds.left-.58}" y="0" transform="rotate(-90 ${m.bounds.left-.58} 0)">${dLabel}</text></g>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.join(' ')}" role="${interactive?'group':'img'}" aria-label="Plattegrond van je aanbouw, ${esc(wLabel)} breed en ${esc(dLabel)} diep" style="width:100%;height:100%;display:block"><title>Plattegrond van je aanbouw</title><desc>Buitenmaten ${wLabel} bij ${dLabel}. ${m.opening.skeleton?'Alleen het buitenkozijn in de voorpui, kozijn door klant':`${m.opening.panelCount} panelen in de voorpui`}. ${r.panelCount} daklichtpanelen. Bovenzijde sluit aan op de bestaande woning. Symbolen zijn indicatief; contour is niet inbegrepen.</desc><rect x="${view[0]}" y="${view[1]}" width="${view[2]}" height="${view[3]}" fill="#f1f0e9"/><g transform="translate(0 ${m.bounds.back-.05})"><path d="M${m.bounds.left-.18} 0h${m.width+.36}" stroke="#b5b8ad" stroke-width=".09" stroke-dasharray=".16 .065"/><text x="0" y="-.24" text-anchor="middle" font-size=".16" fill="#626d59" font-family="system-ui,sans-serif">BESTAANDE WONING</text></g>${rect(m.bounds.left+m.wall,m.bounds.back,m.width-m.wall*2,m.depth-m.wall,'fill="#e5e0d3"')}${rooflight}${walls}${doors}${skeleton}<text x="0" y="${r.panelCount?m.bounds.front-.65:0}" text-anchor="middle" fill="#4d6153" font-family="system-ui,sans-serif" font-size=".32" font-weight="500">${m.area.toLocaleString('nl-NL')} m²</text>${fittings}${dimensionLines}</svg>`;
}

const drawingNumber = value => Number(value.toFixed(2));
/** How far the widest door of the kozijn swings out past the front wall, in metres (0 without a door). */
const doorSwing = m => Math.max(0, ...m.panels.filter(p => p.role === 'door').map(p => p.width));
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
export function documentPlanSvg(model,{scope=[]}={}) {
    // A door swings out into the garden: the sheet keeps room for that arc under the front wall, and the width
    // dimension and the garden label move out past it.
    const m=model,swing=doorSwing(m),s=Math.min(1060/m.width,550/m.depth,690/(m.depth+swing)),left=(1440-m.width*s)/2,top=Math.max(90,(820-(m.depth+swing)*s)/2);
    const X=x=>drawingNumber(left+(x-m.bounds.left)*s),Y=z=>drawingNumber(top+(z-m.bounds.back)*s);
    const bottom=Y(m.bounds.front),right=X(m.bounds.right),rect=(x,y,w,h,attrs)=>`<rect x="${x}" y="${y}" width="${drawingNumber(w)}" height="${drawingNumber(h)}" ${attrs}/>`;
    let content=rect(left,top,m.width*s,m.depth*s,'fill="#f2efe4"');
    content+=`<g transform="translate(${X(0)} ${Y(0)}) scale(${s})">${underfloorPlanMarkup(m,scope,true,false)}</g>`;
    content+=`<path d="M${left-20} ${top-10}H${right+20}" stroke="#84988b" stroke-width="5" stroke-dasharray="17 10"/><text x="720" y="${top-46}" text-anchor="middle" fill="#61776a" font-size="26" letter-spacing="2">BESTAANDE WONING</text>`;
    for(const wall of m.walls.filter(w=>w.key!=='front-header'))content+=rect(X(wall.center[0]-wall.size[0]/2),Y(wall.center[2]-wall.size[2]/2),wall.size[0]*s,wall.size[2]*s,'fill="url(#wall-hatch)" stroke="#405e4b" stroke-width="3"');
    const r=m.rooflight;
    if(r.panelCount) {
        content+=rect(X(-r.width/2),Y(r.z-r.depth/2),r.width*s,r.depth*s,'fill="#e6eeee" stroke="#8ca699" stroke-width="2" stroke-dasharray="12 8"');
        for(const p of r.panels)content+=`<path data-rooflight-panel="${p.index}" d="M${p.points.map(point=>`${X(point[0])} ${Y(point[2])}`).join('L')}Z" fill="none" stroke="#8ca699" stroke-width="2" stroke-dasharray="8 6"/>`;
    }
    for(const p of m.panels) {
        // One mark per section as built (openingLayout): glass on the frame line, a sliding leaf on the inner track
        // behind it, a door with its outward swing from the hinge it hangs on. Nothing gets a travel arrow.
        const x=X(p.x-p.width/2),y=drawingNumber(Y(m.bounds.front-.11)-(p.role==='sliding'?9:0)),width=p.width*s;
        content+=rect(drawingNumber(x+2),y,width-4,7,`data-plan-panel="${p.index}" data-plan-role="${p.role}" fill="#c1d4ce" stroke="#405e4b" stroke-width="2"`);
        if(p.role==='door') {
            const hinge=drawingNumber(p.hinge==='left'?x:x+width),end=drawingNumber(p.hinge==='left'?x+width:x),out=Y(m.bounds.front-.06),reach=drawingNumber(out+width);
            content+=`<path data-door-swing="${p.index}" data-hinge="${p.hinge}" d="M${hinge} ${out}V${reach} M${end} ${out}A${drawingNumber(width)} ${drawingNumber(width)} 0 0 ${p.hinge==='left'?1:0} ${hinge} ${reach}" fill="none" stroke="#809889" stroke-width="2" stroke-dasharray="9 6"/>`;
        }
    }
    // "Geen kozijn": the piers already leave the hole; this band is the outer frame the customer supplies later.
    if(m.opening.skeleton&&m.opening.width>0)content+=rect(X(-m.opening.width/2),Y(m.bounds.front-.11),m.opening.width*s,7,'data-skeleton-opening="true" fill="none" stroke="#405e4b" stroke-width="2" stroke-dasharray="10 7"');
    content+=`<g transform="translate(${X(0)} ${Y(0)}) scale(${s})">${fixturePlanMarkup(m,scope,true,false)}</g>`;
    if(m.fixtures?.length)content+='<text x="720" y="36" text-anchor="middle" fill="#526c5e" font-size="19">Symbolen indicatief · contour: niet inbegrepen · gevuld: inbegrepen</text>';
    const areaY=r.panelCount?Math.min(bottom-58,Y(r.z+r.depth/2)+58):top+m.depth*s/2+15;
    content+=`<text x="720" y="${areaY}" text-anchor="middle" fill="#405e4b" font-size="42" font-weight="500">${esc(m.area.toLocaleString('nl-NL'))} m²</text>`;
    const out=drawingNumber(swing*s);
    content+=drawingDimension(left,bottom,right,bottom,centimetres(m.width),85+out)+drawingDimension(left,top,left,bottom,centimetres(m.depth),-85);
    content+=`<text x="720" y="${Math.min(925,bottom+144+out)}" text-anchor="middle" fill="#87958b" font-size="25" letter-spacing="2">TUINZIJDE</text>`;
    return drawingSheet('Plattegrond',`Buitenmaten ${centimetres(m.width)} bij ${centimetres(m.depth)}. ${m.opening.skeleton?'alleen het buitenkozijn in de voorpui (kozijn door klant)':`${m.opening.panelCount} panelen in de voorpui`}, ${r.panelCount} daklichtpanelen. Stippellijnen tonen het daklicht boven de ruimte.`,content);
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
    // Without an overstek the facade runs up over the roof slab to the thin daktrim.
    const slabTop=m.height+m.roofThickness/2,facadeTop=m.overhangDepth?m.height:slabTop;
    content+=rect(left,Y(facadeTop),span*s,facadeTop*s,`fill="${colour}" stroke="#405849" stroke-width="3"`);
    if(texture)content+=rect(left,Y(facadeTop),span*s,facadeTop*s,`fill="url(#${texture})"`);
    // Roof edge: the daktrim is a thin capping; an overstek adds a boeiboord band that projects past the walls.
    const overhang=m.overhangDepth||0,edgeLeft=X(0),roofSpan=span+(front?0:overhang);
    if(overhang)content+=rect(edgeLeft-2,Y(slabTop),roofSpan*s+4,m.fasciaHeight*s,`data-overhang="${esc(m.overhang)}" fill="${m.overhang==='pvc-anthracite'?'#3d4443':'#ecebe4'}" stroke="#4c6052" stroke-width="2"`);
    content+=rect(edgeLeft-2,Y(slabTop),roofSpan*s+4,.05*s,`data-roof-edge="${esc(m.roofEdge)}" fill="${m.roofEdge==='anthracite'?'#3a3f3d':m.roofEdge==='zinc'?'#a9b1ae':'#c7cec7'}" stroke="#4c6052" stroke-width="2"`);
    if(front&&m.rollaag!=='masonry'&&m.opening.width>0){
        // Panel from directly above the frame up to the daktrim (or the underside of the overstek band).
        const o=m.opening,frameTop=o.bottom+o.height,panelTop=overhang?slabTop-m.fasciaHeight:slabTop-.05;
        content+=rect(X((m.width-o.width)/2),Y(panelTop),o.width*s,(panelTop-frameTop)*s,`data-rollaag="${esc(m.rollaag)}" fill="${m.rollaag==='panel-white'?'#edece5':'#2f3533'}"`);
    }
    if(front&&m.opening.width>0) {
        const o=m.opening,openingLeft=(m.width-o.width)/2;
        // A skeleton opening is a void with only its outer frame: no pane tone, no divisions, no swing lines.
        content+=rect(X(openingLeft),Y(o.height+o.bottom),o.width*s,o.height*s,
            o.skeleton?`data-skeleton-opening="true" fill="#f4f2ea" stroke="${o.frame}" stroke-width="8"`:`fill="#dce8e4" stroke="${o.frame}" stroke-width="8"`);
        // Each section as built (openingLayout, KOZIJN): its grille band, its roedes, how it opens and its handle. A
        // door's triangle points at its hinge and is drawn solid, because it opens toward the viewer in the garden.
        const k=kozijnProfile(o.kind,{bars:o.bars,material:m.openingMaterial}),family=k.family;
        const sill=o.bottom+(k.lip||0),headLine=o.bottom+o.height-k.head,hardware='#56645b';
        for(const p of m.panels) {
            const x=p.x+m.width/2,l=x-p.width/2,r=x+p.width/2;
            content+=`<path data-front-panel="${p.index}" d="M${X(l)} ${Y(o.bottom)}V${Y(o.bottom+o.height)} M${X(r)} ${Y(o.bottom)}V${Y(o.bottom+o.height)}" stroke="${o.frame}" stroke-width="5"/>`;
            // A side light of openslaande deuren is glazed under the head; every sash has its top rail first.
            const members=sectionMembers(k,p),glassTop=headLine-members.top,paneBottom=sill+members.bottom,paneTop=glassTop-(p.grille?KOZIJN.grille.height:0);
            if(p.grille)content+=rect(X(l),Y(glassTop),p.width*s,KOZIJN.grille.height*s,`data-front-grille="${p.index}" fill="${o.frame}" stroke="#8b9a90" stroke-width="1.5"`)
                +`<path d="M${X(l+.04)} ${Y(glassTop-KOZIJN.grille.below)}H${X(r-.04)}" stroke="#1b1e1d" stroke-width="3" stroke-dasharray="5 2"/>`;
            if(p.bars)for(let n=1;n<=KOZIJN.bars;n++)content+=`<path data-front-bar="${p.index}" d="M${X(l)} ${Y(paneBottom+(paneTop-paneBottom)*n/(KOZIJN.bars+1))}H${X(r)}" stroke="${o.frame}" stroke-width="3"/>`;
            if(p.role==='door'){
                const [hinge,free]=p.hinge==='left'?[l,r]:[r,l];
                content+=`<path data-front-swing="${p.index}" data-hinge="${p.hinge}" d="M${X(free)} ${Y(sill)}L${X(hinge)} ${Y((sill+headLine)/2)}L${X(free)} ${Y(headLine)}" fill="none" stroke="#7d9488" stroke-width="2"/>`;
            }
            if(p.role==='sliding'){
                const dir=p.opens==='left'?-1:1,y=Y(o.bottom+1.35);
                content+=`<path data-front-slide="${p.index}" data-opens="${p.opens}" d="M${X(x-dir*p.width*.22)} ${y}H${X(x+dir*p.width*.22)}m${-dir*12} -8l${dir*12} 8l${-dir*12} 8" fill="none" stroke="#7d9488" stroke-width="3"/>`;
            }
            if(p.handle){
                const edge=p.handle.edge==='left'?-1:1,hx=x+edge*(p.width/2-k.stile/2);
                if(p.handle.type==='pull'){
                    const pull=KOZIJN.pull,y=o.bottom+(family==='folding'?pull.foldingY:pull.y);
                    content+=rect(X(hx-pull.width/2),Y(y+pull.height/2),pull.width*s,pull.height*s,`data-front-handle="${p.index}" data-handle="pull" fill="none" stroke="${hardware}" stroke-width="2"`);
                } else {
                    const lever=KOZIJN.lever,y=o.bottom+lever.y;
                    content+=`<path data-front-handle="${p.index}" data-handle="lever" d="M${X(hx)} ${Y(y+.05)}V${Y(y-.11)} M${X(hx)} ${Y(y)}H${X(hx-edge*lever.length)}" fill="none" stroke="${hardware}" stroke-width="3"/>`;
                }
            }
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
            const top=r.kind==='gable'?`${X(x0)} ${Y(y0)}L${X(middle)} ${Y(y1)}L${X(x1)} ${Y(y0)}`:`${X(x0)} ${Y(y1)}L${X(x1)} ${Y(y0)}`;
            content+=`<path data-rooflight-profile="${r.kind}" d="M${X(x0)} ${Y(m.height+.08)}L${top}V${Y(m.height+.08)}Z" fill="#dfebe6" stroke="#6a8171" stroke-width="3"/>`;
        }
    }
    if(front) {
        // The pipe runs into the ground (2.16.0, "HWA buizen komen in de grond") — the 45° shoe this drawing still carried
        // was retired from the 3D then — and without an overstek it hangs from its hopper under the daktrim (2.17.0);
        // with one it goes up into the soffit (2.18.3).
        for(const drain of m.drains||[m.drain]){const drainX=X(drain.x+m.width/2),stroke=drain.material==='zinc'?'#9ba99d':'#6b7b6d';
        content+=`<path data-drain-side="${drain.side}" d="M${drainX} ${Y(drain.height)}V${Y(0)}" fill="none" stroke="${stroke}" stroke-width="8"/>`;
        if(drain.hopper){const [top,bottom]=[HOPPER.top[0]/2*s,HOPPER.bottom[0]/2*s];
            content+=`<path data-drain-hopper="${drain.side}" d="M${drainX-top} ${Y(drain.hopper.top)}H${drainX+top}L${drainX+bottom} ${Y(drain.hopper.bottom)}H${drainX-bottom}Z" fill="${stroke}" stroke="#4c6052" stroke-width="2"/>`;}}
        for(const marker of m.markers.filter(item=>!item.type.startsWith('interior')&&!item.type.startsWith('heating')))content+=`<circle data-connection="${marker.type}" cx="${X(marker.position[0]+m.width/2)}" cy="${Y(marker.position[1])}" r="6" fill="#bd9463" stroke="#6a765d" stroke-width="2"/>`;
    } else {
        content+=`<path d="M${left-12} ${base}V${Y(m.height+.62)}" stroke="#99aa9e" stroke-width="4" stroke-dasharray="12 8"/><text x="${left-37}" y="${Y(m.height/2)}" text-anchor="middle" transform="rotate(-90 ${left-37} ${Y(m.height/2)})" fill="#8a9b8e" font-size="23" letter-spacing="1">BESTAANDE WONING</text>`;
        if((m.drains||[m.drain]).some(d=>d.side==='right')){
            content+=`<path d="M${X(span)+9} ${Y(m.drain.height)}V${Y(0)}" stroke="#7b8c7d" stroke-width="8"/>`;
            // Seen from the side the hopper shows its depth: from the facade line out over the pipe. Under an overstek
            // the pipe simply runs up into the soffit (2.18.3).
            if(m.drain.hopper)content+=`<path data-drain-hopper="side" d="M${X(span)} ${Y(m.drain.hopper.top)}H${X(span)+HOPPER.top[1]*s}L${X(span)+HOPPER.bottom[1]*s} ${Y(m.drain.hopper.bottom)}H${X(span)}Z" fill="#7b8c7d" stroke="#4c6052" stroke-width="2"/>`;
        }
    }
    content+=drawingDimension(left,base,X(span),base,centimetres(span),front&&m.opening.width>0?142:87)+drawingDimension(left,Y(m.height),left,base,centimetres(m.height),-100);
    const title=front?'Voorgevel vanuit de tuin':'Rechter zijgevel';
    return drawingSheet(title,`${title}. Buitenmaat ${centimetres(span)}, wandhoogte ${centimetres(m.height)}. Kozijn- en daklichtmaten zijn schematisch.`,content);
}

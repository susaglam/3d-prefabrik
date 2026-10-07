import * as THREE from '../vendor/three.module.js';

/** Small, dimensioned manufactured profiles. These are generic, not supplier CAD. */
export function profileGeometry(width,height,depth,bevel=.0015){
    const b=Math.min(bevel,width/5,height/5,depth/5),shape=new THREE.Shape();
    shape.moveTo(b,b);shape.lineTo(width-b,b);shape.lineTo(width-b,height-b);shape.lineTo(b,height-b);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:depth-2*b,bevelEnabled:true,bevelSize:b,bevelThickness:b,bevelSegments:1,steps:1,curveSegments:1});
    geometry.translate(-width/2,-height/2,-depth/2+b);return geometry;
}

/**
 * A soft-edged pad — mattress, duvet, pillow, seat or back cushion, rug pile. A rounded rectangle extruded with a
 * bevel, so a textile never has the hard 90° corner that makes a box read as a crate. Centred on the origin; the
 * returned geometry measures exactly width × height × depth, because the bevel eats inward rather than adding.
 *
 * It lives here rather than beside its first caller so the indoor upholstery (interior_scenes.js: bed, rug) and the
 * outdoor upholstery (preview.js: the garden chairs' cushions) come out of ONE definition of what a cushion is in
 * this product. Two implementations would drift, and the two are seen in the same picture through the glazing.
 */
export function softPad(width,height,depth,{radius=.06,bevel=.02,curveSegments=5}={}){
    const b=Math.max(.002,Math.min(bevel,width/4,depth/4,height/3)),w=width/2-b,d=depth/2-b;
    const r=Math.max(.001,Math.min(radius,w*.98,d*.98));
    const shape=new THREE.Shape();
    shape.moveTo(-w+r,-d);
    shape.lineTo(w-r,-d);shape.quadraticCurveTo(w,-d,w,-d+r);
    shape.lineTo(w,d-r);shape.quadraticCurveTo(w,d,w-r,d);
    shape.lineTo(-w+r,d);shape.quadraticCurveTo(-w,d,-w,d-r);
    shape.lineTo(-w,-d+r);shape.quadraticCurveTo(-w,-d,-w+r,-d);
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:Math.max(.001,height-2*b),bevelEnabled:true,
        bevelThickness:b,bevelSize:b,bevelSegments:2,curveSegments,steps:1});
    geometry.rotateX(-Math.PI/2);   // extrude along +y, the rounded outline lying on the floor
    geometry.center();
    return geometry;
}

export function surfaceTexture(kind){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d'),data=ctx.createImageData(256,256);let seed=194;
    for(let i=0;i<data.data.length;i+=4){seed=seed*16807%2147483647;const value=kind==='concrete'?172+(seed%31):210+(seed%12);data.data[i]=data.data[i+1]=data.data[i+2]=value;data.data[i+3]=255;}
    ctx.putImageData(data,0,0);const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;return texture;
}

/**
 * The roof as it is built (2.13.0, the customer: "daktrim çatının iç kısmına bakan tarafında biraz daha derinlik olmalı").
 * A daktrim is clamped on a timber kantplank that stands above the roof deck, and the membrane runs up the inside of
 * that kantplank: seen from above, the trim is a rim with a real inner face, not a strip level with the roof. The 3D
 * scene therefore lays the finished membrane ROOF_RECESS below the top of the slab. Only the membrane goes down — the
 * slab edge, facade band, boeiboord and trim keep every outside dimension the drawings and the Python side use.
 * TRIM_REACH is how far the trim's top leg runs in over the roof from the outer edge (buildRoofEdge: shift -.04,
 * width .10), and so where the membrane-clad inner face of the kantplank stands.
 */
export const ROOF_RECESS = .045;
export const TRIM_REACH = .09;

/**
 * Downpipe dimensions: an 80 mm pipe (the scene has always drawn it 75 mm across), bends of 70 mm, and a 45° uitloop
 * ("borunun 45'lik dirsek bağlantı kısmı yuvarlak olmalı") of 140 mm from the corner, whose corner stands 20 cm up.
 */
export const DOWNPIPE = Object.freeze({radius: .0375, bend: .07, shoe: .14, shoeY: .2, ground: -.28});

/**
 * One downpipe as a polyline, top to bottom: ONE plumb line down the facade into the ground. Without an overstek it
 * hangs from its hopper under the daktrim (geometry.js HOPPER; drain.height is the hopper's outlet); with one it goes
 * 2 cm up into the soffit, so no gap shows where it disappears. `drain` is a geometry.js drain (x, z, height, hopper).
 */
export function downpipeRoute(drain) {
    // 2.16.0, the customer: "HWA buizen komen in de grond" — straight down past the terras into the ground, no 45° shoe.
    // 2.17.0, the owner: no elbow into the wall under the roof edge either; the water reaches the pipe through a hopper.
    // 2.18.3, the owner: under an overstek the pipe stays inside, up into the soffit — no hopper on the boeiboord.
    const {x, z} = drain;
    return [[x, drain.height + (drain.hopper ? 0 : .02), z], [x, DOWNPIPE.ground, z]];
}

/** The zijuitloop (stadsuitloop): a rectangular tube through the roof edge into the back of the hopper, 80 x 60 mm. */
export const SPOUT = Object.freeze({width: .08, height: .06, into: .03, reach: .07});

/**
 * A polyline as straight runs and rounded bends. Each interior corner becomes a quadratic bend from `bend` metres
 * before the corner to `bend` after it — less where a leg is short, never more than half a leg, so two bends on one
 * leg cannot overlap. The bend is tangent to both legs, so the pipe runs through it without a kink. The first and
 * last parts are always straight runs (the last one is the open end of the pipe).
 */
export function roundedRoute(points, bend) {
    const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const toward = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    const parts = [];
    let from = points[0];
    for (let i = 1; i < points.length; i++) {
        const corner = points[i];
        if (i === points.length - 1) { parts.push({kind: 'line', from, to: corner}); break; }
        const next = points[i + 1], legIn = distance(from, corner), legOut = distance(corner, next);
        const cut = Math.min(bend, legIn / 2, legOut / 2);
        const start = toward(corner, from, cut / legIn), end = toward(corner, next, cut / legOut);
        if (distance(from, start) > 1e-6) parts.push({kind: 'line', from, to: start});
        parts.push({kind: 'bend', from: start, corner, to: end});
        from = end;
    }
    return parts;
}

/** Tube geometries for roundedRoute parts: one segment per straight run, `bendSegments` per bend. */
export function pipeGeometries(parts, radius, {radial = 14, bendSegments = 12} = {}) {
    const vector = p => new THREE.Vector3(...p);
    return parts.map(part => new THREE.TubeGeometry(part.kind === 'bend'
        ? new THREE.QuadraticBezierCurve3(vector(part.from), vector(part.corner), vector(part.to))
        : new THREE.LineCurve3(vector(part.from), vector(part.to)), part.kind === 'bend' ? bendSegments : 1, radius, radial, false));
}


/** Continuous physical courses across separate wall segments, including returns. */
export function metricUVs(geometry,position,periodX,periodY){
    const points=geometry.attributes.position,normals=geometry.attributes.normal,uv=geometry.attributes.uv;
    for(let i=0;i<points.count;i++){
        const x=points.getX(i)+position[0],y=points.getY(i)+position[1],z=points.getZ(i)+position[2];
        const side=Math.abs(normals.getX(i))>.5,top=Math.abs(normals.getY(i))>.5;
        uv.setXY(i,(side?z:x)/periodX,(top?z:y)/periodY);
    }
    uv.needsUpdate=true;return geometry;
}

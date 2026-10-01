import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../addons/cs_prefab_configurator/static/src/geometry.js',import.meta.url),'utf8');
const {buildGeometry,planSvg}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const overlaps=(a0,a1,b0,b1)=>Math.min(a1,b1)-Math.max(a0,b0)>1e-8;

test('centimetres become metres once, with consistent garden-facing coordinates',()=>{
    const m=buildGeometry({width:620,depth:320,height:280});
    assert.equal(m.width,6.2);assert.equal(m.depth,3.2);assert.equal(m.height,2.8);assert.equal(m.area,19.84);
    assert.equal(m.bounds.left,-3.1);assert.equal(m.bounds.front,1.6);
    assert.equal(m.axes.front,'+z');assert.equal(m.axes.left,'-x');
});

test('an opening removes front wall solids throughout its clear area',()=>{
    for(const type of ['none','french-black','sliding-2-white','sliding-4-black','folding-white']){
        const m=buildGeometry({frontOpening:type,width:500});const o=m.opening;
        for(const wall of m.walls.filter(w=>w.key.startsWith('front'))){
            const intersectsX=overlaps(wall.center[0]-wall.size[0]/2,wall.center[0]+wall.size[0]/2,-o.width/2,o.width/2);
            const intersectsY=overlaps(wall.center[1]-wall.size[1]/2,wall.center[1]+wall.size[1]/2,o.bottom,o.bottom+o.height);
            assert.ok(!(intersectsX&&intersectsY),`${type} clear aperture intersects ${wall.key}`);
        }
    }
});

test('"geen kozijn" is a skeleton opening: a real aperture, no leaves, sized like the 2-leaf schuifpui',()=>{
    // The customer fits their own frame later, so the extension keeps the rough opening a sliding-2 would get here.
    for(const [width,expected] of [[150,.6],[230,1.4],[410,3.2],[500,3.2],[750,3.2]]){
        const m=buildGeometry({width,frontOpening:'none'}),sliding=buildGeometry({width:Math.max(width,230),frontOpening:'sliding-2-black'});
        assert.equal(m.opening.kind,'none');assert.equal(m.opening.skeleton,true);
        assert.equal(m.panels.length,0);assert.equal(m.opening.panelCount,0);
        assert.ok(Math.abs(m.opening.width-expected)<1e-9,`${width}: ${m.opening.width} != ${expected}`);
        assert.equal(m.opening.height,2.3);assert.equal(m.opening.bottom,.07);
        if(width>=230)assert.ok(Math.abs(m.opening.width-sliding.opening.width)<1e-9,`${width} matches sliding-2`);
        // The front wall is piers plus a header, never one closed panel; both piers keep the 45 cm minimum.
        assert.deepEqual(m.walls.map(w=>w.key).sort(),['front-header','front-left','front-right','left','right']);
        for(const key of ['front-left','front-right'])assert.ok(m.walls.find(w=>w.key===key).size[0]>=.45-1e-9,key);
    }
    // A fitted kozijn stays exactly where it was: same span table, same pier minimum.
    assert.equal(buildGeometry({width:500,frontOpening:'french-black'}).opening.width,2.2);
    assert.equal(buildGeometry({width:500,frontOpening:'sliding-2-black'}).opening.skeleton,false);
});

test('door panel families preserve counts, span and selected colour/grid',()=>{
    for(const [frontOpening,count] of [['french-bars-white',2],['sliding-2-black',2],['sliding-4-white',4],['folding-black',4]]){
        const m=buildGeometry({frontOpening});assert.equal(m.panels.length,count);
        assert.ok(Math.abs(m.panels.reduce((sum,p)=>sum+p.width,0)-m.opening.width)<1e-9);
        assert.equal(m.opening.bars,frontOpening.includes('bars'));
        assert.equal(m.opening.frame,frontOpening.endsWith('white')?'#efede6':'#303432');
        assert.ok(m.opening.width<=m.width-.9+1e-9);
    }
});

test('all rooflight variants retain exact panel counts and fit inside the roof',()=>{
    for(const [rooflight,count] of [['lean-1',1],['lean-2',2],['lean-3',3],['lean-4',4],['gable-4',4],['gable-6',6],['gable-8',8]]){
        for(const [width,depth] of [[150,100],[200,200],[500,300],[750,340]]){
            const m=buildGeometry({width,depth,rooflight});
            assert.equal(m.rooflight.panels.length,count,rooflight);
            assert.ok(m.rooflight.opening.left>m.bounds.left);
            assert.ok(m.rooflight.opening.right<m.bounds.right);
            assert.ok(m.rooflight.opening.back>m.bounds.back);
            assert.ok(m.rooflight.opening.front<m.bounds.front);
        }
    }
});

test('minimum valid 150 by 100 cm is neither enlarged nor priced as a different shape',()=>{
    for(const frontOpening of ['none','french-black','sliding-2-white','sliding-4-black','folding-white']){
        const m=buildGeometry({width:150,depth:100,height:280,frontOpening,rooflight:'gable-8'});
        assert.equal(m.width,1.5);assert.equal(m.depth,1);assert.equal(m.area,1.5);
        assert.ok(m.walls.every(w=>w.size.every(n=>Number.isFinite(n)&&n>0)));
        assert.ok(m.roof.every(w=>w.size.every(n=>Number.isFinite(n)&&n>0)));
        assert.ok(m.panels.every(p=>p.width>0));
        // Even at the narrowest extension the aperture is real (60 cm between two 45 cm piers) and never negative.
        assert.ok(m.opening.width>0&&m.opening.width<=1.5-.9+1e-9,`${frontOpening}: ${m.opening.width}`);
        assert.equal(m.panels.length,frontOpening==='none'?0:m.opening.panelCount);
        assert.match(planSvg(m),/150 cm/);assert.match(planSvg(m),/100 cm/);
    }
});

test('four roof slabs never cover the configured rooflight opening',()=>{
    for(const rooflight of ['lean-1','lean-4','gable-4','gable-8']){
        const m=buildGeometry({rooflight});const o=m.rooflight.opening;
        assert.equal(m.roof.length,4);
        for(const slab of m.roof){
            const hitX=overlaps(slab.center[0]-slab.size[0]/2,slab.center[0]+slab.size[0]/2,o.left,o.right);
            const hitZ=overlaps(slab.center[2]-slab.size[2]/2,slab.center[2]+slab.size[2]/2,o.back,o.front);
            assert.ok(!(hitX&&hitZ),`${rooflight}: ${slab.key} blocks aperture`);
        }
    }
});

test('gable has two opposing slopes and a common ridge; lean has one slope',()=>{
    const g=buildGeometry({rooflight:'gable-6'}).rooflight;
    assert.equal(g.panels.length,6);
    for(const [i,p] of g.panels.entries()){
        const slope=p.points[2][1]-p.points[0][1];
        assert.ok(i<3?slope>0:slope<0);
        assert.ok(p.points.some(point=>Math.abs(point[2]-g.z)<1e-9&&Math.abs(point[1]-(g.baseY+g.rise))<1e-9));
    }
    const lean=buildGeometry({rooflight:'lean-3'}).rooflight;
    // Lean-to glass is high against the house (back, -z) and falls toward the garden.
    assert.ok(lean.panels.every(p=>p.points[0][1]>p.points[2][1]&&p.points[0][2]<p.points[2][2]));
});

test('drain and exterior conduit positions reflect explicit garden-facing sides',()=>{
    const m=buildGeometry({drainSide:'left',drainMaterial:'zinc',outsideLight:'both',outsideSocket:'right',outsideTap:'left'});
    assert.ok(m.drain.x<0);assert.equal(m.drain.material,'zinc');
    assert.equal(m.markers.length,4);
    for(const marker of m.markers){assert.ok(marker.side==='left'?marker.position[0]<0:marker.position[0]>0);assert.ok(marker.type.endsWith('conduit'));}
    assert.ok(buildGeometry({drainSide:'right'}).drain.x>0);
});

test('SVG uses the same dimensions, panel count and accessible room description',()=>{
    const m=buildGeometry({width:620,depth:320,frontOpening:'sliding-4-black',rooflight:'gable-8'});
    const svg=planSvg(m);
    assert.match(svg,/role="img"/);assert.match(svg,/620 cm/);assert.match(svg,/320 cm/);
    assert.match(svg,/4 panelen in de voorpui/);assert.match(svg,/8 daklichtpanelen/);
    assert.equal((svg.match(/data-rooflight-panel=/g)||[]).length,8,'plan contains both gable slopes');
    assert.match(svg,/19,84 m²/);assert.match(svg,/stroke-dasharray/);
    const without=planSvg(m,false);assert.doesNotMatch(without,/<text[^>]*>620 cm<\/text>/);
});

test('bad imported values produce finite safe preview geometry rather than NaN',()=>{
    const m=buildGeometry({width:'invalid',depth:-4,height:Infinity,frontOpening:'<script>',rooflight:'gable-99'});
    assert.equal(m.width,5);assert.equal(m.depth,3);assert.equal(m.height,2.8);
    assert.equal(m.opening.kind,'none');assert.equal(m.rooflight.kind,'none');
    assert.ok(m.walls.every(w=>w.size.every(n=>Number.isFinite(n)&&n>0)));
    assert.doesNotMatch(planSvg(m),/<script>|NaN|Infinity/);
});

import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { buildGeometry, planSvg } from './geometry.js';

const PALETTE = {
    'brick-red':['#9d6852','#b47b61','#875440','#bd896c'],
    'brick-black':['#494b44','#55574f','#41443e','#66635b'],
    'brick-white':['#dfdbcf','#eae6dd','#d6d2c7','#d0cbbb'],
    'brick-yellow':['#c8ae76','#d4bc88','#bda06a','#d7c494'],
    'pvc-black':'#323632','pvc-green':'#425448','pvc-cream':'#dbd5bd','pvc-anthracite':'#4b514e',
};

function facadeTexture(code) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    let seed = 481;
    const random = () => {seed = (seed*16807)%2147483647; return seed/2147483647;};
    if (code.startsWith('brick')) {
        const colours = PALETTE[code] || PALETTE['brick-red'];
        ctx.fillStyle='#b3a592';ctx.fillRect(0,0,512,512);
        for (let row=0;row<8;row++) for(let col=-1;col<5;col++) {
            const x=col*128+(row%2)*64,y=row*64;
            ctx.fillStyle=colours[Math.floor(random()*colours.length)];ctx.fillRect(x+3,y+3,122,57);
            for(let i=0;i<80;i++) {ctx.fillStyle=random()>.5?'rgba(255,255,255,.08)':'rgba(20,10,0,.06)';ctx.fillRect(x+random()*125,y+random()*58,random()*6+1,2);}
        }
    } else if(code === 'render') {
        ctx.fillStyle='#e8e3d6';ctx.fillRect(0,0,512,512);
        for(let i=0;i<6500;i++){ctx.fillStyle=random()>.5?'rgba(255,255,255,.14)':'rgba(80,65,40,.045)';ctx.fillRect(random()*512,random()*512,2,2);}
    } else {
        const pvc=code.startsWith('pvc'),horizontal=code.includes('horizontal'),open=code.startsWith('open');
        if(horizontal){ctx.translate(512,0);ctx.rotate(Math.PI/2);}
        ctx.fillStyle=pvc?PALETTE[code]||'#4b514e':'#3d3c31';ctx.fillRect(0,0,512,512);
        const count=open?14:8,sw=512/count;
        for(let i=0;i<count;i++) {
            const base = pvc ? PALETTE[code]||'#4b514e' : ['#b5986e','#bc9e74','#a98b62','#c1a17a','#ad906b'][Math.floor(random()*5)];
            ctx.fillStyle=base;ctx.fillRect(i*sw+2,0,sw-(open?10:3),512);
            ctx.fillStyle='rgba(255,255,255,.15)';ctx.fillRect(i*sw+2,0,1,512);
            if(!pvc) for(let grain=0;grain<50;grain++){ctx.strokeStyle=random()>.5?'rgba(66,41,15,.08)':'rgba(239,208,164,.14)';ctx.beginPath();const x=i*sw+4+random()*(sw-8);ctx.moveTo(x,0);ctx.bezierCurveTo(x+random()*3,170,x-random()*3,350,x,512);ctx.stroke();}
        }
    }
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(2,2);
    texture.anisotropy=4;
    return texture;
}

function lineBetween(a,b,material,thickness=.025) {
    const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),delta=to.clone().sub(from);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(thickness/2,thickness/2,delta.length(),6),material);
    mesh.position.copy(from.add(to).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    mesh.castShadow=true;return mesh;
}

export class Preview {
    constructor(container,{onReady,onError,pixelRatio,observeResize=true,initialConfig={}}={}) {
        this.container=container;this.onReady=onReady;this.onError=onError;
        this.mode='3d';this.view='perspective';this.dimensionsVisible=true;this.roofVisible=true;
        this.materials=new Map();this.textures=new Set();this.disposed=false;this.config={};
        this.host=document.createElement('div');this.host.className='prefab-preview-renderer';
        this.host.style.cssText='position:absolute;inset:0;overflow:hidden;';
        this.plan=document.createElement('div');this.plan.className='prefab-plan';this.plan.style.cssText='position:absolute;inset:0;display:none;';
        this.host.append(this.plan);container.append(this.host);
        if(getComputedStyle(container).position==='static') container.style.position='relative';
        try {
            this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
            this.renderer.setPixelRatio(pixelRatio ?? Math.min(window.devicePixelRatio||1,1.75));
            this.renderer.setClearColor('#ecebe3');this.renderer.outputColorSpace=THREE.SRGBColorSpace;
            this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
            this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
            this.renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none;';
            this.renderer.domElement.setAttribute('role','img');
            this.renderer.domElement.setAttribute('aria-label','Interactieve 3D-voorvertoning van je aanbouw. Sleep om te draaien; scroll om te zoomen.');
            this.host.prepend(this.renderer.domElement);
            this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#ecebe3');
            this.scene.fog=new THREE.Fog('#ecebe3',27,60);
            this.camera=new THREE.PerspectiveCamera(36,1,.05,150);
            this.controls=new OrbitControls(this.camera,this.renderer.domElement);
            this.controls.enableDamping=false;this.controls.enablePan=true;
            this.controls.maxPolarAngle=Math.PI/2-.015;this.controls.minPolarAngle=.025;
            this.controls.minDistance=3;this.controls.maxDistance=27;this.controls.target.set(0,1,0);
            this._render=()=>this.render();this.controls.addEventListener('change',this._render);
            const hemi=new THREE.HemisphereLight('#fffdf3','#a5a995',2.3);this.scene.add(hemi);
            const sun=new THREE.DirectionalLight('#fff6df',3.2);sun.position.set(-6,10,7);sun.castShadow=true;
            sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-12;sun.shadow.camera.right=12;
            sun.shadow.camera.top=12;sun.shadow.camera.bottom=-12;sun.shadow.camera.near=.5;sun.shadow.camera.far=35;
            sun.shadow.normalBias=.045;sun.shadow.bias=-.00015;this.scene.add(sun);
            const fill=new THREE.DirectionalLight('#eaf0ff',.6);fill.position.set(6,4,-4);this.scene.add(fill);
            this._contextLost=event=>{event.preventDefault();this.fallback(new Error('3D is tijdelijk niet beschikbaar. De plattegrond blijft bruikbaar.'));};
            this.renderer.domElement.addEventListener('webglcontextlost',this._contextLost);
            this._contextRestored=()=>{this.failed=false;this.setMode(this.mode);this.render();};
            this.renderer.domElement.addEventListener('webglcontextrestored',this._contextRestored);
        } catch(error) {this.failed=true;queueMicrotask(()=>{if(!this.disposed)this.onError?.(error);});}
        this.resizeObserver=observeResize&&typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>this.resize()):null;
        this.resizeObserver?.observe(container);
        this.update(initialConfig);
        queueMicrotask(()=>{if(!this.disposed)this.onReady?.({mode:this.failed?'2d':'3d'});});
    }

    material(key,options) {
        if(!this.materials.has(key)) this.materials.set(key,new THREE.MeshStandardMaterial(options));
        return this.materials.get(key);
    }

    box(group,size,position,material,{shadow=true}={}) {
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...position);
        mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);return mesh;
    }

    facade(code) {
        const key=`facade:${code}`;
        if(!this.materials.has(key)){const texture=facadeTexture(code);this.textures.add(texture);this.materials.set(key,new THREE.MeshStandardMaterial({map:texture,roughness:.86,color:'#ffffff'}));}
        return this.materials.get(key);
    }

    facadeBox(group,size,position,baseMaterial,code) {
        const material=baseMaterial.clone(),map=baseMaterial.map.clone();
        const horizontal=code.includes('horizontal');
        const periodX=code.startsWith('brick')?.88:horizontal?2:code.startsWith('open')?.70:.96;
        const periodY=code.startsWith('brick')?.52:horizontal?.96:2;
        map.repeat.set(Math.max(size[0],size[2])/periodX,size[1]/periodY);
        material.map=map;
        const mesh=this.box(group,size,position,material);mesh.userData.ownedMaterial=true;return mesh;
    }

    update(config) {
        if(this.disposed)return;
        const old=this.model;this.config={...config};this.model=buildGeometry(config);
        this.plan.innerHTML=planSvg(this.model,this.dimensionsVisible);
        if(this.renderer&&!this.failed) {
            try {this.buildScene();this.resize();if(!old||old.width!==this.model.width||old.depth!==this.model.depth)this.fitCamera();else this.render();}
            catch(error){this.fallback(error);}
        }
        this.applyMode();
    }

    release(group) {
        if(!group)return;
        const geometries=new Set();group.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.userData.ownedMaterial){object.material.map?.dispose();object.material.dispose();}});
        geometries.forEach(geometry=>geometry.dispose());group.removeFromParent();
    }

    buildScene() {
        this.release(this.root);this.root=new THREE.Group();this.scene.add(this.root);
        const m=this.model,b=m.bounds;
        const facade=this.facade(m.facade),white=this.material('plaster',{color:'#ece8dd',roughness:.92});
        const innerFinish=m.plaster?white:this.material(m.interior?'inner-lining':'inner-unfinished',{
            color:m.interior?'#e0dacb':'#c8bb9d',roughness:.95});
        const concrete=this.material('concrete',{color:'#c8c4b5',roughness:.92});
        const floorMat=this.material(m.screed?'floor-screed':'floor',{color:m.screed?'#d9d1c0':'#d8c6a7',roughness:.82});
        const dark=this.material('dark',{color:'#353b38',roughness:.48,metalness:.35});
        const frame=this.material(`frame:${m.opening.frame}`,{color:m.opening.frame,roughness:.36,metalness:.28});
        const glass=this.material('glass',{color:'#b2c6c3',transparent:true,opacity:.32,roughness:.14,metalness:.3,side:THREE.DoubleSide,depthWrite:false});
        const terrace=this.material('terrace',{color:'#d5d0bf',roughness:.95});
        const ground=this.material('ground',{color:'#e7e6dc',roughness:1});
        this.box(this.root,[90,.05,90],[0,-.23,0],ground,{shadow:false});
        this.box(this.root,[m.width+.55,.12,m.depth+1.45],[0,-.11,.45],terrace);
        for(let x=b.left-.2;x<b.right+.2;x+=.65)this.box(this.root,[.012,.003,1.2],[x,-.048,b.front+.63],this.material('joint',{color:'#b8b6a7',roughness:1}),{shadow:false});
        this.box(this.root,[m.width,.12,m.depth],[0,.01,0],concrete);
        this.box(this.root,[m.width-2*m.wall,.018,m.depth-m.wall],[0,.082,-m.wall/2],floorMat,{shadow:false});
        if(!m.screed){const joint=this.material('floor-joint',{color:'#bca986',roughness:1});for(let x=b.left+m.wall+.18;x<b.right-m.wall;x+=.21)this.box(this.root,[.006,.002,m.depth-m.wall],[x,.093,-m.wall/2],joint,{shadow:false});}
        for(const wall of m.walls){this.facadeBox(this.root,wall.size,wall.center,facade,m.facade);}
        // Separate inside faces keep exterior materials outside the room.
        this.box(this.root,[.008,m.height-.1,m.depth-m.wall],[b.left+m.wall+.004,m.height/2,-m.wall/2],innerFinish);
        this.box(this.root,[.008,m.height-.1,m.depth-m.wall],[b.right-m.wall-.004,m.height/2,-m.wall/2],innerFinish);
        if(m.opening.kind==='none')this.box(this.root,[m.width-m.wall*2,m.height-.1,.009],[0,m.height/2,b.front-m.wall-.006],innerFinish);
        else {
            const pier=(m.width-m.opening.width)/2;
            for(const side of [-1,1])this.box(this.root,[Math.max(.03,pier-m.wall),m.height-.1,.012],[side*(m.opening.width/2+(pier-m.wall)/2),m.height/2,b.front-m.wall-.009],innerFinish);
        }
        this.makeOpening(m,frame,glass);
        this.roofGroup=new THREE.Group();this.root.add(this.roofGroup);this.roofGroup.visible=this.roofVisible;
        const roofMat=this.material('roof',{color:'#7c8073',roughness:.94});
        m.roof.forEach(part=>this.box(this.roofGroup,part.size,part.center,roofMat));
        // A real rectangular opening remains between the four roof solids.
        if(m.rooflight.panelCount)this.makeRooflight(m,frame,glass,white);
        const edge=this.material(`edge:${m.roofEdge}`,{color:m.roofEdge==='aluminium'?'#b3b6ad':'#424944',metalness:.55,roughness:.35});
        const trimHeight=.16;
        this.box(this.roofGroup,[m.width+.13,trimHeight,.075],[0,m.height+.045,b.front+.045],edge);
        this.box(this.roofGroup,[.075,trimHeight,m.depth+.12],[b.left-.045,m.height+.045,0],edge);
        this.box(this.roofGroup,[.075,trimHeight,m.depth+.12],[b.right+.045,m.height+.045,0],edge);
        if(m.rollaag!=='masonry') {
            const panel=this.material(`rollaag:${m.rollaag}`,{color:m.rollaag==='panel-white'?'#e7e5db':'#373e39',roughness:.55});
            this.box(this.roofGroup,[m.width,.20,.025],[0,m.height-.15,b.front+.008],panel);
            for(const side of [-1,1])this.box(this.roofGroup,[.025,.20,m.depth],[side*(m.width/2+.008),m.height-.15,0],panel);
        } else if(m.facade.startsWith('brick')) {
            let index=0;
            for(let x=b.left+.04;x<b.right;x+=.1){const colour=PALETTE[m.facade][index++%4];const soldier=this.material(`soldier:${colour}`,{color:colour,roughness:.9});this.box(this.roofGroup,[.085,.22,.025],[x,m.height-.2,b.front+.008],soldier);}
        }
        const pipe=this.material(`pipe:${m.drain.material}`,{color:m.drain.material==='zinc'?'#a6aaa3':'#646961',metalness:m.drain.material==='zinc'?.55:.05,roughness:.5});
        this.root.add(lineBetween([m.drain.x,.09,m.drain.z],[m.drain.x,m.drain.height,m.drain.z],pipe,.075));
        this.root.add(lineBetween([m.drain.x,m.drain.height,m.drain.z],[m.drain.x,m.drain.height,b.front-.03],pipe,.075));
        this.root.add(lineBetween([m.drain.x,.13,m.drain.z],[m.drain.x,.08,m.drain.z+.12],pipe,.075));
        for(const y of [.5,1.8])this.box(this.root,[.095,.034,.035],[m.drain.x,y,m.drain.z+.007],pipe);
        const conduit=this.material('conduit',{color:'#c99a5f',roughness:.5,metalness:.2});
        for(const marker of m.markers){const disk=new THREE.Mesh(new THREE.CylinderGeometry(.033,.033,.022,16),conduit);disk.rotation.x=Math.PI/2;disk.position.set(...marker.position);if(marker.type.startsWith('interior')||marker.type.startsWith('heating'))disk.rotation.z=Math.PI/2;this.root.add(disk);}
        for(let i=0;i<m.switches;i++)this.box(this.root,[.012,.06,.06],[b.left+m.wall+.012,1.05+i*.085,b.front-.40],conduit);
        if(m.underfloorHeating) {
            const heat=this.material('underfloor',{color:'#b68c65',roughness:.7});
            const path=[];for(let i=0;i<12;i++){const x=b.left+m.wall+.12+i*(m.width-m.wall*2-.24)/11;path.push([x,.103,i%2?b.front-m.wall-.15:b.back+.15]);path.push([x,.103,i%2?b.back+.15:b.front-m.wall-.15]);}
            for(let i=1;i<path.length;i++)this.root.add(lineBetween(path[i-1],path[i],heat,.011));
        }
        // Electrical choices are connection points, never invented light fittings.
        for(let i=0;i<m.ceilingLights+m.spotlights;i++) {
            const total=m.ceilingLights+m.spotlights,x=((i%4)+1)*m.width/5-m.width/2,z=Math.floor(i/4)*.45-m.depth*.2;
            const dot=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.02,10),conduit);dot.position.set(x,m.height-.09,Math.min(b.front-.4,z));this.roofGroup.add(dot);
        }
        this.makeExistingHouse(m,white,glass,dark);
        this.makeGarden(m);
        this.dimensionGroup=new THREE.Group();this.root.add(this.dimensionGroup);this.dimensionGroup.visible=this.dimensionsVisible;
        this.makeDimensions(m);
    }

    makeOpening(m,frame,glass) {
        if(!m.opening.panelCount)return;
        const o=m.opening,z=o.z+.016,f=.055;
        this.box(this.root,[o.width+.025,.06,.28],[0,.06,z],this.material('sill',{color:'#868b7f',roughness:.6}));
        this.box(this.root,[o.width+.05,f,.11],[0,o.height+o.bottom,z],frame);
        for(const side of [-1,1])this.box(this.root,[f,o.height,.11],[side*o.width/2,o.height/2+o.bottom,z],frame);
        for(const p of m.panels) {
            const paneZ=z+(m.opening.kind.startsWith('sliding')&&p.index%2?.035:0);
            this.box(this.root,[p.width-.045,p.height-.09,.012],[p.x,p.height/2+p.bottom,paneZ],glass,{shadow:false});
            for(const side of [-1,1])this.box(this.root,[.037,p.height,.072],[p.x+side*p.width/2,p.height/2+p.bottom,paneZ],frame);
            for(const y of [p.bottom+.025,p.bottom+p.height-.025])this.box(this.root,[p.width,.04,.072],[p.x,y,paneZ],frame);
            if(p.bars){this.box(this.root,[.018,p.height-.08,.045],[p.x,p.height/2+p.bottom,paneZ+.03],frame);for(const fraction of [.34,.67])this.box(this.root,[p.width-.04,.018,.045],[p.x,p.height*fraction+p.bottom,paneZ+.03],frame);}
            if(m.opening.kind==='french'||p.index===Math.floor(m.panels.length/2)){
                const hx=m.opening.kind==='french'?p.x+(p.index===0?1:-1)*(p.width/2-.1):p.x-p.width/2+.11;
                this.box(this.root,[.017,.18,.028],[hx,1.08,paneZ+.075],frame);
            }
        }
    }

    makeRooflight(m,frame,glass,inside) {
        const r=m.rooflight,o=r.opening;
        for(const side of [-1,1])this.box(this.roofGroup,[.065,.24,r.depth+.10],[side*(r.width/2+.03),m.height+.06,r.z],inside);
        for(const side of [-1,1])this.box(this.roofGroup,[r.width,.24,.065],[0,m.height+.06,r.z+side*(r.depth/2+.03)],inside);
        const uniqueEdges=new Set();
        for(const panel of r.panels) {
            const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(panel.points.flat(),3));
            geometry.setIndex([0,1,2,0,2,3]);geometry.computeVertexNormals();
            const mesh=new THREE.Mesh(geometry,glass);this.roofGroup.add(mesh);
            for(let i=0;i<4;i++){const a=panel.points[i],b=panel.points[(i+1)%4],key=[a.join(','),b.join(',')].sort().join('|');if(uniqueEdges.has(key))continue;uniqueEdges.add(key);this.roofGroup.add(lineBetween(a,b,frame,.043));}
        }
        const baseY=r.baseY;
        for(const x of [o.left,o.right])for(const z of [o.back,o.front]) {
            const top=r.kind==='lean'&&z===o.front?baseY+r.rise:baseY;
            this.roofGroup.add(lineBetween([x,m.height+.08,z],[x,top,z],frame,.035));
        }
        if(r.kind==='gable')for(const x of [o.left,o.right])this.roofGroup.add(lineBetween([x,baseY,r.z],[x,baseY+r.rise,r.z],frame,.035));
    }

    makeExistingHouse(m,wall,glass,frame) {
        const house=this.material('existing',{color:'#d5d3c6',roughness:.98});
        const width=Math.max(m.width+1.1,6.5),z=m.bounds.back-.46;
        // Back wall is open at the connection to the existing room.
        this.box(this.root,[width,1.22,.8],[0,m.height+.58,z],house);
        const sideWidth=(width-m.width+.6)/2;
        for(const side of [-1,1])this.box(this.root,[sideWidth,m.height,.8],[side*(width/2-sideWidth/2),m.height/2,z],house);
        this.box(this.root,[width,.10,.9],[0,m.height+1.24,z],wall);
        const windowMat=this.material('existing-window',{color:'#7b918a',roughness:.38,metalness:.12});
        for(const x of [-width*.27,width*.27]) {
            this.box(this.root,[.9,.72,.025],[x,m.height+.59,z+.415],windowMat);
            for(const xx of [-.46,.46])this.box(this.root,[.028,.75,.04],[x+xx,m.height+.59,z+.445],wall);
            for(const yy of [-.37,.37])this.box(this.root,[.94,.028,.04],[x,m.height+.59+yy,z+.445],wall);
        }
    }

    makeGarden(m) {
        const potMat=this.material('pot',{color:'#989a86',roughness:.92});
        const leafA=this.material('leaf-a',{color:'#7b8962',roughness:1}),leafB=this.material('leaf-b',{color:'#a1aa81',roughness:1});
        for(const [x,z,size] of [[m.bounds.left-.50,m.bounds.front+.66,.42],[m.bounds.right+.35,m.bounds.front+.8,.27]]) {
            const pot=new THREE.Mesh(new THREE.CylinderGeometry(size*.57,size*.46,size,24),potMat);pot.position.set(x,size/2-.02,z);pot.castShadow=true;pot.receiveShadow=true;this.root.add(pot);
            for(let i=0;i<9;i++){const angle=i*2.4;const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(size*.37,1),i%2?leafA:leafB);leaf.position.set(x+Math.cos(angle)*size*.27,size*(1.04+i*.027),z+Math.sin(angle)*size*.27);leaf.scale.set(.75,1.3,.7);leaf.rotation.z=Math.cos(angle)*.3;leaf.castShadow=true;this.root.add(leaf);}
        }
        const grass=this.material('garden',{color:'#bec4a9',roughness:1});
        this.box(this.root,[2,.014,m.depth+3],[m.bounds.left-1.6,-.17,.6],grass,{shadow:false});
    }

    label(text,position) {
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
        const ctx=canvas.getContext('2d');ctx.font='500 48px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle='rgba(242,242,234,.92)';ctx.beginPath();ctx.roundRect(90,25,332,76,16);ctx.fill();ctx.fillStyle='#4b6454';ctx.fillText(text,256,66);
        const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
        const material=new THREE.SpriteMaterial({map,depthTest:false,transparent:true});
        const sprite=new THREE.Sprite(material);sprite.userData.ownedMaterial=true;sprite.scale.set(1.9,.475,1);sprite.position.set(...position);sprite.renderOrder=20;this.dimensionGroup.add(sprite);
    }

    makeDimensions(m) {
        const mat=this.material('dimensions',{color:'#6e8371',roughness:1});
        const b=m.bounds,z=b.front+.85,x=b.left-.66;
        this.dimensionGroup.add(lineBetween([b.left,.07,z],[b.right,.07,z],mat,.013));
        for(const xx of [b.left,b.right])this.dimensionGroup.add(lineBetween([xx,.07,z-.15],[xx,.07,z+.15],mat,.013));
        this.label(`${Math.round(m.width*100)} cm`,[0,.12,z+.09]);
        this.dimensionGroup.add(lineBetween([x,.07,b.back],[x,.07,b.front],mat,.013));
        for(const zz of [b.back,b.front])this.dimensionGroup.add(lineBetween([x-.15,.07,zz],[x+.15,.07,zz],mat,.013));
        this.label(`${Math.round(m.depth*100)} cm`,[x-.15,.12,0]);
    }

    fitCamera() {
        if(!this.camera||!this.model)return;
        const m=this.model,aspect=this.camera.aspect||1;
        const vertical=THREE.MathUtils.degToRad(this.camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*aspect);
        const span=Math.max(m.width+1.9,m.depth+2.4);
        const distance=Math.max(span/(2*Math.tan(Math.min(vertical,horizontal)/2))*1.23,8);
        const target=new THREE.Vector3(0,m.height*.48,-.2);
        let direction=new THREE.Vector3(-.95,.74,1.32).normalize();
        if(this.view==='front')direction.set(0,.035,1);
        if(this.view==='top'){direction.set(0,1,.001);target.set(0,0,-.1);}
        this.camera.position.copy(target).addScaledVector(direction,distance);
        this.camera.up.set(0,1,0);this.controls.target.copy(target);this.controls.maxDistance=Math.max(27,distance*2);this.controls.update();this.render();
    }

    /** Fixed export cameras use world coordinates: left is -x, right is +x, garden is +z. */
    setDocumentView(view) {
        if(!this.camera||!this.model||this.failed)return false;
        const directions={
            'perspective-left':[-1.1,.74,1.55],
            'perspective-right':[1.1,.74,1.55],
            interior:[.55,1.9,1.2],
        };
        if(!directions[view])throw new Error(`Unknown document view: ${view}`);
        this.mode='3d';this.applyMode();this.view=view;
        this.dimensionsVisible=false;this.roofVisible=view!=='interior';
        this.dimensionGroup.visible=false;this.roofGroup.visible=this.roofVisible;
        const m=this.model;
        const target=new THREE.Vector3(0,(m.height+1.25)/2,-.25);
        const direction=new THREE.Vector3(...directions[view]).normalize();
        this.camera.position.copy(target).add(direction);
        this.camera.up.set(0,1,0);this.camera.lookAt(target);this.camera.updateMatrixWorld(true);
        const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion);
        const up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion);
        const tanY=Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2),tanX=tanY*this.camera.aspect;
        const houseHalfWidth=Math.max(m.width+1.1,6.5)/2;
        const xExtent=Math.max(houseHalfWidth,m.width/2+.38);
        let distance=3;
        // Fit the structure and its immediate terrace, without letting the 90 m ground plane affect framing.
        for(const x of [-xExtent,xExtent])for(const y of [-.2,m.height+1.34])for(const z of [m.bounds.back-.94,m.bounds.front+.85]) {
            const point=new THREE.Vector3(x,y,z).sub(target),towardsCamera=point.dot(direction);
            distance=Math.max(distance,towardsCamera+Math.abs(point.dot(right))/tanX*1.09,
                towardsCamera+Math.abs(point.dot(up))/tanY*1.09);
        }
        this.camera.position.copy(target).addScaledVector(direction,distance);
        this.controls.target.copy(target);this.controls.maxDistance=Math.max(27,distance*2);
        this.controls.update();this.renderer.shadowMap.needsUpdate=true;this.render();
        return true;
    }

    setMode(mode) {this.mode=mode==='2d'?'2d':'3d';this.applyMode();this.resize();}
    applyMode() {const flat=this.mode==='2d'||this.failed||!this.renderer;this.plan.style.display=flat?'block':'none';if(this.renderer)this.renderer.domElement.style.display=flat?'none':'block';if(this.controls)this.controls.enabled=!flat;}
    setView(view) {this.view=['perspective','front','top'].includes(view)?view:'perspective';this.fitCamera();}
    setDimensions(value) {this.dimensionsVisible=!!value;if(this.dimensionGroup)this.dimensionGroup.visible=!!value;if(this.model)this.plan.innerHTML=planSvg(this.model,this.dimensionsVisible);this.render();}
    setRoofVisible(value) {this.roofVisible=!!value;if(this.roofGroup)this.roofGroup.visible=!!value;if(this.renderer)this.renderer.shadowMap.needsUpdate=true;this.render();}
    resetCamera() {this.view='perspective';this.fitCamera();}
    resize() {
        if(this.disposed||!this.renderer||!this.camera)return;
        const width=Math.max(1,this.container.clientWidth),height=Math.max(1,this.container.clientHeight);
        const changed=this.lastWidth!==width||this.lastHeight!==height;
        this.lastWidth=width;this.lastHeight=height;
        this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
        if(changed&&this.model)this.fitCamera();else this.render();
    }
    render() {if(!this.disposed&&!this.failed&&this.mode==='3d'&&this.renderer&&this.scene&&this.camera)this.renderer.render(this.scene,this.camera);}
    fallback(error) {this.failed=true;this.applyMode();this.onError?.(error);}
    getSceneInfo() {return {...JSON.parse(JSON.stringify(this.model)),mode:this.failed?'2d':this.mode,view:this.view,webglAvailable:!!this.renderer&&!this.failed,roofVisible:this.roofVisible,dimensionsVisible:this.dimensionsVisible};}
    destroy() {
        if(this.disposed)return;this.disposed=true;this.resizeObserver?.disconnect();this.controls?.removeEventListener('change',this._render);this.controls?.dispose();
        this.release(this.root);this.materials.forEach(material=>material.dispose());this.textures.forEach(texture=>texture.dispose());
        this.scene?.traverse(object=>object.shadow?.dispose());
        if(this.renderer){this.renderer.domElement.removeEventListener('webglcontextlost',this._contextLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this._contextRestored);this.renderer.dispose();this.renderer.forceContextLoss();}
        this.host.remove();
    }
}

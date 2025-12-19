import GUI from 'lil-gui';
import createSimModule from '@wasm';
import type { SimModule } from './sim';

const P_STRIDE = 11;
const S_STRIDE = 5; 

interface Point3D { x: number; y: number; z: number; r: number; scale: number; i: number }

async function init() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    const wasm: SimModule = await createSimModule({
        canvas: canvas
    });

    const world = new wasm.PhysicsWorld();
    // x, y, z, w, h, sep, k, damp
    world.createCloth(-400, -300, 0, 25, 20, 35, 1200, 10.0);

    console.log(`Created ${world.getPCount()} particles and ${world.getSCount()} springs.`);

    const params = {
        timeScale: 1.0,
        subSteps: 8,
        gravity: 1000,
        windX: 0,
        windZ: 0,
        airResist: 0.99,
        stiffness: 1200,
        damping: 10,
        autoRotate: false
    };

    const gui = new GUI({ title: 'Physics Params' });

    const fSim = gui.addFolder('Simulation');
    fSim.add(params, 'timeScale', 0.1, 3.0, 0.1);
    fSim.add(params, 'subSteps', 1, 32, 1).onChange((v: number) => world.setSubSteps(v));

    const fForces = gui.addFolder('Environment');
    fForces.add(params, 'gravity', -500, 2000).onChange((v: number) => world.setGravity(0, v, 0));
    fForces.add(params, 'windX', -1000, 1000).onChange((v: number) => world.setWind(v, 0, params.windZ));
    fForces.add(params, 'windZ', -1000, 1000).onChange((v: number) => world.setWind(params.windX, 0, v));
    fForces.add(params, 'airResist', 0.9, 1.0).onChange((v: number) => world.setDamping(v));

    const fMat = gui.addFolder('Material');
    fMat.add(params, 'stiffness', 100, 5000).onChange((v: number) => world.setSpringParams(v, params.damping));
    fMat.add(params, 'damping', 0, 100).onChange((v: number) => world.setSpringParams(params.stiffness, v));

    gui.add(params, 'autoRotate');

    let camAngleX = 0.2, camAngleY = 0.5, camZoom = 1800;
    const focalLength = 1000;
    
    let mouseX = 0, mouseY = 0;
    let isRotating = false, isGrabbing = false;
    let grabbedIdx = -1, grabDepth = 0;


    function project(x: number, y: number, z: number): Point3D | null {
        if(params.autoRotate && !isGrabbing) camAngleY += 0.005;

        const cy = Math.cos(camAngleY), sy = Math.sin(camAngleY);
        const cx = Math.cos(camAngleX), sx = Math.sin(camAngleX);

        let rx = x * cy - z * sy;
        let rz = x * sy + z * cy;
        
        let ry = y * cx - rz * sx;
        rz = y * sx + rz * cx;

        rz += camZoom;

        if (rz <= 10) return null;

        const scale = focalLength / rz;
        return {
            x: rx * scale + canvas.width / 2,
            y: ry * scale + canvas.height / 2,
            r: Math.max(2, 8 * scale),
            z: rz,
            scale: scale,
            i: -1
        };
    }

    function unproject(screenX: number, screenY: number, projectedZ: number) {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        
        const scale = focalLength / projectedZ;
        let rx = (screenX - cx) / scale;
        let ry = (screenY - cy) / scale;
        let rz = projectedZ - camZoom;

        const cx_ = Math.cos(-camAngleX), sx_ = Math.sin(-camAngleX);
        let y_ = ry * cx_ - rz * sx_;
        let z_ = ry * sx_ + rz * cx_;
        ry = y_; rz = z_;

        const cy_ = Math.cos(-camAngleY), sy_ = Math.sin(-camAngleY);
        let x_ = rx * cy_ - rz * sy_;
        let z__ = rx * sy_ + rz * cy_;
        
        return { x: x_, y: ry, z: z__ };
    }

    function attemptGrab() {
        const pPtr = world.getPPtr() >> 2; 
        const buffer = wasm.HEAPF32;
        const count = world.getPCount();

        let minZ = Infinity;
        let found = -1;

        for(let i = 0; i < count; ++i) {
            const idx = pPtr + i * P_STRIDE;
            const p = project(buffer[idx], buffer[idx+1], buffer[idx+2]);
            if(!p) continue;

            const dx = mouseX - p.x;
            const dy = mouseY - p.y;
            
            if(dx*dx + dy*dy < (p.r + 15)**2) {
                if(p.z < minZ) {
                    minZ = p.z;
                    found = i;
                    grabDepth = p.z;
                }
            }
        }
        if(found !== -1) grabbedIdx = found;
    }

    function moveGrabbed() {
        const pos = unproject(mouseX, mouseY, grabDepth);
        world.setParticlePos(grabbedIdx, pos.x, pos.y, pos.z);
    }

    function render() {
        world.update(0.016 * params.timeScale);

        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const bufferF = wasm.HEAPF32;
        const bufferI = wasm.HEAP32;
        
        const pPtr = world.getPPtr() >> 2;
        const sPtr = world.getSPtr() >> 2;
        const pCount = world.getPCount();
        const sCount = world.getSCount();

        const projected: Point3D[] = [];
        for(let i = 0; i < pCount; i++) {
            const idx = pPtr + i * P_STRIDE;
            const p = project(bufferF[idx], bufferF[idx+1], bufferF[idx+2]);
            if(p) {
                p.i = i;
                projected.push(p);
            }
        }
        projected.sort((a, b) => b.z - a.z);

        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(80, 200, 255, 0.3)';
        ctx.beginPath();
        
        const projMap = new Array(pCount);
        for(let p of projected) projMap[p.i] = p;

        for(let i = 0; i < sCount; i++) {
            const idx = sPtr + i * S_STRIDE;
            const i1 = bufferI[idx]; 
            const i2 = bufferI[idx+1];

            const p1 = projMap[i1];
            const p2 = projMap[i2];
            if(p1 && p2) {
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
            }
        }
        ctx.stroke();

        for(let p of projected) {
            const r = p.r;
            const grad = ctx.createRadialGradient(
                p.x - r/3, p.y - r/3, r*0.2, 
                p.x, p.y, r
            );
            
            if(p.i === grabbedIdx) {
                grad.addColorStop(0, '#ffaa00');
                grad.addColorStop(1, '#aa4400');
            } else {
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(1, '#444444');
            }
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI*2);
            ctx.fill();
        }

        if(isGrabbing && grabbedIdx !== -1) moveGrabbed();

        requestAnimationFrame(render);
    }
    
    render();

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        mouseX = e.clientX - r.left; 
        mouseY = e.clientY - r.top;
        
        if(e.button === 2 || e.ctrlKey) {
            isGrabbing = true;
            attemptGrab();
        } else {
            isRotating = true;
        }
    });

    window.addEventListener('mouseup', () => {
        isRotating = false;
        isGrabbing = false;
        grabbedIdx = -1;
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const dx = mx - mouseX;
        const dy = my - mouseY;
        mouseX = mx; mouseY = my;
        
        if(isRotating) {
            camAngleY += dx * 0.005;
            camAngleX += dy * 0.005;
            camAngleX = Math.max(-1.5, Math.min(1.5, camAngleX));
        }
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

init();
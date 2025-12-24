import createSimModule from '@wasm';
import GUI from 'lil-gui';
import * as THREE from 'three';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';
import {HDRLoader} from 'three/examples/jsm/loaders/HDRLoader.js';
import MeshStandardNodeMaterial from 'three/src/materials/nodes/MeshStandardNodeMaterial';
import StorageInstancedBufferAttribute from 'three/src/renderers/common/StorageInstancedBufferAttribute';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer';
import {TSL} from 'three/src/Three.WebGPU.Nodes';

import type {SimModule} from './sim';


// trying to move common functions(&others) out such as orbitcontrols wip

const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
const renderer =
    new WebGPURenderer({canvas: canvas, antialias: true, forceWebGL: false});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);
const camera = new THREE.PerspectiveCamera(
    45, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(0, 900, 1800);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE
}

const guiSwitch = new GUI({ title: 'Engine' });
guiSwitch.domElement.style.cssText = 'position:absolute;top:15px;left:15px;';

let guiSim: GUI | null = null;
let currentSim: SimInstance | null = null;

enum mode {
  wasm = 0,
  compute = 1
}
const global_params = {
  mode: mode.wasm
}

type SimInstance = {
    update: (dt: number) => void;
    dispose: () => void;
}

type SimFactory = (
    scene: THREE.Scene, 
    renderer: WebGPURenderer, 
    gui: GUI
) => Promise<SimInstance>;


const createComputeSim: SimFactory = async (scene, renderer, gui) => {
const {default: shaders} = await import('./shaders.slang');

  const backing = new ArrayBuffer(128);
  const f32 = new Float32Array(backing);
  const u32 = new Uint32Array(backing);
  const i32 = new Int32Array(backing);

  // paddings are for 16 bit alignment
  // also using float4/vec4 for everything even when unnecessary for now because
  // of webgpu alignment restrictions will try cleaning that up later extra

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const pIdx = {
    timeScale: 0,
    subSteps: 1,
    solver: 2,
    count: 3,
    gravity: 4,  // padded
    wind: 8,     // padded
    mass: 12,
    stiffness: 13,
    damping: 14,
    simDt: 15,
    emission: 16,
    transmission: 17,
    ior: 18,
    scale: 19,
    global_damping: 20,
    scount: 21,
    acount: 22,
    useTicks: 23,
    rayo: 24,
    isdown: 27,
    rayd: 28,
    _pad: 31
  };

  f32[pIdx.timeScale] = 1.0;
  u32[pIdx.subSteps] = 8;
  u32[pIdx.solver] = 7;
  i32.set([0, -9, 0, 0], pIdx.gravity);
  i32.set([0, 0, 0, 0], pIdx.wind);
  f32[pIdx.mass] = 1.0;
  f32[pIdx.stiffness] = 1200.0;
  f32[pIdx.damping] = 5.0;
  f32[pIdx.simDt] = 0.016;
  f32[pIdx.scale] = 1.0;
  f32[pIdx.global_damping] = 0.99;

  f32.set([0, 0, 0], pIdx.rayo);
  f32[pIdx.isdown] = 0.0;
  f32.set([0, 0, 0], pIdx.rayd);


  const GRID_W = 200;
  const GRID_H = 200;
  const COUNT = GRID_W * GRID_H;
  const SPACING = 2.0;

  u32[pIdx.count] = COUNT;

  async function readPositions(
      device: GPUDevice, gpuBuffer: GPUBuffer, count: number) {
    const size = Math.min(count, 8) * 16;
    const readBuf = device.createBuffer(
        {size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
    const cmd = device.createCommandEncoder();
    cmd.copyBufferToBuffer(gpuBuffer, 0, readBuf, 0, size);
    device.queue.submit([cmd.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readBuf.getMappedRange().slice());
    readBuf.unmap();
    console.log('first positions:', data);
  }



  const folderSolver = gui.addFolder('Solver Engine');

  folderSolver
      .add({solver: u32[pIdx.solver]}, 'solver', {
        'Explicit Euler (Unstable)': 0,
        'Symplectic Euler': 1,
        'Verlet (Standard)': 2,
        'TC Verlet (Variable FPS)': 3,
        'RK2 (Midpoint)': 4,
        'RK4 (Runge-Kutta)': 5,
        'Implicit Euler (Damped)': 6,
        'Velocity Verlet': 7
      })
      .name('solver')
      .onChange((v: number) => u32[pIdx.solver] = v);


  new HDRLoader()
      .setPath('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/')
      .load('royal_esplanade_1k.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = texture;
      });

  await renderer.init();

  const backend =
      renderer.backend as unknown as {device: GPUDevice, get: (o: any) => any};
  const device = backend.device;

  const initialPos = new Float32Array(COUNT * 4);
  const initialPin = new Float32Array(COUNT);

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = y * GRID_W + x;
      initialPos[i * 4 + 0] = (x - GRID_W / 2) * SPACING;
      initialPos[i * 4 + 1] = (GRID_H - y) * SPACING;
      initialPos[i * 4 + 2] = 0.0;
      initialPos[i * 4 + 3] = 1.0;

      if (y === 0) initialPin[i] = 1.0;
    }
  }

  // copy semantics wayyyyyyyyyyyy too slow, this was way too impractical

  // const neighbors: {idx: number, dist: number, k: number, damp: number}[][] =
  //     Array.from({length: COUNT}, () => []);

  // function addLink(a: number, b: number, stiff: number) {
  //   const dx = initialPos[a * 3] - initialPos[b * 3];
  //   const dy = initialPos[a * 3 + 1] - initialPos[b * 3 + 1];
  //   const dz = initialPos[a * 3 + 2] - initialPos[b * 3 + 2];
  //   const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  //   neighbors[a].push({idx: b, dist, k: stiff, damp: 0.5});
  //   neighbors[b].push({idx: a, dist, k: stiff, damp: 0.5});
  // }

  // for (let y = 0; y < GRID_H; y++) {
  //   for (let x = 0; x < GRID_W; x++) {
  //     const i = y * GRID_W + x;

  //     if (x < GRID_W - 1) addLink(i, i + 1, 1.0);
  //     if (y < GRID_H - 1) addLink(i, i + GRID_W, 1.0);
  //     if (x < GRID_W - 1 && y < GRID_H - 1) addLink(i, i + GRID_W + 1, 0.5);
  //     if (x > 0 && y < GRID_H - 1) addLink(i, i + GRID_W - 1, 0.5);
  //   }
  // }

  // const totalLinks = neighbors.reduce((acc, list) => acc + list.length, 0);
  // const adjOffsets = new Uint32Array(COUNT + 1);
  // const adjIndices = new Uint32Array(totalLinks);
  // const adjData = new Float32Array(totalLinks * 4);

  // let offset = 0;
  // for (let i = 0; i < COUNT; i++) {
  //   adjOffsets[i] = offset;
  //   for (const n of neighbors[i]) {
  //     adjIndices[offset] = n.idx;
  //     adjData[offset * 4 + 0] = n.dist;
  //     adjData[offset * 4 + 1] = n.k;
  //     adjData[offset * 4 + 2] = n.damp;
  //     adjData[offset * 4 + 3] = 0;
  //     offset++;
  //   }
  // }
  // adjOffsets[COUNT] = offset;



  // spheres
  //  const geometry = new THREE.SphereGeometry(SPACING * 0.4, 8, 8);

  // const material = new MeshStandardNodeMaterial({
  //   color: new THREE.Color(0xff77aa),
  //   roughness: 0.4,
  //   metalness: 0.1,
  // });


  // cloth
  const geometry = new THREE.PlaneGeometry(1, 1, GRID_W - 1, GRID_H - 1);

  const material = new MeshStandardNodeMaterial({
    color: 0xff77aa,
    roughness: 0.2,
    metalness: 0.1,
    side: THREE.DoubleSide,
    flatShading: true
  });

  // not sure about this
  const posBufferA = device.createBuffer({
    size: initialPos.byteLength,
    usage:
        GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  const posBufferB = device.createBuffer({
    size: initialPos.byteLength,
    usage:
        GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });

  device.queue.writeBuffer(posBufferA, 0, initialPos);
  device.queue.writeBuffer(posBufferB, 0, initialPos);

  const posAttr = new StorageInstancedBufferAttribute(initialPos, 4);

  // spheres
  //  geometry.setAttribute('instancePosition', posAttr);
  //  const particleMesh = new THREE.InstancedMesh(geometry, material, COUNT);
  //  particleMesh.castShadow = true;
  //  particleMesh.receiveShadow = true;
  //  particleMesh.frustumCulled = false;
  //  const instancePosition = TSL.attribute('instancePosition');
  //  material.positionNode = TSL.add(TSL.positionLocal, instancePosition.xyz);

  // cloth
  const posStorageNode = TSL.storage(posAttr, 'vec4', COUNT);
  material.positionNode = posStorageNode.element(TSL.vertexIndex).xyz;
  const particleMesh = new THREE.Mesh(geometry, material);
  particleMesh.castShadow = true;
  particleMesh.receiveShadow = true;
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);

  const createBuf =
      (arr: ArrayBufferView|ArrayBuffer, usage = GPUBufferUsage.STORAGE) => {
        const buf = device.createBuffer(
            {size: arr.byteLength, usage: usage | GPUBufferUsage.COPY_DST});
        device.queue.writeBuffer(buf, 0, arr as any);
        return buf;
      };

  const uniformBuffer = createBuf(backing, GPUBufferUsage.UNIFORM);
  const motionBuffer = createBuf(new Float32Array(COUNT * 3 * 4));
  const pinBuffer = createBuf(initialPin);
  // const prevDtBuffer = createBuf(new Float32Array(COUNT));
  // const bufAdjOffsets = createBuf(adjOffsets);
  // const bufAdjIndices = createBuf(adjIndices);
  // const bufAdjData = createBuf(adjData);


  const shaderModule = device.createShaderModule({code: shaders.code});
  const computePipeline = device.createComputePipeline(
      {layout: 'auto', compute: {module: shaderModule, entryPoint: 'cxextra'}});

  const getBindGroup = (readBuf: GPUBuffer, writeBuf: GPUBuffer) => {
    return device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: {buffer: uniformBuffer}},
        {binding: 1, resource: {buffer: readBuf}},
        {binding: 2, resource: {buffer: writeBuf}},
        {binding: 3, resource: {buffer: motionBuffer}},
        {binding: 4, resource: {buffer: pinBuffer}},
        // {binding: 5, resource: {buffer: prevDtBuffer}},
        // {binding: 6, resource: {buffer: bufAdjOffsets}},
        // {binding: 7, resource: {buffer: bufAdjIndices}},
        // {binding: 8, resource: {buffer: bufAdjData}},
      ]
    });
  };

  // BECAUSE WEBGPU MAKES THE BINDGROUP IMMUTABLE!!
  const bindGroupA = getBindGroup(posBufferA, posBufferB);
  const bindGroupB = getBindGroup(posBufferB, posBufferA);

  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    f32.set([...raycaster.ray.origin], pIdx.rayo);
    f32.set([...raycaster.ray.direction], pIdx.rayd);
  });
  window.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (e.target instanceof HTMLElement && e.target.closest('.lil-gui')) return;
    f32[pIdx.isdown] = 1;
  }, {capture: true});
  window.addEventListener('pointerup', (e: PointerEvent) => {
    if (e.button !== 0) return;
    f32[pIdx.isdown] = 0
  }, {capture: true});



  let frame = 0;
  const workgroupCount = Math.ceil(COUNT / 64);

    const dispose = () => {
      
    };

    const update = (dt: number) => {

    device.queue.writeBuffer(uniformBuffer, 0, backing);

    const readA = frame % 2 === 0;
    const currentBindGroup = readA ? bindGroupA : bindGroupB;
    const targetBufferForRendering = readA ? posBufferB : posBufferA;

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, currentBindGroup);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();

    const attrRef = backend.get(posAttr);
    if (attrRef) {
      attrRef.buffer = targetBufferForRendering;
    }

    device.queue.submit([encoder.finish()]);
    renderer.render(scene, camera);
    frame++;
    // dbg
    //  readPositions(device, posBuffer, 8);
    };
    return { update, dispose };
}

const createWasmSim: SimFactory = async (scene, renderer, gui) => {
 const P_STRIDE = 16;
  const wasm: SimModule = await createSimModule();
  const world = new wasm.PhysicsWorld();

  world.createCloth(-400, -200, 0, 40, 30, 20, 1200, 10.0);


  const pCount = world.getPCount();



  new HDRLoader()
      .setPath('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/')  // temp
      .load('royal_esplanade_1k.hdr', function(texture: THREE.Texture) {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = texture;
        // scene.background = texture;
      });


  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 9.0);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(500, 1000, 500);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const geometry = new THREE.SphereGeometry(25, 16, 16);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xff77aa,
    roughness: 0.35,
    metalness: 0.05,
    transmission: 0.0,
    thickness: 1.0,
    emissive: 0xff77aa,
    emissiveIntensity: 0.0,
    sheen: 1.0,
    sheenRoughness: 0.6,
    transparent: true,
  });

  const particleMesh = new THREE.InstancedMesh(geometry, material, pCount);
  particleMesh.frustumCulled = false;
  particleMesh.castShadow = true;
  particleMesh.receiveShadow = true;

  particleMesh.count = pCount;
  scene.add(particleMesh);

  const dummy = new THREE.Object3D();

  const raycaster = new THREE.Raycaster();
  //   raycaster.params.Sphere = {threshold: 5};

  const mouse = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragIntersectPoint = new THREE.Vector3();
  let isDragging = false;
  let draggedIdx = -1;

  // const debugCursor = new THREE.Mesh(
  //     new THREE.SphereGeometry(5, 8, 8),
  //     new THREE.MeshBasicMaterial({color: 0xff0000}));
  // scene.add(debugCursor);

  function getMousePos(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    return {x, y};
  }

  let wasAnchor = false;

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 && !event.ctrlKey) return;

    const coords = getMousePos(event);
    mouse.set(coords.x, coords.y);
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(particleMesh);

    if (intersects.length > 0) {
      intersects.sort((a, b) => a.distance - b.distance);
      const hit = intersects[0];

      if (hit.instanceId !== undefined) {
        draggedIdx = hit.instanceId;
        isDragging = true;
        const currentlyPinned = world.isPinned(draggedIdx);

        if (event.ctrlKey) {
          const newState = !currentlyPinned;
          world.setPinned(draggedIdx, newState);
          wasAnchor = newState;
        } else {
          wasAnchor = currentlyPinned;
          world.setPinned(draggedIdx, true);
        }

        const planeNormal = camera.position.clone().normalize();
        dragPlane.setFromNormalAndCoplanarPoint(planeNormal, hit.point);
      }
    }
  }

  function onPointerUp() {
    if (draggedIdx === -1) return;

    if (!wasAnchor) {
      world.setPinned(draggedIdx, false);
    } else {
      world.setPinned(draggedIdx, true);
    }

    isDragging = false;
    draggedIdx = -1;
  }
  function onPointerMove(event: PointerEvent) {
    const coords = getMousePos(event);
    mouse.set(coords.x, coords.y);

    if (isDragging && draggedIdx !== -1) {
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(dragPlane, dragIntersectPoint)) {
        // debugCursor.position.copy(dragIntersectPoint);

        world.setParticlePos(
            draggedIdx, dragIntersectPoint.x, -dragIntersectPoint.y,
            dragIntersectPoint.z);
      }
    }
  }
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const params = {
    timeScale: 1.0,
    subSteps: 8,
    gravity: 100,
    metalness: 0.5,
    roughness: 0.5,
    mass: 1.0,
    stiffness: 1200,
    damping: 5.0,
    solver: 2,
    simDt: 0.016,
    useTicks: true,
    emission: 0.0,
    transmission: 0.0,
    ior: 1.5,
    scale: 1.0,
    colorPinned: '#ff00aa',
    colorDefault: '#ffaa00',
    useHeatmap: false  // wip
  };

  world.setGravity(0, params.gravity, 0);
  world.setWind(0, 0, 0);
  world.setDamping(0.99);
  world.setSpringParams(params.stiffness, params.damping);
  world.setSubSteps(params.subSteps);
  world.setMass(params.mass);
  world.setSolver(params.solver);



  const folderSim = gui.addFolder('Simulation');

  folderSim.add(params, 'timeScale', 0.1, 2.0).name('Time Scale');

  folderSim.add(params, 'subSteps', 1, 20, 1)
      .name('Sub-Steps')
      .onChange((v: number) => world.setSubSteps(v));

  folderSim.add(params, 'gravity', -1000, 1000)
      .name('Gravity (m/s²)')
      .onChange((v: number) => world.setGravity(0, v, 0));

  folderSim.add(params, 'simDt', 0.005, 0.05)
      .name('Fixed TimeStep (s)')
      .onChange((v: number) => world.setSimDt(v));

  const folderMat = gui.addFolder('Rendering');
  folderMat.add(params, 'metalness', 0, 1)
      .onChange((v: number) => material.metalness = v);
  folderMat.add(params, 'roughness', 0, 1)
      .onChange((v: number) => material.roughness = v);
  folderMat.add(params, 'emission', 0.0, 5.0)
      .name('Glow Strength')
      .onChange((v: number) => material.emissiveIntensity = v);

  folderMat.add(params, 'transmission', 0.0, 1.0)
      .name('Invisibility (Glass)')
      .onChange((v: number) => material.transmission = v);

  folderMat.add(params, 'ior', 1.0, 2.33)
      .name('Refraction Index')
      .onChange((v: number) => material.ior = v);
  folderMat.add(material, 'opacity', 0.0, 1.0)
      .name('primitive opacity')
      .onChange((v: number) => material.opacity = v);
  folderMat.add(params, 'scale', 0.01, 4.0).name('scale');
  folderMat.addColor(params, 'colorDefault').name('Default Color');
  folderMat.addColor(params, 'colorPinned').name('Pinned Color');
  // folderMat.add(params, 'useHeatmap').name('Velocity Heatmap'); //todo

  const folderPhys = gui.addFolder('Physics Properties');

  folderPhys.add(params, 'mass', 0.1, 5.0)
      .name('Particle Mass (kg)')
      .onChange((v: number) => world.setMass(v));

  folderPhys.add(params, 'stiffness', 100, 8000)
      .name('Spring Stiffness (k)')
      .onChange((v: number) => world.setSpringParams(v, params.damping));

  folderPhys.add(params, 'damping', 0, 20)
      .name('Spring Damping')
      .onChange((v: number) => world.setSpringParams(params.stiffness, v));
  folderSim.add({airResistance: 0.99}, 'airResistance', 0.9, 1.0)
      .name('Air Resistance')
      .onChange((v: number) => world.setDamping(v));
  const folderSolver = gui.addFolder('Solver Engine');

  folderSolver
      .add(params, 'solver', {
        'Explicit Euler (Unstable)': 0,
        'Symplectic Euler': 1,
        'Verlet (Standard)': 2,
        'TC Verlet (Variable FPS)': 3,
        'RK2 (Midpoint)': 4,
        'RK4 (Runge-Kutta)': 5,
        'Implicit Euler (Damped)': 6,
        'Velocity Verlet': 7
      })
      .name('Integrator')
      .onChange((v: number) => world.setSolver(v));

  folderSolver.add(params, 'useTicks')
      .name('Ticks instead of time')
      .onChange((v: boolean) => world.set_use_ticks(v));

  const debug = {
    explode: () => {
      params.simDt = 0.05;
      world.setSimDt(0.05);
    }
  };
  folderSolver.add(debug, 'explode')
      .name('Break Physics (0.05 dt) explicit euler might explode');

  const cPinned = new THREE.Color();
  const cDefault = new THREE.Color();

  const fixedDt = 1 / 120;
  world.setFixedDt(fixedDt);

  let last = performance.now();

  
  await renderer.init(); // not sure

  
    const dispose = () => {
      
    };

    const update = (dt: number) => {
    // world.update(dtMs * 0.001 * params.timeScale);
    const frameDt = (dt - last) * 0.001;
    last = dt;

    world.update(frameDt * params.timeScale);

    const pPtr = world.getPPtr() >> 2;
    const buffer = wasm.HEAPF32;



    for (let i = 0; i < pCount; i++) {
      const idx = pPtr + i * P_STRIDE;
      const x = buffer[idx];
      const y = buffer[idx + 1];
      const z = buffer[idx + 2];

      const isPinned = buffer[idx + 13] > 0.5;


      if (isPinned) {
        particleMesh.setColorAt(i, cPinned);
      } else {
        particleMesh.setColorAt(i, cDefault);
      }

      cPinned.set(params.colorPinned);
      cDefault.set(params.colorDefault);

      dummy.position.set(x, -y, z);
      dummy.scale.set(params.scale, params.scale, params.scale);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor)
      particleMesh.instanceColor.needsUpdate = true;

    // not sure if this would slow down the sim too much or not
    particleMesh.geometry.computeBoundingSphere();
    particleMesh.geometry.computeBoundingBox();
    particleMesh.computeBoundingSphere();
    particleMesh.updateMatrixWorld(true);
    };
    return { update, dispose };
}

const switchSim = async (factory: SimFactory) => {
    if (currentSim) {
        currentSim.dispose();
        currentSim = null;
    }
    if (guiSim) {
        guiSim.destroy();
    }
    guiSim = new GUI({ title: 'Sim Settings' });
    currentSim = await factory(scene, renderer, guiSim);
};

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    controls.update();

    if (currentSim) {
        currentSim.update(dt);
    }

    renderer.render(scene, camera);
});


guiSwitch.add(global_params, 'mode', {'wasm':0, 'compute':1}).name('simulator').onChange((v:number)=>{
  switchSim(v > 0.5 ? createComputeSim : createWasmSim);
});

switchSim(global_params.mode === mode.compute ? createComputeSim : createWasmSim);


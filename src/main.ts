import createSimModule from '@wasm';
import GUI from 'lil-gui';
import * as THREE from 'three';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';
import {HDRLoader} from 'three/examples/jsm/loaders/HDRLoader.js';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer';

import type {SimModule} from './sim';


async function wasm() {
const P_STRIDE = 16;
  const wasm: SimModule = await createSimModule();
  const world = new wasm.PhysicsWorld();

  world.createCloth(-400, -200, 0, 40, 30, 20, 1200, 10.0);


  const pCount = world.getPCount();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1e1e);

  const camera = new THREE.PerspectiveCamera(
      45, window.innerWidth / window.innerHeight, 1, 5000);
  camera.position.set(0, 0, 2000);
  const canvas = document.getElementById('webgpu-canvas') as HTMLCanvasElement;
  const renderer = new WebGPURenderer(
      {canvas: canvas, antialias: true, alpha: true, forceWebGL: false});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);



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
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: null
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
    if (event.button !== 2 && !event.ctrlKey) return;

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
        controls.enabled = false;
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
    controls.enabled = true;
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



  const gui = new GUI({title: 'Physics Params'});

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
  function render(dtMs: number) {
    // world.update(dtMs * 0.001 * params.timeScale);
    const frameDt = (dtMs - last) * 0.001;
    last = dtMs;

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

    controls.update();
    renderer.render(scene, camera);
  }
  await renderer.init();
  renderer.setAnimationLoop(render);
}

wasm();
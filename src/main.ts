import createSimModule from '@wasm';
import GUI from 'lil-gui';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';

import type {SimModule} from './sim';

const P_STRIDE = 14;

async function init() {

  const wasm: SimModule = await createSimModule();
  const world = new wasm.PhysicsWorld();

  world.createCloth(-400, -200, 0, 40, 30, 20, 1200, 10.0);


  const pCount = world.getPCount();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1e1e);

  const camera = new THREE.PerspectiveCamera(
      45, window.innerWidth / window.innerHeight, 1, 5000);
  camera.position.set(0, 0, 2000);

  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

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

  const geometry =
      new THREE.SphereGeometry(25, 16, 16);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    metalness: 1.0,
    roughness: 0.2,
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
        wasAnchor = world.isPinned(draggedIdx);

        world.setPinned(draggedIdx, true);

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
  window.addEventListener(
      'pointerup',
      onPointerUp);
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
    metalness: 1.0,
    roughness: 0.2,
    mass: 1.0,
    stiffness: 200,
    damping: 1,
    solver: 2
  };

  world.setGravity(0, params.gravity, 0);
  world.setWind(0, 0, 0);
  world.setDamping(params.damping);
  world.setSpringParams(params.stiffness,params.damping);
  world.setSubSteps(params.subSteps);
  world.setMass(params.mass);
  world.setSolver(params.solver);




  const gui = new GUI({title: 'Physics Params'});

  gui.add(params, 'timeScale', 0.1, 3.0);
  gui.add(params, 'subSteps', 1, 32, 1)
      .onChange((v: number) => world.setSubSteps(v));
  gui.add(params, 'gravity', -500, 2000)
      .onChange((v: number) => world.setGravity(0, v, 0));

  gui.add(params, 'metalness', 0, 1)
      .onChange((v: number) => material.metalness = v);
  gui.add(params, 'roughness', 0, 1)
      .onChange((v: number) => material.roughness = v);

  gui.add(params, 'mass', 0.1, 10.0)
      .name('Particle Mass (kg)')
      .onChange((v: number) => world.setMass(v));

  gui.add(params, 'stiffness', 100, 5000)
      .name('Stiffness (N/m)')
      .onChange((v: number) => world.setSpringParams(v, params.damping));

  gui.add(params, 'damping', 0, 10)
      .name('Damping (Ns/m)')
      .onChange((v: number) => world.setSpringParams(params.stiffness, v));
  gui.add(params, 'solver', {
       'Explicit Euler (Unstable)': 0,
       'Symplectic Euler (Stable)': 1,
       'Verlet (Cloth Standard)': 2
     })
      .name('Integration Method')
      .onChange((v: number) => world.setSolver(v));

  function render() {
    world.update(0.016 * params.timeScale);

    const pPtr = world.getPPtr() >> 2;
    const buffer = wasm.HEAPF32;

    for (let i = 0; i < pCount; i++) {
      const idx = pPtr + i * P_STRIDE;
      const x = buffer[idx];
      const y = buffer[idx + 1];
      const z = buffer[idx + 2];

      const isPinned = buffer[idx + 13] > 0.5;

      if (isPinned) {
        particleMesh.setColorAt(i, new THREE.Color(0xff00aa));
      } else {
        particleMesh.setColorAt(i, new THREE.Color(0xffaa00));
      }


      dummy.position.set(x, -y, z);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor)
      particleMesh.instanceColor.needsUpdate =
          true;

    // not sure if this would slow down the sim too much or not
    particleMesh.geometry.computeBoundingSphere();
    particleMesh.geometry.computeBoundingBox();
    particleMesh.computeBoundingSphere(); 
    particleMesh.updateMatrixWorld(true);

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  render();
}

init();
import createSimModule from '@wasm';
import GUI from 'lil-gui';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls';

import type {SimModule} from './sim';

const P_STRIDE = 14;

async function init() {
  // --- 0. CSS Reset (CRITICAL for Raycasting) ---
  // If we don't do this, the 8px default body margin offsets the mouse
  // calculation
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';

  // --- 1. Init Physics ---
  const wasm: SimModule = await createSimModule();
  const world = new wasm.PhysicsWorld();

  // Create Cloth
  world.createCloth(-400, 300, 0, 40, 30, 20, 1200, 10.0);
  const pCount = world.getPCount();  // Get exact count

  // --- 2. Setup Scene ---
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

  // --- 3. Lights ---
  // High intensity ambient to make metals pop without envMap
  const ambientLight = new THREE.AmbientLight(0xffffff, 3.0);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(500, 1000, 500);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // --- 4. Visuals ---
  // Bigger Spheres + Metal Look
  const geometry =
      new THREE.SphereGeometry(25, 16, 16);  // Lower poly for speed
  const material = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    metalness: 1.0,
    roughness: 0.2,
  });

  // FIX: Set the InstancedMesh size to the EXACT particle count
  // This prevents "ghost" particles at (0,0,0) blocking the raycaster
  const particleMesh = new THREE.InstancedMesh(geometry, material, pCount);
  particleMesh.frustumCulled = false;
  particleMesh.castShadow = true;
  particleMesh.receiveShadow = true;

  // Explicitly set count so Three.js knows not to render garbage at the end of
  // the array
  particleMesh.count = pCount;
  scene.add(particleMesh);

  const dummy = new THREE.Object3D();

  // --- 5. Interaction ---
  const raycaster = new THREE.Raycaster();
  // Increase threshold slightly to make picking easier
  //   raycaster.params.Sphere = {threshold: 5};

  const mouse = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragIntersectPoint = new THREE.Vector3();
  let isDragging = false;
  let draggedIdx = -1;

  // DEBUG CURSOR: Shows where the raycaster hits the drag plane
  const debugCursor = new THREE.Mesh(
      new THREE.SphereGeometry(5, 8, 8),
      new THREE.MeshBasicMaterial({color: 0xff0000}));
  scene.add(debugCursor);

  function getMousePos(event: PointerEvent) {
    // 1. Get the exact screen position of the canvas element
    const rect = renderer.domElement.getBoundingClientRect();

    // 2. Calculate X and Y relative to the canvas, not the window
    //    (event.clientX - rect.left) -> X pixel inside canvas
    //    Divide by rect.width -> Normalize to 0..1
    //    Multiply by 2 and subtract 1 -> Normalize to -1..+1 (WebGL Clip Space)
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
      // Sort to grab the closest one
      intersects.sort((a, b) => a.distance - b.distance);
      const hit = intersects[0];

      if (hit.instanceId !== undefined) {
        draggedIdx = hit.instanceId;
        isDragging = true;
        controls.enabled = false;
        wasAnchor = world.isPinned(draggedIdx);

        world.setPinned(draggedIdx, true);

        // 2. Setup drag plane
        const planeNormal = camera.position.clone().normalize();
        dragPlane.setFromNormalAndCoplanarPoint(planeNormal, hit.point);
      }
    }
  }

  function onPointerUp() {
    if (isDragging) {
            onPointerUp(); 
        }
    if (draggedIdx !== -1) {
      world.setPinned(draggedIdx, false);
    }
    if (!wasAnchor) {
      world.setPinned(draggedIdx, false);
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
        // VISUAL DEBUG: Move red dot to where logic thinks mouse is
        debugCursor.position.copy(dragIntersectPoint);

        // Update Physics
        // Invert Y because screen Y (down) != World Y (up)
        world.setParticlePos(
            draggedIdx, dragIntersectPoint.x, -dragIntersectPoint.y,
            dragIntersectPoint.z);
      }
    }
  }
  // Attach to DOM Element specifically to avoid conflicts
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  window.addEventListener(
      'pointerup',
      onPointerUp);  // Window ensures release even if mouse leaves canvas
  dom.addEventListener('contextmenu', e => e.preventDefault());

  // Window Resize
  window.addEventListener('resize', () => {
    // Update camera aspect ratio
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    // Update renderer size
    renderer.setSize(window.innerWidth, window.innerHeight);

    // IMPORTANT: If you are calculating DPI manually in CSS, handle it here.
    // But Three.js setSize handles canvas.width/height matching style
    // automatically.
  });

  // --- 6. GUI ---
  const params = {
    timeScale: 1.0,
    subSteps: 8,
    gravity: 1000,
    metalness: 1.0,
    roughness: 0.2,
    mass: 1.0,  // Standard Mass
    stiffness: 200,
    damping: 1,
    solver: 2,  // Default to Verlet
  };

  // 1. Create the GUI normally
  const gui = new GUI({title: 'Physics Params'});

  // 2. FORCE Absolute Positioning (The Fix)
  // This takes it out of the document flow and floats it on top
  gui.domElement.style.position = 'absolute';
  gui.domElement.style.top = '20px';
  gui.domElement.style.right = '20px';

  // 3. Ensure it sits on top of the canvas (High Z-Index)
  gui.domElement.style.zIndex = '1000';

  gui.add(params, 'timeScale', 0.1, 3.0);
  gui.add(params, 'subSteps', 1, 32, 1)
      .onChange((v: number) => world.setSubSteps(v));
  gui.add(params, 'gravity', -500, 2000)
      .onChange((v: number) => world.setGravity(0, v, 0));

  // Dynamic Material Tweaking
  gui.add(params, 'metalness', 0, 1)
      .onChange((v: number) => material.metalness = v);
  gui.add(params, 'roughness', 0, 1)
      .onChange((v: number) => material.roughness = v);

  gui.add(params, 'mass', 0.1, 10.0)
      .name('Particle Mass (kg)')
      .onChange((v: number) => world.setMass(v));

  gui.add(params, 'stiffness', 100, 5000)
      .name('Stiffness (N/m)')  // Scientific Unit
      .onChange((v: number) => world.setSpringParams(v, params.damping));

  gui.add(params, 'damping', 0, 10)
      .name('Damping (Ns/m)')  // Scientific Unit
      .onChange((v: number) => world.setSpringParams(params.stiffness, v));
  gui.add(params, 'solver', {
       'Explicit Euler (Unstable)': 0,
       'Symplectic Euler (Stable)': 1,
       'Verlet (Cloth Standard)': 2
     })
      .name('Integration Method')
      .onChange((v: number) => world.setSolver(v));

  // --- 7. Render Loop ---
  function render() {
    world.update(0.016 * params.timeScale);

    const pPtr = world.getPPtr() >> 2;
    const buffer = wasm.HEAPF32;

    for (let i = 0; i < pCount; i++) {
      const idx = pPtr + i * P_STRIDE;
      const x = buffer[idx];
      const y = buffer[idx + 1];
      const z = buffer[idx + 2];

      dummy.position.set(x, -y, z);
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
    }

    particleMesh.instanceMatrix.needsUpdate = true;

    // Ensure the bounding sphere is updated or Raycasting might skip the mesh!
    if (particleMesh.geometry.boundingSphere === null) {
      particleMesh.geometry.computeBoundingSphere();
    }

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  render();
}

init();
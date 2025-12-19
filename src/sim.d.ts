/// <reference types="emscripten" />

/**
 * Interface representing the C++ PhysicsWorld class.
 * Warning: You must manually call .delete() when finished to free C++ memory.
 */
export interface PhysicsWorld {
  // --- Core Physics ---
  update(dt: number): void;

  // --- Setup ---
  /**
   * Creates a grid of particles connected by springs.
   * @param sx Start X position
   * @param sy Start Y position
   * @param sz Start Z position
   * @param w Width (number of particles)
   * @param h Height (number of particles)
   * @param sep Separation distance between particles
   * @param k Spring stiffness
   * @param damp Spring damping
   */
  createCloth(
      sx: number, sy: number, sz: number, w: number, h: number, sep: number,
      k: number, damp: number): void;

  // --- Direct Memory Access ---
  /**
   * Returns a pointer (number) to the start of the Particle array in the HEAP
   */
  getPPtr(): number;
  /** Returns a pointer (number) to the start of the Spring array in the HEAP */
  getSPtr(): number;
  /** Returns the number of active particles */
  getPCount(): number;
  /** Returns the number of active springs */
  getSCount(): number;

  // --- Helpers ---
  setParticlePos(index: number, x: number, y: number, z: number): void;

  // --- Setters ---
  setGravity(x: number, y: number, z: number): void;
  setWind(x: number, y: number, z: number): void;
  setDamping(damping: number): void;
  setSubSteps(steps: number): void;
  setSpringParams(k: number, damp: number): void;

  setMass(mass: number): void;
  setPinned(index: number, pinned: boolean): void;
  setSolver(type: number): void;
  isPinned(index: number): boolean;
  setPinned(index: number, pinned: boolean): void;
  // Standard Emscripten cleanup method
  delete(): void;
}

/**
 * Main Module interface extending the standard Emscripten runtime.
 */
export interface SimModule extends EmscriptenModule {
  // Constructor signature for the C++ class
  PhysicsWorld: new() => PhysicsWorld;
}

/**
 * Factory function that initializes the Wasm module.
 * Default export matches the -sEXPORT_NAME="createSimModule" setting.
 */
export default function createSimModule(moduleOverrides?: any):
    Promise<SimModule>;
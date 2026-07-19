/**
 * @zakkster/lite-noise v1.1.0 — Zero-GC seeded Simplex + FBM + curl + warp.
 *
 * Shared module state: the internal permutation table is module-scoped and
 * mutated by `seedNoise`. All consumers importing this module share it.
 * See `seedNoise` doc for guidance. A factory returning an isolated instance
 * is planned for v1.2.0.
 */

/**
 * Rebuild the internal permutation table from `seed`. Call once, or re-seed.
 *
 * ⚠️ Shared module state: this mutates a single module-scoped table. Every
 * consumer importing this module reseeds the SAME table. If two subsystems
 * (e.g. terrain + particles) need independent seed streams, either arrange
 * for one of them to reseed before every batch (from a saved seed value),
 * or wait for `createNoise` in v1.2.0.
 *
 * Setup cost only — not on any hot path. Auto-seeded with 0 on module load.
 */
export declare function seedNoise(seed?: number): void;

/**
 * 2D Simplex noise. Approximately in [-1, 1].
 *
 * NaN or Infinity inputs return 0 rather than propagating NaN — a plausible
 * value falls out of the truncation-to-integer path. Callers piping data
 * from noisy sources should validate upstream if propagation is required.
 */
export declare function simplex2(x: number, y: number): number;

/**
 * 3D Simplex noise. Approximately in [-1, 1]. Same NaN/Infinity note as
 * `simplex2` applies.
 */
export declare function simplex3(x: number, y: number, z: number): number;

/**
 * Unrolled 2D FBM over `simplex2`. Zero allocation.
 *
 * `octaves` must be >= 1. `octaves = 0` or negative returns 0 (rather than
 * NaN) so data-driven biome / terrain configs can't poison a buffer. All
 * numeric defaults match Quilez's canonical presets.
 */
export declare function fbm2(
    x: number,
    y: number,
    octaves?: number,
    lacunarity?: number,
    gain?: number,
): number;

/**
 * Unrolled 3D FBM over `simplex3`. Zero allocation. Same octaves contract
 * as `fbm2`: `octaves = 0` returns 0.
 */
export declare function fbm3(
    x: number,
    y: number,
    z: number,
    octaves?: number,
    lacunarity?: number,
    gain?: number,
): number;

/** Vec2 — writable by curl2 / warp2. Caller owns the object. */
export interface Vec2 { x: number; y: number; }
/** Vec3 — writable by curl3. Caller owns the object. */
export interface Vec3 { x: number; y: number; z: number; }

/**
 * Curl noise 2D — divergence-free 2D vector. Caller-owned output.
 *
 * Four `simplex2` samples per call (central difference on the axes).
 * Typical magnitude for scale ~0.005 inputs: mean |v| ≈ 3.4, max ≈ 10.
 * Wire through a scale factor before writing to particle velocities.
 */
export declare function curl2(x: number, y: number, out: Vec2): Vec2;

/**
 * Curl noise 3D — divergence-free 3D vector. Caller-owned output.
 *
 * Twelve `simplex3` samples per call over an offset vector potential
 * (Bridson recipe). Typical magnitude: mean |v| ≈ 3.8, max ≈ 10.6.
 * Divergence residual is ~0.6% of |v| — the classic finite-difference
 * truncation floor, not a formula error.
 */
export declare function curl3(x: number, y: number, z: number, out: Vec3): Vec3;

/**
 * Quilez-style domain warp — writes warped (x, y) into `out`.
 *
 * Two `fbm2` evaluations per sample using canonical offsets (5.2/1.3,
 * 1.7/9.2). Compose with `fbm2(out.x, out.y)` for the final warped noise
 * value. `strength = 0` returns the input unchanged.
 */
export declare function warp2(x: number, y: number, strength: number, out: Vec2): Vec2;

/**
 * Options for `fillField2`. Any field may be omitted; defaults shown.
 * Reading uses optional chaining (`opts?.x ?? default`) so the omitted-
 * opts path allocates nothing.
 */
export interface FillField2Options {
    /** Coordinate step per cell. Default 0.01. */
    scale?: number;
    /** FBM octaves. Must be >= 1 for a non-zero field. Default 4. */
    octaves?: number;
    /** FBM lacunarity. Default 2.0. */
    lacunarity?: number;
    /** FBM gain. Default 0.5. */
    gain?: number;
    /** X coordinate at (0, 0). Default 0. */
    ox?: number;
    /** Y coordinate at (0, 0). Default 0. */
    oy?: number;
}

/**
 * Bake a `w * h` FBM heightfield into a caller-supplied TypedArray.
 * Row-incremental coordinate stepping — `x * scale`, `y * scale` become
 * `px += scale`, `py += scale`. Zero allocation.
 *
 * `opts` may be omitted entirely; every field is optional.
 */
export declare function fillField2<T extends Float32Array | Float64Array>(
    out: T,
    w: number,
    h: number,
    opts?: FillField2Options,
): T;

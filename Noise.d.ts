/**
 * @zakkster/lite-noise v1.2.0 — Zero-GC seeded Simplex + FBM + curl + warp.
 *
 * Two ways to sample:
 *   - `createNoise(seed)` returns a `Noise` instance owning its OWN permutation
 *     table. Two instances are two independent fields; use this to run two
 *     consumers on one page without collision.
 *   - The module-level functions share ONE table, re-seeded by `seedNoise`.
 *     Convenient for a single consumer; a second consumer that calls `seedNoise`
 *     re-randomises the field the first is reading.
 *
 * Zero runtime dependencies.
 */

/**
 * Rebuild the SHARED module permutation table from `seed`. Call once, or
 * re-seed.
 *
 * ⚠️ Shared module state: this mutates a single module-scoped table. Every
 * consumer importing the module functions reseeds the SAME table. For two
 * subsystems that need independent seed streams (e.g. terrain + particles),
 * give each its own `createNoise(seed)` instead. Called more than once, this
 * warns once in dev builds (silent when `NODE_ENV === 'production'`).
 *
 * Setup cost only — not on any hot path. Auto-seeded with 0 on module load.
 */
export declare function seedNoise(seed?: number): void;

/**
 * An independent noise field owning its own permutation table. Construct via
 * `createNoise`. Sampling, seeding, or constructing one instance never changes
 * another. Every method mirrors the same-named module function.
 */
export declare class Noise {
    constructor(seed?: number);
    /** Re-seed this instance in place. Affects only this instance. Returns `this`. */
    seed(seed: number): this;
    simplex2(x: number, y: number): number;
    simplex3(x: number, y: number, z: number): number;
    fbm2(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
    fbm3(x: number, y: number, z: number, octaves?: number, lacunarity?: number, gain?: number): number;
    curl2(x: number, y: number, out: Vec2): Vec2;
    curl3(x: number, y: number, z: number, out: Vec3): Vec3;
    warp2(x: number, y: number, strength: number, out: Vec2): Vec2;
    fillField2<T extends Float32Array | Float64Array>(out: T, w: number, h: number, opts?: FillField2Options): T;
}

/**
 * Create an independent noise instance owning its own permutation table.
 * The way to give two consumers on one page fields that cannot disturb
 * each other.
 */
export declare function createNoise(seed?: number): Noise;

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

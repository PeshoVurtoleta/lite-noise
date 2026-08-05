/**
 * @zakkster/lite-noise v1.5.1 — Zero-GC seeded Simplex + FBM + ridged/billow +
 * seamless loop + tileable field + curl + warp.
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
    ridged2(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
    billow2(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
    noiseLoop(t: number, radius?: number): number;
    tileable2(x: number, y: number, periodX: number, periodY: number): number;
    curl2(x: number, y: number, out: Vec2): Vec2;
    curl3(x: number, y: number, z: number, out: Vec3): Vec3;
    warp2(x: number, y: number, strength: number, out: Vec2): Vec2;
    fillField2<T extends Float32Array | Float64Array>(out: T, w: number, h: number, opts?: FillField2Options): T;
    tileableField2<T extends Float32Array | Float64Array>(out: T, w: number, h: number, opts: TileableField2Options): T;
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
 * NaN) so data-driven biome / terrain configs can't poison a buffer. `gain`
 * (per-octave amplitude decay) must be >= 0 -- the standard FBM domain,
 * typically 0..1; a negative gain alternates the amplitude sign and pushes the
 * output past ~[-1, 1]. All numeric defaults match Quilez's canonical presets.
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

/**
 * Ridged multifractal 2D -- `(1 - |simplex|)^2` per octave over the shared FBM
 * skeleton. Sharp creases at zero-crossings, distribution skewed high: mountains,
 * cracked earth, veins. Same octaves >= 1 contract as `fbm2` (octaves <= 0 -> 0).
 * Range ~[0, 1] holds for `gain >= 0`; a negative gain voids the guarantee.
 */
export declare function ridged2(
    x: number,
    y: number,
    octaves?: number,
    lacunarity?: number,
    gain?: number,
): number;

/**
 * Billow 2D -- `|simplex|` per octave over the shared FBM skeleton. Puffy,
 * folded, absolute-value-symmetric: clouds, rolling hills, smoke. Same
 * octaves >= 1 contract as `fbm2` (octaves <= 0 -> 0). Range ~[0, 1] holds for
 * `gain >= 0`; a negative gain voids the guarantee.
 */
export declare function billow2(
    x: number,
    y: number,
    octaves?: number,
    lacunarity?: number,
    gain?: number,
): number;

/**
 * Seamless periodic 1D noise -- samples a circle of radius `radius` in the 2D
 * field. Drive `t` from 0 to 2*PI for a perfect loop: `noiseLoop(0)` and
 * `noiseLoop(2*PI)` are the identical sample (exact `===`), and the derivative
 * matches at the seam. `t` is reduced modulo 2*PI.
 */
export declare function noiseLoop(t: number, radius?: number): number;

/**
 * Tileable 2D noise over `[0, periodX) x [0, periodY)`. A bilinear blend of the
 * sample and its three period-wrapped neighbours -- seamless at every seam by
 * construction. Four `simplex2` samples, zero allocation. The blend narrows the
 * extremes, so the range is a little inside [-1, 1].
 *
 * Precondition: `periodX > 0` and `periodY > 0`. A period of 0 divides by zero
 * and returns a non-finite value (NaN or +/-Infinity) -- unguarded on this hot
 * path (a zero tile size is a caller error, not a data-driven value); pass
 * positive extents.
 */
export declare function tileable2(x: number, y: number, periodX: number, periodY: number): number;

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
    /**
     * Remap the baked field to exact [0, 1] in a second in-place pass. The raw
     * fill is ~[-0.84, 0.82] at the defaults; a colour ramp usually wants 0..1.
     * A constant field maps to all-zero. Default false.
     */
    normalize?: boolean;
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

/**
 * Options for `tileableField2`. `periodX` and `periodY` are REQUIRED (a tile
 * needs a positive extent); the rest are optional with the defaults shown.
 * Reading uses `opts?.x ?? default` so no allocation on the read path.
 */
export interface TileableField2Options {
    /** Per-octave shaping. `'fbm'` signed, `'ridged'` `(1-|n|)^2`, `'billow'` `|n|*2-1`. Default `'fbm'`. */
    model?: 'fbm' | 'ridged' | 'billow';
    /** Tile width in noise space. REQUIRED, must be finite and > 0 (non-finite/zero/negative throws). */
    periodX: number;
    /** Tile height in noise space. REQUIRED, must be finite and > 0 (non-finite/zero/negative throws). */
    periodY: number;
    /** Octaves summed at harmonic periods. Must be >= 1 for a non-zero field. Default 4. */
    octaves?: number;
    /** Per-octave period/frequency multiplier. Default 2.0. Does NOT affect the seam (grid alignment governs the exact wrap). */
    lacunarity?: number;
    /** Per-octave amplitude decay. Default 0.5. */
    gain?: number;
    /** Base-frequency zoom (scales coordinate and tile period together, seam preserved). Default 1. */
    scale?: number;
    /** X coordinate at column 0. Default 0. Keep 0 for a seamless tile: ANY non-zero value (even a whole-period multiple) breaks the wrap, not by epsilon. */
    ox?: number;
    /** Y coordinate at row 0. Default 0. Keep 0 for a seamless tile: ANY non-zero value (even a whole-period multiple) breaks the wrap, not by epsilon. */
    oy?: number;
    /** Remap the baked field to exact [0, 1] in a second in-place pass. Default false. */
    normalize?: boolean;
}

/**
 * Bake a seamless, multifractal `w * h` field into a caller-supplied TypedArray
 * — the tileable sibling of `fillField2`. Opposite field edges wrap seamlessly.
 * Sums octaves of `tileable2` at harmonic periods; the per-cell coordinate is
 * computed by multiply. Zero allocation once options are read.
 *
 * Exact-wrap precondition: the wrap is bit-exact (`===`) when the grid is
 * aligned — `w * (periodX / w) === periodX` in float64 (likewise `h`/`periodY`),
 * i.e. a power-of-two width with an integer period (the safe seamless recipe).
 * For non-aligned dims the seam is seamless only to within float epsilon
 * (~1e-14). Grid alignment alone governs this — not `lacunarity`/`gain`.
 *
 * Fail closed at setup, before `out` is written: an unknown `model` throws a
 * RangeError; a non-finite or non-positive `periodX`/`periodY` (including an
 * omitted required period, or `Infinity`) throws. `opts` is mandatory.
 */
export declare function tileableField2<T extends Float32Array | Float64Array>(
    out: T,
    w: number,
    h: number,
    opts: TileableField2Options,
): T;

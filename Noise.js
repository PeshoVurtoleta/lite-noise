/**
 * @zakkster/lite-noise v1.1.0
 *
 * Zero-GC seeded Simplex 2D/3D + FBM + curl2 + curl3 + domain warp + bakeable
 * heightfields. Deterministic via a seeded permutation table.
 *
 * All hot-path functions allocate nothing. Caller-owned `out` for the vector-
 * returning APIs (curl2, curl3, warp2) and for fillField2's Float32Array target.
 *
 * Shared state: the internal permutation table `_perm` is module-scoped and
 * mutated by `seedNoise(seed)`. All noise consumers importing this module
 * share it. Call `seedNoise` from a single well-known place (module init,
 * scene setup, etc); mid-frame reseeds by one consumer will change what
 * every other consumer samples. An isolated-instance factory `createNoise`
 * is on the roadmap for v1.2.0.
 *
 * Typical output magnitudes (seed 42, 100k samples): simplex2 max |v| ≈ 0.998;
 * simplex3 max |v| ≈ 0.976; curl2 mean |v| ≈ 3.4; curl3 mean |v| ≈ 3.8,
 * max |v| ≈ 10.6. Wire curl output through a scale factor before writing to
 * particle velocities.
 *
 * Depends on: @zakkster/lite-random (seed provenance)
 */

import { Random } from '@zakkster/lite-random';

// ── Permutation table (seeded, 512 entries for wrap-around) ──
const _perm = new Uint8Array(512);
const _grad3 = new Float32Array([
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
    1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1,
]);

/**
 * Build permutation table from seed. Call once, or call again to re-seed.
 *
 * ⚠️ Shared module state: this mutates a single module-scoped table.
 * Every consumer importing this module reseeds the SAME table. If two
 * subsystems (e.g. terrain + particles) need independent seed streams,
 * either arrange for one of them to reseed before every batch (with a
 * saved seed value), or wait for `createNoise` in v1.2.0.
 */
export function seedNoise(seed = 0) {
    const rng = new Random(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
        const j = (rng.next() * (i + 1)) | 0;
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) _perm[i] = p[i & 255];
}

// Auto-seed with 0
seedNoise(0);

// ── Simplex helpers ──
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

function dot2(gi, x, y) { return _grad3[gi] * x + _grad3[gi + 1] * y; }
function dot3(gi, x, y, z) { return _grad3[gi] * x + _grad3[gi + 1] * y + _grad3[gi + 2] * z; }

/**
 * 2D Simplex noise. Returns value in approximately [-1, 1].
 */
export function simplex2(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = x - X0, y0 = y - Y0;

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

    const ii = i & 255, jj = j & 255;
    const gi0 = (_perm[ii + _perm[jj]] % 12) * 3;
    const gi1 = (_perm[ii + i1 + _perm[jj + j1]] % 12) * 3;
    const gi2 = (_perm[ii + 1 + _perm[jj + 1]] % 12) * 3;

    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * dot2(gi0, x0, y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * dot2(gi1, x1, y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * dot2(gi2, x2, y2); }

    return 70 * (n0 + n1 + n2);
}

/** 3D Simplex noise. Returns value in approximately [-1, 1]. */
export function simplex3(x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const X0 = i - t, Y0 = j - t, Z0 = k - t;
    const x0 = x - X0, y0 = y - Y0, z0 = z - Z0;

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
        if (y0 >= z0)      { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
        else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
        else               { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
    } else {
        if (y0 < z0)       { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
        else if (x0 < z0)  { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
        else               { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
    }

    const x1 = x0-i1+G3, y1 = y0-j1+G3, z1 = z0-k1+G3;
    const x2 = x0-i2+2*G3, y2 = y0-j2+2*G3, z2 = z0-k2+2*G3;
    const x3 = x0-1+3*G3, y3 = y0-1+3*G3, z3 = z0-1+3*G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;
    const gi0 = (_perm[ii + _perm[jj + _perm[kk]]] % 12) * 3;
    const gi1 = (_perm[ii+i1 + _perm[jj+j1 + _perm[kk+k1]]] % 12) * 3;
    const gi2 = (_perm[ii+i2 + _perm[jj+j2 + _perm[kk+k2]]] % 12) * 3;
    const gi3 = (_perm[ii+1 + _perm[jj+1 + _perm[kk+1]]] % 12) * 3;

    let n0=0, n1=0, n2=0, n3=0;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 > 0) { t0 *= t0; n0 = t0*t0 * dot3(gi0, x0, y0, z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 > 0) { t1 *= t1; n1 = t1*t1 * dot3(gi1, x1, y1, z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 > 0) { t2 *= t2; n2 = t2*t2 * dot3(gi2, x2, y2, z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 > 0) { t3 *= t3; n3 = t3*t3 * dot3(gi3, x3, y3, z3); }

    return 32 * (n0 + n1 + n2 + n3);
}

/**
 * Unrolled 2D FBM — zero allocation. No rest params, no .map(), no spread.
 * `octaves` must be >= 1. `octaves = 0` or negative returns 0 (rather than
 * NaN from the `total / maxAmp = 0/0` divide), keeping data-driven biome
 * configs safe.
 */
export function fbm2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amplitude = 1.0;
    let frequency = 1.0;
    let total = 0.0;
    let maxAmp = 0.0;

    for (let i = 0; i < octaves; i++) {
        total += simplex2(x * frequency, y * frequency) * amplitude;
        maxAmp += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return maxAmp ? total / maxAmp : 0;
}

/**
 * Unrolled 3D FBM — zero allocation. Same octaves >= 1 contract as fbm2;
 * degenerate cases return 0.
 */
export function fbm3(x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amplitude = 1.0;
    let frequency = 1.0;
    let total = 0.0;
    let maxAmp = 0.0;

    for (let i = 0; i < octaves; i++) {
        total += simplex3(x * frequency, y * frequency, z * frequency) * amplitude;
        maxAmp += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return maxAmp ? total / maxAmp : 0;
}

// Central-difference epsilon and its reciprocal — precomputed so curl paths
// avoid a per-axis divide.
const _eps = 0.0001;
const _inv2eps = 1 / (2 * _eps);

/**
 * Curl noise 2D — divergence-free 2D vector, caller-owned output.
 * Perfect for smoke, fluid-like particle movement.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number }} out
 * @returns {{ x: number, y: number }} Same `out` reference.
 */
export function curl2(x, y, out) {
    const dx = (simplex2(x + _eps, y) - simplex2(x - _eps, y)) * _inv2eps;
    const dy = (simplex2(x, y + _eps) - simplex2(x, y - _eps)) * _inv2eps;
    out.x = dy;
    out.y = -dx;
    return out;
}

// Offsets used to synthesise a 3-component vector potential from a single
// scalar simplex3 field, following the Bridson recipe. Any two distinct
// offsets large enough that neighbourhoods don't correlate work; these are
// standard.
const _CURL3_A = 100.0;
const _CURL3_B = 200.0;

/**
 * Curl noise 3D — divergence-free 3D vector, caller-owned output.
 * Uses three offset simplex3 samples as a vector potential ψ and
 * finite-differences it: curl ψ = (∂ψ3/∂y - ∂ψ2/∂z,
 *                                  ∂ψ1/∂z - ∂ψ3/∂x,
 *                                  ∂ψ2/∂x - ∂ψ1/∂y).
 * Twelve simplex3 evaluations per sample. Suitable for volumetric smoke.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{ x: number, y: number, z: number }} out
 * @returns {{ x: number, y: number, z: number }} Same `out` reference.
 */
export function curl3(x, y, z, out) {
    const xa = x + _CURL3_A, ya = y + _CURL3_A, za = z + _CURL3_A;
    const xb = x + _CURL3_B, yb = y + _CURL3_B, zb = z + _CURL3_B;

    const dp3dy = (simplex3(xb, yb + _eps, zb) - simplex3(xb, yb - _eps, zb)) * _inv2eps;
    const dp2dz = (simplex3(xa, ya, za + _eps) - simplex3(xa, ya, za - _eps)) * _inv2eps;
    const dp1dz = (simplex3(x,  y,  z  + _eps) - simplex3(x,  y,  z  - _eps)) * _inv2eps;
    const dp3dx = (simplex3(xb + _eps, yb, zb) - simplex3(xb - _eps, yb, zb)) * _inv2eps;
    const dp2dx = (simplex3(xa + _eps, ya, za) - simplex3(xa - _eps, ya, za)) * _inv2eps;
    const dp1dy = (simplex3(x,  y  + _eps, z ) - simplex3(x,  y  - _eps, z )) * _inv2eps;

    out.x = dp3dy - dp2dz;
    out.y = dp1dz - dp3dx;
    out.z = dp2dx - dp1dy;
    return out;
}

/**
 * Quilez-style domain warp — writes warped (x, y) into `out`. Two fbm2
 * evaluations per sample. Compose with `fbm2(out.x, out.y)` for the final
 * warped noise value, or with `simplex2` / any other sampler.
 *
 * Offset constants (5.2/1.3 and 1.7/9.2) are the canonical Quilez values;
 * they keep the two warp channels decorrelated.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} strength Magnifies the warp displacement.
 * @param {{ x: number, y: number }} out
 * @returns {{ x: number, y: number }} Same `out` reference (warped coords).
 */
export function warp2(x, y, strength, out) {
    const qx = fbm2(x + 5.2, y + 1.3);
    const qy = fbm2(x + 1.7, y + 9.2);
    out.x = x + strength * qx;
    out.y = y + strength * qy;
    return out;
}

/**
 * Bake a 2D FBM heightfield into a caller-supplied Float32Array (or any
 * TypedArray with `length >= w * h`). Row-incremental coordinate stepping:
 * `px += scale` and `py += scale` replace `x * scale` and `y * scale`
 * per cell.
 *
 * Zero allocation once options are read; safe to call every frame with a
 * pre-allocated `out`.
 *
 * @param {Float32Array|Float64Array} out Destination, `length >= w * h`.
 * @param {number} w
 * @param {number} h
 * @param {{ scale?: number, octaves?: number, lacunarity?: number,
 *           gain?: number, ox?: number, oy?: number }} [opts]
 * @returns {Float32Array|Float64Array} The same `out` reference.
 */
export function fillField2(out, w, h, opts) {
    // Guarded reads via optional chaining + nullish coalescing. No
    // `opts = {}` default (which would allocate on the omitted-opts
    // path); `opts?.x ?? default` is zero-alloc whether opts is
    // undefined, null, or an object.
    const scale      = opts?.scale      ?? 0.01;
    const octaves    = opts?.octaves    ?? 4;
    const lacunarity = opts?.lacunarity ?? 2.0;
    const gain       = opts?.gain       ?? 0.5;
    const ox         = opts?.ox         ?? 0;
    const oy         = opts?.oy         ?? 0;

    let py = oy;
    let idx = 0;
    for (let y = 0; y < h; y++) {
        let px = ox;
        for (let x = 0; x < w; x++) {
            out[idx++] = fbm2(px, py, octaves, lacunarity, gain);
            px += scale;
        }
        py += scale;
    }
    return out;
}

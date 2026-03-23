/**
 * @zakkster/lite-noise — Zero-GC Seeded Noise Functions
 *
 * Simplex 2D/3D + FBM (fractal Brownian motion) + Curl 2D.
 * All deterministic via seeded permutation table.
 * Zero allocation in any hot-path function.
 *
 * Depends on: @zakkster/lite-random
 */

import { Random } from '@zakkster/lite-random';

// ── Permutation table (seeded, 512 entries for wrap-around) ──
const _perm = new Uint8Array(512);
const _grad3 = new Float32Array([
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
    1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1,
]);

/** Build permutation table from seed. Call once, or call again to re-seed. */
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
 * @param {number} x
 * @param {number} y
 * @returns {number}
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

/**
 * 3D Simplex noise.
 * @returns {number} Approximately [-1, 1]
 */
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
 * FIX: Unrolled 2D FBM — zero allocation.
 * No rest params, no .map(), no spread operator.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} [octaves=4]
 * @param {number} [lacunarity=2.0]
 * @param {number} [gain=0.5]
 * @returns {number} Approximately [-1, 1]
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

    return total / maxAmp;
}

/**
 * FIX: Unrolled 3D FBM — zero allocation.
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

    return total / maxAmp;
}

/**
 * FIX: Curl noise 2D — caller provides output object (zero-GC).
 * Returns a divergence-free 2D vector.
 * Perfect for smoke, fluid-like particle movement.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number }} out Pre-allocated output vector
 * @returns {{ x: number, y: number }} Same `out` reference
 */
const _eps = 0.0001;

export function curl2(x, y, out) {
    const dx = (simplex2(x + _eps, y) - simplex2(x - _eps, y)) / (2 * _eps);
    const dy = (simplex2(x, y + _eps) - simplex2(x, y - _eps)) / (2 * _eps);
    out.x = dy;
    out.y = -dx;
    return out;
}

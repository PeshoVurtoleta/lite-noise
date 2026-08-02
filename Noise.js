/**
 * @zakkster/lite-noise v1.3.0
 *
 * Zero-GC seeded Simplex 2D/3D + FBM + ridged/billow multifractals + seamless
 * loop + tileable field + curl2 + curl3 + domain warp + bakeable heightfields.
 * Deterministic via a seeded permutation table.
 *
 * All hot-path functions allocate nothing. Caller-owned `out` for the vector-
 * returning APIs (curl2, curl3, warp2) and for fillField2's Float32Array target.
 *
 * Ownership model:
 *   - `createNoise(seed)` returns a `Noise` instance owning its OWN 512-byte
 *     permutation table. Two instances are two independent fields; neither can
 *     disturb the other. This is the way to run two consumers on one page.
 *   - The module-level functions (`simplex2`, `fbm2`, ...) share ONE table,
 *     re-seeded by `seedNoise(seed)`. Convenient for a single consumer, but a
 *     second consumer that calls `seedNoise` re-randomises the field the first
 *     one is reading. `seedNoise` warns once (dev builds) when called more than
 *     once, naming `createNoise` as the fix.
 *
 * Typical output magnitudes (seed 42, 100k samples): simplex2 max |v| ~ 0.998;
 * simplex3 max |v| ~ 0.976; curl2 mean |v| ~ 3.4; curl3 mean |v| ~ 3.8,
 * max |v| ~ 10.6. Wire curl output through a scale factor before writing to
 * particle velocities.
 *
 * Zero runtime dependencies. Seed provenance is an inlined Mulberry32 PRNG
 * (see `_seedPerm` below); the determinism goldens pin its output sequence.
 */

// -- Gradient table + simplex skew/unskew constants (shared, immutable) --
const _grad3 = new Float32Array([
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
    1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1,
]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// One full turn. noiseLoop reduces its angle modulo TAU so a caller passing
// exactly TAU lands byte-identically on the angle 0 sample -- the seam closes
// with `===`, not merely within epsilon.
const TAU = Math.PI * 2;

function dot2(gi, x, y) { return _grad3[gi] * x + _grad3[gi + 1] * y; }
function dot3(gi, x, y, z) { return _grad3[gi] * x + _grad3[gi + 1] * y + _grad3[gi + 2] * z; }

// Central-difference epsilon and its reciprocal -- precomputed so curl paths
// avoid a per-axis divide.
const _eps = 0.0001;
const _inv2eps = 1 / (2 * _eps);

// Offsets used to synthesise a 3-component vector potential from a single
// scalar simplex3 field, following the Bridson recipe. Any two distinct
// offsets large enough that neighbourhoods don't correlate work; these are
// standard.
const _CURL3_A = 100.0;
const _CURL3_B = 200.0;

// -- Permutation table seeding (Mulberry32, inlined) --
// Fills a caller-owned 512-entry `Uint8Array` in place: identity, Fisher-Yates
// shuffle of the first 256, then mirror into the upper 256 for wrap-around.
// The RNG state is fully local, so seeding one table never perturbs another.
// The determinism goldens pin this exact sequence byte-for-byte: it reproduces
// the draws of the previous `@zakkster/lite-random` `Random(seed).next()` path,
// which is why inlining it stayed a non-breaking change.
//
// In place (no transient 256-entry scratch), so building a table -- at module
// load, in a `Noise` constructor, or in `seedNoise` -- allocates nothing beyond
// the table itself.
function _seedPerm(perm, seed) {
    let state = seed | 0;
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
        let t = state = (state + 0x6D2B79F5) | 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        const j = (r * (i + 1)) | 0;
        const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    for (let i = 256; i < 512; i++) perm[i] = perm[i & 255];
}

// -- Kernels --
// Each kernel takes the permutation table as its first parameter. Instance
// methods pass `this._perm`; module functions pass the shared `_perm`. The
// hot loops therefore read a LOCAL `Uint8Array` binding, not a property off
// `this` per lattice lookup -- a property read per sample in an unrolled FBM
// inner loop is exactly the kind of thing that quietly costs ~10%.

function _simplex2(perm, x, y) {
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
    const gi0 = (perm[ii + perm[jj]] % 12) * 3;
    const gi1 = (perm[ii + i1 + perm[jj + j1]] % 12) * 3;
    const gi2 = (perm[ii + 1 + perm[jj + 1]] % 12) * 3;

    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * dot2(gi0, x0, y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * dot2(gi1, x1, y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * dot2(gi2, x2, y2); }

    return 70 * (n0 + n1 + n2);
}

function _simplex3(perm, x, y, z) {
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
    const gi0 = (perm[ii + perm[jj + perm[kk]]] % 12) * 3;
    const gi1 = (perm[ii+i1 + perm[jj+j1 + perm[kk+k1]]] % 12) * 3;
    const gi2 = (perm[ii+i2 + perm[jj+j2 + perm[kk+k2]]] % 12) * 3;
    const gi3 = (perm[ii+1 + perm[jj+1 + perm[kk+1]]] % 12) * 3;

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

// Shared 2D octave accumulator. `mode` selects the per-octave shaping of the
// raw simplex2 sample -- 0 = fbm (signed pass-through), 1 = ridged, 2 = billow.
// fbm2/ridged2/billow2 are one-line wrappers over this so the octave skeleton
// (frequency/amplitude walk, maxAmp normalisation, degenerate-octaves guard)
// exists once. The mode-0 arithmetic is byte-identical to the previous inlined
// _fbm2: the skipped branches never touch `s`, so the goldens do not move.
//
// Range contract: with `gain >= 0` the weights amplitude/maxAmp are all non-
// negative and sum to 1, so the result is a convex blend of the per-octave
// values -- ridged/billow (each octave in [0,1]) stay in [0,1], fbm stays in
// simplex's ~[-1,1]. A NEGATIVE gain flips the amplitude sign each octave: maxAmp
// becomes a partly-cancelling alternating sum and the quotient can leave those
// ranges. gain >= 0 is the documented domain (it is the standard FBM persistence
// anyway); the `maxAmp ? ... : 0` guard only defends the octaves<=0 / 0-0 case.
function _octaves2(perm, x, y, octaves, lacunarity, gain, mode) {
    let amplitude = 1.0;
    let frequency = 1.0;
    let total = 0.0;
    let maxAmp = 0.0;

    for (let i = 0; i < octaves; i++) {
        let s = _simplex2(perm, x * frequency, y * frequency);
        if (mode === 1) { s = 1 - (s < 0 ? -s : s); s *= s; }  // ridged: sharp creases at zero-crossings
        else if (mode === 2) { s = s < 0 ? -s : s; }           // billow: folded, absolute value
        total += s * amplitude;
        maxAmp += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return maxAmp ? total / maxAmp : 0;
}

function _fbm2(perm, x, y, octaves, lacunarity, gain) {
    return _octaves2(perm, x, y, octaves, lacunarity, gain, 0);
}

function _ridged2(perm, x, y, octaves, lacunarity, gain) {
    return _octaves2(perm, x, y, octaves, lacunarity, gain, 1);
}

function _billow2(perm, x, y, octaves, lacunarity, gain) {
    return _octaves2(perm, x, y, octaves, lacunarity, gain, 2);
}

// Seamless 1D loop: walk a circle of radius `radius` in the 2D field. The value
// at angle 0 and angle TAU is the SAME lattice sample, so an animation driving
// t from 0..TAU closes perfectly. `t % TAU` guarantees the exact wrap (see TAU).
function _noiseLoop(perm, t, radius) {
    const a = t % TAU;
    return _simplex2(perm, Math.cos(a) * radius, Math.sin(a) * radius);
}

// Tileable 2D field over [0, periodX) x [0, periodY). A bilinear blend of the
// sample and its three period-wrapped neighbours: at every seam the vanishing
// corner weights make opposite edges evaluate to the identical expression, so
// the tile is seamless by construction (verified via patternforge.seamlessScore
// in the suite, not by eye). Four simplex2 samples, zero allocation.
// Precondition: periodX > 0 and periodY > 0 (a tile has positive extent). A
// period of 0 divides by 0 and yields a non-finite value (NaN when the numerator
// also vanishes, +/-Infinity otherwise) -- not guarded on this hot path because a
// zero tile size is a caller error, not a data-driven value the way fbm2's
// octaves is; state it as a contract rather than branch every sample.
function _tileable2(perm, x, y, periodX, periodY) {
    const wx = periodX - x, hy = periodY - y;
    const n00 = _simplex2(perm, x, y);
    const n10 = _simplex2(perm, x - periodX, y);
    const n01 = _simplex2(perm, x, y - periodY);
    const n11 = _simplex2(perm, x - periodX, y - periodY);
    return (n00 * wx * hy + n10 * x * hy + n01 * wx * y + n11 * x * y)
        / (periodX * periodY);
}

function _fbm3(perm, x, y, z, octaves, lacunarity, gain) {
    let amplitude = 1.0;
    let frequency = 1.0;
    let total = 0.0;
    let maxAmp = 0.0;

    for (let i = 0; i < octaves; i++) {
        total += _simplex3(perm, x * frequency, y * frequency, z * frequency) * amplitude;
        maxAmp += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return maxAmp ? total / maxAmp : 0;
}

function _curl2(perm, x, y, out) {
    const dx = (_simplex2(perm, x + _eps, y) - _simplex2(perm, x - _eps, y)) * _inv2eps;
    const dy = (_simplex2(perm, x, y + _eps) - _simplex2(perm, x, y - _eps)) * _inv2eps;
    out.x = dy;
    out.y = -dx;
    return out;
}

function _curl3(perm, x, y, z, out) {
    const xa = x + _CURL3_A, ya = y + _CURL3_A, za = z + _CURL3_A;
    const xb = x + _CURL3_B, yb = y + _CURL3_B, zb = z + _CURL3_B;

    const dp3dy = (_simplex3(perm, xb, yb + _eps, zb) - _simplex3(perm, xb, yb - _eps, zb)) * _inv2eps;
    const dp2dz = (_simplex3(perm, xa, ya, za + _eps) - _simplex3(perm, xa, ya, za - _eps)) * _inv2eps;
    const dp1dz = (_simplex3(perm, x,  y,  z  + _eps) - _simplex3(perm, x,  y,  z  - _eps)) * _inv2eps;
    const dp3dx = (_simplex3(perm, xb + _eps, yb, zb) - _simplex3(perm, xb - _eps, yb, zb)) * _inv2eps;
    const dp2dx = (_simplex3(perm, xa + _eps, ya, za) - _simplex3(perm, xa - _eps, ya, za)) * _inv2eps;
    const dp1dy = (_simplex3(perm, x,  y  + _eps, z ) - _simplex3(perm, x,  y  - _eps, z )) * _inv2eps;

    out.x = dp3dy - dp2dz;
    out.y = dp1dz - dp3dx;
    out.z = dp2dx - dp1dy;
    return out;
}

function _warp2(perm, x, y, strength, out) {
    const qx = _fbm2(perm, x + 5.2, y + 1.3, 4, 2.0, 0.5);
    const qy = _fbm2(perm, x + 1.7, y + 9.2, 4, 2.0, 0.5);
    out.x = x + strength * qx;
    out.y = y + strength * qy;
    return out;
}

function _fillField2(perm, out, w, h, opts) {
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
    const normalize  = opts?.normalize  ?? false;

    let py = oy;
    let idx = 0;
    for (let y = 0; y < h; y++) {
        let px = ox;
        for (let x = 0; x < w; x++) {
            out[idx++] = _fbm2(perm, px, py, octaves, lacunarity, gain);
            px += scale;
        }
        py += scale;
    }

    // Optional second pass to exact [0, 1]. fbm2 is amplitude-normalised but not
    // full-range (~[-0.84, 0.82] at the defaults), so a colour ramp wants a real
    // 0..1 remap. Allocation-free: two scalar-tracking passes, no temp buffer. A
    // constant field (range 0) maps to all-zero rather than dividing by zero.
    if (normalize) {
        const n = w * h;
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < n; i++) {
            const v = out[i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        const range = mx - mn;
        const inv = range > 0 ? 1 / range : 0;
        for (let i = 0; i < n; i++) out[i] = (out[i] - mn) * inv;
    }

    return out;
}

// -- Instance API --

/**
 * A noise field owning its own permutation table. Construct via
 * `createNoise(seed)`. Two instances are two independent fields; sampling,
 * seeding, or constructing one never changes another.
 */
export class Noise {
    /** @param {number} [seed] */
    constructor(seed = 0) {
        // Exactly one allocation per instance: the 512-byte table. `_seedPerm`
        // fills it in place, so no transient scratch is created.
        this._perm = new Uint8Array(512);
        _seedPerm(this._perm, seed);
    }

    /**
     * Re-seed this instance in place. Affects only this instance. Setup cost
     * only -- not on any hot path.
     * @param {number} seed
     * @returns {this}
     */
    seed(seed) {
        _seedPerm(this._perm, seed);
        return this;
    }

    simplex2(x, y) { return _simplex2(this._perm, x, y); }
    simplex3(x, y, z) { return _simplex3(this._perm, x, y, z); }
    fbm2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
        return _fbm2(this._perm, x, y, octaves, lacunarity, gain);
    }
    fbm3(x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
        return _fbm3(this._perm, x, y, z, octaves, lacunarity, gain);
    }
    ridged2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
        return _ridged2(this._perm, x, y, octaves, lacunarity, gain);
    }
    billow2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
        return _billow2(this._perm, x, y, octaves, lacunarity, gain);
    }
    noiseLoop(t, radius = 1.0) { return _noiseLoop(this._perm, t, radius); }
    tileable2(x, y, periodX, periodY) { return _tileable2(this._perm, x, y, periodX, periodY); }
    curl2(x, y, out) { return _curl2(this._perm, x, y, out); }
    curl3(x, y, z, out) { return _curl3(this._perm, x, y, z, out); }
    warp2(x, y, strength, out) { return _warp2(this._perm, x, y, strength, out); }
    fillField2(out, w, h, opts) { return _fillField2(this._perm, out, w, h, opts); }
}

/**
 * Create an independent noise instance owning its own permutation table.
 * @param {number} [seed]
 * @returns {Noise}
 */
export function createNoise(seed = 0) {
    return new Noise(seed);
}

// -- Module-level shared field --
// One table, shared by every consumer that imports the free functions. Seeded
// with 0 at load. This is the compatibility surface; `createNoise` is the way
// to avoid the shared-seed hazard.
const _perm = new Uint8Array(512);
_seedPerm(_perm, 0);

// `seedNoise` called more than once re-randomises a table every module-level
// consumer reads. Fire a single dev-build warning naming the fix, the first
// time a second call happens. Silent in production (NODE_ENV === 'production');
// vocal everywhere the environment can't be proven to be production (browsers,
// where `process` is undefined -- exactly where the flagship demo runs).
let _seedCalls = 0;
function _isProd() {
    return typeof process !== 'undefined'
        && process.env
        && process.env.NODE_ENV === 'production';
}

/**
 * Rebuild the shared module permutation table from `seed`. Call once, or
 * re-seed. Setup cost only -- not on any hot path. Auto-seeded with 0 on load.
 *
 * Shared module state: this mutates a single module-scoped table. Every
 * consumer importing this module reseeds the SAME table. For two subsystems
 * that need independent seed streams (e.g. terrain + particles), give each its
 * own `createNoise(seed)` instance instead.
 */
export function seedNoise(seed = 0) {
    if (++_seedCalls === 2 && !_isProd()) {
        console.warn(
            '[lite-noise] seedNoise() called more than once. It re-seeds one '
            + 'shared table, so every module-level consumer sees the change -- '
            + 'the last caller wins. For independent fields, give each consumer '
            + 'its own createNoise(seed). (This warning fires once.)');
    }
    _seedPerm(_perm, seed);
}

/** 2D Simplex noise. Returns value in approximately [-1, 1]. */
export function simplex2(x, y) { return _simplex2(_perm, x, y); }

/** 3D Simplex noise. Returns value in approximately [-1, 1]. */
export function simplex3(x, y, z) { return _simplex3(_perm, x, y, z); }

/**
 * Unrolled 2D FBM -- zero allocation. `octaves` must be >= 1; `octaves = 0` or
 * negative returns 0 (rather than NaN from a `0/0` divide), keeping data-driven
 * biome configs safe. `gain` is the per-octave amplitude decay and must be >= 0
 * (the standard FBM domain, typically 0..1); a negative gain alternates the
 * amplitude sign and pushes the output past the documented ~[-1, 1] range.
 */
export function fbm2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    return _fbm2(_perm, x, y, octaves, lacunarity, gain);
}

/**
 * Unrolled 3D FBM -- zero allocation. Same octaves >= 1 and gain >= 0 contract
 * as fbm2; degenerate cases return 0.
 */
export function fbm3(x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    return _fbm3(_perm, x, y, z, octaves, lacunarity, gain);
}

/**
 * Ridged multifractal 2D -- `(1 - |simplex|)^2` per octave over the shared FBM
 * skeleton. Sharp creases at zero-crossings, distribution skewed toward the high
 * end: mountains, cracked earth, veins. Same octaves >= 1 contract as fbm2.
 * Range ~[0, 1] holds for `gain >= 0` (the FBM domain); a negative gain flips the
 * per-octave amplitude sign and voids the range guarantee -- see fbm2.
 */
export function ridged2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    return _ridged2(_perm, x, y, octaves, lacunarity, gain);
}

/**
 * Billow 2D -- `|simplex|` per octave over the shared FBM skeleton. Puffy,
 * folded, absolute-value-symmetric: clouds, rolling hills, smoke bulges. Same
 * octaves >= 1 contract as fbm2. Range ~[0, 1] holds for `gain >= 0`; a negative
 * gain voids it (same domain caveat as fbm2/ridged2).
 */
export function billow2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    return _billow2(_perm, x, y, octaves, lacunarity, gain);
}

/**
 * Seamless periodic 1D noise by sampling a circle of radius `radius` in the 2D
 * field. Drive `t` from 0 to 2*PI for a perfect loop: `noiseLoop(0)` and
 * `noiseLoop(2*PI)` are the identical sample (exact `===`, not epsilon-close),
 * and the derivative matches at the seam. The single most reposted procedural-
 * animation trick, in one call.
 * @param {number} t Angle in radians; reduced modulo 2*PI.
 * @param {number} [radius] Loop radius in noise space (bigger = more variation).
 * @returns {number} Value in approximately [-1, 1].
 */
export function noiseLoop(t, radius = 1.0) { return _noiseLoop(_perm, t, radius); }

/**
 * Tileable 2D noise over `[0, periodX) x [0, periodY)`. A bilinear blend of the
 * sample and its three period-wrapped neighbours, seamless at every seam by
 * construction (opposite edges evaluate to the identical expression). Bake a
 * field and it tiles without a visible seam. Four simplex2 samples, zero alloc.
 * @param {number} x In `[0, periodX)`.
 * @param {number} y In `[0, periodY)`.
 * @param {number} periodX Tile width in noise space.
 * @param {number} periodY Tile height in noise space.
 * @returns {number} Value in approximately [-1, 1] (blend narrows the extremes).
 */
export function tileable2(x, y, periodX, periodY) { return _tileable2(_perm, x, y, periodX, periodY); }

/**
 * Curl noise 2D -- divergence-free 2D vector, caller-owned output.
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number }} out
 * @returns {{ x: number, y: number }} Same `out` reference.
 */
export function curl2(x, y, out) { return _curl2(_perm, x, y, out); }

/**
 * Curl noise 3D -- divergence-free 3D vector, caller-owned output.
 * Twelve simplex3 evaluations per sample. Suitable for volumetric smoke.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{ x: number, y: number, z: number }} out
 * @returns {{ x: number, y: number, z: number }} Same `out` reference.
 */
export function curl3(x, y, z, out) { return _curl3(_perm, x, y, z, out); }

/**
 * Quilez-style domain warp -- writes warped (x, y) into `out`. Two fbm2
 * evaluations per sample. Compose with `fbm2(out.x, out.y)` for the final
 * warped noise value.
 * @param {number} x
 * @param {number} y
 * @param {number} strength Magnifies the warp displacement.
 * @param {{ x: number, y: number }} out
 * @returns {{ x: number, y: number }} Same `out` reference (warped coords).
 */
export function warp2(x, y, strength, out) { return _warp2(_perm, x, y, strength, out); }

/**
 * Bake a 2D FBM heightfield into a caller-supplied Float32Array (or any
 * TypedArray with `length >= w * h`). Row-incremental coordinate stepping.
 * Zero allocation once options are read.
 *
 * Range: the raw fill is amplitude-normalised but not full-range (fbm2 measures
 * ~[-0.84, 0.82] at the defaults). Pass `normalize: true` for an exact [0, 1]
 * remap via a second in-place pass -- what a colour ramp usually wants.
 *
 * `out` is caller-owned and written start-to-end; it must not alias `opts` or
 * any live view you read during the call.
 * @param {Float32Array|Float64Array} out Destination, `length >= w * h`.
 * @param {number} w
 * @param {number} h
 * @param {{ scale?: number, octaves?: number, lacunarity?: number,
 *           gain?: number, ox?: number, oy?: number, normalize?: boolean }} [opts]
 * @returns {Float32Array|Float64Array} The same `out` reference.
 */
export function fillField2(out, w, h, opts) { return _fillField2(_perm, out, w, h, opts); }

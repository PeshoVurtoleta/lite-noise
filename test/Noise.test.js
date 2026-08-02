import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    seedNoise,
    simplex2, simplex3,
    fbm2, fbm3,
    curl2, curl3,
    warp2,
    fillField2,
    createNoise, Noise,
} from '../Noise.js';

// FNV-1a 32-bit over a Float32Array's raw bytes. Small, dependency-free,
// enough discriminatory power for a golden field.
function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
}

describe('lite-noise: simplex range', () => {
    it('simplex2 stays in [-1, 1]', () => {
        seedNoise(42);
        for (let i = 0; i < 1000; i++) {
            const v = simplex2(i * 0.1, i * 0.07);
            assert.ok(v >= -1.01, `simplex2 below range: ${v}`);
            assert.ok(v <= 1.01, `simplex2 above range: ${v}`);
        }
    });

    it('simplex3 stays in [-1, 1]', () => {
        seedNoise(42);
        for (let i = 0; i < 100; i++) {
            const v = simplex3(i * 0.1, i * 0.07, i * 0.03);
            assert.ok(v >= -1.01, `simplex3 below range: ${v}`);
            assert.ok(v <= 1.01, `simplex3 above range: ${v}`);
        }
    });
});

describe('lite-noise: seed determinism', () => {
    it('seedNoise produces deterministic results', () => {
        seedNoise(99); const a = simplex2(1.5, 2.5);
        seedNoise(99); const b = simplex2(1.5, 2.5);
        assert.strictEqual(a, b);
    });

    it('different seeds produce different results', () => {
        seedNoise(1); const a = simplex2(1.5, 2.5);
        seedNoise(2); const b = simplex2(1.5, 2.5);
        assert.notStrictEqual(a, b);
    });
});

describe('lite-noise: fbm', () => {
    it('fbm2 stays in ~[-1, 1]', () => {
        seedNoise(42);
        for (let i = 0; i < 100; i++) {
            const v = fbm2(i * 0.05, i * 0.03);
            assert.ok(v >= -1.1, `fbm2 below range: ${v}`);
            assert.ok(v <= 1.1, `fbm2 above range: ${v}`);
        }
    });

    it('fbm3 stays in ~[-1, 1]', () => {
        seedNoise(42);
        const v = fbm3(0.5, 0.5, 0.5, 4);
        assert.ok(v >= -1.1, `fbm3 below range: ${v}`);
        assert.ok(v <= 1.1, `fbm3 above range: ${v}`);
    });

    // Degenerate octaves must NOT poison the buffer through fillField2
    // -- data-driven biome / terrain configs will hit this.
    it('fbm2 returns 0 (not NaN) when octaves is 0', () => {
        seedNoise(42);
        assert.strictEqual(fbm2(1.7, 2.3, 0), 0);
    });

    it('fbm2 returns 0 (not NaN) when octaves is negative', () => {
        seedNoise(42);
        assert.strictEqual(fbm2(1.7, 2.3, -1), 0);
    });

    it('fbm3 returns 0 (not NaN) when octaves is 0', () => {
        seedNoise(42);
        assert.strictEqual(fbm3(1.7, 2.3, 3.1, 0), 0);
    });

    it('fillField2 with octaves=0 fills 0, not NaN', () => {
        seedNoise(42);
        const out = new Float32Array(16);
        fillField2(out, 4, 4, { octaves: 0 });
        for (let i = 0; i < out.length; i++) {
            assert.strictEqual(out[i], 0);
            assert.ok(!Number.isNaN(out[i]));
        }
    });
});

describe('lite-noise: curl2 / curl3 / warp2', () => {
    it('curl2 writes into caller-owned output', () => {
        seedNoise(42);
        const out = { x: 0, y: 0 };
        const result = curl2(1, 1, out);
        assert.strictEqual(result, out);
        assert.notStrictEqual(out.x, 0);
        assert.notStrictEqual(out.y, 0);
    });

    it('curl3 writes into caller-owned output', () => {
        seedNoise(42);
        const out = { x: 0, y: 0, z: 0 };
        const result = curl3(1, 1, 1, out);
        assert.strictEqual(result, out);
        // At least one component should have moved off zero for a
        // generic non-singular point.
        assert.ok(Math.abs(out.x) + Math.abs(out.y) + Math.abs(out.z) > 0);
    });

    it('curl3 is (approximately) divergence-free', () => {
        // Central-difference the returned vector field itself.
        // div(curl(psi)) should be ~0 by identity, up to finite-precision noise.
        seedNoise(7);
        const e = 0.001;
        const a = { x: 0, y: 0, z: 0 };
        const b = { x: 0, y: 0, z: 0 };
        let total = 0;
        for (let n = 0; n < 20; n++) {
            const x = 1 + n * 0.3, y = 2 + n * 0.17, z = 3 + n * 0.11;
            curl3(x + e, y, z, a); curl3(x - e, y, z, b);
            const dxdx = (a.x - b.x) / (2 * e);
            curl3(x, y + e, z, a); curl3(x, y - e, z, b);
            const dydy = (a.y - b.y) / (2 * e);
            curl3(x, y, z + e, a); curl3(x, y, z - e, b);
            const dzdz = (a.z - b.z) / (2 * e);
            total += Math.abs(dxdx + dydy + dzdz);
        }
        // The central-difference on the *output* uses a different eps than
        // the internal curl3 eps (1e-4), so we expect small numerical
        // residual but well under 1.0.
        assert.ok(total / 20 < 1.0, `mean divergence too high: ${total / 20}`);
    });

    it('warp2 writes into caller-owned output', () => {
        seedNoise(42);
        const out = { x: 0, y: 0 };
        const result = warp2(3, 5, 0.5, out);
        assert.strictEqual(result, out);
        // At zero strength the output must equal the input exactly.
        warp2(3, 5, 0, out);
        assert.strictEqual(out.x, 3);
        assert.strictEqual(out.y, 5);
    });
});

describe('lite-noise: fillField2', () => {
    it('bakes a field of the requested size', () => {
        seedNoise(42);
        const w = 64, h = 32;
        const out = new Float32Array(w * h);
        const result = fillField2(out, w, h, { scale: 0.01 });
        assert.strictEqual(result, out);
        for (let i = 0; i < out.length; i++) {
            assert.ok(out[i] >= -1.1, `field below range: ${out[i]}`);
            assert.ok(out[i] <= 1.1, `field above range: ${out[i]}`);
        }
    });

    it('accepts missing opts (all defaults)', () => {
        seedNoise(42);
        const out = new Float32Array(16);
        const result = fillField2(out, 4, 4);
        assert.strictEqual(result, out);
        // Field should have some non-zero variation with defaults.
        let variance = 0;
        for (let i = 1; i < out.length; i++) variance += Math.abs(out[i] - out[0]);
        assert.ok(variance > 0);
    });

    it('golden: seed 42 -> hash of a 256x256 default field is stable', () => {
        // This is the drift-catch test. If it fails, either the RNG
        // provenance changed, the simplex kernel changed, or FBM's
        // reduction changed. All of those are breaking.
        seedNoise(42);
        const w = 256, h = 256;
        const out = new Float32Array(w * h);
        fillField2(out, w, h, { scale: 0.01 });
        const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        const hash = fnv1a(bytes);
        // Committed golden -- updating this line requires an explicit
        // ecosystem-facing changelog entry.
        assert.strictEqual(hash.toString(16), GOLDEN_FIELD_HASH);
    });

    it('golden: seed 42 -> hash of warp2+fbm2 field is stable', () => {
        seedNoise(42);
        const w = 128, h = 128;
        const out = new Float32Array(w * h);
        const tmp = { x: 0, y: 0 };
        let idx = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                warp2(x * 0.01, y * 0.01, 1.5, tmp);
                out[idx++] = fbm2(tmp.x, tmp.y);
            }
        }
        const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        const hash = fnv1a(bytes);
        assert.strictEqual(hash.toString(16), GOLDEN_WARP_HASH);
    });

    it('golden: seed 42 -> hash of a curl3 slab is stable', () => {
        seedNoise(42);
        const w = 32, h = 32, d = 8;
        // Pack x,y,z components consecutively.
        const out = new Float32Array(w * h * d * 3);
        const tmp = { x: 0, y: 0, z: 0 };
        let idx = 0;
        for (let z = 0; z < d; z++) {
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    curl3(x * 0.05, y * 0.05, z * 0.05, tmp);
                    out[idx++] = tmp.x;
                    out[idx++] = tmp.y;
                    out[idx++] = tmp.z;
                }
            }
        }
        const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        const hash = fnv1a(bytes);
        assert.strictEqual(hash.toString(16), GOLDEN_CURL3_HASH);
    });
});

describe('lite-noise: instance API (createNoise / Noise)', () => {
    it('createNoise returns a Noise instance', () => {
        const n = createNoise(0);
        assert.ok(n instanceof Noise);
    });

    it('exposes every sampler as a method', () => {
        const n = createNoise(1);
        for (const m of ['simplex2', 'simplex3', 'fbm2', 'fbm3', 'curl2', 'curl3', 'warp2', 'fillField2', 'seed']) {
            assert.strictEqual(typeof n[m], 'function', `missing method: ${m}`);
        }
    });

    it('instance at seed S is byte-identical to the module after seedNoise(S)', () => {
        seedNoise(42);
        const n = createNoise(42);
        for (let i = 0; i < 2000; i++) {
            const x = i * 0.13, y = i * 0.07, z = i * 0.05;
            assert.strictEqual(n.simplex2(x, y), simplex2(x, y));
            assert.strictEqual(n.simplex3(x, y, z), simplex3(x, y, z));
            assert.strictEqual(n.fbm2(x, y), fbm2(x, y));
        }
    });

    it('two instances with different seeds are independent', () => {
        const a = createNoise(1);
        const before = a.simplex2(1.5, 2.5);
        // Create, sample, and reseed another instance; A must not budge.
        const b = createNoise(999);
        for (let i = 0; i < 500; i++) b.simplex2(i * 0.1, i * 0.2);
        b.seed(12345);
        assert.strictEqual(a.simplex2(1.5, 2.5), before);
    });

    it('an instance is immune to seedNoise on the shared module table', () => {
        const n = createNoise(42);
        const before = n.simplex2(1.5, 2.5);
        seedNoise(7); // the NS-01 action, on the module -- must not touch the instance
        assert.strictEqual(n.simplex2(1.5, 2.5), before);
    });

    it('.seed(s) reseeds in place and equals a fresh createNoise(s)', () => {
        const reused = createNoise(3);
        assert.strictEqual(reused.seed(8), reused, '.seed returns this');
        const fresh = createNoise(8);
        for (let i = 0; i < 1000; i++) {
            const x = i * 0.11, y = i * 0.09;
            assert.strictEqual(reused.simplex2(x, y), fresh.simplex2(x, y));
        }
    });

    it('golden: instance seed 42 -> 256x256 field hashes to GOLDEN_FIELD_HASH', () => {
        const n = createNoise(42);
        const w = 256, h = 256;
        const out = new Float32Array(w * h);
        n.fillField2(out, w, h, { scale: 0.01 });
        const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        assert.strictEqual(fnv1a(bytes).toString(16), GOLDEN_FIELD_HASH);
    });
});

// -- Golden hashes --------------------------------------------------------
// These are populated by the first passing run against a known-good build
// (see scripts/regenerate-goldens.mjs).
//
// A change here is a breaking change and must be called out in CHANGELOG.
const GOLDEN_FIELD_HASH = 'ddef5970';
const GOLDEN_WARP_HASH  = 'ca4f9f1e';
const GOLDEN_CURL3_HASH = '1ac7a518';

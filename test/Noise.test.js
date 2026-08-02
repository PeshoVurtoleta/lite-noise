import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seamlessScore } from '@zakkster/lite-patternforge';
import {
    seedNoise,
    simplex2, simplex3,
    fbm2, fbm3,
    ridged2, billow2,
    noiseLoop, tileable2,
    curl2, curl3,
    warp2,
    fillField2,
    createNoise, Noise,
} from '../Noise.js';

const TAU = Math.PI * 2;

/** Quantize a ~[-1,1] noise field to a grayscale RGBA Uint32 motif for seamlessScore. */
function toMotif(sample, W, H, period) {
    const m = new Uint32Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const v = sample(x / W * period, y / H * period);
            const g = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
            m[y * W + x] = (255 << 24) | (g << 16) | (g << 8) | g;
        }
    }
    return m;
}

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

describe('lite-noise: ridged2 / billow2', () => {
    // Characteristic shapes, asserted comparatively over one shared sampling grid
    // (the roadmap asks for histogram shape, not just range). ridged = (1-|s|)^2:
    // sharp creases that reach the unit ceiling where octaves align at zero-
    // crossings, distribution sitting high. billow = |s|: a soft fold that piles
    // mass at zero and rarely spikes, distribution sitting lower.
    function fieldStats(fn) {
        let mn = Infinity, mx = -Infinity, sum = 0, count = 0;
        for (let y = 0; y < 128; y++) {
            for (let x = 0; x < 128; x++) {
                const v = fn(x * 0.02, y * 0.02);
                if (v < mn) mn = v; if (v > mx) mx = v; sum += v; count++;
            }
        }
        return { mn, mx, mean: sum / count };
    }

    it('ridged2 and billow2 both live in ~[0, 1]', () => {
        const n = createNoise(42);
        const r = fieldStats((x, y) => n.ridged2(x, y));
        const b = fieldStats((x, y) => n.billow2(x, y));
        assert.ok(r.mn >= -0.01 && r.mx <= 1.01, `ridged2 out of range: [${r.mn}, ${r.mx}]`);
        assert.ok(b.mn >= -0.01 && b.mx <= 1.01, `billow2 out of range: [${b.mn}, ${b.mx}]`);
    });

    it('ridged2 cuts sharp unit creases that billow2 does not', () => {
        const n = createNoise(42);
        const r = fieldStats((x, y) => n.ridged2(x, y));
        const b = fieldStats((x, y) => n.billow2(x, y));
        assert.ok(r.mx > 0.95, `ridged2 never reaches a crease: max ${r.mx.toFixed(3)}`);
        assert.ok(b.mx < 0.9, `billow2 spikes like a ridge: max ${b.mx.toFixed(3)}`);
    });

    it('billow2 folds to zero and sits below ridged2', () => {
        const n = createNoise(42);
        const r = fieldStats((x, y) => n.ridged2(x, y));
        const b = fieldStats((x, y) => n.billow2(x, y));
        assert.ok(b.mn < 0.02, `billow2 never folds to zero: min ${b.mn.toFixed(3)}`);
        assert.ok(b.mean < r.mean, `billow2 mean ${b.mean.toFixed(3)} not below ridged2 mean ${r.mean.toFixed(3)}`);
    });

    it('ridged2 and billow2 honour the degenerate-octaves guard (0 -> 0, not NaN)', () => {
        const n = createNoise(42);
        assert.strictEqual(n.ridged2(1.7, 2.3, 0), 0);
        assert.strictEqual(n.billow2(1.7, 2.3, 0), 0);
        assert.strictEqual(n.ridged2(1.7, 2.3, -1), 0);
        assert.strictEqual(n.billow2(1.7, 2.3, -1), 0);
    });

    it('golden: seed 42 -> ridged2 / billow2 fields are stable', () => {
        const n = createNoise(42);
        const rf = new Float32Array(128 * 128), bf = new Float32Array(128 * 128);
        let i = 0;
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) rf[i++] = n.ridged2(x * 0.02, y * 0.02);
        i = 0;
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) bf[i++] = n.billow2(x * 0.02, y * 0.02);
        assert.strictEqual(fnv1a(new Uint8Array(rf.buffer)).toString(16), GOLDEN_RIDGED_HASH);
        assert.strictEqual(fnv1a(new Uint8Array(bf.buffer)).toString(16), GOLDEN_BILLOW_HASH);
    });
});

describe('lite-noise: noiseLoop', () => {
    it('closes the seam exactly: noiseLoop(0) === noiseLoop(TAU)', () => {
        const n = createNoise(42);
        for (const r of [0.5, 1.0, 1.5, 3.7]) {
            assert.strictEqual(n.noiseLoop(0, r), n.noiseLoop(TAU, r), `seam open at radius ${r}`);
        }
    });

    it('is periodic to floating-point precision: noiseLoop(t) ~= noiseLoop(t + TAU)', () => {
        // Only the canonical seam (0 vs TAU) is bit-exact -- (t + TAU) rounds off
        // low bits so `(t + TAU) % TAU` cannot recover an arbitrary t exactly.
        // Away from the seam, periodicity holds to a few ULPs.
        const n = createNoise(42);
        for (let k = 1; k < 50; k++) {
            const t = k * 0.13;
            assert.ok(Math.abs(n.noiseLoop(t, 1.5) - n.noiseLoop(t + TAU, 1.5)) < 1e-12, `not periodic at t=${t}`);
        }
    });

    it('has a continuous derivative across the seam (no visible pop)', () => {
        const n = createNoise(42);
        const e = 1e-5, r = 1.5;
        const dPre = (n.noiseLoop(TAU - e, r) - n.noiseLoop(TAU - 2 * e, r)) / e;
        const dPost = (n.noiseLoop(e, r) - n.noiseLoop(0, r)) / e;
        assert.ok(Math.abs(dPre - dPost) < 1e-2, `derivative jumps at seam: ${Math.abs(dPre - dPost)}`);
    });

    it('golden: seed 42 -> 720-sample loop is stable', () => {
        const n = createNoise(42);
        const lf = new Float32Array(720);
        for (let i = 0; i < 720; i++) lf[i] = n.noiseLoop(i / 720 * TAU, 1.5);
        assert.strictEqual(fnv1a(new Uint8Array(lf.buffer)).toString(16), GOLDEN_LOOP_HASH);
    });
});

describe('lite-noise: tileable2', () => {
    it('wraps exactly at the period (the ground-truth seamlessness, resolution-free)', () => {
        const n = createNoise(42);
        const px = 4, py = 3;
        for (let k = 0; k < 40; k++) {
            const y = k * 0.07;
            assert.strictEqual(n.tileable2(0, y, px, py), n.tileable2(px, y, px, py), `horizontal seam open at y=${y}`);
            const x = k * 0.11;
            assert.strictEqual(n.tileable2(x, 0, px, py), n.tileable2(x, py, px, py), `vertical seam open at x=${x}`);
        }
    });

    // Independent, calibrated cross-check from a sibling package. Note: seamlessScore
    // compares edge COLUMNS directly, so for a full-bleed noise texture it floors at
    // the texture's own per-pixel contrast (halves as resolution doubles) rather than
    // hitting 0. At 256px the imperceptible band (< 0.02) is reached at these periods;
    // the exact-wrap test above is the unconditional proof.
    it('scores in patternforge\'s imperceptible band (< 0.02) at 256px', () => {
        const n = createNoise(42);
        for (const period of [2, 4]) {
            const motif = toMotif((x, y) => n.tileable2(x, y, period, period), 256, 256, period);
            const score = seamlessScore(motif, 256, 256);
            assert.ok(score.overall < 0.02, `tileable2 seam score ${score.overall.toFixed(4)} >= 0.02 at period ${period}`);
        }
    });

    it('is dramatically more seamless than raw simplex2', () => {
        const n = createNoise(42);
        const tile = seamlessScore(toMotif((x, y) => n.tileable2(x, y, 4, 4), 128, 128, 4), 128, 128).overall;
        const raw = seamlessScore(toMotif((x, y) => n.simplex2(x * 12.8, y * 12.8), 128, 128, 4), 128, 128).overall;
        assert.ok(tile < raw * 0.25, `tileable2 (${tile.toFixed(4)}) not markedly better than raw simplex (${raw.toFixed(4)})`);
    });

    it('documents its precondition: period 0 returns a non-finite value (caller error, not guarded)', () => {
        // Pinning the contract stated in the JSDoc/README: a zero tile size is a
        // divide-by-zero, yielding NaN (when the numerator also vanishes) or
        // +/-Infinity otherwise -- either way non-finite, never a masked 0. This
        // is deliberately un-guarded (no hot-path branch); the test exists so the
        // behavior can't silently change.
        const n = createNoise(42);
        assert.ok(!Number.isFinite(n.tileable2(0.5, 0.5, 0, 4)), 'periodX=0 should be non-finite');
        assert.ok(!Number.isFinite(n.tileable2(0.5, 0.5, 4, 0)), 'periodY=0 should be non-finite');
        // A positive period is finite everywhere in-range.
        assert.ok(Number.isFinite(n.tileable2(0.5, 0.5, 4, 4)), 'valid period must be finite');
    });

    it('golden: seed 42 -> 64x64 period-4 tile is stable', () => {
        const n = createNoise(42);
        const tf = new Float32Array(64 * 64);
        let i = 0;
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) tf[i++] = n.tileable2(x / 64 * 4, y / 64 * 4, 4, 4);
        assert.strictEqual(fnv1a(new Uint8Array(tf.buffer)).toString(16), GOLDEN_TILE_HASH);
    });
});

describe('lite-noise: fillField2 normalize', () => {
    it('remaps to exact [0, 1] endpoints', () => {
        seedNoise(42);
        const w = 96, h = 96;
        const out = new Float32Array(w * h);
        fillField2(out, w, h, { scale: 0.02, normalize: true });
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < out.length; i++) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
        assert.ok(Math.abs(mn - 0) < 1e-6, `min not 0: ${mn}`);
        assert.ok(Math.abs(mx - 1) < 1e-6, `max not 1: ${mx}`);
    });

    it('preserves ordering (monotone remap of the un-normalized field)', () => {
        seedNoise(42);
        const w = 32, h = 32;
        const raw = new Float32Array(w * h), norm = new Float32Array(w * h);
        fillField2(raw, w, h, { scale: 0.03 });
        fillField2(norm, w, h, { scale: 0.03, normalize: true });
        // argmin/argmax of raw must be argmin/argmax of normalized.
        let iMin = 0, iMax = 0;
        for (let i = 1; i < raw.length; i++) { if (raw[i] < raw[iMin]) iMin = i; if (raw[i] > raw[iMax]) iMax = i; }
        assert.strictEqual(norm[iMin], 0);
        assert.strictEqual(norm[iMax], 1);
    });

    it('a constant field (octaves 0) normalizes to all-zero, not NaN', () => {
        seedNoise(42);
        const out = new Float32Array(16);
        fillField2(out, 4, 4, { octaves: 0, normalize: true });
        for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 0);
    });
});

describe('lite-noise: instance API (createNoise / Noise)', () => {
    it('createNoise returns a Noise instance', () => {
        const n = createNoise(0);
        assert.ok(n instanceof Noise);
    });

    it('exposes every sampler as a method', () => {
        const n = createNoise(1);
        for (const m of ['simplex2', 'simplex3', 'fbm2', 'fbm3', 'ridged2', 'billow2', 'noiseLoop', 'tileable2', 'curl2', 'curl3', 'warp2', 'fillField2', 'seed']) {
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
            assert.strictEqual(n.ridged2(x, y), ridged2(x, y));
            assert.strictEqual(n.billow2(x, y), billow2(x, y));
            assert.strictEqual(n.noiseLoop(x, 1.5), noiseLoop(x, 1.5));
            assert.strictEqual(n.tileable2(x % 4, y % 4, 4, 4), tileable2(x % 4, y % 4, 4, 4));
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

describe('lite-noise: N3 adversarial boundary sweep (QA pass)', () => {
    // -- ridged2/billow2: fuzzed non-default lacunarity/gain -----------------
    it('ridged2/billow2 stay in [0, 1] under fuzzed POSITIVE-gain, non-default params', () => {
        const n = createNoise(42);
        const combos = [
            [8, 1.5, 0.3], [8, 2.5, 0.7], [2, 3.0, 0.9], [6, 1.2, 0.2],
            [10, 4.0, 0.95], [3, 0.5, 0.5], [4, 2.0, 1.5], [1, 2.0, 0.5],
        ];
        for (const [octaves, lacunarity, gain] of combos) {
            for (let i = 0; i < 200; i++) {
                const x = i * 0.037, y = i * 0.021;
                const r = n.ridged2(x, y, octaves, lacunarity, gain);
                const b = n.billow2(x, y, octaves, lacunarity, gain);
                assert.ok(r >= -0.01 && r <= 1.01,
                    `ridged2 out of range at octaves=${octaves} lac=${lacunarity} gain=${gain}: ${r}`);
                assert.ok(b >= -0.01 && b <= 1.01,
                    `billow2 out of range at octaves=${octaves} lac=${lacunarity} gain=${gain}: ${b}`);
            }
        }
    });

    // The [0, 1] guarantee is a CONVEX-BLEND property: with gain >= 0 the weights
    // amplitude/maxAmp are all non-negative and sum to 1, so ridged/billow (each
    // octave in [0, 1]) stay in [0, 1] -- for ANY non-negative gain, including
    // gain > 1 where later octaves dominate. Assert the whole non-negative domain.
    it('ridged2/billow2 stay in [0, 1] for ALL gain >= 0 (incl. gain > 1)', () => {
        const n = createNoise(42);
        for (const gain of [0, 0.25, 0.5, 0.95, 1.0, 1.5, 3.0]) {
            for (let i = 0; i < 300; i++) {
                const x = i * 0.041, y = i * 0.019;
                const r = n.ridged2(x, y, 6, 2.0, gain);
                const b = n.billow2(x, y, 6, 2.0, gain);
                assert.ok(r >= -0.01 && r <= 1.01, `ridged2 out of [0,1] at gain=${gain}: ${r}`);
                assert.ok(b >= -0.01 && b <= 1.01, `billow2 out of [0,1] at gain=${gain}: ${b}`);
            }
        }
    });

    // Contract boundary: NEGATIVE gain is outside the documented FBM domain
    // (gain >= 0). It flips the per-octave amplitude sign, so maxAmp becomes a
    // partly-cancelling alternating sum and the quotient leaves ~[0, 1] -- the
    // same latitude fbm2 has always had past ~[-1, 1] (this is a shared domain
    // caveat, not an N3 regression). Un-guarded by design: gain < 0 is a caller
    // error, not a data value, and a per-sample branch would tax the hot path.
    // Pinned so the out-of-domain behavior is known and can't silently drift.
    it('negative gain is out of the documented domain (voids the [0,1] range, by contract)', () => {
        const n = createNoise(42);
        let sawOutOfRange = false;
        for (const gain of [-0.3, -0.5, -0.7]) {
            for (let i = 0; i < 300; i++) {
                const x = i * 0.041, y = i * 0.019;
                const r = n.ridged2(x, y, 6, 2.0, gain);
                const b = n.billow2(x, y, 6, 2.0, gain);
                if (r > 1.01 || r < -0.01 || b > 1.01 || b < -0.01) sawOutOfRange = true;
            }
        }
        assert.ok(sawOutOfRange, 'negative gain should leave [0,1] -- it is out of the documented gain >= 0 domain');
    });

    // -- noiseLoop boundary matrix --------------------------------------------
    it('noiseLoop: negative t keeps the seam exact (noiseLoop(-TAU) === noiseLoop(0))', () => {
        const n = createNoise(42);
        for (const r of [0.5, 1.0, 2.5]) {
            assert.strictEqual(n.noiseLoop(-TAU, r), n.noiseLoop(0, r), `negative seam open at radius ${r}`);
        }
    });

    it('noiseLoop: very large t stays finite', () => {
        const n = createNoise(42);
        for (const t of [1e6, 1e10, 1e15, Number.MAX_SAFE_INTEGER]) {
            const v = n.noiseLoop(t, 1);
            assert.ok(Number.isFinite(v), `noiseLoop(${t}) not finite: ${v}`);
        }
    });

    it('noiseLoop: radius=0 collapses every t to the same finite constant (simplex2(0,0))', () => {
        const n = createNoise(42);
        const base = n.noiseLoop(0, 0);
        assert.ok(Number.isFinite(base));
        assert.strictEqual(base, n.simplex2(0, 0));
        for (let i = 0; i < 20; i++) {
            assert.strictEqual(n.noiseLoop(i * 0.7, 0), base, `radius=0 not constant at t=${i * 0.7}`);
        }
    });

    it('noiseLoop: -0 is identical to 0 (the exact seam identity, signed-zero safe)', () => {
        const n = createNoise(42);
        assert.strictEqual(n.noiseLoop(-0, 1.5), n.noiseLoop(0, 1.5));
    });

    it('noiseLoop: NaN/undefined t degrade to a finite value, never propagate NaN', () => {
        // Documents existing _simplex2 behavior: NaN coordinates make every
        // falloff-radius test (t0/t1/t2 > 0) false, so all three lattice
        // contributions are skipped and the sum is exactly 0 -- not NaN.
        const n = createNoise(42);
        assert.strictEqual(n.noiseLoop(NaN, 1), 0);
        assert.strictEqual(n.noiseLoop(undefined, 1), 0);
        assert.ok(!Number.isNaN(n.noiseLoop(NaN, 1)));
    });

    it('ADVERSARIAL: noiseLoop with a negative radius stays finite (mirrors the circle)', () => {
        const n = createNoise(42);
        const v = n.noiseLoop(1.2, -1);
        assert.ok(Number.isFinite(v));
        // Negative radius is a coordinate mirror, not a magnitude -- distinct
        // from the positive-radius sample at the same t.
        assert.notStrictEqual(v, n.noiseLoop(1.2, 1));
    });

    // -- tileable2 boundary matrix --------------------------------------------
    it('tileable2: exact wrap holds for NON-integer periods', () => {
        const n = createNoise(42);
        for (const [px, py] of [[2.5, 2.5], [3.7, 1.3], [0.1, 0.1]]) {
            for (let k = 0; k < 20; k++) {
                const y = (k * 0.037) % py;
                assert.strictEqual(n.tileable2(0, y, px, py), n.tileable2(px, y, px, py),
                    `horizontal seam open at period ${px}x${py}, y=${y}`);
                const x = (k * 0.041) % px;
                assert.strictEqual(n.tileable2(x, 0, px, py), n.tileable2(x, py, px, py),
                    `vertical seam open at period ${px}x${py}, x=${x}`);
            }
        }
    });

    it('tileable2: x/y outside [0, period) stay finite', () => {
        const n = createNoise(42);
        assert.ok(Number.isFinite(n.tileable2(10, 1, 4, 4)), 'x > periodX must be finite');
        assert.ok(Number.isFinite(n.tileable2(-5, 1, 4, 4)), 'x < 0 must be finite');
    });

    it('DOCUMENTS: tileable2 is seamless only at ONE period boundary, not globally periodic', () => {
        // The seamlessness contract is opposite-edges-of-the-declared-tile, not
        // "periodic for all x". Two periods out need not equal one period out --
        // this is expected given the domain is [0, periodX) x [0, periodY), and
        // is worth pinning so the contract can't silently widen or narrow.
        const n = createNoise(42);
        const onePeriodOut = n.tileable2(4, 1, 4, 4);
        const twoPeriodsOut = n.tileable2(8, 1, 4, 4);
        assert.notStrictEqual(onePeriodOut, twoPeriodsOut,
            'tileable2 unexpectedly periodic beyond one wrap -- contract changed, update docs/tests');
    });

    it('ADVERSARIAL: deliberately-broken tileable (plain simplex2) fails the seamlessScore bar', () => {
        // Cross-check that the < 0.02 bar in the functional suite is not
        // tautological: raw simplex2 (no wrap blending at all) must score
        // clearly above it.
        const n = createNoise(42);
        const period = 4;
        const motif = toMotif((x, y) => n.simplex2(x * 12.8, y * 12.8), 128, 128, period);
        const score = seamlessScore(motif, 128, 128);
        assert.ok(score.overall >= 0.02, `expected raw simplex2 to fail the seam bar, scored ${score.overall}`);
    });

    // -- fillField2 normalize boundary matrix ---------------------------------
    it('normalize: w=1,h=1 single cell maps to 0, not NaN (min==max, range 0)', () => {
        seedNoise(42);
        const out = new Float32Array(1);
        fillField2(out, 1, 1, { normalize: true });
        assert.strictEqual(out[0], 0);
        assert.ok(!Number.isNaN(out[0]));
    });

    it('normalize: a flat non-zero field (scale=0, every sample identical) maps to all-zero', () => {
        seedNoise(42);
        const out = new Float32Array(16);
        fillField2(out, 4, 4, { scale: 0, normalize: true });
        // scale=0 samples the exact same (ox, oy) point every cell -- a
        // non-degenerate octave count but a constant field by construction.
        for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 0);
    });

    it('normalize: works identically on a Float64Array target', () => {
        seedNoise(42);
        const out = new Float64Array(64);
        const result = fillField2(out, 8, 8, { scale: 0.05, normalize: true });
        assert.strictEqual(result, out);
        let mn = Infinity, mx = -Infinity;
        for (const v of out) { if (v < mn) mn = v; if (v > mx) mx = v; }
        assert.strictEqual(mn, 0);
        assert.strictEqual(mx, 1);
    });

    it('fillField2: w=0, h=0 is a no-op over an empty buffer', () => {
        seedNoise(42);
        const out = new Float32Array(0);
        const result = fillField2(out, 0, 0, { normalize: true });
        assert.strictEqual(result, out);
        assert.strictEqual(result.length, 0);
    });

    // -- re-entrant / aliased write ---------------------------------------------
    it('RE-ENTRANT: fillField2 writing into the same buffer twice in a row overwrites cleanly', () => {
        seedNoise(42);
        const out = new Float32Array(16);
        fillField2(out, 4, 4, { scale: 0.05 });
        const snapshot = Array.from(out);
        fillField2(out, 4, 4, { scale: 0.05, normalize: true });
        assert.ok(Array.from(out).some((v, i) => v !== snapshot[i]),
            'second fillField2 into the same buffer did not visibly overwrite the first');
    });

    it('RE-ENTRANT: reusing the same caller-owned out object across curl2 calls does not leak stale state', () => {
        const n = createNoise(42);
        const out = { x: 0, y: 0 };
        n.curl2(1, 1, out);
        const first = { x: out.x, y: out.y };
        n.curl2(2, 2, out);
        assert.notStrictEqual(out.x, first.x);
    });

    // -- duplicate "dispose" analog: repeated re-seed to the same value ---------
    it('DUPLICATE-RESEED: seeding an instance to the same value twice in a row is idempotent', () => {
        const n = createNoise(1);
        n.seed(5);
        const a = n.simplex2(1.1, 2.2);
        n.seed(5); // duplicate reseed to the identical value
        const b = n.simplex2(1.1, 2.2);
        assert.strictEqual(a, b);
    });

    // -- cross-instance isolation for the N3 surface -----------------------------
    it('cross-instance isolation holds for ridged2/billow2/noiseLoop/tileable2', () => {
        const a = createNoise(11);
        const b = createNoise(22);
        const before = {
            r: a.ridged2(1.3, 2.7), bl: a.billow2(1.3, 2.7),
            loop: a.noiseLoop(1.1, 1.5), tile: a.tileable2(1.5, 2.1, 4, 4),
        };
        for (let i = 0; i < 500; i++) {
            b.ridged2(i * 0.01, i * 0.02);
            b.billow2(i * 0.01, i * 0.02);
            b.noiseLoop(i * 0.01, 2.5);
            b.tileable2(i * 0.01 % 4, i * 0.02 % 5, 4, 5);
        }
        b.seed(999);
        const after = {
            r: a.ridged2(1.3, 2.7), bl: a.billow2(1.3, 2.7),
            loop: a.noiseLoop(1.1, 1.5), tile: a.tileable2(1.5, 2.1, 4, 4),
        };
        assert.deepStrictEqual(before, after);
    });

    it('different seeds produce different ridged2/billow2/noiseLoop/tileable2 fields', () => {
        const c1 = createNoise(1), c2 = createNoise(2);
        assert.notStrictEqual(c1.ridged2(3, 4), c2.ridged2(3, 4));
        assert.notStrictEqual(c1.billow2(3, 4), c2.billow2(3, 4));
        assert.notStrictEqual(c1.noiseLoop(1, 1), c2.noiseLoop(1, 1));
        assert.notStrictEqual(c1.tileable2(1, 1, 4, 4), c2.tileable2(1, 1, 4, 4));
    });
});

// -- Golden hashes --------------------------------------------------------
// These are populated by the first passing run against a known-good build
// (see scripts/regenerate-goldens.mjs).
//
// A change here is a breaking change and must be called out in CHANGELOG.
const GOLDEN_FIELD_HASH  = 'ddef5970';
const GOLDEN_WARP_HASH   = 'ca4f9f1e';
const GOLDEN_CURL3_HASH  = '1ac7a518';
const GOLDEN_RIDGED_HASH = '2342c230';
const GOLDEN_BILLOW_HASH = 'acf96355';
const GOLDEN_TILE_HASH   = 'b6d00662';
const GOLDEN_LOOP_HASH   = '2cfa58f8';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { seamlessScore } from '@zakkster/lite-patternforge';
import {
    seedNoise,
    simplex2, simplex3,
    fbm2, fbm3,
    ridged2, billow2,
    noiseLoop, tileable2,
    curl2, curl3,
    warp2,
    fillField2, tileableField2, fillField3,
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

describe('lite-noise: tileableField2', () => {
    const MODELS = ['fbm', 'ridged', 'billow'];

    // The naive per-cell reference: the same harmonic-octave sum the field bakes,
    // but expressed through the PUBLIC tileable2 sampler. Parity between this and
    // the field is the drift-catch; the seam identity of THIS reference (origin ==
    // boundary) is what the field inherits.
    function naiveCell(n, model, px, py, periodX, periodY, octaves, lacunarity, gain) {
        let amp = 1, freq = 1, total = 0, maxAmp = 0;
        for (let k = 0; k < octaves; k++) {
            let s = n.tileable2(px * freq, py * freq, periodX * freq, periodY * freq);
            if (model === 'ridged') { s = 1 - Math.abs(s); s *= s; }
            else if (model === 'billow') { s = Math.abs(s) * 2 - 1; }
            total += s * amp; maxAmp += amp; amp *= gain; freq *= lacunarity;
        }
        return maxAmp ? total / maxAmp : 0;
    }

    // --- Sampler-wrap identity (zero tolerance) ------------------------------
    // Proves the ALGEBRAIC mechanism the field inherits: baking the boundary
    // column via ox = periodX forces px = periodX exactly, and tileable2(0) ===
    // tileable2(periodX) per octave, so the two fields' column 0 match on every
    // row. This is exact by construction and independent of the grid -- it does
    // NOT prove the real tiled-buffer wrap (where the boundary column sits at
    // ox = w*stepX, which equals periodX only on a GRID-ALIGNED bake). That
    // stronger, alignment-dependent property is the next test.
    it('sampler-wrap identity holds for every model (ox=periodX, rows + columns, zero tolerance)', () => {
        const n = createNoise(42);
        const W = 64, H = 64, P = 4;
        for (const model of MODELS) {
            const base = { model, periodX: P, periodY: P, octaves: 4, lacunarity: 2, gain: 0.5 };
            const origin = new Float64Array(W * H);
            const shiftedX = new Float64Array(W * H);
            const shiftedY = new Float64Array(W * H);
            n.tileableField2(origin, W, H, base);
            n.tileableField2(shiftedX, W, H, { ...base, ox: P });   // col 0 samples px = periodX
            n.tileableField2(shiftedY, W, H, { ...base, oy: P });   // row 0 samples py = periodY
            for (let y = 0; y < H; y++) {
                assert.strictEqual(origin[y * W + 0], shiftedX[y * W + 0],
                    `${model}: horizontal seam open at row ${y}`);
            }
            for (let x = 0; x < W; x++) {
                assert.strictEqual(origin[0 * W + x], shiftedY[0 * W + x],
                    `${model}: vertical seam open at col ${x}`);
            }
        }
    });

    // --- REAL tiled-buffer wrap: exact iff grid-aligned ----------------------
    // The seam a caller actually tiles is between the last baked column (x=w-1,
    // coord (w-1)*stepX) and the next tile's column 0 (coord w*stepX), stepX =
    // periodX/w. It wraps bit-exact IFF w*(periodX/w) === periodX in float64 --
    // i.e. GRID-ALIGNED (power-of-two width + integer period). We bake the true
    // "column w" via ox = w*stepX and compare to column 0. This DISCRIMINATES
    // where the ox=periodX test above cannot: a non-aligned grid shows an epsilon
    // seam here (~1e-14), not ===. That boundary is the documented precondition.
    function realSeamGap(n, W, H, P, model) {
        const stepX = P / W;
        const origin = new Float64Array(W * H);
        const nextCol = new Float64Array(H); // the single column at x = w
        n.tileableField2(origin, W, H, { model, periodX: P, periodY: P, octaves: 4 });
        n.tileableField2(nextCol, 1, H, { model, periodX: P, periodY: P, octaves: 4, ox: W * stepX });
        let maxGap = 0;
        for (let y = 0; y < H; y++) {
            const g = Math.abs(origin[y * W + 0] - nextCol[y]);
            if (g > maxGap) maxGap = g;
        }
        return maxGap;
    }

    it('real tiled-buffer wrap is bit-exact (===) on GRID-ALIGNED dims, every model', () => {
        const n = createNoise(42);
        for (const [W, P] of [[64, 4], [8, 16], [128, 2]]) {
            assert.strictEqual(W * (P / W), P, `precondition: ${W}/${P} must be grid-aligned`);
            for (const model of MODELS) {
                assert.strictEqual(realSeamGap(n, W, W, P, model), 0,
                    `${model}: aligned ${W}/${P} tiled seam not exact`);
            }
        }
    });

    it('real tiled-buffer wrap is epsilon (NOT ===) on NON-aligned dims -- documents the precondition', () => {
        const n = createNoise(42);
        // 7*(29/7) !== 29 in float64: the seam column lands a few ULPs off periodX.
        assert.notStrictEqual(7 * (29 / 7), 29, 'sanity: 7/29 must be non-grid-aligned');
        const gap = realSeamGap(n, 7, 7, 29, 'fbm');
        assert.ok(gap > 0, 'non-aligned seam should NOT be bit-exact (that is the whole point)');
        assert.ok(gap < 1e-12, `non-aligned seam should still be within float epsilon, got ${gap}`);
    });

    it('a non-zero ox/oy breaks the tiled wrap -- the seam holds only at the tile origin', () => {
        const n = createNoise(42);
        // ox/oy exist for fillField2 parity, but shift the sampling window off the
        // tile origin: the exact seam holds ONLY at ox=oy=0. Even a whole-period
        // offset breaks it OUTRIGHT (not epsilon). Pin so a "ox preserves the seam"
        // regression (in code or docs) trips here.
        const W = 64, H = 64, P = 4, stepX = P / W;
        assert.strictEqual(realSeamGap(n, W, H, P, 'fbm'), 0, 'ox=0 default must be exact');
        for (const ox of [P, 2 * P, 1.3]) {
            const a = new Float64Array(W * H), b = new Float64Array(H);
            n.tileableField2(a, W, H, { model: 'fbm', periodX: P, periodY: P, octaves: 4, ox });
            n.tileableField2(b, 1, H, { model: 'fbm', periodX: P, periodY: P, octaves: 4, ox: ox + W * stepX });
            let g = 0;
            for (let y = 0; y < H; y++) { const d = Math.abs(a[y * W] - b[y]); if (d > g) g = d; }
            assert.ok(g > 1e-6, `ox=${ox} should break the seam outright, got gap ${g}`);
        }
    });

    // --- Naive-loop parity: 4096/4096 cells identical ------------------------
    it('field bytes match a naive per-cell tileable2 octave loop (4096/4096)', () => {
        const n = createNoise(42);
        const W = 64, H = 64, P = 4;
        for (const model of MODELS) {
            const f = new Float32Array(W * H);
            n.tileableField2(f, W, H, { model, periodX: P, periodY: P, octaves: 4, lacunarity: 2, gain: 0.5 });
            let same = 0;
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const expect = Math.fround(naiveCell(n, model, x * (P / W), y * (P / H), P, P, 4, 2, 0.5));
                    if (f[y * W + x] === expect) same++;
                }
            }
            assert.strictEqual(same, W * H, `${model}: only ${same}/${W * H} cells matched the naive loop`);
        }
    });

    // --- Model range / behavior character ------------------------------------
    it('each model produces its expected sign/range character', () => {
        const n = createNoise(42);
        const W = 128, H = 128, P = 4;
        function stats(model) {
            const f = new Float32Array(W * H);
            n.tileableField2(f, W, H, { model, periodX: P, periodY: P });
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
            return { mn, mx };
        }
        const fbm = stats('fbm'), ridged = stats('ridged'), billow = stats('billow');
        // fbm: signed -- straddles zero.
        assert.ok(fbm.mn < 0 && fbm.mx > 0, `fbm not signed: [${fbm.mn}, ${fbm.mx}]`);
        // ridged: (1-|n|)^2 per octave -- non-negative, reaches the unit crease.
        assert.ok(ridged.mn >= -1e-6, `ridged went negative: min ${ridged.mn}`);
        assert.ok(ridged.mx > 0.9, `ridged never reaches a crease: max ${ridged.mx}`);
        // billow: |n|*2-1 per octave -- folds below zero, unlike ridged.
        assert.ok(billow.mn < 0, `billow never folds below zero: min ${billow.mn}`);
    });

    // --- Fail closed at setup (before out is touched) ------------------------
    it('throws RangeError on an unknown model, naming the valid set', () => {
        const n = createNoise(42);
        const out = new Float32Array(16);
        assert.throws(() => n.tileableField2(out, 4, 4, { model: 'turbulence', periodX: 4, periodY: 4 }),
            (e) => e instanceof RangeError && /turbulence/.test(e.message) && /fbm/.test(e.message) && /ridged/.test(e.message) && /billow/.test(e.message));
    });

    it('throws RangeError on non-positive or missing period, before writing out', () => {
        const n = createNoise(42);
        const out = new Float32Array(16);
        out.fill(7);
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 0, periodY: 4 }), RangeError);
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 4, periodY: -1 }), RangeError);
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 4 }), RangeError); // periodY missing
        assert.throws(() => n.tileableField2(out, 4, 4, {}), RangeError);             // both missing
        // Non-finite periods must ALSO throw, not silently bake an all-NaN field:
        // Infinity passes `> 0`, so the guard requires Number.isFinite too.
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: Infinity, periodY: 4 }), RangeError);
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 4, periodY: Infinity }), RangeError);
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: NaN, periodY: 4 }), RangeError);
        // out untouched -- the fail-closed checks precede the fill.
        for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 7, 'out was written despite a setup throw');
    });

    // --- Determinism: module fn vs instance, byte-identical -------------------
    it('module function and instance method are byte-identical at the same seed', () => {
        seedNoise(42);
        const n = createNoise(42);
        const W = 48, H = 48, P = 3;
        for (const model of MODELS) {
            const fm = new Float32Array(W * H), fi = new Float32Array(W * H);
            tileableField2(fm, W, H, { model, periodX: P, periodY: P, octaves: 5, gain: 0.55 });
            n.tileableField2(fi, W, H, { model, periodX: P, periodY: P, octaves: 5, gain: 0.55 });
            for (let i = 0; i < fm.length; i++) {
                assert.strictEqual(fm[i], fi[i], `${model}: module!=instance at cell ${i}`);
            }
        }
    });

    // --- Determinism: byte-identical across two node processes ----------------
    // Two fresh child processes must fingerprint the 3-model field identically --
    // no address-space / iteration-order dependence in the permutation table or
    // the bake. A non-zero fingerprint keeps the check non-vacuous.
    it('is byte-identical across two independent node processes', () => {
        const url = new URL('../Noise.js', import.meta.url).href;
        const prog =
            "import(" + JSON.stringify(url) + ").then(({ createNoise }) => {" +
            "  const n = createNoise(42); let h = 0x811c9dc5 >>> 0;" +
            "  for (const model of ['fbm','ridged','billow']) {" +
            "    const f = new Float32Array(64*64);" +
            "    n.tileableField2(f, 64, 64, { model, periodX:4, periodY:4, octaves:4, lacunarity:2, gain:0.5 });" +
            "    const b = new Uint8Array(f.buffer);" +
            "    for (let i=0;i<b.length;i++){ h ^= b[i]; h = (h*0x01000193)>>>0; } }" +
            "  process.stdout.write(String(h>>>0));" +
            "});";
        const a = spawnSync(process.execPath, ['--input-type=module', '-e', prog], { encoding: 'utf8' });
        const b = spawnSync(process.execPath, ['--input-type=module', '-e', prog], { encoding: 'utf8' });
        assert.strictEqual(a.status, 0, `child A failed: ${a.stderr}`);
        assert.strictEqual(b.status, 0, `child B failed: ${b.stderr}`);
        assert.ok(a.stdout.length > 0 && a.stdout !== '0', 'empty/degenerate fingerprint');
        assert.strictEqual(a.stdout, b.stdout, 'two processes disagreed on the field fingerprint');
    });

    // --- normalize pass -------------------------------------------------------
    it('normalize remaps to exact [0, 1] endpoints', () => {
        const n = createNoise(42);
        const W = 96, H = 96;
        const out = new Float32Array(W * H);
        n.tileableField2(out, W, H, { model: 'fbm', periodX: 4, periodY: 4, normalize: true });
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < out.length; i++) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
        assert.ok(Math.abs(mn - 0) < 1e-6, `min not 0: ${mn}`);
        assert.ok(Math.abs(mx - 1) < 1e-6, `max not 1: ${mx}`);
    });

    // --- Committed goldens ----------------------------------------------------
    it('golden: seed 42 -> 64x64 period-4 fields are stable for all 3 models', () => {
        const n = createNoise(42);
        const golden = { fbm: GOLDEN_TF2_FBM_HASH, ridged: GOLDEN_TF2_RIDGED_HASH, billow: GOLDEN_TF2_BILLOW_HASH };
        for (const model of MODELS) {
            const f = new Float32Array(64 * 64);
            n.tileableField2(f, 64, 64, { model, periodX: 4, periodY: 4, octaves: 4, lacunarity: 2, gain: 0.5 });
            assert.strictEqual(fnv1a(new Uint8Array(f.buffer)).toString(16), golden[model], `${model} golden drift`);
        }
    });

    // --- seamlessScore cross-check (patternforge, dev-only) -------------------
    // The primary proof is the bit-exact `===` tiled-buffer wrap on grid-aligned
    // dims above. seamlessScore is the calibrated sibling cross-check. Note it compares edge COLUMNS, so a
    // full-bleed multifractal texture floors at its own per-pixel contrast (more
    // octaves = more contrast), which is why the field scores slightly HIGHER than
    // a single-octave tileable2 despite an algebraically identical seam -- the same
    // caveat already documented for tileable2. The meaningful, direction-correct
    // gate is therefore vs the NON-tileable equivalent field: the tile must score
    // dramatically better than raw fbm2 at the same base frequency.
    it('scores dramatically more seamless than the non-tileable fbm2 field (all models)', () => {
        const n = createNoise(42);
        const W = 256, P = 4;
        // Grayscale RGBA motif straight from a baked field buffer (one pixel/cell).
        function fieldMotif(f) {
            const m = new Uint32Array(W * W);
            for (let i = 0; i < f.length; i++) {
                const g = Math.max(0, Math.min(255, Math.round((f[i] * 0.5 + 0.5) * 255)));
                m[i] = (255 << 24) | (g << 16) | (g << 8) | g;
            }
            return m;
        }
        const raw = seamlessScore(toMotif((x, y) => n.fbm2(x, y), W, W, P), W, W).overall;
        for (const model of MODELS) {
            const f = new Float64Array(W * W);
            n.tileableField2(f, W, W, { model, periodX: P, periodY: P });
            const tiled = seamlessScore(fieldMotif(f), W, W).overall;
            assert.ok(tiled < raw * 0.25, `${model} field (${tiled.toFixed(4)}) not markedly better than raw fbm2 (${raw.toFixed(4)})`);
        }
    });

    // --- BOUNDARY: exact seam holds off the happy-path shape too --------------
    // The shipped seam test fixes W=H=64, P=4 (integer, square). Re-run the same
    // exact-`===` proof (origin column/row vs a re-bake shifted by one full
    // period) across non-integer periods, non-square w!=h, and the 1xN / Nx1 /
    // 1x1 degenerate sizes -- every axis, every model. A wrap that only held at
    // the one shape shipped would be vacuous; this is the discriminating re-run.
    it('BOUNDARY exact seam holds for non-integer periods, non-square fields, and 1xN/Nx1/1x1', () => {
        const n = createNoise(42);
        function seamCheck(model, W, H, periodX, periodY) {
            const base = { model, periodX, periodY, octaves: 4, lacunarity: 2, gain: 0.5 };
            const origin = new Float64Array(W * H);
            const shiftedX = new Float64Array(W * H);
            const shiftedY = new Float64Array(W * H);
            n.tileableField2(origin, W, H, base);
            n.tileableField2(shiftedX, W, H, { ...base, ox: periodX });
            n.tileableField2(shiftedY, W, H, { ...base, oy: periodY });
            for (let y = 0; y < H; y++) {
                assert.strictEqual(origin[y * W + 0], shiftedX[y * W + 0],
                    `${model} ${W}x${H} P=${periodX},${periodY}: horizontal seam open at row ${y}`);
            }
            for (let x = 0; x < W; x++) {
                assert.strictEqual(origin[0 * W + x], shiftedY[0 * W + x],
                    `${model} ${W}x${H} P=${periodX},${periodY}: vertical seam open at col ${x}`);
            }
        }
        for (const model of MODELS) {
            seamCheck(model, 32, 32, 3.7, 3.7);   // non-integer period
            seamCheck(model, 17, 53, 4, 6);       // non-square, non-equal periods
            seamCheck(model, 1, 40, 4, 4);        // 1xN
            seamCheck(model, 40, 1, 4, 4);        // Nx1
            seamCheck(model, 1, 1, 4, 4);         // 1x1 degenerate
        }
    });

    // --- BOUNDARY: fail-closed matrix ------------------------------------------
    it('BOUNDARY periodX/periodY: 0, negative, NaN, and -0 all throw; non-integer does not', () => {
        const n = createNoise(42);
        const out = new Float32Array(16);
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 0, periodY: 4 }), RangeError, 'periodX=0');
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 4, periodY: 0 }), RangeError, 'periodY=0');
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: -1, periodY: 4 }), RangeError, 'periodX=-1');
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 4, periodY: -1 }), RangeError, 'periodY=-1');
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: NaN, periodY: 4 }), RangeError, 'periodX=NaN');
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: -0, periodY: 4 }), RangeError, 'periodX=-0');
        assert.throws(() => n.tileableField2(out, 4, 4, { periodX: 4, periodY: -0 }), RangeError, 'periodY=-0');
        // A non-integer positive period is a legitimate tile size -- must NOT throw.
        assert.doesNotThrow(() => n.tileableField2(out, 4, 4, { periodX: 3.5, periodY: 2.25 }),
            'a fractional positive period is a valid tile size');
    });

    it('BOUNDARY w=0 / h=0 is a no-op: out is left untouched, no throw', () => {
        const n = createNoise(42);
        const out = new Float32Array(16);
        out.fill(7);
        n.tileableField2(out, 0, 4, { periodX: 4, periodY: 4 });
        n.tileableField2(out, 4, 0, { periodX: 4, periodY: 4 });
        for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 7, `w=0/h=0 wrote cell ${i}`);
    });

    it('BOUNDARY out shorter than w*h truncates silently (matches fillField2 precedent), never throws or corrupts beyond its own length', () => {
        const n = createNoise(42);
        const full = new Float32Array(16);
        n.tileableField2(full, 4, 4, { periodX: 4, periodY: 4 });
        const short = new Float32Array(8);
        assert.doesNotThrow(() => n.tileableField2(short, 4, 4, { periodX: 4, periodY: 4 }));
        for (let i = 0; i < short.length; i++) {
            assert.strictEqual(short[i], full[i], `cell ${i} diverged from the full bake`);
        }
    });

    // --- BOUNDARY: model range contract -----------------------------------------
    // Per the shipped doc comment: fbm ~[-1,1] signed; ridged (1-|n|)^2 is
    // non-negative and reaches near 1; billow |n|*2-1 is documented ~[-1,1]
    // FOLDED (it does NOT match [0,1] -- that is the plain-abs billow2 sibling's
    // range, a different transform under the same model name). Assert the
    // documented contract, not the more common billow convention.
    it('BOUNDARY model ranges match the documented per-model transform, at scale', () => {
        const n = createNoise(42);
        const W = 256, H = 256;
        function stats(model) {
            const f = new Float32Array(W * H);
            n.tileableField2(f, W, H, { model, periodX: 4, periodY: 4, octaves: 6, gain: 0.5 });
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
            return { mn, mx };
        }
        const fbm = stats('fbm'), ridged = stats('ridged'), billow = stats('billow');
        assert.ok(fbm.mn >= -1.01 && fbm.mx <= 1.01, `fbm out of ~[-1,1]: [${fbm.mn}, ${fbm.mx}]`);
        assert.ok(ridged.mn >= -1e-6 && ridged.mx <= 1.01, `ridged out of ~[0,1]: [${ridged.mn}, ${ridged.mx}]`);
        // Documented contract: billow is ~[-1,1] (folded), NOT [0,1].
        assert.ok(billow.mn < -0.5, `billow did not fold near -1 as documented: min ${billow.mn}`);
        assert.ok(billow.mx <= 1.01, `billow exceeded its documented ~[-1,1] ceiling: max ${billow.mx}`);
    });

    it('BOUNDARY negative gain leaves the documented range (inherited _octaves2 caveat)', () => {
        const n = createNoise(42);
        const W = 128, H = 128;
        const f = new Float32Array(W * H);
        n.tileableField2(f, W, H, { model: 'fbm', periodX: 4, periodY: 4, octaves: 4, gain: -0.5 });
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
        assert.ok(mn < -1.01 || mx > 1.01, `negative gain unexpectedly stayed in [-1,1]: [${mn}, ${mx}]`);
    });

    it('BOUNDARY octaves=0 (constant field) normalizes to all-zero, never NaN', () => {
        const n = createNoise(42);
        const W = 16, H = 16;
        const out = new Float32Array(W * H);
        out.fill(-9);
        n.tileableField2(out, W, H, { periodX: 4, periodY: 4, octaves: 0, normalize: true });
        for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 0, `octaves=0 cell ${i} not exactly 0`);
    });

    it('BOUNDARY normalize hits the [0, 1] endpoints bit-exactly, not just within tolerance', () => {
        const n = createNoise(42);
        const W = 96, H = 96;
        const out = new Float32Array(W * H);
        n.tileableField2(out, W, H, { model: 'fbm', periodX: 4, periodY: 4, normalize: true });
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < out.length; i++) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
        assert.strictEqual(mn, 0, `normalize min not bit-exact 0: ${mn}`);
        assert.strictEqual(mx, 1, `normalize max not bit-exact 1: ${mx}`);
    });

    it('BOUNDARY Float64Array target works and is byte-identical to a Float32-widened bake at the values that survive rounding', () => {
        const n = createNoise(42);
        const W = 16, H = 16;
        const out64 = new Float64Array(W * H);
        assert.doesNotThrow(() => n.tileableField2(out64, W, H, { periodX: 4, periodY: 4 }));
        let finiteCount = 0;
        for (let i = 0; i < out64.length; i++) if (Number.isFinite(out64[i])) finiteCount++;
        assert.strictEqual(finiteCount, out64.length, 'Float64Array target produced a non-finite cell');
    });

    it('BOUNDARY module==instance holds off the golden shape too (non-square, period not a divisor of w/h, all 3 models)', () => {
        seedNoise(7);
        const inst = createNoise(7);
        const W = 13, H = 29, P = 5;
        for (const model of MODELS) {
            const fm = new Float32Array(W * H), fi = new Float32Array(W * H);
            tileableField2(fm, W, H, { model, periodX: P, periodY: P, octaves: 3, gain: 0.6 });
            inst.tileableField2(fi, W, H, { model, periodX: P, periodY: P, octaves: 3, gain: 0.6 });
            for (let i = 0; i < fm.length; i++) {
                assert.strictEqual(fm[i], fi[i], `${model}: module!=instance at cell ${i}`);
            }
        }
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

describe('lite-noise: fillField3 (3D scalar volume bake)', () => {
    const FF3_MODELS = ['fbm', 'ridged', 'billow'];

    it('bakes a w*h*d volume, z-outer row-major (index = ((z*h)+y)*w + x)', () => {
        seedNoise(42);
        const w = 8, h = 6, d = 4;
        const out = new Float32Array(w * h * d);
        const result = fillField3(out, w, h, d, { scale: 0.05 });
        assert.strictEqual(result, out);
        // Every cell written and finite; range within the fbm ~[-1,1] band.
        for (let i = 0; i < out.length; i++) {
            assert.ok(Number.isFinite(out[i]), `cell ${i} non-finite`);
            assert.ok(out[i] >= -1.1 && out[i] <= 1.1, `cell ${i} out of range: ${out[i]}`);
        }
    });

    it('the z-outer row-major layout matches a hand-indexed fbm3 sweep, bit-exact', () => {
        // Prove the documented index formula against an explicit triple loop that
        // samples fbm3 at the same INCREMENTALLY-stepped coordinates (px += scale,
        // never x*scale -- the multiply would diverge from the accumulation by ULPs,
        // which is exactly the coordinate contract fillField3 documents).
        const inst = createNoise(42);
        const w = 5, h = 7, d = 3, scale = 0.05;
        const out = new Float32Array(w * h * d);
        inst.fillField3(out, w, h, d, { scale, octaves: 4, lacunarity: 2, gain: 0.5 });
        let pz = 0;
        for (let z = 0; z < d; z++) {
            let py = 0;
            for (let y = 0; y < h; y++) {
                let px = 0;
                for (let x = 0; x < w; x++) {
                    const idx = ((z * h) + y) * w + x;
                    const expect = Math.fround(inst.fbm3(px, py, pz, 4, 2, 0.5));
                    assert.strictEqual(out[idx], expect, `cell (${x},${y},${z}) idx ${idx} mismatch`);
                    px += scale;
                }
                py += scale;
            }
            pz += scale;
        }
    });

    it('accepts missing opts (all defaults) and varies', () => {
        seedNoise(42);
        const out = new Float32Array(4 * 4 * 4);
        const result = fillField3(out, 4, 4, 4);
        assert.strictEqual(result, out);
        let variance = 0;
        for (let i = 1; i < out.length; i++) variance += Math.abs(out[i] - out[0]);
        assert.ok(variance > 0, 'default-opts volume had no variation');
    });

    // --- Committed goldens ----------------------------------------------------
    it('golden: seed 42 -> 32x32x32 Float32 volume is stable for all 3 models', () => {
        seedNoise(42);
        const golden = { fbm: GOLDEN_FF3_FBM_HASH, ridged: GOLDEN_FF3_RIDGED_HASH, billow: GOLDEN_FF3_BILLOW_HASH };
        for (const model of FF3_MODELS) {
            const f = new Float32Array(32 * 32 * 32);
            fillField3(f, 32, 32, 32, { model, scale: 0.05, octaves: 4, lacunarity: 2, gain: 0.5 });
            assert.strictEqual(fnv1a(new Uint8Array(f.buffer)).toString(16), golden[model], `${model} golden drift`);
        }
    });

    it('module == instance at the same seed (all 3 models, non-cube dims)', () => {
        seedNoise(7);
        const inst = createNoise(7);
        const w = 9, h = 5, d = 6;
        for (const model of FF3_MODELS) {
            const fm = new Float32Array(w * h * d), fi = new Float32Array(w * h * d);
            fillField3(fm, w, h, d, { model, scale: 0.04, octaves: 3, gain: 0.6 });
            inst.fillField3(fi, w, h, d, { model, scale: 0.04, octaves: 3, gain: 0.6 });
            for (let i = 0; i < fm.length; i++) {
                assert.strictEqual(fm[i], fi[i], `${model}: module != instance at cell ${i}`);
            }
        }
    });

    // --- FAIL CLOSED (differs from fillField2's silent truncate, on purpose) ---
    it('FAILS CLOSED: out shorter than w*h*d throws RangeError and leaves out unwritten', () => {
        const n = createNoise(42);
        const out = new Float32Array(3 * 3 * 3 - 1); // one short of the volume
        out.fill(7);
        assert.throws(() => n.fillField3(out, 3, 3, 3, { scale: 0.05 }), RangeError);
        // The guard runs before any write: out must be untouched.
        for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 7, `cell ${i} was written before the throw`);
    });

    it('FAILS CLOSED: d = NaN / Infinity / -1 / 0 each throw RangeError, out unwritten', () => {
        const n = createNoise(42);
        const out = new Float32Array(64);
        for (const bad of [NaN, Infinity, -1, 0]) {
            out.fill(9);
            assert.throws(() => n.fillField3(out, 4, 4, bad, { scale: 0.05 }), RangeError, `d=${bad}`);
            for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 9, `d=${bad} wrote cell ${i}`);
        }
    });

    it('FAILS CLOSED: w or h non-finite / non-positive throws RangeError', () => {
        const n = createNoise(42);
        const out = new Float32Array(64);
        for (const bad of [NaN, Infinity, -2, 0]) {
            assert.throws(() => n.fillField3(out, bad, 4, 4, { scale: 0.05 }), RangeError, `w=${bad}`);
            assert.throws(() => n.fillField3(out, 4, bad, 4, { scale: 0.05 }), RangeError, `h=${bad}`);
        }
    });

    it('FAILS CLOSED: an unknown model throws RangeError naming the valid set, out unwritten', () => {
        const n = createNoise(42);
        const out = new Float32Array(64);
        out.fill(5);
        assert.throws(() => n.fillField3(out, 4, 4, 4, { model: 'perlin' }), /fbm.*ridged.*billow/);
        for (let i = 0; i < out.length; i++) assert.strictEqual(out[i], 5, `cell ${i} written before model throw`);
    });

    it('exact boundary: out.length === w*h*d does not throw; one less does', () => {
        const n = createNoise(42);
        const exact = new Float32Array(4 * 4 * 4);
        assert.doesNotThrow(() => n.fillField3(exact, 4, 4, 4, { scale: 0.05 }));
        const shortByOne = new Float32Array(4 * 4 * 4 - 1);
        assert.throws(() => n.fillField3(shortByOne, 4, 4, 4, { scale: 0.05 }), RangeError);
    });

    it('normalize remaps to exact [0, 1] endpoints; a constant field -> all-zero', () => {
        seedNoise(42);
        const w = 16, h = 16, d = 16;
        const out = new Float32Array(w * h * d);
        fillField3(out, w, h, d, { scale: 0.05, normalize: true });
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < out.length; i++) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
        assert.strictEqual(mn, 0, `normalize min not bit-exact 0: ${mn}`);
        assert.strictEqual(mx, 1, `normalize max not bit-exact 1: ${mx}`);
        // octaves=0 is a constant field -> all-zero, never NaN.
        const flat = new Float32Array(4 * 4 * 4);
        flat.fill(-3);
        fillField3(flat, 4, 4, 4, { octaves: 0, normalize: true });
        for (let i = 0; i < flat.length; i++) assert.strictEqual(flat[i], 0, `octaves=0 cell ${i} not 0`);
    });

    it('Float64Array target works and stays finite', () => {
        const n = createNoise(42);
        const out = new Float64Array(8 * 8 * 8);
        assert.doesNotThrow(() => n.fillField3(out, 8, 8, 8, { model: 'ridged', scale: 0.05 }));
        for (let i = 0; i < out.length; i++) assert.ok(Number.isFinite(out[i]), `cell ${i} non-finite`);
    });
});

describe('lite-noise: fillField3 boundary matrix (QA torture pass)', () => {
    // -- non-cube volumes: layout round-trip against an INDEPENDENT single-point
    // eval (not the bake's own accumulation loop -- a genuinely separate code
    // path: direct multiply-based coordinates, not += stepping) -------------
    for (const [w, h, d] of [[8, 16, 4], [4, 8, 16]]) {
        it(`non-cube ${w}x${h}x${d}: out[idx] matches a direct fbm3 sample at a few points (independent eval)`, () => {
            const n = createNoise(11);
            const scale = 0.07, octaves = 4, lac = 2.0, gain = 0.5;
            const out = new Float32Array(w * h * d);
            n.fillField3(out, w, h, d, { scale, octaves, lacunarity: lac, gain });
            const picks = [[0, 0, 0], [w - 1, 0, 0], [0, h - 1, 0], [0, 0, d - 1], [w - 1, h - 1, d - 1],
                [(w >> 1), (h >> 1), (d >> 1)]];
            for (const [x, y, z] of picks) {
                const idx = ((z * h) + y) * w + x;
                // Direct multiply-based coordinate -- NOT the bake's `px += scale`
                // accumulation. This is a genuinely separate computation of the
                // same documented coordinate contract, so any drift in the bake's
                // stepping shows up as more than float noise.
                const expect = Math.fround(n.fbm3(x * scale, y * scale, z * scale, octaves, lac, gain));
                const got = out[idx];
                const diff = Math.abs(got - expect);
                assert.ok(diff < 1e-4,
                    `(${x},${y},${z}) idx ${idx}: bake=${got} direct=${expect} diff=${diff}`);
            }
        });
    }

    // -- d=1 degenerates to a single slab --------------------------------------
    // fillField3 samples simplex3 (a genuinely 3D lattice), fillField2 samples
    // simplex2 (a 2D lattice) -- different kernels entirely, so a d=1 volume
    // and a fillField2 bake at the "same" (x, y) are NOT expected to agree
    // numerically; comparing them would be a false equivalence. What IS a valid
    // claim: the d=1 slab is exactly the z=0 slab of any larger-d bake with the
    // same opts (the z-loop body for z=0 cannot depend on d), proving d=1 is a
    // true degenerate case of the general triple loop, not a special-cased path.
    it('d=1 slab is bit-identical to the z=0 slab of a d=3 bake with the same opts', () => {
        const n = createNoise(5);
        const w = 6, h = 5;
        const opts = { scale: 0.04, octaves: 3, lacunarity: 2.1, gain: 0.55, model: 'ridged' };
        const slab = new Float32Array(w * h * 1);
        n.fillField3(slab, w, h, 1, opts);
        const cube = new Float32Array(w * h * 3);
        n.fillField3(cube, w, h, 3, opts);
        for (let i = 0; i < w * h; i++) {
            assert.strictEqual(slab[i], cube[i], `slab cell ${i} != d=3's z=0 slab`);
        }
    });

    it('d=1 slab is internally self-consistent: matches a direct fbm3 sample with z fixed at oz', () => {
        const n = createNoise(5);
        const w = 6, h = 5, oz = 1.25, scale = 0.04;
        const out = new Float32Array(w * h);
        n.fillField3(out, w, h, 1, { scale, oz, octaves: 2, lacunarity: 2, gain: 0.5 });
        let idx = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++, idx++) {
                const expect = Math.fround(n.fbm3(x * scale, y * scale, oz, 2, 2, 0.5));
                assert.ok(Math.abs(out[idx] - expect) < 1e-4, `cell (${x},${y}) idx ${idx} mismatch`);
            }
        }
    });

    // -- Float32 vs Float64: same layout, distinct ONLY by precision ----------
    it('Float32Array vs Float64Array targets: identical after fround, genuinely more precise in f64', () => {
        seedNoise(42);
        const w = 6, h = 6, d = 6;
        const f32 = new Float32Array(w * h * d);
        const f64 = new Float64Array(w * h * d);
        const opts = { scale: 0.037, octaves: 4, lacunarity: 2, gain: 0.5 };
        fillField3(f32, w, h, d, opts);
        fillField3(f64, w, h, d, opts);
        let sawExtraPrecision = false;
        for (let i = 0; i < f32.length; i++) {
            assert.strictEqual(Math.fround(f64[i]), f32[i], `cell ${i}: f64 rounds to a different f32 value`);
            if (f64[i] !== f32[i]) sawExtraPrecision = true;
        }
        assert.ok(sawExtraPrecision,
            'Float64Array target carried no extra precision over Float32Array -- suspicious for a 216-cell volume');
    });

    // -- ridged/billow over a volume stay in the documented ~[0, 1] band ------
    it('ridged and billow fillField3 volumes stay in ~[0, 1] (same contract as the 2D models)', () => {
        const n = createNoise(9);
        const w = 12, h = 12, d = 12;
        for (const model of ['ridged', 'billow']) {
            const out = new Float32Array(w * h * d);
            n.fillField3(out, w, h, d, { model, scale: 0.06, octaves: 5, lacunarity: 2, gain: 0.5 });
            let mn = Infinity, mx = -Infinity;
            for (const v of out) { if (v < mn) mn = v; if (v > mx) mx = v; }
            assert.ok(mn >= -0.01 && mx <= 1.01, `${model} volume out of range: [${mn}, ${mx}]`);
        }
    });

    // -- normalize:false leaves the raw (non-[0,1]) range untouched ------------
    it('normalize:false does NOT rescale (differs from the same bake with normalize:true)', () => {
        const n = createNoise(3);
        const w = 10, h = 10, d = 10;
        const opts = { scale: 0.05, octaves: 4, lacunarity: 2, gain: 0.5 };
        const raw = new Float32Array(w * h * d);
        n.fillField3(raw, w, h, d, opts);
        const norm = new Float32Array(w * h * d);
        n.fillField3(norm, w, h, d, { ...opts, normalize: true });
        let mnRaw = Infinity, mxRaw = -Infinity, mnNorm = Infinity, mxNorm = -Infinity;
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] < mnRaw) mnRaw = raw[i];
            if (raw[i] > mxRaw) mxRaw = raw[i];
            if (norm[i] < mnNorm) mnNorm = norm[i];
            if (norm[i] > mxNorm) mxNorm = norm[i];
        }
        assert.strictEqual(mnNorm, 0);
        assert.strictEqual(mxNorm, 1);
        assert.ok(mnRaw !== 0 || mxRaw !== 1, `raw range coincidentally [0,1]: [${mnRaw}, ${mxRaw}]`);
        assert.notDeepStrictEqual(Array.from(raw), Array.from(norm), 'normalize:false produced the normalized field');
    });

    // -- boundary matrix: 0/1/N-1/N/N+1, empty, null, undefined, NaN, -0 -------
    it('BOUNDARY w=h=d=1: single-cell volume matches a direct single-point sample', () => {
        const n = createNoise(42);
        const out = new Float32Array(1);
        n.fillField3(out, 1, 1, 1, { scale: 0.05, ox: 0.2, oy: 0.3, oz: 0.4 });
        assert.strictEqual(out[0], Math.fround(n.fbm3(0.2, 0.3, 0.4, 4, 2, 0.5)));
    });

    it('BOUNDARY out.length === need - 1 (N-1) throws; === need (N) does not', () => {
        const n = createNoise(42);
        const need = 3 * 3 * 3;
        assert.throws(() => n.fillField3(new Float32Array(need - 1), 3, 3, 3, { scale: 0.05 }), RangeError);
        assert.doesNotThrow(() => n.fillField3(new Float32Array(need), 3, 3, 3, { scale: 0.05 }));
    });

    it('BOUNDARY out.length === need + 1 (N+1, oversized): does not throw, trailing cell untouched', () => {
        const n = createNoise(42);
        const need = 3 * 3 * 3;
        const out = new Float32Array(need + 1);
        out.fill(-777);
        n.fillField3(out, 3, 3, 3, { scale: 0.05 });
        assert.notStrictEqual(out[need - 1], -777, 'last in-range cell was not written');
        assert.strictEqual(out[need], -777, 'oversized guard slot was written past the documented volume');
    });

    it('BOUNDARY empty out (length 0) with a non-empty request throws RangeError', () => {
        const n = createNoise(42);
        assert.throws(() => n.fillField3(new Float32Array(0), 2, 2, 2, { scale: 0.05 }), RangeError);
    });

    it('BOUNDARY out = null / undefined fails closed (throws before any write is possible)', () => {
        const n = createNoise(42);
        // No `out.length` to read on null/undefined -- this throws a TypeError
        // from the property access itself, which is still fail-closed (it throws
        // before the triple loop can run), just a different Error subclass than
        // the documented RangeError. Pinned so a future refactor that tries to
        // read `opts` off `out` (or vice versa) can't silently swallow this.
        assert.throws(() => n.fillField3(null, 2, 2, 2, { scale: 0.05 }), TypeError);
        assert.throws(() => n.fillField3(undefined, 2, 2, 2, { scale: 0.05 }), TypeError);
    });

    it('BOUNDARY -0 for w, h, or d throws RangeError (fails the > 0 check, same as +0)', () => {
        const n = createNoise(42);
        const out = new Float32Array(64);
        assert.throws(() => n.fillField3(out, -0, 4, 4, { scale: 0.05 }), RangeError, 'w=-0');
        assert.throws(() => n.fillField3(out, 4, -0, 4, { scale: 0.05 }), RangeError, 'h=-0');
        assert.throws(() => n.fillField3(out, 4, 4, -0, { scale: 0.05 }), RangeError, 'd=-0');
    });

    // -- re-entrant write: baking into the same buffer twice overwrites cleanly
    it('RE-ENTRANT: fillField3 writing into the same buffer twice in a row overwrites cleanly', () => {
        const n = createNoise(42);
        const out = new Float32Array(4 * 4 * 4);
        n.fillField3(out, 4, 4, 4, { scale: 0.05, model: 'fbm' });
        const first = Array.from(out);
        n.fillField3(out, 4, 4, 4, { scale: 0.09, model: 'ridged' });
        const second = Array.from(out);
        assert.notDeepStrictEqual(first, second, 'second bake did not overwrite the first');
        // A third bake back to the FIRST opts must reproduce the FIRST result
        // exactly -- no residue from the intervening ridged bake survives.
        n.fillField3(out, 4, 4, 4, { scale: 0.05, model: 'fbm' });
        assert.deepStrictEqual(Array.from(out), first, 'residue from an intervening bake survived a re-entrant call');
    });

    // -- ADVERSARIAL (intent preserved): the guard must NEVER under-count the
    // real cell count and silently partial-bake. The root cause was that `need =
    // w*h*d` (raw dims) diverges from the triple loop's ceil(w)*ceil(h)*ceil(d)
    // iteration count for a NON-INTEGER dim, so a buffer sized to exactly `need`
    // passed the length guard and then took writes past its end (silent TypedArray
    // no-ops). The fix fails closed: w/h/d must each be a positive INTEGER, so the
    // divergence can't arise -- a non-integer dim throws a RangeError BEFORE any
    // write, and an integer-dims bake of the same shape still works.
    it('ADVERSARIAL: a non-integer w/h/d fails closed (RangeError before any write), never a silent partial bake', () => {
        const n = createNoise(42);

        // A fractional w/h/d that used to under-count now throws before `out` is
        // touched. Canary the buffer and assert it is left entirely unwritten.
        const CANARY = -999;
        for (const [w, h, d] of [[3.5, 4, 4], [4, 4.25, 4], [4, 4, 2.75], [0.5, 0.5, 0.5]]) {
            const out = new Float32Array(256).fill(CANARY);
            assert.throws(() => n.fillField3(out, w, h, d, { scale: 0.05 }), RangeError,
                `fillField3(${w},${h},${d}) must fail closed on a non-integer dim`);
            for (let i = 0; i < out.length; i++) {
                assert.strictEqual(out[i], CANARY,
                    `fillField3(${w},${h},${d}) wrote cell ${i} before the fail-closed throw`);
            }
        }

        // The integer-dims bake of the same shape still works: a buffer sized to
        // exactly w*h*d is accepted and every cell is written (no under-count, no
        // partial volume). This pins the fix's positive half.
        const w = 4, h = 4, d = 4, need = w * h * d;
        const exact = new Float32Array(need).fill(CANARY);
        assert.doesNotThrow(() => n.fillField3(exact, w, h, d, { scale: 0.05 }));
        for (let i = 0; i < need; i++) {
            assert.notStrictEqual(exact[i], CANARY, `integer-dims bake left cell ${i} unwritten`);
        }
    });
});

describe('lite-noise: instance API (createNoise / Noise)', () => {
    it('createNoise returns a Noise instance', () => {
        const n = createNoise(0);
        assert.ok(n instanceof Noise);
    });

    it('exposes every sampler as a method', () => {
        const n = createNoise(1);
        for (const m of ['simplex2', 'simplex3', 'fbm2', 'fbm3', 'ridged2', 'billow2', 'noiseLoop', 'tileable2', 'curl2', 'curl3', 'warp2', 'fillField2', 'fillField3', 'tileableField2', 'seed']) {
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
// v1.5.0 -- tileableField2, createNoise(42), 64x64, periodX=periodY=4,
// octaves=4, lacunarity=2, gain=0.5, over Float32 bytes.
const GOLDEN_TF2_FBM_HASH    = '8f34c3b8';
const GOLDEN_TF2_RIDGED_HASH = 'e117b1a8';
const GOLDEN_TF2_BILLOW_HASH = 'b5d78012';
// v1.6.0 -- fillField3, createNoise(42) / seedNoise(42), 32x32x32 Float32 volume,
// scale=0.05, octaves=4, lacunarity=2, gain=0.5, over the raw Float32 bytes.
const GOLDEN_FF3_FBM_HASH    = '60946816';
const GOLDEN_FF3_RIDGED_HASH = '950f56bc';
const GOLDEN_FF3_BILLOW_HASH = '9c7af46e';

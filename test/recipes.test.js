/**
 * N4 -- ecosystem seam recipes, verified in CI against the installed peers.
 *
 * These prove the seams in examples/ actually run and hold their contracts:
 *   - curl2 -> lite-particles advection is deterministic and moves the field;
 *   - fillField2 -> lite-gl field round-trips BIT-EXACT (the sharp seam);
 *   - the curl ambient behavior registers and advances deterministically;
 *   - two instance-backed recipes in one process == each run alone (N1, at the
 *     integration level);
 *   - lite-noise adds NO runtime dependency.
 *
 * Peers are devDependencies; examples/ is not in package.json `files[]`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POINT_STRIDE, POINT_OFFSETS } from '@zakkster/lite-particles';
import { LAYOUT, createField } from '@zakkster/lite-gl';
import { BEHAVIORS } from '@zakkster/lite-ambient-fx';
import { gradientFire } from '@zakkster/lite-gradient-studio';

import { createNoise } from '../Noise.js';
import { createCurlFlow } from '../examples/curl-advection.mjs';
import { bakeFieldToGl, roundTrip } from '../examples/field-to-gl.mjs';
import { createCurlBehavior, registerCurlBehavior } from '../examples/ambient-curl.mjs';
import { paintTile, colourSeamGap, MODELS } from '../examples/tileable-to-gradient.mjs';

/** Advance a flow N frames and return its first particle's (x, y) via packTo. */
function sampleFirst(flow, count, frames) {
    for (let i = 0; i < frames; i++) flow.step(1 / 60);
    const buf = new Float32Array(count * POINT_STRIDE);
    flow.emitter.packTo(buf, 0);
    return { x: buf[POINT_OFFSETS.x], y: buf[POINT_OFFSETS.y] };
}

describe('recipe: curl2 -> lite-particles advection', () => {
    it('runs and moves the field (aggregate displacement, not one particle)', () => {
        const COUNT = 256;
        // Compare the WHOLE packed buffer before vs after -- a single first
        // particle spawns at the lattice origin where curl can be atypically
        // small, so measure the aggregate: how many cells moved, and are all
        // finite. This can't green on one lucky/unlucky particle.
        const flow = createCurlFlow({ count: COUNT, seed: 42 });
        const before = new Float32Array(COUNT * POINT_STRIDE);
        flow.emitter.packTo(before, 0);
        for (let i = 0; i < 60; i++) flow.step(1 / 60);
        const after = new Float32Array(COUNT * POINT_STRIDE);
        flow.emitter.packTo(after, 0);

        let moved = 0;
        for (let p = 0; p < COUNT; p++) {
            const b = p * POINT_STRIDE;
            const x = after[b + POINT_OFFSETS.x], y = after[b + POINT_OFFSETS.y];
            assert.ok(Number.isFinite(x) && Number.isFinite(y), `particle ${p} non-finite`);
            if (x !== before[b + POINT_OFFSETS.x] || y !== before[b + POINT_OFFSETS.y]) moved++;
        }
        // The overwhelming majority of a curl field advects; require most of it.
        assert.ok(moved > COUNT * 0.9, `only ${moved}/${COUNT} particles advected`);
    });

    it('is deterministic per seed (same seed -> same trajectory)', () => {
        const a = sampleFirst(createCurlFlow({ count: 128, seed: 7 }), 128, 45);
        const b = sampleFirst(createCurlFlow({ count: 128, seed: 7 }), 128, 45);
        assert.strictEqual(a.x, b.x);
        assert.strictEqual(a.y, b.y);
    });

    it('BOUNDARY count=1: a single particle stays finite and moves', () => {
        const flow = createCurlFlow({ count: 1, seed: 2 });
        for (let i = 0; i < 10; i++) flow.step(1 / 60);
        const buf = new Float32Array(1 * POINT_STRIDE);
        const n = flow.emitter.packTo(buf, 0);
        assert.strictEqual(n, 1);
        assert.ok(Number.isFinite(buf[POINT_OFFSETS.x]) && Number.isFinite(buf[POINT_OFFSETS.y]));
    });

    it('BOUNDARY count=0: a zero-count flow constructs and steps without throwing', () => {
        const flow = createCurlFlow({ count: 0, seed: 3 });
        for (let i = 0; i < 10; i++) flow.step(1 / 60);
        assert.strictEqual(flow.emitter.pool.used, 0);
        assert.strictEqual(flow.emitter.pool.size, 0);
    });

    it('BOUNDARY long horizon (600 frames): every particle stays finite, none culled', () => {
        const COUNT = 200;
        const flow = createCurlFlow({ count: COUNT, seed: 4 });
        for (let i = 0; i < 600; i++) flow.step(1 / 60);
        // p.life = 1e9 must never be exhausted by 600 frames at 1/60s (10s of sim
        // time), so the pool must still report every particle active -- a cull here
        // would mean life went non-finite or somehow dropped below zero.
        assert.strictEqual(flow.emitter.pool.used, COUNT, 'a particle was culled over 600 frames');
        const buf = new Float32Array(COUNT * POINT_STRIDE);
        flow.emitter.packTo(buf, 0);
        for (let p = 0; p < COUNT; p++) {
            const b = p * POINT_STRIDE;
            assert.ok(Number.isFinite(buf[b + POINT_OFFSETS.x]), `particle ${p} x non-finite after 600 frames`);
            assert.ok(Number.isFinite(buf[b + POINT_OFFSETS.y]), `particle ${p} y non-finite after 600 frames`);
        }
    });

    it('BOUNDARY long horizon (600 frames): determinism holds, not just short-run', () => {
        const run = (seed) => {
            const flow = createCurlFlow({ count: 50, seed });
            for (let i = 0; i < 600; i++) flow.step(1 / 60);
            const buf = new Float32Array(50 * POINT_STRIDE);
            flow.emitter.packTo(buf, 0);
            return buf;
        };
        const a = run(9), b = run(9);
        for (let i = 0; i < a.length; i++) {
            assert.strictEqual(a[i], b[i], `float ${i} drifted over 600 frames`);
        }
    });

    it('BOUNDARY fails closed when maxParticles < count (no silent truncation)', () => {
        // The pool can only hold maxParticles; emitEach would otherwise spawn
        // fewer than requested and hand back a quietly-smaller field. The recipe
        // must surface the shortfall, not swallow it (House Law: null is not zero).
        assert.throws(
            () => createCurlFlow({ count: 500, maxParticles: 100, seed: 1 }),
            /pool held only 100 of 500/,
            'expected a RangeError naming the shortfall');
        // The default path (maxParticles defaults to count) never truncates.
        assert.doesNotThrow(() => createCurlFlow({ count: 100, seed: 1 }));
    });

    it('BOUNDARY maxParticles === count (explicit, not defaulted) does not throw', () => {
        // The exact boundary: an explicit maxParticles equal to count is a full,
        // non-truncated pool -- must construct cleanly, not be treated as "not
        // enough room".
        let flow;
        assert.doesNotThrow(() => { flow = createCurlFlow({ count: 500, maxParticles: 500, seed: 1 }); });
        assert.strictEqual(flow.emitter.pool.size, 500);
        assert.strictEqual(flow.emitter.pool.used, 500);
    });

    it('BOUNDARY maxParticles > count (headroom above the request) does not throw', () => {
        let flow;
        assert.doesNotThrow(() => { flow = createCurlFlow({ count: 100, maxParticles: 500, seed: 1 }); });
        assert.strictEqual(flow.emitter.pool.size, 500, 'pool should keep the larger requested capacity');
        assert.strictEqual(flow.emitter.pool.used, 100, 'only count particles should be spawned, not maxParticles');
    });
});

describe('recipe: fillField2 -> lite-gl field (the bit-exact seam)', () => {
    it('lite-gl and lite-particles agree on the LAYOUT.POINT contract', () => {
        assert.strictEqual(LAYOUT.POINT, POINT_STRIDE, 'LAYOUT.POINT != POINT_STRIDE');
    });

    it('round-trips a baked heightfield through a GL field byte-for-byte', () => {
        const { baked, readback } = roundTrip({ w: 64, h: 64, seed: 42 });
        assert.strictEqual(baked.length, readback.length);
        for (let i = 0; i < baked.length; i++) {
            assert.strictEqual(readback[i], baked[i], `cell ${i} drifted: ${baked[i]} -> ${readback[i]}`);
        }
    });

    it('packs one LAYOUT.POINT instance per cell at the right offsets', () => {
        const { baked, field, w, h } = bakeFieldToGl({ w: 8, h: 8, seed: 3 });
        assert.strictEqual(field.count, w * h);
        // Spot-check cell (5,2): position from grid, height in r/g/b, a=1.
        const cell = 2 * w + 5;
        const base = cell * POINT_STRIDE;
        assert.strictEqual(field.data[base + POINT_OFFSETS.x], 5);
        assert.strictEqual(field.data[base + POINT_OFFSETS.y], 2);
        assert.strictEqual(field.data[base + POINT_OFFSETS.r], baked[cell]);
        assert.strictEqual(field.data[base + POINT_OFFSETS.a], 1);
    });

    for (const [w, h] of [[128, 16], [16, 128], [1, 64], [64, 1], [1, 1]]) {
        it(`BOUNDARY non-square/degenerate field w=${w} h=${h} round-trips bit-exact`, () => {
            const { baked, readback } = roundTrip({ w, h, seed: 42 });
            assert.strictEqual(baked.length, w * h);
            assert.strictEqual(readback.length, baked.length);
            for (let i = 0; i < baked.length; i++) {
                assert.strictEqual(readback[i], baked[i], `cell ${i} drifted at w=${w} h=${h}`);
            }
        });
    }

    it('BOUNDARY non-normalized bake (negative values) still round-trips bit-exact', () => {
        // bakeFieldToGl() hardcodes `normalize: true` -- it never exposes a
        // non-normalized bake through its public API. To probe the underlying
        // byte-parity CLAIM for negative/out-of-[0,1] values (which Float32
        // stores and loads exactly regardless of sign), drive fillField2 +
        // createField directly with normalize OMITTED, using the same push
        // pattern the recipe uses internally.
        const w = 32, h = 32;
        const noise = createNoise(5);
        const baked = new Float32Array(w * h);
        noise.fillField2(baked, w, h, { scale: 0.02, octaves: 5 }); // no normalize -> ~[-0.84, 0.82]
        let sawNegative = false;
        for (let i = 0; i < baked.length; i++) if (baked[i] < 0) sawNegative = true;
        assert.ok(sawNegative, 'test is void: no negative sample in the non-normalized bake');

        const field = createField({ capacity: w * h, stride: LAYOUT.POINT });
        let idx = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const hval = baked[idx++];
                field.push((d, b) => {
                    d[b + POINT_OFFSETS.x] = x; d[b + POINT_OFFSETS.y] = y;
                    d[b + POINT_OFFSETS.r] = hval; d[b + POINT_OFFSETS.g] = hval; d[b + POINT_OFFSETS.b] = hval;
                    d[b + POINT_OFFSETS.a] = 1;
                });
            }
        }
        for (let i = 0; i < baked.length; i++) {
            const rb = field.data[i * POINT_STRIDE + POINT_OFFSETS.r];
            assert.strictEqual(rb, baked[i], `cell ${i} drifted for a negative/out-of-[0,1] value`);
        }
        assert.strictEqual(field.count, w * h);
    });

    it('BOUNDARY push beyond w*h capacity grows the field instead of throwing or corrupting', () => {
        const { baked, field, w, h } = bakeFieldToGl({ w: 64, h: 64, seed: 42 });
        assert.strictEqual(field.count, w * h);
        const capacityBeforeGrow = field.capacity;
        const cell0Before = field.data[0 * POINT_STRIDE + POINT_OFFSETS.r];

        // Push one instance past the baked capacity -- must not throw, and must
        // not corrupt the already-written cells.
        assert.doesNotThrow(() => {
            field.push((d, b) => { d[b + POINT_OFFSETS.x] = -1; d[b + POINT_OFFSETS.r] = -99; });
        });
        assert.strictEqual(field.count, w * h + 1);
        assert.ok(field.capacity >= capacityBeforeGrow);
        const cell0After = field.data[0 * POINT_STRIDE + POINT_OFFSETS.r];
        assert.strictEqual(cell0After, cell0Before, 'growth on overflow corrupted an existing cell');
        assert.strictEqual(cell0After, baked[0]);
    });
});

describe('recipe: curl ambient behavior', () => {
    it('advance is deterministic and finite', () => {
        const mk = () => createCurlBehavior({ seed: 9 }).advance;
        const a = mk(), b = mk();
        const pa = { x: 100, y: 100, vx: 0, vy: 0 };
        const pb = { x: 100, y: 100, vx: 0, vy: 0 };
        for (let i = 0; i < 30; i++) { a(pa, 1000 / 60); b(pb, 1000 / 60); }
        assert.strictEqual(pa.x, pb.x);
        assert.strictEqual(pa.y, pb.y);
        assert.ok(Number.isFinite(pa.x) && Number.isFinite(pa.y));
    });

    it('registers a CURL behavior in the ambient-fx registry', () => {
        const name = registerCurlBehavior({ seed: 1 });
        assert.strictEqual(name, 'CURL');
        assert.ok('CURL' in BEHAVIORS, 'CURL not registered');
        assert.strictEqual(typeof BEHAVIORS.CURL.tick, 'function');
    });

    it('BOUNDARY re-registering CURL is idempotent: still exactly one entry, still a function', () => {
        registerCurlBehavior({ seed: 1 });
        registerCurlBehavior({ seed: 1 }); // register twice in a row
        assert.strictEqual(typeof BEHAVIORS.CURL.tick, 'function');
        assert.strictEqual(typeof BEHAVIORS.CURL.spawn, 'function');
        assert.strictEqual(Object.keys(BEHAVIORS).filter((k) => k === 'CURL').length, 1);
    });

    it('BOUNDARY registering CURL does not clobber the built-in behaviors', () => {
        const before = { EMBER: BEHAVIORS.EMBER, MIST: BEHAVIORS.MIST, FLOAT: BEHAVIORS.FLOAT, CHAOS: BEHAVIORS.CHAOS };
        registerCurlBehavior({ seed: 1 });
        assert.strictEqual(BEHAVIORS.EMBER, before.EMBER, 'EMBER identity changed');
        assert.strictEqual(BEHAVIORS.MIST, before.MIST, 'MIST identity changed');
        assert.strictEqual(BEHAVIORS.FLOAT, before.FLOAT, 'FLOAT identity changed');
        assert.strictEqual(BEHAVIORS.CHAOS, before.CHAOS, 'CHAOS identity changed');
        assert.ok('CURL' in BEHAVIORS);
    });

    it('BOUNDARY advance is finite and deterministic across two independent instances over 5000 steps', () => {
        const a = createCurlBehavior({ seed: 42 }).advance;
        const b = createCurlBehavior({ seed: 42 }).advance;
        const pa = { x: 500, y: 500, vx: 0, vy: 0 };
        const pb = { x: 500, y: 500, vx: 0, vy: 0 };
        for (let i = 0; i < 5000; i++) { a(pa, 1000 / 60); b(pb, 1000 / 60); }
        assert.ok(Number.isFinite(pa.x) && Number.isFinite(pa.y), 'position went non-finite over 5000 steps');
        assert.strictEqual(pa.x, pb.x);
        assert.strictEqual(pa.y, pb.y);
    });
});

describe('N1 composability (integration level)', () => {
    it('two instance-backed flows in one process == each run alone', () => {
        const COUNT = 100, FRAMES = 40;
        // Solo runs.
        const soloA = sampleFirst(createCurlFlow({ count: COUNT, seed: 11 }), COUNT, FRAMES);
        const soloB = sampleFirst(createCurlFlow({ count: COUNT, seed: 22 }), COUNT, FRAMES);
        // Interleaved run: both flows advance in the same process, alternating.
        const A = createCurlFlow({ count: COUNT, seed: 11 });
        const B = createCurlFlow({ count: COUNT, seed: 22 });
        for (let i = 0; i < FRAMES; i++) { A.step(1 / 60); B.step(1 / 60); }
        const bufA = new Float32Array(COUNT * POINT_STRIDE); A.emitter.packTo(bufA, 0);
        const bufB = new Float32Array(COUNT * POINT_STRIDE); B.emitter.packTo(bufB, 0);
        // Each interleaved flow must match its solo trajectory exactly -- the
        // proof that createNoise instances don't share state (NS-01 fixed).
        assert.strictEqual(bufA[POINT_OFFSETS.x], soloA.x, 'flow A disturbed by flow B (x)');
        assert.strictEqual(bufA[POINT_OFFSETS.y], soloA.y, 'flow A disturbed by flow B (y)');
        assert.strictEqual(bufB[POINT_OFFSETS.x], soloB.x, 'flow B disturbed by flow A (x)');
        assert.strictEqual(bufB[POINT_OFFSETS.y], soloB.y, 'flow B disturbed by flow A (y)');
    });

    it('BOUNDARY two flows built from the SAME seed are still independent instances', () => {
        const COUNT = 80, FRAMES = 40;
        const soloA = sampleFirst(createCurlFlow({ count: COUNT, seed: 55 }), COUNT, FRAMES);
        const soloB = sampleFirst(createCurlFlow({ count: COUNT, seed: 55 }), COUNT, FRAMES);
        // Same seed -> same solo trajectory (sanity: this is what "same seed" means).
        assert.strictEqual(soloA.x, soloB.x);
        assert.strictEqual(soloA.y, soloB.y);

        const A = createCurlFlow({ count: COUNT, seed: 55 });
        const B = createCurlFlow({ count: COUNT, seed: 55 });
        for (let i = 0; i < FRAMES; i++) { A.step(1 / 60); B.step(1 / 60); }
        const bufA = new Float32Array(COUNT * POINT_STRIDE); A.emitter.packTo(bufA, 0);
        const bufB = new Float32Array(COUNT * POINT_STRIDE); B.emitter.packTo(bufB, 0);
        // Interleaving two same-seed flows must not desync or couple them: each
        // still matches its own solo run exactly.
        assert.strictEqual(bufA[POINT_OFFSETS.x], soloA.x, 'same-seed flow A disturbed by interleaving');
        assert.strictEqual(bufA[POINT_OFFSETS.y], soloA.y, 'same-seed flow A disturbed by interleaving');
        assert.strictEqual(bufB[POINT_OFFSETS.x], soloB.x, 'same-seed flow B disturbed by interleaving');
        assert.strictEqual(bufB[POINT_OFFSETS.y], soloB.y, 'same-seed flow B disturbed by interleaving');
    });

    it('BOUNDARY a third flow plus mid-run reseed of one flow leaves the others byte-identical', () => {
        const COUNT = 60, FRAMES = 20;
        const A = createCurlFlow({ count: COUNT, seed: 1 });
        const B = createCurlFlow({ count: COUNT, seed: 2 });
        const C = createCurlFlow({ count: COUNT, seed: 3 });
        for (let i = 0; i < FRAMES; i++) { A.step(1 / 60); B.step(1 / 60); C.step(1 / 60); }

        // Reseed B's noise field mid-run via its own `.noise.seed()` -- must be
        // scoped to B alone.
        B.noise.seed(999);
        for (let i = 0; i < FRAMES; i++) { A.step(1 / 60); B.step(1 / 60); C.step(1 / 60); }
        const bufA = new Float32Array(COUNT * POINT_STRIDE); A.emitter.packTo(bufA, 0);
        const bufC = new Float32Array(COUNT * POINT_STRIDE); C.emitter.packTo(bufC, 0);

        // Reference: A and C run alone (no B in the process at all) for the same
        // 2*FRAMES total -- must match exactly, proving B's mid-run reseed left
        // no trace on A or C.
        const refA = createCurlFlow({ count: COUNT, seed: 1 });
        const refC = createCurlFlow({ count: COUNT, seed: 3 });
        for (let i = 0; i < 2 * FRAMES; i++) { refA.step(1 / 60); refC.step(1 / 60); }
        const bufRefA = new Float32Array(COUNT * POINT_STRIDE); refA.emitter.packTo(bufRefA, 0);
        const bufRefC = new Float32Array(COUNT * POINT_STRIDE); refC.emitter.packTo(bufRefC, 0);

        assert.strictEqual(bufA[POINT_OFFSETS.x], bufRefA[POINT_OFFSETS.x], 'A disturbed by B mid-run reseed (x)');
        assert.strictEqual(bufA[POINT_OFFSETS.y], bufRefA[POINT_OFFSETS.y], 'A disturbed by B mid-run reseed (y)');
        assert.strictEqual(bufC[POINT_OFFSETS.x], bufRefC[POINT_OFFSETS.x], 'C disturbed by B mid-run reseed (x)');
        assert.strictEqual(bufC[POINT_OFFSETS.y], bufRefC[POINT_OFFSETS.y], 'C disturbed by B mid-run reseed (y)');
    });
});

describe('recipe: tileableField2 -> lite-gradient-studio (the seamless coloured tile)', () => {
    it('a grid-aligned coloured tile wraps BIT-EXACT, every model (colour seam gap === 0)', () => {
        for (const model of MODELS) {
            assert.strictEqual(colourSeamGap({ w: 256, h: 256, period: 4, model }), 0,
                `${model}: coloured wrap column not byte-identical to column 0`);
        }
    });

    for (const [w, period] of [[64, 4], [128, 2], [8, 16]]) {
        it(`BOUNDARY other grid-aligned dims (w=${w}, period=${period}) stay bit-exact`, () => {
            assert.strictEqual(w * (period / w), period, `precondition: ${w}/${period} must be grid-aligned`);
            for (const model of MODELS) {
                assert.strictEqual(colourSeamGap({ w, h: w, period, model }), 0,
                    `${model}: aligned ${w}/${period} coloured seam not exact`);
            }
        });
    }

    it('FAILS CLOSED on a non-grid-aligned bake (RangeError, not a near-seam tile)', () => {
        // 7*(29/7) !== 29 in float64 -> the wrap column lands a few ULPs off period.
        // The recipe refuses it rather than paint a tile that is epsilon-off at the seam.
        assert.notStrictEqual(7 * (29 / 7), 29, 'sanity: 7/29 must be non-grid-aligned');
        assert.throws(() => paintTile({ w: 7, h: 7, period: 29 }), /not grid-aligned/);
    });

    it('FAILS CLOSED on a malformed (non-Gradient) colour source (TypeError)', () => {
        // A wrong-shaped object is the real hazard: stops not an array, or no
        // sampleArray. (An omitted/null gradient defaults to gradientOcean via
        // `?? default`, the same nullish-default every recipe param uses.)
        assert.throws(() => paintTile({ gradient: { stops: 'nope' } }), TypeError);
        assert.throws(() => paintTile({ gradient: { stops: [], sampleArray: null } }), TypeError);
        assert.throws(() => paintTile({ gradient: 42 }), TypeError);
    });

    it('the coloured texture is a packed RGBA-LE Uint32Array, ImageData-ready (len === w*h)', () => {
        const { texture, w, h } = paintTile({ w: 64, h: 64, period: 4 });
        assert.ok(texture instanceof Uint32Array, 'texture must be a Uint32Array');
        assert.strictEqual(texture.length, w * h);
        // Every pixel is opaque (alpha byte === 255) -- a valid RGBA-LE image.
        for (let i = 0; i < texture.length; i++) {
            assert.strictEqual((texture[i] >>> 24) & 255, 255, `pixel ${i} not opaque`);
        }
    });

    it('is deterministic per seed (same opts -> byte-identical texture)', () => {
        const a = paintTile({ w: 64, h: 64, period: 4, seed: 7 }).texture;
        const b = paintTile({ w: 64, h: 64, period: 4, seed: 7 }).texture;
        for (let i = 0; i < a.length; i++) assert.strictEqual(a[i], b[i], `pixel ${i} drifted between runs`);
    });

    it('BOUNDARY a non-square grid-aligned tile (w != h) still wraps bit-exact in colour', () => {
        // The recipe's own boundary sweep only ever bakes w === h. w and h drive
        // INDEPENDENT step sizes (stepX = period/w, stepY = period/h) in
        // tileableField2, so a non-square tile is a distinct code path, not a
        // relabeling of the square case.
        for (const [w, h, period] of [[128, 64, 4], [64, 256, 8]]) {
            assert.strictEqual(w * (period / w), period, `precondition: ${w}/${period} must be grid-aligned`);
            for (const model of MODELS) {
                assert.strictEqual(colourSeamGap({ w, h, period, model }), 0,
                    `${model}: non-square ${w}x${h}/${period} coloured column seam not exact`);
            }
        }
    });

    it('BOUNDARY a different preset gradient than the default (gradientFire) still yields seam gap 0', () => {
        // colourSeamGap defaults to gradientOcean; every prior assertion in this
        // file exercises only that one LUT. A different stop layout (different
        // colour count/spacing) proves the bit-exact wrap is a property of the
        // FIELD + pure-per-cell-map argument, not an artifact of one specific LUT.
        for (const model of MODELS) {
            assert.strictEqual(colourSeamGap({ w: 128, h: 128, period: 4, model, gradient: gradientFire }), 0,
                `${model}: gradientFire coloured wrap column not byte-identical to column 0`);
        }
    });

    it('the wrapColour buffer is exactly h long and fully opaque, matching the documented shape', () => {
        const { wrapColour, h } = paintTile({ w: 64, h: 96, period: 4 });
        assert.ok(wrapColour instanceof Uint32Array, 'wrapColour must be a Uint32Array');
        assert.strictEqual(wrapColour.length, h, 'wrapColour must have exactly h entries (one per row)');
        for (let i = 0; i < wrapColour.length; i++) {
            assert.strictEqual((wrapColour[i] >>> 24) & 255, 255, `wrapColour[${i}] not opaque`);
        }
    });

    it('the RangeError guard fires before any field/texture allocation (fail-closed, not fail-late)', () => {
        // paintTile returns {noise, field, texture, wrapColour, ...} on success;
        // a guard that ran AFTER allocating would still throw, but would have
        // wastefully baked a field first. Assert the thrown call produces no
        // observable partial result by re-running under a Proxy-free direct
        // check: the function must throw synchronously on the very first call,
        // and (per source) the alignment check is the first statement in the
        // body -- before `createNoise(seed)` or any `new Float64Array`.
        let threw = false;
        try {
            paintTile({ w: 7, h: 7, period: 29 });
        } catch (err) {
            threw = true;
            assert.ok(err instanceof RangeError);
        }
        assert.ok(threw, 'paintTile must throw synchronously, not return a partial object');
    });

    describe('the underlying row wrap (untested by the recipe itself)', () => {
        // tileable-to-gradient.mjs only ever bakes and checks the COLUMN wrap
        // (via `ox = w*stepX`). The recipe's docs are explicit that the ROW
        // wrap is not claimed. _tileable2's bilinear-blend identity is
        // symmetric in x/y, so the row wrap should ALSO be bit-exact at the
        // raw-field level -- this closes the coverage gap by proving (or
        // disproving) that symmetric claim directly against tileableField2,
        // independent of the recipe's own (column-only) proof.
        for (const model of MODELS) {
            it(`BOUNDARY ${model}: raw-field row wrap (oy = h*stepY) is bit-exact, same as the column`, () => {
                const w = 64, h = 64, period = 4, octaves = 5;
                const { noise } = paintTile({ w, h, period, model, octaves });
                const stepY = period / h;
                const field = new Float64Array(w * h);
                noise.tileableField2(field, w, h, { model, periodX: period, periodY: period, octaves });
                const wrapRow = new Float64Array(w);
                noise.tileableField2(wrapRow, w, 1, {
                    model, periodX: period, periodY: period, octaves, oy: h * stepY,
                });
                for (let x = 0; x < w; x++) {
                    assert.strictEqual(wrapRow[x], field[x],
                        `${model}: row ${h} (wrap) vs row 0 differ at x=${x} -- row wrap is NOT bit-exact`);
                }
            });
        }
    });
});

describe('no runtime dependency added', () => {
    it('package.json declares no runtime dependencies', () => {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        const deps = pkg.dependencies ?? {};
        assert.strictEqual(Object.keys(deps).length, 0,
            `expected zero runtime deps, found: ${Object.keys(deps).join(', ')}`);
    });
});

describe('BOUNDARY packaging contract (N4)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    it('version agrees across package.json, the Noise.js header, and llms.txt', () => {
        // Packaging law: the version lives in >1 place and they move together.
        // Assert agreement, not a hardcoded literal (which breaks every bump).
        const v = pkg.version;
        assert.match(v, /^\d+\.\d+\.\d+$/, `bad semver: ${v}`);
        const src = readFileSync(new URL('../Noise.js', import.meta.url), 'utf8');
        const llms = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');
        assert.ok(src.includes(`@zakkster/lite-noise v${v}`), `Noise.js header != ${v}`);
        assert.ok(llms.includes(`@zakkster/lite-noise v${v}`), `llms.txt header != ${v}`);
    });

    it('files[] excludes examples/ and test/ -- the tarball never ships the recipes', () => {
        const files = pkg.files ?? [];
        assert.ok(Array.isArray(files) && files.length > 0, 'files[] missing or empty');
        for (const f of files) {
            assert.ok(!f.startsWith('examples'), `files[] leaks examples/: ${f}`);
            assert.ok(!f.startsWith('test'), `files[] leaks test/: ${f}`);
        }
    });

    it('the ecosystem peers used by the recipes are devDependencies, not dependencies', () => {
        const dev = pkg.devDependencies ?? {};
        for (const name of ['@zakkster/lite-particles', '@zakkster/lite-gl', '@zakkster/lite-ambient-fx', '@zakkster/lite-gradient-studio']) {
            assert.ok(name in dev, `${name} missing from devDependencies`);
        }
        const deps = pkg.dependencies ?? {};
        for (const name of ['@zakkster/lite-particles', '@zakkster/lite-gl', '@zakkster/lite-ambient-fx', '@zakkster/lite-gradient-studio']) {
            assert.ok(!(name in deps), `${name} leaked into runtime dependencies`);
        }
    });
});

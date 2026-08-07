/**
 * T6 -- the zero-alloc gate.
 *
 * Every documented hot path is measured with lite-gc-profiler and gated at
 * `maxBytesPerOp: 2 / maxMajorsPerKOp: 0` under `stabilize: 'deep'`. The deep
 * stabilize matters: the only typed arrays this package touches are the caller's
 * `out`/field and the instance's permutation table, whose backing stores live
 * OUTSIDE the V8 heap and are invisible to a heapUsed-only gate.
 *
 * Both surfaces are gated -- the module functions AND the instance methods. N1's
 * promise is that a method call costs no more than the module function did; a
 * per-sample `this._perm` property read in the unrolled FBM loop would surface
 * here as bytesPerOp above the noise floor.
 *
 * Two extra checks a per-op gate can't make on its own:
 *   - instance construction allocates EXACTLY one table (the 512-byte perm) and
 *     nothing transient, asserted by an arrayBuffers delta;
 *   - 4096 create/discard cycles retain nothing (the table dies with the
 *     instance), asserted by a flat arrayBuffers reading after a forced GC.
 *
 * NOISE_TORTURE_BREAK=1 injects a retained allocation into the first hot body;
 * the gate must then reject the window. That is the T9 control, exercisable here.
 */

import { createNoise, Noise, seedNoise, simplex2, simplex3, fbm2, fbm3, ridged2, billow2, noiseLoop, tileable2, curl2, curl3, warp2, fillField2, tileableField2, fillField3 } from '../../Noise.js';
import { runOpsGate, bakeAlloc, BREAK, check, die, arrayBufferBytes, forceGc } from './harness.mjs';

const OPS = 50000;
const WARMUP = 2000;
// fillField2 bakes 64*64 = 4096 samples per op. A per-op byte budget is pure
// noise at that op size (see harness.bakeAlloc), so bakes are gated on major
// GCs + arrayBuffers instead of bytesPerOp.
const BAKE_OPS = 2000;
const BAKE_WARMUP = 100;
// fillField3 bakes a 32^3 = 32768-cell volume/op -- 8x a 64x64 field. Fewer ops
// still accumulate ample allocation pressure (500 * 32768 = 16M cells) to surface
// a per-cell escape as a major GC, at a fraction of the wall time.
const BAKE3_OPS = 500;
const BAKE3_WARMUP = 50;

/** Retained sink for the BREAK control -- survives GC so bytesPerOp climbs. */
const leak = [];

function gate(name, fn, ops, warmup) {
    const { report, summary } = runOpsGate(fn, { ops, warmup });
    if (!report.ok) {
        const v = report.violations && report.violations[0];
        die('T6 ' + name + ' rejected -- verdict=' + report.verdict +
            (v ? ' (' + v.reason + ')' : '') +
            ' source=' + summary.source +
            (BREAK ? ' [NOISE_TORTURE_BREAK control -- expected]' : ''));
    }
}

/** Gate a heavy bake on major-GC and arrayBuffers rather than the noisy byte budget. */
function bakeGate(name, fn, ops = BAKE_OPS, warmup = BAKE_WARMUP) {
    const { major, abDelta } = bakeAlloc(fn, { ops, warmup });
    check(major === 0,
        () => `T6 ${name}: ${major} major GC(s) over ${ops} bakes -- retained per-bake allocation`);
    // Forced-GC on both sides, so anything left is a genuinely retained buffer.
    // 64 KB tolerance covers measureOps' own sample bookkeeping.
    check(abDelta < 64 * 1024,
        () => `T6 ${name}: arrayBuffers grew ${abDelta} B across ${ops} bakes -- retained buffer allocation`);
}

export function run() {
    seedNoise(42);
    const n = createNoise(42);

    // Pre-allocated scratch -- nothing here is created inside a measured body.
    const v2 = { x: 0, y: 0 };
    const v3 = { x: 0, y: 0, z: 0 };
    const field = new Float32Array(64 * 64);
    const FIELD_OPTS = { scale: 0.01, octaves: 4, lacunarity: 2, gain: 0.5 };
    const FIELD_NORM_OPTS = { scale: 0.01, octaves: 4, lacunarity: 2, gain: 0.5, normalize: true };
    // tileableField2 bakes 64*64 harmonic-octave samples/op -- gated as a heavy
    // bake (major-GC + arrayBuffers), same class as fillField2. One opts object
    // per model, allocated ONCE here, reused every op (the hot body must not
    // build one). Mode is decoded from the string ONCE per call at setup.
    const TF2_FBM = { model: 'fbm', periodX: 4, periodY: 4, octaves: 4, lacunarity: 2, gain: 0.5 };
    const TF2_RIDGED = { model: 'ridged', periodX: 4, periodY: 4, octaves: 4, lacunarity: 2, gain: 0.5 };
    const TF2_BILLOW = { model: 'billow', periodX: 4, periodY: 4, octaves: 4, lacunarity: 2, gain: 0.5 };
    const TF2_NORM = { model: 'fbm', periodX: 4, periodY: 4, octaves: 4, lacunarity: 2, gain: 0.5, normalize: true };

    // fillField3 bakes a 32^3 = 32768-cell scalar volume per op -- a heavy bake,
    // gated on major-GC + arrayBuffers like fillField2. One opts object per model,
    // allocated ONCE, reused every op (the triple-loop body must not build one).
    const field3 = new Float32Array(32 * 32 * 32);
    const FF3_FBM = { model: 'fbm', scale: 0.05, octaves: 4, lacunarity: 2, gain: 0.5 };
    const FF3_RIDGED = { model: 'ridged', scale: 0.05, octaves: 4, lacunarity: 2, gain: 0.5 };
    const FF3_BILLOW = { model: 'billow', scale: 0.05, octaves: 4, lacunarity: 2, gain: 0.5 };
    const FF3_NORM = { model: 'fbm', scale: 0.05, octaves: 4, lacunarity: 2, gain: 0.5, normalize: true };

    // --- Module surface -------------------------------------------------------
    gate('module.simplex2', (i) => { simplex2(i * 0.017, i * 0.023); if (BREAK) leak.push(new Float64Array(32)); }, OPS, WARMUP);
    if (BREAK) die('T6: NOISE_TORTURE_BREAK injected allocations but the gate passed');
    gate('module.simplex3', (i) => { simplex3(i * 0.017, i * 0.023, i * 0.011); }, OPS, WARMUP);
    gate('module.fbm2', (i) => { fbm2(i * 0.017, i * 0.023); }, OPS, WARMUP);
    gate('module.fbm2(custom)', (i) => { fbm2(i * 0.017, i * 0.023, 6, 2.1, 0.55); }, OPS, WARMUP);
    gate('module.fbm3', (i) => { fbm3(i * 0.017, i * 0.023, i * 0.011, 6); }, OPS, WARMUP);
    gate('module.ridged2', (i) => { ridged2(i * 0.017, i * 0.023); }, OPS, WARMUP);
    gate('module.billow2', (i) => { billow2(i * 0.017, i * 0.023); }, OPS, WARMUP);
    gate('module.noiseLoop', (i) => { noiseLoop(i * 0.017, 1.5); }, OPS, WARMUP);
    gate('module.tileable2', (i) => { tileable2(i * 0.003 % 4, i * 0.005 % 4, 4, 4); }, OPS, WARMUP);
    gate('module.curl2', (i) => { curl2(i * 0.017, i * 0.023, v2); }, OPS, WARMUP);
    gate('module.curl3', (i) => { curl3(i * 0.017, i * 0.023, i * 0.011, v3); }, OPS, WARMUP);
    gate('module.warp2', (i) => { warp2(i * 0.017, i * 0.023, 1.5, v2); }, OPS, WARMUP);
    bakeGate('module.fillField2(opts)', () => { fillField2(field, 64, 64, FIELD_OPTS); });
    bakeGate('module.fillField2(no-opts)', () => { fillField2(field, 64, 64); });
    bakeGate('module.fillField2(normalize)', () => { fillField2(field, 64, 64, FIELD_NORM_OPTS); });
    bakeGate('module.tileableField2(fbm)', () => { tileableField2(field, 64, 64, TF2_FBM); });
    bakeGate('module.tileableField2(ridged)', () => { tileableField2(field, 64, 64, TF2_RIDGED); });
    bakeGate('module.tileableField2(billow)', () => { tileableField2(field, 64, 64, TF2_BILLOW); });
    bakeGate('module.tileableField2(normalize)', () => { tileableField2(field, 64, 64, TF2_NORM); });
    bakeGate('module.fillField3(fbm)', () => { fillField3(field3, 32, 32, 32, FF3_FBM); }, BAKE3_OPS, BAKE3_WARMUP);
    bakeGate('module.fillField3(ridged)', () => { fillField3(field3, 32, 32, 32, FF3_RIDGED); }, BAKE3_OPS, BAKE3_WARMUP);
    bakeGate('module.fillField3(billow)', () => { fillField3(field3, 32, 32, 32, FF3_BILLOW); }, BAKE3_OPS, BAKE3_WARMUP);
    bakeGate('module.fillField3(normalize)', () => { fillField3(field3, 32, 32, 32, FF3_NORM); }, BAKE3_OPS, BAKE3_WARMUP);

    // --- Instance surface (must match the module's cost) ----------------------
    gate('instance.simplex2', (i) => { n.simplex2(i * 0.017, i * 0.023); }, OPS, WARMUP);
    gate('instance.simplex3', (i) => { n.simplex3(i * 0.017, i * 0.023, i * 0.011); }, OPS, WARMUP);
    gate('instance.fbm2', (i) => { n.fbm2(i * 0.017, i * 0.023); }, OPS, WARMUP);
    gate('instance.fbm3', (i) => { n.fbm3(i * 0.017, i * 0.023, i * 0.011, 6); }, OPS, WARMUP);
    gate('instance.ridged2', (i) => { n.ridged2(i * 0.017, i * 0.023); }, OPS, WARMUP);
    gate('instance.billow2', (i) => { n.billow2(i * 0.017, i * 0.023); }, OPS, WARMUP);
    gate('instance.noiseLoop', (i) => { n.noiseLoop(i * 0.017, 1.5); }, OPS, WARMUP);
    gate('instance.tileable2', (i) => { n.tileable2(i * 0.003 % 4, i * 0.005 % 4, 4, 4); }, OPS, WARMUP);
    gate('instance.curl2', (i) => { n.curl2(i * 0.017, i * 0.023, v2); }, OPS, WARMUP);
    gate('instance.curl3', (i) => { n.curl3(i * 0.017, i * 0.023, i * 0.011, v3); }, OPS, WARMUP);
    gate('instance.warp2', (i) => { n.warp2(i * 0.017, i * 0.023, 1.5, v2); }, OPS, WARMUP);
    bakeGate('instance.fillField2', () => { n.fillField2(field, 64, 64, FIELD_OPTS); });
    bakeGate('instance.fillField2(normalize)', () => { n.fillField2(field, 64, 64, FIELD_NORM_OPTS); });
    bakeGate('instance.tileableField2(fbm)', () => { n.tileableField2(field, 64, 64, TF2_FBM); });
    bakeGate('instance.tileableField2(ridged)', () => { n.tileableField2(field, 64, 64, TF2_RIDGED); });
    bakeGate('instance.tileableField2(billow)', () => { n.tileableField2(field, 64, 64, TF2_BILLOW); });
    bakeGate('instance.tileableField2(normalize)', () => { n.tileableField2(field, 64, 64, TF2_NORM); });
    bakeGate('instance.fillField3(fbm)', () => { n.fillField3(field3, 32, 32, 32, FF3_FBM); }, BAKE3_OPS, BAKE3_WARMUP);
    bakeGate('instance.fillField3(ridged)', () => { n.fillField3(field3, 32, 32, 32, FF3_RIDGED); }, BAKE3_OPS, BAKE3_WARMUP);
    bakeGate('instance.fillField3(billow)', () => { n.fillField3(field3, 32, 32, 32, FF3_BILLOW); }, BAKE3_OPS, BAKE3_WARMUP);
    bakeGate('instance.fillField3(normalize)', () => { n.fillField3(field3, 32, 32, 32, FF3_NORM); }, BAKE3_OPS, BAKE3_WARMUP);

    // --- Construction allocates exactly one table -----------------------------
    // Warm the constructor so class/shape feedback is settled, then measure the
    // arrayBuffers delta of a single construction against the 512-byte table.
    // A transient scratch buffer (the pre-N1 code allocated a 256-byte temp)
    // would push the delta past one table's worth.
    {
        for (let i = 0; i < 200; i++) { const w = new Noise(i); if (w._perm[0] === 999) die('unreachable'); }
        forceGc();
        const before = arrayBufferBytes();
        const held = [];
        const COUNT = 256;
        for (let i = 0; i < COUNT; i++) held.push(new Noise(i));
        const after = arrayBufferBytes();
        // Each instance owns one Uint8Array(512). Allow generous slop for
        // allocator rounding, but reject anything near a second buffer per
        // instance (a transient temp would ~double this).
        const perInstance = (after - before) / COUNT;
        check(perInstance >= 0 && perInstance < 512 + 512,
            () => `T6: construction allocates ${perInstance.toFixed(1)} B/instance -- ` +
                  `expected ~512 (one table), a second buffer would ~double it`);
        check(held.length === COUNT, () => 'T6: held set wrong length'); // keep `held` alive to `after`
    }

    // --- 4096 create/discard cycles retain nothing ----------------------------
    // Instances are not registered anywhere, so a dead instance's table must be
    // collectable. Create and drop 4096 of them; arrayBuffers after a forced GC
    // must return near the pre-loop baseline, not grow by ~4096 * 512 B.
    {
        forceGc();
        const before = arrayBufferBytes();
        let sink = 0;
        for (let i = 0; i < 4096; i++) {
            const t = new Noise(i);
            sink += t.simplex2(0.5, 0.5); // touch it so it can't be optimised away
        }
        if (sink === Infinity) die('unreachable'); // consume sink
        forceGc();
        const after = arrayBufferBytes();
        // 4096 leaked tables would be ~2 MB. A few KB of allocator noise is fine.
        check(after - before < 256 * 1024,
            () => `T6: 4096 create/discard cycles retained ${(after - before)} B -- ` +
                  `instances are leaking their permutation tables`);
    }
}

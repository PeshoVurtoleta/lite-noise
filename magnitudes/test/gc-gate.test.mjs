// Zero-GC gate for every hot path in @zakkster/lite-noise.
//
// Every path that ships as a "zero-allocation" guarantee gets an assertOps
// call. `stabilize: true` forces a full GC at steady boundaries so
// bytesPerOp reflects the live-set delta (retention) rather than transient
// churn. The rule set — `maxBytesPerOp: 2` paired with `maxMajorsPerKOp: 0`
// — is the honest ceiling under this VM's V8 IC / feedback-vector noise
// floor. A real allocation crosses both bars; V8 loop bookkeeping crosses
// neither.
//
//   node scripts/test-gc.mjs          (recommended — asserts >=10 gates ran)
//   node --expose-gc --test test/gc-gate.test.mjs   (raw)

import { test } from 'node:test';
import { assertOps } from '@zakkster/lite-gc-profiler';
import {
    seedNoise,
    simplex2, simplex3,
    fbm2, fbm3,
    curl2, curl3,
    warp2,
    fillField2,
} from '../../Noise.js';

// One-off state re-used by the vector-returning APIs.
const _V2 = { x: 0, y: 0 };
const _V3 = { x: 0, y: 0, z: 0 };
const _FIELD = new Float32Array(64 * 64);

// Cold-CI-safe ops count with stabilize:true so JIT tier-up churn and
// mid-loop minor GCs can't hide a retention leak.
//
// Budget rationale — lite-gc-profiler README documents a residual V8
// loop-bookkeeping noise floor (feedback vectors, inline-cache tier-up)
// that scales as ~500-1500 B / ops regardless of body. For 1K+ ops the
// docs' "recommended" bound is `maxBytesPerOp: 2`; we use that, paired
// with `maxMajorsPerKOp: 0` so a real allocation still fails the gate on
// both axes even if it hides under the byte-budget noise.
const OPTS = { ops: 50_000, warmup: 2000, stabilize: true };
const RULES = { maxBytesPerOp: 2, maxMajorsPerKOp: 0 };

test('simplex2 is zero-alloc per call', () => {
    seedNoise(42);
    assertOps((i) => { simplex2(i * 0.017, i * 0.023); }, RULES, OPTS);
});

test('simplex3 is zero-alloc per call', () => {
    seedNoise(42);
    assertOps((i) => { simplex3(i * 0.017, i * 0.023, i * 0.011); }, RULES, OPTS);
});

test('fbm2 is zero-alloc per call (default octaves)', () => {
    seedNoise(42);
    assertOps((i) => { fbm2(i * 0.017, i * 0.023); }, RULES, OPTS);
});

test('fbm2 is zero-alloc per call (custom octaves/lacunarity/gain)', () => {
    seedNoise(42);
    assertOps((i) => { fbm2(i * 0.017, i * 0.023, 6, 2.1, 0.55); }, RULES, OPTS);
});

test('fbm3 is zero-alloc per call', () => {
    seedNoise(42);
    assertOps((i) => { fbm3(i * 0.017, i * 0.023, i * 0.011, 6); }, RULES, OPTS);
});

test('curl2 is zero-alloc per call (caller-owned out)', () => {
    seedNoise(42);
    assertOps((i) => { curl2(i * 0.017, i * 0.023, _V2); }, RULES, OPTS);
});

test('curl3 is zero-alloc per call (caller-owned out)', () => {
    seedNoise(42);
    assertOps((i) => { curl3(i * 0.017, i * 0.023, i * 0.011, _V3); }, RULES, OPTS);
});

test('warp2 is zero-alloc per call (caller-owned out)', () => {
    seedNoise(42);
    assertOps((i) => { warp2(i * 0.017, i * 0.023, 1.5, _V2); }, RULES, OPTS);
});

// fillField2 takes an opts object; verify both the caller-supplied-opts path
// and the omitted-opts path allocate nothing.
// fillField2 does substantial work per op (64*64 = 4096 samples per bake).
// Keep the same RULES; drop ops to keep runtime bounded.
const BAKE_OPTS = { ops: 200, warmup: 20, stabilize: true };

test('fillField2 is zero-alloc per bake (opts supplied)', () => {
    seedNoise(42);
    const OPTS_INLINE = { scale: 0.01, octaves: 4, lacunarity: 2, gain: 0.5 };
    assertOps((i) => { fillField2(_FIELD, 64, 64, OPTS_INLINE); }, RULES, BAKE_OPTS);
});

test('fillField2 is zero-alloc per bake (opts omitted)', () => {
    seedNoise(42);
    // The critical path: no opts object at all. Must not synthesise one.
    assertOps((i) => { fillField2(_FIELD, 64, 64); }, RULES, BAKE_OPTS);
});

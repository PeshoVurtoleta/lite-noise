#!/usr/bin/env node
// Bench: compares three ways to bake a 256x256, 6-octave FBM heightfield.
//
//   1. Naive:      per-cell `fbm2(x * scale, y * scale, 6)` with a fresh
//                  Float32Array per bake — models a user writing the loop
//                  from scratch every frame with no buffer reuse.
//   2. Row-step:   the loop from the current README quick-start, with
//                  row-incremental coord stepping and the output buffer
//                  reused across bakes.
//   3. fillField2: the v1.1.0 API. Same math as row-step, exported as one
//                  call so consumers don't rewrite the loop.
//
// The dominant cost across all three is the ~393k `simplex2` calls (256 *
// 256 * 6 octaves), which is why row-step's saved two-multiplies-per-cell
// register as ~1.04x on any hardware — the win here is API surface (one
// call, no user-written loop) and buffer reuse (2 above), not raw math.
// Refresh these numbers on your dev hardware before publishing README.
//
//   node bench/terrain.mjs

import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { seedNoise, fbm2, fillField2 } from '../../Noise.js';

const W = 256, H = 256, OCT = 6, SCALE = 0.01;
const REPS = 20;

function bakeNaive() {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            out[x + y * W] = fbm2(x * SCALE, y * SCALE, OCT);
        }
    }
    return out;
}

function bakeRowStep(out) {
    let py = 0, idx = 0;
    for (let y = 0; y < H; y++) {
        let px = 0;
        for (let x = 0; x < W; x++) {
            out[idx++] = fbm2(px, py, OCT);
            px += SCALE;
        }
        py += SCALE;
    }
    return out;
}

function bench(label, run) {
    for (let i = 0; i < 3; i++) run();
    const times = new Float64Array(REPS);
    for (let i = 0; i < REPS; i++) {
        const t = performance.now();
        run();
        times[i] = performance.now() - t;
    }
    times.sort();
    const median = times[REPS >> 1];
    const best = times[0];
    console.log(
        `  ${label.padEnd(24)}  median ${median.toFixed(2).padStart(6)} ms   best ${best.toFixed(2).padStart(6)} ms`
    );
    return median;
}

// Machine stamp — makes README numbers trace back to the hardware they
// were measured on, matching the lite-media / bench-protocol convention.
const cpu = cpus()[0]?.model?.trim() || 'unknown';
const cpuCount = cpus().length;
console.log(`\nlite-noise bench — ${W}x${H} FBM (${OCT} octaves), ${REPS} reps`);
console.log(`node ${process.version} on ${platform()}/${arch()}`);
console.log(`${cpu} (${cpuCount} cores)\n`);

seedNoise(42);
const preAlloc = new Float32Array(W * H);
const naive = bench('naive (alloc/bake)', () => bakeNaive());
const rowStep = bench('row-step (reused buf)', () => bakeRowStep(preAlloc));
const filled = bench('fillField2', () =>
    fillField2(preAlloc, W, H, { scale: SCALE, octaves: OCT }));

console.log(`\n  speedup vs naive:`);
console.log(`    row-step:    ${(naive / rowStep).toFixed(2)}x`);
console.log(`    fillField2:  ${(naive / filled).toFixed(2)}x`);
console.log();

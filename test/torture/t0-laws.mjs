/**
 * T0 -- metamorphic laws.
 *
 * Properties that must hold for ANY seed and ANY input, checked over a fuzzed
 * sweep rather than fixed points:
 *
 *   L1 determinism      two instances at the same seed agree everywhere
 *   L2 range            simplex2/simplex3 stay within [-1.01, 1.01]
 *   L3 degenerate fbm   octaves <= 0 returns 0, never NaN
 *   L4 warp identity    strength 0 leaves the coordinate untouched
 *   L5 curl2 solenoidal near-zero divergence (that IS the point of curl)
 *   L6 instance==module an instance and the module functions produce the SAME
 *                       field at the same seed -- the N1 compatibility contract
 *   L7 loop seam        noiseLoop(0) === noiseLoop(TAU) exactly; periodic to ULPs
 *   L8 tile wrap        tileable2 opposite edges are byte-identical (seamless by
 *                       construction, resolution-free)
 *   L9 ridged/billow    both live in ~[0,1]; degenerate octaves fall to 0
 */

import {
    createNoise, seedNoise,
    simplex2, simplex3, fbm2, fbm3, ridged2, billow2, noiseLoop, tileable2,
    curl2, warp2, fillField2, tileableField2,
} from '../../Noise.js';
import { SEED, makePrng, unit, check } from './harness.mjs';

const TAU = Math.PI * 2;

export function run() {
    const next = makePrng(SEED);

    // L1 -- determinism. Same seed => identical values, sample for sample.
    {
        const a = createNoise(123);
        const b = createNoise(123);
        for (let i = 0; i < 3000; i++) {
            const x = unit(next) * 64, y = unit(next) * 64, z = unit(next) * 64;
            check(a.simplex2(x, y) === b.simplex2(x, y),
                () => `T0.L1: simplex2 nondeterministic at ${x},${y}`);
            check(a.simplex3(x, y, z) === b.simplex3(x, y, z),
                () => `T0.L1: simplex3 nondeterministic at ${x},${y},${z}`);
        }
    }

    // L2 -- amplitude range. Simplex must never leave [-1.01, 1.01].
    {
        const n = createNoise(7);
        for (let i = 0; i < 40000; i++) {
            const x = unit(next) * 256, y = unit(next) * 256, z = unit(next) * 256;
            const v2 = n.simplex2(x, y);
            check(v2 >= -1.01 && v2 <= 1.01, () => `T0.L2: simplex2 out of range: ${v2}`);
            const v3 = n.simplex3(x, y, z);
            check(v3 >= -1.01 && v3 <= 1.01, () => `T0.L2: simplex3 out of range: ${v3}`);
        }
    }

    // L3 -- degenerate FBM. octaves <= 0 must fall to 0, not NaN (the 0/0 trap).
    {
        const n = createNoise(1);
        check(n.fbm2(1.7, 2.3, 0) === 0, () => 'T0.L3: fbm2 octaves=0 not 0');
        check(n.fbm2(1.7, 2.3, -4) === 0, () => 'T0.L3: fbm2 octaves<0 not 0');
        check(n.fbm3(1.1, 2.2, 3.3, 0) === 0, () => 'T0.L3: fbm3 octaves=0 not 0');
        // And it must be exactly 0, so NaN can't sneak through as "not > 1".
        check(!Number.isNaN(n.fbm2(1.7, 2.3, 0)), () => 'T0.L3: fbm2 octaves=0 is NaN');
    }

    // L4 -- warp identity. strength 0 returns the input coordinate unchanged.
    {
        const n = createNoise(9);
        const o = { x: 0, y: 0 };
        for (let i = 0; i < 500; i++) {
            const x = unit(next) * 50, y = unit(next) * 50;
            n.warp2(x, y, 0, o);
            check(o.x === x && o.y === y,
                () => `T0.L4: warp2 strength 0 moved ${x},${y} -> ${o.x},${o.y}`);
        }
    }

    // L5 -- curl2 is divergence-free. Central-difference the returned vector
    // field; div = d(v.x)/dx + d(v.y)/dy must sit near zero.
    {
        const n = createNoise(11);
        const e = 0.001;
        const a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
        let total = 0;
        const K = 400;
        for (let k = 0; k < K; k++) {
            const x = unit(next) * 20, y = unit(next) * 20;
            n.curl2(x + e, y, a); n.curl2(x - e, y, b);
            const dvxdx = (a.x - b.x) / (2 * e);
            n.curl2(x, y + e, a); n.curl2(x, y - e, b);
            const dvydy = (a.y - b.y) / (2 * e);
            total += Math.abs(dvxdx + dvydy);
        }
        check(total / K < 1.0, () => `T0.L5: curl2 mean divergence ${total / K} too high`);
    }

    // L6 -- instance == module at the same seed. This is the N1 compatibility
    // contract: createNoise(S) and the module functions after seedNoise(S) must
    // produce a byte-identical field. Prove it on a baked heightfield AND on the
    // point samplers.
    {
        seedNoise(42);
        const n = createNoise(42);
        const w = 96, h = 96;
        const fm = new Float32Array(w * h);
        const fi = new Float32Array(w * h);
        fillField2(fm, w, h, { scale: 0.013, octaves: 5, gain: 0.55 });
        n.fillField2(fi, w, h, { scale: 0.013, octaves: 5, gain: 0.55 });
        for (let i = 0; i < fm.length; i++) {
            check(fm[i] === fi[i], () => `T0.L6: field instance!=module at cell ${i}: ${fm[i]} vs ${fi[i]}`);
        }
        for (let i = 0; i < 3000; i++) {
            const x = unit(next) * 40, y = unit(next) * 40, z = unit(next) * 40;
            check(simplex2(x, y) === n.simplex2(x, y), () => `T0.L6: simplex2 instance!=module at ${x},${y}`);
            check(fbm3(x, y, z) === n.fbm3(x, y, z), () => `T0.L6: fbm3 instance!=module at ${x},${y},${z}`);
            check(ridged2(x, y) === n.ridged2(x, y), () => `T0.L6: ridged2 instance!=module at ${x},${y}`);
            check(billow2(x, y) === n.billow2(x, y), () => `T0.L6: billow2 instance!=module at ${x},${y}`);
            check(noiseLoop(x, 1.5) === n.noiseLoop(x, 1.5), () => `T0.L6: noiseLoop instance!=module at ${x}`);
        }
    }

    // L7 -- the loop seam. The canonical seam is bit-exact (0 + TAU = TAU, and
    // TAU % TAU = 0), so an animation from 0..TAU closes with ===. Away from the
    // seam, adding TAU rounds off low bits, so periodicity holds only to a few
    // ULPs -- assert that honestly rather than claiming exactness it can't have.
    {
        const n = createNoise(42);
        for (let k = 0; k < 300; k++) {
            const r = 0.25 + (k % 8);
            check(n.noiseLoop(0, r) === n.noiseLoop(TAU, r),
                () => `T0.L7: loop seam open at radius ${r}: ${n.noiseLoop(0, r)} vs ${n.noiseLoop(TAU, r)}`);
            const t = unit(next) * 6;
            check(Math.abs(n.noiseLoop(t, 1.5) - n.noiseLoop(t + TAU, 1.5)) < 1e-12,
                () => `T0.L7: loop not periodic to ULPs at t=${t}`);
        }
    }

    // L8 -- tileable2 wraps exactly. At every seam the vanishing corner weights
    // make opposite edges evaluate to the identical expression: no epsilon, no
    // resolution dependence. This is the real seamlessness proof (the sibling
    // seamlessScore cross-check lives in the functional suite).
    {
        const n = createNoise(3);
        for (let k = 0; k < 500; k++) {
            const px = 1 + (k % 7), py = 2 + (k % 5);
            const y = unit(next) * py;
            check(n.tileable2(0, y, px, py) === n.tileable2(px, y, px, py),
                () => `T0.L8: tileable2 horizontal seam open (period ${px}) at y=${y}`);
            const x = unit(next) * px;
            check(n.tileable2(x, 0, px, py) === n.tileable2(x, py, px, py),
                () => `T0.L8: tileable2 vertical seam open (period ${py}) at x=${x}`);
        }
    }

    // L9 -- ridged2/billow2 range and degenerate guard. Both are non-negative and
    // bounded ~[0,1]; octaves <= 0 must fall to 0, not NaN (the shared skeleton's
    // maxAmp guard covers all three multifractals).
    {
        const n = createNoise(5);
        for (let i = 0; i < 20000; i++) {
            const x = unit(next) * 128, y = unit(next) * 128;
            const r = n.ridged2(x, y), b = n.billow2(x, y);
            check(r >= -0.01 && r <= 1.01, () => `T0.L9: ridged2 out of range: ${r}`);
            check(b >= -0.01 && b <= 1.01, () => `T0.L9: billow2 out of range: ${b}`);
        }
        check(n.ridged2(1.7, 2.3, 0) === 0, () => 'T0.L9: ridged2 octaves=0 not 0');
        check(n.billow2(1.7, 2.3, 0) === 0, () => 'T0.L9: billow2 octaves=0 not 0');
        check(n.ridged2(1.7, 2.3, -3) === 0, () => 'T0.L9: ridged2 octaves<0 not 0');
        check(n.billow2(1.7, 2.3, -3) === 0, () => 'T0.L9: billow2 octaves<0 not 0');
    }
}

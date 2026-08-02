/**
 * T5 -- differential fuzz: instance isolation, the NS-01 finding made executable.
 *
 * NS-01 was: `seedNoise` mutates one module-global table, so two consumers on a
 * page share a seed and the last to seed silently re-randomises the others. N1's
 * fix is `createNoise` -- a per-instance table. This tier proves the fix and
 * documents the hazard it removes:
 *
 *   F1 isolation       an instance's field is unchanged by ANYTHING done to
 *                      another instance OR to the shared module table
 *   F2 the hazard      two module-level consumers DO corrupt each other -- the
 *                      bug is real, and reproducing it here is why N1 exists
 *   F3 reseed          instance.seed(s) yields a field byte-identical to a fresh
 *                      createNoise(s)
 *   F4 differential    createNoise(S) matches the module functions after
 *                      seedNoise(S) across a fuzzed seed sweep
 */

import {
    createNoise, seedNoise, simplex2, fbm2,
} from '../../Noise.js';
import { SEED, makePrng, unit, check, fnv1a } from './harness.mjs';

// Fingerprint an instance's field over a fixed grid -- a compact witness that
// "the field did not move" without comparing thousands of values by hand.
function fieldPrint(inst) {
    const w = 48, h = 48;
    const out = new Float32Array(w * h);
    inst.fillField2(out, w, h, { scale: 0.021, octaves: 4 });
    return fnv1a(out);
}

export function run() {
    const next = makePrng(SEED);

    // F1 -- isolation. A's field must survive B being created, sampled, and
    // reseeded, AND survive the shared module table being reseeded repeatedly.
    {
        const a = createNoise(0x1234);
        const before = fieldPrint(a);

        // Adversary 1: a flurry of other instances at random seeds.
        for (let i = 0; i < 64; i++) {
            const b = createNoise((next() ^ (i * 2654435761)) >>> 0);
            for (let k = 0; k < 200; k++) b.simplex2(unit(next) * 30, unit(next) * 30);
            b.seed((next() >>> 0));
        }
        // Adversary 2: hammer the shared module seed -- the exact NS-01 action.
        for (let i = 0; i < 64; i++) seedNoise((next() >>> 0));

        const after = fieldPrint(a);
        check(before === after,
            () => `T5.F1: instance field changed (${before.toString(16)} -> ${after.toString(16)}) ` +
                  `after other instances / module reseeds -- isolation broken`);
    }

    // F2 -- the hazard, reproduced. Two consumers of the MODULE functions: the
    // first samples at seed P, the second later calls seedNoise(Q), and the
    // first's identical call now returns a different value. This is the bug N1
    // fixes; asserting it stays true keeps the finding honest (and the demo's
    // "shared" toggle meaningful). If this ever stops reproducing, the module
    // path silently changed semantics.
    {
        seedNoise(42);
        const p = simplex2(1.5, 2.5);
        seedNoise(7);                 // a second, unrelated consumer seeds
        const pAfter = simplex2(1.5, 2.5);
        check(p !== pAfter,
            () => `T5.F2: module sample did NOT change across reseed -- the shared-state ` +
                  `hazard is expected on the module path (${p} vs ${pAfter})`);

        // ...and the instance path is immune to the same move.
        seedNoise(42);
        const inst = createNoise(42);
        const iBefore = inst.simplex2(1.5, 2.5);
        seedNoise(7);
        const iAfter = inst.simplex2(1.5, 2.5);
        check(iBefore === iAfter,
            () => `T5.F2: instance sample changed when the MODULE was reseeded -- ` +
                  `isolation broken (${iBefore} vs ${iAfter})`);
    }

    // F3 -- reseed reproducibility. Reseeding an instance to S must give exactly
    // the field a fresh createNoise(S) gives.
    {
        for (let i = 0; i < 32; i++) {
            const s = (next() >>> 0);
            const reused = createNoise(0xABCD);
            reused.seed(s);
            const fresh = createNoise(s);
            check(fieldPrint(reused) === fieldPrint(fresh),
                () => `T5.F3: instance.seed(${s}) != fresh createNoise(${s})`);
        }
    }

    // F4 -- differential vs the module across many seeds. For each seed, an
    // instance and the module functions (after seedNoise) must agree everywhere.
    {
        for (let t = 0; t < 24; t++) {
            const s = (next() >>> 0);
            seedNoise(s);
            const n = createNoise(s);
            for (let i = 0; i < 800; i++) {
                const x = unit(next) * 50, y = unit(next) * 50;
                check(simplex2(x, y) === n.simplex2(x, y),
                    () => `T5.F4: simplex2 seed=${s} instance!=module at ${x},${y}`);
                check(fbm2(x, y, 5) === n.fbm2(x, y, 5),
                    () => `T5.F4: fbm2 seed=${s} instance!=module at ${x},${y}`);
            }
        }
    }
}

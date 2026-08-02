/**
 * @zakkster/lite-noise -- torture gate.
 *
 * The DONE-WHEN of every session is a single command:
 *
 *     node --expose-gc test/torture.mjs        -> prints exactly "ok", exit 0
 *     npm run torture
 *
 * Tiers share one shape (see LiteBvh's harness convention). lite-noise registers
 * the tiers this package needs:
 *
 *     T0  metamorphic laws        determinism, range, degenerate fbm, warp
 *                                 identity, curl2 solenoidality, instance==module
 *     T5  differential fuzz       instance isolation (the NS-01 finding, made
 *                                 executable), reseed reproducibility, module diff
 *     T6  the zero-alloc gate     every hot path (module + instance), one-table
 *                                 construction, 4096-cycle retention
 *     T9  controls                every gate proven able to fail, plus the
 *                                 seedNoise dev-warning fires / prod-silent
 *
 * lite-gc-profiler is one-measurement-at-a-time, so tiers run STRICTLY
 * SEQUENTIALLY -- never nested, never concurrent.
 *
 * Controls: `NOISE_TORTURE_BREAK=1 node --expose-gc test/torture.mjs` injects
 * retained allocations into the T6 hot loop and must exit non-zero. A gate that
 * cannot fail is decorative.
 *
 * The shared module table is seeded many times across the tiers -- exactly the
 * NS-01 action T5 is built around. To keep this passing run's stderr clean we
 * declare production here so the once-per-process dev warning stays silent; T9
 * proves the warning fires in a dedicated dev child and is silent in a prod one.
 *
 * lite-gc-profiler is a devDependency only. Noise.js has zero runtime deps.
 *
 * @license MIT
 */

process.env.NODE_ENV = 'production';

import { SEED } from './torture/harness.mjs';
import { run as t0 } from './torture/t0-laws.mjs';
import { run as t5 } from './torture/t5-fuzz.mjs';
import { run as t6 } from './torture/t6-alloc.mjs';
import { run as t9 } from './torture/t9-controls.mjs';

const TIERS = [
    ['T0 laws', t0],
    ['T5 fuzz', t5],
    ['T6 alloc', t6],
    ['T9 controls', t9],
];

const BREAK = process.env.NOISE_TORTURE_BREAK === '1';

function main() {
    if (typeof globalThis.gc !== 'function') {
        process.stderr.write(
            'torture: FAIL -- run with --expose-gc:  node --expose-gc test/torture.mjs\n');
        process.exit(1);
    }

    for (const [name, run] of TIERS) {
        try {
            run();
        } catch (err) {
            process.stderr.write(
                'torture: FAIL -- ' + name + ' threw: ' + (err && err.stack || err) +
                '\n  replay: TORTURE_SEED=' + SEED + ' node --expose-gc test/torture.mjs\n');
            process.exit(1);
        }
    }

    // Reaching here in BREAK mode means T6's control did not trip -- a fault.
    if (BREAK) {
        process.stderr.write('torture: FAIL -- NOISE_TORTURE_BREAK set but the gate still passed\n');
        process.exit(1);
    }

    process.stdout.write('ok\n');
    process.exit(0);
}

main();

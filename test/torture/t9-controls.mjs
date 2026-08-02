/**
 * T9 -- controls. Every gate must be provably able to fail.
 *
 * This tier runs deliberately-broken variants and asserts the corresponding
 * gate flags each one. If a control slips through, T9 itself fails the run --
 * a gate that cannot fail is decorative.
 *
 * There is also a whole-suite control: `NOISE_TORTURE_BREAK=1 npm run torture`
 * injects retained allocations into T6's hot loop, so the alloc gate rejects and
 * the process exits non-zero. T9 covers the same alloc lane here so a plain
 * `npm run torture` already proves the gate bites.
 */

import { spawnSync } from 'node:child_process';
import { createNoise } from '../../Noise.js';
import { runOpsGate, die, fnv1a } from './harness.mjs';

const NOISE_URL = new URL('../../Noise.js', import.meta.url).href;

function fieldPrint(inst) {
    const w = 32, h = 32;
    const out = new Float32Array(w * h);
    inst.fillField2(out, w, h, { scale: 0.03, octaves: 3 });
    return fnv1a(out);
}

/** Retained sink so the control's allocations survive GC. */
const leak = [];

export function run() {
    // Control 1 -- the alloc gate. A hot body that retains an allocation every
    // iteration MUST be rejected by runOpsGate.
    {
        const { report } = runOpsGate(() => { leak.push(new Float64Array(64)); }, { ops: 4000, warmup: 0 });
        if (report.ok) die('T9.C1: an allocating hot loop passed the zero-alloc gate');
        leak.length = 0; // release the control's garbage
    }

    // Control 2 -- the field fingerprint is discriminating, not vacuous. Two
    // instances at DIFFERENT seeds must produce different prints, or T5's
    // isolation assertion ("print unchanged") would hold trivially.
    {
        const a = fieldPrint(createNoise(1));
        const b = fieldPrint(createNoise(2));
        if (a === b) die('T9.C2: fieldPrint collided for seeds 1 and 2 -- isolation check is vacuous');
    }

    // Control 3 -- the instance==module differential is not vacuous. If the
    // equality held for the WRONG seed, T0.L6 / T5.F4 would prove nothing.
    {
        const s1 = createNoise(100);
        const s2 = createNoise(101);
        if (s1.simplex2(1.5, 2.5) === s2.simplex2(1.5, 2.5)) {
            die('T9.C3: two different seeds returned the same simplex2 -- differential is vacuous');
        }
    }

    // Control 4 -- the seedNoise dev warning. It must FIRE in a dev process and
    // be SILENT under NODE_ENV=production. Run both in children so the process-
    // global once-flag is fresh each time.
    {
        const prog =
            `import(${JSON.stringify(NOISE_URL)}).then(m => { m.seedNoise(1); m.seedNoise(2); });`;

        const dev = spawnSync(process.execPath, ['--input-type=module', '-e', prog], {
            encoding: 'utf8',
            env: { ...process.env, NODE_ENV: '' },
        });
        if (dev.status !== 0) die('T9.C4: dev child exited ' + dev.status + ' -- ' + (dev.stderr || ''));
        if (!/seedNoise\(\) called more than once/.test(dev.stderr || '')) {
            die('T9.C4: seedNoise warned NOT fired on the 2nd call in a dev process');
        }

        const prod = spawnSync(process.execPath, ['--input-type=module', '-e', prog], {
            encoding: 'utf8',
            env: { ...process.env, NODE_ENV: 'production' },
        });
        if (prod.status !== 0) die('T9.C4: prod child exited ' + prod.status + ' -- ' + (prod.stderr || ''));
        if (/seedNoise\(\) called more than once/.test(prod.stderr || '')) {
            die('T9.C4: seedNoise warning fired under NODE_ENV=production (should be silent)');
        }
    }
}

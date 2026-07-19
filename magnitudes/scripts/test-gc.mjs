#!/usr/bin/env node
// Runs the zero-GC gate under node --expose-gc --test with a TAP reporter,
// mirrors output to the terminal, and asserts three things:
//   1. child exit code == 0                       (existing tests pass)
//   2. `# tests N` reports N > 0                  (something ran)
//   3. N >= MIN_TESTS                              (nothing got quietly deleted)
//
// Guards two failure modes that any glob-based node --test invocation misses:
//   - the file got moved / renamed          → node --test exits non-zero  → (1)
//   - the file exists but has no test() calls → # tests 1 (file counts as 1)
//                                              → (3) catches it
//   - someone quietly dropped a gate         → # tests < MIN_TESTS       → (3)
//
// Any legitimate change to the gate count means bumping MIN_TESTS in this
// file — a diff that shows up in code review, matching the ecosystem's
// version-string floor pattern.
//
// Run: node scripts/test-gc.mjs

import { spawn } from 'node:child_process';

const GATE = 'magnitudes/test/gc-gate.test.mjs';
const MIN_TESTS = 10;   // simplex2/3, fbm2 x2, fbm3, curl2/3, warp2, fillField2 x2

const child = spawn(
    process.execPath,
    ['--expose-gc', '--test', '--test-reporter=tap', GATE],
    { stdio: ['inherit', 'pipe', 'inherit'] },
);

let captured = '';
child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    captured += chunk.toString();
});

child.on('close', (code) => {
    if (code !== 0) {
        console.error(`\ntest:gc: node --test exited ${code}.`);
        process.exit(code || 1);
    }
    // TAP 14 summary: "# tests N"
    const m = captured.match(/^# tests\s+(\d+)/m);
    const n = m ? Number(m[1]) : 0;
    if (n < MIN_TESTS) {
        console.error(
            `\ntest:gc: FAIL — ${n} tests ran, expected >= ${MIN_TESTS}.`,
        );
        console.error(
            `      Either ${GATE} got moved/emptied, or gates were deleted.`,
        );
        console.error(
            `      If the deletion is intentional, lower MIN_TESTS in scripts/test-gc.mjs`,
        );
        console.error(
            `      and record the change in CHANGELOG.md.`,
        );
        process.exit(1);
    }
    console.log(`\ntest:gc: OK — ${n} gates verified (>= ${MIN_TESTS}).`);
});

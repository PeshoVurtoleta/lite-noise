/**
 * @zakkster/lite-noise -- torture harness.
 *
 * Shared seeded PRNG, zero-alloc assertions, the lite-gc-profiler gate wrapper,
 * and field-fingerprint helpers. Every tier imports from here so the discipline
 * lives in one place:
 *
 *   - All scratch (vectors, fields, instances) is allocated ONCE, by the tier,
 *     outside every measured loop. This module hands out helpers, never a
 *     per-call allocation on a hot path.
 *   - `check()` builds its message string only on failure -- a template literal
 *     per iteration is an allocation and would fail the T6 gate.
 *   - The PRNG is a seeded xorshift32. On failure a tier prints the seed so the
 *     case replays with `TORTURE_SEED=... npm run torture`.
 *   - lite-gc-profiler is one-measurement-at-a-time; tiers run sequentially,
 *     never nested. `runOpsGate` opens and closes a single window per call.
 *
 * @license MIT
 */

import { measureOps, checkOps } from '@zakkster/lite-gc-profiler';

/** Seed for every PRNG in the run. Override with TORTURE_SEED for replay. */
export const SEED = (() => {
    const raw = process.env.TORTURE_SEED;
    if (raw === undefined) return 0x9e3779b9;
    const n = Number(raw) >>> 0;
    return n === 0 ? 1 : n; // xorshift32 must not be seeded with 0
})();

/** Deliberately-broken control mode: injects a retained allocation into T6. */
export const BREAK = process.env.NOISE_TORTURE_BREAK === '1';

/**
 * Per-op allocation budget. `maxBytesPerOp: 2` is the honest ceiling under this
 * VM's V8 inline-cache / feedback-vector noise floor (a real allocation crosses
 * it, loop bookkeeping does not); `maxMajorsPerKOp: 0` forbids any major GC. A
 * genuine allocation trips both. These are the rules the N0 gate proved good.
 */
export const RULES = { maxBytesPerOp: 2, maxMajorsPerKOp: 0 };

/** Seeded xorshift32. Returns a function yielding a uint32 each call. */
export function makePrng(seed) {
    let x = (seed >>> 0) || 1;
    return function next() {
        x ^= x << 13; x >>>= 0;
        x ^= x >> 17;
        x ^= x << 5; x >>>= 0;
        return x >>> 0;
    };
}

/** A float in [-1, 1) from a uint32 draw. */
export function unit(next) {
    return (next() / 0x100000000) * 2 - 1;
}

/** Fail the whole gate. stdout stays clean; the reason goes to stderr. */
export function die(msg) {
    process.stderr.write('torture: FAIL -- ' + msg + '\n');
    process.exit(1);
}

/**
 * Assertion whose message is built ONLY on failure. Pass a thunk, not a string,
 * so the happy path allocates nothing.
 * @param {boolean} cond
 * @param {() => string} msgThunk
 */
export function check(cond, msgThunk) {
    if (!cond) die(msgThunk());
}

/**
 * Run `fn(i)` under a single measured window and gate it against RULES.
 * `stabilize: true` forces a GC at the steady boundaries so JIT tier-up churn
 * and mid-loop minor GCs can't hide a per-op allocation -- the config the N0
 * gate proved good at a 2 B/op ceiling on this VM. Backing-store RETENTION
 * (typed arrays live outside heapUsed) is asserted separately in T6 via direct
 * `arrayBufferBytes()` deltas around a forced GC.
 * Returns the checkOps report plus the raw summary for diagnostics.
 *
 * @param {(i:number)=>void} fn  Sync, zero-alloc hot body.
 * @param {{ops:number, warmup?:number}} opts
 */
export function runOpsGate(fn, opts) {
    const res = measureOps(fn, {
        ops: opts.ops,
        warmup: opts.warmup === undefined ? 0 : opts.warmup,
        stabilize: true,
    });
    return { report: checkOps(res, RULES), summary: res.summary };
}

/** FNV-1a 32-bit over a TypedArray's raw bytes -- a field fingerprint. */
export function fnv1a(arr) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** ArrayBuffer backing-store bytes held by the process. Needs --expose-gc to be meaningful. */
export function arrayBufferBytes() {
    return process.memoryUsage().arrayBuffers;
}

/**
 * Force a thorough GC if exposed; the orchestrator guarantees --expose-gc.
 * Runs several passes: freeing external ArrayBuffer backing stores can lag a
 * single major GC (measured ~1.3 MB still accounted after 1 pass, 0 after 3),
 * so a retention probe must drain them before reading `arrayBufferBytes()`.
 */
export function forceGc() {
    if (typeof globalThis.gc !== 'function') return;
    globalThis.gc();
    globalThis.gc();
    globalThis.gc();
}

/**
 * T7 -- the retention gate (@zakkster/lite-leak).
 *
 * T6 proves the hot paths allocate nothing and that a dropped instance's
 * permutation *buffer* is reclaimed (an `arrayBuffers` delta -- buffer level).
 * T7 proves the complement at the OBJECT level: a dropped `Noise` instance is
 * itself collectable, tracked through a `FinalizationRegistry` via lite-leak.
 * `createNoise` registers instances nowhere, so a dead instance must die; a
 * stray module-scoped registry, a cache keyed by seed, or an event wiring that
 * outlived the instance would leave it pinned -- and surface here.
 *
 * FinalizationRegistry callbacks fire asynchronously, AFTER a GC and a turn of
 * the event loop, and are best-effort. To stay deterministic (a torture gate
 * that flaky-FAILs is worse than none), the drain is a bounded retry: force GC,
 * yield a macrotask, re-check -- pass the instant the tracker empties, fail only
 * if it is still non-empty after the whole budget. A genuine leak never clears;
 * a merely-slow collection clears in a round or two (observed: 1).
 *
 * Non-decorative by construction: the tier first asserts a STRONGLY-HELD
 * instance is NOT reported collected (the tracker can actually see retention),
 * then asserts 4096 dropped instances all drain. A gate that cannot fail proves
 * nothing.
 *
 * lite-leak is a devDependency; Noise.js has zero runtime deps.
 */

import { createLeakTracker } from '@zakkster/lite-leak';
import { createNoise } from '../../Noise.js';
import { check, die, forceGc } from './harness.mjs';

const CYCLES = 4096;
const DRAIN_BUDGET = 30;   // GC+macrotask rounds before we call it a leak

/** Force GC + yield a macrotask, up to `budget` times; return the round it drained on, or -1. */
async function drained(tracker, budget) {
    for (let i = 0; i < budget; i++) {
        forceGc();
        await new Promise((r) => setTimeout(r, 0));
        if (tracker.size() === 0) return i + 1;
    }
    return -1;
}

export async function run() {
    const tracker = createLeakTracker();

    // --- Positive control: retention IS detectable ---------------------------
    // A strongly-reachable instance must survive GC and stay tracked. The `sink`
    // array keeps it reachable THROUGH the check (a bare local could be reclaimed
    // right after its last read -- V8 liveness -- which would make this flaky).
    {
        const sink = [createNoise(1)];
        const handle = tracker.track(sink[0], () => {}, 'pinned');
        forceGc();
        await new Promise((r) => setTimeout(r, 0));
        forceGc();
        check(tracker.size() >= 1 && sink[0] !== null,
            () => 'T7 control: a retained Noise instance was reported collected -- the leak gate is blind');
        tracker.untrack(handle);
        sink[0] = null;
    }

    // --- Retention proof: dropped instances all die --------------------------
    // Create and drop CYCLES instances, tracking each; touch each so V8 cannot
    // elide the construction. No reference is kept, so every one must be
    // reclaimable -- the object-level echo of T6's 4096-cycle arrayBuffers check.
    let sink = 0;
    for (let i = 0; i < CYCLES; i++) {
        const t = createNoise(i);
        sink += t.simplex2(0.5, 0.5);
        tracker.track(t, () => {}, 'cycle');
    }
    if (sink === Infinity) die('unreachable'); // consume `sink` so the loop is real

    const round = await drained(tracker, DRAIN_BUDGET);
    check(round > 0,
        () => `T7: ${tracker.size()} of ${CYCLES} tracked instances survived ${DRAIN_BUDGET} GC rounds -- ` +
              'createNoise is retaining instances (a registry/cache/wiring outlives them)');
}

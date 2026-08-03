/**
 * Recipe: advect @zakkster/lite-particles through a lite-noise curl2 flow field.
 *
 * The seam needs NO API from either package -- that is the whole point. The
 * caller's `onUpdate(particle, dt)` hook samples `curl2` and writes the
 * particle's velocity; lite-particles integrates it. Both `curl2` and
 * `Emitter.update` are 0 B/call, so the combined advection loop allocates
 * nothing per frame (one `{x,y}` scratch vector, reused for every particle of
 * every frame, lives outside the loop).
 *
 * Each field is an INDEPENDENT createNoise instance, so two advected systems on
 * one page never disturb each other (the N1 guarantee) -- see composeTwo below.
 *
 * Zero runtime dependency is added to lite-noise: this file lives in examples/,
 * is not in package.json `files[]`, and imports the peer only as a devDependency.
 *
 * Peers: @zakkster/lite-particles@^1.5.0.
 */

import { createNoise } from '../Noise.js';
import { Emitter } from '@zakkster/lite-particles';

/**
 * Build a curl-advected particle system. Returns the emitter plus a zero-alloc
 * `step(dt)` (dt in SECONDS, per lite-particles' contract).
 *
 * @param {{count?:number, seed?:number, scale?:number, speed?:number,
 *          cols?:number, spacing?:number, maxParticles?:number}} [opts]
 */
export function createCurlFlow(opts = {}) {
    const count   = opts.count   ?? 5000;
    const seed    = opts.seed    ?? 42;
    const scale   = opts.scale   ?? 0.005;
    const speed   = opts.speed   ?? 40;
    const cols    = opts.cols    ?? 100;
    const spacing = opts.spacing ?? 8;

    const maxParticles = opts.maxParticles ?? count;

    const noise = createNoise(seed);
    // Pre-allocated scratch, reused for every particle every frame. Allocating
    // this inside onUpdate would allocate once per particle per frame -- exactly
    // the hazard curl2's caller-owned `out` contract exists to avoid.
    const vel = { x: 0, y: 0 };

    const emitter = new Emitter({
        maxParticles,
        onUpdate(p, dt) {
            noise.curl2(p.x * scale, p.y * scale, vel);
            p.vx = vel.x * speed;
            p.vy = vel.y * speed;
        },
    });

    // Seed a grid of persistent particles (large finite life -- non-finite life
    // is rejected by the pool). RAW emitEach writes a sealed particle with no
    // per-particle config object, so it is allocation-free.
    //
    // Fail closed: emitEach returns how many actually spawned, which is < count
    // when the pool saturates (maxParticles set below count). A silently-smaller
    // field is exactly the "null is not zero" trap -- surface it rather than
    // hand back a field that quietly ignored the request.
    const emitted = emitter.emitEach(count, (p, i) => {
        p.x = (i % cols) * spacing;
        p.y = ((i / cols) | 0) * spacing;
        p.vx = 0; p.vy = 0;
        p.life = 1e9; p.maxLife = 1e9;
        p.size = 1; p.r = 1; p.g = 1; p.b = 1; p.a = 1;
    });
    if (emitted !== count) {
        throw new RangeError(
            `curl-advection: pool held only ${emitted} of ${count} requested particles ` +
            `(maxParticles=${maxParticles}). Raise maxParticles to >= count.`);
    }

    return {
        emitter,
        noise,
        /** Advance the flow by `dt` seconds. Zero allocation. */
        step(dt) { emitter.update(dt); },
    };
}

// CLI smoke run: `node examples/curl-advection.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const flow = createCurlFlow({ count: 2000 });
    for (let i = 0; i < 60; i++) flow.step(1 / 60);
    console.log('curl-advection: advected 2000 particles for 60 frames at 1/60 s');
}

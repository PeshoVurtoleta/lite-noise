/**
 * Recipe: a curl-driven ambient behavior for @zakkster/lite-ambient-fx.
 *
 * ambient-fx keeps its zero-dependency pledge -- it VENDORS rather than depends,
 * so this is a recipe, not a dependency edge. A custom behavior is
 * `registerBehavior(name, { spriteLogical, spawn, tick })`; `tick` does the
 * per-particle physics and draws to a canvas. Here the physics is a lite-noise
 * `curl2` advection (`advance` below), and the drawing is the caller's.
 *
 * What runs in CI vs the browser:
 *   - `advance(p, dtMs)` -- pure curl physics, deterministic and zero-alloc.
 *     CI-tested.
 *   - `registerBehavior('CURL', ...)` -- registration is headless-safe (it just
 *     stores the definition). CI-tested that 'CURL' lands in the registry.
 *   - `createAmbientFX(canvas, { behavior: 'CURL' })` and the `tick` DRAW calls
 *     need an HTMLCanvasElement, so the visual half is browser-only (documented
 *     at the bottom), not run in node CI.
 *
 * Each behavior instance owns an independent createNoise field, so a curl
 * ambient layer and a curl particle system (see curl-advection.mjs) on one page
 * never disturb each other -- the N1 guarantee.
 *
 * Zero runtime dependency added: examples/ only, peer is a devDependency.
 *
 * Peers: @zakkster/lite-ambient-fx@^1.8.0.
 */

import { createNoise } from '../Noise.js';
import { registerBehavior, BEHAVIORS } from '@zakkster/lite-ambient-fx';

/**
 * Build the pure curl motion used by the behavior's `tick`. `advance` mutates a
 * particle's velocity + position from a curl field; zero allocation (one scratch
 * vector, hoisted).
 * @param {{seed?:number, scale?:number, speed?:number}} [opts]
 */
export function createCurlBehavior(opts = {}) {
    const noise = createNoise(opts.seed ?? 42);
    const scale = opts.scale ?? 0.004;
    const speed = opts.speed ?? 30;
    const vel = { x: 0, y: 0 };

    /** Advance a particle through the curl field. dtMs in MILLISECONDS (ambient-fx frame units). */
    function advance(p, dtMs) {
        const dt = dtMs / 1000;
        noise.curl2(p.x * scale, p.y * scale, vel);
        p.vx = vel.x * speed;
        p.vy = vel.y * speed;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }

    return { noise, advance };
}

/**
 * Register a 'CURL' ambient behavior. Registration is headless-safe; the `tick`
 * body's DRAW calls only run under a real canvas in the browser. Returns the
 * behavior name. Idempotent-ish: re-registering overwrites.
 * @param {Parameters<typeof createCurlBehavior>[0]} [opts]
 */
export function registerCurlBehavior(opts = {}) {
    const { advance } = createCurlBehavior(opts);
    registerBehavior('CURL', {
        spriteLogical: 64,
        spawn(p /*, frame */) {
            // In the browser: populate every field of the monomorphic particle
            // and set p.spriteCanvas = frame.getSprite(color, 64). Fields written
            // here are what `advance` reads (x, y).
            p.vx = 0; p.vy = 0;
        },
        tick(particles, ctx, frame) {
            for (let i = 0; i < particles.length; i++) {
                advance(particles[i], frame.dtMs);
                // Browser: draw particles[i] to ctx (frame.respawn(p, false) on death).
            }
        },
    });
    return 'CURL';
}

// CLI smoke run: `node examples/ambient-curl.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const name = registerCurlBehavior({ seed: 7 });
    const { advance } = createCurlBehavior({ seed: 7 });
    const p = { x: 100, y: 100, vx: 0, vy: 0 };
    for (let i = 0; i < 30; i++) advance(p, 1000 / 60);
    console.log(`ambient-curl: registered '${name}' (in registry: ${name in BEHAVIORS}); ` +
        `particle advected to (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
}

/*
 * BROWSER WIRING (not run in CI -- needs a canvas):
 *
 *   import { createAmbientFX } from '@zakkster/lite-ambient-fx';
 *   import { registerCurlBehavior } from './examples/ambient-curl.mjs';
 *
 *   registerCurlBehavior({ seed: 7, scale: 0.004, speed: 30 });
 *   const fx = createAmbientFX(document.querySelector('#bg'), { behavior: 'CURL' });
 *   // fx runs the curl field as an ambient layer; a second createNoise-backed
 *   // system elsewhere on the page is unaffected (independent permutation tables).
 */

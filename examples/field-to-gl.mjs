/**
 * Recipe: hand a baked lite-noise heightfield to a @zakkster/lite-gl field.
 *
 * A `fillField2` bake is a packed `Float32Array` -- exactly what a GL instance
 * buffer wants. This recipe packs one `LAYOUT.POINT` instance per cell (grid
 * position + the height driving a grayscale colour), which is the buffer a
 * lite-gl point sink uploads verbatim:
 *
 *     sink.upload(field.data, 0, field.count * LAYOUT.POINT, 0, LAYOUT.POINT);
 *
 * The seam is proven by a bit-exact ROUND-TRIP: bake -> pack into the GL field
 * -> read the heights back out of `field.data` -> assert byte-identity. Float32
 * stores and loads are exact, so a correct stride mapping round-trips perfectly;
 * a wrong offset or a lossy step shows immediately. The live GPU upload/readback
 * is lite-gl's own tested territory -- this proves the DATA handoff, headless.
 *
 * `LAYOUT.POINT` (lite-gl) and `POINT_STRIDE`/`POINT_OFFSETS` (lite-particles)
 * are the SAME contract (stride 8: x, y, size, r, g, b, a, _pad); the recipe
 * asserts they agree, so a field built here also feeds lite-particles' packTo
 * pipeline.
 *
 * Zero runtime dependency added: examples/ only, peers are devDependencies.
 *
 * Peers: @zakkster/lite-gl@^1.4.0, @zakkster/lite-particles@^1.5.0.
 */

import { createNoise } from '../Noise.js';
import { createField, LAYOUT } from '@zakkster/lite-gl';
import { POINT_STRIDE, POINT_OFFSETS } from '@zakkster/lite-particles';

// Hoisted writer + scratch: `push(write)` calls write(data, base), so a per-cell
// arrow would allocate one closure per cell. Even though baking is setup, not a
// per-frame hot path, the library models the zero-alloc pattern in its own
// examples -- one writer, fed through module-scoped scratch. The module-scoped
// _x/_y/_h are safe because a bake is fully synchronous: each cell sets them and
// calls push in one uninterrupted sequence, with no await/yield between set and
// use, so no second bake can interleave (single-threaded JS).
let _x = 0, _y = 0, _h = 0;
function _writePoint(d, b) {
    d[b + POINT_OFFSETS.x] = _x;
    d[b + POINT_OFFSETS.y] = _y;
    d[b + POINT_OFFSETS.size] = 1;
    d[b + POINT_OFFSETS.r] = _h;
    d[b + POINT_OFFSETS.g] = _h;
    d[b + POINT_OFFSETS.b] = _h;
    d[b + POINT_OFFSETS.a] = 1;
}

/**
 * Bake a normalized [0,1] heightfield and pack it into a lite-gl LAYOUT.POINT
 * field, one point per cell. Returns the baked field and the GL field.
 * @param {{w?:number, h?:number, seed?:number, scale?:number, octaves?:number}} [opts]
 */
export function bakeFieldToGl(opts = {}) {
    const w = opts.w ?? 64, h = opts.h ?? 64;
    const seed = opts.seed ?? 42;
    const scale = opts.scale ?? 0.02;
    const octaves = opts.octaves ?? 5;

    // Contract check: the two packages must agree on the point layout, or the
    // stride mapping below is meaningless.
    if (LAYOUT.POINT !== POINT_STRIDE) {
        throw new Error(`layout mismatch: lite-gl LAYOUT.POINT=${LAYOUT.POINT} vs lite-particles POINT_STRIDE=${POINT_STRIDE}`);
    }

    const noise = createNoise(seed);
    const baked = new Float32Array(w * h);
    noise.fillField2(baked, w, h, { scale, octaves, normalize: true }); // exact [0,1] for colour

    const field = createField({ capacity: w * h, stride: LAYOUT.POINT });
    let idx = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            _x = x; _y = y; _h = baked[idx++];
            field.push(_writePoint);
        }
    }
    return { noise, baked, field, w, h };
}

/**
 * Bake, pack into the GL field, then read the heights back out of `field.data`
 * via the LAYOUT.POINT stride. Returns { baked, readback } for a byte-parity
 * assertion -- they must be identical.
 * @param {Parameters<typeof bakeFieldToGl>[0]} [opts]
 */
export function roundTrip(opts) {
    const { baked, field } = bakeFieldToGl(opts);
    const readback = new Float32Array(baked.length);
    for (let i = 0; i < baked.length; i++) {
        readback[i] = field.data[i * POINT_STRIDE + POINT_OFFSETS.r]; // r channel holds the height
    }
    return { baked, readback };
}

// CLI smoke run: `node examples/field-to-gl.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const { baked, readback } = roundTrip({ w: 64, h: 64 });
    let exact = true;
    for (let i = 0; i < baked.length; i++) if (baked[i] !== readback[i]) { exact = false; break; }
    console.log(`field-to-gl: ${baked.length} cells round-tripped through a lite-gl field, bit-exact=${exact}`);
}

#!/usr/bin/env node
// Regenerate the golden hashes used in Noise.test.js.
// Run this only when the underlying kernel deliberately changes.
//   node scripts/regenerate-goldens.mjs

import { seedNoise, fbm2, warp2, curl3, fillField2, tileableField2, fillField3, createNoise } from '../../Noise.js';

function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
}

// GOLDEN_FIELD_HASH
seedNoise(42);
{
    const w = 256, h = 256;
    const out = new Float32Array(w * h);
    fillField2(out, w, h, { scale: 0.01 });
    const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    console.log('GOLDEN_FIELD_HASH =', fnv1a(bytes).toString(16));
}

// GOLDEN_WARP_HASH
seedNoise(42);
{
    const w = 128, h = 128;
    const out = new Float32Array(w * h);
    const tmp = { x: 0, y: 0 };
    let idx = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            warp2(x * 0.01, y * 0.01, 1.5, tmp);
            out[idx++] = fbm2(tmp.x, tmp.y);
        }
    }
    const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    console.log('GOLDEN_WARP_HASH  =', fnv1a(bytes).toString(16));
}

// GOLDEN_CURL3_HASH
seedNoise(42);
{
    const w = 32, h = 32, d = 8;
    const out = new Float32Array(w * h * d * 3);
    const tmp = { x: 0, y: 0, z: 0 };
    let idx = 0;
    for (let z = 0; z < d; z++) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                curl3(x * 0.05, y * 0.05, z * 0.05, tmp);
                out[idx++] = tmp.x;
                out[idx++] = tmp.y;
                out[idx++] = tmp.z;
            }
        }
    }
    const bytes = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    console.log('GOLDEN_CURL3_HASH =', fnv1a(bytes).toString(16));
}

// v1.3.0 goldens. Computed via createNoise(42) to match the functional suite;
// instance == module at the same seed, so the module functions would agree.
{
    const n = createNoise(42);
    const rf = new Float32Array(128 * 128), bf = new Float32Array(128 * 128);
    let i = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) rf[i++] = n.ridged2(x * 0.02, y * 0.02);
    i = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) bf[i++] = n.billow2(x * 0.02, y * 0.02);
    console.log('GOLDEN_RIDGED_HASH =', fnv1a(new Uint8Array(rf.buffer)).toString(16));
    console.log('GOLDEN_BILLOW_HASH =', fnv1a(new Uint8Array(bf.buffer)).toString(16));

    const tf = new Float32Array(64 * 64);
    i = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) tf[i++] = n.tileable2(x / 64 * 4, y / 64 * 4, 4, 4);
    console.log('GOLDEN_TILE_HASH   =', fnv1a(new Uint8Array(tf.buffer)).toString(16));

    const lf = new Float32Array(720);
    for (let k = 0; k < 720; k++) lf[k] = n.noiseLoop(k / 720 * Math.PI * 2, 1.5);
    console.log('GOLDEN_LOOP_HASH   =', fnv1a(new Uint8Array(lf.buffer)).toString(16));
}

// v1.5.0 goldens -- tileableField2, 64x64, periodX=periodY=4, octaves=4,
// lacunarity=2, gain=0.5, one per model, via the MODULE functions after
// seedNoise(42) (instance == module at the same seed).
seedNoise(42);
{
    for (const model of ['fbm', 'ridged', 'billow']) {
        const f = new Float32Array(64 * 64);
        tileableField2(f, 64, 64, { model, periodX: 4, periodY: 4, octaves: 4, lacunarity: 2, gain: 0.5 });
        const tag = 'GOLDEN_TF2_' + model.toUpperCase();
        console.log(tag.padEnd(18) + '=', fnv1a(new Uint8Array(f.buffer)).toString(16));
    }
}

// v1.6.0 goldens -- fillField3, 32x32x32 Float32 volume, scale=0.05, octaves=4,
// lacunarity=2, gain=0.5, one per model, via the MODULE functions after
// seedNoise(42) (instance == module at the same seed).
seedNoise(42);
{
    for (const model of ['fbm', 'ridged', 'billow']) {
        const f = new Float32Array(32 * 32 * 32);
        fillField3(f, 32, 32, 32, { model, scale: 0.05, octaves: 4, lacunarity: 2, gain: 0.5 });
        const tag = 'GOLDEN_FF3_' + model.toUpperCase();
        console.log(tag.padEnd(18) + '=', fnv1a(new Uint8Array(f.buffer)).toString(16));
    }
}

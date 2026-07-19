#!/usr/bin/env node
// Regenerate the golden hashes used in Noise.test.js.
// Run this only when the underlying kernel deliberately changes.
//   node scripts/regenerate-goldens.mjs

import { seedNoise, fbm2, warp2, curl3, fillField2 } from '../../Noise.js';

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

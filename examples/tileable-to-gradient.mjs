/**
 * Recipe: paint a seamless lite-noise tile through a @zakkster/lite-gradient-studio LUT.
 *
 * `tileableField2` bakes a SEAMLESS scalar field. On a GRID-ALIGNED bake -- a
 * power-of-two width, an integer period, `ox = oy = 0` -- the wrap is bit-exact
 * (`w * (period / w) === period` in float64). Map that field through a gradient
 * LUT (`bakeGradientToLut` -> `sampleLut`) and the COLOURED tile is still
 * bit-exact seamless: the colour map is a pure per-cell function, so identical
 * field samples become identical pixels, and the wrap the field guarantees is
 * inherited by the texture verbatim. This is the first real wiring of the v1.5
 * `tileableField2` feature into its intended consumer.
 *
 * The seam is proven headless, the same shape as examples/field-to-gl.mjs proves
 * its round-trip: bake the origin field AND the single wrap column (the column at
 * `x = w*stepX`, which equals `period` only on a grid-aligned bake), colour BOTH
 * through the SAME LUT and the SAME global normalization, and assert the coloured
 * wrap column is byte-identical to coloured column 0. A wrong normalization scope,
 * a lossy colour step, or a non-grid-aligned bake shows immediately. The live
 * gradient rendering is lite-gradient-studio's own tested territory -- this proves
 * the DATA handoff.
 *
 * The returned `texture` is a packed RGBA-LE `Uint32Array`, ImageData-ready:
 *     new ImageData(new Uint8ClampedArray(texture.buffer), w, h);
 *
 * Zero runtime dependency added: examples/ only, the peer is a devDependency.
 *
 * Peer: @zakkster/lite-gradient-studio@^1.3.0.
 */

import { createNoise } from '../Noise.js';
import { bakeGradientToLut, sampleLut, gradientOcean } from '@zakkster/lite-gradient-studio';

export const MODELS = ['fbm', 'ridged', 'billow'];

/**
 * Bake a grid-aligned seamless tile, colour it through a gradient LUT, and also
 * colour the single wrap column so the seam can be checked bit-exact.
 * @param {{w?:number, h?:number, period?:number, model?:'fbm'|'ridged'|'billow',
 *          seed?:number, octaves?:number, gradient?:object, lutRes?:number}} [opts]
 * @returns {{noise:object, field:Float64Array, texture:Uint32Array,
 *            wrapColour:Uint32Array, w:number, h:number, period:number, model:string}}
 */
export function paintTile(opts = {}) {
    const w = opts.w ?? 256, h = opts.h ?? 256;
    const period = opts.period ?? 4;          // integer period + pow2 width => grid-aligned
    const model = opts.model ?? 'fbm';
    const seed = opts.seed ?? 42;
    const octaves = opts.octaves ?? 5;
    const gradient = opts.gradient ?? gradientOcean;
    const lutRes = opts.lutRes ?? 256;

    // Fail closed: the bit-exact wrap holds ONLY when the grid is aligned. A
    // non-aligned bake still tiles "seamlessly to float epsilon", but this recipe
    // sells the EXACT wrap -- refuse anything that would quietly weaken it, rather
    // than paint a tile that is a few ULPs off at the seam (House Law: fail closed).
    if (w * (period / w) !== period) {
        throw new RangeError(`tileable-to-gradient: dims not grid-aligned (w=${w}, period=${period}); ` +
            `use a power-of-two width and an integer period so w*(period/w) === period exactly`);
    }
    // The colour source must be a real lite-gradient-studio Gradient (a stops
    // array + sampleArray), or bakeGradientToLut has nothing to bake.
    if (!(gradient && Array.isArray(gradient.stops) && typeof gradient.sampleArray === 'function')) {
        throw new TypeError('tileable-to-gradient: gradient must be a lite-gradient-studio Gradient');
    }

    const noise = createNoise(seed);
    const stepX = period / w;

    // Raw (un-normalized) field: the raw multifractal is what wraps bit-exact.
    // `normalize` is a global min/max pass, so a colour map (which needs t in
    // [0,1]) must apply ONE scale to both the field and the separately-baked wrap
    // column -- normalizing each independently would use different min/max and
    // desync the seam. So bake raw, find the global range once, and reuse it.
    const field = new Float64Array(w * h);
    noise.tileableField2(field, w, h, { model, periodX: period, periodY: period, octaves });
    const wrapCol = new Float64Array(h);      // the column at x = w*stepX === period
    noise.tileableField2(wrapCol, 1, h, { model, periodX: period, periodY: period, octaves, ox: w * stepX });

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < field.length; i++) { const v = field[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = (hi - lo) || 1;

    const lut = bakeGradientToLut(gradient, lutRes);
    const texture = new Uint32Array(w * h);
    for (let i = 0; i < field.length; i++) texture[i] = sampleLut(lut, (field[i] - lo) / span) >>> 0;
    const wrapColour = new Uint32Array(h);
    for (let y = 0; y < h; y++) wrapColour[y] = sampleLut(lut, (wrapCol[y] - lo) / span) >>> 0;

    return { noise, field, texture, wrapColour, w, h, period, model };
}

/**
 * The seam gap in COLOUR space: the max per-channel delta between the wrap column
 * and column 0. 0 on a grid-aligned bake, every model -- the coloured tile wraps
 * bit-exact. A single number so a regression is one strictEqual away.
 * @param {Parameters<typeof paintTile>[0]} [opts]
 * @returns {number}
 */
export function colourSeamGap(opts) {
    const { texture, wrapColour, w, h } = paintTile(opts);
    let maxGap = 0;
    for (let y = 0; y < h; y++) {
        const a = texture[y * w + 0] >>> 0, b = wrapColour[y] >>> 0;
        const d = Math.max(
            Math.abs((a & 255) - (b & 255)),
            Math.abs(((a >>> 8) & 255) - ((b >>> 8) & 255)),
            Math.abs(((a >>> 16) & 255) - ((b >>> 16) & 255)),
            Math.abs(((a >>> 24) & 255) - ((b >>> 24) & 255)),
        );
        if (d > maxGap) maxGap = d;
    }
    return maxGap;
}

// CLI smoke run: `node examples/tileable-to-gradient.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    for (const model of MODELS) {
        const gap = colourSeamGap({ w: 256, h: 256, period: 4, model });
        console.log(`tileable-to-gradient: 256x256 ${model} tile painted through gradientOcean, colour seam gap=${gap}`);
    }
}

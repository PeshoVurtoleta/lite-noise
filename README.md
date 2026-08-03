# @zakkster/lite-noise

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-noise.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-noise)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-noise?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-noise)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-noise?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-noise)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-noise?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-noise)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Hot%20path-00C853?style=for-the-badge&logo=leaf&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational?style=for-the-badge)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

## 🌊 What is lite-noise?

`@zakkster/lite-noise` generates coherent noise for terrain, particles, animations, and procedural art — all deterministic and zero-allocation.

**New in v1.1.0:** field baking, Quilez-style domain warp, and 3D curl.

It gives you:

- 🌊 Simplex 2D and 3D noise
- 🏔️ FBM (fractal Brownian motion) with configurable octaves
- ⛰️ `ridged2` / `billow2` multifractals — mountains and clouds, sharing the FBM skeleton
- 🔁 `noiseLoop` — seamless periodic 1D noise for perfect animation loops
- 🧩 `tileable2` — seamless tiling textures (cross-checked by `lite-patternforge`'s `seamlessScore`)
- 🌀 Curl noise (2D and 3D) for smoke, fluid, and volumetric particle movement
- 🌀 Quilez-style domain warping over FBM
- 🗺️ `fillField2` — bake a Float32Array heightfield in one call, row-incremental coord stepping, optional `normalize` to [0,1]
- 🎲 Seeded via an inlined Mulberry32 PRNG (deterministic, reproducible, **zero runtime dependencies**)
- 0️⃣ Zero allocation in any hot-path function (unrolled FBM, no rest/spread, no per-cell object synthesis)
- 🧹 Caller-owned output for `curl2` / `curl3` / `warp2` (no shared reference bugs)
- 🛡️ Zero-alloc claim made falsifiable via `@zakkster/lite-gc-profiler` gates (`npm run torture`)
- 🪶 ~2.24 KB minified + gzipped, self-contained (zero dependencies; measured by `npm run bundle-check`)

Part of the [@zakkster/lite-*](https://www.npmjs.com/org/zakkster) ecosystem — micro-libraries built for deterministic, cache-friendly game development.

## 🚀 Install

```bash
npm i @zakkster/lite-noise
```

## 🕹️ Quick Start

```javascript
import {
    seedNoise,
    simplex2, simplex3,
    fbm2, fbm3,
    ridged2, billow2,
    noiseLoop, tileable2,
    curl2, curl3,
    warp2,
    fillField2,
} from '@zakkster/lite-noise';

// Seed for reproducibility
seedNoise(42);

// v1.3.0: ridged mountains + billow clouds (share the FBM octave skeleton)
const peak = ridged2(x * 0.01, y * 0.01, 6);
const puff = billow2(x * 0.01, y * 0.01, 6);

// v1.3.0: a perfect animation loop — t sweeps 0..2π, closes seamlessly
const wobble = noiseLoop((frame / TOTAL) * Math.PI * 2, 1.5);

// v1.3.0: a seamless tiling texture, period 4 in noise space
const tile = tileable2(u * 4, v * 4, 4, 4);  // wraps edge-to-edge

// v1.1.0: bake a heightfield in one call, zero allocation
const heightmap = new Float32Array(256 * 256);
fillField2(heightmap, 256, 256, { scale: 0.01, octaves: 6 });

// v1.1.0: Quilez-style domain warp → richer procedural art per byte
const warped = { x: 0, y: 0 };
warp2(x * 0.01, y * 0.01, 1.5, warped);
const value = fbm2(warped.x, warped.y);

// v1.1.0: 3D curl for volumetric smoke (twelve simplex3 samples, caller-owned out)
const flow3d = { x: 0, y: 0, z: 0 };
curl3(px * 0.005, py * 0.005, pz * 0.005, flow3d);

// Fluid particles (zero-GC)
const vel = { x: 0, y: 0 };
curl2(particle.x * 0.005, particle.y * 0.005, vel);
particle.vx += vel.x * 0.5;
particle.vy += vel.y * 0.5;
```

## 🧭 Two consumers? Use `createNoise`

There are two ways to sample, and the difference is ownership of the permutation table.

**`createNoise(seed)` — an independent field.** Each instance owns its own table. Two instances are two fields that cannot disturb each other, which is what you want the moment more than one subsystem samples noise on the same page.

```javascript
import { createNoise } from '@zakkster/lite-noise';

const terrain   = createNoise(42);   // its own table
const particles = createNoise(7);    // a different, independent table

terrain.fillField2(field, w, h, { scale: 0.01, octaves: 6 });
particles.curl2(x * 0.005, y * 0.005, vel);
// Neither call can change what the other samples. Reseed one with
// `particles.seed(99)` and `terrain` is untouched.
```

Every module function has an instance method of the same name: `simplex2`, `simplex3`, `fbm2`, `fbm3`, `curl2`, `curl3`, `warp2`, `fillField2`, plus `.seed(s)` to re-seed in place. An instance at seed `S` is byte-identical to the module functions after `seedNoise(S)` — same values, isolated ownership.

**The module functions — one shared table.** Convenient for a single consumer, but they share one module-scoped table that `seedNoise` rewrites for *everyone*:

```javascript
// terrain module
seedNoise(42);
const h = simplex2(x, y);        // uses seed-42 table

// particles module (elsewhere in the same process)
seedNoise(7);                     // ← now everyone samples from seed-7
const p = simplex2(px, py);       // seed-7 table

// terrain module samples again
const h2 = simplex2(x, y);        // ← this changed silently
```

Under a single seed and single consumer this is invisible; the moment two consumers each own "their" seed, it isn't. `seedNoise` warns once (dev builds) when called more than once, naming `createNoise` as the fix. When in doubt, give each consumer its own `createNoise(seed)`.

## 📊 Comparison

| Library         | Size          | Seeded  | FBM     | Warp    | Curl 2D | Curl 3D | Field bake | Zero-GC | Install                              |
|-----------------|--------------:|:-------:|:-------:|:-------:|:-------:|:-------:|:----------:|:-------:|--------------------------------------|
| simplex-noise   | ~8 KB         | No      | No      | No      | No      | No      | No         | No      | `npm i simplex-noise`                |
| noisejs         | ~4 KB         | Yes     | No      | No      | No      | No      | No         | No      | `npm i noisejs`                      |
| **lite-noise**  | **~2.24 KB**† | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes**    | **Yes** | `npm i @zakkster/lite-noise`         |

† lite-noise's figure is minified **+ gzipped**, self-contained — the full installed footprint with **zero runtime dependencies** (2,291 B, `npm run bundle-check`). The other libraries' sizes are their published bundle sizes as listed on npm. And this figure buys more: ridged/billow multifractals, seamless `noiseLoop`, and `tileable2` on top of the columns above.

## ⚙️ API

Every sampler below exists twice: as a module function sharing one table, and as a method on a `Noise` instance owning its own table. Same signatures, same values at the same seed.

### Instance / factory

- `createNoise(seed?) → Noise` — an independent noise field owning its own permutation table. The way to run two consumers without collision.
- `new Noise(seed?)` — the class behind `createNoise`, exported for `instanceof` / typing.
- `noise.seed(seed) → this` — re-seed an instance in place; affects only that instance.
- `noise.simplex2 / simplex3 / fbm2 / fbm3 / ridged2 / billow2 / noiseLoop / tileable2 / curl2 / curl3 / warp2 / fillField2` — instance methods mirroring the module functions below.

### Scalar samplers

- `simplex2(x, y) → number` — 2D Simplex, approx. `[-1, 1]`
- `simplex3(x, y, z) → number` — 3D Simplex, approx. `[-1, 1]`
- `fbm2(x, y, octaves?, lacunarity?, gain?) → number` — unrolled 2D FBM, zero alloc. `octaves ≥ 1`; `octaves = 0` returns `0`, not `NaN`. **`gain ≥ 0`** (per-octave amplitude decay, the standard FBM domain, typically `0..1`) — a negative gain alternates the amplitude sign and pushes the output past `~[-1, 1]`. This domain caveat is shared by `ridged2` / `billow2`.
- `fbm3(x, y, z, octaves?, lacunarity?, gain?) → number` — unrolled 3D FBM, same octaves and `gain ≥ 0` contract.
- `ridged2(x, y, octaves?, lacunarity?, gain?) → number` — ridged multifractal, `(1 − |simplex|)²` per octave over the shared FBM skeleton. Sharp creases reaching the unit ceiling; range ~`[0, 1]`, skewed high. Same octaves contract. The `[0, 1]` range holds for `gain ≥ 0` (the FBM domain); a negative gain voids it (see FBM note below).
- `billow2(x, y, octaves?, lacunarity?, gain?) → number` — billow, `|simplex|` per octave. Soft absolute-value fold piling at zero; range ~`[0, 1]`. Same octaves and `gain ≥ 0` contract.
- `noiseLoop(t, radius?) → number` — seamless periodic 1D noise on a circle of radius `radius` (default `1`). `noiseLoop(0) === noiseLoop(2π)` **exactly** and the derivative matches at the seam — drive `t` over `0..2π` for a perfect loop. `t` is reduced `mod 2π`.
- `tileable2(x, y, periodX, periodY) → number` — tileable 2D noise over `[0, periodX) × [0, periodY)`. Opposite edges are byte-identical (`tileable2(0, y) === tileable2(periodX, y)`), so tiles are seamless by construction. Four `simplex2` samples; the blend narrows the extremes slightly inside `[-1, 1]`. **Precondition:** `periodX, periodY > 0` — a period of `0` divides by zero and returns a non-finite value (`NaN` or `±Infinity`) (unguarded on the hot path; a zero tile size is a caller error, not a data value).

### Vector samplers (caller-owned out)

- `curl2(x, y, out) → out` — divergence-free 2D vector. `out = { x, y }`. Typical magnitude for scale ~0.005 inputs: mean `|v| ≈ 3.4`. Scale before wiring to particle velocities.
- `curl3(x, y, z, out) → out` — divergence-free 3D vector via Bridson-style offset vector-potential (twelve `simplex3` samples). `out = { x, y, z }`. Typical `mean |v| ≈ 3.8`, `max ≈ 10.6`. Divergence residual ~0.6 % of `|v|` — finite-difference truncation floor.
- `warp2(x, y, strength, out) → out` — Quilez-style domain warp; writes warped coords into `out = { x, y }`. Compose with `fbm2(out.x, out.y)`. `strength = 0` returns the input unchanged.

### Field bake

- `fillField2(out, w, h, opts?) → out` — bake a `w × h` FBM heightfield into a caller-supplied `Float32Array` / `Float64Array`. `opts` (all optional): `scale`, `octaves`, `lacunarity`, `gain`, `ox`, `oy`, `normalize`. Row-incremental coord stepping (no per-cell multiplies), zero allocation. The raw fill is amplitude-normalised but ~`[-0.84, 0.82]` at the defaults; `normalize: true` does a second in-place pass to exact `[0, 1]` (a colour ramp usually wants this). `out` is caller-owned and written start-to-end — don't alias it with anything read during the call.

### Seed

- `seedNoise(seed?)` — build the **shared** module permutation table. Call once, or call again to re-seed. Auto-seeded with `0` on module load. Warns once in dev builds if called more than once (silent under `NODE_ENV === 'production'`); for independent fields use `createNoise` instead.

## 🛡️ Zero-GC — falsifiable, not asserted

The zero-allocation claim on every hot path (`simplex2`, `simplex3`, `fbm2`, `fbm3`, `ridged2`, `billow2`, `noiseLoop`, `tileable2`, `curl2`, `curl3`, `warp2`, and the `fillField2` bakes incl. `normalize`) — across **both** the module functions and the instance methods — is gated by [`@zakkster/lite-gc-profiler`](https://www.npmjs.com/package/@zakkster/lite-gc-profiler):

```bash
npm run torture
```

Point samplers use `measureOps` / `checkOps` with `stabilize: true` so heap deltas reflect the surviving-allocation delta (retention), not transient churn. Rules: `maxBytesPerOp: 2` (V8's inline-cache / feedback-vector noise floor per the profiler docs) plus `maxMajorsPerKOp: 0` — a real allocation crosses both bars, V8 noise crosses neither. Heavy `fillField2` bakes are gated on major-GC count and ArrayBuffer retention instead. `NOISE_TORTURE_BREAK=1 npm run torture` injects a leak and must exit non-zero — proof the gate can bite.

## 🎯 Determinism goldens

`seed 42` produces byte-identical fields across versions unless a kernel change is deliberate. The test suite commits FNV-1a hashes of three baked fields:

- 256×256 default `fillField2` → `ddef5970`
- 128×128 `warp2 + fbm2` → `ca4f9f1e`
- 32×32×8 `curl3` slab → `1ac7a518`
- 128×128 `ridged2` → `2342c230`
- 128×128 `billow2` → `acf96355`
- 64×64 period-4 `tileable2` → `b6d00662`
- 720-sample `noiseLoop` → `2cfa58f8`

Any change to those numbers is a breaking change and requires a CHANGELOG entry. Regenerate via `npm run goldens` when the change is intentional.

## 🔗 Ecosystem recipes

Runnable, CI-tested integration recipes live in [`examples/`](examples/) (not shipped in the tarball). Each adds **zero runtime dependency** — the peers are dev-only, and each recipe holds its own `createNoise` instance, so two on one page never collide (the reason the instance API came first).

- **`curl2` → `@zakkster/lite-particles`** ([`curl-advection.mjs`](examples/curl-advection.mjs)) — advect particles through a curl flow field. Needs no API from either side: an `onUpdate(p, dt)` hook samples `curl2` into a pre-allocated `{x,y}` and writes `p.vx`/`p.vy`. Both sides are 0 B/call, so the loop is zero-alloc.
- **`fillField2` → `@zakkster/lite-gl`** ([`field-to-gl.mjs`](examples/field-to-gl.mjs)) — a baked `Float32Array` *is* a GL instance buffer. Packs one `LAYOUT.POINT` per cell (stride 8, and `LAYOUT.POINT === lite-particles POINT_STRIDE`) and proves the handoff with a **bit-exact round-trip**. The live GPU upload/readback is lite-gl's own tested territory.
- **Curl ambient behavior** ([`ambient-curl.mjs`](examples/ambient-curl.mjs)) — a `registerBehavior('CURL', …)` whose `tick` advances particles through a curl field. Registration + physics are CI-tested headless; the canvas render is browser-only. ambient-fx keeps its zero-dep pledge — a recipe, not a dependency.

**N1 composability is asserted at the integration level:** two instance-backed flows interleaved in one process produce byte-identical trajectories to each run alone. `npm test` runs all of this against the installed peers.

## 🧪 Benchmark

```bash
npm run bench
```

Measures three ways to bake a 256×256, 6-octave FBM heightfield (naive alloc-per-bake, row-step reused buffer, `fillField2`), median-of-20 with a 3-rep warmup. Bench output carries a machine stamp (Node version, platform, CPU) so numbers trace back to the hardware they were measured on.

The dominant cost is ~393K `simplex2` calls per bake (256 × 256 × 6 octaves). Saved two-multiplies-per-cell register as ~1.03–1.07× against that — the row-step optimisation is numerically clean (drift < Float32 epsilon over 512×512) but not a headline speedup. The real win of `fillField2` is API surface (one call, no user-written loop) and buffer reuse.

## 📦 TypeScript

Full declarations in `Noise.d.ts` — includes `Vec2`, `Vec3`, and `FillField2Options`.

## 📚 LLM-Friendly Documentation

See `llms.txt` for AI-optimized metadata and usage examples.

## License

MIT. Copyright (c) Zahary Shinikchiev.

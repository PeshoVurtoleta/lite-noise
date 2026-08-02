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
- 🌀 Curl noise (2D and 3D) for smoke, fluid, and volumetric particle movement
- 🌀 Quilez-style domain warping over FBM
- 🗺️ `fillField2` — bake a Float32Array heightfield in one call, row-incremental coord stepping
- 🎲 Seeded via an inlined Mulberry32 PRNG (deterministic, reproducible, **zero runtime dependencies**)
- 0️⃣ Zero allocation in any hot-path function (unrolled FBM, no rest/spread, no per-cell object synthesis)
- 🧹 Caller-owned output for `curl2` / `curl3` / `warp2` (no shared reference bugs)
- 🛡️ Zero-alloc claim made falsifiable via `@zakkster/lite-gc-profiler` gates (`npm run test:gc`)
- 🪶 ~1.98 KB minified + gzipped, self-contained (zero dependencies; measured by `npm run bundle-check`)

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
    curl2, curl3,
    warp2,
    fillField2,
} from '@zakkster/lite-noise';

// Seed for reproducibility
seedNoise(42);

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
| **lite-noise**  | **~1.98 KB**† | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes**    | **Yes** | `npm i @zakkster/lite-noise`         |

† lite-noise's figure is minified **+ gzipped**, self-contained — the full installed footprint with **zero runtime dependencies** (1,975 B, `npm run bundle-check`). The other libraries' sizes are their published bundle sizes as listed on npm.

## ⚙️ API

Every sampler below exists twice: as a module function sharing one table, and as a method on a `Noise` instance owning its own table. Same signatures, same values at the same seed.

### Instance / factory

- `createNoise(seed?) → Noise` — an independent noise field owning its own permutation table. The way to run two consumers without collision.
- `new Noise(seed?)` — the class behind `createNoise`, exported for `instanceof` / typing.
- `noise.seed(seed) → this` — re-seed an instance in place; affects only that instance.
- `noise.simplex2 / simplex3 / fbm2 / fbm3 / curl2 / curl3 / warp2 / fillField2` — instance methods mirroring the module functions below.

### Scalar samplers

- `simplex2(x, y) → number` — 2D Simplex, approx. `[-1, 1]`
- `simplex3(x, y, z) → number` — 3D Simplex, approx. `[-1, 1]`
- `fbm2(x, y, octaves?, lacunarity?, gain?) → number` — unrolled 2D FBM, zero alloc. `octaves ≥ 1`; `octaves = 0` returns `0`, not `NaN`.
- `fbm3(x, y, z, octaves?, lacunarity?, gain?) → number` — unrolled 3D FBM, same octaves contract.

### Vector samplers (caller-owned out)

- `curl2(x, y, out) → out` — divergence-free 2D vector. `out = { x, y }`. Typical magnitude for scale ~0.005 inputs: mean `|v| ≈ 3.4`. Scale before wiring to particle velocities.
- `curl3(x, y, z, out) → out` — divergence-free 3D vector via Bridson-style offset vector-potential (twelve `simplex3` samples). `out = { x, y, z }`. Typical `mean |v| ≈ 3.8`, `max ≈ 10.6`. Divergence residual ~0.6 % of `|v|` — finite-difference truncation floor.
- `warp2(x, y, strength, out) → out` — Quilez-style domain warp; writes warped coords into `out = { x, y }`. Compose with `fbm2(out.x, out.y)`. `strength = 0` returns the input unchanged.

### Field bake

- `fillField2(out, w, h, opts?) → out` — bake a `w × h` FBM heightfield into a caller-supplied `Float32Array` / `Float64Array`. `opts` (all optional): `scale`, `octaves`, `lacunarity`, `gain`, `ox`, `oy`. Row-incremental coord stepping (no per-cell multiplies), zero allocation.

### Seed

- `seedNoise(seed?)` — build the **shared** module permutation table. Call once, or call again to re-seed. Auto-seeded with `0` on module load. Warns once in dev builds if called more than once (silent under `NODE_ENV === 'production'`); for independent fields use `createNoise` instead.

## 🛡️ Zero-GC — falsifiable, not asserted

The zero-allocation claim on every hot path (`simplex2`, `simplex3`, `fbm2`, `fbm3`, `curl2`, `curl3`, `warp2`, and both `fillField2` opts paths) is gated by [`@zakkster/lite-gc-profiler`](https://www.npmjs.com/package/@zakkster/lite-gc-profiler):

```bash
npm run test:gc
```

The gate uses `assertOps` with `stabilize: true` so heap deltas reflect the surviving-allocation delta (retention), not transient churn. Rules: `maxBytesPerOp: 2` (V8's inline-cache / feedback-vector noise floor per the profiler docs) plus `maxMajorsPerKOp: 0` — a real allocation crosses both bars, V8 noise crosses neither.

## 🎯 Determinism goldens

`seed 42` produces byte-identical fields across versions unless a kernel change is deliberate. The test suite commits FNV-1a hashes of three baked fields:

- 256×256 default `fillField2` → `ddef5970`
- 128×128 `warp2 + fbm2` → `ca4f9f1e`
- 32×32×8 `curl3` slab → `1ac7a518`

Any change to those numbers is a breaking change and requires a CHANGELOG entry. Regenerate via `npm run goldens` when the change is intentional.

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

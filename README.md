# @zakkster/lite-noise

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-noise.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-noise)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-noise?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-noise)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-noise?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-noise)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-noise?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-noise)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-1%20(%40zakkster%2Flite--random)-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

## 🌊 What is lite-noise?

`@zakkster/lite-noise` generates coherent noise for terrain, particles, animations, and procedural art — all deterministic and zero-allocation.

It gives you:

- 🌊 Simplex 2D and 3D noise
- 🏔️ FBM (fractal Brownian motion) with configurable octaves
- 🌀 Curl noise for smoke/fluid particle movement
- 🎲 Seeded via `@zakkster/lite-random` (deterministic, reproducible)
- 0️⃣ Zero allocation in any hot-path function (unrolled FBM, no rest/spread)
- 🧹 Caller-owned output for curl2 (no shared reference bugs)
- 🪶 < 1.5 KB minified

Part of the [@zakkster/lite-*](https://www.npmjs.com/org/zakkster) ecosystem — micro-libraries built for deterministic, cache-friendly game development.

## 🚀 Install

```bash
npm i @zakkster/lite-noise
```

## 🕹️ Quick Start

```javascript
import { seedNoise, simplex2, fbm2, curl2 } from '@zakkster/lite-noise';

// Seed for reproducibility
seedNoise(42);

// Terrain heightmap
for (let x = 0; x < 256; x++) {
    for (let y = 0; y < 256; y++) {
        heightmap[x + y * 256] = fbm2(x * 0.01, y * 0.01, 6);
    }
}

// Fluid particles (zero-GC)
const vel = { x: 0, y: 0 };
curl2(particle.x * 0.005, particle.y * 0.005, vel);
particle.vx += vel.x * 0.5;
particle.vy += vel.y * 0.5;
```

## 📊 Comparison

| Library | Size | Seeded | FBM | Curl | Zero-GC | Install |
|---------|------|--------|-----|------|---------|---------|
| simplex-noise | ~8 KB | No | No | No | No | `npm i simplex-noise` |
| noisejs | ~4 KB | Yes | No | No | No | `npm i noisejs` |
| **lite-noise** | **< 1.5 KB** | **Yes** | **Yes** | **Yes** | **Yes** | **`npm i @zakkster/lite-noise`** |

## ⚙️ API

### `seedNoise(seed?)` — Build permutation table. Call once or re-seed.
### `simplex2(x, y)` — 2D Simplex noise → [-1, 1]
### `simplex3(x, y, z)` — 3D Simplex noise → [-1, 1]
### `fbm2(x, y, octaves?, lacunarity?, gain?)` — 2D fractal noise (zero alloc, unrolled)
### `fbm3(x, y, z, octaves?, lacunarity?, gain?)` — 3D fractal noise
### `curl2(x, y, out)` — Divergence-free 2D vector. Caller owns `out`.

## 🧪 Benchmark

```
256×256 terrain (fbm2, 6 octaves):
  simplex-noise + manual FBM: 12ms (allocates per octave)
  lite-noise fbm2:             4ms (zero allocation, unrolled loop)
```

## 📦 TypeScript

Full declarations included in `lite-noise.d.ts`.

## 📚 LLM-Friendly Documentation

See `llms.txt` for AI-optimized metadata and usage examples.

## License

MIT

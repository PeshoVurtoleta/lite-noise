# Changelog

All notable changes to `@zakkster/lite-noise`.

## [Unreleased] — 1.2.0 candidate

Two sessions, releasing together as the next minor: **N0** brought the package to the ecosystem's house law with **zero runtime dependencies**; **N1** added the instance API that fixes the shared-seed correctness bug (NS-01). The determinism goldens (`ddef5970` / `ca4f9f1e` / `1ac7a518`) are **unchanged throughout** — every change is behavior-neutral for existing callers, which is what keeps N1 a minor rather than a major.

### Added

- **`createNoise(seed)` / `Noise` / `noise.seed(s)` — instance-scoped noise (NS-01).** `createNoise` returns a `Noise` instance owning its own 512-byte permutation table. Two instances are two independent fields: sampling, seeding, or constructing one never changes another. Every module function has an instance method of the same name (`simplex2`, `simplex3`, `fbm2`, `fbm3`, `curl2`, `curl3`, `warp2`, `fillField2`), plus `.seed(s)` to re-seed in place. An instance at seed `S` is byte-identical to the module functions after `seedNoise(S)`. Before this, every consumer on a page shared one module-global table and the last to call `seedNoise` silently re-randomised the others — the bug that would surface first in a multi-consumer demo. The `Noise` class is exported for `instanceof` / typing.
- **`seedNoise` warns once (dev builds) when called more than once**, naming `createNoise` as the fix. Silent under `NODE_ENV === 'production'`. Turns the silent shared-table collision into a visible one.
- **Torture harness** — `test/torture.mjs` + `test/torture/{harness,t0-laws,t5-fuzz,t6-alloc,t9-controls}.mjs`, run via `npm run torture` (`node --expose-gc test/torture.mjs`, prints `ok` / exit 0). T0 metamorphic laws, T5 the NS-01 isolation finding made executable, T6 the zero-alloc gate over both module and instance surfaces plus one-table construction and 4096-cycle retention, T9 controls (every gate proven able to fail; `NOISE_TORTURE_BREAK=1` must exit non-zero). Replaces the single `magnitudes/` gc gate; matches the LiteBvh test layout.
- **`verify` script** — `test && torture && bundle-check`; `prepublishOnly` delegates to it.
- **`decisions/0001-lite-random.md`** — ADR recording the NS-05 dependency decision (Accepted: inline).

### Removed

- **`@zakkster/lite-random` runtime dependency (NS-05).** Used in exactly one place — `seedNoise`'s Fisher-Yates shuffle. Its six-line Mulberry32 core is now inlined (in `_seedPerm`), reproducing the previous `new Random(seed).next()` sequence byte-for-byte (the goldens are the proof). Reclaims the zero-dependency badge, makes the size claim reflect the true self-contained install, and removes the version-skew hazard (the old `^1.0.0` pin against lite-random's 1.1.0 could resolve a second copy alongside `lite-particles`'s `^1.1.0`).
- **`magnitudes/test/gc-gate.test.mjs` + `magnitudes/scripts/test-gc.mjs`** — superseded by T6 in the torture harness.

### Changed

- **Test runner: vitest -> `node --test`.** `test/Noise.test.js` ported to `node:test` + `node:assert/strict` (now 26 cases incl. the instance API). `vitest` removed as a `devDependency`; `vitest.config.mjs` deleted. `test` runs under `--expose-gc`.
- **Permutation seeding is in place.** `_seedPerm(perm, seed)` fills the 512-entry table directly (identity, Fisher-Yates, mirror) with no transient 256-byte scratch, so a `Noise` construction allocates exactly one buffer. Same output as before (goldens hold).
- **Size claim tracks the self-contained install through both sessions.** N0 inlined the dependency (1,472 B own-code externalised -> 1,518 B self-contained). N1's instance API (the `Noise` class + dual surface) brings it to **1,975 B min+gz**, stated as "~1.98 KB, zero dependencies" across README / llms.txt. `bundle-check` externalises nothing; ceiling raised 1,550 -> 2,048 B. Module functions stay explicit delegators (not bound methods off a default instance) so a `simplex2`-only import still tree-shakes the `Noise` class away.
- **`perlin` keyword removed** from `package.json`. The package implements Simplex noise, not classic Perlin gradient noise; there is no `perlin()` export.

## [1.1.0] — 2026-07-19

Field baking + domain warp + 3D curl. Zero-alloc claim now falsifiable via a `@zakkster/lite-gc-profiler` gate. Determinism goldens committed. Bundle budget refreshed under the 1.5 KB min+gz ceiling. Ships `LICENSE.txt`. Guarded `bundle-check` and `test:gc` so absence is no longer indistinguishable from success.

### Added

- **`fillField2(out, w, h, opts?)`** — bakes a `w × h` FBM heightfield into a caller-supplied `Float32Array` / `Float64Array`. Row-incremental coordinate stepping (`px += scale`, `py += scale`) replaces per-cell multiplies. `opts` is read via optional chaining (`opts?.x ?? default`) so the omitted-opts path allocates nothing. Options: `scale`, `octaves`, `lacunarity`, `gain`, `ox`, `oy`.
- **`warp2(x, y, strength, out)`** — Quilez-style domain warp. Two `fbm2` evaluations per sample using the canonical offset pairs (`5.2, 1.3` and `1.7, 9.2`). Writes warped `{x, y}` into caller-owned `out`. Compose with `fbm2(out.x, out.y)` for the final warped noise value.
- **`curl3(x, y, z, out)`** — finite-difference 3D curl over `simplex3`. Uses two offset scalar fields (offsets `100.0` and `200.0`) synthesised into a three-component vector potential, then central-differenced. Twelve `simplex3` samples per call. Writes `{x, y, z}` into caller-owned `out`. Suitable for volumetric smoke. Divergence residual ~0.6 % of `|v|` — the finite-difference truncation floor.
- **`Vec2`, `Vec3`, `FillField2Options`** TypeScript interfaces.
- **Zero-GC gate** — `test/gc-gate.test.mjs`, run via `npm run test:gc`. Uses `@zakkster/lite-gc-profiler`'s `assertOps` with `stabilize: true` for every hot path (`simplex2`, `simplex3`, `fbm2` × 2, `fbm3`, `curl2`, `curl3`, `warp2`, `fillField2` × 2). Rules: `{ maxBytesPerOp: 2, maxMajorsPerKOp: 0 }` — a real allocation crosses both bars, V8 IC noise crosses neither. `@zakkster/lite-gc-profiler ^1.7.0` added as a `devDependency`.
- **`scripts/test-gc.mjs`** — wrapper that runs the gate under `node --expose-gc --test`, mirrors TAP output, and asserts (a) child exit code 0, (b) at least `MIN_TESTS = 10` tests actually ran. Catches the failure mode where `node --test <glob>` silently succeeds when the glob matches zero files (the "lite-audio trap"). Legitimate gate-count changes require bumping `MIN_TESTS` — a review-visible diff.
- **`scripts/bundle-check.mjs`** — real size gate: esbuild `--minify` piped through `node:zlib.gzipSync` (matches bundlephobia's minzip semantics), asserts `< 1500 B`, `process.exit(1)` on regression. `esbuild ^0.25.0` added as `devDependency`. The old `npx esbuild ... --outfile=test-bundle.js` script exited 0 unconditionally; any regression would have published silently.
- **Determinism goldens** — FNV-1a hashes of three canonical fields (seed 42), committed in `Noise.test.js`:
  - `GOLDEN_FIELD_HASH = 'ddef5970'` — 256×256 default `fillField2`
  - `GOLDEN_WARP_HASH = 'ca4f9f1e'` — 128×128 `warp2 + fbm2`
  - `GOLDEN_CURL3_HASH = '1ac7a518'` — 32×32×8 packed `curl3` slab
  Any change to a golden is a breaking change. Regenerator lives at `scripts/regenerate-goldens.mjs` (`npm run goldens`).
- **Benchmark** — `bench/terrain.mjs`, `npm run bench`. Median-of-20 across three approaches (naive alloc-per-bake, row-step reused buffer, `fillField2`) at 256×256 × 6 octaves. Prints a machine stamp (Node version, platform, CPU) so numbers trace back to the hardware they were measured on.
- **`vitest.config.mjs`** — scopes vitest to `Noise.test.js`; `test/*.test.mjs` is owned by `node --test` under `--expose-gc`.
- **`LICENSE.txt`** — was present at repo root as `LICENSE` in v1.0.x but never listed in `files[]`, so the tarball shipped with an MIT declaration and no license text. Now shipped in the tarball and named to match the ecosystem's `LICENSE.txt` convention.
- **`.gitignore`** — covers `node_modules/`, `package-lock.json`, `test-bundle.js`, and standard editor / OS noise.
- **`engines.node`** = `>=18`; **`funding.type = github`**, `url = https://github.com/sponsors/PeshoVurtoleta`.

### Changed

- `fbm2` and `fbm3` now return `0` (not `NaN`) when `octaves <= 0`. The old code did `return total / maxAmp` with both terms zero, poisoning any buffer baked from a data-driven biome config where `octaves` came from JSON. Documented in `Noise.d.ts` and README.
- `curl2` internally uses a precomputed `_inv2eps = 1 / (2 * _eps)` — the per-axis divide becomes a multiply. Same output, same signature.
- `fillField2` opts read tightened from guarded ternaries to `opts?.x ?? default` (optional chaining + nullish coalescing). Zero-alloc regardless, but shorter minified — that's what paid for the octaves guard while keeping the bundle under budget.
- `package.json` — `main` prefixed as `"./Noise.js"`, `module` field added, `exports` block expanded to include `node` and `default` conditions (matching sibling packages), `LICENSE.txt` added to `files[]`.
- `test:gc` script now runs `scripts/test-gc.mjs` (see above); `bundle-check` runs `scripts/bundle-check.mjs` (see above). `prepublishOnly` chain unchanged in name; each step now genuinely gates.
- `CHANGELOG.md` and `Noise.d.ts` now shipped in the npm tarball (`files` in `package.json`).

### Documented

- **Shared module state** — `seedNoise` mutates a single module-scoped permutation table shared by every consumer. Called out in `README.md` (dedicated section), `llms.txt`, and the `Noise.d.ts` JSDoc on `seedNoise`. A `createNoise(seed)` factory returning an isolated instance is on the roadmap for v1.2.0; passing a `perm` parameter through every hot function would grow the bundle beyond the 1.5 KB ceiling and conflict with the "bytes in a hot body, not instructions" design law, so the fix is designed alongside the ridged / billow / tileable variants.
- **Typical curl magnitudes** noted in `README.md`, `llms.txt`, and `curl2` / `curl3` JSDoc — `curl2` mean `|v| ≈ 3.4`, `curl3` mean `|v| ≈ 3.8`, max `≈ 10.6` at scale ~0.005 inputs. Scale before wiring to particle velocities.
- **NaN / Infinity input behaviour** noted for `simplex2` / `simplex3` — the truncation-to-integer path yields `0` for either, rather than propagating `NaN`. Validate upstream if propagation is required.

### Fixed

- `Noise.test.js` imported from `./Noise.d.ts` (a types file) instead of `./Noise.js`. Now imports from `./Noise.js`.
- `LICENSE` file not shipped in the npm tarball (missing from `files[]`) — fixed by adding `LICENSE.txt` to `files[]`.
- `bundle-check` script exited 0 unconditionally — no size assertion, no regression guard. Now runs the real check with a hard ceiling.
- `test:gc` script glob (`test/*.test.mjs`) treated zero-match as success — a moved gate would silently green-light the whole zero-GC guarantee. Now asserts `tests >= MIN_TESTS`.
- Stale `maxBytesPerOp: 0` comment in `test/gc-gate.test.mjs` — the code has always used `2`, only the header comment was wrong.
- Bench header referenced a phantom "4 ms vs 12 ms" claim not present in any doc; softened to describe what the bench actually measures, and calls out that row-step's ~1.05× is real but far below the API-surface / buffer-reuse wins.

### Not changed

- Public signature of `curl2` — output values identical to v1.0.2 for the same seed and inputs. Confirmed by the existing correctness test.
- `simplex2`, `simplex3`, `fbm2`, `fbm3` (for `octaves >= 1`), `seedNoise` — bytewise identical output for any given seed; determinism is a hard contract.

### Bundle

- **1472 B min+gz** under `node:zlib.gzipSync` (28 B under the 1500 B ceiling).
- Previous CHANGELOG stated "1475 B / 25 B under" measured with `gzip -c`; the two tools differ by a few bytes on gzip header metadata. Node's `zlib.gzipSync` is the canonical measure (bundlephobia's minzip semantics) and is what `scripts/bundle-check.mjs` uses.

## [1.0.2] — prior

- Zero-GC seeded Simplex 2D/3D noise, unrolled FBM 2D/3D, `curl2` with caller-owned out.
- Deterministic seeding via `@zakkster/lite-random`.
- < 1.5 KB minified.

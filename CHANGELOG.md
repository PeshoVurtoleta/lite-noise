# Changelog

All notable changes to `@zakkster/lite-noise`.

## [1.4.0] — 2026-08-03

**N4** — ecosystem seams. Three runnable, CI-tested integration recipes proving lite-noise composes with its neighbors, adding **zero runtime dependency** (the peers are dev-only, and every published range/behavior is unchanged). No new exports; no change to `Noise.js` runtime code.

### Added

- **`examples/curl-advection.mjs`** — advect `@zakkster/lite-particles` through a `curl2` flow field. The seam needs no API from either package: an `Emitter` `onUpdate(p, dt)` hook samples `curl2` into a pre-allocated `{x,y}` and writes `p.vx`/`p.vy`. Both `curl2` and `Emitter.update` are 0 B/call, so the combined advection loop is zero-alloc.
- **`examples/field-to-gl.mjs`** — hand a baked `fillField2` heightfield to a `@zakkster/lite-gl` field. Packs one `LAYOUT.POINT` instance per cell (stride 8: `x,y,size,r,g,b,a,_pad`) and proves the handoff with a **bit-exact round-trip**: bake → `field.push` → read `field.data` back → byte-identical. Asserts `lite-gl LAYOUT.POINT === lite-particles POINT_STRIDE` (the shared contract). The live GPU upload/readback is lite-gl's own tested territory; this proves the data handoff headless.
- **`examples/ambient-curl.mjs`** — a curl-driven `registerBehavior('CURL', …)` for `@zakkster/lite-ambient-fx`. Registration and the pure `advance()` physics are CI-tested headless; `createAmbientFX(canvas, …)` and the draw calls are browser-only (documented). ambient-fx keeps its zero-dependency pledge — recipe, not dependency.
- **`test/recipes.test.js`** — runs all three recipes against the installed peers, asserts the field→GL round-trip is byte-exact, and asserts **N1 composability at the integration level**: two instance-backed flows interleaved in one process produce byte-identical trajectories to each run alone (the `createNoise` isolation guarantee, proven end-to-end).

### Changed

- **devDependencies** — added `@zakkster/lite-particles@^1.5.0`, `@zakkster/lite-gl@^1.4.0`, `@zakkster/lite-ambient-fx@^1.8.0` for the recipes, plus `@zakkster/lite-signal` + an `overrides` block to resolve lite-gl's transitive peer graph. All dev-only. `dependencies` stays empty — the "no runtime dependency" assertion is itself a test. `examples/` is not in `files[]`, so the tarball is unchanged.
- Version stamped 1.4.0 across `package.json`, the `Noise.js`/`Noise.d.ts` headers, and `llms.txt` (which gains an "Ecosystem recipes" section). Bundle is unchanged (2,291 B min+gz) — no runtime code moved.

## [1.3.0] — 2026-08-02

**N3** — terrain shapings and loop/tile variants. Four new functions plus the `fillField2` `normalize` option, all riding a shared octave skeleton so two multifractals cost far less than two copies of the FBM loop. The four pre-existing determinism goldens (`ddef5970` / `ca4f9f1e` / `1ac7a518`) are **unchanged** — the `fbm2` refactor onto `_octaves2` is byte-identical, so nothing moved for existing callers.

### Added

- **`ridged2(x, y, octaves?, lacunarity?, gain?)`** — ridged multifractal, `(1 - |simplex|)²` per octave. Sharp creases at zero-crossings that reach the unit ceiling; distribution skewed high. Mountains, cracked earth, veins. Range ~[0, 1]; degenerate `octaves <= 0` returns 0 (the shared skeleton's `maxAmp` guard).
- **`billow2(x, y, octaves?, lacunarity?, gain?)`** — billow, `|simplex|` per octave. A soft absolute-value fold piling mass at zero, no unit spikes. Clouds, rolling hills, smoke. Range ~[0, 1]; same degenerate guard.
- **`noiseLoop(t, radius = 1)`** — seamless periodic 1D noise by walking a circle of radius `radius` in the 2D field. `noiseLoop(0) === noiseLoop(2π)` **exactly** (the angle reduces `mod 2π`, and `0 + 2π = 2π`, `2π mod 2π = 0` are all bit-exact), and the derivative matches at the seam. Away from the canonical seam, adding `2π` rounds off low bits, so periodicity elsewhere holds to a few ULPs, not `===`.
- **`tileable2(x, y, periodX, periodY)`** — tileable 2D noise over `[0, periodX) × [0, periodY)`. A bilinear blend of the sample and its three period-wrapped neighbours: at every seam the vanishing corner weights make opposite edges evaluate to the identical expression, so `tileable2(0, y) === tileable2(periodX, y)` **exactly**, resolution-free. Four `simplex2` samples, zero allocation. Verified independently by `@zakkster/lite-patternforge`'s `seamlessScore` (added as a devDependency) — scores in the imperceptible band (< 0.02) at 256 px, periods 2 and 4. Note: `seamlessScore` compares edge columns directly, so for a full-bleed noise texture it floors at the texture's own per-pixel contrast (halves as resolution doubles) rather than at 0; the exact-wrap equality is the unconditional proof, the score is the calibrated cross-check.
- **`fillField2` `normalize: true` option** — an optional second in-place pass remapping the baked field to exact `[0, 1]` endpoints (the raw fill is amplitude-normalised but ~[-0.84, 0.82] at the defaults; a colour ramp usually wants 0..1). Allocation-free (two scalar-tracking passes, no temp buffer). A constant field maps to all-zero rather than dividing by zero. The omitted-`normalize` path is unchanged and still zero-alloc.
- Instance methods `ridged2` / `billow2` / `noiseLoop` / `tileable2` on `Noise`, byte-identical to the module functions at the same seed. New determinism goldens (`2342c230` / `acf96355` / `b6d00662` / `2cfa58f8`) committed and covered by `npm run goldens`.

### Changed

- **`fbm2` now delegates to a shared `_octaves2(perm, x, y, octaves, lacunarity, gain, mode)` skeleton** (`mode` 0/1/2 = fbm/ridged/billow). The mode-0 arithmetic is byte-identical to the previous inlined `_fbm2` — skipped branches never touch the sample — so the `fbm2`, warp, and field goldens do not move. This share is what let four functions land without four copies of the octave loop.
- **Bundle ceiling raised 2,048 → 2,560 B** (measured **2,291 B min+gz**), deliberately, for the four new functions. `ridged2`/`billow2` are one-line wrappers over `_octaves2`; `noiseLoop` and especially `tileable2`'s four-sample blend are genuinely new code the skeleton share can't absorb. `bundle-check` still externalises nothing — zero runtime dependencies hold.
- **Torture harness** extended: T0 gains L7 (loop seam exact + periodic-to-ULPs), L8 (tileable exact wrap), L9 (ridged/billow range + degenerate guard), and L6 now covers the new instance==module surfaces; T6 gates the four new hot paths (module + instance) and the `normalize` bake path at the same `{ maxBytesPerOp: 2, maxMajorsPerKOp: 0 }` ceiling.

### Documentation

- **`gain` domain clarified: `gain >= 0`.** The `ridged2` / `billow2` ~[0, 1] range (and `fbm2` / `fbm3`'s ~[-1, 1]) holds only for a non-negative gain — the standard FBM persistence, typically 0..1. A negative gain alternates the per-octave amplitude sign and pushes the output past those ranges; this latitude has always existed in `fbm2` and is now stated as a domain contract across all four functions (surfaced by the N3 QA boundary sweep). Not guarded on the hot path — gain < 0 is a caller error, not a data value. Also documents `tileable2`'s `periodX, periodY > 0` precondition (a period of 0 divides by zero and returns a non-finite value).

## [1.2.0] — 2026-08-02

Two sessions, releasing together as this minor: **N0** brought the package to the ecosystem's house law with **zero runtime dependencies**; **N1** added the instance API that fixes the shared-seed correctness bug (NS-01). The determinism goldens (`ddef5970` / `ca4f9f1e` / `1ac7a518`) are **unchanged throughout** — every change is behavior-neutral for existing callers, which is what keeps N1 a minor rather than a major.

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

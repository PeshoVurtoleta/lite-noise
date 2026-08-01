# ADR 0001 — the `@zakkster/lite-random` runtime dependency

- **Status:** Accepted — Option B (inline). Implemented in the N0 session; goldens unchanged.
- **Date:** 2026-08-01
- **Finding:** NS-05 (ROADMAP.md)
- **Session:** N0 (v1.1.1 hygiene pass)

## Context

`@zakkster/lite-random ^1.0.0` is the package's only runtime dependency. It is
used in exactly one place, `seedNoise` in `Noise.js`:

```js
import { Random } from '@zakkster/lite-random';

export function seedNoise(seed = 0) {
    const rng = new Random(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = (rng.next() * (i + 1)) | 0;   // <- only rng surface used
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) _perm[i] = p[i & 255];
}
```

The whole `Random` class is ~200 lines (range/int/gaussian/weighted/shuffle/...).
lite-noise touches **two** members of it: `new Random(seed)` and `rng.next()`.
`next()` is Mulberry32, six lines of arithmetic holding one 32-bit integer of
state.

Three facts make this a live decision rather than a formality:

1. **The house's first law is zero runtime dependencies.** lite-noise is the
   exception in the family, and the zero-dependency badge is a real adoption
   asset (it is part of what drew the inbound commercial interest around
   `lite-patternforge`).
2. **The size claim depends on it.** `bundle-check` externalizes lite-random and
   measures **1,472 B min+gz** — under the 1.5 KB claim. But lite-random is a
   `dependencies` entry, so bundlephobia's installed-footprint badge bundles it:
   **~1.9 KB min+gz**. The "< 1.5 KB" story is only true for own code.
3. **A version-skew hazard exists.** lite-noise pins `^1.0.0`; lite-random is at
   1.1.0 and `lite-particles` depends on `^1.1.0`. An app using both packages
   can resolve two copies of lite-random.

The ROADMAP's standing justification — *"every install bumps lite-random"* — is
a download-metric argument, not an engineering one, on a package the same author
owns.

## Options

### A. Keep it, drop the zero-dependency framing
Honest but concedes the badge and leaves the double-copy hazard. No code change.
At minimum, widen the range (see C).

### B. Inline the PRNG + shuffle, drop the dependency  — **recommended**
Vendor the six-line Mulberry32 core and the one Fisher-Yates loop into
`Noise.js`. Reclaims the zero-dependency badge, makes the "< 1.5 KB" claim true
against the installed footprint, and removes the version-skew hazard outright.

The determinism goldens (`GOLDEN_FIELD_HASH`, `_WARP_`, `_CURL3_`) are the safety
net: the inlined generator must reproduce lite-random's exact sequence, so the
inline is provably behavior-preserving the moment the golden suite stays green.
The sequence to reproduce byte-for-byte:

```js
// state = seed | 0
function _next() {
    let t = (_state = (_state + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
```

Cost: the module-level `seedNoise` becomes stateful in a second small way (an
RNG state int at seed time only — not a hot path). Attribution comment must
credit lite-random / Mulberry32 as the provenance.

### C. Keep it, widen `^1.0.0` -> `^1.1.0`
Cheapest. Removes only the double-copy hazard; keeps the dependency and its
effect on the badge and the size claim. A reasonable fallback if the maintainer
wants lite-random to stay a dependency for ecosystem-cohesion reasons.

## Decision

**Recommended: Option B.** The dependency buys one shuffle and costs the
zero-dependency badge, an honest sub-1.5 KB claim, and freedom from version
skew. Inlining is low-risk because the golden fields make behavior-preservation
executable rather than asserted. If the maintainer prefers to keep lite-random
as a deliberate ecosystem tie, fall back to **Option C** and correct the README
size framing to the ~1.9 KB installed figure.

## Consequences

- **B chosen:** remove `dependencies`, inline + attribute Mulberry32, re-run
  goldens (must stay `ddef5970` / `ca4f9f1e` / `1ac7a518`), update README to a
  true zero-dependency + <1.5 KB story, note in CHANGELOG. Zero-dependency badge
  returns.
- **C chosen:** bump the range in `package.json`, keep the README footnote added
  in this session (own-code vs installed size), note in CHANGELOG.
- Either way, the download-metric rationale is retired from the roadmap as a
  reason to hold the dependency.

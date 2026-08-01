#!/usr/bin/env node
// Bundle-size gate for @zakkster/lite-noise.
//
// Runs esbuild --minify, then compresses through node:zlib.gzipSync (default
// level 6, matching the semantic bundlephobia uses on its minzip badge). Fails
// if min+gz exceeds the CEILING.
//
// As of the N0 inline (ADR 0001) the package has zero runtime dependencies, so
// this measures the FULL self-contained install -- nothing is externalised.
// The number is therefore the true installed footprint, not own-code-only.
//
// Run: node scripts/bundle-check.mjs

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, unlinkSync } from 'node:fs';

const CEILING = 1550;                  // bytes, min+gz — self-contained, zero deps
const OUT = 'test-bundle.js';

await build({
    entryPoints: ['Noise.js'],
    bundle: true,
    minify: true,
    format: 'esm',
    outfile: OUT,
    logLevel: 'error',
});

const minified = readFileSync(OUT);
const gz = gzipSync(minified);              // default level 6, same as gzip -6
try { unlinkSync(OUT); } catch { /* ignore */ }

const min = minified.byteLength;
const mingz = gz.byteLength;

console.log(`lite-noise bundle: ${min} B min / ${mingz} B min+gz (ceiling ${CEILING} B)`);

if (mingz > CEILING) {
    console.error(`FAIL: exceeds ${CEILING} B min+gz by ${mingz - CEILING} B.`);
    console.error(`      Trim, or bump the ceiling deliberately with a CHANGELOG entry.`);
    process.exit(1);
}
console.log(`OK: ${CEILING - mingz} B headroom.`);

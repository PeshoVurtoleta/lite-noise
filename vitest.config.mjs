// Vitest owns Noise.test.js (unit / correctness / goldens).
// node --test owns test/*.test.mjs (the zero-GC gate under --expose-gc).
export default {
    test: {
        include: ['test/Noise.test.js'],
        exclude: ['node_modules/**', 'magnitudes/test/**', 'bench/**', 'scripts/**'],
    },
};

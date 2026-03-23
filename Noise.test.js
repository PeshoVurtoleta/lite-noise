import { describe, it, expect } from 'vitest';
import { seedNoise, simplex2, simplex3, fbm2, fbm3, curl2 } from './Noise.d.ts';

describe('lite-noise', () => {
    it('simplex2 returns values in [-1, 1]', () => {
        seedNoise(42);
        for (let i = 0; i < 1000; i++) {
            const v = simplex2(i * 0.1, i * 0.07);
            expect(v).toBeGreaterThanOrEqual(-1.01);
            expect(v).toBeLessThanOrEqual(1.01);
        }
    });
    it('simplex3 returns values in [-1, 1]', () => {
        seedNoise(42);
        for (let i = 0; i < 100; i++) {
            const v = simplex3(i * 0.1, i * 0.07, i * 0.03);
            expect(v).toBeGreaterThanOrEqual(-1.01);
            expect(v).toBeLessThanOrEqual(1.01);
        }
    });
    it('seedNoise produces deterministic results', () => {
        seedNoise(99); const a = simplex2(1.5, 2.5);
        seedNoise(99); const b = simplex2(1.5, 2.5);
        expect(a).toBe(b);
    });
    it('different seeds produce different results', () => {
        seedNoise(1); const a = simplex2(1.5, 2.5);
        seedNoise(2); const b = simplex2(1.5, 2.5);
        expect(a).not.toBe(b);
    });
    it('fbm2 returns values in [-1, 1]', () => {
        seedNoise(42);
        for (let i = 0; i < 100; i++) {
            const v = fbm2(i * 0.05, i * 0.03);
            expect(v).toBeGreaterThanOrEqual(-1.1);
            expect(v).toBeLessThanOrEqual(1.1);
        }
    });
    it('fbm3 returns values in [-1, 1]', () => {
        seedNoise(42);
        const v = fbm3(0.5, 0.5, 0.5, 4);
        expect(v).toBeGreaterThanOrEqual(-1.1);
        expect(v).toBeLessThanOrEqual(1.1);
    });
    it('curl2 writes into caller-owned output', () => {
        seedNoise(42);
        const out = { x: 0, y: 0 };
        const result = curl2(1, 1, out);
        expect(result).toBe(out);
        expect(out.x).not.toBe(0);
    });
});

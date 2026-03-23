export declare function seedNoise(seed?: number): void;
export declare function simplex2(x: number, y: number): number;
export declare function simplex3(x: number, y: number, z: number): number;
export declare function fbm2(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number;
export declare function fbm3(x: number, y: number, z: number, octaves?: number, lacunarity?: number, gain?: number): number;
export declare function curl2(x: number, y: number, out: { x: number; y: number }): { x: number; y: number };

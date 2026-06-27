import { Chunk } from './Chunk.js';
import { CONFIG } from '../config.js';
import { BLOCK_IDS } from './BlockRegistry.js';

// Simple deterministic 2D/3D noise function to avoid external dependencies
function createNoise2D() {
    const MASK = 0xFF;
    const permutation = new Uint8Array(256);
    for (let i = 0; i < 256; i++) permutation[i] = i;
    // Fisher-Yates shuffle with fixed seed
    let seed = 12345;
    function rand() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const temp = permutation[i];
        permutation[i] = permutation[j];
        permutation[j] = temp;
    }

    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
        p[i] = permutation[i & MASK];
    }

    function fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function lerp(t, a, b) {
        return a + t * (b - a);
    }

    function grad(hash, x, y) {
        const h = hash & 7;
        const u = h < 4 ? x : y;
        const v = h < 4 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
    }

    return function noise(x, y) {
        const X = Math.floor(x) & MASK;
        const Y = Math.floor(y) & MASK;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = fade(x);
        const v = fade(y);

        const A = p[X] + Y;
        const B = p[X + 1] + Y;

        return lerp(v, lerp(u, grad(p[A], x, y),
            grad(p[B], x - 1, y)),
            lerp(u, grad(p[A + 1], x, y - 1),
                grad(p[B + 1], x - 1, y - 1)));
    };
}

const noise = createNoise2D();

export class World {
    constructor(maxHeight = CONFIG.MAX_HEIGHT) {
        this.maxHeight = maxHeight;
        this.chunks = new Map();
        this.chunkRadius = CONFIG.LOAD_RADIUS; // Generate in a radius around the player
    }

    getChunkKey(cx, cz) {
        return `${cx},${cz}`;
    }

    getOrCreateChunk(cx, cz) {
        const key = this.getChunkKey(cx, cz);
        let chunk = this.chunks.get(key);
        if (!chunk) {
            chunk = new Chunk(cx, cz, this.maxHeight);
            this.chunks.set(key, chunk);
        }
        return chunk;
    }

    /**
     * Get block type at absolute world coordinates
     */
    getBlockAt(x, y, z) {
        if (y < 0 || y >= this.maxHeight) return 0;

        const size = CONFIG.CHUNK_SIZE;
        const cx = Math.floor(x / size);
        const cz = Math.floor(z / size);

        const key = this.getChunkKey(cx, cz);
        const chunk = this.chunks.get(key);
        if (!chunk) return 0;

        const lx = ((x % size) + size) % size;
        const lz = ((z % size) + size) % size;

        return chunk.getBlock(lx, y, lz);
    }

    /**
     * Set block type at absolute world coordinates
     */
    setBlockAt(x, y, z, type) {
        if (y < 0 || y >= this.maxHeight) return false;

        const size = CONFIG.CHUNK_SIZE;
        const cx = Math.floor(x / size);
        const cz = Math.floor(z / size);

        const chunk = this.getOrCreateChunk(cx, cz);
        const lx = ((x % size) + size) % size;
        const lz = ((z % size) + size) % size;

        const changed = chunk.setBlock(lx, y, lz, type);

        // Mark adjacent chunks dirty if modification is on boundaries
        if (changed) {
            if (lx === 0) {
                const adj = this.chunks.get(this.getChunkKey(cx - 1, cz));
                if (adj) adj.dirty = true;
            }
            if (lx === size - 1) {
                const adj = this.chunks.get(this.getChunkKey(cx + 1, cz));
                if (adj) adj.dirty = true;
            }
            if (lz === 0) {
                const adj = this.chunks.get(this.getChunkKey(cx, cz - 1));
                if (adj) adj.dirty = true;
            }
            if (lz === size - 1) {
                const adj = this.chunks.get(this.getChunkKey(cx, cz + 1));
                if (adj) adj.dirty = true;
            }
        }

        return changed;
    }

    /**
     * Physics helper to check if a block is solid
     */
    isSolidAt(x, y, z) {
        const type = this.getBlockAt(x, y, z);
        return type > 0;
    }

    /**
     * Generate the initial world terrain
     */
    generateWorld(api) {
        const r = this.chunkRadius;
        for (let cx = -r; cx <= r; cx++) {
            for (let cz = -r; cz <= r; cz++) {
                this.generateChunkTerrain(cx, cz);
            }
        }

        // Spawn some trees after terrain generation so leaves/logs don't get overwritten
        for (let cx = -r; cx <= r; cx++) {
            for (let cz = -r; cz <= r; cz++) {
                this.spawnTreesInChunk(cx, cz, api);
            }
        }
    }
    generateBlockColumn(chunk, wx, wz, lx, lz) {
        const WATER_LEVEL = 46;

        // Simple fractal noise for terrain height
        const n1 = noise(wx * 0.01, wz * 0.01) * 32;
        const n2 = noise(wx * 0.05, wz * 0.05) * 8;
        const height = Math.max(10, Math.floor(n1 + n2 + 40));

        const colIdx = chunk.getColumnIndex(lx, lz);
        const col = chunk.columns[colIdx];

        // Build RLE ranges directly for performance
        if (height < WATER_LEVEL) {
            // Ocean and seabed Sand
            col.setRanges([
                [0, 0, BLOCK_IDS.BEDROCK], // bedrock floor
                [1, height - 4, BLOCK_IDS.STONE],
                [height - 3, height, BLOCK_IDS.SAND],
                [height + 1, WATER_LEVEL, BLOCK_IDS.WATER]
            ]);
        } else if (height === WATER_LEVEL) {
            // Sand beach
            col.setRanges([
                [0, 0, BLOCK_IDS.BEDROCK],
                [1, height - 4, BLOCK_IDS.STONE],
                [height - 3, height, BLOCK_IDS.SAND]
            ]);
        } else {
            // Normal grass and dirt land
            col.setRanges([
                [0, 0, BLOCK_IDS.BEDROCK],
                [1, height - 4, BLOCK_IDS.STONE],
                [height - 3, height - 1, BLOCK_IDS.DIRT],
                [height, height, BLOCK_IDS.GRASS]
            ]);
        }
    }
    generateChunkTerrain(cx, cz) {
        const chunk = this.getOrCreateChunk(cx, cz);
        const size = CONFIG.CHUNK_SIZE;
        const startX = cx * size;
        const startZ = cz * size;

        for (let lx = 0; lx < size; lx++) {
            for (let lz = 0; lz < size; lz++) {
                const wx = startX + lx;
                const wz = startZ + lz;

                this.generateBlockColumn(chunk, wx, wz, lx, lz);

            }
        }
        chunk.dirty = true;
        chunk.generationPhase = 'terrain';
    }

    spawnTreesInChunk(cx, cz, api) {
        const size = CONFIG.CHUNK_SIZE;
        const startX = cx * size;
        const startZ = cz * size;

        // Deterministic placement based on chunk coordinate hash
        const val = Math.abs(Math.sin(cx * 12.9898 + cz * 78.233)) * 43758.5453;
        const numTrees = Math.floor((val % 1) * 3) + 1; // 1 to 3 trees per chunk

        for (let t = 0; t < numTrees; t++) {
            // Get tree position
            const tx = Math.floor(((val * (t + 1) * 7.5) % 1) * (size - 4)) + 2; // Keep away from borders [2..size-3]
            const tz = Math.floor(((val * (t + 2) * 9.1) % 1) * (size - 4)) + 2;

            const wx = startX + tx;
            const wz = startZ + tz;

            // Get surface height
            let wy = 0;
            for (let y = this.maxHeight - 1; y >= 0; y--) {
                if (this.isSolidAt(wx, y, wz)) {
                    wy = y;
                    break;
                }
            }

            // Only spawn on Grass (type 1)
            if (this.getBlockAt(wx, wy, wz) === BLOCK_IDS.GRASS) {
                if (api) {
                    api.generateFeature('tree', wx, wy, wz, val, t);
                } else {
                    const trunkHeight = 4 + Math.floor(((val * (t + 3)) % 1) * 3); // 4-6 blocks high

                    // Spawn Trunk
                    for (let h = 1; h <= trunkHeight; h++) {
                        this.setBlockAt(wx, wy + h, wz, BLOCK_IDS.OAK_LOG);
                    }

                    // Spawn Leaves
                    const leafBottom = wy + trunkHeight - 1;
                    const leafTop = wy + trunkHeight + 2;
                    for (let ly = leafBottom; ly <= leafTop; ly++) {
                        const radius = ly >= wy + trunkHeight ? 1 : 2;
                        for (let lx = -radius; lx <= radius; lx++) {
                            for (let lz = -radius; lz <= radius; lz++) {
                                // Don't overwrite trunk
                                if (lx === 0 && lz === 0 && ly <= wy + trunkHeight) continue;
                                // Randomize corners slightly
                                if (Math.abs(lx) === radius && Math.abs(lz) === radius && Math.random() > 0.7) continue;

                                this.setBlockAt(wx + lx, ly, wz + lz, BLOCK_IDS.LEAVES);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Check if a chunk and all its 8 neighbors have completed terrain generation (Phase 1).
     */
    canDecorateChunk(cx, cz) {
        const chunk = this.chunks.get(this.getChunkKey(cx, cz));
        if (!chunk || chunk.generationPhase !== 'terrain') return false;

        // Check 8 surrounding neighbors
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const neighbor = this.chunks.get(this.getChunkKey(cx + dx, cz + dz));
                if (!neighbor || neighbor.generationPhase === 'unloaded') {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Spawns trees (Phase 2) and transitions the chunk state to 'decorated'.
     */
    decorateChunk(cx, cz, api) {
        const chunk = this.chunks.get(this.getChunkKey(cx, cz));
        if (chunk && chunk.generationPhase === 'terrain') {
            this.spawnTreesInChunk(cx, cz, api);
            chunk.generationPhase = 'decorated';
            chunk.dirty = true;
        }
    }
}

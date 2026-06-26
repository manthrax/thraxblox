import { RLEColumn } from './RLEColumn.js';
import { CONFIG } from '../config.js';

export class Chunk {
    constructor(chunkX, chunkZ, maxHeight = CONFIG.MAX_HEIGHT) {
        this.x = chunkX;
        this.z = chunkZ;
        this.maxHeight = maxHeight;
        this.dirty = true;
        this.generationPhase = 'unloaded'; // 'unloaded', 'terrain', 'decorated'
        
        // CHUNK_SIZE x CHUNK_SIZE columns
        const colCount = CONFIG.CHUNK_SIZE * CONFIG.CHUNK_SIZE;
        this.columns = new Array(colCount);
        for (let i = 0; i < colCount; i++) {
            this.columns[i] = new RLEColumn(maxHeight);
        }
    }

    /**
     * Helper to get column index from local (x, z) [0..CHUNK_SIZE-1]
     */
    getColumnIndex(localX, localZ) {
        return localX * CONFIG.CHUNK_SIZE + localZ;
    }

    /**
     * Get block at local chunk coordinates (localX, y, localZ)
     */
    getBlock(localX, y, localZ) {
        const size = CONFIG.CHUNK_SIZE;
        if (localX < 0 || localX >= size || localZ < 0 || localZ >= size) return 0;
        const colIdx = localX * size + localZ;
        return this.columns[colIdx].getBlock(y);
    }

    /**
     * Set block at local chunk coordinates (localX, y, localZ)
     */
    setBlock(localX, y, localZ, type) {
        const size = CONFIG.CHUNK_SIZE;
        if (localX < 0 || localX >= size || localZ < 0 || localZ >= size) return false;
        const colIdx = localX * size + localZ;
        const changed = this.columns[colIdx].setBlock(y, type);
        if (changed) {
            this.dirty = true;
        }
        return changed;
    }
}

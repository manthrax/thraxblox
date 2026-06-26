/**
 * Represents a single vertical column of blocks using Run-Length Encoding.
 */
export class RLEColumn {
    constructor(maxHeight = 256) {
        this.maxHeight = maxHeight;
        // Start with a single run of air (type 0) for the full height
        this.runs = [
            { type: 0, length: maxHeight }
        ];
    }

    /**
     * Get the block type at a specific vertical coordinate y.
     */
    getBlock(y) {
        if (y < 0 || y >= this.maxHeight) return 0;
        let currentY = 0;
        const runs = this.runs;
        const count = runs.length;
        for (let i = 0; i < count; i++) {
            const run = runs[i];
            const nextY = currentY + run.length;
            if (y < nextY) {
                return run.type;
            }
            currentY = nextY;
        }
        return 0;
    }

    /**
     * Set the block type at a specific vertical coordinate y.
     * Reconstructs/optimizes runs to merge adjacent identical types.
     * Returns true if a change actually occurred.
     */
    setBlock(y, type) {
        if (y < 0 || y >= this.maxHeight) return false;
        
        let currentY = 0;
        const runs = this.runs;
        const count = runs.length;
        
        for (let i = 0; i < count; i++) {
            const run = runs[i];
            const nextY = currentY + run.length;
            
            if (y < nextY) {
                if (run.type === type) {
                    return false; // No change
                }
                
                // We need to split this run.
                const preLength = y - currentY;
                const postLength = nextY - y - 1;
                
                const newRuns = [];
                // Add the preceding part of the run
                if (preLength > 0) {
                    newRuns.push({ type: run.type, length: preLength });
                }
                // Add the new block
                newRuns.push({ type: type, length: 1 });
                // Add the succeeding part of the run
                if (postLength > 0) {
                    newRuns.push({ type: run.type, length: postLength });
                }
                
                // Replace the single run with the new split runs
                runs.splice(i, 1, ...newRuns);
                
                this.optimize();
                return true;
            }
            
            currentY = nextY;
        }
        
        return false;
    }

    /**
     * Optimizes the run array by merging adjacent runs of the same type.
     */
    optimize() {
        const runs = this.runs;
        for (let i = 0; i < runs.length - 1; i++) {
            if (runs[i].type === runs[i + 1].type) {
                runs[i].length += runs[i + 1].length;
                runs.splice(i + 1, 1);
                i--; // Step back to check again with the next run
            }
        }
    }

    setRanges(ranges) {
        // ranges is an array of [yStart, yEnd, type], assumed sorted by yStart
        const runs = [];
        let currentY = 0;
        
        for (let i = 0; i < ranges.length; i++) {
            const [yStart, yEnd, type] = ranges[i];
            
            // Add air gap if there is one
            if (yStart > currentY) {
                runs.push({ type: 0, length: yStart - currentY });
            }
            
            // Add the range run
            const len = yEnd - yStart + 1;
            if (len > 0) {
                runs.push({ type: type, length: len });
                currentY = yEnd + 1;
            }
        }
        
        // Add final air run
        if (currentY < this.maxHeight) {
            runs.push({ type: 0, length: this.maxHeight - currentY });
        }
        
        this.runs = runs;
        this.optimize();
    }
}

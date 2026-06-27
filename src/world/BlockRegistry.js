import textureMapping from '../texture_mapping.json';

export const BLOCK_IDS = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    OAK_LOG: 4,
    LEAVES: 5,
    GLASS: 6,
    OAK_PLANKS: 7,
    COBBLESTONE: 8,
    BEDROCK: 9,
    SAND: 10,
    WATER: 11
};

export function isTrulyTransparent(blockId) {
    return Number(blockId) === BLOCK_IDS.WATER;
}

export function isOpaque(blockId) {
    const id = Number(blockId);
    return id !== BLOCK_IDS.AIR &&
           id !== BLOCK_IDS.LEAVES &&
           id !== BLOCK_IDS.GLASS &&
           id !== BLOCK_IDS.WATER;
}

export function isSolid(blockId) {
    const id = Number(blockId);
    return id !== BLOCK_IDS.AIR && id !== BLOCK_IDS.WATER;
}

export function isLiquid(blockId) {
    const id = Number(blockId);
    return id === BLOCK_IDS.WATER;
}

// Faces order: +X, -X, +Y (Top), -Y (Bottom), +Z, -Z
export const blockFacesConfig = new Float32Array(32 * 6);
export const blockAnimsConfig = new Float32Array(32 * 6);
export const blockTintsConfig = new Float32Array(32 * 6);

export const nameConfig = {
    [BLOCK_IDS.GRASS]: [
        'grass_block_side.png', 'grass_block_side.png', // +X, -X
        'grass_block_top.png',                          // +Y (Top)
        'dirt.png',                                     // -Y (Bottom)
        'grass_block_side.png', 'grass_block_side.png'  // +Z, -Z
    ],
    [BLOCK_IDS.DIRT]: Array(6).fill('dirt.png'),
    [BLOCK_IDS.STONE]: Array(6).fill('stone.png'),
    [BLOCK_IDS.OAK_LOG]: [
        'oak_log.png', 'oak_log.png',                   // +X, -X
        'oak_log_top.png', 'oak_log_top.png',           // +Y, -Y (Top, Bottom)
        'oak_log.png', 'oak_log.png'                    // +Z, -Z
    ],
    [BLOCK_IDS.LEAVES]: Array(6).fill('oak_leaves.png'),
    [BLOCK_IDS.GLASS]: Array(6).fill('glass.png'),
    [BLOCK_IDS.OAK_PLANKS]: Array(6).fill('oak_planks.png'),
    [BLOCK_IDS.COBBLESTONE]: Array(6).fill('cobblestone.png'),
    [BLOCK_IDS.BEDROCK]: Array(6).fill('bedrock.png'),
    [BLOCK_IDS.SAND]: Array(6).fill('sand.png'),
    [BLOCK_IDS.WATER]: Array(6).fill('water_still.png')
};

// Populate the Float32Arrays dynamically synchronously
export function initializeBlockFaces(mapping) {
    for (const [blockType, files] of Object.entries(nameConfig)) {
        const type = parseInt(blockType);
        for (let f = 0; f < 6; f++) {
            const file = files[f];
            const info = mapping[file];
            if (info) {
                const arrayIdx = type * 6 + f;
                blockFacesConfig[arrayIdx] = info.index;

                // Set animation frame count if animated
                if (info.count > 1) {
                    blockAnimsConfig[arrayIdx] = info.count;
                } else {
                    blockAnimsConfig[arrayIdx] = 0.0;
                }

                // Set color tint flag (1.0 = Grass top, 2.0 = Water, 3.0 = Leaves)
                if (type === BLOCK_IDS.GRASS && f === 2) {
                    blockTintsConfig[arrayIdx] = 1.0;
                } else if (type === BLOCK_IDS.WATER) {
                    blockTintsConfig[arrayIdx] = 2.0;
                } else if (type === BLOCK_IDS.LEAVES) {
                    blockTintsConfig[arrayIdx] = 3.0;
                } else {
                    blockTintsConfig[arrayIdx] = 0.0;
                }
            } else {
                console.warn(`Texture file not found in mapping: ${file} for block type ${type}`);
            }
        }
    }
}

// Perform initialization immediately
initializeBlockFaces(textureMapping);

export class BlockSelection {
    constructor() {
        this.selectedBlockId = 1;
        this.blockOptions = document.querySelectorAll('.block-option');

        // Dynamically style preview divs using blockatlas.webp cropped sub-windows
        const atlasCols = 41;
        const totalAtlasSize = 2624;
        const tileSize = 64;
        const bleed = 6;
        const interiorSize = 52;
        const previewDisplaySize = 18; // matching CSS block-preview dimension

        const scale = previewDisplaySize / interiorSize;
        const scaledAtlasSize = totalAtlasSize * scale;

        this.blockOptions.forEach(opt => {
            const id = parseInt(opt.getAttribute('data-id'));
            const files = nameConfig[id];
            if (files) {
                // Use top face (index 2) for Grass and Oak Log, otherwise use front face (index 4)
                const filename = (id === BLOCK_IDS.GRASS || id === BLOCK_IDS.OAK_LOG) ? files[2] : files[4];
                const info = textureMapping ? textureMapping[filename] : null;

                if (info) {
                    const tileIndex = info.index;
                    const tx = tileIndex % atlasCols;
                    const ty = Math.floor(tileIndex / atlasCols);

                    const posX = -(tx * tileSize + bleed) * scale;
                    const posY = -(ty * tileSize + bleed) * scale;

                    const previewEl = opt.querySelector('.block-preview');
                    if (previewEl) {
                        previewEl.style.backgroundImage = "url('blockatlas.webp')";
                        previewEl.style.backgroundSize = `${scaledAtlasSize}px ${scaledAtlasSize}px`;
                        previewEl.style.backgroundPosition = `${posX}px ${posY}px`;
                        previewEl.style.imageRendering = 'pixelated';
                    }
                }
            }
        });

        this.setupEvents();
        this.selectBlock(1);
    }

    setupEvents() {
        this.blockOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                const id = parseInt(opt.getAttribute('data-id'));
                this.selectBlock(id);
            });
        });

        window.addEventListener('keydown', (e) => {
            if (e.code.startsWith('Digit')) {
                const num = parseInt(e.code.replace('Digit', ''));
                if (num >= 1 && num <= 9) {
                    this.selectBlock(num);
                } else if (num === 0) {
                    this.selectBlock(10);
                }
            } else if (e.code === 'Minus') {
                this.selectBlock(11);
            }
        });
    }

    selectBlock(id) {
        this.selectedBlockId = id;
        this.blockOptions.forEach(opt => {
            opt.classList.toggle('active', parseInt(opt.getAttribute('data-id')) === id);
        });

        // Show momentary name popup above hotbar
        const activeOpt = document.querySelector(`.block-option[data-id="${id}"]`);
        if (activeOpt) {
            const nameSpan = activeOpt.querySelector('span');
            const name = nameSpan ? nameSpan.textContent : '';
            const popup = document.getElementById('block-name-popup');
            if (popup && name) {
                popup.textContent = name;
                popup.classList.add('visible');

                clearTimeout(this.popupTimeout);
                this.popupTimeout = setTimeout(() => {
                    popup.classList.remove('visible');
                }, 1500);
            }
        }
    }
}

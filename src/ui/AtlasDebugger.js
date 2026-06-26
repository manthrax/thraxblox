import * as THREE from 'three';

export class AtlasDebugger {
    constructor() {
        this.container = document.getElementById('atlas-debug-container');
        this.canvas = document.getElementById('atlas-debug-canvas');
        this.closeBtn = document.getElementById('atlas-debug-close');

        this.btnZoomIn = document.getElementById('atlas-zoom-in');
        this.btnZoomOut = document.getElementById('atlas-zoom-out');
        this.btnZoomReset = document.getElementById('atlas-zoom-reset');
        this.zoomVal = document.getElementById('atlas-zoom-val');
        this.btnRegenerate = document.getElementById('atlas-regenerate');

        if (!this.container || !this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.isLoaded = false;
        this.zoom = 1.0;

        this.setupEvents();
    }

    setupEvents() {
        // Toggle overlay on F4 key
        window.addEventListener('keydown', (e) => {
            if (e.code === 'F4') {
                e.preventDefault();
                this.toggle();
            }
        });

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                this.hide();
            });
        }

        if (this.btnZoomIn) {
            this.btnZoomIn.addEventListener('click', () => {
                this.setZoom(this.zoom + 0.25);
            });
        }

        if (this.btnZoomOut) {
            this.btnZoomOut.addEventListener('click', () => {
                this.setZoom(this.zoom - 0.25);
            });
        }

        if (this.btnZoomReset) {
            this.btnZoomReset.addEventListener('click', () => {
                this.setZoom(1.0);
            });
        }

        if (this.btnRegenerate) {
            this.btnRegenerate.addEventListener('click', () => {
                this.regenerateAtlas();
            });
        }
    }

    setZoom(val) {
        this.zoom = Math.max(0.25, Math.min(4.0, val));

        // Apply scaling transform to the canvas
        this.canvas.style.transform = `scale(${this.zoom})`;

        // Adjust the margins of the canvas to offset parent overflow and sizing when scaled
        const scaledHeight = this.canvas.height * this.zoom;
        const scaledWidth = this.canvas.width * this.zoom;
        const wrapper = this.canvas.parentElement;
        if (wrapper) {
            wrapper.style.height = `${scaledHeight + 40}px`;
            wrapper.style.width = `${scaledWidth + 40}px`;
        }

        if (this.zoomVal) {
            this.zoomVal.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    toggle() {
        if (this.container.style.display === 'flex') {
            this.hide();
        } else {
            this.show();
        }
    }

    show() {
        this.container.style.display = 'flex';
        // Unlock cursor when opening overlay to allow scrolling
        document.exitPointerLock();

        if (!this.isLoaded) {
            this.loadAndRender();
        }
    }

    hide() {
        this.container.style.display = 'none';
    }

    async loadAndRender() {
        try {
            // Load mapping json and atlas image
            const [mappingRes, atlasImg] = await Promise.all([
                fetch('/texture_mapping.json').then(r => r.json()),
                new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = '/blockatlas.webp';
                })
            ]);

            const tileSize = 64;
            const atlasCols = 41;
            const totalWidth = atlasImg.width;
            const totalHeight = atlasImg.height;

            this.canvas.width = totalWidth;
            this.canvas.height = totalHeight;

            // Draw base atlas image
            this.ctx.drawImage(atlasImg, 0, 0);

            // Draw overlay cells and text labels
            this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)'; // Sky blue grid lines
            this.ctx.lineWidth = 1;

            // Loop through each entry in the mapping
            for (const [filename, info] of Object.entries(mappingRes)) {
                const displayName = filename.replace('.png', '');

                for (let frame = 0; frame < info.count; frame++) {
                    const tileIndex = info.index + frame;
                    const tx = tileIndex % atlasCols;
                    const ty = Math.floor(tileIndex / atlasCols);

                    const x = tx * tileSize;
                    const y = ty * tileSize;

                    // Draw bounding box
                    this.ctx.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1);

                    // Draw semi-transparent label background
                    this.ctx.fillStyle = 'rgba(15, 17, 26, 0.75)';
                    this.ctx.fillRect(x + 2, y + 2, tileSize - 4, 18);

                    // Draw index and name text
                    this.ctx.fillStyle = '#38bdf8'; // Sky blue text
                    this.ctx.font = 'bold 9px monospace';
                    this.ctx.textAlign = 'left';
                    this.ctx.textBaseline = 'top';
                    this.ctx.fillText(`${tileIndex}`, x + 4, y + 3);

                    // Draw truncated name below the index if space permits
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.font = '7px sans-serif';

                    let shortName = displayName;
                    if (shortName.length > 12) {
                        shortName = shortName.substring(0, 10) + '..';
                    }
                    this.ctx.fillText(shortName, x + 4, y + 11);
                }
            }

            this.isLoaded = true;
            // Initialize default zoom
            this.setZoom(1.0);
            console.log('Atlas visual debugger grid rendered successfully.');
        } catch (err) {
            console.error('Failed to load or render atlas visual debugger:', err);
            this.ctx.fillStyle = '#ef4444';
            this.ctx.font = '20px sans-serif';
            this.ctx.fillText('Failed to load texture atlas debug data', 50, 50);
        }
    }

    async regenerateAtlas() {
        const originalText = this.btnRegenerate.textContent;
        this.btnRegenerate.textContent = 'Generating...';
        this.btnRegenerate.disabled = true;

        try {
            console.log('Starting atlas regeneration...');
            // 1. Fetch and clean texture list
            const text = await fetch('/block/textures.txt').then(r => r.text());
            const texs = text.split('\n').map(x => x.trim()).filter(x => x.length > 0);

            // 2. Load all textures in sequence & construct mapping descriptors
            const loader = new THREE.TextureLoader();
            const textures = [];
            const loadedTexs = []; // tracking successfully loaded textures
            let numTiles = 0;
            const tileSize = 64;
            const mapping = {};
            let ipos = 0;

            for (let i = 0; i < texs.length; i++) {
                try {
                    const tex = await loader.loadAsync(`/block/textures/${texs[i]}`);
                    textures.push(tex);
                    const w = tex.source.data.width;
                    const h = tex.source.data.height;
                    const count = Math.floor((w / tileSize) * (h / tileSize));

                    mapping[texs[i]] = {
                        index: ipos,
                        count: count,
                        width: w,
                        height: h
                    };

                    numTiles += count;
                    ipos += count;
                    loadedTexs.push({ tex, filename: texs[i] });
                } catch (e) {
                    console.error(`Failed to load texture: /block/${texs[i]} (index candidate: ${ipos}). Skipping. Error:`, e);
                }
            }

            // 3. Setup canvas layout
            const tx = Math.ceil(Math.sqrt(numTiles));
            const texDim = tx * tileSize;

            const genCanvas = document.createElement('canvas');
            genCanvas.width = texDim;
            genCanvas.height = texDim;
            const genCtx = genCanvas.getContext('2d');

            // 4. Draw to canvas
            let drawPos = 0;
            for (let i = 0; i < loadedTexs.length; i++) {
                const imgData = loadedTexs[i].tex.source.data;
                const width = imgData.width;
                const height = imgData.height;
                for (let ty = 0; ty < height; ty += tileSize) {
                    for (let tx_src = 0; tx_src < width; tx_src += tileSize) {
                        const gridX = drawPos % tx;
                        const gridY = Math.floor(drawPos / tx);

                        genCtx.drawImage(
                            imgData,
                            tx_src, ty, tileSize, tileSize,
                            gridX * tileSize, gridY * tileSize, tileSize, tileSize
                        );
                        drawPos++;
                    }
                }
            }

            // 5. Trigger download of WebP
            const link = document.createElement('a');
            link.download = 'blockatlas.webp';
            link.href = genCanvas.toDataURL('image/webp');
            link.click();

            // 6. Trigger download of texture_mapping.json
            const jsonBlob = new Blob([JSON.stringify(mapping, null, 2)], { type: 'application/json' });
            const jsonLink = document.createElement('a');
            jsonLink.download = 'texture_mapping.json';
            jsonLink.href = URL.createObjectURL(jsonBlob);
            jsonLink.click();

            console.log(`Atlas and mapping generated successfully! Grid size: ${tx}x${tx}. Total tiles: ${drawPos}`);
            alert(`Regeneration complete! Saved "blockatlas.webp" and "texture_mapping.json" locally. Move both files into the "public" folder to apply.`);
        } catch (err) {
            console.error('Atlas regeneration failed:', err);
            alert(`Regeneration failed: ${err.message}`);
        } finally {
            this.btnRegenerate.textContent = originalText;
            this.btnRegenerate.disabled = false;
        }
    }
}

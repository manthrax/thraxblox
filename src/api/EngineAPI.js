import * as THREE from 'three';
import { World } from '../world/World.js';
import { CharacterController } from '../player/CharacterController.js';
import { BLOCK_IDS, blockFacesConfig, blockAnimsConfig, blockTintsConfig, BlockSelection } from '../world/BlockRegistry.js';
import { ChunkRenderer } from '../render/ChunkRenderer.js';
import { CONFIG } from '../config.js';

export class EngineAPI {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        // Core Systems
        this.world = new World(CONFIG.MAX_HEIGHT);
        this.blockSelection = new BlockSelection();
        this.controller = new CharacterController(camera, renderer.domElement, this.world);

        // Generation and rendering maps
        this.chunkRenderers = new Map();
        this.generationQueue = [];
        this.lastPcx = null;
        this.lastPcz = null;

        // Custom features and behavior registry
        this.featureGenerators = new Map();
        this.blockBehaviors = new Map();

        this.wireframeMode = false;
        this.skyColor = new THREE.Color(0x7dd3fc);
        this.useEqualDepthForBackfaces = true;

        // Repeating block actions
        this.BLOCK_ACTION_RATE = 8; // Actions per second
        this.BLOCK_ACTION_COOLDOWN = 1.0 / this.BLOCK_ACTION_RATE;
        this.blockActionTimer = 0;
        this.mouseButtonsPressed = { left: false, right: false };
        this.rayDirection = new THREE.Vector3();

        // Underwater camera overlay plane
        const overlayGeom = new THREE.PlaneGeometry(2, 2);
        const overlayMat = new THREE.MeshBasicMaterial({
            color: 0x103070,
            transparent: true,
            opacity: 0.35,
            depthTest: false,
            depthWrite: false
        });
        this.underwaterPlane = new THREE.Mesh(overlayGeom, overlayMat);
        this.underwaterPlane.position.set(0, 0, -0.11); // Place just in front of near clipping plane
        this.underwaterPlane.visible = false;
        this.camera.add(this.underwaterPlane);
        this.scene.add(this.camera);

        // Expose API globally
        window.VoxelAPI = this;
    }

    async init() {
        // Load Texture Atlas asynchronously
        const textureLoader = new THREE.TextureLoader();
        this.textureAtlas = await textureLoader.loadAsync('blockatlas.webp');
        this.textureAtlas.colorSpace = THREE.SRGBColorSpace;
        //this.textureAtlas.magFilter = THREE.NearestFilter;
        //this.textureAtlas.minFilter = THREE.NearestMipmapLinearFilter;
        //this.textureAtlas.generateMipmaps = true;

        // Initialize shared materials statically
        ChunkRenderer.initMaterials(
            this.textureAtlas,
            blockFacesConfig,
            blockAnimsConfig,
            blockTintsConfig
        );

        // Setup interaction event listeners
        this.setupInteractionEvents();
    }

    // --- Block Access & Editing ---
    getBlock(x, y, z) {
        return this.world.getBlockAt(x, y, z);
    }

    setBlock(x, y, z, type) {
        const oldType = this.getBlock(x, y, z);
        const changed = this.world.setBlockAt(x, y, z, type);

        if (changed) {
            // Trigger behaviors
            const oldBehavior = this.blockBehaviors.get(oldType);
            if (oldBehavior && oldBehavior.onBreak) {
                oldBehavior.onBreak(x, y, z, oldType, this);
            }
            const newBehavior = this.blockBehaviors.get(type);
            if (newBehavior && newBehavior.onPlace) {
                newBehavior.onPlace(x, y, z, type, this);
            }
        }
        return changed;
    }

    fillBlocks(x1, y1, z1, x2, y2, z2, type) {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const minZ = Math.min(z1, z2);
        const maxZ = Math.max(z1, z2);

        let changedAny = false;
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    if (this.setBlock(x, y, z, type)) {
                        changedAny = true;
                    }
                }
            }
        }
        return changedAny;
    }

    // --- Voxel Raycast ---
    raycast(start, dir, maxDistance = 24.0) {
        let x = Math.floor(start.x);
        let y = Math.floor(start.y);
        let z = Math.floor(start.z);

        const stepX = dir.x > 0 ? 1 : -1;
        const stepY = dir.y > 0 ? 1 : -1;
        const stepZ = dir.z > 0 ? 1 : -1;

        const tDeltaX = Math.abs(1 / dir.x);
        const tDeltaY = Math.abs(1 / dir.y);
        const tDeltaZ = Math.abs(1 / dir.z);

        const xDist = dir.x > 0 ? (x + 1 - start.x) : (start.x - x);
        const yDist = dir.y > 0 ? (y + 1 - start.y) : (start.y - y);
        const zDist = dir.z > 0 ? (z + 1 - start.z) : (start.z - z);

        let tMaxX = tDeltaX === Infinity ? Infinity : xDist * tDeltaX;
        let tMaxY = tDeltaY === Infinity ? Infinity : yDist * tDeltaY;
        let tMaxZ = tDeltaZ === Infinity ? Infinity : zDist * tDeltaZ;

        let normX = 0, normY = 0, normZ = 0;
        let distance = 0;

        while (distance < maxDistance) {
            if (this.world.isSolidAt(x, y, z)) {
                return {
                    hit: true,
                    x, y, z,
                    normal: new THREE.Vector3(normX, normY, normZ),
                    placeX: x + normX,
                    placeY: y + normY,
                    placeZ: z + normZ
                };
            }

            if (tMaxX < tMaxY) {
                if (tMaxX < tMaxZ) {
                    x += stepX;
                    distance = tMaxX;
                    tMaxX += tDeltaX;
                    normX = -stepX; normY = 0; normZ = 0;
                } else {
                    z += stepZ;
                    distance = tMaxZ;
                    tMaxZ += tDeltaZ;
                    normX = 0; normY = 0; normZ = -stepZ;
                }
            } else {
                if (tMaxY < tMaxZ) {
                    y += stepY;
                    distance = tMaxY;
                    tMaxY += tDeltaY;
                    normX = 0; normY = -stepY; normZ = 0;
                } else {
                    z += stepZ;
                    distance = tMaxZ;
                    tMaxZ += tDeltaZ;
                    normX = 0; normY = 0; normZ = -stepZ;
                }
            }
        }
        return { hit: false };
    }

    // --- Block Behaviors ---
    registerBlockBehavior(type, behavior) {
        this.blockBehaviors.set(type, behavior);
    }

    toggleWireframe(enabled) {
        this.wireframeMode = enabled !== undefined ? enabled : !this.wireframeMode;
        for (const mat of ChunkRenderer.materialsList) {
            mat.wireframe = this.wireframeMode;
        }
        return this.wireframeMode;
    }

    render(renderer = this.renderer) {
        if (!renderer) return;
        renderer.clear();

        const renderers = Array.from(this.chunkRenderers.values());
        const { solidDepthMaterial, solidColorMaterial, transColorBackMaterial, transColorFrontMaterial, transDepthMaterial } = ChunkRenderer;
        if (renderers.length == 0) {
            // Render empty/fallback
            this.scene.background = this.skyColor;
            renderer.render(this.scene, this.camera);
            return;
        }

        // 1. Phase 1: Solid Depth Prepass (Layer 0)
        this.scene.background = this.skyColor;
        this.camera.layers.set(0);
        for (let i = 0; i < renderers.length; i++)
            renderers[i].solidMesh.material = solidDepthMaterial;

        renderer.render(this.scene, this.camera);

        // Disable background so subsequent passes do not overwrite the color/depth buffers
        this.scene.background = null;

        // 2. Phase 2: Solid Equal-Depth Color Pass (Layer 0)
        for (let i = 0; i < renderers.length; i++)
            renderers[i].solidMesh.material = solidColorMaterial;

        renderer.render(this.scene, this.camera);

        // 3. Phase 2.5: Translucent Backfaces Pass (Layer 1)
        this.camera.layers.set(1);

        for (let i = 0; i < renderers.length; i++)
            renderers[i].transMesh.material = transColorBackMaterial;

        renderer.render(this.scene, this.camera);

        // 4. Phase 3a: Transparent Depth Prepass (Layer 1)
        for (let i = 0; i < renderers.length; i++)
            renderers[i].transMesh.material = transDepthMaterial;

        renderer.render(this.scene, this.camera);

        // 5. Phase 3b: Transparent Equal-Depth Alpha Pass (Layer 1)
        for (let i = 0; i < renderers.length; i++)
            renderers[i].transMesh.material = transColorFrontMaterial;

        renderer.render(this.scene, this.camera);

    }

    // --- Chunk Access & Generation ---
    getChunk(cx, cz) {
        return this.world.chunks.get(this.world.getChunkKey(cx, cz));
    }

    getLoadedChunks() {
        return Array.from(this.world.chunks.values());
    }

    updateChunks(playerPos) {
        const size = CONFIG.CHUNK_SIZE;
        const pcx = Math.floor(playerPos.x / size);
        const pcz = Math.floor(playerPos.z / size);
        const loadRadius = CONFIG.LOAD_RADIUS;
        const unloadRadius = CONFIG.UNLOAD_RADIUS;

        const positionChanged = (pcx !== this.lastPcx || pcz !== this.lastPcz);

        if (positionChanged) {
            this.lastPcx = pcx;
            this.lastPcz = pcz;

            // 1. Identify missing chunks and append to queue
            let queueNeedsSort = false;
            for (let cx = pcx - loadRadius; cx <= pcx + loadRadius; cx++) {
                for (let cz = pcz - loadRadius; cz <= pcz + loadRadius; cz++) {
                    const key = `${cx},${cz}`;
                    if (!this.world.chunks.has(key)) {
                        this.world.getOrCreateChunk(cx, cz);
                        this.generationQueue.push({ cx, cz });
                        queueNeedsSort = true;
                    }
                }
            }

            // Sort queue by proximity
            if (queueNeedsSort) {
                this.generationQueue.sort((a, b) => {
                    const distA = Math.hypot(a.cx - pcx, a.cz - pcz);
                    const distB = Math.hypot(b.cx - pcx, b.cz - pcz);
                    return distA - distB;
                });
            }

            // 5. Unload chunks too far away
            for (const [key, chunkRenderer] of this.chunkRenderers.entries()) {
                const [cx, cz] = key.split(',').map(Number);
                const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
                if (dist > unloadRadius) {
                    chunkRenderer.destroy();
                    this.chunkRenderers.delete(key);
                    this.world.chunks.delete(key);
                }
            }

            // Instantiate Chunk Renderers for already generated/decorated chunks that just came into loadRadius
            for (let cx = pcx - loadRadius; cx <= pcx + loadRadius; cx++) {
                for (let cz = pcz - loadRadius; cz <= pcz + loadRadius; cz++) {
                    const key = `${cx},${cz}`;
                    const chunk = this.world.chunks.get(key);
                    if (chunk && chunk.generationPhase !== 'unloaded' && !this.chunkRenderers.has(key)) {
                        const r = new ChunkRenderer(chunk, this.scene, this.textureAtlas, blockFacesConfig, this.world);
                        this.chunkRenderers.set(key, r);
                    }
                }
            }
        }

        // 2. Process a limited amount of terrain generation per frame
        const limit = CONFIG.CHUNKS_PER_FRAME || 3;
        let processed = 0;
        while (this.generationQueue.length > 0 && processed < limit) {
            const { cx, cz } = this.generationQueue.shift();
            this.world.generateChunkTerrain(cx, cz);
            processed++;

            // Ensure this newly generated chunk gets a renderer immediately
            const key = `${cx},${cz}`;
            const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
            if (dist <= loadRadius && !this.chunkRenderers.has(key)) {
                const chunk = this.world.chunks.get(key);
                if (chunk) {
                    const r = new ChunkRenderer(chunk, this.scene, this.textureAtlas, blockFacesConfig, this.world);
                    this.chunkRenderers.set(key, r);
                }
            }

            // 3. Process decorations for this chunk and its 8 neighbors
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const ncx = cx + dx;
                    const ncz = cz + dz;
                    if (this.world.canDecorateChunk(ncx, ncz)) {
                        this.world.decorateChunk(ncx, ncz, this);

                        // 4. Instantiate Chunk Renderer if the decorated chunk is within loadRadius
                        const nkey = `${ncx},${ncz}`;
                        const ndist = Math.max(Math.abs(ncx - pcx), Math.abs(ncz - pcz));
                        if (ndist <= loadRadius && !this.chunkRenderers.has(nkey)) {
                            const chunk = this.world.chunks.get(nkey);
                            if (chunk) {
                                const r = new ChunkRenderer(chunk, this.scene, this.textureAtlas, blockFacesConfig, this.world);
                                this.chunkRenderers.set(nkey, r);
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Block Action Repeater ---
    performBlockAction() {
        if (document.pointerLockElement !== this.renderer.domElement) return;

        // Raycast from camera center
        this.camera.getWorldDirection(this.rayDirection);
        const result = this.raycast(this.camera.position, this.rayDirection, 24.0);

        if (result.hit) {
            if (this.mouseButtonsPressed.left) {
                // Break block (Air)
                this.setBlock(result.x, result.y, result.z, BLOCK_IDS.AIR);
            } else if (this.mouseButtonsPressed.right) {
                // Place block
                const playerBounds = this.controller.getAABB();
                const placeBounds = {
                    minX: result.placeX, maxX: result.placeX + 1,
                    minY: result.placeY, maxY: result.placeY + 1,
                    minZ: result.placeZ, maxZ: result.placeZ + 1
                };

                if (!this.controller.intersects(playerBounds, placeBounds)) {
                    this.setBlock(result.placeX, result.placeY, result.placeZ, this.blockSelection.selectedBlockId);
                }
            }
        }
    }

    setupInteractionEvents() {
        // Block breaking/placing click events
        window.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement !== this.renderer.domElement) return;

            if (e.button === 0) {
                this.mouseButtonsPressed.left = true;
                this.performBlockAction();
                this.blockActionTimer = this.BLOCK_ACTION_COOLDOWN;
            } else if (e.button === 2) {
                this.mouseButtonsPressed.right = true;
                this.performBlockAction();
                this.blockActionTimer = this.BLOCK_ACTION_COOLDOWN;
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.mouseButtonsPressed.left = false;
            if (e.button === 2) this.mouseButtonsPressed.right = false;
        });

        // Clear input states when pointerlock is released (e.g., pausing)
        if (this.controller && this.controller.mouseController) {
            this.controller.mouseController.onUnlock(() => {
                this.mouseButtonsPressed.left = false;
                this.mouseButtonsPressed.right = false;
            });
        }

        // Disable browser context menu so right click works seamlessly
        window.addEventListener('contextmenu', e => e.preventDefault());
    }

    // --- Feature Generation API ---
    registerFeature(name, generatorFunc) {
        this.featureGenerators.set(name, generatorFunc);
    }

    generateFeature(name, x, y, z, ...args) {
        const generator = this.featureGenerators.get(name);
        if (generator) {
            generator(this, x, y, z, ...args);
        }
    }

    // --- Unified Update Frame Tick ---
    update(dt) {
        this.time = (this.time || 0.0) + dt;

        // 1. Tick controller physics
        this.controller.update(dt);

        // 2. Tick repeating block actions
        if (this.mouseButtonsPressed.left || this.mouseButtonsPressed.right) {
            this.blockActionTimer -= dt;
            if (this.blockActionTimer <= 0) {
                this.performBlockAction();
                this.blockActionTimer += this.BLOCK_ACTION_COOLDOWN;
                if (this.blockActionTimer < 0) {
                    this.blockActionTimer = this.BLOCK_ACTION_COOLDOWN;
                }
            }
        }

        // 3. Update global animation time uniform once per frame on shared materials
        for (const mat of ChunkRenderer.materialsList) {
            mat.uniforms.u_time.value = this.time;
        }

        // 4. Update chunk priorities & queues
        this.updateChunks(this.camera.position);

        // 5. Update individual chunk renderers
        let totalInstances = 0;
        for (const chunkRenderer of this.chunkRenderers.values()) {
            chunkRenderer.update(this.camera.position);
            totalInstances += chunkRenderer.instanceCount;
        }
        this.totalInstances = totalInstances;

        // Check if camera is submerged in water/liquid
        const camX = Math.floor(this.camera.position.x);
        const camY = Math.floor(this.camera.position.y);
        const camZ = Math.floor(this.camera.position.z);
        const isSubmerged = this.world.isLiquidAt(camX, camY, camZ);

        if (isSubmerged) {
            if (!this.wasSubmerged) {
                this.wasSubmerged = true;
                this.underwaterPlane.visible = true;
                if (this.scene.fog) {
                    this.scene.fog.color.setHex(0x103070);
                    if (this.scene.fog.isFog) {
                        this.scene.fog.near = 1.0;
                        this.scene.fog.far = 12.0;
                    } else if (this.scene.fog.isFogExp2) {
                        this.scene.fog.density = 0.15;
                    }
                }
                this.skyColor.setHex(0x103070);
            }
        } else {
            if (this.wasSubmerged) {
                this.wasSubmerged = false;
                this.underwaterPlane.visible = false;
                const maxFogDist = CONFIG.CHUNK_SIZE * CONFIG.LOAD_RADIUS;
                if (this.scene.fog) {
                    this.scene.fog.color.setHex(0x7dd3fc);
                    if (this.scene.fog.isFog) {
                        this.scene.fog.near = maxFogDist * 0.55;
                        this.scene.fog.far = maxFogDist * 0.8;
                    } else if (this.scene.fog.isFogExp2) {
                        this.scene.fog.density = 3.0 / maxFogDist;
                    }
                }
                this.skyColor.setHex(0x7dd3fc);
            }
        }
    }
}

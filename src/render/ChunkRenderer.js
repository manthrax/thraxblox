import * as THREE from 'three';
import { VoxelShader } from './voxelShader.js';
import { CONFIG } from '../config.js';
import { blockAnimsConfig, blockTintsConfig, isTrulyTransparent, isOpaque } from '../world/BlockRegistry.js';

// Reusable vectors to avoid allocations in hot path (sorting/rendering)
const tempCamPos = new THREE.Vector3();
const tempCenter = new THREE.Vector3();

export class ChunkRenderer {
    constructor(chunk, scene, textureAtlas, blockFacesConfig, world) {
        this.chunk = chunk;
        this.scene = scene;
        this.textureAtlas = textureAtlas;
        this.world = world;

        // Pools for solid and transparent runs to avoid GC pressure
        this.solidRunsList = [];
        this.transRunsList = [];

        // WebGL Instanced Buffers Setup
        this.maxInstances = 8192; // Max runs per chunk/mesh
        this.solidInstanceCount = 0;
        this.transInstanceCount = 0;

        const baseGeom = new THREE.BoxGeometry(1, 1, 1);
        baseGeom.translate(0.5, 0.5, 0.5); // Native integer alignment [0, 1]

        // --- SOLID GEOMETRY ---
        this.solidGeometry = new THREE.InstancedBufferGeometry();
        this.solidGeometry.index = baseGeom.index;
        for (const name in baseGeom.attributes) {
            this.solidGeometry.setAttribute(name, baseGeom.attributes[name]);
        }

        this.solidGridArray = new Float32Array(this.maxInstances * 3);
        this.solidGridAttribute = new THREE.InstancedBufferAttribute(this.solidGridArray, 3, false, 1);
        this.solidGeometry.setAttribute('a_instanceGrid', this.solidGridAttribute);

        this.solidScaleArray = new Float32Array(this.maxInstances * 2);
        this.solidScaleAttribute = new THREE.InstancedBufferAttribute(this.solidScaleArray, 2, false, 1);
        this.solidGeometry.setAttribute('a_instanceScale', this.solidScaleAttribute);

        this.solidFacesArray = new Float32Array(this.maxInstances);
        this.solidFacesAttribute = new THREE.InstancedBufferAttribute(this.solidFacesArray, 1, false, 1);
        this.solidGeometry.setAttribute('a_instanceFaces', this.solidFacesAttribute);

        // --- TRANSPARENT GEOMETRY ---
        this.transGeometry = new THREE.InstancedBufferGeometry();
        this.transGeometry.index = baseGeom.index;
        for (const name in baseGeom.attributes) {
            this.transGeometry.setAttribute(name, baseGeom.attributes[name]);
        }

        this.transGridArray = new Float32Array(this.maxInstances * 3);
        this.transGridAttribute = new THREE.InstancedBufferAttribute(this.transGridArray, 3, false, 1);
        this.transGeometry.setAttribute('a_instanceGrid', this.transGridAttribute);

        this.transScaleArray = new Float32Array(this.maxInstances * 2);
        this.transScaleAttribute = new THREE.InstancedBufferAttribute(this.transScaleArray, 2, false, 1);
        this.transGeometry.setAttribute('a_instanceScale', this.transScaleAttribute);

        this.transFacesArray = new Float32Array(this.maxInstances);
        this.transFacesAttribute = new THREE.InstancedBufferAttribute(this.transFacesArray, 1, false, 1);
        this.transGeometry.setAttribute('a_instanceFaces', this.transFacesAttribute);

        // --- DISTINCT MATERIALS ---
        this.solidDepthMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(VoxelShader.uniforms),
            vertexShader: VoxelShader.vertexShader,
            fragmentShader: VoxelShader.fragmentShader,
            fog: true,
            transparent: false,
            colorWrite: false,
            depthWrite: true,
            depthFunc: THREE.LessEqualDepth,
            side: THREE.FrontSide
        });

        this.solidColorMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(VoxelShader.uniforms),
            vertexShader: VoxelShader.vertexShader,
            fragmentShader: VoxelShader.fragmentShader,
            fog: true,
            transparent: false,
            colorWrite: true,
            depthWrite: false,
            depthTest: true,
            depthFunc: THREE.EqualDepth,
            side: THREE.FrontSide
        });

        this.transDepthMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(VoxelShader.uniforms),
            vertexShader: VoxelShader.vertexShader,
            fragmentShader: VoxelShader.fragmentShader,
            fog: true,
            transparent: false, // Render as opaque in prepass to ensure proper depth write
            colorWrite: false,
            depthWrite: true,
            depthFunc: THREE.LessEqualDepth,
            side: THREE.FrontSide
        });

        this.transColorMaterial = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.clone(VoxelShader.uniforms),
            vertexShader: VoxelShader.vertexShader,
            fragmentShader: VoxelShader.fragmentShader,
            fog: true,
            transparent: true,
            colorWrite: true,
            depthWrite: false,
            depthFunc: THREE.EqualDepth,
            side: THREE.FrontSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -2
        });

        // Set atlas & configurations on all materials
        this.materialsList = [
            this.solidDepthMaterial,
            this.solidColorMaterial,
            this.transDepthMaterial,
            this.transColorMaterial
        ];

        for (const mat of this.materialsList) {
            mat.uniforms.u_atlas.value = textureAtlas;
            mat.uniforms.u_blockFaces.value = blockFacesConfig;
            mat.uniforms.u_blockAnims.value = blockAnimsConfig;
            mat.uniforms.u_blockTints.value = blockTintsConfig;
            if (window.VoxelAPI && window.VoxelAPI.wireframeMode) {
                mat.wireframe = true;
            }
        }

        // Set proper bounding box and sphere for frustum culling
        const size = CONFIG.CHUNK_SIZE;
        const halfSize = size / 2;
        const boundingBox = new THREE.Box3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(size, chunk.maxHeight, size)
        );
        const halfMaxH = chunk.maxHeight / 2;
        const boundingSphere = new THREE.Sphere(
            new THREE.Vector3(halfSize, halfMaxH, halfSize),
            Math.sqrt(halfSize * halfSize + halfMaxH * halfMaxH + halfSize * halfSize)
        );

        this.solidGeometry.boundingBox = boundingBox;
        this.solidGeometry.boundingSphere = boundingSphere;
        this.transGeometry.boundingBox = boundingBox;
        this.transGeometry.boundingSphere = boundingSphere;

        // Create Meshes (using color materials by default)
        this.solidMesh = new THREE.Mesh(this.solidGeometry, this.solidColorMaterial);
        this.solidMesh.position.set(chunk.x * size, 0, chunk.z * size);
        this.solidMesh.updateMatrix();
        this.solidMesh.updateMatrixWorld();
        this.solidMesh.matrixAutoUpdate = this.solidMesh.matrixWorldAutoUpdate = false;
        this.solidMesh.layers.set(0); // Layer 0 for Solid/Opaque/Binary Transparent
        this.scene.add(this.solidMesh);

        this.transMesh = new THREE.Mesh(this.transGeometry, this.transColorMaterial);
        this.transMesh.position.set(chunk.x * size, 0, chunk.z * size);
        this.transMesh.updateMatrix();
        this.transMesh.updateMatrixWorld();
        this.transMesh.matrixAutoUpdate = this.transMesh.matrixWorldAutoUpdate = false;
        this.transMesh.layers.set(1); // Layer 1 for Transparent
        this.scene.add(this.transMesh);

        // Rebuild runs once at start
        this.rebuildRunsList();
    }

    get instanceCount() {
        return this.solidInstanceCount + this.transInstanceCount;
    }

    getNeighborColumn(dx, dz, localX, localZ) {
        const size = CONFIG.CHUNK_SIZE;
        let nx = localX + dx;
        let nz = localZ + dz;
        let ncx = this.chunk.x;
        let ncz = this.chunk.z;

        if (nx < 0) { ncx--; nx += size; }
        else if (nx >= size) { ncx++; nx -= size; }
        if (nz < 0) { ncz--; nz += size; }
        else if (nz >= size) { ncz++; nz -= size; }

        if (ncx === this.chunk.x && ncz === this.chunk.z) {
            return this.chunk.columns[(nx << CONFIG.CHUNK_SHIFT) | nz];
        }

        if (!this.world) return null;
        const neighborChunk = this.world.chunks.get(`${ncx},${ncz}`);
        if (!neighborChunk) return null; // Unloaded / missing chunk
        return neighborChunk.columns[(nx << CONFIG.CHUNK_SHIFT) | nz];
    }

    isFaceOccluded(neighborCol, startY, endY, isWater) {
        if (!neighborCol) return false; // Default to unoccluded (visible) if neighbor chunk is unloaded

        const runs = neighborCol.runs;
        let currentY = 0;

        for (let i = 0; i < runs.length; i++) {
            const run = runs[i];
            const nextY = currentY + run.length;

            if (nextY > startY && currentY <= endY) {
                const blockType = run.type;
                const occludes = isOpaque(blockType) || (isWater && isTrulyTransparent(blockType));
                if (!occludes) {
                    return false;
                }
            }

            if (currentY > endY) {
                break;
            }

            currentY = nextY;
        }

        return true;
    }

    /**
     * Scan RLE columns and build the list of solid and transparent runs to render
     */
    rebuildRunsList() {
        const columns = this.chunk.columns;
        let solidCount = 0;
        let transCount = 0;
        const size = CONFIG.CHUNK_SIZE;
        const solidPool = this.solidRunsList;
        const transPool = this.transRunsList;

        for (let localX = 0; localX < size; localX++) {
            for (let localZ = 0; localZ < size; localZ++) {
                const colIdx = (localX << CONFIG.CHUNK_SHIFT) | localZ;
                const rleCol = columns[colIdx];
                const runs = rleCol.runs;

                let currentY = 0;
                for (let i = 0; i < runs.length; i++) {
                    const run = runs[i];
                    const runLength = run.length;
                    const type = run.type;

                    if (type > 0) { // Solid/visible block
                        const isWater = isTrulyTransparent(type);
                        
                        // Top and Bottom face occlusion (consecutive runs inside the column)
                        const bottomOccluded = (currentY === 0) || (i > 0 && (isOpaque(runs[i - 1].type) || (isWater && isTrulyTransparent(runs[i - 1].type))));
                        const topOccluded = (i < runs.length - 1 && (isOpaque(runs[i + 1].type) || (isWater && isTrulyTransparent(runs[i + 1].type))));

                        // Side culling using RLE column-to-column overlap checks
                        const endY = currentY + runLength - 1;
                        const xpCol = this.getNeighborColumn(1, 0, localX, localZ);
                        const xnCol = this.getNeighborColumn(-1, 0, localX, localZ);
                        const zpCol = this.getNeighborColumn(0, 1, localX, localZ);
                        const znCol = this.getNeighborColumn(0, -1, localX, localZ);

                        const xpOccluded = this.isFaceOccluded(xpCol, currentY, endY, isWater);
                        const xnOccluded = this.isFaceOccluded(xnCol, currentY, endY, isWater);
                        const zpOccluded = this.isFaceOccluded(zpCol, currentY, endY, isWater);
                        const znOccluded = this.isFaceOccluded(znCol, currentY, endY, isWater);

                        // Construct the 6-bit face visibility mask
                        let facesMask = 0;
                        if (!xpOccluded) facesMask |= (1 << 0); // +X
                        if (!xnOccluded) facesMask |= (1 << 1); // -X
                        if (!topOccluded) facesMask |= (1 << 2); // +Y
                        if (!bottomOccluded) facesMask |= (1 << 3); // -Y
                        if (!zpOccluded) facesMask |= (1 << 4); // +Z
                        if (!znOccluded) facesMask |= (1 << 5); // -Z

                        // If any face is visible, render it
                        if (facesMask > 0) {
                            if (isWater) {
                                if (transCount < this.maxInstances) {
                                    let cachedRun = transPool[transCount];
                                    if (!cachedRun) {
                                        cachedRun = { x: 0, startY: 0, z: 0, height: 0, type: 0, facesMask: 63, dist: 0 };
                                        transPool[transCount] = cachedRun;
                                    }
                                    cachedRun.x = localX;
                                    cachedRun.startY = currentY;
                                    cachedRun.z = localZ;
                                    cachedRun.height = runLength;
                                    cachedRun.type = type;
                                    cachedRun.facesMask = facesMask;
                                    transCount++;
                                }
                            } else {
                                if (solidCount < this.maxInstances) {
                                    let cachedRun = solidPool[solidCount];
                                    if (!cachedRun) {
                                        cachedRun = { x: 0, startY: 0, z: 0, height: 0, type: 0, facesMask: 63, dist: 0 };
                                        solidPool[solidCount] = cachedRun;
                                    }
                                    cachedRun.x = localX;
                                    cachedRun.startY = currentY;
                                    cachedRun.z = localZ;
                                    cachedRun.height = runLength;
                                    cachedRun.type = type;
                                    cachedRun.facesMask = facesMask;
                                    solidCount++;
                                }
                            }
                        }
                    }
                    currentY += runLength;
                }
            }
        }

        this.solidInstanceCount = solidCount;
        this.solidGeometry.instanceCount = solidCount;
        this.transInstanceCount = transCount;
        this.transGeometry.instanceCount = transCount;
        this.chunk.dirty = false;

        // Trigger initial data upload
        this.uploadBuffers();
    }

    /**
     * Upload run data directly to the GPU buffers
     */
    uploadBuffers() {
        // Upload solid runs
        const solidRuns = this.solidRunsList;
        const solidGrid = this.solidGridArray;
        const solidScale = this.solidScaleArray;
        const solidFaces = this.solidFacesArray;
        const solidCount = this.solidInstanceCount;

        for (let i = 0; i < solidCount; i++) {
            const run = solidRuns[i];
            solidGrid[i * 3 + 0] = run.x;
            solidGrid[i * 3 + 1] = run.startY;
            solidGrid[i * 3 + 2] = run.z;

            solidScale[i * 2 + 0] = run.height;
            solidScale[i * 2 + 1] = run.type;

            solidFaces[i] = run.facesMask;
        }

        this.solidGridAttribute.needsUpdate = true;
        this.solidScaleAttribute.needsUpdate = true;
        this.solidFacesAttribute.needsUpdate = true;

        // Upload transparent runs
        const transRuns = this.transRunsList;
        const transGrid = this.transGridArray;
        const transScale = this.transScaleArray;
        const transFaces = this.transFacesArray;
        const transCount = this.transInstanceCount;

        for (let i = 0; i < transCount; i++) {
            const run = transRuns[i];
            transGrid[i * 3 + 0] = run.x;
            transGrid[i * 3 + 1] = run.startY;
            transGrid[i * 3 + 2] = run.z;

            transScale[i * 2 + 0] = run.height;
            transScale[i * 2 + 1] = run.type;

            transFaces[i] = run.facesMask;
        }

        this.transGridAttribute.needsUpdate = true;
        this.transScaleAttribute.needsUpdate = true;
        this.transFacesAttribute.needsUpdate = true;
    }

    update(cameraPosition, timeSeconds) {
        // If chunk blocks changed on CPU, rebuild the run representation
        if (this.chunk.dirty) {
            this.rebuildRunsList();
        }

        // Update animation time uniforms
        if (timeSeconds !== undefined) {
            for (const mat of this.materialsList) {
                mat.uniforms.u_time.value = timeSeconds;
            }
        }
    }

    destroy() {
        this.scene.remove(this.solidMesh);
        this.scene.remove(this.transMesh);
        this.solidGeometry.dispose();
        this.transGeometry.dispose();
        for (const mat of this.materialsList) {
            mat.dispose();
        }
    }
}

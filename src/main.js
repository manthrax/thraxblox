import * as THREE from 'three';
import { createRenderSystem } from './render/RenderSystem.js';
import { EngineAPI } from './api/EngineAPI.js';
import { BLOCK_IDS } from './world/BlockRegistry.js';
import { VoxelConsole } from './ui/Console.js';
import { AtlasDebugger } from './ui/AtlasDebugger.js';

// --- INITIALIZE GRAPHICS SYSTEM ---
const { scene, camera, renderer } = createRenderSystem();

// --- INITIALIZE VOXEL ENGINE API ---
const api = new EngineAPI(scene, camera, renderer);
await api.init();

// Initialize Atlas Visual Debugger overlay (F4 to toggle)
const atlasDebugger = new AtlasDebugger();

// Register Default Tree Feature Generator
api.registerFeature('tree', (api, wx, wy, wz, val, t) => {
    const trunkHeight = 4 + Math.floor(((val * (t + 3)) % 1) * 3); // 4-6 blocks high
    for (let h = 1; h <= trunkHeight; h++) {
        api.setBlock(wx, wy + h, wz, BLOCK_IDS.OAK_LOG);
    }
    const leafBottom = wy + trunkHeight - 1;
    const leafTop = wy + trunkHeight + 2;
    for (let ly = leafBottom; ly <= leafTop; ly++) {
        const radius = ly >= wy + trunkHeight ? 1 : 2;
        for (let lx = -radius; lx <= radius; lx++) {
            for (let lz = -radius; lz <= radius; lz++) {
                if (lx === 0 && lz === 0 && ly <= wy + trunkHeight) continue;
                if (Math.abs(lx) === radius && Math.abs(lz) === radius && Math.random() > 0.7) continue;
                api.setBlock(wx + lx, ly, wz + lz, BLOCK_IDS.LEAVES);
            }
        }
    }
});

// --- HUD TELEMETRY & CONSOLE SETUP ---
const valFps = document.getElementById('val-fps');
const valInstances = document.getElementById('val-instances');
const valPos = document.getElementById('val-pos');
const valMode = document.getElementById('val-mode');
const valChunks = document.getElementById('val-chunks');

// Initialize developer command console overlay
const voxelConsole = new VoxelConsole(api.controller, scene, renderer, valMode);

// HUD Toggle using F3 key (persisted in localStorage)
const hudElement = document.getElementById('hud');
const isHudVisible = localStorage.getItem('voxel_hud_visible') === 'true';
hudElement.style.display = isHudVisible ? 'flex' : 'none';

window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
        e.preventDefault();
        const currentShow = hudElement.style.display === 'flex';
        hudElement.style.display = currentShow ? 'none' : 'flex';
        localStorage.setItem('voxel_hud_visible', !currentShow);
    } else if (e.code === 'F7') {
        e.preventDefault();
        api.useEqualDepthForBackfaces = !api.useEqualDepthForBackfaces;
        console.log(`[Pass 2.5] Translucent Backfaces depthFunc: ${api.useEqualDepthForBackfaces ? 'EqualDepth' : 'LessEqualDepth'}`);
    }
});

// --- MAIN LOOP ---
let lastTime = performance.now();
let frames = 0;
let fpsTimer = 0;

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const dt = (time - lastTime) / 1000.0;
    lastTime = time;

    // Tick engine subsystems (physics, actions, queues, and chunk rendering buffers)
    api.update(dt);

    // --- MANUAL MULTI-PASS RENDER LOOP ---
    api.render();

    const frameTimeMS = (performance.now() - time);

    // Update HUD Metrics
    frames++;
    fpsTimer += dt;
    if (fpsTimer >= 1.0) {
        valFps.textContent = `${Math.round(frames / fpsTimer)} / ${frameTimeMS.toFixed(0)}ms`;
        valInstances.textContent = `${api.totalInstances}`;
        valMode.textContent = api.controller.gameMode.toUpperCase() + (api.controller.isFlying ? ' (FLY)' : '');
        valChunks.textContent = `${api.chunkRenderers.size}`;
        frames = 0;
        fpsTimer = 0;
    }

    // Coordinates HUD telemetry ticker
    const p = api.controller.position;
    valPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
}

// Start the game loop
animate();

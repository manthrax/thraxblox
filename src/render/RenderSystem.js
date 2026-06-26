import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createRenderSystem() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7dd3fc); // Sky blue background
    const maxFogDist = CONFIG.CHUNK_SIZE * CONFIG.LOAD_RADIUS;
    scene.fog = new THREE.Fog(0x7dd3fc, maxFogDist * 0.55, maxFogDist * 0.8);

    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ'; // Important for FPS look rotation

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.autoClear = false;

    const container = document.getElementById('canvas-container');
    if (container) {
        container.innerHTML = '';
        container.appendChild(renderer.domElement);
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, renderer };
}

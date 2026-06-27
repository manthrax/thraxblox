import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class VoxelConsole {
    constructor(controller, scene, renderer, valMode) {
        this.controller = controller;
        this.scene = scene;
        this.renderer = renderer;
        this.valMode = valMode;

        this.consoleContainer = document.getElementById('console-container');
        this.consoleOutput = document.getElementById('console-output');
        this.consoleInput = document.getElementById('console-input');

        this.setupEvents();
        this.log('Voxel Console initialized. Type /help for commands.', '#38bdf8');
    }

    log(msg, color = '#e2e8f0') {
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = msg;
        this.consoleOutput.appendChild(line);
        this.consoleOutput.scrollTop = this.consoleOutput.scrollHeight;
    }

    setupEvents() {
        window.addEventListener('keydown', (e) => {
            if ((e.code === 'Enter' || e.code === 'Backquote' || e.code === 'Slash') && document.pointerLockElement === this.renderer.domElement) {
                e.preventDefault();
                this.controller.enabled = false;
                document.exitPointerLock();
                this.consoleContainer.style.display = 'block';
                this.consoleInput.focus();
                this.consoleInput.value = '';
            } else if ((e.code === 'Escape' || e.code === 'Backquote') && this.consoleContainer.style.display === 'block') {
                e.preventDefault();
                this.consoleContainer.style.display = 'none';
                this.controller.enabled = true;
                this.renderer.domElement.requestPointerLock();
            }
        });

        this.consoleInput.addEventListener('keydown', (e) => {
            if (e.code === 'Enter') {
                const command = this.consoleInput.value.trim();
                if (command) {
                    this.handleCommand(command);
                }
                this.consoleInput.value = '';
            } else if (e.code === 'Escape' || e.code === 'Backquote') {
                e.preventDefault();
                this.consoleInput.value = '';
                this.consoleContainer.style.display = 'none';
                this.controller.enabled = true;
                this.renderer.domElement.requestPointerLock();
            }
            e.stopPropagation();
        });
    }

    handleCommand(cmd) {
        this.log('> ' + cmd, '#94a3b8');
        const parts = cmd.split(/\s+/);
        const op = parts[0].toLowerCase();

        if (op === '/tp') {
            if (parts.length >= 4) {
                const x = parseFloat(parts[1]);
                const y = parseFloat(parts[2]);
                const z = parseFloat(parts[3]);
                if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                    this.controller.position.set(x, y, z);
                    this.controller.velocity.set(0, 0, 0);
                    this.controller.checkUnstuck();
                    this.log(`Teleporting to ${x}, ${y}, ${z}`, '#4ade80');
                } else {
                    this.log('Invalid coordinates. Usage: /tp x y z', '#f87171');
                }
            } else {
                this.log('Usage: /tp x y z', '#f87171');
            }
        } else if (op === '/reset') {
            this.log('Resetting world and player state...', '#facc15');
            localStorage.clear();
            setTimeout(() => {
                window.location.reload();
            }, 500);
        } else if (op === '/gamemode' || op === '/gm' || op === '/gmc' || op === '/gms') {
            let mode = 'survival';
            if (op === '/gmc') mode = 'creative';
            else if (op === '/gms') mode = 'survival';
            else if (parts.length >= 2) {
                const arg = parts[1].toLowerCase();
                if (arg === 'creative' || arg === 'c' || arg === '1') mode = 'creative';
            }

            this.controller.gameMode = mode;
            if (mode !== 'creative') {
                this.controller.isFlying = false;
            }
            this.log(`Game mode set to ${mode.toUpperCase()}`, '#4ade80');
            if (this.valMode) {
                this.valMode.textContent = this.controller.gameMode.toUpperCase() + (this.controller.isFlying ? ' (FLY)' : '');
            }
        } else if (op === '/fog') {
            let enable = true;
            let mode = 'linear';
            if (parts.length >= 2) {
                const arg = parts[1].toLowerCase();
                if (arg === 'off' || arg === 'false' || arg === '0' || arg === 'disable') {
                    enable = false;
                } else if (arg === 'exp' || arg === 'exp2' || arg === 'exponential') {
                    mode = 'exp';
                } else if (arg === 'linear' || arg === 'on') {
                    mode = 'linear';
                }
            } else {
                enable = !this.scene.fog;
            }

            if (enable) {
                const maxFogDistCmd = CONFIG.CHUNK_SIZE * CONFIG.LOAD_RADIUS;
                if (mode === 'exp') {
                    const density = 3.0 / maxFogDistCmd;
                    this.scene.fog = new THREE.FogExp2(0xdae6ff, density);
                    this.log(`Exponential Fog enabled (density: ${density.toFixed(5)})`, '#4ade80');
                } else {
                    this.scene.fog = new THREE.Fog(0xdae6ff, maxFogDistCmd * 0.85, maxFogDistCmd * 0.9);
                    this.log('Linear Fog enabled', '#4ade80');
                }
            } else {
                this.scene.fog = null;
                this.log('Fog disabled', '#facc15');
            }
        } else if (op === '/wireframe' || op === '/wf') {
            let enabled;
            if (parts.length >= 2) {
                const arg = parts[1].toLowerCase();
                enabled = (arg === 'on' || arg === 'true' || arg === '1' || arg === 'enable');
            }
            if (window.VoxelAPI) {
                const active = window.VoxelAPI.toggleWireframe(enabled);
                this.log(`Wireframe mode set to ${active ? 'ON' : 'OFF'}`, '#4ade80');
            } else {
                this.log('VoxelAPI not initialized', '#f87171');
            }
        } else if (op === '/help') {
            this.log('Available commands:', '#38bdf8');
            this.log('  /tp <x> <y> <z>    : Teleport to coordinates', '#e2e8f0');
            this.log('  /gamemode <mode>   : Set game mode (creative/survival)', '#e2e8f0');
            this.log('  /gmc               : Shortcut to set Creative Mode', '#e2e8f0');
            this.log('  /gms               : Shortcut to set Survival Mode', '#e2e8f0');
            this.log('  /fog <linear/exp>  : Toggle, set linear, or exponential fog', '#e2e8f0');
            this.log('  /wireframe [on/off]: Toggle wireframe rendering mode', '#e2e8f0');
            this.log('  /reset             : Wipe player state & reload world', '#e2e8f0');
            this.log('  /help              : Show this help message', '#e2e8f0');
        } else {
            this.log(`Unknown command: ${cmd}. Type /help for info.`, '#f87171');
        }
    }
}

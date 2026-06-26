import * as THREE from 'three';

export class CharacterController {
    constructor(camera, domElement, world) {
        this.camera = camera;
        this.domElement = domElement;
        this.world = world;
        this.enabled = true;

        // Player physical settings
        this.width = 0.6;
        this.height = 1.8;
        this.halfWidth = this.width / 2;
        this.eyeHeight = 1.6; // Camera height relative to player base

        // State variables
        this.position = new THREE.Vector3(0, 80, 0); // Start high, will drop/unstuck
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.yaw = 0;
        this.pitch = 0;
        this.isGrounded = false;
        this.speed = 4.3; // Blocks per second
        this.jumpForce = 8.5;
        this.gravity = 24.0;

        this.currentEyeHeight = this.eyeHeight;

        this.gameMode = 'survival'; // 'survival' or 'creative'
        this.isFlying = false;
        this.lastSpacePress = 0;

        // Input state
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            sprint: false,
            sneak: false
        };

        // Initialize state from localStorage if available
        this.loadState();

        // Bind events
        this.setupPointerLock();
        this.setupKeyboard();
    }

    setupPointerLock() {
        const blocker = document.getElementById('blocker');

        blocker.addEventListener('click', () => {
            this.domElement.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === this.domElement) {
                blocker.style.display = 'none';
            } else {
                blocker.style.display = 'flex';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement !== this.domElement) return;

            const sensitivity = 0.002;
            this.yaw -= e.movementX * sensitivity;
            this.pitch -= e.movementY * sensitivity;

            // Clamp pitch to avoid flipping over
            this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

            // Apply rotation to camera
            this.camera.rotation.set(0, 0, 0);
            this.camera.rotation.y = this.yaw;
            this.camera.rotation.x = this.pitch;

            this.saveState();
        });
    }

    setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (!this.enabled) return;
            if (e.repeat) return;
            this.handleKey(e.code, true);
        });
        window.addEventListener('keyup', (e) => {
            if (!this.enabled) return;
            this.handleKey(e.code, false);
        });
    }

    handleKey(code, isDown) {
        switch (code) {
            case 'KeyW':
            case 'ArrowUp':
                this.keys.forward = isDown;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.keys.backward = isDown;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.keys.left = isDown;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.keys.right = isDown;
                break;
            case 'Space':
                this.keys.jump = isDown;
                if (isDown && this.gameMode === 'creative') {
                    const now = performance.now();
                    if (now - this.lastSpacePress < 300) {
                        this.isFlying = !this.isFlying;
                        this.velocity.y = 0;
                    }
                    this.lastSpacePress = now;
                }
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.sprint = isDown;
                break;
            case 'KeyC':
                this.keys.sneak = isDown;
                break;
        }
    }

    /**
     * Physical frame update with simple sliding collision response.
     */
    update(dt) {
        // Cap dt to prevent massive steps during lag spikes
        dt = Math.min(dt, 0.1);

        // Apply input movement vectors
        const moveVector = new THREE.Vector3();
        if (this.keys.forward) moveVector.z -= 1;
        if (this.keys.backward) moveVector.z += 1;
        if (this.keys.left) moveVector.x -= 1;
        if (this.keys.right) moveVector.x += 1;

        moveVector.normalize();

        // Compute speed and crouch adjustments
        let targetEyeHeight = this.eyeHeight;
        let currentSpeed = this.speed;

        if (this.isFlying) {
            currentSpeed = this.speed * 4.0; // 4x base fly speed
            if (this.keys.sprint) {
                currentSpeed = this.speed * 4.0 * 2.2; // 4x fly speed boost (sprinting fly)
            }
            // Rotate the movement vector in full 3D space by the camera's rotation
            moveVector.applyQuaternion(this.camera.quaternion);
        } else {
            if (this.keys.sprint) {
                currentSpeed = this.speed * 1.6;
            }
            if (this.keys.sneak) {
                currentSpeed = this.speed * 0.5;
                targetEyeHeight = 1.1; // Crouched camera height
            }
            // Rotate the movement vector horizontally by the camera's Y rotation
            moveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camera.rotation.y);
        }

        // Smoothly interpolate eye height for a premium feel
        this.currentEyeHeight = THREE.MathUtils.lerp(this.currentEyeHeight, targetEyeHeight, 15.0 * dt);

        // Apply speed
        this.velocity.x = moveVector.x * currentSpeed;
        this.velocity.z = moveVector.z * currentSpeed;

        if (this.isFlying) {
            this.velocity.y = moveVector.y * currentSpeed;
            if (this.keys.jump) this.velocity.y += currentSpeed;
            if (this.keys.sneak) this.velocity.y -= currentSpeed;
        } else {
            // Gravity
            this.velocity.y -= this.gravity * dt;

            // Jump
            if (this.keys.jump && this.isGrounded) {
                this.velocity.y = this.jumpForce;
                this.isGrounded = false;
            }
        }

        // Apply velocity with detailed AABB voxel collision checking
        this.move(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);

        // Auto-unstuck logic
        this.checkUnstuck();

        // Synchronize camera position with player coordinates (using smooth eye height)
        this.camera.position.set(
            this.position.x,
            this.position.y + this.currentEyeHeight,
            this.position.z
        );

        this.saveState();
    }

    /**
     * Voxel AABB collision response.
     * Moves along each axis separately, checking and responding to block collisions.
     */
    move(dx, dy, dz) {
        const world = this.world;

        // 1. Move on Y axis (vertical physics)
        this.position.y += dy;
        let bounds = this.getAABB();
        let colliders = this.getNearbyBlocks(bounds);

        for (const block of colliders) {
            if (this.intersects(bounds, block)) {
                if (dy > 0) { // Moving up, hit ceiling
                    this.position.y = block.minY - this.height;
                    this.velocity.y = 0;
                } else if (dy < 0) { // Moving down, hit floor
                    this.position.y = block.maxY;
                    this.velocity.y = 0;
                    this.isGrounded = true;
                }
                bounds = this.getAABB();
            }
        }

        // Detect if player is hovering/falling (not grounded)
        if (dy < 0 && this.velocity.y < 0) {
            // Check if there's any floor immediately underneath
            const footBounds = this.getAABB();
            footBounds.minY -= 0.05;
            let onGround = false;
            let belowColliders = this.getNearbyBlocks(footBounds);
            for (const block of belowColliders) {
                if (this.intersects(footBounds, block)) {
                    onGround = true;
                    break;
                }
            }
            this.isGrounded = onGround;
        }

        // 2. Move on X axis
        this.position.x += dx;
        bounds = this.getAABB();
        colliders = this.getNearbyBlocks(bounds);

        for (const block of colliders) {
            if (this.intersects(bounds, block)) {
                if (dx > 0) {
                    this.position.x = block.minX - this.halfWidth;
                } else if (dx < 0) {
                    this.position.x = block.maxX + this.halfWidth;
                }
                this.velocity.x = 0;
                bounds = this.getAABB();
            }
        }

        // 3. Move on Z axis
        this.position.z += dz;
        bounds = this.getAABB();
        colliders = this.getNearbyBlocks(bounds);

        for (const block of colliders) {
            if (this.intersects(bounds, block)) {
                if (dz > 0) {
                    this.position.z = block.minZ - this.halfWidth;
                } else if (dz < 0) {
                    this.position.z = block.maxZ + this.halfWidth;
                }
                this.velocity.z = 0;
                bounds = this.getAABB();
            }
        }
    }

    /**
     * Warps player upwards if stuck inside solid voxels
     */
    checkUnstuck() {
        let isStuck = true;
        let safetyCounter = 0;

        while (isStuck && safetyCounter < 128) {
            const bounds = this.getAABB();
            const colliders = this.getNearbyBlocks(bounds);
            let collision = false;

            for (const block of colliders) {
                if (this.intersects(bounds, block)) {
                    collision = true;
                    break;
                }
            }

            if (collision) {
                // Warp up by a small amount or snap to next integer Y layer
                this.position.y = Math.floor(this.position.y) + 1.0;
                safetyCounter++;
            } else {
                isStuck = false;
            }
        }
    }

    /**
     * Computes player AABB
     */
    getAABB() {
        return {
            minX: this.position.x - this.halfWidth,
            maxX: this.position.x + this.halfWidth,
            minY: this.position.y,
            maxY: this.position.y + this.height,
            minZ: this.position.z - this.halfWidth,
            maxZ: this.position.z + this.halfWidth
        };
    }

    intersects(a, b) {
        return (a.minX < b.maxX && a.maxX > b.minX) &&
            (a.minY < b.maxY && a.maxY > b.minY) &&
            (a.minZ < b.maxZ && a.maxZ > b.minZ);
    }

    /**
     * Scans local area and returns bounding boxes of solid blocks
     */
    getNearbyBlocks(bounds) {
        const blocks = [];
        const minX = Math.floor(bounds.minX);
        const maxX = Math.floor(bounds.maxX);
        const minY = Math.floor(bounds.minY);
        const maxY = Math.floor(bounds.maxY);
        const minZ = Math.floor(bounds.minZ);
        const maxZ = Math.floor(bounds.maxZ);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    if (this.world.isSolidAt(x, y, z)) {
                        blocks.push({
                            minX: x,
                            maxX: x + 1,
                            minY: y,
                            maxY: y + 1,
                            minZ: z,
                            maxZ: z + 1
                        });
                    }
                }
            }
        }
        return blocks;
    }

    saveState() {
        const state = {
            x: this.position.x,
            y: this.position.y,
            z: this.position.z,
            yaw: this.yaw,
            pitch: this.pitch,
            gameMode: this.gameMode,
            isFlying: this.isFlying
        };
        localStorage.setItem('voxel_player_state', JSON.stringify(state));
    }

    loadState() {
        try {
            const raw = localStorage.getItem('voxel_player_state');
            if (raw) {
                const state = JSON.parse(raw);
                if (typeof state.x === 'number' && typeof state.y === 'number' && typeof state.z === 'number') {
                    this.position.set(state.x, state.y, state.z);
                    this.yaw = state.yaw || 0;
                    this.pitch = state.pitch || 0;
                    this.gameMode = state.gameMode || 'survival';
                    this.isFlying = state.isFlying || false;

                    this.camera.rotation.set(0, 0, 0);
                    this.camera.rotation.y = this.yaw;
                    this.camera.rotation.x = this.pitch;
                }
            }
        } catch (e) {
            console.warn('Failed to load player state:', e);
        }
    }
}

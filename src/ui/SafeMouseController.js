export class SafeMouseController {
    /**
     * @param {HTMLElement} element - The DOM element to lock (e.g., your canvas)
     * @param {Function} onMoveCallback - Called on safe movement: (deltaX, deltaY) => {}
     * @param {number} maxDelta - Maximum allowed movement per frame before filtering (default: 300)
     */
    constructor(element, onMoveCallback, maxDelta = 500) {
        this.element = element;
        this.onMove = onMoveCallback;
        this.maxDelta = maxDelta;
        this.isLocked = false;

        this.onLockCallbacks = [];
        this.onUnlockCallbacks = [];

        // Bind contexts for event listeners
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onPointerLockChange = this._onPointerLockChange.bind(this);

        // Setup global listener for lock state changes
        document.addEventListener('pointerlockchange', this._onPointerLockChange);
    }

    /**
     * Register a callback to fire when pointer lock is acquired
     */
    onLock(callback) {
        this.onLockCallbacks.push(callback);
        return this;
    }

    /**
     * Register a callback to fire when pointer lock is released
     */
    onUnlock(callback) {
        this.onUnlockCallbacks.push(callback);
        return this;
    }

    /**
     * Request pointer lock with modern unadjusted movement and fallbacks
     */
    requestLock() {
        if (this.isLocked) return;

        this.element.requestPointerLock({
            unadjustedMovement: true,
        }).catch((error) => {
            // Fallback for older browsers or systems that don't support unadjusted movement
            if (error.name === "NotSupportedError") {
                this.element.requestPointerLock();
            } else {
                console.error("Pointer lock failed:", error);
            }
        });
    }

    /**
     * Exit pointer lock safely
     */
    exitLock() {
        if (document.pointerLockElement === this.element) {
            document.exitPointerLock();
        }
    }

    _onPointerLockChange() {
        if (document.pointerLockElement === this.element) {
            this.isLocked = true;
            document.addEventListener('mousemove', this._onMouseMove);
            this.onLockCallbacks.forEach(cb => cb());
        } else {
            this.isLocked = false;
            document.removeEventListener('mousemove', this._onMouseMove);
            this.onUnlockCallbacks.forEach(cb => cb());
        }
    }

    _onMouseMove(event) {
        const dx = event.movementX;
        const dy = event.movementY;

        // The Magic Filter: Check if the delta smells like a browser/OS "re-centering" snap
        if (Math.abs(dx) > this.maxDelta || Math.abs(dy) > this.maxDelta) {
            // Ignore this frame entirely
            return;
        }

        // Fire your game/app logic with verified clean numbers
        this.onMove(dx, dy);
    }

    /**
     * Clean up event listeners when discarding the controller
     */
    destroy() {
        this.exitLock();
        document.removeEventListener('pointerlockchange', this._onPointerLockChange);
        document.removeEventListener('mousemove', this._onMouseMove);
    }
}

import * as THREE from 'three'

const BASE_FOV  = 72
const MAX_FOV   = 84  // expands at high speed — makes the game feel faster

export class CameraController {
  constructor(camera) {
    this.camera      = camera
    this.yaw         = 0
    this.pitch       = 0.32
    this.distance    = 13   // slightly further back for better overview
    this.shakeIntensity = 0
    this.shakeDecay  = 3

    this.targetPos   = new THREE.Vector3()
    this.currentPos  = new THREE.Vector3(0, 7, 13)

    // Smoothed look-at target
    this._lookTarget = new THREE.Vector3()
    this._lookSmooth = null  // initialized on first update to avoid (0,0,0) jitter

    // Cached directional vectors — avoids new THREE.Vector3() every call
    this._fwdDir   = new THREE.Vector3()
    this._rightDir = new THREE.Vector3()
    this._fwdDirty = true
  }

  update(dt, playerPos, inputState, playerVelocity) {
    // Manual rotation via mouse / touch
    this.yaw   -= inputState.mouseDx
    this.pitch -= inputState.mouseDy
    this.pitch  = Math.max(-0.05, Math.min(0.88, this.pitch))

    // Auto-rotate yaw toward movement direction when not actively steering
    if (playerVelocity && Math.abs(inputState.mouseDx) < 0.001 && Math.abs(inputState.mouseDy) < 0.001) {
      const hvel = Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2)
      if (hvel > 5) {
        const targetYaw = Math.atan2(playerVelocity.x, playerVelocity.z)
        let dyaw = targetYaw - this.yaw
        while (dyaw > Math.PI)  dyaw -= Math.PI * 2
        while (dyaw < -Math.PI) dyaw += Math.PI * 2
        // Gentler auto-rotation (0.25 vs 0.4) — feels less fight-y
        this.yaw += dyaw * dt * 0.25
      }
    }

    // Adaptive distance — pull back slightly at high speed
    const speed       = playerVelocity ? Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2) : 0
    const targetDist  = 13 + Math.min(5, speed * 0.28)
    this.distance    += (targetDist - this.distance) * dt * 3

    // Dynamic FOV — gives a sense of speed without changing physics
    const targetFOV   = BASE_FOV + Math.min(MAX_FOV - BASE_FOV, speed * 0.55)
    this.camera.fov  += (targetFOV - this.camera.fov) * dt * 5
    this.camera.updateProjectionMatrix()

    // Camera orbit position
    const sinYaw   = Math.sin(this.yaw)
    const cosYaw   = Math.cos(this.yaw)
    const cosPitch = Math.cos(this.pitch)
    const sinPitch = Math.sin(this.pitch)

    this.targetPos.set(
      playerPos.x + this.distance * sinYaw  * cosPitch,
      playerPos.y + this.distance * sinPitch + 1.5,
      playerPos.z + this.distance * cosYaw  * cosPitch
    )

    // Rubber-band lerp — snaps quickly when far away
    const dist     = this.currentPos.distanceTo(this.targetPos)
    const lerpSpd  = Math.min(1, dt * (7 + dist * 0.6))
    this.currentPos.lerp(this.targetPos, lerpSpd)

    // Screen shake
    if (this.shakeIntensity > 0) {
      this.shakeIntensity -= dt * this.shakeDecay
      if (this.shakeIntensity < 0) this.shakeIntensity = 0
      this.currentPos.x += (Math.random() - 0.5) * this.shakeIntensity
      this.currentPos.y += (Math.random() - 0.5) * this.shakeIntensity * 0.5
      this.currentPos.z += (Math.random() - 0.5) * this.shakeIntensity
    }

    this.camera.position.copy(this.currentPos)

    // Smooth look-at — initialize to current player pos to avoid (0,0,0) jump
    this._lookTarget.set(playerPos.x, playerPos.y + 1.2, playerPos.z)
    if (!this._lookSmooth) {
      this._lookSmooth = this._lookTarget.clone()
    }
    this._lookSmooth.lerp(this._lookTarget, dt * 10)
    this.camera.lookAt(this._lookSmooth)

    // Mark cached dirs stale after camera moved
    this._fwdDirty = true
  }

  shake(intensity = 1, duration = 0.3) {
    this.shakeIntensity = intensity
    this.shakeDecay     = intensity / duration
  }

  // Cached forward/right — only recomputed when camera actually moved
  getForwardDir() {
    if (this._fwdDirty) {
      this.camera.getWorldDirection(this._fwdDir)
      this._fwdDir.y = 0
      this._fwdDir.normalize()
      this._rightDir.set(this._fwdDir.z, 0, -this._fwdDir.x)
      this._fwdDirty = false
    }
    return this._fwdDir
  }

  getRightDir() {
    this.getForwardDir() // ensure computed
    return this._rightDir
  }

  getScreenAngleTo(worldPos, playerPos) {
    const fwd   = this.getForwardDir()
    const right = this.getRightDir()
    const dx    = worldPos.x - playerPos.x
    const dz    = worldPos.z - playerPos.z
    return Math.atan2(dx * right.x + dz * right.z, dx * fwd.x + dz * fwd.z) * (180 / Math.PI)
  }
}

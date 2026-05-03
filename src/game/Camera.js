import * as THREE from 'three'

export class CameraController {
  constructor(camera) {
    this.camera = camera
    this.yaw = 0
    this.pitch = 0.35
    this.distance = 11
    this.targetPos = new THREE.Vector3()
    this.currentPos = new THREE.Vector3(0, 6, 11)
    this.shakeIntensity = 0
    this.shakeDecay = 3
    // Smoothed look-at point (slightly above player for better view)
    this._lookTarget = new THREE.Vector3()
    this._lookSmooth = new THREE.Vector3()
    // Auto-rotate toward movement when idle
    this._lastMoveTime = 0
    this._playerVel = new THREE.Vector3()
  }

  update(dt, playerPos, inputState, playerVelocity) {
    // Manual camera rotation
    this.yaw -= inputState.mouseDx
    this.pitch -= inputState.mouseDy
    this.pitch = Math.max(-0.05, Math.min(0.9, this.pitch))

    // Slowly auto-rotate yaw toward movement direction when not touching mouse
    if (playerVelocity && (Math.abs(inputState.mouseDx) < 0.001 && Math.abs(inputState.mouseDy) < 0.001)) {
      const hvel = Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2)
      if (hvel > 4) {
        const targetYaw = Math.atan2(playerVelocity.x, playerVelocity.z)
        let dyaw = targetYaw - this.yaw
        // Wrap to [-PI, PI]
        while (dyaw > Math.PI) dyaw -= Math.PI * 2
        while (dyaw < -Math.PI) dyaw += Math.PI * 2
        this.yaw += dyaw * dt * 0.4
      }
    }

    // Adaptive distance — pull back a bit when going fast
    const speed = playerVelocity ? Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2) : 0
    const targetDist = 11 + Math.min(4, speed * 0.25)
    this.distance += (targetDist - this.distance) * dt * 3

    // Ideal camera orbit position
    const sinYaw = Math.sin(this.yaw)
    const cosYaw = Math.cos(this.yaw)
    const cosPitch = Math.cos(this.pitch)
    const sinPitch = Math.sin(this.pitch)

    this.targetPos.set(
      playerPos.x + this.distance * sinYaw * cosPitch,
      playerPos.y + this.distance * sinPitch + 1.5,
      playerPos.z + this.distance * cosYaw * cosPitch
    )

    // Smooth follow — faster when far away (rubber-band)
    const dist = this.currentPos.distanceTo(this.targetPos)
    const lerpSpeed = Math.min(1, dt * (6 + dist * 0.5))
    this.currentPos.lerp(this.targetPos, lerpSpeed)

    // Screen shake
    if (this.shakeIntensity > 0) {
      this.shakeIntensity -= dt * this.shakeDecay
      if (this.shakeIntensity < 0) this.shakeIntensity = 0
      this.currentPos.x += (Math.random() - 0.5) * this.shakeIntensity
      this.currentPos.y += (Math.random() - 0.5) * this.shakeIntensity * 0.5
      this.currentPos.z += (Math.random() - 0.5) * this.shakeIntensity
    }

    this.camera.position.copy(this.currentPos)

    // Smooth look-at — look slightly ahead of where player is
    this._lookTarget.set(playerPos.x, playerPos.y + 1.2, playerPos.z)
    this._lookSmooth.lerp(this._lookTarget, dt * 10)
    this.camera.lookAt(this._lookSmooth)
  }

  shake(intensity = 1, duration = 0.3) {
    this.shakeIntensity = intensity
    this.shakeDecay = intensity / duration
  }

  getForwardDir() {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    dir.y = 0
    dir.normalize()
    return dir
  }

  getRightDir() {
    const fwd = this.getForwardDir()
    return new THREE.Vector3(fwd.z, 0, -fwd.x)
  }

  // Screen-space direction to a world point (for compass)
  getScreenAngleTo(worldPos, playerPos) {
    const dir = new THREE.Vector3().subVectors(worldPos, playerPos)
    const fwd = this.getForwardDir()
    const right = this.getRightDir()
    const x = dir.dot(right)
    const z = dir.dot(fwd)
    return Math.atan2(x, z) * (180 / Math.PI)
  }
}

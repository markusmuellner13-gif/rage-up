import * as THREE from 'three'

export class CameraController {
  constructor(camera) {
    this.camera = camera
    this.yaw = 0       // horizontal angle
    this.pitch = 0.3   // vertical angle
    this.distance = 12
    this.targetPos = new THREE.Vector3()
    this.currentPos = new THREE.Vector3(0, 5, 12)
    this.shakeIntensity = 0
    this.shakeDecay = 3
    this._offset = new THREE.Vector3()
  }

  update(dt, playerPos, inputState) {
    // Rotate camera with mouse/touch
    this.yaw -= inputState.mouseDx
    this.pitch -= inputState.mouseDy
    this.pitch = Math.max(-0.1, Math.min(1.0, this.pitch))

    // Compute ideal camera position (orbit around player)
    const sinYaw = Math.sin(this.yaw)
    const cosYaw = Math.cos(this.yaw)
    const cosPitch = Math.cos(this.pitch)
    const sinPitch = Math.sin(this.pitch)

    this.targetPos.set(
      playerPos.x + this.distance * sinYaw * cosPitch,
      playerPos.y + this.distance * sinPitch + 2,
      playerPos.z + this.distance * cosYaw * cosPitch
    )

    // Smooth follow
    this.currentPos.lerp(this.targetPos, Math.min(1, dt * 8))

    // Screen shake
    if (this.shakeIntensity > 0) {
      this.shakeIntensity -= dt * this.shakeDecay
      if (this.shakeIntensity < 0) this.shakeIntensity = 0
      this.currentPos.x += (Math.random() - 0.5) * this.shakeIntensity
      this.currentPos.y += (Math.random() - 0.5) * this.shakeIntensity
      this.currentPos.z += (Math.random() - 0.5) * this.shakeIntensity
    }

    this.camera.position.copy(this.currentPos)
    this.camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z)
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
}

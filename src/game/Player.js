import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const RADIUS = 0.55
const GROUND_FORCE = 18
const AIR_FORCE = 4
const JUMP_VEL = 14
const MAX_SPEED = 18
const COYOTE_TIME = 0.12

export class Player {
  constructor(scene, physicsWorld, physMats) {
    this.scene = scene
    this.world = physicsWorld
    this.deathCount = 0
    this.checkpointIndex = 0
    this.checkpointPos = new THREE.Vector3(0, 2, 0)
    this._grounded = false
    this._groundedTimer = 0
    this._lastVelY = 0
    this._faceState = 'normal' // normal, scared, happy, checkpoint
    this._faceTimer = 0
    this._lastFaceUpdate = 0

    this._buildPhysics(physMats)
    this._buildMesh()
    this._buildTrail()
    this._buildShadow()
  }

  _buildPhysics(physMats) {
    const mat = physMats?.ball || new CANNON.Material({ friction: 0.6, restitution: 0.2 })
    this.body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(RADIUS),
      material: mat,
      linearDamping: 0.35,
      angularDamping: 0.45,
      allowSleep: false
    })
    this.body.position.set(0, 3, 0)
    this.world.addBody(this.body)

    // Ground contact detection
    this.body.addEventListener('collide', evt => {
      const contact = evt.contact
      // Determine normal direction relative to player
      const n = contact.ni.clone()
      if (contact.bj === this.body) n.negate()
      if (n.y > 0.45) {
        this._grounded = true
        this._groundedTimer = COYOTE_TIME
      }
    })
  }

  _buildMesh() {
    // Face canvas texture
    this._faceCanvas = document.createElement('canvas')
    this._faceCanvas.width = 256
    this._faceCanvas.height = 256
    this._faceCtx = this._faceCanvas.getContext('2d')
    this._faceTex = new THREE.CanvasTexture(this._faceCanvas)

    const geo = new THREE.SphereGeometry(RADIUS, 32, 32)
    // Sphere body material — gradient set via vertex colors trick using a shader
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      roughness: 0.4,
      metalness: 0.15,
      map: this._faceTex
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = false
    this.scene.add(this.mesh)

    // Eyes (separate meshes for more 3D look)
    const eyeGeo = new THREE.SphereGeometry(0.08, 12, 12)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.1 })
    this._eyeL = new THREE.Mesh(eyeGeo, eyeMat)
    this._eyeR = new THREE.Mesh(eyeGeo, eyeMat)
    this._eyeL.position.set(-0.2, 0.2, RADIUS * 0.93)
    this._eyeR.position.set(0.2, 0.2, RADIUS * 0.93)
    this.mesh.add(this._eyeL)
    this.mesh.add(this._eyeR)
  }

  _buildTrail() {
    this._trailPoints = []
    this._trailMaxLen = 20
    this._trailGeo = new THREE.BufferGeometry()
    this._trailPositions = new Float32Array(this._trailMaxLen * 3)
    this._trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3))
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xff8844, transparent: true, opacity: 0.5,
      linewidth: 2
    })
    this._trailLine = new THREE.Line(this._trailGeo, trailMat)
    this.scene.add(this._trailLine)
  }

  _buildShadow() {
    // Blob shadow under ball
    const geo = new THREE.CircleGeometry(RADIUS * 1.2, 16)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.35,
      depthWrite: false
    })
    this._shadowBlob = new THREE.Mesh(geo, mat)
    this._shadowBlob.rotation.x = -Math.PI / 2
    this.scene.add(this._shadowBlob)
  }

  update(dt, inputState, world, camera) {
    // Ground timer (coyote time)
    if (this._groundedTimer > 0) {
      this._groundedTimer -= dt
      if (this._groundedTimer <= 0) this._grounded = false
    }

    // Movement forces relative to camera direction
    const forward = camera ? camera.getForwardDir() : new THREE.Vector3(0, 0, -1)
    const right = camera ? camera.getRightDir() : new THREE.Vector3(1, 0, 0)

    const force = this._grounded ? GROUND_FORCE : AIR_FORCE
    const fx = (forward.x * inputState.forward + right.x * inputState.right) * force
    const fz = (forward.z * inputState.forward + right.z * inputState.right) * force

    // Speed cap — allow upward velocity freely
    const hv = new CANNON.Vec3(this.body.velocity.x, 0, this.body.velocity.z)
    if (hv.length() < MAX_SPEED) {
      this.body.applyForce(new CANNON.Vec3(fx, 0, fz), this.body.position)
    }

    // Jump
    if (inputState.jump && this._grounded) {
      this.body.velocity.y = JUMP_VEL
      this._grounded = false
      this._groundedTimer = 0
    }

    // Sync mesh to physics body
    this.mesh.position.copy(this.body.position)
    this.mesh.quaternion.copy(this.body.quaternion)

    // Update trail
    this._updateTrail()

    // Update shadow
    this._updateShadowBlob(world)

    // Update face state
    this._updateFace(dt)

    // Store last Y velocity
    this._lastVelY = this.body.velocity.y

    // Update eye orientation (face camera)
    if (camera) {
      this._eyeL.lookAt(camera.camera.position)
      this._eyeR.lookAt(camera.camera.position)
    }
  }

  _updateTrail() {
    const p = this.body.position
    this._trailPoints.push(new THREE.Vector3(p.x, p.y, p.z))
    if (this._trailPoints.length > this._trailMaxLen) this._trailPoints.shift()

    for (let i = 0; i < this._trailPoints.length; i++) {
      const tp = this._trailPoints[i]
      this._trailPositions[i * 3] = tp.x
      this._trailPositions[i * 3 + 1] = tp.y
      this._trailPositions[i * 3 + 2] = tp.z
    }
    // Pad remaining
    for (let i = this._trailPoints.length; i < this._trailMaxLen; i++) {
      const last = this._trailPoints[this._trailPoints.length - 1] || new THREE.Vector3()
      this._trailPositions[i * 3] = last.x
      this._trailPositions[i * 3 + 1] = last.y
      this._trailPositions[i * 3 + 2] = last.z
    }
    this._trailGeo.attributes.position.needsUpdate = true
    this._trailGeo.setDrawRange(0, this._trailPoints.length)
  }

  _updateShadowBlob(world) {
    const pos = this.body.position
    this._shadowBlob.position.set(pos.x, pos.y - RADIUS - 0.05, pos.z)
    // Raycast down to place on platform (simple Y offset for now)
    const scl = Math.max(0.2, 1.0 - Math.abs(this._lastVelY) * 0.04)
    this._shadowBlob.scale.setScalar(scl)
    this._shadowBlob.material.opacity = Math.max(0.05, 0.35 * scl)
  }

  _updateFace(dt) {
    const now = performance.now()
    if (now - this._lastFaceUpdate < 80) return // throttle to ~12fps
    this._lastFaceUpdate = now

    const vy = this.body.velocity.y
    if (vy < -8) this._faceState = 'scared'
    else if (this._faceTimer > 0) {
      this._faceTimer -= 0.08
      if (this._faceTimer <= 0) this._faceState = 'normal'
    } else {
      this._faceState = 'normal'
    }

    this._drawFace()
  }

  _drawFace() {
    const ctx = this._faceCtx
    const size = 256
    ctx.clearRect(0, 0, size, size)

    const state = this._faceState
    const vy = this.body.velocity.y

    // Base ball color
    const grad = ctx.createRadialGradient(100, 90, 20, 128, 128, 130)
    if (state === 'scared') {
      grad.addColorStop(0, '#ff9944')
      grad.addColorStop(1, '#cc3300')
    } else if (state === 'checkpoint') {
      grad.addColorStop(0, '#88ff88')
      grad.addColorStop(1, '#22aa22')
    } else {
      grad.addColorStop(0, '#ff7755')
      grad.addColorStop(1, '#cc3311')
    }
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(128, 128, 124, 0, Math.PI * 2)
    ctx.fill()

    // Shine
    const shine = ctx.createRadialGradient(90, 75, 5, 95, 80, 50)
    shine.addColorStop(0, 'rgba(255,255,255,0.5)')
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = shine
    ctx.beginPath()
    ctx.ellipse(95, 80, 40, 30, -0.4, 0, Math.PI * 2)
    ctx.fill()

    // Eye expressions
    const panicY = state === 'scared' ? -5 : 0
    const eyeVelocityX = Math.max(-8, Math.min(8, this.body.velocity.x * 0.8))

    const drawEye = (cx, cy) => {
      // White
      ctx.fillStyle = 'white'
      ctx.beginPath()
      ctx.ellipse(cx, cy + panicY, state === 'scared' ? 22 : 18, state === 'scared' ? 24 : 20, 0, 0, Math.PI * 2)
      ctx.fill()
      // Pupil
      ctx.fillStyle = '#111'
      ctx.beginPath()
      ctx.arc(cx + eyeVelocityX * 0.5, cy + panicY + (vy < 0 ? Math.min(4, -vy * 0.3) : 0), state === 'scared' ? 10 : 8, 0, Math.PI * 2)
      ctx.fill()
      // Shine
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.arc(cx + eyeVelocityX * 0.5 - 3, cy + panicY - 3, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    drawEye(92, 105)
    drawEye(164, 105)

    // Eyebrows for scared
    if (state === 'scared') {
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(70, 82)
      ctx.lineTo(116, 90)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(142, 90)
      ctx.lineTo(188, 82)
      ctx.stroke()
    }

    // Mouth
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.beginPath()
    if (state === 'scared') {
      // Open scared mouth
      ctx.ellipse(128, 168, 22, 18, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#550000'
      ctx.fill()
    } else if (state === 'checkpoint') {
      // Big happy smile
      ctx.arc(128, 148, 35, 0.2, Math.PI - 0.2)
      ctx.stroke()
    } else {
      // Small smile
      ctx.arc(128, 155, 22, 0.3, Math.PI - 0.3)
      ctx.stroke()
    }

    this._faceTex.needsUpdate = true
  }

  setCheckpointFace(duration = 2) {
    this._faceState = 'checkpoint'
    this._faceTimer = duration / 0.08
    this._drawFace()
  }

  get position() { return this.body.position }

  respawnAt(pos) {
    this.body.position.set(pos.x, pos.y + 2, pos.z)
    this.body.velocity.set(0, 0, 0)
    this.body.angularVelocity.set(0, 0, 0)
    this.deathCount++
    this._trailPoints = []
  }

  setPosition(x, y, z) {
    this.body.position.set(x, y + 2, z)
    this.body.velocity.set(0, 0, 0)
    this.body.angularVelocity.set(0, 0, 0)
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.scene.remove(this._trailLine)
    this.scene.remove(this._shadowBlob)
    this.world.removeBody(this.body)
  }
}

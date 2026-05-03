import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const RADIUS = 0.55
const GROUND_FORCE = 28
const AIR_FORCE = 10
const JUMP_VEL = 16
const JUMP_HOLD_FORCE = 12   // extra upward force while holding space during ascent
const JUMP_HOLD_DURATION = 0.22
const MAX_SPEED = 20
const COYOTE_TIME = 0.18
const JUMP_BUFFER_TIME = 0.15  // press Space up to 150ms before landing → auto-jump

export class Player {
  constructor(scene, physicsWorld, physMats) {
    this.scene = scene
    this.world = physicsWorld
    this.deathCount = 0
    this.checkpointIndex = 0
    this.checkpointPos = new THREE.Vector3(0, 2, 0)

    this._grounded = false
    this._groundedTimer = 0
    this._jumpBufferTimer = 0     // countdown after Space is pressed
    this._jumpHoldTimer = 0       // countdown for variable jump height
    this._jumpHolding = false
    this._lastVelY = 0
    this._faceState = 'normal'
    this._faceTimer = 0
    this._lastFaceUpdate = 0
    this._speed = 0
    this._onLaunchPad = false
    this._launchCooldown = 0

    this._buildPhysics(physMats)
    this._buildMesh()
    this._buildTrail()
    this._buildShadow()
  }

  _buildPhysics(physMats) {
    const mat = physMats?.ball || new CANNON.Material({ friction: 0.6, restitution: 0.25 })
    this.body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(RADIUS),
      material: mat,
      linearDamping: 0.32,
      angularDamping: 0.5,
      allowSleep: false
    })
    this.body.position.set(0, 3, 0)
    this.world.addBody(this.body)

    this.body.addEventListener('collide', evt => {
      const contact = evt.contact
      const n = contact.ni.clone()
      if (contact.bj === this.body) n.negate()
      if (n.y > 0.4) {
        // Buffer jump: if Space was recently pressed, jump immediately
        if (this._jumpBufferTimer > 0) {
          this._doJump()
        } else {
          this._grounded = true
          this._groundedTimer = COYOTE_TIME
        }
      }
    })
  }

  _buildMesh() {
    this._faceCanvas = document.createElement('canvas')
    this._faceCanvas.width = 256
    this._faceCanvas.height = 256
    this._faceCtx = this._faceCanvas.getContext('2d')
    this._faceTex = new THREE.CanvasTexture(this._faceCanvas)

    const geo = new THREE.SphereGeometry(RADIUS, 32, 32)
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      roughness: 0.35,
      metalness: 0.2,
      map: this._faceTex
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.castShadow = true
    this.scene.add(this.mesh)

    // 3D eyes
    const eyeGeo = new THREE.SphereGeometry(0.09, 10, 10)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 })
    this._eyeL = new THREE.Mesh(eyeGeo, eyeMat)
    this._eyeR = new THREE.Mesh(eyeGeo, eyeMat)
    this._eyeL.position.set(-0.22, 0.22, RADIUS * 0.93)
    this._eyeR.position.set(0.22, 0.22, RADIUS * 0.93)
    this.mesh.add(this._eyeL)
    this.mesh.add(this._eyeR)
  }

  _buildTrail() {
    this._trailPoints = []
    this._trailMaxLen = 28
    this._trailGeo = new THREE.BufferGeometry()
    this._trailPositions = new Float32Array(this._trailMaxLen * 3)
    this._trailColors = new Float32Array(this._trailMaxLen * 3)
    this._trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3))
    this._trailGeo.setAttribute('color', new THREE.BufferAttribute(this._trailColors, 3))
    const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 })
    this._trailLine = new THREE.Line(this._trailGeo, trailMat)
    this.scene.add(this._trailLine)
  }

  _buildShadow() {
    const geo = new THREE.CircleGeometry(RADIUS * 1.3, 16)
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    this._shadowBlob = new THREE.Mesh(geo, mat)
    this._shadowBlob.rotation.x = -Math.PI / 2
    this.scene.add(this._shadowBlob)
  }

  _doJump() {
    this.body.velocity.y = JUMP_VEL
    this._grounded = false
    this._groundedTimer = 0
    this._jumpBufferTimer = 0
    this._jumpHoldTimer = JUMP_HOLD_DURATION
    this._jumpHolding = true
  }

  update(dt, inputState, world, camera) {
    // Coyote time countdown
    if (this._groundedTimer > 0) {
      this._groundedTimer -= dt
      if (this._groundedTimer <= 0) this._grounded = false
    }

    // Jump buffer countdown
    if (this._jumpBufferTimer > 0) {
      this._jumpBufferTimer -= dt
    }

    // Queue jump via buffer
    if (inputState.jump) {
      this._jumpBufferTimer = JUMP_BUFFER_TIME
      if (this._grounded) this._doJump()
    }

    // Variable jump height — hold Space during ascent for extra lift
    if (this._jumpHolding && inputState.jumpHeld && this._jumpHoldTimer > 0 && this.body.velocity.y > 0) {
      this.body.applyForce(new CANNON.Vec3(0, JUMP_HOLD_FORCE, 0), this.body.position)
      this._jumpHoldTimer -= dt
    }
    if (!inputState.jumpHeld) this._jumpHolding = false

    // Camera-relative movement
    const forward = camera ? camera.getForwardDir() : new THREE.Vector3(0, 0, -1)
    const right = camera ? camera.getRightDir() : new THREE.Vector3(1, 0, 0)

    const force = this._grounded ? GROUND_FORCE : AIR_FORCE
    const fx = (forward.x * inputState.forward + right.x * inputState.right) * force
    const fz = (forward.z * inputState.forward + right.z * inputState.right) * force

    // Speed cap (horizontal only)
    const hspeed = Math.sqrt(
      this.body.velocity.x ** 2 + this.body.velocity.z ** 2
    )
    this._speed = hspeed
    if (hspeed < MAX_SPEED) {
      this.body.applyForce(new CANNON.Vec3(fx, 0, fz), this.body.position)
    }

    // Launch pad cooldown
    if (this._launchCooldown > 0) this._launchCooldown -= dt

    // Sync
    this.mesh.position.copy(this.body.position)
    this.mesh.quaternion.copy(this.body.quaternion)

    this._updateTrail()
    this._updateShadow()
    this._updateFace(dt)
    this._lastVelY = this.body.velocity.y

    if (camera) {
      this._eyeL.lookAt(camera.camera.position)
      this._eyeR.lookAt(camera.camera.position)
    }
  }

  _updateTrail() {
    const p = this.body.position
    this._trailPoints.push({ x: p.x, y: p.y, z: p.z, speed: this._speed })
    if (this._trailPoints.length > this._trailMaxLen) this._trailPoints.shift()

    for (let i = 0; i < this._trailPoints.length; i++) {
      const tp = this._trailPoints[i]
      this._trailPositions[i * 3] = tp.x
      this._trailPositions[i * 3 + 1] = tp.y
      this._trailPositions[i * 3 + 2] = tp.z

      // Speed-based color: slow=blue → medium=yellow → fast=orange → max=red
      const t = Math.min(1, tp.speed / MAX_SPEED)
      const r = t > 0.5 ? 1.0 : t * 2
      const g = t < 0.5 ? t * 2 : 1.0 - (t - 0.5) * 2
      const b = t < 0.25 ? 1.0 - t * 4 : 0
      this._trailColors[i * 3] = r
      this._trailColors[i * 3 + 1] = g
      this._trailColors[i * 3 + 2] = b
    }
    for (let i = this._trailPoints.length; i < this._trailMaxLen; i++) {
      const last = this._trailPoints[this._trailPoints.length - 1]
      if (!last) continue
      this._trailPositions[i * 3] = last.x
      this._trailPositions[i * 3 + 1] = last.y
      this._trailPositions[i * 3 + 2] = last.z
      this._trailColors[i * 3] = this._trailColors[i * 3 + 1] = this._trailColors[i * 3 + 2] = 0
    }
    this._trailGeo.attributes.position.needsUpdate = true
    this._trailGeo.attributes.color.needsUpdate = true
    this._trailGeo.setDrawRange(0, this._trailPoints.length)
  }

  _updateShadow() {
    const pos = this.body.position
    this._shadowBlob.position.set(pos.x, pos.y - RADIUS - 0.05, pos.z)
    const scl = Math.max(0.1, 1.0 - Math.abs(this._lastVelY) * 0.035)
    this._shadowBlob.scale.setScalar(scl)
    this._shadowBlob.material.opacity = Math.max(0.03, 0.3 * scl)
  }

  _updateFace(dt) {
    const now = performance.now()
    if (now - this._lastFaceUpdate < 80) return
    this._lastFaceUpdate = now

    const vy = this.body.velocity.y
    if (vy < -10) this._faceState = 'scared'
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
    const speedGlow = Math.min(1, this._speed / MAX_SPEED)

    // Base ball
    const grad = ctx.createRadialGradient(100, 90, 20, 128, 128, 130)
    if (state === 'scared') {
      grad.addColorStop(0, '#ffaa44'); grad.addColorStop(1, '#cc3300')
    } else if (state === 'checkpoint') {
      grad.addColorStop(0, '#aaffaa'); grad.addColorStop(1, '#22aa22')
    } else if (speedGlow > 0.6) {
      grad.addColorStop(0, '#ffdd44'); grad.addColorStop(1, '#ff6600')
    } else {
      grad.addColorStop(0, '#ff7755'); grad.addColorStop(1, '#cc3311')
    }
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); ctx.fill()

    // Shine
    const shine = ctx.createRadialGradient(90, 75, 5, 95, 80, 50)
    shine.addColorStop(0, 'rgba(255,255,255,0.55)')
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = shine
    ctx.beginPath(); ctx.ellipse(95, 80, 40, 30, -0.4, 0, Math.PI * 2); ctx.fill()

    // Eyes
    const eyeOffX = Math.max(-8, Math.min(8, this.body.velocity.x * 0.7))
    const eyeOffY = state === 'scared' ? -6 : 0

    const drawEye = (cx, cy) => {
      ctx.fillStyle = 'white'
      ctx.beginPath()
      ctx.ellipse(cx, cy + eyeOffY, state === 'scared' ? 23 : 18, state === 'scared' ? 26 : 20, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#111'
      ctx.beginPath()
      ctx.arc(cx + eyeOffX * 0.5, cy + eyeOffY + (vy < 0 ? Math.min(5, -vy * 0.3) : 0), state === 'scared' ? 11 : 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.arc(cx + eyeOffX * 0.5 - 3, cy + eyeOffY - 3, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    drawEye(90, 105); drawEye(166, 105)

    if (state === 'scared') {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 5; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(68, 80); ctx.lineTo(114, 90); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(144, 90); ctx.lineTo(190, 80); ctx.stroke()
    }

    // Mouth
    ctx.strokeStyle = '#222'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    ctx.beginPath()
    if (state === 'scared') {
      ctx.ellipse(128, 168, 23, 20, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = '#440000'; ctx.fill()
    } else if (state === 'checkpoint') {
      ctx.arc(128, 148, 36, 0.15, Math.PI - 0.15); ctx.stroke()
    } else if (speedGlow > 0.6) {
      ctx.arc(128, 150, 28, 0.1, Math.PI - 0.1); ctx.stroke() // big grin
    } else {
      ctx.arc(128, 155, 22, 0.3, Math.PI - 0.3); ctx.stroke()
    }
    this._faceTex.needsUpdate = true
  }

  setCheckpointFace(duration = 2) {
    this._faceState = 'checkpoint'
    this._faceTimer = duration / 0.08
    this._drawFace()
  }

  launch(upVelocity = 22) {
    if (this._launchCooldown > 0) return
    this.body.velocity.set(
      this.body.velocity.x * 0.4,
      upVelocity,
      this.body.velocity.z * 0.4
    )
    this._launchCooldown = 2.0
    this._grounded = false
    this._groundedTimer = 0
  }

  get position() { return this.body.position }
  get speed() { return this._speed }

  respawnAt(pos) {
    this.body.position.set(pos.x, pos.y + 2, pos.z)
    this.body.velocity.set(0, 0, 0)
    this.body.angularVelocity.set(0, 0, 0)
    this.deathCount++
    this._trailPoints = []
    this._jumpBufferTimer = 0
    this._groundedTimer = 0
    this._grounded = false
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

import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const RADIUS           = 0.55
const GROUND_FORCE     = 38
const AIR_FORCE        = 15
const JUMP_VEL         = 16    // base jump ≈ 4.6m, perfect hold-jump ≈ 6.1m
const JUMP_HOLD_FORCE  = 13
const JUMP_HOLD_DURATION = 0.24
const MAX_SPEED        = 20
const COYOTE_TIME      = 0.15
const JUMP_BUFFER_TIME = 0.15

// Manual horizontal damping (linearDamping is 0 so jump arcs are deterministic)
const DAMP_GROUND_IDLE = 6.0   // crisp stop when you release input
const DAMP_GROUND_MOVE = 0.7
const DAMP_AIR         = 0.18

export class Player {
  constructor(scene, physicsWorld, physMats, sound) {
    this.scene  = scene
    this.world  = physicsWorld
    this.sound  = sound
    this.fallCount = 0          // big falls suffered

    this._grounded       = false
    this._coyoteTimer    = 0
    this._jumpBufferTimer= 0
    this._jumpHoldTimer  = 0
    this._jumpHolding    = false
    this._lastVelY       = 0
    this._faceState      = 'normal'
    this._prevFaceState  = ''
    this._prevSpeedGlow  = false
    this._faceTimer      = 0
    this._speed          = 0
    this._launchCooldown = 0
    this._wasGrounded    = false
    this._peakY          = 3    // highest point since last grounded — fall measurement

    // Set fresh each frame for Game to consume
    this.lastLanding   = null  // { drop, impact }
    this.standingBody  = null  // physics body underfoot (crumble detection)

    // Reusable scratch objects — zero per-frame allocations
    this._fv  = new CANNON.Vec3()
    this._jv  = new CANNON.Vec3()
    this._rayFrom   = new CANNON.Vec3()
    this._rayTo     = new CANNON.Vec3()
    this._rayResult = new CANNON.RaycastResult()
    this._rayOpts   = { collisionFilterMask: 1, skipBackfaces: true }

    this._buildPhysics(physMats)
    this._buildMesh()
    this._buildTrail()
    this._buildShadow()
  }

  _buildPhysics(physMats) {
    const mat = physMats?.ball || new CANNON.Material({ friction: 0.6, restitution: 0.05 })
    this.body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(RADIUS),
      material: mat,
      linearDamping: 0,       // deterministic jump heights; horizontal damping is manual
      angularDamping: 0.55,
      allowSleep: false
    })
    // Group 2 so the ground-check ray (mask 1) never hits the player itself
    this.body.collisionFilterGroup = 2
    this.body.collisionFilterMask  = -1
    this.body.position.set(0, 3, 0)
    this.world.addBody(this.body)
  }

  // Grounding via contact scan + downward ray. The old collide-event approach
  // missed persistent contacts (cannon only fires 'collide' for NEW pairs),
  // which made jumps unreliable after standing still.
  _checkGrounded() {
    let grounded = false
    let standBody = null

    // A contact on the ball's lower hemisphere means we're standing on it.
    // (ri/rj are offsets from each body's center to the contact point —
    // unambiguous, unlike the normal whose sign depends on body order.)
    const contacts = this.world.contacts
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i]
      if (c.bi === this.body) {
        if (c.ri.y < -RADIUS * 0.5) { grounded = true; standBody = c.bj; break }
      } else if (c.bj === this.body) {
        if (c.rj.y < -RADIUS * 0.5) { grounded = true; standBody = c.bi; break }
      }
    }

    if (!grounded) {
      const p = this.body.position
      this._rayFrom.set(p.x, p.y, p.z)
      this._rayTo.set(p.x, p.y - (RADIUS + 0.22), p.z)
      this._rayResult.reset()
      if (this.world.raycastClosest(this._rayFrom, this._rayTo, this._rayOpts, this._rayResult)) {
        if (this._rayResult.hitNormalWorld.y > 0.4) {
          grounded = true
          standBody = this._rayResult.body
        }
      }
    }

    this.standingBody = standBody
    return grounded
  }

  _buildMesh() {
    this._faceCanvas = document.createElement('canvas')
    this._faceCanvas.width = 256
    this._faceCanvas.height = 256
    this._faceCtx = this._faceCanvas.getContext('2d')
    this._faceTex = new THREE.CanvasTexture(this._faceCanvas)

    const geo = new THREE.SphereGeometry(RADIUS, 20, 20)
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      roughness: 0.35,
      metalness: 0.2,
      map: this._faceTex
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.castShadow = true
    this.scene.add(this.mesh)

    const eyeGeo = new THREE.SphereGeometry(0.09, 7, 7)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 })
    this._eyeL = new THREE.Mesh(eyeGeo, eyeMat)
    this._eyeR = new THREE.Mesh(eyeGeo, eyeMat)
    this._eyeL.position.set(-0.22, 0.22, RADIUS * 0.93)
    this._eyeR.position.set( 0.22, 0.22, RADIUS * 0.93)
    this.mesh.add(this._eyeL)
    this.mesh.add(this._eyeR)

    this._drawFace()
  }

  _buildTrail() {
    this._trailPoints  = []
    this._trailMaxLen  = 28
    this._trailGeo     = new THREE.BufferGeometry()
    this._trailPositions = new Float32Array(this._trailMaxLen * 3)
    this._trailColors    = new Float32Array(this._trailMaxLen * 3)
    this._trailGeo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3))
    this._trailGeo.setAttribute('color',    new THREE.BufferAttribute(this._trailColors,    3))
    const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65 })
    this._trailLine = new THREE.Line(this._trailGeo, trailMat)
    this.scene.add(this._trailLine)
  }

  _buildShadow() {
    const geo = new THREE.CircleGeometry(RADIUS * 1.3, 12)
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    this._shadowBlob = new THREE.Mesh(geo, mat)
    this._shadowBlob.rotation.x = -Math.PI / 2
    this.scene.add(this._shadowBlob)
  }

  _doJump() {
    this.body.velocity.y    = JUMP_VEL
    this._grounded          = false
    this._coyoteTimer       = 0
    this._jumpBufferTimer   = 0
    this._jumpHoldTimer     = JUMP_HOLD_DURATION
    this._jumpHolding       = true
    this.sound?.jump()
  }

  update(dt, inputState, world, camera, effects) {
    this.lastLanding = null

    // ── Grounding ──
    const groundedNow = this._checkGrounded()
    if (groundedNow) {
      if (!this._wasGrounded) {
        // Landed: measure the fall
        const y      = this.body.position.y
        const drop   = this._peakY - y
        const impact = Math.abs(this._lastVelY)
        this.lastLanding = { drop, impact }
        if (impact > 4 && effects) {
          effects.spawnLandingDust(this.body.position.x, y - RADIUS, this.body.position.z)
        }
        this.sound?.land(Math.min(1, impact / 30))
      }
      this._grounded    = true
      this._coyoteTimer = COYOTE_TIME
      this._peakY       = this.body.position.y
    } else {
      this._coyoteTimer -= dt
      if (this._coyoteTimer <= 0) this._grounded = false
      this._peakY = Math.max(this._peakY, this.body.position.y)
    }
    this._wasGrounded = groundedNow

    // ── Jump buffer + execute ──
    if (this._jumpBufferTimer > 0) this._jumpBufferTimer -= dt
    if (inputState.jump) this._jumpBufferTimer = JUMP_BUFFER_TIME
    if (this._jumpBufferTimer > 0 && this._grounded) this._doJump()

    // Variable jump height — hold Space for extra lift
    if (this._jumpHolding && inputState.jumpHeld && this._jumpHoldTimer > 0 && this.body.velocity.y > 0) {
      this._jv.set(0, JUMP_HOLD_FORCE, 0)
      this.body.applyForce(this._jv, this.body.position)
      this._jumpHoldTimer -= dt
    }
    if (!inputState.jumpHeld) this._jumpHolding = false

    // ── Camera-relative movement ──
    const forward = camera ? camera.getForwardDir() : _V3_FWD
    const right   = camera ? camera.getRightDir()   : _V3_RIGHT

    const forceMag = this._grounded ? GROUND_FORCE : AIR_FORCE
    let fx = (forward.x * inputState.forward + right.x * inputState.right) * forceMag
    let fz = (forward.z * inputState.forward + right.z * inputState.right) * forceMag

    const vx = this.body.velocity.x, vz = this.body.velocity.z
    const hspeed = Math.sqrt(vx * vx + vz * vz)
    this._speed = hspeed

    if (fx !== 0 || fz !== 0) {
      // At max speed, strip only the force component that would speed us up
      // further — braking and steering always work (the old code blocked both).
      if (hspeed > MAX_SPEED) {
        const nx = vx / hspeed, nz = vz / hspeed
        const along = fx * nx + fz * nz
        if (along > 0) { fx -= along * nx; fz -= along * nz }
      }
      this._fv.set(fx, 0, fz)
      this.body.applyForce(this._fv, this.body.position)
    }

    // ── Manual horizontal damping ──
    const hasInput = inputState.forward !== 0 || inputState.right !== 0
    const k = !groundedNow ? DAMP_AIR : (hasInput ? DAMP_GROUND_MOVE : DAMP_GROUND_IDLE)
    const damp = Math.exp(-k * dt)
    this.body.velocity.x *= damp
    this.body.velocity.z *= damp
    if (groundedNow && !hasInput) {
      this.body.angularVelocity.x *= damp
      this.body.angularVelocity.z *= damp
    }

    if (this._launchCooldown > 0) this._launchCooldown -= dt

    // Sync mesh to physics
    this.mesh.position.copy(this.body.position)
    this.mesh.quaternion.copy(this.body.quaternion)

    // Fall whoosh intensity (downward speed)
    this.sound?.setFallSpeed(Math.max(0, -this.body.velocity.y))

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
      this._trailPositions[i * 3]     = tp.x
      this._trailPositions[i * 3 + 1] = tp.y
      this._trailPositions[i * 3 + 2] = tp.z

      const t = Math.min(1, tp.speed / MAX_SPEED)
      this._trailColors[i * 3]     = t > 0.5 ? 1.0 : t * 2
      this._trailColors[i * 3 + 1] = t < 0.5 ? t * 2 : 1.0 - (t - 0.5) * 2
      this._trailColors[i * 3 + 2] = t < 0.25 ? 1.0 - t * 4 : 0
    }
    for (let i = this._trailPoints.length; i < this._trailMaxLen; i++) {
      const last = this._trailPoints[this._trailPoints.length - 1]
      if (!last) continue
      this._trailPositions[i * 3]     = last.x
      this._trailPositions[i * 3 + 1] = last.y
      this._trailPositions[i * 3 + 2] = last.z
      this._trailColors[i * 3] = this._trailColors[i * 3 + 1] = this._trailColors[i * 3 + 2] = 0
    }
    this._trailGeo.attributes.position.needsUpdate = true
    this._trailGeo.attributes.color.needsUpdate    = true
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
    const vy = this.body.velocity.y

    let state
    if (this._faceTimer > 0) {
      this._faceTimer -= dt
      if (this._faceTimer <= 0) { this._faceTimer = 0; this._faceState = 'normal' }
      state = (vy < -12) ? 'scared' : this._faceState
    } else {
      state = vy < -10 ? 'scared' : 'normal'
      this._faceState = state
    }

    const speedGlowOn = this._speed / MAX_SPEED > 0.6

    if (state !== this._prevFaceState || speedGlowOn !== this._prevSpeedGlow) {
      this._prevFaceState = state
      this._prevSpeedGlow = speedGlowOn
      this._faceState     = state
      this._drawFace()
    }
  }

  _drawFace() {
    const ctx   = this._faceCtx
    const size  = 256
    const state = this._faceState
    const vy    = this.body.velocity.y
    const speedGlow = Math.min(1, this._speed / MAX_SPEED)

    ctx.clearRect(0, 0, size, size)

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

    const shine = ctx.createRadialGradient(90, 75, 5, 95, 80, 50)
    shine.addColorStop(0, 'rgba(255,255,255,0.55)')
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = shine
    ctx.beginPath(); ctx.ellipse(95, 80, 40, 30, -0.4, 0, Math.PI * 2); ctx.fill()

    const eyeOffX = Math.max(-8, Math.min(8, this.body.velocity.x * 0.7))
    const eyeOffY = state === 'scared' ? -6 : 0
    const eyeRx   = state === 'scared' ? 23 : 18
    const eyeRy   = state === 'scared' ? 26 : 20
    const pupilR  = state === 'scared' ? 11 : 8

    const drawEye = (cx, cy) => {
      ctx.fillStyle = 'white'
      ctx.beginPath()
      ctx.ellipse(cx, cy + eyeOffY, eyeRx, eyeRy, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#111'
      ctx.beginPath()
      ctx.arc(cx + eyeOffX * 0.5, cy + eyeOffY + (vy < 0 ? Math.min(5, -vy * 0.3) : 0), pupilR, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.arc(cx + eyeOffX * 0.5 - 3, cy + eyeOffY - 3, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    drawEye(90, 105); drawEye(166, 105)

    if (state === 'scared') {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 5; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(68,  80); ctx.lineTo(114, 90); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(144, 90); ctx.lineTo(190, 80); ctx.stroke()
    }

    ctx.strokeStyle = '#222'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    ctx.beginPath()
    if (state === 'scared') {
      ctx.ellipse(128, 168, 23, 20, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = '#440000'; ctx.fill()
    } else if (state === 'checkpoint') {
      ctx.arc(128, 148, 36, 0.15, Math.PI - 0.15); ctx.stroke()
    } else if (speedGlow > 0.6) {
      ctx.arc(128, 150, 28, 0.1, Math.PI - 0.1); ctx.stroke()
    } else {
      ctx.arc(128, 155, 22, 0.3, Math.PI - 0.3); ctx.stroke()
    }

    this._faceTex.needsUpdate = true
  }

  setCheckpointFace(duration = 2) {
    this._faceState      = 'checkpoint'
    this._faceTimer      = duration
    this._prevFaceState  = ''
    this._drawFace()
  }

  launch(upVelocity = 24) {
    if (this._launchCooldown > 0) return
    this.body.velocity.set(
      this.body.velocity.x * 0.35,
      upVelocity,
      this.body.velocity.z * 0.35
    )
    this._launchCooldown = 2.0
    this._grounded       = false
    this._coyoteTimer    = 0
    this._wasGrounded    = false
  }

  get position() { return this.body.position }
  get speed()    { return this._speed }

  // Emergency reset only (fell out of the world) — NOT a checkpoint respawn
  resetToStart() {
    this.body.position.set(0, 3, 0)
    this.body.velocity.set(0, 0, 0)
    this.body.angularVelocity.set(0, 0, 0)
    this._peakY = 3
    this._trailPoints = []
  }

  setPosition(x, y, z) {
    this.body.position.set(x, y + 1.2, z)
    this.body.velocity.set(0, 0, 0)
    this.body.angularVelocity.set(0, 0, 0)
    this._peakY = y + 1.2
  }

  dispose() {
    this.scene.remove(this.mesh)
    this.scene.remove(this._trailLine)
    this.scene.remove(this._shadowBlob)
    this.world.removeBody(this.body)
  }
}

// Fallback directions used when camera is not yet ready
const _V3_FWD   = new THREE.Vector3(0, 0, -1)
const _V3_RIGHT = new THREE.Vector3(1, 0,  0)

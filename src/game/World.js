import * as THREE from 'three'
import * as CANNON from 'cannon-es'

// Seeded PRNG — deterministic level every run
function mkRng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

const ZONE_DEFS = [
  {
    name: 'THE GARDEN', minY: 0, maxY: 200,
    skyTop: 0x4fc3f7, skyBot: 0xa5d6a7, fog: 0xb2ebf2, fogFar: 280,
    platforms: 55, minW: 6, maxW: 16, minD: 6, maxD: 16,
    hGap: [4, 9], vGap: [3, 6], typeWeights: [0.75, 0.20, 0, 0, 0.05, 0],
    ambColor: 0xfff8e1, sunColor: 0xffffff, ambient: 0.65
  },
  {
    name: 'ANCIENT RUINS', minY: 200, maxY: 500,
    skyTop: 0xff8f00, skyBot: 0xbf360c, fog: 0xffcc80, fogFar: 250,
    platforms: 80, minW: 4, maxW: 12, minD: 4, maxD: 12,
    hGap: [5, 12], vGap: [4, 8], typeWeights: [0.55, 0.25, 0.10, 0.05, 0.05, 0],
    ambColor: 0xffe0b2, sunColor: 0xffccaa, ambient: 0.55
  },
  {
    name: 'SKY ISLANDS', minY: 500, maxY: 900,
    skyTop: 0xe3f2fd, skyBot: 0xffffff, fog: 0xf0f8ff, fogFar: 300,
    platforms: 100, minW: 3, maxW: 10, minD: 3, maxD: 10,
    hGap: [6, 14], vGap: [5, 10], typeWeights: [0.45, 0.20, 0.20, 0.05, 0.05, 0.05],
    ambColor: 0xe1f5fe, sunColor: 0xffffff, ambient: 0.7
  },
  {
    name: 'THE STORM', minY: 900, maxY: 1400,
    skyTop: 0x1a0a2e, skyBot: 0x2d1b4e, fog: 0x1a0a2e, fogFar: 180,
    platforms: 120, minW: 2.5, maxW: 8, minD: 2.5, maxD: 8,
    hGap: [7, 16], vGap: [6, 12], typeWeights: [0.35, 0.25, 0.10, 0.15, 0.05, 0.10],
    ambColor: 0x311b92, sunColor: 0x7b1fa2, ambient: 0.35
  },
  {
    name: 'COSMIC SUMMIT', minY: 1400, maxY: 2050,
    skyTop: 0x000011, skyBot: 0x000033, fog: 0x000022, fogFar: 220,
    platforms: 110, minW: 2, maxW: 7, minD: 2, maxD: 7,
    hGap: [8, 18], vGap: [7, 14], typeWeights: [0.30, 0.25, 0.10, 0.15, 0.05, 0.15],
    ambColor: 0x1a237e, sunColor: 0x7986cb, ambient: 0.25
  }
]

// Platform types:  0=static 1=moving 2=bouncy 3=crumbling 4=ice 5=disappearing
const PLATFORM_COLORS = {
  0: { zone0: 0x4caf50, zone1: 0x8d6e63, zone2: 0xffffff, zone3: 0x37474f, zone4: 0x1a237e },
  1: { zone0: 0x2196f3, zone1: 0x607d8b, zone2: 0x80deea, zone3: 0x4a148c, zone4: 0x3949ab },
  2: { zone0: 0xffeb3b, zone1: 0xff8f00, zone2: 0xf48fb1, zone3: 0xce93d8, zone4: 0xea80fc },
  3: { zone0: 0x795548, zone1: 0x5d4037, zone2: 0xb0bec5, zone3: 0x212121, zone4: 0x37474f },
  4: { zone0: 0xe1f5fe, zone1: 0xe1f5fe, zone2: 0xe8f5e9, zone3: 0xb3e5fc, zone4: 0xe0f7fa },
  5: { zone0: 0xfce4ec, zone1: 0xfce4ec, zone2: 0xfce4ec, zone3: 0x7b1fa2, zone4: 0x6200ea }
}

export class World {
  constructor(scene, physicsWorld) {
    this.scene = scene
    this.physicsWorld = physicsWorld
    this.platforms = []
    this.checkpoints = []
    this.decorations = []
    this._rng = mkRng(0xdeadbeef)
    this._time = 0

    // Physics materials
    this.ballMat = new CANNON.Material('ball')
    this.groundMat = new CANNON.Material('ground')
    this.iceMat = new CANNON.Material('ice')
    this.bounceMat = new CANNON.Material('bounce')

    const ballGround = new CANNON.ContactMaterial(this.ballMat, this.groundMat, { friction: 0.6, restitution: 0.2 })
    const ballIce = new CANNON.ContactMaterial(this.ballMat, this.iceMat, { friction: 0.02, restitution: 0.1 })
    const ballBounce = new CANNON.ContactMaterial(this.ballMat, this.bounceMat, { friction: 0.4, restitution: 1.4 })
    this.physicsWorld.addContactMaterial(ballGround)
    this.physicsWorld.addContactMaterial(ballIce)
    this.physicsWorld.addContactMaterial(ballBounce)
  }

  get physMats() { return { ball: this.ballMat } }

  _rval(min, max) { return min + this._rng() * (max - min) }
  _ri(min, max) { return Math.floor(this._rval(min, max + 1)) }

  _pickType(weights) {
    const r = this._rng()
    let acc = 0
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i]
      if (r < acc) return i
    }
    return 0
  }

  generate() {
    // Spawn platform
    this._makeStartPad()

    let x = 0, z = 0, y = 0

    ZONE_DEFS.forEach((zone, zi) => {
      const startY = zone.minY
      const span = zone.maxY - zone.minY

      for (let i = 0; i < zone.platforms; i++) {
        const progress = i / zone.platforms
        y = startY + span * progress + this._rval(zone.vGap[0], zone.vGap[1])

        const angle = this._rng() * Math.PI * 2
        const dist = this._rval(zone.hGap[0], zone.hGap[1])
        x += Math.cos(angle) * dist
        z += Math.sin(angle) * dist
        // Spiral tendency — keeps level compact
        x *= 0.95
        z *= 0.95

        const w = this._rval(zone.minW, zone.maxW)
        const d = this._rval(zone.minD, zone.maxD)
        const type = this._pickType(zone.typeWeights)

        this._makePlatform(x, y, z, w, 0.6, d, type, zi)
      }

      // Checkpoint at end of each zone
      const cpY = zone.maxY - 5
      this._makeCheckpoint(x, cpY + 3, z, zi)
    })

    // Summit goal platform
    this._makeSummit(x, 2000, z)

    this._buildStarfield()
  }

  _makeStartPad() {
    this._makePlatform(0, -1, 0, 20, 1, 20, 0, 0)
    // Invisible ground
    const groundBody = new CANNON.Body({
      mass: 0, shape: new CANNON.Plane(), material: this.groundMat
    })
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
    groundBody.position.set(0, -2, 0)
    this.physicsWorld.addBody(groundBody)
  }

  _makePlatform(x, y, z, w, h, d, type, zoneIdx) {
    const phyMat = type === 4 ? this.iceMat : type === 2 ? this.bounceMat : this.groundMat
    const body = new CANNON.Body({
      mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
      material: phyMat,
      type: (type === 1 || type === 5) ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC
    })
    body.position.set(x, y, z)
    this.physicsWorld.addBody(body)

    // Visual
    const geo = new THREE.BoxGeometry(w, h, d)
    const zKey = `zone${zoneIdx}`
    const col = (PLATFORM_COLORS[type] || PLATFORM_COLORS[0])[zKey] || 0x888888
    const matOptions = { color: col, roughness: type === 4 ? 0.05 : 0.6, metalness: type === 4 ? 0.1 : 0.05 }
    if (type === 4) matOptions.envMapIntensity = 1.5
    const mat = new THREE.MeshStandardMaterial(matOptions)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)

    const plat = { body, mesh, type, zoneIdx, x, y, z, w, d, h, alive: true, crumbleTimer: 0, disappearTimer: 0, disappearPhase: 1, moveDir: 1, moveRange: 6, moveAxis: this._rng() > 0.5 ? 'x' : 'z', moveSpeed: 1.5 + this._rng() * 2 }
    this.platforms.push(plat)

    // Edge highlight for narrow platforms
    if (w < 5 || d < 5) {
      const edgesGeo = new THREE.EdgesGeometry(geo)
      const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
      const edges = new THREE.LineSegments(edgesGeo, edgesMat)
      mesh.add(edges)
    }

    return plat
  }

  _makeCheckpoint(x, y, z, zoneIdx) {
    // Physical trigger — use a slightly larger box
    const triggerBody = new CANNON.Body({ mass: 0, isTrigger: true })
    triggerBody.addShape(new CANNON.Box(new CANNON.Vec3(3, 3, 3)))
    triggerBody.position.set(x, y, z)
    this.physicsWorld.addBody(triggerBody)

    // Visual — glowing star/orb
    const geo = new THREE.OctahedronGeometry(1.2, 0)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0xffc200, emissiveIntensity: 1.5,
      roughness: 0.1, metalness: 0.8
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = false
    this.scene.add(mesh)

    // Point light at checkpoint
    const light = new THREE.PointLight(0xffd700, 2.5, 25)
    light.position.set(x, y + 2, z)
    this.scene.add(light)

    // Ring around checkpoint
    const ringGeo = new THREE.TorusGeometry(2.5, 0.12, 8, 32)
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 1.0
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.set(x, y, z)
    this.scene.add(ring)

    this.checkpoints.push({
      body: triggerBody, mesh, light, ring,
      position: new THREE.Vector3(x, y, z),
      zoneIdx, collected: false, index: this.checkpoints.length
    })
  }

  _makeSummit(x, y, z) {
    // Huge golden summit platform
    this._makePlatform(x, y - 2, z, 30, 2, 30, 0, 4)
    const geo = new THREE.CylinderGeometry(0.5, 1.5, 10, 12)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 2, roughness: 0.1, metalness: 0.9 })
    const pillar = new THREE.Mesh(geo, mat)
    pillar.position.set(x, y + 4, z)
    this.scene.add(pillar)

    // Victory light
    const vLight = new THREE.PointLight(0xffd700, 5, 80)
    vLight.position.set(x, y + 8, z)
    this.scene.add(vLight)
  }

  _buildStarfield() {
    const count = 3000
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 800
      positions[i * 3 + 1] = Math.random() * 2500 - 200
      positions[i * 3 + 2] = (Math.random() - 0.5) * 800
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true, transparent: true, opacity: 0 })
    this._stars = new THREE.Points(geo, mat)
    this.scene.add(this._stars)
  }

  getCheckpoint(index) {
    return this.checkpoints[Math.max(0, Math.min(index, this.checkpoints.length - 1))]
  }

  checkPlayerCheckpoints(playerBody, playerCheckpointIndex) {
    const pos = playerBody.position
    for (let i = playerCheckpointIndex; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i]
      if (cp.collected) continue
      const dx = pos.x - cp.position.x
      const dy = pos.y - cp.position.y
      const dz = pos.z - cp.position.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist < 4.5) {
        cp.collected = true
        return cp
      }
    }
    return null
  }

  update(dt, playerPos) {
    this._time += dt

    // Update moving platforms
    for (const plat of this.platforms) {
      if (!plat.alive) continue

      if (plat.type === 1) {
        // Moving platform
        const offset = Math.sin(this._time * plat.moveSpeed) * plat.moveRange
        const vel = Math.cos(this._time * plat.moveSpeed) * plat.moveRange * plat.moveSpeed
        if (plat.moveAxis === 'x') {
          plat.body.position.x = plat.x + offset
          plat.body.velocity.x = vel
          plat.mesh.position.x = plat.body.position.x
        } else {
          plat.body.position.z = plat.z + offset
          plat.body.velocity.z = vel
          plat.mesh.position.z = plat.body.position.z
        }
      }

      if (plat.type === 5) {
        // Disappearing platform — pulses and phases in/out
        const cycle = Math.sin(this._time * 1.2 + plat.x * 0.3)
        const alpha = (cycle + 1) / 2
        plat.mesh.material.opacity = 0.2 + alpha * 0.8
        plat.mesh.material.transparent = true
        if (alpha < 0.1) {
          plat.body.collisionFilterMask = 0
        } else {
          plat.body.collisionFilterMask = -1
        }
      }
    }

    // Rotate checkpoints and pulse light
    for (const cp of this.checkpoints) {
      if (!cp.collected) {
        cp.mesh.rotation.y += dt * 2.0
        cp.mesh.rotation.x += dt * 0.5
        cp.ring.rotation.z += dt * 1.5
        cp.light.intensity = 2 + Math.sin(this._time * 3) * 0.8
      } else {
        if (cp.mesh.visible) {
          cp.mesh.visible = false
          cp.ring.visible = false
          cp.light.intensity = 0
        }
      }
    }

    // Starfield opacity based on player height
    if (this._stars) {
      const starOpacity = Math.max(0, Math.min(1, (playerPos.y - 900) / 400))
      this._stars.material.opacity = starOpacity
    }
  }

  setZoneAtmosphere(scene, zoneIdx) {
    const z = ZONE_DEFS[Math.max(0, Math.min(zoneIdx, ZONE_DEFS.length - 1))]
    scene.background = new THREE.Color(z.skyTop)
    scene.fog = new THREE.Fog(z.fog, 60, z.fogFar)
    return z
  }

  getZoneForHeight(y) {
    for (let i = 0; i < ZONE_DEFS.length; i++) {
      if (y >= ZONE_DEFS[i].minY && y < ZONE_DEFS[i].maxY) return i
    }
    return ZONE_DEFS.length - 1
  }

  getZoneName(i) { return ZONE_DEFS[i]?.name || 'UNKNOWN' }
  get zoneCount() { return ZONE_DEFS.length }
  get totalHeight() { return 2000 }
  get zoneDefs() { return ZONE_DEFS }
}

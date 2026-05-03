import * as THREE from 'three'
import * as CANNON from 'cannon-es'

function mkRng(seed) {
  let s = seed >>> 0
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1)
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61)
    return ((s ^ (s >>> 14)) >>> 0) / 0xffffffff
  }
}

// Vertex-displaced rock geometry — jagged sides, flatter top so ball can land
function makeRockGeo(w, h, d, rng) {
  const geo = new THREE.BoxGeometry(w, h, d, 4, 2, 4)
  const pos = geo.attributes.position
  const halfH = h * 0.5
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i)
    const normalizedY = (py + halfH) / h
    // Top 30% stays mostly flat — players land here
    const factor = normalizedY > 0.7 ? 0.04 : (1 - normalizedY) * 0.28
    pos.setX(i, pos.getX(i) + (rng() - 0.5) * w * factor)
    pos.setY(i, pos.getY(i) + (rng() - 0.5) * h * factor * 0.4)
    pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * d * factor)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

// Cloud-puff geometry — squished sphere cluster merged-ish
function makeCloudGeo(w, h, d) {
  const geo = new THREE.SphereGeometry(1, 8, 6)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) * w * 0.5)
    pos.setY(i, pos.getY(i) * h * 0.4)
    pos.setZ(i, pos.getZ(i) * d * 0.5)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

const ZONE_DEFS = [
  {
    name: 'THE GARDEN', minY: 0, maxY: 200,
    skyTop: 0x4fc3f7, skyBot: 0xa5d6a7, fog: 0xb2ebf2, fogFar: 300,
    platforms: 52, minW: 7, maxW: 18, minD: 7, maxD: 18,
    hGap: [3, 8], vGap: [2.5, 5.5], typeWeights: [0.72, 0.18, 0, 0, 0.05, 0, 0.05],
    bodyColor: 0x6d4c2f, topColor: 0x5aad38,
    ambColor: 0xfff8e1, sunColor: 0xffffff, ambient: 0.65,
    decoChance: 0.4, decoType: 'tree'
  },
  {
    name: 'ANCIENT RUINS', minY: 200, maxY: 500,
    skyTop: 0xff8f00, skyBot: 0xbf360c, fog: 0xffcc80, fogFar: 260,
    platforms: 76, minW: 4.5, maxW: 13, minD: 4.5, maxD: 13,
    hGap: [4, 11], vGap: [3.5, 7], typeWeights: [0.52, 0.24, 0.08, 0.08, 0.03, 0, 0.05],
    bodyColor: 0x7d7060, topColor: 0x9e9e9e,
    ambColor: 0xffe0b2, sunColor: 0xffccaa, ambient: 0.55,
    decoChance: 0.35, decoType: 'pillar'
  },
  {
    name: 'SKY ISLANDS', minY: 500, maxY: 900,
    skyTop: 0xdce9f5, skyBot: 0xffffff, fog: 0xf0f8ff, fogFar: 320,
    platforms: 95, minW: 3.5, maxW: 11, minD: 3.5, maxD: 11,
    hGap: [5, 13], vGap: [4, 9], typeWeights: [0.42, 0.20, 0.22, 0.04, 0.04, 0.04, 0.04],
    bodyColor: 0x90caf9, topColor: 0xffffff,
    ambColor: 0xe1f5fe, sunColor: 0xffffff, ambient: 0.72,
    decoChance: 0.3, decoType: 'crystal'
  },
  {
    name: 'THE STORM', minY: 900, maxY: 1400,
    skyTop: 0x1a0a2e, skyBot: 0x2d1b4e, fog: 0x1a0a2e, fogFar: 190,
    platforms: 115, minW: 3, maxW: 9, minD: 3, maxD: 9,
    hGap: [6, 15], vGap: [5, 11], typeWeights: [0.33, 0.24, 0.08, 0.16, 0.04, 0.10, 0.05],
    bodyColor: 0x263238, topColor: 0x455a64,
    ambColor: 0x311b92, sunColor: 0x7b1fa2, ambient: 0.32,
    decoChance: 0.25, decoType: 'shard'
  },
  {
    name: 'COSMIC SUMMIT', minY: 1400, maxY: 2050,
    skyTop: 0x000011, skyBot: 0x000033, fog: 0x000022, fogFar: 230,
    platforms: 105, minW: 2.5, maxW: 8, minD: 2.5, maxD: 8,
    hGap: [7, 17], vGap: [6, 13], typeWeights: [0.28, 0.24, 0.10, 0.14, 0.04, 0.12, 0.08],
    bodyColor: 0x1a1a4e, topColor: 0x3949ab,
    ambColor: 0x1a237e, sunColor: 0x7986cb, ambient: 0.22,
    decoChance: 0.35, decoType: 'orb'
  }
]

// platform type indices: 0=static 1=moving 2=bouncy 3=crumbling 4=ice 5=disappearing 6=launch

export class World {
  constructor(scene, physicsWorld) {
    this.scene = scene
    this.physicsWorld = physicsWorld
    this.platforms = []
    this.checkpoints = []
    this.launchPads = []
    this._decorations = []
    this._rng = mkRng(0xc0ffee42)
    this._time = 0

    this.ballMat = new CANNON.Material('ball')
    this.groundMat = new CANNON.Material('ground')
    this.iceMat = new CANNON.Material('ice')
    this.bounceMat = new CANNON.Material('bounce')

    this.physicsWorld.addContactMaterial(new CANNON.ContactMaterial(this.ballMat, this.groundMat, { friction: 0.62, restitution: 0.22 }))
    this.physicsWorld.addContactMaterial(new CANNON.ContactMaterial(this.ballMat, this.iceMat,   { friction: 0.02, restitution: 0.08 }))
    this.physicsWorld.addContactMaterial(new CANNON.ContactMaterial(this.ballMat, this.bounceMat, { friction: 0.5,  restitution: 1.5  }))
  }

  get physMats() { return { ball: this.ballMat } }

  _rv(min, max) { return min + this._rng() * (max - min) }
  _ri(min, max) { return Math.floor(this._rv(min, max + 1)) }

  _pickType(weights) {
    const r = this._rng()
    let acc = 0
    for (let i = 0; i < weights.length; i++) { acc += weights[i]; if (r < acc) return i }
    return 0
  }

  generate() {
    this._addGroundPlane()
    this._addBackgroundMountains()

    let x = 0, z = 0

    ZONE_DEFS.forEach((zone, zi) => {
      const span = zone.maxY - zone.minY
      // One launch pad near start of each zone (except zone 0 which is the tutorial)
      const launchY = zone.minY + span * (zi === 0 ? 0.15 : 0.08)
      this._makeLaunchPad(x, launchY + 1, z, zi)

      for (let i = 0; i < zone.platforms; i++) {
        const progress = (i + 1) / zone.platforms
        const y = zone.minY + span * progress

        const angle = this._rng() * Math.PI * 2
        const dist = this._rv(zone.hGap[0], zone.hGap[1])
        x += Math.cos(angle) * dist
        z += Math.sin(angle) * dist
        // Gentle spiral inward keeps the world compact
        x *= 0.94
        z *= 0.94

        const w = this._rv(zone.minW, zone.maxW)
        const d = this._rv(zone.minD, zone.maxD)
        const type = this._pickType(zone.typeWeights)

        const plat = this._makePlatform(x, y, z, w, 0.7, d, type, zi)

        // Checkpoint every ~4 platforms — but only on static/large platforms
        const cpInterval = zi < 2 ? 3 : zi < 4 ? 4 : 5
        if (i % cpInterval === cpInterval - 1 && (type === 0 || type === 1) && w > 4) {
          this._makeCheckpoint(x, y + 2.5, z, zi)
        }

        // Zone decoration
        if (this._rng() < zone.decoChance && w > 5) {
          this._addDecoration(x, y + 0.35, z, w, d, zone.decoType, zi)
        }
      }

      // Guaranteed wide checkpoint platform at zone transition
      const endY = zone.maxY - 2
      x *= 0.8; z *= 0.8
      this._makePlatform(x, endY, z, 14, 0.9, 14, 0, zi)
      this._makeCheckpoint(x, endY + 3, z, zi)
    })

    this._makeSummit(x, 2000, z)
    this._addStarfield()
  }

  _addGroundPlane() {
    // Wide start platform
    this._makePlatform(0, -1, 0, 22, 1, 22, 0, 0)
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: this.groundMat })
    ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
    ground.position.set(0, -2.5, 0)
    this.physicsWorld.addBody(ground)
  }

  _addBackgroundMountains() {
    const rng = mkRng(0xdeadbeef)
    const count = 24
    for (let i = 0; i < count; i++) {
      const h = 120 + rng() * 280
      const r = 25 + rng() * 40
      const angle = (i / count) * Math.PI * 2 + rng() * 0.4
      const radius = 90 + rng() * 60
      const geo = new THREE.ConeGeometry(r, h, 7)
      const col = new THREE.Color().setHSL(0.28 - rng() * 0.06, 0.35, 0.25 + rng() * 0.12)
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 1.0 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(Math.cos(angle) * radius, h / 2 - 5, Math.sin(angle) * radius)
      mesh.castShadow = false
      mesh.receiveShadow = false
      this.scene.add(mesh)

      // Snow cap
      const capGeo = new THREE.ConeGeometry(r * 0.35, h * 0.22, 7)
      const capMat = new THREE.MeshStandardMaterial({ color: 0xeef5ff, roughness: 0.8 })
      const cap = new THREE.Mesh(capGeo, capMat)
      cap.position.y = h * 0.39
      mesh.add(cap)
    }
  }

  _makePlatform(x, y, z, w, h, d, type, zoneIdx) {
    const phyMat = type === 4 ? this.iceMat : type === 2 ? this.bounceMat : this.groundMat
    const isKinematic = type === 1 || type === 5
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
      material: phyMat,
      type: isKinematic ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC
    })
    body.position.set(x, y, z)
    this.physicsWorld.addBody(body)

    const zone = ZONE_DEFS[zoneIdx]
    const group = new THREE.Group()
    group.position.set(x, y, z)

    // Rocky body
    const bodyColor = type === 4 ? 0xb3e5fc
      : type === 2 ? 0xffd54f
      : type === 3 ? 0x4e342e
      : type === 5 ? 0xce93d8
      : zone.bodyColor
    const rockGeo = type === 2
      ? makeCloudGeo(w, h, d)   // bouncy = cloud shape
      : makeRockGeo(w, h, d, mkRng(Math.floor(x * 31 + z * 17 + y * 7)))
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor, roughness: type === 4 ? 0.05 : 0.88, metalness: type === 4 ? 0.1 : 0.04
    })
    const bodyMesh = new THREE.Mesh(rockGeo, bodyMat)
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    group.add(bodyMesh)

    // Top surface layer — distinct color for the walking surface
    if (type !== 2 && type !== 4) {
      const topColor = type === 3 ? 0x212121 : type === 5 ? 0xf48fb1 : zone.topColor
      const topH = h * 0.22
      const topGeo = new THREE.BoxGeometry(w * 0.88, topH, d * 0.88)
      const topMat = new THREE.MeshStandardMaterial({
        color: topColor, roughness: 0.65,
        emissive: type === 5 ? 0xaa44aa : 0x000000,
        emissiveIntensity: type === 5 ? 0.3 : 0
      })
      const topMesh = new THREE.Mesh(topGeo, topMat)
      topMesh.position.y = h * 0.39
      topMesh.castShadow = true
      topMesh.receiveShadow = true
      group.add(topMesh)
    }

    // Ice: add gloss overlay
    if (type === 4) {
      const glossGeo = new THREE.BoxGeometry(w * 0.9, 0.06, d * 0.9)
      const glossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.0, metalness: 0.0, transparent: true, opacity: 0.4 })
      const gloss = new THREE.Mesh(glossGeo, glossMat)
      gloss.position.y = h * 0.5 + 0.04
      group.add(gloss)
    }

    // Edge highlight on narrow platforms
    if (w < 6 || d < 6) {
      const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))
      const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })
      group.add(new THREE.LineSegments(edgesGeo, edgesMat))
    }

    this.scene.add(group)

    const plat = {
      body, mesh: group, type, zoneIdx, x, y, z, w, d, h, alive: true,
      moveRange: 5 + this._rng() * 4,
      moveSpeed: 1.2 + this._rng() * 2.2,
      moveAxis: this._rng() > 0.5 ? 'x' : 'z',
      crumbleTimer: 0, crumbleTrigger: false,
      disappearPhase: this._rng() * Math.PI * 2
    }
    this.platforms.push(plat)
    return plat
  }

  _makeCheckpoint(x, y, z, zoneIdx) {
    const body = new CANNON.Body({ mass: 0 })
    body.addShape(new CANNON.Box(new CANNON.Vec3(3.5, 3.5, 3.5)))
    body.position.set(x, y, z)
    this.physicsWorld.addBody(body)

    // Main orb
    const geo = new THREE.OctahedronGeometry(1.3, 1)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0xffc200, emissiveIntensity: 1.8, roughness: 0.1, metalness: 0.9
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    this.scene.add(mesh)

    // Outer ring
    const ringGeo = new THREE.TorusGeometry(2.8, 0.1, 8, 36)
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 1.2 })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.set(x, y, z)
    this.scene.add(ring)

    // Inner spin ring
    const ring2Geo = new THREE.TorusGeometry(1.8, 0.07, 6, 24)
    const ring2 = new THREE.Mesh(ring2Geo, ringMat.clone())
    ring2.rotation.x = Math.PI / 2
    ring2.position.set(x, y, z)
    this.scene.add(ring2)

    const light = new THREE.PointLight(0xffd700, 2.8, 28)
    light.position.set(x, y + 1.5, z)
    this.scene.add(light)

    this.checkpoints.push({
      body, mesh, ring, ring2, light,
      position: new THREE.Vector3(x, y, z),
      zoneIdx, collected: false, index: this.checkpoints.length
    })
  }

  _makeLaunchPad(x, y, z, zoneIdx) {
    // Physics body (static box)
    const body = new CANNON.Body({
      mass: 0, shape: new CANNON.Cylinder(3, 3, 0.4, 12), material: this.groundMat
    })
    body.position.set(x, y, z)
    this.physicsWorld.addBody(body)

    // Visual — glowing spiral pad
    const baseGeo = new THREE.CylinderGeometry(3.2, 3.2, 0.5, 20)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00bcd4, emissiveIntensity: 1.5, roughness: 0.2, metalness: 0.5 })
    const base = new THREE.Mesh(baseGeo, baseMat)
    base.position.set(x, y, z)
    base.castShadow = false
    this.scene.add(base)

    // Arrow pointing up (cone)
    const arrowGeo = new THREE.ConeGeometry(0.8, 1.8, 8)
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00e5ff, emissiveIntensity: 2.0 })
    const arrow = new THREE.Mesh(arrowGeo, arrowMat)
    arrow.position.set(x, y + 1.5, z)
    this.scene.add(arrow)

    const light = new THREE.PointLight(0x00e5ff, 3, 20)
    light.position.set(x, y + 2, z)
    this.scene.add(light)

    this.launchPads.push({
      body, base, arrow, light,
      position: new THREE.Vector3(x, y + 0.3, z)
    })
  }

  _addDecoration(x, y, z, platW, platD, type, zoneIdx) {
    const rng = mkRng(Math.floor(x * 53 + z * 37 + zoneIdx * 13))
    const group = new THREE.Group()

    if (type === 'tree') {
      // Pine tree
      const trunkH = 0.8 + rng() * 0.6
      const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, trunkH, 6)
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 })
      group.add(new THREE.Mesh(trunkGeo, trunkMat))
      // 2-3 cone layers
      const layers = 2 + Math.floor(rng() * 2)
      for (let l = 0; l < layers; l++) {
        const r = (0.7 - l * 0.15) * (0.6 + rng() * 0.4)
        const h = 1.0 - l * 0.1
        const coneGeo = new THREE.ConeGeometry(r, h, 7)
        const coneMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.85 })
        const cone = new THREE.Mesh(coneGeo, coneMat)
        cone.position.y = trunkH * 0.5 + l * (h * 0.5) + h * 0.3
        group.add(cone)
      }
    } else if (type === 'pillar') {
      // Stone pillar — sometimes broken
      const pillarH = 1.5 + rng() * 2
      const r = 0.25 + rng() * 0.2
      const geo = new THREE.CylinderGeometry(r * 0.9, r, pillarH, 8)
      const mat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.95 })
      const pillar = new THREE.Mesh(geo, mat)
      pillar.rotation.z = (rng() - 0.5) * 0.3 // slight tilt for ruins feel
      pillar.position.y = pillarH * 0.5
      group.add(pillar)
    } else if (type === 'crystal') {
      // Glowing crystal cluster
      const count = 2 + Math.floor(rng() * 3)
      for (let c = 0; c < count; c++) {
        const h = 0.5 + rng() * 1.2
        const geo = new THREE.ConeGeometry(0.15, h, 5)
        const hue = 0.55 + rng() * 0.2
        const col = new THREE.Color().setHSL(hue, 0.9, 0.6)
        const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8, roughness: 0.1 })
        const shard = new THREE.Mesh(geo, mat)
        shard.position.set((rng() - 0.5) * 0.6, h * 0.5, (rng() - 0.5) * 0.6)
        shard.rotation.z = (rng() - 0.5) * 0.6
        group.add(shard)
      }
    } else if (type === 'shard') {
      // Dark jagged shard
      const h = 0.6 + rng() * 1.0
      const geo = new THREE.ConeGeometry(0.2, h, 4)
      const mat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.8 })
      const shard = new THREE.Mesh(geo, mat)
      shard.position.y = h * 0.5
      shard.rotation.z = (rng() - 0.5) * 0.4
      group.add(shard)
    } else if (type === 'orb') {
      // Floating glowing orb
      const geo = new THREE.SphereGeometry(0.3, 10, 10)
      const col = new THREE.Color().setHSL(rng(), 0.9, 0.6)
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.0, roughness: 0.0 })
      const orb = new THREE.Mesh(geo, mat)
      orb.position.y = 0.8 + rng() * 0.5
      group.add(orb)
      const light = new THREE.PointLight(col, 1.5, 8)
      light.position.copy(orb.position)
      group.add(light)
      this._decorations.push({ group, type: 'float', baseY: orb.position.y, phase: rng() * Math.PI * 2 })
    }

    // Scatter offset so decoration isn't always center
    const ox = (rng() - 0.5) * platW * 0.35
    const oz = (rng() - 0.5) * platD * 0.35
    group.position.set(x + ox, y, z + oz)
    this.scene.add(group)
  }

  _makeSummit(x, y, z) {
    this._makePlatform(x, y - 2, z, 28, 2, 28, 0, 4)
    // Victory pillar
    const pGeo = new THREE.CylinderGeometry(0.6, 1.8, 12, 12)
    const pMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 2.5, roughness: 0.1, metalness: 0.9 })
    const pillar = new THREE.Mesh(pGeo, pMat)
    pillar.position.set(x, y + 5, z)
    this.scene.add(pillar)
    const vLight = new THREE.PointLight(0xffd700, 6, 100)
    vLight.position.set(x, y + 10, z)
    this.scene.add(vLight)
  }

  _addStarfield() {
    const count = 4000
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 900
      positions[i * 3 + 1] = Math.random() * 2800 - 200
      positions[i * 3 + 2] = (Math.random() - 0.5) * 900
      const warm = Math.random()
      colors[i * 3] = 0.8 + warm * 0.2
      colors[i * 3 + 1] = 0.8 + warm * 0.1
      colors[i * 3 + 2] = 0.9 + (1 - warm) * 0.1
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({ vertexColors: true, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0 })
    this._stars = new THREE.Points(geo, mat)
    this.scene.add(this._stars)
  }

  getCheckpoint(index) {
    const i = Math.max(0, Math.min(index, this.checkpoints.length - 1))
    return this.checkpoints[i]
  }

  getNextUncollectedCheckpoint(fromIndex) {
    for (let i = fromIndex; i < this.checkpoints.length; i++) {
      if (!this.checkpoints[i].collected) return this.checkpoints[i]
    }
    return null
  }

  checkPlayerCheckpoints(playerBody, playerCheckpointIndex) {
    const pos = playerBody.position
    for (let i = playerCheckpointIndex; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i]
      if (cp.collected) continue
      const dx = pos.x - cp.position.x
      const dy = pos.y - cp.position.y
      const dz = pos.z - cp.position.z
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 5) {
        cp.collected = true
        return cp
      }
    }
    return null
  }

  checkPlayerLaunchPads(playerBody) {
    const pos = playerBody.position
    for (const lp of this.launchPads) {
      const dx = pos.x - lp.position.x
      const dy = pos.y - lp.position.y
      const dz = pos.z - lp.position.z
      if (Math.abs(dy) < 2 && Math.sqrt(dx * dx + dz * dz) < 3.5) {
        return lp
      }
    }
    return null
  }

  update(dt, playerPos) {
    this._time += dt

    for (const plat of this.platforms) {
      if (!plat.alive) continue

      if (plat.type === 1) {
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
        const alpha = (Math.sin(this._time * 1.1 + plat.disappearPhase) + 1) / 2
        plat.mesh.children.forEach(c => {
          if (c.material) { c.material.transparent = true; c.material.opacity = 0.15 + alpha * 0.85 }
        })
        plat.body.collisionFilterMask = alpha < 0.12 ? 0 : -1
      }
    }

    // Checkpoint animations
    for (const cp of this.checkpoints) {
      if (!cp.collected) {
        cp.mesh.rotation.y += dt * 1.8
        cp.mesh.rotation.x = Math.sin(this._time * 0.8) * 0.3
        cp.ring.rotation.z += dt * 1.4
        cp.ring2.rotation.y += dt * 2.2
        cp.mesh.position.y = cp.position.y + Math.sin(this._time * 1.5) * 0.25
        cp.ring.position.y = cp.position.y + Math.sin(this._time * 1.5) * 0.25
        cp.ring2.position.y = cp.position.y + Math.sin(this._time * 1.5) * 0.25
        cp.light.intensity = 2.5 + Math.sin(this._time * 2.5) * 0.9
      } else if (cp.mesh.visible) {
        cp.mesh.visible = cp.ring.visible = cp.ring2.visible = false
        cp.light.intensity = 0
      }
    }

    // Launch pad pulse
    for (const lp of this.launchPads) {
      lp.arrow.position.y = lp.position.y + 1.5 + Math.sin(this._time * 3) * 0.25
      lp.light.intensity = 2.5 + Math.sin(this._time * 4) * 1.2
    }

    // Floating decorations
    for (const d of this._decorations) {
      if (d.type === 'float') {
        d.group.position.y += Math.sin(this._time * 1.8 + d.phase) * dt * 0.5
      }
    }

    // Starfield fade in above 850m
    if (this._stars) {
      this._stars.material.opacity = Math.max(0, Math.min(1, (playerPos.y - 850) / 350))
    }
  }

  setZoneAtmosphere(scene, zoneIdx) {
    const z = ZONE_DEFS[Math.max(0, Math.min(zoneIdx, ZONE_DEFS.length - 1))]
    scene.background = new THREE.Color(z.skyTop)
    scene.fog = new THREE.Fog(z.fog, 55, z.fogFar)
    return z
  }

  getZoneForHeight(y) {
    for (let i = 0; i < ZONE_DEFS.length; i++) {
      if (y >= ZONE_DEFS[i].minY && y < ZONE_DEFS[i].maxY) return i
    }
    return ZONE_DEFS.length - 1
  }

  getZoneName(i) { return ZONE_DEFS[Math.max(0, Math.min(i, ZONE_DEFS.length - 1))].name }
  get zoneCount() { return ZONE_DEFS.length }
  get totalHeight() { return 2000 }
  get zoneDefs() { return ZONE_DEFS }
}

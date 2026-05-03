import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

export class Effects {
  constructor(renderer, scene, camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.particles = []
    this._time = 0

    this._buildComposer()
    this._buildLightningSystem()
  }

  _buildComposer() {
    const w = window.innerWidth, h = window.innerHeight
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.4,   // strength
      0.6,   // radius
      0.85   // threshold
    )
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())
  }

  _buildLightningSystem() {
    this._lightningTimer = 0
    this._lightningFlash = document.getElementById('screen-flash')
  }

  onResize(w, h) {
    this.composer.setSize(w, h)
    this.bloomPass.resolution.set(w, h)
  }

  setBloomForZone(zoneIdx) {
    const params = [
      { strength: 0.3, radius: 0.4, threshold: 0.9 },   // Garden
      { strength: 0.4, radius: 0.5, threshold: 0.85 },  // Ruins
      { strength: 0.5, radius: 0.6, threshold: 0.8 },   // Sky
      { strength: 0.8, radius: 0.8, threshold: 0.7 },   // Storm
      { strength: 1.2, radius: 1.0, threshold: 0.6 },   // Space
    ]
    const p = params[Math.min(zoneIdx, params.length - 1)]
    this.bloomPass.strength = p.strength
    this.bloomPass.radius = p.radius
    this.bloomPass.threshold = p.threshold
  }

  spawnCheckpointBurst(position) {
    const colors = [0xffd700, 0xff8c00, 0xffff00, 0x00ff88, 0xff44ff]
    const count = 60

    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.12 + Math.random() * 0.18, 6, 6)
      const mat = new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        emissive: colors[Math.floor(Math.random() * colors.length)],
        emissiveIntensity: 2.0,
        roughness: 0.2, metalness: 0.5
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(position.x, position.y, position.z)
      this.scene.add(mesh)

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 16,
        Math.random() * 14 + 4,
        (Math.random() - 0.5) * 16
      )
      this.particles.push({ mesh, vel, life: 1.8, maxLife: 1.8, type: 'burst' })
    }

    // Screen flash
    this._flashScreen('rgba(200,255,200,0.4)', 300)
  }

  spawnDeathParticles(position) {
    for (let i = 0; i < 20; i++) {
      const geo = new THREE.SphereGeometry(0.08, 4, 4)
      const mat = new THREE.MeshBasicMaterial({ color: 0xff4400 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(position.x, position.y, position.z)
      this.scene.add(mesh)

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        Math.random() * 8,
        (Math.random() - 0.5) * 10
      )
      this.particles.push({ mesh, vel, life: 1.2, maxLife: 1.2, type: 'death' })
    }

    this._flashScreen('rgba(255,60,60,0.35)', 250)
  }

  spawnZoneParticles(position, zoneIdx) {
    const zoneColors = [
      [0x4caf50, 0x81c784], // Garden — green sparkles
      [0xff8f00, 0xffd54f], // Ruins — orange/gold
      [0x81d4fa, 0xffffff], // Sky — white/blue
      [0xce93d8, 0xb39ddb], // Storm — purple
      [0x80cbc4, 0xe040fb], // Space — teal/purple
    ]
    const cols = zoneColors[Math.min(zoneIdx, zoneColors.length - 1)]

    for (let i = 0; i < 30; i++) {
      const geo = new THREE.SphereGeometry(0.15, 5, 5)
      const mat = new THREE.MeshStandardMaterial({
        color: cols[i % 2],
        emissive: cols[i % 2],
        emissiveIntensity: 1.5
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(position.x, position.y, position.z)
      this.scene.add(mesh)

      const angle = (i / 30) * Math.PI * 2
      const vel = new THREE.Vector3(
        Math.cos(angle) * 8, Math.random() * 10 + 3, Math.sin(angle) * 8
      )
      this.particles.push({ mesh, vel, life: 2.5, maxLife: 2.5, type: 'zone' })
    }
  }

  triggerLightning() {
    this._flashScreen('rgba(200,180,255,0.6)', 80)
    setTimeout(() => this._flashScreen('rgba(200,180,255,0.3)', 60), 120)
  }

  _flashScreen(color, duration) {
    const el = document.getElementById('screen-flash')
    if (!el) return
    el.style.background = color
    el.style.transition = 'none'
    el.style.opacity = '1'
    setTimeout(() => {
      el.style.transition = `opacity ${duration}ms ease`
      el.style.opacity = '0'
    }, 16)
  }

  update(dt, playerPos, zoneIdx) {
    this._time += dt

    // Lightning in storm zone
    if (zoneIdx === 3) {
      this._lightningTimer -= dt
      if (this._lightningTimer <= 0) {
        this._lightningTimer = 3 + Math.random() * 8
        this.triggerLightning()
      }
    }

    // Update particles
    const gravity = -20
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        p.mesh.geometry.dispose()
        p.mesh.material.dispose()
        this.particles.splice(i, 1)
        continue
      }
      p.vel.y += gravity * dt
      p.mesh.position.x += p.vel.x * dt
      p.mesh.position.y += p.vel.y * dt
      p.mesh.position.z += p.vel.z * dt
      const t = p.life / p.maxLife
      p.mesh.scale.setScalar(t)
      if (p.mesh.material.opacity !== undefined) p.mesh.material.opacity = t
    }
  }
}

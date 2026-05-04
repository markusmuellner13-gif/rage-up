import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

const MAX_PARTICLES = 220

export class Effects {
  constructor(renderer, scene, camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this._time = 0
    this._lightningTimer = 0

    // Scratch objects — zero GC allocations per frame
    this._mat4 = new THREE.Matrix4()
    this._col  = new THREE.Color()
    this._pos  = new THREE.Vector3()
    this._scl  = new THREE.Vector3()
    this._quat = new THREE.Quaternion() // stays identity

    this._buildComposer()
    this._buildPool()
  }

  _buildComposer() {
    const w = window.innerWidth, h = window.innerHeight
    // Bloom runs at half resolution — major GPU bandwidth saving
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(w / 2), Math.floor(h / 2)),
      0.4, 0.6, 0.85
    )
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())
  }

  _buildPool() {
    // Pre-allocated InstancedMesh — no per-particle geometry/material create/destroy
    const geo = new THREE.SphereGeometry(0.18, 5, 4)
    const mat = new THREE.MeshBasicMaterial()
    this._pool = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES)
    this._pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this._pool.frustumCulled = false
    this._pool.castShadow = false
    this._pool.receiveShadow = false
    this.scene.add(this._pool)

    // Per-particle data
    this._pd = []
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this._pd.push({ active: false, life: 0, maxLife: 0,
        px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
        r: 1, g: 1, b: 1, size: 1 })
      // Hide all instances (scale 0)
      this._mat4.makeScale(0, 0, 0)
      this._pool.setMatrixAt(i, this._mat4)
    }
    this._pool.instanceMatrix.needsUpdate = true

    // Pre-init instanceColor buffer so setColorAt works without lazy allocation surprises
    this._col.set(0xffffff)
    for (let i = 0; i < MAX_PARTICLES; i++) this._pool.setColorAt(i, this._col)
    if (this._pool.instanceColor) this._pool.instanceColor.needsUpdate = true

    // Free list (LIFO)
    this._free = []
    for (let i = MAX_PARTICLES - 1; i >= 0; i--) this._free.push(i)
  }

  _acquire() { return this._free.length > 0 ? this._free.pop() : -1 }

  _release(i) {
    this._pd[i].active = false
    this._free.push(i)
    this._mat4.makeScale(0, 0, 0)
    this._pool.setMatrixAt(i, this._mat4)
  }

  _emit(x, y, z, vx, vy, vz, r, g, b, size, life) {
    const i = this._acquire()
    if (i < 0) return
    const p = this._pd[i]
    p.active = true
    p.px = x; p.py = y; p.pz = z
    p.vx = vx; p.vy = vy; p.vz = vz
    p.r = r;  p.g = g;  p.b = b
    p.size = size; p.life = life; p.maxLife = life
    this._col.setRGB(r, g, b)
    this._pool.setColorAt(i, this._col)
    if (this._pool.instanceColor) this._pool.instanceColor.needsUpdate = true
  }

  onResize(w, h) {
    this.composer.setSize(w, h)
    this.bloomPass.resolution.set(Math.floor(w / 2), Math.floor(h / 2))
  }

  setBloomForZone(zi) {
    const params = [
      { s: 0.2,  r: 0.35, t: 0.92 }, // Garden
      { s: 0.3,  r: 0.45, t: 0.87 }, // Ruins
      { s: 0.45, r: 0.55, t: 0.82 }, // Sky
      { s: 0.70, r: 0.75, t: 0.72 }, // Storm
      { s: 1.00, r: 0.90, t: 0.62 }, // Cosmic
    ]
    const p = params[Math.min(zi, params.length - 1)]
    this.bloomPass.strength  = p.s
    this.bloomPass.radius    = p.r
    this.bloomPass.threshold = p.t
  }

  // ── Burst spawners ───────────────────────────────────────────────────────

  spawnCheckpointBurst(position) {
    const { x, y, z } = position
    const cols = [[1,.85,0],[1,.55,0],[1,1,.2],[0,1,.53],[1,.27,1]]
    for (let i = 0; i < 50; i++) {
      const c = cols[i % cols.length]
      this._emit(x, y, z,
        (Math.random() - .5) * 14, Math.random() * 12 + 3, (Math.random() - .5) * 14,
        c[0], c[1], c[2], .8 + Math.random() * .8, 1.6)
    }
    this._flash('rgba(200,255,200,0.35)', 300)
  }

  spawnDeathParticles(position) {
    const { x, y, z } = position
    for (let i = 0; i < 22; i++) {
      this._emit(x, y, z,
        (Math.random() - .5) * 10, Math.random() * 8, (Math.random() - .5) * 10,
        1, .27, 0, .5 + Math.random() * .4, 1.1)
    }
    this._flash('rgba(255,60,60,0.32)', 260)
  }

  spawnZoneParticles(position, zi) {
    const { x, y, z } = position
    const cols = [
      [[.30,.69,.31],[.51,.78,.52]],
      [[1.0,.56,.00],[1.0,.84,.31]],
      [[.51,.83,.98],[1.0,1.0,1.0]],
      [[.81,.58,.85],[.70,.62,.86]],
      [[.50,.78,.77],[.88,.25,.98]],
    ]
    const zc = cols[Math.min(zi, cols.length - 1)]
    for (let i = 0; i < 24; i++) {
      const c = zc[i % 2]
      const a = (i / 24) * Math.PI * 2
      this._emit(x, y, z,
        Math.cos(a) * 7, Math.random() * 9 + 3, Math.sin(a) * 7,
        c[0], c[1], c[2], .7, 2.0)
    }
  }

  spawnLaunchBurst(position) {
    const { x, y, z } = position
    const cols = [[0,.9,1],[1,1,1],[.5,.87,.92],[.31,.76,.97]]
    for (let i = 0; i < 28; i++) {
      const c = cols[i % cols.length]
      this._emit(x, y, z,
        (Math.random() - .5) * 9, Math.random() * 20 + 6, (Math.random() - .5) * 9,
        c[0], c[1], c[2], .6, 1.1)
    }
    this._flash('rgba(0,230,255,0.32)', 200)
  }

  spawnLandingDust(x, y, z) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 1.5 + Math.random() * 2.5
      this._emit(
        x + (Math.random() - .5) * .5, y, z + (Math.random() - .5) * .5,
        Math.cos(a) * sp, .5 + Math.random() * 1.5, Math.sin(a) * sp,
        .88, .82, .70, .28 + Math.random() * .22, .55)
    }
  }

  triggerLightning() {
    this._flash('rgba(200,180,255,0.58)', 80)
    setTimeout(() => this._flash('rgba(200,180,255,0.28)', 60), 120)
  }

  _flash(color, dur) {
    const el = document.getElementById('screen-flash')
    if (!el) return
    el.style.background = color
    el.style.transition = 'none'
    el.style.opacity = '1'
    setTimeout(() => {
      el.style.transition = `opacity ${dur}ms ease`
      el.style.opacity = '0'
    }, 16)
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  update(dt, playerPos, zoneIdx) {
    this._time += dt

    if (zoneIdx === 3) {
      this._lightningTimer -= dt
      if (this._lightningTimer <= 0) {
        this._lightningTimer = 3 + Math.random() * 8
        this.triggerLightning()
      }
    }

    let dirty = false
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this._pd[i]
      if (!p.active) continue

      p.life -= dt
      if (p.life <= 0) {
        this._release(i)
        dirty = true
        continue
      }

      p.vy -= 18 * dt
      p.px += p.vx * dt
      p.py += p.vy * dt
      p.pz += p.vz * dt

      const t = p.life / p.maxLife
      const s = p.size * t
      this._pos.set(p.px, p.py, p.pz)
      this._scl.set(s, s, s)
      this._mat4.compose(this._pos, this._quat, this._scl)
      this._pool.setMatrixAt(i, this._mat4)
      dirty = true
    }

    if (dirty) this._pool.instanceMatrix.needsUpdate = true
  }
}

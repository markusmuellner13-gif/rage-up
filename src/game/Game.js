import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { Player } from './Player.js'
import { World } from './World.js'
import { CameraController } from './Camera.js'
import { UI } from './UI.js'
import { Effects } from './Effects.js'
import { Input } from './Input.js'
import { Sound } from './Sound.js'

// Getting Over It rules: falls are REAL — you keep your exact position
// between sessions, but nothing ever saves you from gravity.
const SAVE_KEY  = 'rageup-save-v2'
const STATS_KEY = 'rageup-stats-v1'
const MIN_RAGE_FALL = 12 // metres of lost height before we start mocking you

export class Game {
  constructor(canvas) {
    this.canvas = canvas
    this.state  = 'menu'
    this.clock  = new THREE.Clock(false)
    this._currentZone = 0
    this._prevZone    = -1
    this._started     = false
    this._saveTimer   = 0
    this._beatBestThisRun = false

    // FPS tracking for adaptive quality
    this._fpsFrames = 0
    this._fpsTimer  = 0
    this._fps       = 60

    this._setupRenderer()
    this._setupScene()
    this._setupPhysics()

    this.sound  = new Sound()
    this.input  = new Input(canvas)
    this.world  = new World(this.scene, this.physicsWorld)
    this.world.generate()

    this.player    = new Player(this.scene, this.physicsWorld, this.world.physMats, this.sound)
    this.cameraCtrl= new CameraController(this.camera)
    this.effects   = new Effects(this.renderer, this.scene, this.camera, this.sound)
    this.ui        = new UI(canvas, this.input, this.sound)
    this.ui.totalCrowns = this.world.checkpoints.length
    this.ui.setCrownCount(0)

    this._setupLights()
    this._applyZone(0)

    this.stats = this._loadStats()
    this._loadSave()
    // The golden ring marks your previous best — beat it.
    this._sessionBest = this.stats.bestY
    this.world.setBestHeightMarker(this._sessionBest)
    this.ui.setBestHeight(this.stats.bestY)
    this.ui.fallCount = this.player.fallCount

    this._setupPause()
    window.addEventListener('pagehide', () => this._save())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._save()
    })
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false
    })
    const dpr = Math.min(window.devicePixelRatio, 1.5)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type    = THREE.PCFShadowMap
    this.renderer.toneMapping          = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure  = 1.1
    this.renderer.outputColorSpace     = THREE.SRGBColorSpace
    this.renderer.autoClear = false
  }

  _setupScene() {
    this.scene  = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xb2ebf2, 55, 300)
    this.scene.background = new THREE.Color(0x4fc3f7)
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 900)
    this.camera.position.set(0, 6, 11)
  }

  _setupPhysics() {
    this.physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) })
    this.physicsWorld.broadphase  = new CANNON.SAPBroadphase(this.physicsWorld)
    this.physicsWorld.allowSleep  = false
    this.physicsWorld.solver.iterations = 8
  }

  _setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xfff8e1, 0.65)
    this.scene.add(this.ambientLight)

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0)
    this.sunLight.position.set(40, 80, 40)
    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(1024, 1024)
    this.sunLight.shadow.camera.near   = 2
    this.sunLight.shadow.camera.far    = 350
    this.sunLight.shadow.camera.left   = -60
    this.sunLight.shadow.camera.right  =  60
    this.sunLight.shadow.camera.top    =  60
    this.sunLight.shadow.camera.bottom = -60
    this.sunLight.shadow.bias = -0.001
    this.sunLight.shadow.normalBias = 0.02
    this.scene.add(this.sunLight)
    this.scene.add(this.sunLight.target)

    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x228b22, 0.5)
    this.scene.add(this.hemiLight)
  }

  _setupPause() {
    document.addEventListener('keydown', e => {
      if (e.code === 'Escape') this._togglePause()
      if (e.code === 'KeyM') {
        const muted = this.sound.toggleMute()
        this.ui.showMuteState(muted)
      }
    })
    document.getElementById('resume-btn')?.addEventListener('click', () => this._togglePause())
    document.getElementById('quit-btn')?.addEventListener('click', () => {
      this._save()
      location.reload()
    })
  }

  _togglePause() {
    if (this.state !== 'playing' && this.state !== 'paused') return
    if (this.state === 'playing') {
      this.state = 'paused'
      this._save()
      if (document.pointerLockElement) document.exitPointerLock()
      this.ui.fillPauseStats(this.player, this.stats)
      document.getElementById('pause-screen').style.display = 'flex'
    } else {
      this.state = 'playing'
      document.getElementById('pause-screen').style.display = 'none'
    }
  }

  _applyZone(zi) {
    const zone = this.world.setZoneAtmosphere(this.scene, zi)
    this.ambientLight.color.set(zone.ambColor)
    this.ambientLight.intensity = zone.ambient
    this.sunLight.color.set(zone.sunColor)
    this.sunLight.intensity = zi >= 3 ? 0.5 : 1.0
    this.hemiLight.color.set(zone.skyTop)
    this.effects.setBloomForZone(zi)
    this._currentZone = zi
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  _loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STATS_KEY))
      if (s) return { bestY: s.bestY || 0, totalFalls: s.totalFalls || 0, totalTime: s.totalTime || 0 }
    } catch (_) {}
    return { bestY: 0, totalFalls: 0, totalTime: 0 }
  }

  _loadSave() {
    try {
      localStorage.removeItem('rage-up-cp') // old checkpoint-based save format
      const saved = localStorage.getItem(SAVE_KEY)
      if (!saved) return
      const d = JSON.parse(saved)
      this.player.setPosition(d.x, d.y, d.z)
      this.player.fallCount = d.falls || 0
      if (Array.isArray(d.crowns)) d.crowns.forEach(i => this.world.markCollected(i))
      this.ui.setCrownCount(this.world.crownsCollected)
      this.ui.setElapsedBase(d.elapsed || 0)
      const zi = this.world.getZoneForHeight(d.y)
      this._applyZone(zi)
      this._prevZone = zi
    } catch (_) {}
  }

  _save() {
    if (!this._started || this.state === 'won') return
    try {
      const p = this.player.body.position
      const crowns = []
      for (const cp of this.world.checkpoints) if (cp.collected) crowns.push(cp.index)
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        x: p.x, y: p.y, z: p.z,
        crowns,
        falls: this.player.fallCount,
        elapsed: this.ui.elapsed
      }))
      this.stats.totalTime = this._statsTimeBase + this.ui.elapsed
      localStorage.setItem(STATS_KEY, JSON.stringify(this.stats))
    } catch (_) {}
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  start() {
    this._statsTimeBase = this.stats.totalTime - this.ui.elapsed
    this._renderLoop()
    this.ui.showStartScreen(() => {
      this.sound.unlock()
      this.sound.uiClick()
      this.ui.hideStartScreen()
      this._statsTimeBase = this.stats.totalTime - this.ui.elapsed
      this.state  = 'playing'
      this.clock.start()
      this._started = true
    })
  }

  _renderLoop() {
    requestAnimationFrame(() => this._renderLoop())
    const rawDt = this.clock.getDelta()

    if (!this._started || this.state === 'paused') {
      this.effects.composer.render()
      return
    }

    const dt = Math.min(rawDt, 0.05)
    this._trackFPS(dt)
    this._update(dt)
    this.effects.composer.render()
  }

  _trackFPS(dt) {
    this._fpsFrames++
    this._fpsTimer += dt
    if (this._fpsTimer >= 2) {
      this._fps = this._fpsFrames / this._fpsTimer
      this._fpsFrames = 0
      this._fpsTimer  = 0
      if (this._fps < 40 && this.renderer.getPixelRatio() > 1) {
        this.renderer.setPixelRatio(1)
        this.effects.onResize(window.innerWidth, window.innerHeight)
      }
    }
  }

  _update(dt) {
    if (this.state !== 'playing') return

    this.physicsWorld.step(1 / 60, dt, 4)

    const input = this.input.getState()
    this.player.update(dt, input, this.world, this.cameraCtrl, this.effects)

    const pv = this.player.body.velocity
    this.cameraCtrl.update(dt, this.player.mesh.position, input, pv)

    const pp = this.player.mesh.position
    this.sunLight.position.set(pp.x + 40, pp.y + 80, pp.z + 40)
    this.sunLight.target.position.set(pp.x, pp.y, pp.z)
    this.sunLight.target.updateMatrixWorld()

    this.world.update(dt, pp)
    this.ui.update(dt, this.player, this.world, this.cameraCtrl)
    this.effects.update(dt, pp, this._currentZone)
    this.sound.setAltitude(pp.y / this.world.totalHeight)

    // ── Real fall consequences: you land where gravity puts you ──
    // (bouncy clouds don't count — they caught you)
    const landing = this.player.lastLanding
    const landedOn = this.world.getPlatformForBody(this.player.standingBody)
    if (landing && landing.drop >= MIN_RAGE_FALL && landedOn?.type !== 2) {
      this.player.fallCount++
      this.stats.totalFalls++
      this.ui.fallCount = this.player.fallCount
      this.ui.showFall(landing.drop)
      this.cameraCtrl.shake(Math.min(1.6, 0.4 + landing.drop * 0.012), 0.5)
      if (landing.drop >= 40) this.sound.bigFall()
    }

    // Crumble platforms arm when stood on
    if (this.player.standingBody) {
      const crumbling = this.world.notifyStanding(this.player.standingBody)
      if (crumbling) {
        this.sound.crack()
        this.cameraCtrl.shake(0.25, 0.3)
      }
    }

    // Zone transitions (both directions — falling back down re-announces)
    const zi = this.world.getZoneForHeight(pp.y)
    if (zi !== this._prevZone) {
      this._applyZone(zi)
      this.ui.showZoneMessage(this.world.getZoneName(zi))
      this.effects.spawnZoneParticles(pp, zi)
      this._prevZone = zi
    }

    // Crown collection (pure reward — crowns never save your position)
    const cp = this.world.checkPlayerCrowns(this.player.body)
    if (cp) {
      this.ui.showCrownCollected(this.world.crownsCollected)
      this.effects.spawnCheckpointBurst(cp.position)
      this.player.setCheckpointFace(2)
      this.sound.crown()
      this.cameraCtrl.shake(0.4, 0.2)
      this._save()
    }

    // Launch pads
    const lp = this.world.checkPlayerLaunchPads(this.player.body)
    if (lp && this.player._launchCooldown <= 0) {
      this.player.launch(26)
      this.effects.spawnLaunchBurst(lp.position)
      this.ui.showLaunchMessage()
      this.sound.launch()
      this.cameraCtrl.shake(0.5, 0.18)
    }

    // All-time best height — beat the golden ring
    if (pp.y > this.stats.bestY) {
      this.stats.bestY = pp.y
      this.ui.setBestHeight(pp.y)
      if (!this._beatBestThisRun && this._sessionBest >= 15 && pp.y > this._sessionBest) {
        this._beatBestThisRun = true
        this.ui.showNewBest()
        this.sound.milestone()
        this.world.setBestHeightMarker(0) // ring hidden — you're past it now
      }
    }

    // Autosave (only while grounded so a reload never rescues you mid-fall)
    this._saveTimer += dt
    if (this._saveTimer >= 5) {
      this._saveTimer = 0
      if (this.player._grounded) this._save()
    }

    // Emergency catch if physics ever tunnels through the ground plane
    if (pp.y < -8) this.player.resetToStart()

    // Win condition
    if (pp.y >= 1996 && this.state === 'playing') this._handleWin()
  }

  _handleWin() {
    this.state = 'won'
    localStorage.removeItem(SAVE_KEY)
    try {
      this.stats.totalTime = this._statsTimeBase + this.ui.elapsed
      localStorage.setItem(STATS_KEY, JSON.stringify(this.stats))
    } catch (_) {}
    this.effects.spawnCheckpointBurst(this.player.mesh.position)
    this.sound.win()
    setTimeout(() => this.ui.showWinScreen(this.player.fallCount, this.world.crownsCollected), 1500)
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio, 1.5)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.effects.onResize(w, h)
  }
}

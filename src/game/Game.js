import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { Player } from './Player.js'
import { World } from './World.js'
import { CameraController } from './Camera.js'
import { UI } from './UI.js'
import { Effects } from './Effects.js'
import { Input } from './Input.js'

export class Game {
  constructor(canvas) {
    this.canvas = canvas
    this.state  = 'menu'
    this.clock  = new THREE.Clock(false)
    this._currentZone = 0
    this._prevZone    = -1
    this._started     = false
    this._windAngle   = 0
    this._windForce   = new CANNON.Vec3() // reused every frame — no GC

    // FPS tracking for adaptive quality
    this._fpsFrames = 0
    this._fpsTimer  = 0
    this._fps       = 60

    this._setupRenderer()
    this._setupScene()
    this._setupPhysics()

    this.input  = new Input(canvas)
    this.world  = new World(this.scene, this.physicsWorld)
    this.world.generate()

    this.player    = new Player(this.scene, this.physicsWorld, this.world.physMats)
    this.cameraCtrl= new CameraController(this.camera)
    this.effects   = new Effects(this.renderer, this.scene, this.camera)
    this.ui        = new UI(canvas, this.input)
    this.ui.totalCheckpoints = this.world.checkpoints.length

    this._setupLights()
    this._applyZone(0)
    this._loadCheckpoint()
    this._setupPause()
  }

  _setupRenderer() {
    // antialias off — post-processing composer handles AA, and MSAA on FBO textures
    // doesn't propagate to screen output anyway. Saves fillrate on mobile.
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false
    })
    const dpr = Math.min(window.devicePixelRatio, 1.5) // cap at 1.5x — big mobile win
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type    = THREE.PCFShadowMap // PCF (not Soft) — faster
    this.renderer.toneMapping          = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure  = 1.1
    this.renderer.outputColorSpace     = THREE.SRGBColorSpace
    // Disable auto-clear — composer handles this
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
    this.physicsWorld.solver.iterations = 8 // was 12 — 8 is plenty for this game
  }

  _setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xfff8e1, 0.65)
    this.scene.add(this.ambientLight)

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0)
    this.sunLight.position.set(40, 80, 40)
    this.sunLight.castShadow = true
    // 1024 vs 2048 — 4× less shadow map memory and fill cost, barely visible difference
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
    })
    document.getElementById('resume-btn')?.addEventListener('click', () => this._togglePause())
    document.getElementById('quit-btn')?.addEventListener('click', () => location.reload())
  }

  _togglePause() {
    if (this.state !== 'playing' && this.state !== 'paused') return
    if (this.state === 'playing') {
      this.state = 'paused'
      if (document.pointerLockElement) document.exitPointerLock()
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

  _loadCheckpoint() {
    try {
      const saved = localStorage.getItem('rage-up-cp')
      if (saved) {
        const d = JSON.parse(saved)
        this.player.setPosition(d.x, d.y, d.z)
        this.player.checkpointIndex = d.index
        this.ui.checkpointCount = d.index
        const el = document.getElementById('checkpoint-stat')
        if (el) el.textContent = `☑ ${d.index} / ${this.world.checkpoints.length}`
        // Start in the correct zone
        const zi = this.world.getZoneForHeight(d.y)
        this._applyZone(zi)
        this._prevZone = zi
      }
    } catch (_) {}
  }

  _saveCheckpoint(cp) {
    try {
      localStorage.setItem('rage-up-cp', JSON.stringify({
        x: cp.position.x, y: cp.position.y, z: cp.position.z, index: cp.index + 1
      }))
    } catch (_) {}
  }

  start() {
    this._renderLoop()
    this.ui.showStartScreen(() => {
      this.ui.hideStartScreen()
      this.state  = 'playing'
      this.clock.start()
      this._started = true
    })
  }

  _renderLoop() {
    requestAnimationFrame(() => this._renderLoop())
    // Always consume clock delta to prevent spike after pause/unfocus
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
      // Adaptive quality: if FPS < 40 for 2 seconds, reduce pixel ratio
      if (this._fps < 40 && this.renderer.getPixelRatio() > 1) {
        this.renderer.setPixelRatio(1)
        this.effects.onResize(window.innerWidth, window.innerHeight)
      }
    }
  }

  _update(dt) {
    if (this.state !== 'playing') return

    // Physics substeps: 4 is good balance of accuracy vs cost
    this.physicsWorld.step(1 / 60, dt, 4)

    const input = this.input.getState()

    this._applyWind(dt)

    // Pass effects so Player can spawn landing dust
    this.player.update(dt, input, this.world, this.cameraCtrl, this.effects)

    const pv = this.player.body.velocity
    this.cameraCtrl.update(dt, this.player.mesh.position, input, pv)

    // Shadow tracks player — update only every other frame when far from ground
    const pp = this.player.mesh.position
    this.sunLight.position.set(pp.x + 40, pp.y + 80, pp.z + 40)
    this.sunLight.target.position.set(pp.x, pp.y, pp.z)
    this.sunLight.target.updateMatrixWorld()

    this.world.update(dt, pp)
    this.ui.update(dt, this.player, this.world, this.cameraCtrl)
    this.effects.update(dt, pp, this._currentZone)

    // Zone transitions
    const zi = this.world.getZoneForHeight(pp.y)
    if (zi !== this._prevZone) {
      this._applyZone(zi)
      this._prevZone = zi
      this.ui.showZoneMessage(this.world.getZoneName(zi))
      this.effects.spawnZoneParticles(pp, zi)
    }

    // Checkpoint collection
    const cp = this.world.checkPlayerCheckpoints(this.player.body, this.player.checkpointIndex)
    if (cp) {
      this.player.checkpointIndex = cp.index + 1
      this.player.checkpointPos.copy(cp.position)
      this.ui.showCheckpointReached(this.player.checkpointIndex)
      this.effects.spawnCheckpointBurst(cp.position)
      this.player.setCheckpointFace(2)
      this._saveCheckpoint(cp)
      this.cameraCtrl.shake(0.4, 0.2)
    }

    // Launch pad detection
    const lp = this.world.checkPlayerLaunchPads(this.player.body)
    if (lp && this.player._launchCooldown <= 0) {
      this.player.launch(26)
      this.effects.spawnLaunchBurst(lp.position)
      this.ui.showLaunchMessage()
      this.cameraCtrl.shake(0.5, 0.18)
    }

    // Fall detection — skip during respawn protection window
    if (!this.player.isRespawnSafe) {
      const lastCp = this.world.getCheckpoint(this.player.checkpointIndex - 1)
      const cpY    = lastCp ? lastCp.position.y : 0
      // Forgiveness scales: early game 55 units, later zones tighten to 38
      const forgiveness = Math.max(38, 55 - this._currentZone * 4)
      if (pp.y < cpY - forgiveness || pp.y < -22) {
        this._handleFall()
      }
    }

    // Win condition
    if (pp.y >= 1998 && this.state === 'playing') this._handleWin()
  }

  _applyWind(dt) {
    const y = this.player.body.position.y
    if (y < 900 || y > 1400) return
    this._windAngle += dt * 0.5
    const strength = (Math.sin(this._windAngle) * 0.5 + 0.5) * 10 * ((y - 900) / 500)
    const wx = Math.cos(this._windAngle * 0.8) * strength
    const wz = Math.sin(this._windAngle * 0.65) * strength
    // Reuse pre-allocated Vec3 — avoids one 'new CANNON.Vec3' per frame
    this._windForce.set(wx, 0, wz)
    this.player.body.applyForce(this._windForce, this.player.body.position)
  }

  _handleFall() {
    const lastCp    = this.world.getCheckpoint(Math.max(0, this.player.checkpointIndex - 1))
    const respawnPos = lastCp ? lastCp.position : new THREE.Vector3(0, 2, 0)
    this.effects.spawnDeathParticles(this.player.body.position)
    this.player.respawnAt(respawnPos)
    this.ui.showRageMessage()
    this.cameraCtrl.shake(1.2, 0.5)
  }

  _handleWin() {
    this.state = 'won'
    localStorage.removeItem('rage-up-cp')
    this.effects.spawnCheckpointBurst(this.player.mesh.position)
    setTimeout(() => this.ui.showWinScreen(this.player.deathCount, this.player.checkpointIndex), 1500)
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

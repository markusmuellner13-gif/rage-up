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
    this.state = 'menu'
    this.clock = new THREE.Clock(false)
    this._currentZone = 0
    this._prevZone = -1
    this._started = false
    this._windAngle = 0

    this._setupRenderer()
    this._setupScene()
    this._setupPhysics()

    this.input = new Input(canvas)
    this.world = new World(this.scene, this.physicsWorld)
    this.world.generate()

    this.player = new Player(this.scene, this.physicsWorld, this.world.physMats)
    this.cameraCtrl = new CameraController(this.camera)
    this.effects = new Effects(this.renderer, this.scene, this.camera)
    this.ui = new UI(canvas, this.input)
    this.ui.totalCheckpoints = this.world.checkpoints.length

    this._setupLights()
    this._applyZone(0)
    this._loadCheckpoint()
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
  }

  _setupScene() {
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xb2ebf2, 55, 300)
    this.scene.background = new THREE.Color(0x4fc3f7)
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 900)
    this.camera.position.set(0, 6, 11)
  }

  _setupPhysics() {
    this.physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) })
    this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld)
    this.physicsWorld.allowSleep = false
    this.physicsWorld.solver.iterations = 12
  }

  _setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xfff8e1, 0.65)
    this.scene.add(this.ambientLight)

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0)
    this.sunLight.position.set(40, 80, 40)
    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(2048, 2048)
    this.sunLight.shadow.camera.near = 1
    this.sunLight.shadow.camera.far = 400
    this.sunLight.shadow.camera.left = -80
    this.sunLight.shadow.camera.right = 80
    this.sunLight.shadow.camera.top = 80
    this.sunLight.shadow.camera.bottom = -80
    this.sunLight.shadow.bias = -0.001
    this.scene.add(this.sunLight)
    this.scene.add(this.sunLight.target)

    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x228b22, 0.5)
    this.scene.add(this.hemiLight)
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
      this.state = 'playing'
      this.clock.start()
      this._started = true
    })
  }

  _renderLoop() {
    requestAnimationFrame(() => this._renderLoop())
    if (!this._started) { this.effects.composer.render(); return }
    const dt = Math.min(this.clock.getDelta(), 0.05)
    this._update(dt)
    this.effects.composer.render()
  }

  _update(dt) {
    if (this.state !== 'playing') return

    this.physicsWorld.step(1 / 60, dt, 4)

    const input = this.input.getState()

    // Wind in storm zone
    this._applyWind(dt)

    // Player update
    this.player.update(dt, input, this.world, this.cameraCtrl)

    // Camera update with player velocity
    const pv = this.player.body.velocity
    this.cameraCtrl.update(dt, this.player.mesh.position, input, pv)

    // Track sun shadow with player
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
      this.player.launch(24)
      this.effects.spawnLaunchBurst(lp.position)
      this.ui.showLaunchMessage()
      this.cameraCtrl.shake(0.5, 0.2)
    }

    // Fall-back check — 45 units below last checkpoint is generous but still rage-y
    const lastCp = this.world.getCheckpoint(this.player.checkpointIndex - 1)
    const cpY = lastCp ? lastCp.position.y : 0
    if (pp.y < cpY - 45 || pp.y < -20) {
      this._handleFall()
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
    this.player.body.applyForce(new CANNON.Vec3(wx, 0, wz), this.player.body.position)
  }

  _handleFall() {
    const lastCp = this.world.getCheckpoint(Math.max(0, this.player.checkpointIndex - 1))
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
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.effects.onResize(w, h)
  }
}

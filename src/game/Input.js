export class Input {
  constructor(canvas) {
    this.keys = {}
    this.mouse = { dx: 0, dy: 0, locked: false }
    this.touch = { forward: 0, right: 0, jump: false }
    this._jumpQueued = false
    this._cameraTouch = null
    this._cameraActive = false

    document.addEventListener('keydown', e => {
      this.keys[e.code] = true
      if (e.code === 'Space') { this._jumpQueued = true; e.preventDefault() }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault()
    })
    document.addEventListener('keyup', e => { this.keys[e.code] = false })

    // Pointer lock for desktop camera
    canvas.addEventListener('click', () => {
      if (!this.isMobile()) canvas.requestPointerLock()
    })
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === canvas
    })
    document.addEventListener('mousemove', e => {
      if (this.mouse.locked) {
        this.mouse.dx += e.movementX * 0.003
        this.mouse.dy += e.movementY * 0.003
      }
    })

    // Camera touch drag (right half of screen)
    canvas.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false })
    canvas.addEventListener('touchmove', e => this._onTouchMove(e), { passive: false })
    canvas.addEventListener('touchend', e => this._onTouchEnd(e), { passive: false })

    // Camera reset button
    const camBtn = document.getElementById('camera-btn')
    if (camBtn) {
      camBtn.addEventListener('touchstart', e => { e.stopPropagation(); this._cameraActive = true }, { passive: true })
      camBtn.addEventListener('touchend', () => { this._cameraActive = false }, { passive: true })
    }

    // Jump button
    const jumpBtn = document.getElementById('jump-btn')
    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); this._jumpQueued = true; this.touch.jump = true }, { passive: false })
      jumpBtn.addEventListener('touchend', () => { this.touch.jump = false }, { passive: true })
    }
  }

  isMobile() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  }

  _onTouchStart(e) {
    for (const t of e.changedTouches) {
      if (t.clientX > window.innerWidth * 0.5) {
        this._cameraTouch = { id: t.identifier, x: t.clientX, y: t.clientY }
      }
    }
  }

  _onTouchMove(e) {
    e.preventDefault()
    if (!this._cameraTouch) return
    for (const t of e.changedTouches) {
      if (t.identifier === this._cameraTouch.id) {
        this.mouse.dx += (t.clientX - this._cameraTouch.x) * 0.005
        this.mouse.dy += (t.clientY - this._cameraTouch.y) * 0.005
        this._cameraTouch.x = t.clientX
        this._cameraTouch.y = t.clientY
      }
    }
  }

  _onTouchEnd(e) {
    if (!this._cameraTouch) return
    for (const t of e.changedTouches) {
      if (t.identifier === this._cameraTouch.id) this._cameraTouch = null
    }
  }

  getState() {
    const fwd = (this.keys['KeyW'] || this.keys['ArrowUp']) ? 1 :
                (this.keys['KeyS'] || this.keys['ArrowDown']) ? -1 : this.touch.forward
    const right = (this.keys['KeyD'] || this.keys['ArrowRight']) ? 1 :
                  (this.keys['KeyA'] || this.keys['ArrowLeft']) ? -1 : this.touch.right
    const jump = this._jumpQueued || this.keys['Space']

    const state = {
      forward: fwd, right,
      jump,
      mouseDx: this.mouse.dx,
      mouseDy: this.mouse.dy
    }

    // consume one-shot inputs
    this._jumpQueued = false
    this.mouse.dx = 0
    this.mouse.dy = 0
    return state
  }

  setMobileJoystick(forward, right) {
    this.touch.forward = forward
    this.touch.right = right
  }
}

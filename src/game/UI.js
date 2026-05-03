import nipplejs from 'nipplejs'

const RAGE_MESSAGES = [
  'SKILL ISSUE', 'JUST LIKE THAT?!', 'REALLY??', 'YOU WERE SO CLOSE!',
  'TRY AGAIN 🤡', 'PATHETIC', 'NOT EVEN CLOSE', 'GRAVITY WINS AGAIN',
  'L + RATIO + FELL OFF', 'TOUCH GRASS → THEN TRY AGAIN',
  'THIS IS EMBARRASSING', 'MY GRANDMA CLIMBS FASTER', 'COPE',
  'THE BALL HAS HAD ENOUGH', 'BACK TO THE CHECKPOINT (YOU\'RE WELCOME)',
  'HAVE YOU TRIED NOT FALLING?', 'IMAGINE FALLING HERE 💀',
  'GIT GUD', 'skill diff 😂', 'YOU ALMOST HAD IT... NOT',
  'THE PHYSICS ARE NOT TO BLAME', 'MAYBE TRY SLOWER?', 'OR FASTER?',
  'INCREDIBLE. WRONG WAY.', 'CERTIFIED FALLING CHAMPION'
]

export class UI {
  constructor(canvas, input) {
    this.canvas = canvas
    this.input = input
    this.deaths = 0
    this.checkpointCount = 0
    this.totalCheckpoints = 0
    this._milestones = new Set()
    this._timerStart = null
    this._elapsed = 0
    this._bestTime = parseFloat(localStorage.getItem('rage-up-best') || '0')

    this._el = {
      heightLabel:    document.getElementById('height-label'),
      heightFill:     document.getElementById('height-bar-fill'),
      zoneName:       document.getElementById('zone-name'),
      checkpointStat: document.getElementById('checkpoint-stat'),
      deathsStat:     document.getElementById('deaths'),
      checkpointFlash: document.getElementById('checkpoint-flash'),
      checkpointText: document.getElementById('checkpoint-text'),
      rageMsg:        document.getElementById('rage-message'),
      zoneAnnounce:   document.getElementById('zone-announce'),
      milestone:      document.getElementById('milestone'),
      mobileControls: document.getElementById('mobile-controls'),
      startScreen:    document.getElementById('start-screen'),
      winScreen:      document.getElementById('win-screen'),
      winStats:       document.getElementById('win-stats'),
      timerEl:        document.getElementById('timer'),
      speedEl:        document.getElementById('speed-indicator'),
      compassEl:      document.getElementById('compass'),
      compassArrow:   document.getElementById('compass-arrow'),
      compassDist:    document.getElementById('compass-dist'),
      launchMsg:      document.getElementById('launch-message'),
    }

    this._setupMobile(input)
    this._setupStart()
    this._setupWin()
  }

  _setupMobile(input) {
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return
    const ctrl = this._el.mobileControls
    if (ctrl) ctrl.style.display = 'block'

    const joystickZone = document.getElementById('joystick-zone')
    if (!joystickZone) return
    const joystick = nipplejs.create({
      zone: joystickZone, mode: 'static',
      position: { left: '70px', bottom: '70px' },
      size: 110, color: 'rgba(255,255,255,0.6)'
    })
    joystick.on('move', (e, data) => {
      if (!data.vector) return
      input.setMobileJoystick(-data.vector.y, data.vector.x)
    })
    joystick.on('end', () => input.setMobileJoystick(0, 0))
  }

  _setupStart() {
    document.getElementById('start-btn')?.addEventListener('click', () => this._startCallback?.())
  }

  _setupWin() {
    document.getElementById('restart-btn')?.addEventListener('click', () => location.reload())
  }

  showStartScreen(onStart) {
    this._startCallback = onStart
    const ss = this._el.startScreen
    if (ss) ss.style.display = 'flex'
  }

  hideStartScreen() {
    const ss = this._el.startScreen
    if (ss) {
      ss.style.transition = 'opacity 0.5s'
      ss.style.opacity = '0'
      setTimeout(() => { ss.style.display = 'none'; ss.style.opacity = '1' }, 500)
    }
    this._timerStart = performance.now()
  }

  showWinScreen(deaths, checkpoints) {
    const time = this._elapsed
    if (this._bestTime === 0 || time < this._bestTime) {
      localStorage.setItem('rage-up-best', time.toFixed(1))
      this._bestTime = time
    }
    const ws = this._el.winScreen
    if (!ws) return
    ws.style.display = 'flex'
    if (this._el.winStats) {
      const mins = Math.floor(time / 60)
      const secs = Math.floor(time % 60)
      this._el.winStats.innerHTML = `
        Time: <strong>${mins}m ${secs}s</strong><br/>
        Deaths: <strong>${deaths}</strong><br/>
        Checkpoints: <strong>${checkpoints} / ${this.totalCheckpoints}</strong><br/><br/>
        <em style="color:#ffd700">You actually did it. Absolute legend.</em>
      `
    }
  }

  showCheckpointReached(num) {
    this.checkpointCount = num
    if (this._el.checkpointStat) this._el.checkpointStat.textContent = `☑ ${num} / ${this.totalCheckpoints}`

    const flash = this._el.checkpointFlash
    const text = this._el.checkpointText
    if (!text) return

    const isZoneEnd = num % 5 === 0
    text.textContent = isZoneEnd ? '🔥 ZONE CLEARED! 🔥' : (num % 3 === 0 ? '⭐ CHECKPOINT! ⭐' : 'CHECKPOINT!')

    this._anim(flash, [{ opacity: '1' }, { opacity: '0' }], { duration: 700, fill: 'forwards' })
    this._anim(text, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.5)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.2)', offset: 0.25 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.0)', offset: 0.55 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.85)' }
    ], { duration: 1600, fill: 'forwards' })
  }

  showRageMessage() {
    const msg = RAGE_MESSAGES[Math.floor(Math.random() * RAGE_MESSAGES.length)]
    const el = this._el.rageMsg
    if (!el) return
    el.textContent = msg
    this._anim(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.4) rotate(-8deg)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.12) rotate(2deg)', offset: 0.15 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0.55 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.88) rotate(-2deg)' }
    ], { duration: 2400, fill: 'forwards' })
  }

  showZoneMessage(name) {
    const el = this._el.zoneAnnounce
    if (!el) return
    el.innerHTML = `ENTERING<span>${name}</span>`
    this._anim(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) translateY(30px)' },
      { opacity: '1', transform: 'translate(-50%,-50%) translateY(0)', offset: 0.2 },
      { opacity: '1', transform: 'translate(-50%,-50%) translateY(0)', offset: 0.75 },
      { opacity: '0', transform: 'translate(-50%,-50%) translateY(-20px)' }
    ], { duration: 3200, fill: 'forwards' })
  }

  showLaunchMessage() {
    const el = this._el.launchMsg
    if (!el) return
    el.style.display = 'block'
    this._anim(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.5) translateY(20px)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.2) translateY(0)', offset: 0.2 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.9) translateY(-30px)' }
    ], { duration: 1200, fill: 'forwards' })
  }

  showMilestone(meters) {
    if (this._milestones.has(meters)) return
    this._milestones.add(meters)
    const el = this._el.milestone
    if (!el) return
    el.textContent = meters >= 2000 ? '🏆 SUMMIT!' : `${meters}m!`
    this._anim(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.4)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.35)', offset: 0.3 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.0)', offset: 0.55 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.8)' }
    ], { duration: 2000, fill: 'forwards' })
  }

  updateCompass(nextCheckpointPos, playerPos, cameraCtrl) {
    const el = this._el.compassEl
    const arrow = this._el.compassArrow
    const dist = this._el.compassDist
    if (!el || !nextCheckpointPos) { if (el) el.style.opacity = '0'; return }

    el.style.opacity = '1'
    const angle = cameraCtrl.getScreenAngleTo(nextCheckpointPos, playerPos)
    if (arrow) arrow.style.transform = `rotate(${angle}deg)`

    const d = playerPos.distanceTo(nextCheckpointPos)
    if (dist) dist.textContent = d < 999 ? `${Math.round(d)}m` : ''
  }

  _anim(el, keyframes, options) {
    if (!el?.animate) return
    el.getAnimations().forEach(a => a.cancel())
    el.animate(keyframes, options)
  }

  update(dt, player, world, cameraCtrl) {
    const y = Math.max(0, player.position.y)
    const pct = Math.min(100, (y / world.totalHeight) * 100)

    if (this._el.heightLabel) this._el.heightLabel.textContent = `${Math.floor(y)}m`
    if (this._el.heightFill) this._el.heightFill.style.width = `${pct}%`
    if (this._el.deathsStat) this._el.deathsStat.textContent = `💀 ${player.deathCount}`

    const zi = world.getZoneForHeight(y)
    if (this._el.zoneName) this._el.zoneName.textContent = world.getZoneName(zi)

    // Run timer
    if (this._timerStart !== null) {
      this._elapsed = (performance.now() - this._timerStart) / 1000
      const mins = Math.floor(this._elapsed / 60)
      const secs = Math.floor(this._elapsed % 60).toString().padStart(2, '0')
      if (this._el.timerEl) this._el.timerEl.textContent = `${mins}:${secs}`
    }

    // Speed indicator
    if (this._el.speedEl) {
      const speed = player.speed
      const kmh = Math.round(speed * 3.6)
      this._el.speedEl.textContent = `${kmh} km/h`
      const t = Math.min(1, speed / 20)
      const r = Math.round(t > 0.5 ? 255 : t * 510)
      const g = Math.round(t < 0.5 ? 255 : (1 - t) * 510)
      this._el.speedEl.style.color = `rgb(${r},${g},80)`
    }

    // Compass to next checkpoint
    const nextCp = world.getNextUncollectedCheckpoint(player.checkpointIndex)
    if (cameraCtrl && nextCp) {
      const playerPos = new THREE.Vector3(player.position.x, player.position.y, player.position.z)
      this.updateCompass(nextCp.position, playerPos, cameraCtrl)
    }

    // Milestone triggers
    const ticks = [50,100,200,300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000]
    for (const m of ticks) {
      if (y >= m) this.showMilestone(m)
    }
  }

  onResize() {}
}

// Needed by Camera.js compass util
import * as THREE from 'three'

import nipplejs from 'nipplejs'

const RAGE_MESSAGES = [
  'SKILL ISSUE', 'JUST LIKE THAT?!', 'REALLY??', 'YOU WERE SO CLOSE!',
  'TRY AGAIN 🤡', 'PATHETIC', 'NOT EVEN CLOSE', 'GRAVITY WINS AGAIN',
  'L + RATIO + FELL OFF', 'TOUCH GRASS → THEN TRY AGAIN',
  'THIS IS EMBARRASSING', 'MY GRANDMA CLIMBS FASTER', 'COPE',
  'THE BALL DISAGREES WITH YOU', 'BACK TO THE BEGINNING (kinda)',
  'HAVE YOU TRIED NOT FALLING?', 'IMAGINE FALLING HERE 💀',
  'GIT GUD', 'skill diff 😂', 'YOU ALMOST HAD IT... NOT'
]

export class UI {
  constructor(canvas, input) {
    this.canvas = canvas
    this.input = input
    this.deaths = 0
    this.checkpointCount = 0
    this.totalCheckpoints = 20
    this._milestones = new Set()
    this._activeAnims = []

    this._el = {
      heightLabel: document.getElementById('height-label'),
      heightFill: document.getElementById('height-bar-fill'),
      zoneName: document.getElementById('zone-name'),
      checkpointStat: document.getElementById('checkpoint-stat'),
      deathsStat: document.getElementById('deaths'),
      checkpointFlash: document.getElementById('checkpoint-flash'),
      checkpointText: document.getElementById('checkpoint-text'),
      rageMsg: document.getElementById('rage-message'),
      zoneAnnounce: document.getElementById('zone-announce'),
      milestone: document.getElementById('milestone'),
      mobileControls: document.getElementById('mobile-controls'),
      startScreen: document.getElementById('start-screen'),
      winScreen: document.getElementById('win-screen'),
      winStats: document.getElementById('win-stats'),
    }

    this._setupMobile(input)
    this._setupStart()
    this._setupWin()
  }

  _setupMobile(input) {
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return
    const ctrl = this._el.mobileControls
    ctrl.style.display = 'block'

    const joystickZone = document.getElementById('joystick-zone')
    const joystick = nipplejs.create({
      zone: joystickZone,
      mode: 'static',
      position: { left: '70px', bottom: '70px' },
      size: 110,
      color: 'rgba(255,255,255,0.6)'
    })

    joystick.on('move', (e, data) => {
      if (!data.vector) return
      input.setMobileJoystick(-data.vector.y, data.vector.x)
    })
    joystick.on('end', () => input.setMobileJoystick(0, 0))
  }

  _setupStart() {
    const btn = document.getElementById('start-btn')
    if (btn) btn.addEventListener('click', () => this._startCallback?.())
  }

  _setupWin() {
    const btn = document.getElementById('restart-btn')
    if (btn) btn.addEventListener('click', () => { location.reload() })
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
  }

  showWinScreen(deaths, checkpoints) {
    const ws = this._el.winScreen
    if (!ws) return
    ws.style.display = 'flex'
    if (this._el.winStats) {
      this._el.winStats.innerHTML = `
        Deaths: <strong>${deaths}</strong><br/>
        Checkpoints: <strong>${checkpoints} / ${this.totalCheckpoints}</strong><br/>
        You actually did it. Legend.
      `
    }
  }

  showCheckpointReached(num) {
    this.checkpointCount = num
    this._el.checkpointStat.textContent = `☑ ${num} / ${this.totalCheckpoints}`

    const flash = this._el.checkpointFlash
    const text = this._el.checkpointText
    if (!flash || !text) return

    text.textContent = num % 5 === 0 ? '🔥 EPIC CHECKPOINT! 🔥' : 'CHECKPOINT!'
    this._animEl(flash, [
      { opacity: '1' }, { opacity: '0' }
    ], { duration: 800, easing: 'ease-out', fill: 'forwards' })
    this._animEl(text, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.6)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.15)', offset: 0.3 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(1.3)' }
    ], { duration: 1400, easing: 'ease-out', fill: 'forwards' })
  }

  showRageMessage() {
    const msg = RAGE_MESSAGES[Math.floor(Math.random() * RAGE_MESSAGES.length)]
    const el = this._el.rageMsg
    if (!el) return
    el.textContent = msg
    this._animEl(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.5) rotate(-5deg)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.1) rotate(2deg)', offset: 0.15 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0.5 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.9) rotate(-1deg)' }
    ], { duration: 2200, easing: 'ease-in-out', fill: 'forwards' })
  }

  showZoneMessage(name) {
    const el = this._el.zoneAnnounce
    if (!el) return
    el.innerHTML = `ENTERING<span>${name}</span>`
    this._animEl(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) translateY(20px)' },
      { opacity: '1', transform: 'translate(-50%,-50%) translateY(0px)', offset: 0.2 },
      { opacity: '1', transform: 'translate(-50%,-50%) translateY(0px)', offset: 0.7 },
      { opacity: '0', transform: 'translate(-50%,-50%) translateY(-20px)' }
    ], { duration: 3000, easing: 'ease-in-out', fill: 'forwards' })
  }

  showMilestone(meters) {
    if (this._milestones.has(meters)) return
    this._milestones.add(meters)
    const el = this._el.milestone
    if (!el) return
    el.textContent = `${meters}m!`
    this._animEl(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.5)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.3)', offset: 0.25 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.0)', offset: 0.5 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.8)' }
    ], { duration: 1800, fill: 'forwards' })
  }

  _animEl(el, keyframes, options) {
    if (!el.animate) return
    el.getAnimations().forEach(a => a.cancel())
    el.animate(keyframes, options)
  }

  update(dt, player, world) {
    const y = Math.max(0, player.position.y)
    const totalH = world.totalHeight
    const pct = Math.min(100, (y / totalH) * 100)

    this._el.heightLabel.textContent = `${Math.floor(y)}m`
    this._el.heightFill.style.width = `${pct}%`
    this._el.deathsStat.textContent = `💀 ${player.deathCount}`

    const zi = world.getZoneForHeight(y)
    this._el.zoneName.textContent = world.getZoneName(zi)

    // Height milestones
    const milestoneTicks = [50, 100, 200, 300, 500, 700, 900, 1000, 1200, 1400, 1500, 1700, 1900, 2000]
    for (const m of milestoneTicks) {
      if (y >= m && !this._milestones.has(m)) {
        this.showMilestone(m)
      }
    }
  }

  onResize() { /* layout handled by CSS */ }
}

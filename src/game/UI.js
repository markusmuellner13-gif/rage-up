import * as THREE from 'three'
import nipplejs from 'nipplejs'

// Tiered mockery — the bigger the fall, the more personal it gets
const SMALL_FALLS = [
  'SKILL ISSUE', 'OOPS.', 'A LITTLE SLIP', 'NOT LIKE THAT',
  'GRAVITY: 1 — YOU: 0', 'WRONG.', 'THAT LOOKED AVOIDABLE',
  'TRY THAT AGAIN', 'HM.', 'CAREFUL NOW',
]
const MID_FALLS = [
  'L + RATIO + FELL OFF', 'MY GRANDMA CLIMBS FASTER',
  'THE BALL HAS HAD ENOUGH', 'INCREDIBLE. WRONG WAY.',
  'HOW?', 'THIS IS EMBARRASSING', 'CERTIFIED FALLING CHAMPION',
  'YOU WERE SO CLOSE!', 'GIT GUD', 'THE PHYSICS ARE NOT TO BLAME',
  'IMAGINE FALLING HERE', 'ONE JOB. ONE.',
]
const HUGE_FALLS = [
  'ALL THAT. FOR NOTHING.',
  'THE MOUNTAIN DOESN\'T CARE',
  '"THE FALL IS PART OF THE CLIMB" — NOBODY',
  'DON\'T UNINSTALL. DON\'T UNINSTALL.',
  'YOUR CLIMB MEANT NOTHING TO GRAVITY',
  'BREATHE. IT\'S JUST A GAME. (IT ISN\'T.)',
  'SOMEWHERE, SOMEONE JUST BEAT THIS GAME',
  'THAT ONE HURT TO WATCH',
]

export class UI {
  constructor(canvas, input, sound) {
    this.canvas           = canvas
    this.input            = input
    this.sound            = sound
    this.crownCount       = 0
    this.totalCrowns      = 0
    this.fallCount        = 0
    this._milestones      = new Set()
    this._timerStart      = null
    this._elapsedBase     = 0
    this._elapsed         = 0
    this._bestHeight      = 0

    this._el = {
      heightLabel:     document.getElementById('height-label'),
      heightFill:      document.getElementById('height-bar-fill'),
      heightBest:      document.getElementById('height-bar-best'),
      zoneName:        document.getElementById('zone-name'),
      crownStat:       document.getElementById('checkpoint-stat'),
      fallsStat:       document.getElementById('deaths'),
      bestStat:        document.getElementById('best-stat'),
      checkpointFlash: document.getElementById('checkpoint-flash'),
      checkpointText:  document.getElementById('checkpoint-text'),
      rageMsg:         document.getElementById('rage-message'),
      lostHeight:      document.getElementById('lost-height'),
      zoneAnnounce:    document.getElementById('zone-announce'),
      milestone:       document.getElementById('milestone'),
      mobileControls:  document.getElementById('mobile-controls'),
      startScreen:     document.getElementById('start-screen'),
      winScreen:       document.getElementById('win-screen'),
      winStats:        document.getElementById('win-stats'),
      timerEl:         document.getElementById('timer'),
      speedEl:         document.getElementById('speed-indicator'),
      compassEl:       document.getElementById('compass'),
      compassArrow:    document.getElementById('compass-arrow'),
      compassDist:     document.getElementById('compass-dist'),
      launchMsg:       document.getElementById('launch-message'),
      muteIndicator:   document.getElementById('mute-indicator'),
      pauseStats:      document.getElementById('pause-stats'),
    }

    this._playerV3 = new THREE.Vector3()

    this._setupMobile(input)
    this._setupStart()
    this._setupWin()
  }

  get elapsed() {
    if (this._timerStart === null) return this._elapsedBase
    return this._elapsedBase + (performance.now() - this._timerStart) / 1000
  }

  setElapsedBase(seconds) { this._elapsedBase = seconds }

  setCrownCount(n) {
    this.crownCount = n
    if (this._el.crownStat) this._el.crownStat.textContent = `👑 ${n} / ${this.totalCrowns}`
  }

  setBestHeight(y) {
    this._bestHeight = y
    if (this._el.bestStat) this._el.bestStat.textContent = `⬆ best ${Math.floor(y)}m`
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
    document.getElementById('continue-btn')?.addEventListener('click', () => this._startCallback?.())
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

  showWinScreen(falls, crowns) {
    const time = this.elapsed
    const ws = this._el.winScreen
    if (!ws) return
    ws.style.display = 'flex'
    if (this._el.winStats) {
      const mins = Math.floor(time / 60)
      const secs = Math.floor(time % 60).toString().padStart(2, '0')
      this._el.winStats.innerHTML = `
        Time: <strong>${mins}m ${secs}s</strong><br/>
        Falls survived: <strong>${falls}</strong><br/>
        Crowns: <strong>${crowns} / ${this.totalCrowns}</strong><br/><br/>
        <em style="color:#ffd700">2000 metres. No checkpoints. You actually did it.</em>
      `
    }
  }

  fillPauseStats(player, stats) {
    const el = this._el.pauseStats
    if (!el) return
    const t = this.elapsed
    const mins = Math.floor(t / 60)
    const totalH = Math.floor((stats.totalTime || 0) / 3600)
    const totalM = Math.floor(((stats.totalTime || 0) % 3600) / 60)
    el.innerHTML =
      `HEIGHT ${Math.floor(player.position.y)}m &nbsp;·&nbsp; BEST ${Math.floor(stats.bestY)}m &nbsp;·&nbsp; FALLS ${player.fallCount}<br/>` +
      `THIS RUN ${mins}min &nbsp;·&nbsp; LIFETIME ${totalH > 0 ? totalH + 'h ' : ''}${totalM}min · ${stats.totalFalls} FALLS`
  }

  showCrownCollected(num) {
    this.crownCount = num
    if (this._el.crownStat) this._el.crownStat.textContent = `👑 ${num} / ${this.totalCrowns}`

    const flash = this._el.checkpointFlash
    const text  = this._el.checkpointText
    if (!text) return

    text.textContent = '👑 CROWN!'

    this._anim(flash, [{ opacity: '1' }, { opacity: '0' }], { duration: 700, fill: 'forwards' })
    this._anim(text, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.5)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.2)', offset: 0.25 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.0)', offset: 0.55 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.85)' }
    ], { duration: 1600, fill: 'forwards' })
  }

  showFall(drop) {
    const pool = drop >= 150 ? HUGE_FALLS : drop >= 40 ? MID_FALLS : SMALL_FALLS
    const msg  = pool[Math.floor(Math.random() * pool.length)]

    const el = this._el.rageMsg
    if (el) {
      el.textContent = msg
      this._anim(el, [
        { opacity: '0', transform: 'translate(-50%,-50%) scale(0.4) rotate(-8deg)' },
        { opacity: '1', transform: 'translate(-50%,-50%) scale(1.12) rotate(2deg)', offset: 0.15 },
        { opacity: '1', transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0.55 },
        { opacity: '0', transform: 'translate(-50%,-50%) scale(0.88) rotate(-2deg)' }
      ], { duration: 2400, fill: 'forwards' })
    }

    // Rub it in with the exact metres lost
    const lh = this._el.lostHeight
    if (lh) {
      lh.textContent = `−${Math.round(drop)}m`
      this._anim(lh, [
        { opacity: '0', transform: 'translate(-50%,0) translateY(-10px)' },
        { opacity: '1', transform: 'translate(-50%,0) translateY(0)', offset: 0.2 },
        { opacity: '1', transform: 'translate(-50%,0) translateY(6px)', offset: 0.7 },
        { opacity: '0', transform: 'translate(-50%,0) translateY(24px)' }
      ], { duration: 2600, fill: 'forwards' })
    }
  }

  showNewBest() {
    const el = this._el.milestone
    if (!el) return
    el.textContent = '🌟 NEW PERSONAL BEST!'
    this._anim(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.4)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.35)', offset: 0.3 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.0)',  offset: 0.6 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.8)' }
    ], { duration: 2600, fill: 'forwards' })
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
    this.sound?.milestone()
    this._anim(el, [
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.4)' },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.35)', offset: 0.3 },
      { opacity: '1', transform: 'translate(-50%,-50%) scale(1.0)',  offset: 0.55 },
      { opacity: '0', transform: 'translate(-50%,-50%) scale(0.8)' }
    ], { duration: 2000, fill: 'forwards' })
  }

  showMuteState(muted) {
    const el = this._el.muteIndicator
    if (!el) return
    el.textContent = muted ? '🔇 MUTED' : '🔊 SOUND ON'
    this._anim(el, [
      { opacity: '1' }, { opacity: '1', offset: 0.7 }, { opacity: '0' }
    ], { duration: 1500, fill: 'forwards' })
  }

  updateCompass(targetPos, playerPos, cameraCtrl) {
    const el    = this._el.compassEl
    const arrow = this._el.compassArrow
    const dist  = this._el.compassDist
    if (!el || !targetPos) { if (el) el.style.opacity = '0'; return }

    el.style.opacity = '1'
    const angle = cameraCtrl.getScreenAngleTo(targetPos, playerPos)
    if (arrow) arrow.style.transform = `rotate(${angle}deg)`

    const d = playerPos.distanceTo(targetPos)
    if (dist) dist.textContent = d < 999 ? `${Math.round(d)}m` : ''
  }

  _anim(el, keyframes, options) {
    if (!el?.animate) return
    el.getAnimations().forEach(a => a.cancel())
    el.animate(keyframes, options)
  }

  update(dt, player, world, cameraCtrl) {
    const y   = Math.max(0, player.position.y)
    const pct = Math.min(100, (y / world.totalHeight) * 100)

    if (this._el.heightLabel)  this._el.heightLabel.textContent  = `${Math.floor(y)}m`
    if (this._el.heightFill)   this._el.heightFill.style.width   = `${pct}%`
    if (this._el.fallsStat)    this._el.fallsStat.textContent    = `💀 ${player.fallCount} falls`

    // PB tick on the height bar
    if (this._el.heightBest && this._bestHeight > 0) {
      const bp = Math.min(100, (this._bestHeight / world.totalHeight) * 100)
      this._el.heightBest.style.left = `${bp}%`
      this._el.heightBest.style.display = 'block'
    }

    const zi = world.getZoneForHeight(y)
    if (this._el.zoneName) this._el.zoneName.textContent = world.getZoneName(zi)

    // Timer
    if (this._timerStart !== null) {
      this._elapsed = this.elapsed
      const mins = Math.floor(this._elapsed / 60)
      const secs = Math.floor(this._elapsed % 60).toString().padStart(2, '0')
      if (this._el.timerEl) this._el.timerEl.textContent = `${mins}:${secs}`
    }

    // Speed indicator
    if (this._el.speedEl) {
      const speed = player.speed
      const kmh   = Math.round(speed * 3.6)
      this._el.speedEl.textContent = `${kmh} km/h`
      const t = Math.min(1, speed / 20)
      const r = Math.round(t > 0.5 ? 255 : t * 510)
      const g = Math.round(t < 0.5 ? 255 : (1 - t) * 510)
      this._el.speedEl.style.color = `rgb(${r},${g},80)`
    }

    // Compass → next crown above current height (guides re-climbs too)
    const guide = world.getGuideCrown(player.position.y)
    if (cameraCtrl && guide) {
      this._playerV3.set(player.position.x, player.position.y, player.position.z)
      this.updateCompass(guide.position, this._playerV3, cameraCtrl)
    } else if (this._el.compassEl) {
      this._el.compassEl.style.opacity = '0'
    }

    // Milestone triggers
    const ticks = [50,100,200,300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000]
    for (const m of ticks) {
      if (y >= m) this.showMilestone(m)
    }
  }

  onResize() {}
}

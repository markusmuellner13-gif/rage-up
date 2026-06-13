// Fully synthesized WebAudio sound — no asset files needed.
// Everything is generated from oscillators + filtered noise.
export class Sound {
  constructor() {
    this.ctx    = null
    this.muted  = localStorage.getItem('rageup-muted') === '1'
    this._master = null
    this._noise  = null   // shared 2s white-noise buffer
    this._windGain   = null
    this._windFilter = null
    this._whooshGain   = null
    this._whooshFilter = null
  }

  // Must be called from a user gesture (start button / first click)
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this._master = this.ctx.createGain()
    this._master.gain.value = this.muted ? 0 : 0.6
    this._master.connect(this.ctx.destination)

    // Shared noise buffer
    const len = this.ctx.sampleRate * 2
    this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = this._noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1

    this._buildAmbientWind()
    this._buildFallWhoosh()
  }

  toggleMute() {
    this.muted = !this.muted
    localStorage.setItem('rageup-muted', this.muted ? '1' : '0')
    if (this._master && this.ctx) {
      this._master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05)
    }
    return this.muted
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource()
    src.buffer = this._noise
    src.loop = true
    return src
  }

  // ── Continuous layers ──────────────────────────────────────────────────

  _buildAmbientWind() {
    const src = this._noiseSource()
    this._windFilter = this.ctx.createBiquadFilter()
    this._windFilter.type = 'lowpass'
    this._windFilter.frequency.value = 320
    this._windGain = this.ctx.createGain()
    this._windGain.gain.value = 0
    src.connect(this._windFilter).connect(this._windGain).connect(this._master)
    src.start()
  }

  // Altitude 0..1 — wind gets louder and brighter the higher you climb
  setAltitude(alt) {
    if (!this.ctx) return
    const a = Math.max(0, Math.min(1, alt))
    this._windGain.gain.setTargetAtTime(0.015 + a * 0.085, this.ctx.currentTime, 0.4)
    this._windFilter.frequency.setTargetAtTime(280 + a * 700, this.ctx.currentTime, 0.4)
  }

  _buildFallWhoosh() {
    const src = this._noiseSource()
    this._whooshFilter = this.ctx.createBiquadFilter()
    this._whooshFilter.type = 'bandpass'
    this._whooshFilter.frequency.value = 500
    this._whooshFilter.Q.value = 0.8
    this._whooshGain = this.ctx.createGain()
    this._whooshGain.gain.value = 0
    src.connect(this._whooshFilter).connect(this._whooshGain).connect(this._master)
    src.start()
  }

  // Called every frame with downward speed — screaming air rush during big falls
  setFallSpeed(downSpeed) {
    if (!this.ctx) return
    const t = Math.max(0, Math.min(1, (downSpeed - 14) / 30))
    this._whooshGain.gain.setTargetAtTime(t * 0.30, this.ctx.currentTime, 0.08)
    this._whooshFilter.frequency.setTargetAtTime(400 + t * 900, this.ctx.currentTime, 0.1)
  }

  // ── One-shots ──────────────────────────────────────────────────────────

  _osc(type, f0, f1, dur, vol, when = 0) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const osc = this.ctx.createOscillator()
    const g   = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(this._master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  _noiseBurst(filterType, freq, dur, vol, when = 0) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const src = this._noiseSource()
    src.loop = false
    const f = this.ctx.createBiquadFilter()
    f.type = filterType
    f.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this._master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  jump() {
    this._osc('square', 240, 460, 0.13, 0.08)
  }

  // impact 0..1
  land(impact) {
    const i = Math.max(0, Math.min(1, impact))
    this._noiseBurst('lowpass', 260 + i * 240, 0.12 + i * 0.1, 0.06 + i * 0.25)
    if (i > 0.35) this._osc('sine', 95, 38, 0.22, 0.10 + i * 0.22) // body thump
  }

  crown() {
    // Ascending sparkle arpeggio
    this._osc('triangle', 659, 659, 0.18, 0.14, 0)
    this._osc('triangle', 784, 784, 0.18, 0.14, 0.07)
    this._osc('triangle', 988, 988, 0.30, 0.16, 0.14)
    this._osc('sine', 1319, 1319, 0.40, 0.08, 0.21)
  }

  milestone() {
    this._osc('sine', 523, 523, 0.22, 0.12, 0)
    this._osc('sine', 784, 784, 0.35, 0.12, 0.10)
  }

  launch() {
    this._osc('sawtooth', 180, 880, 0.45, 0.12)
    this._noiseBurst('highpass', 900, 0.35, 0.10)
  }

  crack() {
    this._noiseBurst('highpass', 1200, 0.10, 0.18)
    this._osc('square', 160, 60, 0.18, 0.10, 0.02)
  }

  thunder() {
    this._noiseBurst('lowpass', 140, 1.4, 0.40)
    this._noiseBurst('lowpass', 90, 2.0, 0.25, 0.15)
  }

  // Big fall landed — deep mocking "wah"
  bigFall() {
    this._osc('sawtooth', 220, 110, 0.35, 0.10, 0)
    this._osc('sawtooth', 185, 92, 0.40, 0.10, 0.30)
    this._osc('sawtooth', 147, 73, 0.80, 0.12, 0.60)
  }

  win() {
    const notes = [523, 659, 784, 1047, 1319]
    notes.forEach((n, i) => this._osc('triangle', n, n, 0.5, 0.15, i * 0.13))
  }

  uiClick() {
    this._osc('sine', 600, 500, 0.07, 0.07)
  }
}

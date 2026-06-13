import { Game } from './game/Game.js'

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas')

  // Show "Continue" button if there's a saved position
  try {
    const saved = localStorage.getItem('rageup-save-v2')
    if (saved) {
      const btn = document.getElementById('continue-btn')
      if (btn) btn.style.display = 'block'
    }
  } catch (_) {}

  // Allow the loading screen one paint cycle, then build the world
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const game = new Game(canvas)
      window.gameRef = game

      // Hide loading, show start screen
      const loading = document.getElementById('loading-screen')
      if (loading) {
        loading.style.transition = 'opacity 0.4s'
        loading.style.opacity = '0'
        setTimeout(() => { loading.style.display = 'none' }, 400)
      }

      // Show platform legend for first 8 seconds
      const legend = document.getElementById('platform-legend')
      if (legend) {
        setTimeout(() => legend.classList.add('visible'), 600)
        setTimeout(() => {
          legend.style.transition = 'opacity 2s'
          legend.classList.remove('visible')
        }, 8600)
      }

      window.addEventListener('resize', () => game.onResize())
      game.start()
    })
  })
})

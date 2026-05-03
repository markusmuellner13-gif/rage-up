import { Game } from './game/Game.js'

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas')
  const game = new Game(canvas)
  window.addEventListener('resize', () => game.onResize())
  window.gameRef = game
  game.start()
})

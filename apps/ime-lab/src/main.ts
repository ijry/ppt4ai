import './style.css'
import { createImeLabController } from './ime-lab-controller'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('IME lab mount point is missing')
}

const canvas = document.createElement('canvas')
canvas.dataset.testid = 'ime-canvas'
canvas.width = 960
canvas.height = 540
canvas.setAttribute('aria-label', 'IME canvas')

window.__IME_LAB__ = createImeLabController({ canvas, host: app })

// Preload script for BrowserViews to mirror user input to main process.
// Runs in an isolated context with access to ipcRenderer.
// Captures mouse, wheel, and basic keyboard events with viewport-relative coords.

/* eslint-disable @typescript-eslint/no-var-requires */
const { ipcRenderer } = require('electron')

function send(type, payload) {
  try {
    ipcRenderer.send('mirror-input', { type, ...payload })
  } catch {}
}

// Normalize mouse button
function buttonName(btn) {
  switch (btn) {
    case 0: return 'left'
    case 1: return 'middle'
    case 2: return 'right'
    default: return 'left'
  }
}

// Mouse events
window.addEventListener('mousedown', (e) => {
  send('mouseDown', {
    x: Math.max(0, Math.floor(e.clientX)),
    y: Math.max(0, Math.floor(e.clientY)),
    button: buttonName(e.button),
    clickCount: e.detail || 1,
    modifiers: [
      e.altKey ? 'alt' : undefined,
      e.ctrlKey ? 'control' : undefined,
      e.shiftKey ? 'shift' : undefined,
      e.metaKey ? 'meta' : undefined,
    ].filter(Boolean),
  })
}, true)

window.addEventListener('mousemove', (e) => {
  send('mouseMove', {
    x: Math.max(0, Math.floor(e.clientX)),
    y: Math.max(0, Math.floor(e.clientY)),
    movementX: e.movementX || 0,
    movementY: e.movementY || 0,
    modifiers: [
      e.altKey ? 'alt' : undefined,
      e.ctrlKey ? 'control' : undefined,
      e.shiftKey ? 'shift' : undefined,
      e.metaKey ? 'meta' : undefined,
    ].filter(Boolean),
  })
}, true)

window.addEventListener('mouseup', (e) => {
  send('mouseUp', {
    x: Math.max(0, Math.floor(e.clientX)),
    y: Math.max(0, Math.floor(e.clientY)),
    button: buttonName(e.button),
    clickCount: e.detail || 1,
    modifiers: [
      e.altKey ? 'alt' : undefined,
      e.ctrlKey ? 'control' : undefined,
      e.shiftKey ? 'shift' : undefined,
      e.metaKey ? 'meta' : undefined,
    ].filter(Boolean),
  })
}, true)

// Wheel / scroll
window.addEventListener('wheel', (e) => {
  // Chromium provides deltas in pixels by default. Keep as-is.
  send('mouseWheel', {
    x: Math.max(0, Math.floor(e.clientX)),
    y: Math.max(0, Math.floor(e.clientY)),
    deltaX: e.deltaX || 0,
    deltaY: e.deltaY || 0,
    modifiers: [
      e.altKey ? 'alt' : undefined,
      e.ctrlKey ? 'control' : undefined,
      e.shiftKey ? 'shift' : undefined,
      e.metaKey ? 'meta' : undefined,
    ].filter(Boolean),
  })
}, { passive: true, capture: true })

// Basic keyboard mirroring
window.addEventListener('keydown', (e) => {
  // Avoid flooding repeated keydown events
  if (e.repeat) return
  send('keyDown', {
    keyCode: e.key,
    modifiers: [
      e.altKey ? 'alt' : undefined,
      e.ctrlKey ? 'control' : undefined,
      e.shiftKey ? 'shift' : undefined,
      e.metaKey ? 'meta' : undefined,
    ].filter(Boolean),
  })
}, true)

window.addEventListener('keyup', (e) => {
  send('keyUp', {
    keyCode: e.key,
    modifiers: [
      e.altKey ? 'alt' : undefined,
      e.ctrlKey ? 'control' : undefined,
      e.shiftKey ? 'shift' : undefined,
      e.metaKey ? 'meta' : undefined,
    ].filter(Boolean),
  })
}, true)

// Optionally capture text input events
window.addEventListener('keypress', (e) => {
  if (!e.key) return
  send('char', { keyCode: e.key })
}, true)


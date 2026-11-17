// Fullscreen API with the webkit prefixes still used by older Safari.
// requestFullscreen must be called directly from a click or tap. It returns a
// promise on current browsers and undefined on older webkit; both are normalized.
// iOS Safari rejects element fullscreen for ordinary elements. Callers keep a
// full-viewport layout when this rejects.

export function fullscreenElement() {
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || document.webkitCurrentFullScreenElement
    || null
}

export function requestFullscreen(el) {
  const node = el || document.documentElement
  const req = node.requestFullscreen || node.webkitRequestFullscreen || node.webkitRequestFullScreen
  if (typeof req !== 'function') return Promise.reject(new Error('fullscreen-unsupported'))
  try {
    const result = req.call(node)
    if (result && typeof result.then === 'function') return result
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function exitFullscreen() {
  if (!fullscreenElement()) return Promise.resolve()
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen
  if (typeof exit !== 'function') return Promise.reject(new Error('fullscreen-unsupported'))
  try {
    const result = exit.call(document)
    if (result && typeof result.then === 'function') return result
    return Promise.resolve()
  } catch (err) {
    return Promise.reject(err)
  }
}

export function bindFullscreenChange(handler) {
  document.addEventListener('fullscreenchange', handler)
  document.addEventListener('webkitfullscreenchange', handler)
  return () => {
    document.removeEventListener('fullscreenchange', handler)
    document.removeEventListener('webkitfullscreenchange', handler)
  }
}

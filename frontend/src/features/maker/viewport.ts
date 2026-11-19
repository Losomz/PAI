import {
  ACESFilmicToneMapping, Euler, MathUtils, OrthographicCamera, PerspectiveCamera, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js'
import { createStudio } from './studio'
import { addCard, canvasCentre, cardCentre, effectFoot, U, type Sheet } from './card'

export type CameraMode = 'orbit' | 'fly'
/** 2D looks straight at the effect, one source pixel to a whole number of screen pixels; 3D is free. */
export type ViewKind = '2d' | '3d'
export type ViewPreset = 'home' | 'top' | 'front' | 'side' | 'back'
export const initialFov = 40

export interface ViewportEvents {
  error(message: string): void
  zoom(zoom: number): void
  /** The frame on screen and whether it plays on; a one-shot effect stops on its last frame. */
  frame(frame: number, playing: boolean): void
}

function createRenderer() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (context) {
    try {
      const renderer = new WebGLRenderer({ canvas, context, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.toneMapping = ACESFilmicToneMapping
      return renderer
    } catch {
      context.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
  const renderer = new SVGRenderer()
  renderer.setPrecision(2)
  return renderer
}

const motionKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])
// Where the 3D camera looks from, round the middle of the effect.
const directions: Record<ViewPreset, Vector3> = {
  home: new Vector3(2.5, 1.35, 5.29).normalize(),
  front: new Vector3(0, 0, 1),
  side: new Vector3(1, 0, 0),
  back: new Vector3(1.48, 2.38, -4.88).normalize(),
  top: new Vector3(0, 1, 0.0002).normalize(),
}
/** 2D zoom steps, in device pixels per source pixel, so each source pixel stays a crisp block on any display. */
const zooms = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24]

export function mountViewport(host: HTMLDivElement, events: ViewportEvents) {
  const renderer = createRenderer()
  const webgl = renderer instanceof WebGLRenderer ? renderer : null
  const studio = createStudio(!!webgl)
  const camera = new PerspectiveCamera(initialFov, 1, 0.05, 160)
  // Square on to the effect, near enough that the fog leaves the floor alone.
  const flatCamera = new OrthographicCamera(-1, 1, 1, -1, 0.05, 40)
  const controls = new OrbitControls(camera, host)
  controls.minDistance = 0.6
  controls.maxDistance = 48
  controls.maxPolarAngle = Math.PI - 0.01
  controls.listenToKeyEvents(host)
  controls.enabled = false
  host.appendChild(renderer.domElement)
  const signal = new AbortController()
  const keys = new Set<string>()
  const direction = new Vector3(), right = new Vector3(), movement = new Vector3()
  const euler = new Euler(0, 0, 0, 'YXZ')
  let view: ViewKind = '2d', mode: CameraMode = 'orbit'
  let focusDistance = 9, pending = 0, lastTick = 0
  let dragId: number | null = null, lastX = 0, lastY = 0
  let viewChanged = true, refit = false
  // The 2D view: device pixels per source pixel, and the point in the middle of the view.
  let zoom = 3
  const middle = new Vector2(effectFoot.x, effectFoot.y + 34 * U)
  let sheet: Sheet | null = null
  let card: ReturnType<typeof addCard> | null = null
  // Playback: time played before the last start, and the frame last told to the page.
  let playing = true, playedMs = 0, startedAt = performance.now()
  let told = { frame: -1, playing: true }
  const ratio = () => webgl ? webgl.getPixelRatio() : 1
  // The effect's own canvas is what both cameras frame; light spilling past it may run out of view.
  const centre = () => sheet ? canvasCentre(sheet.spec) : effectFoot.clone().setY(effectFoot.y + 34 * U)
  const canvasSize = () => sheet?.spec.canvas.slice(2) ?? [96, 96]

  function frameAt(now: number) {
    if (!sheet) return 0
    const { fps, frames, loop } = sheet.spec
    const step = Math.floor((playedMs + (playing ? now - startedAt : 0)) * fps / 1000)
    if (loop) return step % frames
    if (playing && step >= frames - 1) {
      playedMs = (frames - 0.5) * 1000 / fps
      playing = false
    }
    return Math.min(step, frames - 1)
  }

  // Snap the 2D camera so every source pixel of the effect covers whole screen pixels.
  function placeFlatCamera() {
    const k = ratio(), width = Math.floor(host.clientWidth * k), height = Math.floor(host.clientHeight * k)
    const unit = U / zoom
    let x = middle.x, y = middle.y
    if (sheet) {
      const [w, h] = sheet.spec.frameSize, mid = cardCentre(sheet.spec)
      const left = mid.x - w * U / 2, top = mid.y + h * U / 2
      x = left - (Math.round((left - x) / unit + width / 2) - width / 2) * unit
      y = top + (Math.round((y - top) / unit + height / 2) - height / 2) * unit
    }
    Object.assign(flatCamera, { left: -width / 2 * unit, right: width / 2 * unit, top: height / 2 * unit,
      bottom: -height / 2 * unit })
    flatCamera.position.set(x, y, effectFoot.z + 8)
    flatCamera.updateProjectionMatrix()
  }
  /** The biggest whole zoom that keeps the effect in view, centred. */
  function fitFlat() {
    // Hidden, there is nothing to fit to yet.
    refit = !host.clientWidth || !host.clientHeight
    if (refit) return
    const [w, h] = canvasSize()
    const fit = Math.min(host.clientWidth * ratio() * 0.84 / w, host.clientHeight * ratio() * 0.84 / h)
    zoom = zooms.filter(step => step <= fit).pop() ?? 1
    const mid = centre()
    middle.set(mid.x, mid.y)
    events.zoom(zoom)
    invalidate()
  }
  function zoomFlat(step: number, atX = host.clientWidth / 2, atY = host.clientHeight / 2) {
    const index = zooms.indexOf(zoom), next = zooms[MathUtils.clamp(index + step, 0, zooms.length - 1)]
    if (next === zoom) return
    // Keep the source pixel under the cursor where it is.
    const dx = (atX - host.clientWidth / 2) * ratio(), dy = (atY - host.clientHeight / 2) * ratio()
    middle.x += dx * U / zoom - dx * U / next
    middle.y -= dy * U / zoom - dy * U / next
    zoom = next
    events.zoom(zoom)
    invalidate()
  }
  // Far enough for the whole card to fit the 3D view, whatever its size.
  function framingDistance() {
    const [w, h] = canvasSize()
    const half = Math.tan(MathUtils.degToRad(camera.fov) / 2)
    return Math.max(1.5, 1.1 * Math.max(h * U / 2 / half, w * U / 2 / (half * camera.aspect)))
  }
  function aim(from: Vector3) {
    controls.target.copy(centre())
    camera.position.copy(controls.target).addScaledVector(from, framingDistance())
    if (controls.enabled) controls.update()
    else camera.lookAt(controls.target)
    focusDistance = camera.position.distanceTo(controls.target)
    invalidate()
  }

  function requestDraw() {
    if (!pending) pending = requestAnimationFrame(draw)
  }
  function invalidate() {
    viewChanged = true
    requestDraw()
  }
  function draw(now: number) {
    pending = 0
    // Hidden behind the source code: it picks up again when it is resized back into view.
    if (!host.clientWidth || !host.clientHeight) return
    if (view === '3d' && mode === 'fly' && keys.size > 0) {
      const dt = Math.min((now - lastTick) / 1000, 0.05)
      lastTick = now
      camera.getWorldDirection(direction)
      right.crossVectors(direction, camera.up).normalize()
      movement.copy(direction).multiplyScalar(Number(keys.has('KeyW')) - Number(keys.has('KeyS')))
      movement.addScaledVector(right, Number(keys.has('KeyD')) - Number(keys.has('KeyA')))
      movement.y += Number(keys.has('KeyE')) - Number(keys.has('KeyQ'))
      camera.position.addScaledVector(movement.normalize(), 4.2 * dt)
      viewChanged = true
      requestDraw()
    }
    let changed = false
    if (card) {
      const frame = frameAt(now)
      changed = card.show(frame)
      if (frame !== told.frame || playing !== told.playing) {
        told = { frame, playing }
        events.frame(frame, playing)
      }
    }
    // The vector renderer shows the card's canvas itself, so a new frame needs no new render.
    if (viewChanged || (changed && webgl)) {
      if (view === '2d') placeFlatCamera()
      const active = view === '2d' ? flatCamera : camera
      if (viewChanged) card?.project?.(active, host.clientWidth, host.clientHeight)
      renderer.render(studio.scene, active)
      viewChanged = false
    }
    if (playing && card?.ready) requestDraw()
  }
  function stopInput() {
    keys.clear()
    if (dragId !== null && host.hasPointerCapture(dragId)) host.releasePointerCapture(dragId)
    dragId = null
  }
  function setView(preset: ViewPreset) {
    stopInput()
    aim(directions[preset])
  }
  function enableControls() {
    controls.enabled = view === '3d' && mode === 'orbit'
    if (controls.enabled) controls.update()
  }
  function setMode(next: CameraMode) {
    if (next !== mode) {
      stopInput()
      if (next === 'fly') focusDistance = camera.position.distanceTo(controls.target)
      else {
        camera.getWorldDirection(direction)
        controls.target.copy(camera.position).addScaledVector(direction, focusDistance)
      }
      mode = next
      enableControls()
      invalidate()
    }
    host.focus({ preventScroll: true })
  }
  host.addEventListener('pointerdown', e => {
    host.focus({ preventScroll: true })
    // 2D drags with any button; the fly camera turns with the left one; orbiting is OrbitControls'.
    if (dragId !== null || (view === '3d' && (mode !== 'fly' || e.button !== 0))) return
    dragId = e.pointerId
    lastX = e.clientX
    lastY = e.clientY
    host.setPointerCapture(dragId)
  }, { signal: signal.signal })
  host.addEventListener('pointermove', e => {
    if (e.pointerId !== dragId) return
    if (view === '2d') {
      middle.x -= (e.clientX - lastX) * ratio() * U / zoom
      middle.y += (e.clientY - lastY) * ratio() * U / zoom
    } else {
      euler.setFromQuaternion(camera.quaternion)
      euler.y -= (e.clientX - lastX) * 0.004
      euler.x = MathUtils.clamp(euler.x - (e.clientY - lastY) * 0.004, -Math.PI / 2 + 0.005, Math.PI / 2 - 0.005)
      camera.quaternion.setFromEuler(euler)
    }
    lastX = e.clientX
    lastY = e.clientY
    invalidate()
  }, { signal: signal.signal })
  host.addEventListener('lostpointercapture', e => {
    if (e.pointerId === dragId) dragId = null
  }, { signal: signal.signal })
  host.addEventListener('wheel', e => {
    if (view !== '2d') return
    e.preventDefault()
    const bounds = host.getBoundingClientRect()
    zoomFlat(e.deltaY < 0 ? 1 : -1, e.clientX - bounds.left, e.clientY - bounds.top)
  }, { signal: signal.signal, passive: false })
  host.addEventListener('contextmenu', e => { if (view === '2d') e.preventDefault() }, { signal: signal.signal })
  host.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (view === '2d') {
      const step = 24 * ratio() * U / zoom
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
      }
      if (pan[e.key]) {
        middle.x += pan[e.key][0]
        middle.y += pan[e.key][1]
        invalidate()
      } else if (e.key === '+' || e.key === '=') zoomFlat(1)
      else if (e.key === '-') zoomFlat(-1)
      else return
      e.preventDefault()
      return
    }
    if (mode !== 'fly' || !motionKeys.has(e.code)) return
    e.preventDefault()
    if (!keys.size) lastTick = performance.now()
    keys.add(e.code)
    invalidate()
  }, { signal: signal.signal })
  host.addEventListener('keyup', e => keys.delete(e.code), { signal: signal.signal })
  host.addEventListener('blur', stopInput, { signal: signal.signal })
  window.addEventListener('blur', stopInput, { signal: signal.signal })
  controls.addEventListener('change', invalidate)

  function resize() {
    const { clientWidth, clientHeight } = host
    if (!clientWidth || !clientHeight) return
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(clientWidth, clientHeight)
    if (refit) fitFlat()
    invalidate()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  renderer.domElement.addEventListener('webglcontextrestored', invalidate, { signal: signal.signal })
  resize()
  setView('home')
  events.zoom(zoom)

  return {
    setMode, setView,
    /** Switch between the 2D and 3D cameras; each keeps where it was. */
    setKind(next: ViewKind) {
      if (next === view) return
      stopInput()
      view = next
      enableControls()
      invalidate()
    },
    /** Frame the effect again: fit it whole in 2D, or from the default angle in 3D. */
    reset() {
      if (view === '2d') fitFlat()
      else setView('home')
    },
    zoomBy(step: number) { zoomFlat(step) },
    /**
     * Show an effect, or nothing. A different effect starts playing from its first frame, framed afresh in both
     * views (the 3D camera keeps its angle); a new rendering of the same one keeps the frame and the framing.
     */
    setSheet(next: Sheet | null, fresh: boolean) {
      card?.dispose()
      card = null
      sheet = next
      if (next) card = addCard(studio.scene, next, !!webgl, invalidate, events.error)
      told = { frame: -1, playing }
      if (fresh) {
        playedMs = 0
        startedAt = performance.now()
        playing = true
        fitFlat()
        if (mode === 'orbit') aim(camera.position.clone().sub(controls.target).normalize())
      }
      invalidate()
    },
    setPlaying(value: boolean) {
      if (value === playing) return
      const now = performance.now()
      if (playing) playedMs += now - startedAt
      else {
        startedAt = now
        // Playing a one-shot that has finished plays it again.
        if (sheet && !sheet.spec.loop && frameAt(now) === sheet.spec.frames - 1) playedMs = 0
      }
      playing = value
      requestDraw()
    },
    /** Hold on one frame. */
    seek(frame: number) {
      if (!sheet) return
      playing = false
      playedMs = (MathUtils.clamp(frame, 0, sheet.spec.frames - 1) + 0.5) * 1000 / sheet.spec.fps
      requestDraw()
    },
    setDark(value: boolean) { studio.setDark(value); invalidate() },
    setFov(value: number) {
      camera.fov = value
      camera.updateProjectionMatrix()
      invalidate()
    },
    setGrid(visible: boolean) { studio.setGrid(visible); invalidate() },
    hasFloor: studio.hasFloor,
    setFloor(visible: boolean) { studio.setFloor(visible); invalidate() },
    dispose() {
      signal.abort()
      stopInput()
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      cancelAnimationFrame(pending)
      card?.dispose()
      studio.dispose()
      webgl?.dispose()
      webgl?.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}

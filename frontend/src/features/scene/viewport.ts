import {
  ACESFilmicToneMapping, Euler, Group, MathUtils, OrthographicCamera, PCFShadowMap, PerspectiveCamera, Vector2, Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js'
import { createStudio } from './studio'
import { addFlat, cardCentre, effectFoot } from './flat'
import { U, type Volume } from './effects/kit'
import type { SceneEffect, Sheet } from './effects/registry'

export type CameraMode = 'orbit' | 'fly'
/** 2D looks straight at the original, one source pixel to a whole number of screen pixels; 3D is free. */
export type ViewKind = '2d' | '3d'
export type ViewPreset = 'home' | 'top' | 'front' | 'side' | 'back'
export type EffectVersion = 'volume' | 'flat'
/** What the scene shows: an original as a sprite sheet, and its hand-made 3D version if it has one. */
export interface Subject { sheet: Sheet; effect: SceneEffect | null }
export const initialFov = 40

function createRenderer() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (context) {
    try {
      const renderer = new WebGLRenderer({ canvas, context, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = PCFShadowMap
      renderer.shadowMap.autoUpdate = false
      renderer.shadowMap.needsUpdate = true
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
// Close enough that the effect fills most of the view, with room for the tallest one.
const offsets: Record<ViewPreset, Vector3> = {
  home: new Vector3(2.5, 1.35, 5.29),
  front: new Vector3(0, 0, 5.6),
  side: new Vector3(5.6, 0, 0),
  back: new Vector3(1.48, 2.38, -4.88),
  top: new Vector3(0, 5.6, 0.001),
}
/** 2D zoom steps, in device pixels per source pixel, so each source pixel stays a crisp block on any display. */
const zooms = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24]

export function mountViewport(host: HTMLDivElement, onError: (message: string) => void, onZoom: (zoom: number) => void) {
  const renderer = createRenderer()
  const webgl = renderer instanceof WebGLRenderer ? renderer : null
  const studio = createStudio(!!webgl)
  const camera = new PerspectiveCamera(initialFov, 1, 0.05, 160)
  // Square on to the effects, near enough that the fog leaves them alone.
  const flatCamera = new OrthographicCamera(-1, 1, 1, -1, 0.05, 40)
  const controls = new OrbitControls(camera, host)
  controls.minDistance = 0.6
  controls.maxDistance = 48
  controls.maxPolarAngle = Math.PI - 0.01
  controls.listenToKeyEvents(host)
  controls.enabled = false
  host.appendChild(renderer.domElement)
  const events = new AbortController()
  const keys = new Set<string>()
  const direction = new Vector3(), right = new Vector3(), movement = new Vector3()
  const euler = new Euler(0, 0, 0, 'YXZ')
  let view: ViewKind = '2d', mode: CameraMode = 'orbit'
  let focusDistance = 9, frame = 0, lastTick = 0
  let dragId: number | null = null, lastX = 0, lastY = 0
  let viewChanged = true, playing = true, playedMs = 0, startedAt = performance.now()
  // The 2D view: device pixels per source pixel, and the point in the middle of the view.
  let zoom = 3
  const middle = new Vector2(effectFoot.x, effectFoot.y + 34 * U)
  // Effects stand at the same pivot. The 3D camera centres on each one's focus height above it.
  const stand = new Group()
  stand.position.copy(effectFoot)
  studio.scene.add(stand)
  let subject: Subject | null = null, version: EffectVersion = 'flat'
  let volume: Volume | null = null
  let flat: ReturnType<typeof addFlat> | null = null
  let floorShown = true
  // An effect's light on the floor shows only with the floor (and only with WebGL, like the floor itself).
  const lightFloor = () => volume?.root.traverse(part => {
    if (part.userData.floorLight) part.visible = !!webgl && floorShown
  })
  // A 3D version says where to look; an original alone is looked at in its middle.
  function focusPixels() {
    if (subject?.effect) return subject.effect.focus
    if (subject) return subject.sheet.spec.pivot[1] - subject.sheet.spec.frameSize[1] / 2
    return 34
  }
  const focusPoint = () => stand.position.clone().setY(stand.position.y + focusPixels() * U)
  function refreshShadows() {
    if (webgl) webgl.shadowMap.needsUpdate = true
  }
  const ratio = () => webgl ? webgl.getPixelRatio() : 1

  // Snap the 2D camera so every source pixel of the original covers whole screen pixels.
  function placeFlatCamera() {
    const k = ratio(), width = Math.floor(host.clientWidth * k), height = Math.floor(host.clientHeight * k)
    const unit = U / zoom
    let x = middle.x, y = middle.y
    if (subject) {
      const [w, h] = subject.sheet.spec.frameSize, centre = cardCentre(subject.sheet.spec)
      const left = centre.x - w * U / 2, top = centre.y + h * U / 2
      x = left - (Math.round((left - x) / unit + width / 2) - width / 2) * unit
      y = top + (Math.round((y - top) / unit + height / 2) - height / 2) * unit
    }
    Object.assign(flatCamera, { left: -width / 2 * unit, right: width / 2 * unit, top: height / 2 * unit,
      bottom: -height / 2 * unit })
    flatCamera.position.set(x, y, effectFoot.z + 8)
    flatCamera.updateProjectionMatrix()
  }
  /** The biggest whole zoom that keeps the original in view, centred. */
  function fitFlat() {
    const spec = subject?.sheet.spec
    const [w, h] = spec?.frameSize.map(size => size - 2 * (spec.margin ?? 0)) ?? [96, 96]
    const fit =Math.min(host.clientWidth * ratio() * 0.84 / w, host.clientHeight * ratio() * 0.84 / h)
    zoom = zooms.filter(step => step <= fit).pop() ?? 1
    const centre = spec ? cardCentre(spec) : focusPoint()
    middle.set(centre.x, centre.y)
    onZoom(zoom)
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
    onZoom(zoom)
    invalidate()
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw)
  }
  function invalidate() {
    viewChanged = true
    requestDraw()
  }
  function draw(now: number) {
    frame = 0
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
    const elapsed = playedMs + (playing ? Math.max(0, now - startedAt) : 0)
    const newFrame = flat ? flat.update(elapsed) : volume ? volume.update(elapsed) : false
    if (viewChanged || (newFrame && (!flat || webgl))) {
      if (view === '2d') placeFlatCamera()
      const active = view === '2d' ? flatCamera : camera
      if (viewChanged) flat?.project?.(active, host.clientWidth, host.clientHeight)
      renderer.render(studio.scene, active)
      viewChanged = false
    }
    if (playing && (flat ? flat.ready : volume)) requestDraw()
  }
  // Show the 3D version, or the original card when that is asked for or there is no 3D version.
  function arrange() {
    const card = !!subject && (version === 'flat' || !volume)
    if (card && !flat && subject) flat = addFlat(studio.scene, subject.sheet, !!webgl, invalidate, onError)
    if (!card && flat) {
      flat.dispose()
      flat = null
    }
    if (volume) volume.root.visible = !card
    refreshShadows()
    invalidate()
  }
  function stopInput() {
    keys.clear()
    if (dragId !== null && host.hasPointerCapture(dragId)) host.releasePointerCapture(dragId)
    dragId = null
  }
  function setView(preset: ViewPreset) {
    stopInput()
    controls.target.copy(focusPoint())
    camera.position.copy(controls.target).addScaledVector(offsets[preset], Math.max(1, 1.25 / camera.aspect))
    if (controls.enabled) controls.update()
    else camera.lookAt(controls.target)
    focusDistance = camera.position.distanceTo(controls.target)
    invalidate()
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
  }, { signal: events.signal })
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
  }, { signal: events.signal })
  host.addEventListener('lostpointercapture', e => {
    if (e.pointerId === dragId) dragId = null
  }, { signal: events.signal })
  host.addEventListener('wheel', e => {
    if (view !== '2d') return
    e.preventDefault()
    const bounds = host.getBoundingClientRect()
    zoomFlat(e.deltaY < 0 ? 1 : -1, e.clientX - bounds.left, e.clientY - bounds.top)
  }, { signal: events.signal, passive: false })
  host.addEventListener('contextmenu', e => { if (view === '2d') e.preventDefault() }, { signal: events.signal })
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
  }, { signal: events.signal })
  host.addEventListener('keyup', e => keys.delete(e.code), { signal: events.signal })
  host.addEventListener('blur', stopInput, { signal: events.signal })
  window.addEventListener('blur', stopInput, { signal: events.signal })
  controls.addEventListener('change', invalidate)

  function resize() {
    const { clientWidth, clientHeight } = host
    if (!clientWidth || !clientHeight) return
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(clientWidth, clientHeight)
    invalidate()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  renderer.domElement.addEventListener('webglcontextrestored', invalidate, { signal: events.signal })
  resize()
  setView('home')
  onZoom(zoom)

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
    /** Show another effect, keeping the time, the 3D camera's framing and fitting it in 2D. */
    setSubject(next: Subject, nextVersion: EffectVersion) {
      const before = focusPoint().y
      flat?.dispose()
      flat = null
      volume?.dispose()
      volume = null
      subject = next
      version = nextVersion
      if (next.effect) {
        volume = next.effect.create(!!webgl)
        stand.add(volume.root)
        lightFloor()
      }
      arrange()
      const rise = focusPoint().y - before
      camera.position.y += rise
      controls.target.y += rise
      if (controls.enabled) controls.update()
      fitFlat()
    },
    setVersion(next: EffectVersion) {
      version = next
      arrange()
    },
    setDark(value: boolean) { studio.setDark(value); invalidate() },
    setPlaying(value: boolean) {
      if (value === playing) return
      const now = performance.now()
      if (playing) playedMs += now - startedAt
      else startedAt = now
      playing = value
      requestDraw()
    },
    setFov(value: number) {
      camera.fov = value
      camera.updateProjectionMatrix()
      invalidate()
    },
    setGrid(visible: boolean) { studio.setGrid(visible); invalidate() },
    hasFloor: studio.hasFloor,
    setFloor(visible: boolean) {
      floorShown = visible
      studio.setFloor(visible)
      lightFloor()
      invalidate()
    },
    dispose() {
      events.abort()
      stopInput()
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      cancelAnimationFrame(frame)
      flat?.dispose()
      volume?.dispose()
      studio.dispose()
      webgl?.dispose()
      webgl?.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}

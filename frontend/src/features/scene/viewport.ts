import {
  ACESFilmicToneMapping, Euler, Group, MathUtils, PCFShadowMap, PerspectiveCamera, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js'
import { createStudio } from './studio'
import { addFlat, effectFoot } from './flat'
import { U } from './effects/kit'
import { sceneEffects } from './effects/registry'

export type CameraMode = 'orbit' | 'fly'
export type ViewPreset = 'home' | 'top' | 'front' | 'side' | 'back'
export type EffectVersion = 'volume' | 'flat'
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

export function mountViewport(host: HTMLDivElement, onError: (message: string) => void) {
  const renderer = createRenderer()
  const webgl = renderer instanceof WebGLRenderer ? renderer : null
  const studio = createStudio(!!webgl)
  const camera = new PerspectiveCamera(initialFov, 1, 0.05, 160)
  const controls = new OrbitControls(camera, host)
  controls.minDistance = 0.6
  controls.maxDistance = 48
  controls.maxPolarAngle = Math.PI - 0.01
  controls.listenToKeyEvents(host)
  host.appendChild(renderer.domElement)
  const events = new AbortController()
  const keys = new Set<string>()
  const direction = new Vector3(), right = new Vector3(), movement = new Vector3()
  const euler = new Euler(0, 0, 0, 'YXZ')
  let mode: CameraMode = 'orbit'
  let focusDistance = 9, frame = 0, lastTick = 0
  let dragId: number | null = null, lastX = 0, lastY = 0
  let viewChanged = true, playing = true, playedMs = 0, startedAt = performance.now()
  // Effects stand at the same pivot. The camera centres on each one's focus height above it.
  const stand = new Group()
  stand.position.copy(effectFoot)
  studio.scene.add(stand)
  let effect = sceneEffects[0]
  let volume = effect.create(!!webgl)
  stand.add(volume.root)
  let flat: ReturnType<typeof addFlat> | null = null
  let floorShown = true
  // An effect's light on the floor shows only with the floor (and only with WebGL, like the floor itself).
  const lightFloor = () => volume.root.traverse(part => {
    if (part.userData.floorLight) part.visible = !!webgl && floorShown
  })
  const focusPoint = () => stand.position.clone().setY(stand.position.y + effect.focus * U)
  const showFlat = () => addFlat(studio.scene, effect.sheet, !!webgl, invalidate, onError)
  function refreshShadows() {
    if (webgl) webgl.shadowMap.needsUpdate = true
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
    if (mode === 'fly' && keys.size > 0) {
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
    const newFrame = flat ? flat.update(elapsed) : volume.update(elapsed)
    if (viewChanged || (newFrame && (!flat || webgl))) {
      if (viewChanged) flat?.project?.(camera, host.clientWidth, host.clientHeight)
      renderer.render(studio.scene, camera)
      viewChanged = false
    }
    if (playing && (!flat || flat.ready)) requestDraw()
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
    controls.update()
    focusDistance = camera.position.distanceTo(controls.target)
    invalidate()
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
      controls.enabled = mode === 'orbit'
      if (controls.enabled) controls.update()
      invalidate()
    }
    host.focus({ preventScroll: true })
  }
  host.addEventListener('pointerdown', e => {
    host.focus({ preventScroll: true })
    if (mode !== 'fly' || e.button !== 0 || dragId !== null) return
    dragId = e.pointerId
    lastX = e.clientX
    lastY = e.clientY
    host.setPointerCapture(dragId)
  }, { signal: events.signal })
  host.addEventListener('pointermove', e => {
    if (e.pointerId !== dragId) return
    euler.setFromQuaternion(camera.quaternion)
    euler.y -= (e.clientX - lastX) * 0.004
    euler.x = MathUtils.clamp(euler.x - (e.clientY - lastY) * 0.004, -Math.PI / 2 + 0.005, Math.PI / 2 - 0.005)
    camera.quaternion.setFromEuler(euler)
    lastX = e.clientX
    lastY = e.clientY
    invalidate()
  }, { signal: events.signal })
  host.addEventListener('lostpointercapture', e => {
    if (e.pointerId === dragId) dragId = null
  }, { signal: events.signal })
  host.addEventListener('keydown', e => {
    if (mode !== 'fly' || e.ctrlKey || e.metaKey || e.altKey || !motionKeys.has(e.code)) return
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

  return {
    setMode, setView,
    setVersion(next: EffectVersion) {
      if (next === 'flat' && !flat) {
        flat = showFlat()
        volume.root.visible = false
      } else if (next === 'volume' && flat) {
        flat.dispose()
        flat = null
        volume.root.visible = true
      }
      refreshShadows()
      invalidate()
    },
    /** Swap the effect in place, keeping the version shown, the time and the camera's framing. */
    setEffect(key: string) {
      const next = sceneEffects.find(item => item.key === key)
      if (!next || next === effect) return
      const before = focusPoint().y
      volume.dispose()
      effect = next
      volume = effect.create(!!webgl)
      stand.add(volume.root)
      lightFloor()
      if (flat) {
        flat.dispose()
        flat = showFlat()
        volume.root.visible = false
      }
      const rise = focusPoint().y - before
      camera.position.y += rise
      controls.target.y += rise
      if (controls.enabled) controls.update()
      refreshShadows()
      invalidate()
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
      volume.dispose()
      studio.dispose()
      webgl?.dispose()
      webgl?.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}

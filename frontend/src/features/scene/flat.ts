import {
  CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, NearestFilter, PerspectiveCamera,
  PlaneGeometry, Scene, SRGBColorSpace, Vector3,
} from 'three'
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { SVGObject } from 'three/addons/renderers/SVGRenderer.js'
import { U } from './effects/kit'
import type { Sheet } from './effects/registry'

// Where every effect stands: its pivot, on the floor beside the reference objects.
export const effectFoot = new Vector3(2.75, 0.045, 1.8)

// SVGRenderer does not texture meshes. Depth-sort an HTML canvas alongside its geometry
// and use the same perspective camera to project the canvas in software-rendered scenes.
function addSoftwarePlane(scene: Scene, canvas: HTMLCanvasElement, center: Vector3) {
  const projector = new CSS3DRenderer()
  const ns = 'http://www.w3.org/2000/svg'
  const layer = document.createElementNS(ns, 'foreignObject')
  const group = document.createElementNS(ns, 'g')
  group.appendChild(layer)
  layer.appendChild(projector.domElement)
  const anchor = new SVGObject(group)
  anchor.position.copy(center)
  const plane = new CSS3DObject(canvas)
  plane.position.copy(center)
  plane.scale.setScalar(U)
  canvas.style.imageRendering = 'pixelated'
  canvas.style.pointerEvents = 'none'
  scene.add(anchor, plane)
  const projected = new Vector3()
  return {
    project(camera: PerspectiveCamera, w: number, h: number) {
      projector.setSize(w, h)
      projector.render(scene, camera)
      projected.copy(center).project(camera)
      layer.setAttribute('x', String(-(1 + projected.x) * w / 2))
      layer.setAttribute('y', String(-(1 - projected.y) * h / 2))
      layer.setAttribute('width', String(w))
      layer.setAttribute('height', String(h))
    },
    dispose() { scene.remove(anchor, plane); group.remove() },
  }
}

/** The original effect as a flat card standing at its pivot, playing its baked sprite sheet. */
export function addFlat(scene: Scene, sheet: Sheet, hardware: boolean, onLoad: () => void, onError: (message: string) => void) {
  const { spec } = sheet, [width, height] = spec.frameSize
  const center = effectFoot.clone().add(new Vector3(
    (width / 2 - spec.pivot[0]) * U, (spec.pivot[1] - height / 2) * U, 0,
  ))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw Error('无法读取特效动画帧')
  const texture = hardware ? new CanvasTexture(canvas) : null
  let mesh: Mesh<PlaneGeometry, MeshBasicMaterial> | undefined
  if (texture) {
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = texture.minFilter = NearestFilter
    texture.generateMipmaps = false
    const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: true,
      depthWrite: false, toneMapped: false, fog: false })
    mesh = new Mesh(new PlaneGeometry(width * U, height * U), material)
    mesh.position.copy(center)
    scene.add(mesh)
  }
  const software = hardware ? null : addSoftwarePlane(scene, canvas, center)
  const image = new Image()
  let ready = false, lastFrame = -1
  image.onload = () => { ready = true; onLoad() }
  image.onerror = () => onError('无法加载特效精灵图')
  image.src = sheet.url
  return {
    project: software?.project,
    get ready() { return ready },
    update(elapsed: number) {
      const frame = Math.floor(elapsed * spec.fps / 1000) % spec.frames
      if (!ready || frame === lastFrame) return false
      const x = (frame % spec.columns) * width, y = Math.floor(frame / spec.columns) * height
      context.clearRect(0, 0, width, height)
      context.drawImage(image, x, y, width, height, 0, 0, width, height)
      if (texture) texture.needsUpdate = true
      lastFrame = frame
      return true
    },
    dispose() {
      image.onload = image.onerror = null
      if (mesh) { scene.remove(mesh); mesh.material.dispose(); mesh.geometry.dispose() }
      texture?.dispose()
      software?.dispose()
    },
  }
}

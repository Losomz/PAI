import {
  type Camera, CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, NearestFilter,
  PlaneGeometry, Scene, SRGBColorSpace, Vector3,
} from 'three'
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { SVGObject } from 'three/addons/renderers/SVGRenderer.js'

/** Scene units per source pixel. Anything built in 3D next to an effect uses the same scale. */
export const U = 0.04
// Where every effect stands: its pivot, in the middle of the floor.
export const effectFoot = new Vector3(0, 0.045, 0)

/**
 * An effect rendered to a sprite sheet. The pivot is where it stands on the floor, and the canvas [left, top, width,
 * height] is the part it is drawn for, both in frame pixels; frames may have room round the canvas for spilt light.
 */
export interface Sheet {
  url: string
  spec: { fps: number; frames: number; frameSize: number[]; pivot: number[]; canvas: number[]; columns: number; loop: boolean }
}

// SVGRenderer does not texture meshes. Depth-sort an HTML canvas alongside its geometry
// and use the same camera to project the canvas in software-rendered scenes.
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
    project(camera: Camera, w: number, h: number) {
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

/** Where a pixel of an effect's frame is in the scene: the card stands with its pivot on the effects' foot. */
export function pixelAt(spec: Sheet['spec'], x: number, y: number) {
  return effectFoot.clone().add(new Vector3((x - spec.pivot[0]) * U, (spec.pivot[1] - y) * U, 0))
}
export const cardCentre = (spec: Sheet['spec']) => pixelAt(spec, spec.frameSize[0] / 2, spec.frameSize[1] / 2)
/** The middle of the effect's own canvas, which the cameras frame. */
export function canvasCentre(spec: Sheet['spec']) {
  const [left, top, width, height] = spec.canvas
  return pixelAt(spec, left + width / 2, top + height / 2)
}

/** The effect as a flat card standing at its pivot, showing one frame of its sprite sheet at a time. */
export function addCard(scene: Scene, sheet: Sheet, hardware: boolean, onLoad: () => void, onError: (message: string) => void) {
  const { spec } = sheet, [width, height] = spec.frameSize
  const center = cardCentre(spec)
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
  let ready = false, shown = -1
  image.onload = () => { ready = true; onLoad() }
  image.onerror = () => onError('无法加载特效精灵图')
  image.src = sheet.url
  return {
    project: software?.project,
    get ready() { return ready },
    /** Draw the given frame. Returns whether the picture changed. */
    show(frame: number) {
      if (!ready || frame === shown) return false
      const x = (frame % spec.columns) * width, y = Math.floor(frame / spec.columns) * height
      context.clearRect(0, 0, width, height)
      context.drawImage(image, x, y, width, height, 0, 0, width, height)
      if (texture) texture.needsUpdate = true
      shown = frame
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

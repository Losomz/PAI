import {
  CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, NearestFilter, PerspectiveCamera,
  PlaneGeometry, Scene, SRGBColorSpace, Vector3,
} from 'three'
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { SVGObject } from 'three/addons/renderers/SVGRenderer.js'
import atlasUrl from './effects/portal/portal.png'
import spec from './effects/portal/portal.json'

const [width, height] = spec.frameSize
const unitsPerPixel = 0.04
export const portalFoot = new Vector3(2.75, 0.045, 1.8)
const center = portalFoot.clone().add(new Vector3(
  (width / 2 - spec.pivot[0]) * unitsPerPixel, (spec.pivot[1] - height / 2) * unitsPerPixel, 0,
))

// SVGRenderer does not texture meshes. Depth-sort an HTML canvas alongside its geometry
// and use the same perspective camera to project the canvas in software-rendered scenes.
function addSoftwarePlane(scene: Scene, canvas: HTMLCanvasElement) {
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
  plane.scale.setScalar(unitsPerPixel)
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

export function addPortal(scene: Scene, hardware: boolean, onLoad: () => void, onError: (message: string) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw Error('无法读取传送门动画帧')
  const texture = hardware ? new CanvasTexture(canvas) : null
  let mesh: Mesh<PlaneGeometry, MeshBasicMaterial> | undefined
  if (texture) {
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = texture.minFilter = NearestFilter
    texture.generateMipmaps = false
    const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: true,
      depthWrite: false, toneMapped: false, fog: false })
    mesh = new Mesh(new PlaneGeometry(width * unitsPerPixel, height * unitsPerPixel), material)
    mesh.position.copy(center)
    scene.add(mesh)
  }
  const software = hardware ? null : addSoftwarePlane(scene, canvas)
  const image = new Image()
  let ready = false, lastFrame = -1
  image.onload = () => { ready = true; onLoad() }
  image.onerror = () => onError('无法加载传送门精灵图')
  image.src = atlasUrl
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

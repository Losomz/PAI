import {
  CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  OctahedronGeometry, PointLight, Vector3,
} from 'three'
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js'

// A spatial interpretation of PixelFX arcane/portal. The aperture lies in XY and opens toward +Z.
const tau = 2 * Math.PI
const radiusX = 0.68, radiusY = 1.16, length = 1.55, logDepth = 2.6
const palette = ['#140a26', '#2b1252', '#481c88', '#6b2cc0', '#9a48ec', '#c684ff', '#ecc8ff', '#ffffff']
  .map(hex => new Color(hex))

function rimRadius(angle: number) {
  return 1 + 0.028 * Math.sin(3 * angle) + 0.014 * Math.sin(7 * angle + 0.8)
}

function rimZ(angle: number) {
  return 0.045 * Math.sin(2 * angle + 0.3) + 0.018 * Math.cos(5 * angle)
}

export function createPortal3D(detailed: boolean) {
  const root = new Group()
  root.name = 'Arcane portal 3D'
  const aperture = new Group(), spiral = new Group()
  aperture.scale.set(radiusX, radiusY, 1)
  aperture.add(spiral)
  root.add(aperture)

  const ink = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false })
  const surfaces: ParametricGeometry[] = []
  function surface(slices: number, rows: number, point: (u: number, v: number, out: Vector3) => void,
    shade: (u: number, v: number) => number) {
    const geometry = new ParametricGeometry(point, slices, rows)
    const uv = geometry.getAttribute('uv'), colors = new Float32Array(uv.count * 3)
    for (let i = 0; i < uv.count; i++) {
      const tone = Math.max(0, Math.min(7, Math.round(shade(uv.getX(i), uv.getY(i)))))
      palette[tone].toArray(colors, i * 3)
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    surfaces.push(geometry)
    spiral.add(new Mesh(geometry, ink))
  }

  // In the source image z = -log(radius). Invert it to give each cross-section a real depth.
  const sides = detailed ? 96 : 48
  surface(sides, detailed ? 38 : 22, (u, v, out) => {
    const angle = u * tau, radius = Math.exp(-logDepth * v) * rimRadius(angle)
    out.set(radius * Math.cos(angle), radius * Math.sin(angle), -length * v + (1 - v) * rimZ(angle))
  }, (u, v) => {
    const z = logDepth * v, radius = Math.exp(-z), phase = 3 * tau * u + 6.5 * z
    const arm = (0.5 + 0.5 * Math.cos(phase)) ** 10
    const strand = (0.5 + 0.5 * Math.cos(phase + Math.PI + 0.6 * z)) ** 15
    const bands = (0.5 + 0.5 * Math.cos(tau * 1.5 * z)) ** 9
    return 0.25 + 1.8 * radius + radius ** 0.8 * (5 * arm + 1.9 * strand + bands)
  })

  // A rounded, rippling lip has an edge even when seen directly from the side.
  surface(sides, 8, (u, v, out) => {
    const angle = u * tau, cross = v * tau, radius = rimRadius(angle) + 0.058 * Math.cos(cross)
    out.set(radius * Math.cos(angle), radius * Math.sin(angle), rimZ(angle) + 0.083 * Math.sin(cross))
  }, (u, v) => {
    const highlight = (0.5 + 0.5 * Math.cos(2 * tau * u - 0.6)) ** 4
    return 3.1 + 1.9 * (0.5 + 0.5 * Math.sin(tau * v)) + 2.3 * highlight
  })

  // Three separate ribbons wind around the throat and stand out from its silhouette.
  for (let arm = 0; arm < 3; arm++) {
    surface(detailed ? 70 : 36, 1, (u, v, out) => {
      const z = u * logDepth, width = 0.08 * Math.sin(Math.PI * u)
      const angle = arm * tau / 3 - 6.5 * z / 3 + (v - 0.5) * width
      const radius = Math.exp(-z) * (1.13 + 0.11 * Math.sin(tau * u + arm))
      out.set(radius * Math.cos(angle), radius * Math.sin(angle), 0.18 * (1 - u) - length * u)
    }, u => 2.4 + 3.9 * (1 - u) * (0.79 + 0.21 * Math.cos(2 * tau * u + arm)))
  }

  const capGeometry = new CircleGeometry(Math.exp(-logDepth) * 1.06, sides)
  const capMaterial = new MeshBasicMaterial({ color: palette[0], side: DoubleSide, toneMapped: false })
  const cap = new Mesh(capGeometry, capMaterial)
  cap.position.z = -length
  spiral.add(cap)

  const sparkGeometry = new OctahedronGeometry(1)
  const sparkMaterials = [4, 5, 6, 7].map(i => new MeshBasicMaterial({ color: palette[i], toneMapped: false }))
  const sparkCount = detailed ? 42 : 24
  const sparks = Array.from({ length: sparkCount }, (_, i) => {
    const mesh = new Mesh(sparkGeometry, sparkMaterials[i % sparkMaterials.length])
    root.add(mesh)
    return { mesh, offset: (i + 0.5) / sparkCount, angle: i * 2.39996, spread: 1.15 + 0.38 * Math.sin(i * 17.1) ** 2 }
  })
  const spill = new PointLight('#b377ff', 2.2, 3.8)
  spill.position.set(0, -0.72, 0.28)
  root.add(spill)

  let lastFrame = -1
  return {
    root,
    update(elapsedMs: number) {
      const frame = Math.floor(elapsedMs * 30 / 1000) % 72
      if (frame === lastFrame) return false
      lastFrame = frame
      const phase = frame / 72
      spiral.rotation.z = phase * tau
      for (const { mesh, offset, angle, spread } of sparks) {
        const t = (phase + offset) % 1, theta = angle + tau * (0.35 * t + 0.8 * t * t)
        const r = spread * Math.exp(-2.3 * t * t)
        mesh.position.set(radiusX * r * Math.cos(theta), radiusY * r * Math.sin(theta),
          0.72 * (1 - t) - length * t * t + 0.17 * Math.sin(theta) * (1 - t))
        const size = (0.026 + 0.022 * offset) * Math.sin(Math.PI * t) ** 0.45
        mesh.scale.set(size, size * 1.7, size)
        mesh.rotation.set(theta * 0.65, theta, theta + 0.5)
      }
      spill.intensity = 2.2 + 0.45 * Math.sin(2 * tau * phase)
      return true
    },
    dispose() {
      root.removeFromParent()
      for (const geometry of surfaces) geometry.dispose()
      ink.dispose()
      capGeometry.dispose()
      capMaterial.dispose()
      sparkGeometry.dispose()
      for (const material of sparkMaterials) material.dispose()
      spill.dispose()
    },
  }
}

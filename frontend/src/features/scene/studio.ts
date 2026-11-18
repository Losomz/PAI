import {
  AmbientLight, BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight,
  Fog, GridHelper, IcosahedronGeometry, LatheGeometry, Material, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Scene, Vector2,
} from 'three'

// Static reference objects for comparing silhouettes, depth and foreshortening.
export function createStudio(hardware: boolean) {
  const scene = new Scene()
  scene.background = new Color('#e2eae7')
  scene.fog = new Fog('#e2eae7', 13, 34)
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []

  function solid(geometry: BufferGeometry, color: string, x: number, y: number, z: number, metalness = 0) {
    const material = new MeshStandardMaterial({ color, metalness, roughness: 0.39 })
    const mesh = new Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    geometries.push(geometry)
    materials.push(material)
    return mesh
  }

  if (hardware) {
    const floor = solid(new PlaneGeometry(140, 140), '#c8d4d0', 0, -0.018, 0)
    floor.rotation.x = -Math.PI / 2
    floor.castShadow = false
  } else {
    // The vector renderer has no shadow maps. Contact patches keep the objects grounded.
    const geometry = new CircleGeometry(1, 48)
    const material = new MeshBasicMaterial({ color: '#8da39b', transparent: true, opacity: 0.32, depthWrite: false })
    geometries.push(geometry)
    materials.push(material)
    for (const [x, z, radius] of [[0, 0, 1.88], [-2.45, 0.9, 0.69], [2.25, -0.9, 0.95]]) {
      const patch = new Mesh(geometry, material)
      patch.position.set(x, 0.005, z)
      patch.rotation.x = -Math.PI / 2
      patch.scale.set(radius, radius * 0.92, 1)
      patch.renderOrder = -1
      scene.add(patch)
    }
  }
  const grid = new GridHelper(48, 48, '#839d96', '#aabcb6')
  grid.material.transparent = true
  grid.material.opacity = 0.62
  grid.renderOrder = -2
  scene.add(grid)
  geometries.push(grid.geometry)
  materials.push(grid.material)

  solid(new CylinderGeometry(1.66, 1.74, 0.24, 64), '#284e4b', 0, 0.12, 0)
  solid(new CylinderGeometry(1.60, 1.62, 0.10, 64), '#96b5a9', 0, 0.29, 0)

  // A thick annular disc with chamfered edges. Its opening looks different from each angle.
  const profile = [[0.8, -0.19], [1.31, -0.19], [1.40, -0.1], [1.40, 0.10],
    [1.31, 0.19], [0.80, 0.19], [0.71, 0.10], [0.71, -0.10], [0.8, -0.19]]
  const disc = solid(new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 72),
    '#e79642', 0, 1.74, 0, 0.23)
  disc.rotation.set(Math.PI / 2, 0, -0.14)
  const sphere = solid(new IcosahedronGeometry(0.78, 1), '#42958a', -2.45, 0.75, 0.9)
  sphere.material.flatShading = true
  const cube = solid(new BoxGeometry(1.32, 1.58, 1.32), '#a2b6ab', 2.25, 0.79, -0.9)
  cube.rotation.y = -0.18

  scene.add(new AmbientLight('#ebf5f2', hardware ? 1.08 : 0.62))
  const key = new DirectionalLight('#fff0dd', hardware ? 3.2 : 1.1)
  key.position.set(-4, 8, 5)
  key.castShadow = hardware
  key.shadow.mapSize.set(1024, 1024)
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 24 })
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.normalBias = 0.025
  key.shadow.bias = -0.00025
  scene.add(key)
  const rim = new DirectionalLight('#d3ece9', hardware ? 1.65 : 0.45)
  rim.position.set(4, 5, -4)
  scene.add(rim)

  return {
    scene, grid,
    dispose() {
      key.shadow.dispose()
      for (const material of materials) material.dispose()
      for (const geometry of geometries) geometry.dispose()
      scene.clear()
    },
  }
}

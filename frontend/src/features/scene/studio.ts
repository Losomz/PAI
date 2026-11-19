import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, Fog, GridHelper, Material, Mesh, MeshStandardMaterial,
  PlaneGeometry, Scene,
} from 'three'

// The default dark studio uses PixelFX's own night and stone-floor colours, where effects made of light read the
// way they were drawn. The light one is there to check how an effect holds up on a bright background.
const looks = {
  light: { sky: '#e2eae7', floor: '#c8d4d0', grid: ['#839d96', '#aabcb6'], opacity: 0.62,
    ambient: [1.08, 0.62], key: [3.2, 1.1], rim: [1.65, 0.45] },
  // Lit and tone mapped, this floor comes out close to PixelFX's #2b2639 stone, a step lighter than the night.
  dark: { sky: '#15131d', floor: '#4a4263', grid: ['#4a4263', '#2f2a3d'], opacity: 0.8,
    ambient: [0.34, 0.3], key: [1.25, 0.6], rim: [0.55, 0.25] },
}

// An empty stage: a floor, a grid to read depth and foreshortening against, and the lights.
export function createStudio(hardware: boolean) {
  const scene = new Scene()
  const sky = new Color(), fog = new Fog(new Color(), 13, 34)
  scene.background = sky
  scene.fog = fog
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []

  // The vector renderer has no shadow maps, and the grid alone shows where the floor is.
  let ground: MeshStandardMaterial | null = null, floor: Mesh | null = null
  if (hardware) {
    const geometry = new PlaneGeometry(140, 140)
    // Matte, so the effects' lights pool on it instead of glaring off it.
    ground = new MeshStandardMaterial({ roughness: 0.95, depthWrite: false })
    floor = new Mesh(geometry, ground)
    // A backdrop drawn first and hiding nothing: if it wrote depth it would cut every glow sprite standing on it
    // along a straight line, splitting the floor into a lit half and a dark one.
    floor.renderOrder = -3
    floor.position.y = -0.018
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    geometries.push(geometry)
    materials.push(ground)
  }
  const [lightGrid, darkGrid] = [looks.light, looks.dark].map(({ grid: [center, lines], opacity }) => {
    const grid = new GridHelper(48, 48, center, lines)
    // The vector renderer strokes lines in the material's colour and ignores vertex colours.
    if (!hardware) grid.material.color.set(lines)
    grid.material.transparent = true
    grid.material.opacity = opacity
    grid.renderOrder = -2
    scene.add(grid)
    geometries.push(grid.geometry)
    materials.push(grid.material)
    return grid
  })

  const tier = hardware ? 0 : 1
  const ambient = new AmbientLight('#ebf5f2')
  scene.add(ambient)
  const key = new DirectionalLight('#fff0dd')
  key.position.set(-4, 8, 5)
  key.castShadow = hardware
  key.shadow.mapSize.set(1024, 1024)
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 24 })
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.normalBias = 0.025
  key.shadow.bias = -0.00025
  scene.add(key)
  const rim = new DirectionalLight('#d3ece9')
  rim.position.set(4, 5, -4)
  scene.add(rim)
  let gridShown = true, dark = true
  function setGrid(visible: boolean) {
    gridShown = visible
    lightGrid.visible = visible && !dark
    darkGrid.visible = visible && dark
  }
  function setDark(value: boolean) {
    dark = value
    const look = looks[dark ? 'dark' : 'light']
    sky.set(look.sky)
    fog.color.set(look.sky)
    ground?.color.set(look.floor)
    ambient.intensity = look.ambient[tier]
    key.intensity = look.key[tier]
    rim.intensity = look.rim[tier]
    setGrid(gridShown)
  }
  setDark(true)

  return {
    scene, setGrid, setDark,
    /** Whether there is a floor to show or hide; the vector renderer draws none. */
    hasFloor: floor !== null,
    setFloor(visible: boolean) {
      if (floor) floor.visible = visible
    },
    dispose() {
      key.shadow.dispose()
      for (const material of materials) material.dispose()
      for (const geometry of geometries) geometry.dispose()
      scene.clear()
    },
  }
}

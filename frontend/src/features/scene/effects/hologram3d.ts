import {
  BoxGeometry, BufferGeometry, CircleGeometry, CylinderGeometry, Float32BufferAttribute, Group, Material, Mesh,
  MeshStandardMaterial, OctahedronGeometry, PointLight, Quaternion, TorusGeometry, Vector3,
} from 'three'
import { createKit, cycle, DoubleSide, fade, hash, palette, setUniform, TAU, U, type Volume } from './kit'

// A spatial version of PixelFX scifi/hologram. The original turns a crystal on a fixed tilt and draws the far half
// of each ring dimmer to fake depth; here the crystal, the cone and the rings are real geometry, so the camera does
// the tilting. Sizes are the original's pixels: the model floats 50 px up, its radius is 16 px.
const D = 4, FPS = 30, FRAMES = D * FPS
const RAD = 16, MODEL_Y = 50, LENS_Y = 6, DRUM_R = 15, DRUM_H = 5
const C = palette(['#050c1e', '#0a1f48', '#123b80', '#1d64b8', '#2e98e8', '#6cd0ff', '#c8f0ff', '#ffffff'])
const METAL = palette(['#0e0d14', '#1e1c27', '#312e3e', '#4b4759', '#6f6a82', '#9d98b0'])
const SPLIT = palette(['#ff4fd8'])[0]
const SEED = 21
// when it glitches: [start, length, how hard]
const GLITCHES = [[0.92, 0.12, 1], [2.55, 0.2, 1.4], [3.42, 0.06, 0.7]]

// the model: a tall six-sided crystal, a point at each end and a ring of six round its waist
const VERTS = [[0, 1.45, 0], [0, -1.45, 0], ...Array.from({ length: 6 }, (_, i) =>
  [Math.cos((i / 6) * TAU) * 0.9, 0.12, Math.sin((i / 6) * TAU) * 0.9])].map(([x, y, z]) => new Vector3(x, y, z))
const FACES: number[][] = [], EDGES: number[][] = []
for (let i = 0; i < 6; i++) {
  const a = 2 + i, b = 2 + ((i + 1) % 6)
  FACES.push([0, b, a], [1, a, b])
  EDGES.push([0, a], [1, a], [a, b])
}

const px = (v: number) => v * U

export function createHologram3D(detailed: boolean): Volume {
  const kit = createKit(detailed)
  const root = new Group()
  root.name = 'Hologram 3D'
  const holo: Material[] = []
  const track = <T extends Material>(material: T) => (holo.push(material), material)

  // the projector: a steel drum with a lens on top and lights round it
  const drum = new Mesh(kit.geometry(new CylinderGeometry(px(DRUM_R), px(DRUM_R), px(DRUM_H), detailed ? 48 : 24)), [
    kit.own(new MeshStandardMaterial({ color: METAL[3], metalness: 0.3, roughness: 0.45 })),
    kit.own(new MeshStandardMaterial({ color: METAL[4], metalness: 0.25, roughness: 0.5 })),
    kit.own(new MeshStandardMaterial({ color: METAL[0] })),
  ])
  drum.position.y = px(DRUM_H / 2)
  drum.castShadow = drum.receiveShadow = true
  root.add(drum)
  const lip = new Mesh(kit.geometry(new TorusGeometry(px(DRUM_R - 0.4), px(0.55), 6, detailed ? 48 : 24)),
    kit.own(new MeshStandardMaterial({ color: METAL[0], metalness: 0.3, roughness: 0.6 })))
  lip.rotation.x = Math.PI / 2
  lip.position.y = px(DRUM_H)
  root.add(lip)
  const disc = kit.geometry(new CircleGeometry(1, 32))
  for (const [radius, color, lift] of [[5.5, C[4], 0.02], [4.4, C[6], 0.04], [2.2, C[7], 0.06]] as const) {
    const lens = new Mesh(disc, kit.solid(color))
    lens.rotation.x = -Math.PI / 2
    lens.position.y = px(DRUM_H + lift)
    lens.scale.setScalar(px(radius))
    root.add(lens)
  }
  const lampGeometry = kit.geometry(new BoxGeometry(px(1.6), px(1.6), px(0.8)))
  const lampOn = kit.solid(C[6]), lampOff = kit.solid(C[3])
  const lamps = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * TAU, lamp = new Mesh(lampGeometry, lampOff)
    lamp.position.set(Math.sin(a) * px(DRUM_R + 0.3), px(2), Math.cos(a) * px(DRUM_R + 0.3))
    lamp.rotation.y = a
    root.add(lamp)
    return lamp
  })

  // the cone of light: thin at the lens, fading as it rises, scanlines climbing it
  const coneGeometry = kit.geometry(new CylinderGeometry(px(RAD + 4), px(4), 1, detailed ? 48 : 20, 1, true))
  coneGeometry.translate(0, 0.5, 0)
  const coneMaterial = track(kit.rim({ inner: C[4], rim: C[5], base: 0.05, edge: 0.55, power: 2.5, additive: true,
    side: DoubleSide, line: [0.93, C[5]], stripes: [px(5), 0.2, 0.08], taper: 0.55 }))
  const cone = new Mesh(coneGeometry, coneMaterial)
  cone.position.y = px(LENS_Y)
  cone.renderOrder = 2
  root.add(cone)
  const lensGlow = kit.halo(C[5], px(12), 0.6)
  lensGlow.position.y = px(LENS_Y)
  root.add(lensGlow, kit.pool(C[4], px(22), 0.2))

  // the stage at the top of the cone and the data ring round the model's waist: dashes on turning rings
  function dashes(radius: number, count: number, arc: number, opacity: number, bright?: number) {
    const ring = new Group(), geometry = kit.geometry(new TorusGeometry(radius, px(0.5), 4, 10, arc))
    const dim = kit.glow(C[5], opacity), hot = kit.glow(C[7], opacity)
    for (let i = 0; i < count; i++) {
      const dash = new Mesh(geometry, i === bright ? hot : dim)
      dash.rotation.set(Math.PI / 2, 0, (i / count) * TAU)
      ring.add(dash)
    }
    root.add(ring)
    return ring
  }
  const stage = dashes(px(RAD + 4), 8, (5 / 56) * TAU, 0.95)
  const stageGlow = kit.pool(C[4], px(RAD + 6), 0.35)
  stageGlow.position.y = 0
  stage.add(stageGlow)
  const dataRing = dashes(px(RAD + 9), 7, (6 / 64) * TAU, 0.85, 0)

  // data bits rising through the cone
  const bitGeometry = kit.geometry(new BoxGeometry(px(1), px(1), px(1)))
  const bitWhite = kit.glow(C[7]), bitBlue = kit.glow(C[5])
  const bits = Array.from({ length: 18 }, (_, i) => {
    const bit = new Mesh(bitGeometry, hash(SEED, i, 4) < 0.3 ? bitWhite : bitBlue)
    root.add(bit)
    return bit
  })

  // the model: the crystal's faces filled with scanlines, its edges as strokes, its points lit
  const model = new Group()
  root.add(model)
  const faceGeometry = new BufferGeometry()
  faceGeometry.setAttribute('position', new Float32BufferAttribute(FACES.flatMap(f => f.flatMap(i => VERTS[i].toArray())), 3))
  faceGeometry.setAttribute('uv', new Float32BufferAttribute(new Array(FACES.length * 6).fill(0), 2))
  faceGeometry.computeVertexNormals()
  faceGeometry.scale(px(RAD), px(RAD), px(RAD))
  kit.geometry(faceGeometry)
  const faceMaterial = track(kit.rim({ inner: C[3], rim: C[4], base: 0.04, edge: 0.16, power: 1, additive: true,
    side: DoubleSide, stripes: [px(3), 0.34, 0.42] }))
  const faces = new Mesh(faceGeometry, faceMaterial)
  faces.renderOrder = 3
  model.add(faces)

  const strokeGeometry = kit.geometry(new CylinderGeometry(px(0.5), px(0.5), 1, 5, 1))
  const strokeMaterial = track(kit.rim({ inner: C[5], rim: C[6], base: 1, edge: 0, side: DoubleSide }))
  const ghostMaterial = track(kit.rim({ inner: SPLIT, rim: SPLIT, base: 0.75, edge: 0, side: DoubleSide }))
  const up = new Vector3(0, 1, 0), along = new Vector3(), turn = new Quaternion()
  function strokes(material: Material) {
    const group = new Group()
    for (const [i, j] of EDGES) {
      const a = VERTS[i].clone().multiplyScalar(px(RAD)), b = VERTS[j].clone().multiplyScalar(px(RAD))
      const stroke = new Mesh(strokeGeometry, material)
      along.subVectors(b, a)
      stroke.position.copy(a).add(b).multiplyScalar(0.5)
      stroke.quaternion.copy(turn.setFromUnitVectors(up, along.clone().normalize()))
      stroke.scale.y = along.length()
      group.add(stroke)
    }
    return group
  }
  const edges = strokes(strokeMaterial), ghost = strokes(ghostMaterial)
  ghost.visible = false
  model.add(edges, ghost)
  const pointGeometry = kit.geometry(new OctahedronGeometry(px(1.3)))
  const pointMaterial = kit.solid(C[7])
  for (const v of VERTS) {
    const point = new Mesh(pointGeometry, pointMaterial)
    point.position.copy(v).multiplyScalar(px(RAD))
    const glow = kit.halo(C[5], px(4), 0.3)
    glow.position.copy(point.position)
    model.add(point, glow)
  }
  // the scan bar: a disc of light climbing through the model twice a loop
  const scan = new Mesh(kit.geometry(new CircleGeometry(px(RAD), 40)), kit.glow(C[5], 0.12))
  scan.rotation.x = -Math.PI / 2
  const scanGlow = kit.pool(C[5], px(RAD * 1.1), 0.3)
  scanGlow.rotation.x = 0
  scanGlow.position.y = 0
  scan.add(scanGlow)
  root.add(scan)

  // light: the model glows and lights the room, and a flicker drops it
  const modelGlow = kit.halo(C[4], px(RAD * 2.2), 0.36), crownGlow = kit.halo(C[5], px(RAD), 0.15)
  root.add(modelGlow, crownGlow)
  const light = new PointLight(C[5], 1.6, 4.2)
  root.add(light)

  const world = new Vector3()
  let lastFrame = -1
  return {
    root,
    update(elapsedMs: number) {
      const frame = Math.floor(elapsedMs * FPS / 1000) % FRAMES
      if (frame === lastFrame) return false
      lastFrame = frame
      const t = frame / FPS, ph = t / D
      const gl = GLITCHES.reduce((m, [g0, len, k]) => (t >= g0 && t < g0 + len ? Math.max(m, k) : m), 0)
      const flick = gl > 0 && hash(SEED, frame) < 0.5
      // where it sits: a slow bob, a jolt when it glitches
      const jolt = gl ? (hash(SEED, frame, 2) < 0.5 ? -2 : 2) * gl : 0, height = MODEL_Y - 1.5 * Math.sin(TAU * ph * 2)
      const top = height - RAD * 1.3
      model.position.set(px(jolt), px(height), 0)
      model.rotation.y = -TAU * ph
      cone.scale.y = px(top - LENS_Y)
      stage.position.y = px(top)
      stage.rotation.y = TAU * ph
      dataRing.position.set(px(jolt), px(height - 3), 0)
      dataRing.rotation.y = -TAU * ph * 2
      lamps.forEach((lamp, i) => {
        lamp.material = 0.5 + 0.5 * Math.cos(TAU * (2 * ph - i / 8)) > 0.7 ? lampOn : lampOff
      })
      for (const bit of bits) bit.visible = false
      cycle(t, D, bits.length, SEED + 1, i => 0.8 + 0.6 * hash(SEED, i, 5), (i, age, life) => {
        const k = age / life, a = hash(SEED, i, 6) * TAU, w = (4 + (RAD - 2) * k) * Math.sqrt(hash(SEED, i, 7)) * 0.8
        bits[i].position.set(Math.cos(a) * px(w), px(LENS_Y + 2 + (top - LENS_Y - 2) * k), Math.sin(a) * px(w))
        bits[i].scale.setScalar(Math.min(1, (1 - k) * 2))
        bits[i].visible = true
      })
      // a scan bar climbing through it, twice a loop
      const sweep = ((ph * 2) % 1) / 0.8, scanHeight = height - RAD * 1.5 + RAD * 3 * sweep
      scan.visible = sweep < 1
      scan.position.set(px(jolt), px(scanHeight), 0)
      root.updateWorldMatrix(true, false)
      world.set(0, px(scanHeight), 0).applyMatrix4(root.matrixWorld)
      for (const material of [faceMaterial, strokeMaterial]) {
        setUniform(material, 'scanY', sweep < 1 ? world.y : -1e4)
        setUniform(material, 'scanBoost', material === faceMaterial ? 0.55 : 1)
      }
      setUniform(coneMaterial, 'stripeShift', px(t * 24))
      // glitches: interlaced, dimmed, split into a magenta ghost knocked sideways
      const lk = flick ? 0.5 : 1
      for (const material of holo) {
        setUniform(material, 'interlace', flick ? 1 : 0)
        setUniform(material, 'gain', lk)
      }
      ghost.visible = gl > 0 && hash(SEED, frame, 3) < 0.7
      ghost.position.x = px(Math.round((hash(SEED, frame, 4) - 0.5) * 10 * gl) || 3)
      modelGlow.position.set(px(jolt), px(height), 0)
      crownGlow.position.set(px(jolt), px(height + RAD * 0.6), 0)
      fade(modelGlow, lk)
      fade(crownGlow, lk)
      light.position.copy(modelGlow.position)
      light.intensity = 1.6 * lk
      return true
    },
    dispose() {
      root.removeFromParent()
      light.dispose()
      kit.dispose()
    },
  }
}

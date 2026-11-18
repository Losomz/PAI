import {
  Color, Euler, Group, IcosahedronGeometry, Mesh, OctahedronGeometry, PointLight, SphereGeometry, TorusGeometry, Vector3,
} from 'three'
import { BackSide, createKit, cycle, fade, hash, palette, TAU, tube, U, type Volume } from './kit'

// A spatial version of PixelFX arcane/arcane-orb. The original squashes each ring into an ellipse and draws its far
// half before the orb and its near half after; here the rings are tilted circles round a glass sphere and depth
// sorts them. Sizes are the original's pixels: the orb floats 52 px up and its radius is 17 px.
const D = 2.4, FPS = 30, FRAMES = Math.round(D * FPS), RAD = 17, ORB_Y = 52, SEED = 6
const C = palette(['#140a26', '#2b1252', '#481c88', '#6b2cc0', '#9a48ec', '#c684ff', '#ecc8ff', '#ffffff'])
// two rings, each a circle tilted in depth (sy) and rolled in the picture (rot), beads running round it
const RINGS = [
  { r: 31, sy: 0.24, rot: 0.36, beads: 3, turn: 2, c: 0 },
  { r: 27, sy: 0.3, rot: -0.55, beads: 2, turn: -3, c: 1 },
]
// the studio's key light, for the glass's highlight
const KEY = new Vector3(-4, 8, 5).normalize()
const px = (v: number) => v * U

export function createOrb3D(detailed: boolean): Volume {
  const kit = createKit(detailed)
  const root = new Group(), body = new Group()
  root.name = 'Arcane orb 3D'
  root.add(body)

  // the light it throws on the floor, and the haze round it
  const floorGlow = kit.pool(C[4], px(36), 0.26), floorHot = kit.pool(C[6], px(20), 0.45)
  const haze = kit.halo(C[4], px(60), 0.36)
  haze.renderOrder = 0
  root.add(floorGlow, floorHot)
  body.add(haze)

  // the glass: translucent, thicker towards the rim, a bright line just inside a dark one, a highlight
  const sphere = kit.geometry(new SphereGeometry(px(RAD), detailed ? 48 : 18, detailed ? 32 : 12))
  const far = new Mesh(sphere, kit.rim({ inner: C[1], rim: C[2], base: 0.3, edge: 0.3, side: BackSide }))
  far.renderOrder = 1
  const nearMaterial = kit.rim({ inner: C[1], rim: C[2], base: 0.12, edge: 0.34, line: [0.82, C[5]],
    outline: [0.965, C[2]], glint: KEY })
  // The near side keeps what passes behind the orb behind it.
  nearMaterial.depthWrite = detailed
  const near = new Mesh(sphere, nearMaterial)
  near.renderOrder = 4
  body.add(far, near)

  // the swirl: two bright arms with a lit edge and two faint ones between, turning round the heart. The arms bow
  // out of their plane and the plane is tilted, so the swirl keeps its shape from the side.
  const swirl = new Group(), spin = new Group()
  swirl.rotation.set(0.5, 0.2, 0.3)
  swirl.add(spin)
  body.add(swirl)
  const armMaterial = kit.glow(new Color(1, 1, 1), 1, true)
  const fadeOut = (u: number) => (u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.25))
  const arm = (start: number, bow: number) => {
    const points: Vector3[] = []
    for (let u = 0.08; u <= 0.851; u += 0.0385) {
      const a = start + u * 3.4, r = u * RAD * 0.92
      points.push(new Vector3(Math.cos(a) * r, -Math.sin(a) * r, bow * r * Math.sin(Math.PI * u)).multiplyScalar(U))
    }
    return points
  }
  const span = (u: number) => 0.08 + u * 0.77
  for (const [start, main] of [[0, true], [Math.PI, true], [Math.PI / 2, false], [1.5 * Math.PI, false]] as const) {
    const bow = main ? 0.45 : -0.45
    if (main) {
      spin.add(new Mesh(kit.geometry(tube(arm(start, bow), u => px(0.75 - 0.3 * u), detailed ? 40 : 16, 5, u => {
        const s = span(u)
        return (s < 0.3 ? C[7] : s < 0.55 ? C[6] : C[5]).clone().multiplyScalar(fadeOut(s))
      })), armMaterial))
      spin.add(new Mesh(kit.geometry(tube(arm(start - 0.16, bow), u => px(0.55 - 0.2 * u), detailed ? 40 : 16, 5,
        u => (span(u) < 0.4 ? C[6] : C[5]).clone().multiplyScalar(fadeOut(span(u))))), armMaterial))
    } else {
      spin.add(new Mesh(kit.geometry(tube(arm(start, bow), () => px(0.45), detailed ? 32 : 12, 4,
        u => C[4].clone().multiplyScalar(0.8 * fadeOut(span(u))))), armMaterial))
    }
  }
  // Only the meshes: a group's renderOrder would sort its whole subtree after the near glass.
  for (const part of spin.children) part.renderOrder = 2

  // the heart: white-hot, wrapped in two shells of light
  const ball = kit.geometry(new IcosahedronGeometry(1, detailed ? 3 : 1))
  const heart = new Group()
  const core = new Mesh(ball, kit.solid(C[7]))
  core.scale.setScalar(px(1.7))
  const inner = new Mesh(ball, kit.glow(C[6], 0.6)), outer = new Mesh(ball, kit.glow(C[5], 0.45))
  inner.renderOrder = outer.renderOrder = 2
  const heartGlow = kit.halo(C[6], px(20), 0.26), rimGlow = kit.halo(C[5], px(RAD / 0.8), 0.25, true)
  heartGlow.renderOrder = rimGlow.renderOrder = 3
  heart.add(core, inner, outer)
  body.add(heart, heartGlow, rimGlow)
  const light = new PointLight(C[5], 2.4, 4.5)
  body.add(light)

  // the rings and their beads, each bead trailed along the ring
  const beadHead = kit.solid(C[7]), trailHot = kit.glow(C[6]), trailCool = kit.glow(C[5])
  const rings = RINGS.map(R => {
    const tilt = new Group()
    tilt.rotation.order = 'ZXY'
    const track = new Mesh(kit.geometry(new TorusGeometry(px(R.r), px(0.45), 4, detailed ? 120 : 48)), kit.glow(C[5], 0.6))
    track.rotation.x = Math.PI / 2
    track.renderOrder = 5
    tilt.add(track)
    const beads: { mesh: Mesh | ReturnType<typeof kit.halo>; b: number; k: number; size: number }[] = []
    for (let b = 0; b < R.beads; b++) {
      for (let k = 0; k < 7; k++) {
        const mesh = new Mesh(ball, k === 0 ? beadHead : k < 3 ? trailHot : trailCool), size = k === 0 ? 1.3 : 0.95 - k * 0.06
        mesh.renderOrder = 5
        tilt.add(mesh)
        beads.push({ mesh, b, k, size: size * (k < 4 ? 1 : 1 - (k - 3) / 4) })
      }
      const glow = kit.halo(C[6], px(7), 0.5)
      glow.renderOrder = 5
      tilt.add(glow)
      beads.push({ mesh: glow, b, k: -1, size: 0 })
    }
    body.add(tilt)
    return { R, tilt, beads }
  })

  // motes orbiting on tilted paths, and sparks drifting off the orb
  const speck = kit.geometry(new OctahedronGeometry(1))
  const motes = Array.from({ length: 8 }, (_, i) => {
    const head = new Mesh(speck, kit.solid(C[7])), trail = [new Mesh(speck, trailHot), new Mesh(speck, kit.glow(C[4], 0.6))]
    const glow = kit.halo(C[6], px(5), 0.35)
    for (const part of [head, ...trail, glow]) { part.renderOrder = 5; body.add(part) }
    const plane = new Euler(Math.asin(0.28), 0, -(((i * 0.71) % 1) - 0.5) * 1.4, 'ZXY')
    return { head, trail, glow, plane, radius: RAD + 5 + ((i * 0.37) % 1) * 12, dir: i % 2 ? 1 : -1 }
  })
  const sparkHot = kit.glow(C[6]), sparkCool = kit.glow(C[5])
  const sparks = Array.from({ length: 10 }, (_, i) => {
    const spark = new Mesh(speck, hash(SEED, i, 9) < 0.5 ? sparkHot : sparkCool)
    spark.renderOrder = 5
    body.add(spark)
    return spark
  })

  const point = new Vector3()
  const onOrbit = (angle: number, radius: number, plane: Euler) =>
    point.set(Math.cos(angle) * px(radius), 0, Math.sin(angle) * px(radius)).applyEuler(plane)
  let lastFrame = -1
  return {
    root,
    update(elapsedMs: number) {
      const frame = Math.floor(elapsedMs * FPS / 1000) % FRAMES
      if (frame === lastFrame) return false
      lastFrame = frame
      const t = frame / FPS, ph = t / D, lift = Math.sin(ph * TAU), pulse = 0.85 + 0.15 * Math.sin(ph * TAU * 3)
      body.position.y = px(ORB_Y - 2 * lift)
      fade(floorGlow, 1 - 0.15 * lift)
      fade(floorHot, 1 - 0.17 * lift)
      spin.rotation.z = -ph * TAU * 2
      inner.scale.setScalar(px(2.8 * pulse))
      outer.scale.setScalar(px(3.6 * pulse + 1))
      fade(heartGlow, pulse)
      light.intensity = 2.4 * pulse
      for (const { R, tilt, beads } of rings) {
        tilt.rotation.set(Math.asin(R.sy), 0, -(R.rot + 0.12 * Math.sin(ph * TAU + R.c)))
        for (const { mesh, b, k, size } of beads) {
          const g = ph * TAU * R.turn + (b * TAU) / R.beads - Math.sign(R.turn) * Math.max(0, k) * 0.07
          mesh.position.set(Math.cos(g) * px(R.r), 0, Math.sin(g) * px(R.r))
          if (k >= 0) mesh.scale.setScalar(px(size))
        }
      }
      motes.forEach(({ head, trail, glow, plane, radius, dir }, i) => {
        const a = ((i * 2.4 + SEED) % TAU) + ph * TAU * dir * (1 + (i % 3))
        head.position.copy(onOrbit(a, radius, plane))
        head.scale.setScalar(px(0.9))
        glow.position.copy(head.position)
        trail.forEach((part, k) => {
          part.position.copy(onOrbit(a - dir * (k + 1) * (1.1 / radius), radius, plane))
          part.scale.setScalar(px(0.75 - k * 0.15))
        })
      })
      for (const spark of sparks) spark.visible = false
      cycle(t, D, sparks.length, SEED * 3 + 1, i => 0.6 + 0.4 * hash(SEED, i, 10), (i, age, life) => {
        const q = age / life, a = hash(SEED, i, 11) * TAU, z = hash(SEED, i, 12) * 2 - 1, s = Math.sqrt(1 - z * z)
        const d = RAD + 1 + q * (8 + 10 * hash(SEED, i, 13))
        sparks[i].position.set(Math.cos(a) * s * px(d), z * px(d) + px(q * 10), Math.sin(a) * s * px(d))
        sparks[i].scale.setScalar(px(0.8 * (1 - q)))
        sparks[i].visible = true
      })
      return true
    },
    dispose() {
      root.removeFromParent()
      light.dispose()
      kit.dispose()
    },
  }
}

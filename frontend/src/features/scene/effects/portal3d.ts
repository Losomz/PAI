import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CircleGeometry, Color, DoubleSide, Float32BufferAttribute, Group,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PointLight, Quaternion, ShaderMaterial, type Sprite, Vector3,
} from 'three'
import { createKit, cycle, fade, hash, palette, TAU, U, type Volume } from './kit'

// A spatial version of PixelFX arcane/portal (portal/portal.js). The original shades the inside of a flat oval as a
// tunnel, z = -log(distance from the centre), with spiral arms, knots and rings flowing down it. Here the tunnel is
// real: a horn sinking behind the rim, shaded per pixel with the original's formula, ramp and ordered dither in the
// original's pixel grid. The motes and streaks it pulls in come from round about in depth too, then sink down the
// horn. Sizes are the original's pixels: the oval is 17 x 29 and its centre stands 34 above the pivot.
const D = 2.4, FPS = 30, FRAMES = Math.round(D * FPS), SEED = 4
const RX = 17, RY = 29, H = RY + 5
/** How far down the tunnel the horn is built (z = -log d; below d = 0.2 the original is dark), and how deep it is. */
const DEEP = 2.3, LENGTH = 40
const C = palette(['#140a26', '#2b1252', '#481c88', '#6b2cc0', '#9a48ec', '#c684ff', '#ecc8ff', '#ffffff'])
const WHITE = C[7]
const px = (v: number) => v * U
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU)
const float = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

// The original's functions of angle round the oval (th, measured with y pointing down) and loop phase.
const spotsAt = (ph: number) => [ph * TAU * 2 - 0.6, ph * TAU * 2 + Math.PI - 0.6]
function hot(th: number, spots: number[]) {
  return Math.max(Math.exp(-(wrapPi(th - spots[0]) ** 2) / 0.12), 0.85 * Math.exp(-(wrapPi(th - spots[1]) ** 2) / 0.08)) +
    0.35 * Math.max(0, Math.cos(th + 2.3))
}
/** The rim's breathing, without the original's rolling noise (the shaders add that). */
const rimAt = (th: number, ph: number) => 1 + 0.018 * Math.sin(th * 3 - ph * TAU * 2)
/** Light down the tunnel at angle th and depth z: rift() in the original, as a ramp step 0..7. */
function riftLight(th: number, z: number, ph: number, h: number) {
  const d = Math.exp(-z), phi = 3 * th + 6.5 * z - TAU * 3 * ph
  const c1 = 0.5 + 0.5 * Math.cos(phi), c2 = 0.5 + 0.5 * Math.cos(phi + Math.PI + 0.6 * z)
  const lit = d ** 1.5, sink = smooth(0.2, 0.62, d)
  const knot = Math.max(0, Math.cos(4 * z - phi / 3 + TAU * 5 * ph)) ** 6
  const crest = c1 ** 16 * (0.6 + 5.6 * lit) * (1 + 0.5 * knot) * sink
  return smooth(0.4, 0.7, d) + 0.6 * smooth(0.8, 0.95, d) + crest + c1 ** 5 * 1.1 * lit +
    c2 ** 18 * (0.3 + 1.8 * lit) * sink +
    (0.5 + 0.5 * Math.cos(TAU * (z * 1.5 - ph * 2))) ** 20 * 1.3 * sink * (1 - 0.5 * c1) +
    (0.5 + 0.5 * Math.cos(3 * phi + 2 * z + 1.3)) ** 10 * 1.1 * lit * sink +
    2.2 * smooth(0.8, 1, d) ** 2 * (0.75 + 0.45 * h)
}

const common = /* glsl */ `
#define TAU 6.283185307
#define PI 3.141592654
uniform float ph, spot0, spot1;
const float RX = ${float(RX)}, RY = ${float(RY)}, H = ${float(H)}, U = ${float(U)};
const float DEEP = ${float(DEEP)}, LENGTH = ${float(LENGTH)};
float cell(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// value noise that repeats every period cells, like the original's tileNoise
float tileNoise(vec2 p, vec2 period) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, period), i1 = mod(i + 1.0, period);
  float a = cell(i0), b = cell(vec2(i1.x, i0.y)), c = cell(vec2(i0.x, i1.y)), d = cell(i1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
// the rim's radius (1 = the oval) at angle th: slow noise rolling round it, plus a three-lobed breath
float rimR(float th) {
  return 1.0 + 0.05 * tileNoise(vec2(th / TAU * 10.0 + ph * 10.0, ph * 4.0), vec2(10.0, 4.0))
    + 0.018 * sin(th * 3.0 - ph * TAU * 2.0);
}
float wrapPi(float a) { return a - TAU * floor((a + PI) / TAU); }
// two hot spots chase round the rim, and a key light sits at the top left
float hot(float th) {
  float a = wrapPi(th - spot0), b = wrapPi(th - spot1);
  return max(exp(-a * a / 0.12), 0.85 * exp(-b * b / 0.08)) + 0.35 * max(0.0, cos(th + 2.3));
}
// the original's 4x4 ordered dither, in its pixel grid
float bayer(vec2 p) {
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  int x = int(mod(floor(p.x), 4.0)), y = int(mod(floor(p.y), 4.0));
  return (B[y * 4 + x] + 0.5) / 16.0;
}`

// uv.x runs round the oval, uv.y down the tunnel. vPix is where the point lies in the original's picture.
const wellVertex = /* glsl */ `${common}
varying float vTh, vZ;
varying vec2 vPix;
void main() {
  float th = uv.x * TAU, z = uv.y * DEEP, r = rimR(th) * exp(-z);
  vec2 s = vec2(cos(th) * r * RX, sin(th) * r * RY);
  vTh = th;
  vZ = z;
  vPix = vec2(s.x, s.y - H);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vec3(s.x, H - s.y, -LENGTH * uv.y) * U, 1.0);
}`

const wellFragment = /* glsl */ `${common}
uniform vec3 ramp[8];
varying float vTh, vZ;
varying vec2 vPix;
void main() {
  float th = vTh, z = vZ, d = exp(-z), h = hot(th);
  // in ramp steps: clean depth bands falling away to a dark well; three thin bright arms and three faint ones on
  // a log spiral, flowing inward a turn a loop, with knots of light running down them; the light spilling in
  float phi = 3.0 * th + 6.5 * z - TAU * 3.0 * ph;
  float c1 = 0.5 + 0.5 * cos(phi), c2 = 0.5 + 0.5 * cos(phi + PI + 0.6 * z);
  float lit = pow(d, 1.5), sink = smoothstep(0.2, 0.62, d);
  float knot = pow(max(0.0, cos(4.0 * z - phi / 3.0 + TAU * 5.0 * ph)), 6.0);
  float st = smoothstep(0.4, 0.7, d) + 0.6 * smoothstep(0.8, 0.95, d);
  float crest = pow(c1, 16.0) * (0.6 + 5.6 * lit) * (1.0 + 0.5 * knot) * sink;
  st += crest + pow(c1, 5.0) * 1.1 * lit;
  st += pow(c2, 18.0) * (0.3 + 1.8 * lit) * sink;
  st += pow(0.5 + 0.5 * cos(TAU * (z * 1.5 - ph * 2.0)), 20.0) * 1.3 * sink * (1.0 - 0.5 * c1);
  st += pow(0.5 + 0.5 * cos(3.0 * phi + 2.0 * z + 1.3), 10.0) * 1.1 * lit * sink;
  float edge = smoothstep(0.8, 1.0, d);
  st += 2.2 * edge * edge * (0.75 + 0.45 * h);
  // the outside of the horn shows the same flow, dimmer
  if (!gl_FrontFacing) st *= 0.55;
  // the original's tone(): a ramp step, dithered only near the step's edge
  float f = clamp(st / 7.0, 0.0, 1.0) * 7.0, i = floor(f);
  if (clamp((f - i - 0.5) / 0.35 + 0.5, 0.0, 1.0) > bayer(vPix)) i = min(7.0, i + 1.0);
  vec3 color = ramp[int(i)];
  if (gl_FrontFacing && crest > 2.2) color *= 1.12 + 0.05 * crest;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`

// A tube round the rim, `band` pixels outside it: 0 the lit line, 1 the line outside it, 2 the faint halo past that.
const rimVertex = /* glsl */ `${common}
uniform float band, width;
varying float vTh;
varying vec2 vPix;
void main() {
  float th = uv.x * TAU, a = uv.y * TAU, R = rimR(th);
  vec2 n = normalize(vec2(RY * cos(th), RX * sin(th)));
  vec2 s = vec2(cos(th) * R * RX, sin(th) * R * RY) + n * (band + width * cos(a));
  vTh = th;
  vPix = vec2(s.x, s.y - H);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vec3(s.x, H - s.y, width * sin(a)) * U, 1.0);
}`

const rimFragment = /* glsl */ `${common}
uniform float band;
uniform vec3 ramp[8];
varying float vTh;
varying vec2 vPix;
void main() {
  float h = hot(vTh);
  vec3 color;
  if (band < 0.5) color = h > 0.42 ? ramp[7] : ramp[6];
  else if (band < 1.5) color = h > 0.5 ? ramp[4] : ramp[2];
  else {
    if (h <= 0.6 || bayer(vPix) >= 0.5) discard;
    color = ramp[3];
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`

/** A grid of quads over uv, placed by `place`. Front faces look inward for the tunnel. */
function grid(cols: number, rows: number, place: (u: number, v: number, out: Vector3) => void, inward = false) {
  const position: number[] = [], uv: number[] = [], index: number[] = [], p = new Vector3()
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      place(i / cols, j / rows, p)
      position.push(p.x, p.y, p.z)
      uv.push(i / cols, j / rows)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1
      if (inward) index.push(a, c, b, b, c, d)
      else index.push(a, b, c, b, d, c)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(index)
  return geometry
}

export function createPortal3D(detailed: boolean): Volume {
  const kit = createKit(detailed)
  const root = new Group()
  root.name = 'Arcane portal 3D'

  // The tunnel and the rim. The shaders breathe the rim; without WebGL the shape holds still and is coloured per
  // vertex instead.
  const shared = { ph: { value: 0 }, spot0: { value: 0 }, spot1: { value: 0 }, ramp: { value: C } }
  const cols = detailed ? 160 : 48
  const well = kit.geometry(grid(cols, detailed ? 64 : 16, (u, v, out) => {
    const th = u * TAU, r = rimAt(th, 0) * Math.exp(-v * DEEP)
    out.set(px(Math.cos(th) * r * RX), px(H - Math.sin(th) * r * RY), -px(LENGTH * v))
  }, true))
  const rims = [{ band: 0, width: 0.6 }, { band: 1, width: 0.5 }, { band: 2, width: 0.5 }].map(({ band, width }) => ({
    band, width, geometry: kit.geometry(grid(cols, 6, (u, v, out) => {
      const th = u * TAU, a = v * TAU, n = Math.hypot(RY * Math.cos(th), RX * Math.sin(th))
      const offset = band + width * Math.cos(a), R = rimAt(th, 0)
      out.set(px(Math.cos(th) * R * RX + (RY * Math.cos(th) / n) * offset),
        px(H - Math.sin(th) * R * RY - (RX * Math.sin(th) / n) * offset), px(width * Math.sin(a)))
    })),
  }))
  if (detailed) {
    root.add(new Mesh(well, kit.own(new ShaderMaterial({
      vertexShader: wellVertex, fragmentShader: wellFragment, uniforms: { ...shared }, side: DoubleSide,
    }))))
    for (const { band, width, geometry } of rims) {
      root.add(new Mesh(geometry, kit.own(new ShaderMaterial({
        vertexShader: rimVertex, fragmentShader: rimFragment, side: DoubleSide,
        uniforms: { ...shared, band: { value: band }, width: { value: width } },
      }))))
    }
  } else {
    for (const geometry of [well, rims[0].geometry]) {
      geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('uv').count * 3), 3))
      root.add(new Mesh(geometry, kit.own(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false }))))
    }
  }
  function recolor(ph: number, spots: number[]) {
    const paint = (geometry: BufferGeometry, color: (th: number, v: number) => Color) => {
      const uv = geometry.getAttribute('uv'), colors = geometry.getAttribute('color')
      for (let i = 0; i < uv.count; i++) {
        const c = color(uv.getX(i) * TAU, uv.getY(i))
        colors.setXYZ(i, c.r, c.g, c.b)
      }
      colors.needsUpdate = true
    }
    paint(well, (th, v) => C[Math.max(0, Math.min(7, Math.round(riftLight(th, v * DEEP, ph, hot(th, spots)))))])
    paint(rims[0].geometry, th => (hot(th, spots) > 0.42 ? WHITE : C[6]))
  }
  // the far end of the tunnel
  const cap = new Mesh(kit.geometry(new CircleGeometry(1, 48)), kit.own(new MeshBasicMaterial({
    color: C[0], side: DoubleSide, toneMapped: false, fog: false,
  })))
  const end = Math.exp(-DEEP) * 1.04
  cap.scale.set(px(RX * end), px(RY * end), 1)
  cap.position.set(0, px(H), -px(LENGTH))
  root.add(cap)

  // The light it throws on the floor: the original's line of light along the ground, here a pool round the foot.
  const floor = [kit.pool(C[5], 1, 0.5), kit.pool(C[6], 1, 0.55), kit.pool(WHITE, 1, 0.6)]
  floor.forEach((pool, i) => pool.scale.set(px([38, 19, 8][i]), px([13, 7, 3][i]), 1))
  root.add(...floor)
  const spill = new PointLight(C[5], 1.6, px(110))
  spill.position.set(0, px(12), px(6))
  root.add(spill)

  // Particles are pixel-sized bars of light, glows are camera-facing sprites; both are drawn fresh every frame.
  const VOXELS = 700
  const voxels = kit.own(new InstancedMesh(kit.geometry(new BoxGeometry(1, 1, 1)), kit.own(new MeshBasicMaterial({
    transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
  })), VOXELS))
  voxels.frustumCulled = false
  voxels.visible = detailed
  root.add(voxels)
  const glows: Sprite[] = Array.from({ length: 140 }, () => kit.halo(C[4], 1, 1))
  root.add(...glows)
  let used = 0, lit = 0
  const matrix = new Matrix4(), turn = new Quaternion(), axis = new Vector3(1, 0, 0), size = new Vector3()
  const dir = new Vector3(), mid = new Vector3(), tint = new Color(), a1 = new Vector3(), a2 = new Vector3()
  /** A one-pixel-wide bar of light from `from` to `to`, at strength a. */
  function bar(from: Vector3, to: Vector3, color: Color, a: number, width = 1) {
    if (!detailed || used >= VOXELS || a <= 0.02) return
    dir.subVectors(to, from)
    const length = dir.length()
    if (length < 1e-6) turn.identity()
    else turn.setFromUnitVectors(axis, dir.divideScalar(length))
    size.set(Math.max(length, px(width)), px(width), px(width))
    matrix.compose(mid.addVectors(from, to).multiplyScalar(0.5), turn, size)
    voxels.setMatrixAt(used, matrix)
    voxels.setColorAt(used, tint.copy(color).multiplyScalar(Math.min(1, a)))
    used++
  }
  const dot = (at: Vector3, color: Color, a = 1) => bar(at, at, color, a)
  /** The original's glow(): k at the centre falling to nothing at radius r (pixels). */
  function glow(at: Vector3, r: number, color: Color, k: number) {
    if (!detailed || lit >= glows.length || k <= 0.004) return
    const sprite = glows[lit++]
    sprite.position.copy(at)
    sprite.scale.setScalar(px(r) * 2)
    sprite.material.color.copy(color)
    sprite.material.opacity = k
    sprite.visible = true
  }
  /** The original's mote(): a bright head, a darker tail behind it, light round it. Velocity in pixels a second. */
  function mote(at: Vector3, velocity: Vector3, color: Color, scale: number, k: number, light: number) {
    const sp = velocity.length() || 1, length = Math.min(16, 0.5 + sp * 0.026) * scale, a = k < 0.35 ? k / 0.35 : 1
    dir.copy(velocity).divideScalar(sp)
    if (length > 1.2) {
      bar(a1.copy(at).addScaledVector(dir, -px(length)), a2.copy(at).addScaledVector(dir, -px(length * 0.35)),
        tint.copy(color).multiplyScalar(0.55).clone(), a)
      dir.copy(velocity).divideScalar(sp)
    }
    bar(a1.copy(at).addScaledVector(dir, -px(length * 0.4)), at, color, a)
    if (light > 0) glow(at, 2.5 + scale, color, light * k)
  }
  /** The original's streak(): a white tip, a coloured body, a dim tail. */
  function streak(at: Vector3, velocity: Vector3, color: Color, a: number) {
    const sp = velocity.length() || 1, length = Math.min(7, Math.max(1, sp / 30))
    const back = velocity.clone().divideScalar(-sp).multiplyScalar(U)
    bar(at.clone().addScaledVector(back, 1), at, WHITE, a)
    if (length > 2) bar(at.clone().addScaledVector(back, length / 2), at.clone().addScaledVector(back, 1), color, a)
    bar(at.clone().addScaledVector(back, length), at.clone().addScaledVector(back, length / 2),
      color.clone().multiplyScalar(0.6), a * 0.6)
    glow(at, 4, color, 0.4 * a)
  }

  // Where a point at angle th and radius rho (1 = the rim) sits. Outside, the field widens and leans out of the
  // rim's plane so things come from round about; inside, they sink down the tunnel.
  function at(out: Vector3, th: number, rho: number, lean: number, ph: number) {
    const beyond = Math.max(0, rho - 1)
    if (rho >= 1) {
      const y = Math.min(-1, -H + Math.sin(th) * (RY + beyond * 16))
      return out.set(px(Math.cos(th) * (RX + beyond * 21)), px(-y), px(lean * beyond * 12))
    }
    return down(out, th, rho, ph)
  }
  /** A point just inside the tunnel's wall where its radius is rho. */
  function down(out: Vector3, th: number, rho: number, ph: number) {
    const r = rho * rimAt(th, ph) * 0.92, z = Math.min(DEEP, -Math.log(Math.max(rho, 1e-3)))
    return out.set(px(Math.cos(th) * r * RX), px(H - Math.sin(th) * r * RY), -px((LENGTH * z) / DEEP))
  }
  const centre = new Vector3(0, px(H), 0), p = new Vector3(), q = new Vector3(), v = new Vector3()
  const pinks = (hue: number) => (hue < 0.25 ? WHITE : hue < 0.55 ? C[6] : hue < 0.8 ? C[5] : C[4])

  let lastFrame = -1
  return {
    root,
    update(elapsedMs: number) {
      const frame = Math.floor(elapsedMs * FPS / 1000) % FRAMES
      if (frame === lastFrame) return false
      lastFrame = frame
      const t = frame / FPS, ph = t / D, spots = spotsAt(ph), pulse = 0.85 + 0.15 * Math.sin(ph * TAU * 2)
      shared.ph.value = ph
      shared.spot0.value = spots[0]
      shared.spot1.value = spots[1]
      if (!detailed) recolor(ph, spots)
      used = lit = 0

      // specks of light deep in the well, swept round with the arms and sinking towards the far end
      cycle(t, D, 18, SEED * 7 + 5, i => 1.1 + 0.7 * hash(SEED, i, 1), (i, age, life) => {
        const k = age / life, th = hash(SEED, i, 2) * TAU + k * 2.6, rho = 0.92 * (1 - k * k * 0.9)
        const twinkle = Math.sin(ph * TAU * (14 + Math.floor(hash(SEED, i, 3) * 9)) + hash(SEED, i, 4) * TAU)
        if (twinkle > -0.3) {
          dot(down(p, th, rho, ph), rho > 0.6 && twinkle > 0.6 ? WHITE : rho > 0.45 ? C[6] : C[5],
            Math.min(1, k * 6) * (rho > 0.25 ? 1 : rho / 0.25))
        }
      })
      // motes riding round just outside the rim, in and out of its plane, sinking in as they go
      const ride = (out: Vector3, i: number, phase: number) => {
        const k = (phase * 2 + i / 7) % 1, th = ((i * 2.39 + SEED) % TAU) + phase * TAU * 2 + k * 2.5
        const rho = 1.2 + 0.35 * ((i * 0.618) % 1) - 0.3 * k * k
        return out.set(px(Math.cos(th) * rho * RX), px(H - Math.sin(th) * rho * RY),
          px(7 * Math.sin(th + i * 1.7) * (rho - 0.9)))
      }
      for (let i = 0; i < 7; i++) {
        const k = (ph * 2 + i / 7) % 1
        ride(p, i, ph)
        v.subVectors(ride(q, i, ph + 0.002), p).divideScalar(0.002 * D * U)
        mote(p, v, i % 3 ? C[6] : WHITE, 0.6, Math.min(1, Math.max(0, Math.sin(k * Math.PI) * 2.2)), 0.3)
      }
      // motes pulled in from round about, spinning faster as they fall; inside they sink into the dark
      cycle(t, D, 60, SEED * 7 + 1, i => 0.3 + 0.2 * hash(SEED, i, 10), (i, age, life) => {
        const a0 = hash(SEED, i, 11) * TAU, d0 = 1.8 + 1.2 * hash(SEED, i, 12), lean = hash(SEED, i, 13) * 2 - 1
        const spin = (0.8 + hash(SEED, i, 14)) * (hash(SEED, i, 15) < 0.8 ? 1 : 0.35)
        const scale = 0.8 + 0.7 * hash(SEED, i, 16), hue = hash(SEED, i, 17), k = age / life
        const place = (out: Vector3, s: number) => at(out, a0 + spin * s * s, d0 * (1 - s ** 1.4), lean, ph)
        const rho = d0 * (1 - k ** 1.4)
        place(p, k)
        if (rho > rimAt(a0 + spin * k * k, ph) + 0.06) {
          v.subVectors(place(q, Math.min(1, k + 0.015)), p).divideScalar(0.015 * life * U)
          mote(p, v, pinks(hue), hue < 0.8 ? scale : scale * 1.4, Math.min(1, k * 5), hue < 0.8 ? 0.4 : 0.15)
        } else if (rho > 0.3) dot(p, rho > 0.65 ? C[6] : C[5], rho)
      })
      // streaks rushing in that strike the rim in a pinprick of white
      cycle(t, D, 12, SEED * 7 + 2, i => 0.36 + 0.14 * hash(SEED, i, 20), (i, age, life) => {
        const a0 = hash(SEED, i, 21) * TAU, d0 = 2.3 + 0.7 * hash(SEED, i, 22), spin = 0.2 + 0.3 * hash(SEED, i, 23)
        const lean = hash(SEED, i, 24) * 2 - 1, qc = Math.sqrt(1 - 1.05 / d0), k = age / life
        const place = (out: Vector3, s: number) => at(out, a0 + spin * s * s, d0 * (1 - s * s), lean, ph)
        if (k < qc) {
          place(p, k)
          v.subVectors(place(q, k + 0.015), p).divideScalar(0.015 * life * U)
          streak(p, v, C[6], Math.min(1, k * 5))
        } else {
          const fadeOut = 1 - (k - qc) / (1 - qc)
          place(p, qc)
          if (fadeOut > 0.55) dot(p, WHITE)
          glow(p, 7, C[6], 0.6 * fadeOut * fadeOut)
        }
      })
      // grit and sparks skating in along the floor from every side, lifting into the foot of the rift
      cycle(t, D, 14, SEED * 7 + 3, i => 0.7 + 0.4 * hash(SEED, i, 30), (i, age, life) => {
        const heading = hash(SEED, i, 31) * TAU, from = 22 + 28 * hash(SEED, i, 32), y0 = 1 + 1.5 * hash(SEED, i, 33)
        const big = hash(SEED, i, 34) < 0.3, k = age / life
        const place = (out: Vector3, s: number) => {
          const r = from * (1 - Math.max(0, s) ** 3)
          return out.set(px(Math.cos(heading) * r), px(y0 + 3 * smooth(0.55, 1, s)), px(Math.sin(heading) * r))
        }
        place(p, k)
        v.subVectors(p, place(q, k - 0.04)).multiplyScalar(25 / U)
        mote(p, v, big ? C[6] : C[5], big ? 0.9 : 0.6, Math.min(1, k * 4) * (1 - smooth(0.85, 1, k)), 0.3)
      })

      // light comes off the rim, not the void: a big soft pool, a halo hugging the rim, hot spots that shine
      glow(centre, RY * 5, C[4], 0.17 * pulse)
      glow(centre, RY * 2.6, C[4], 0.1 * pulse)
      for (let i = 0; i < 16; i++) {
        const th = (i / 16) * TAU, R = rimAt(th, ph) * 1.08
        glow(p.set(px(Math.cos(th) * R * RX), px(H - Math.sin(th) * R * RY), 0), 15, C[4], 0.15 * pulse)
      }
      for (const th of spots) {
        const R = rimAt(th, ph)
        glow(p.set(px(Math.cos(th) * R * RX), px(H - Math.sin(th) * R * RY), 0), 16, C[6], 0.42)
      }
      floor.forEach(pool => fade(pool, 0.8 + 0.2 * pulse))
      spill.intensity = 1.6 * pulse

      voxels.count = used
      voxels.instanceMatrix.needsUpdate = true
      if (voxels.instanceColor) voxels.instanceColor.needsUpdate = true
      for (let i = lit; i < glows.length; i++) glows[i].visible = false
      return true
    },
    dispose() {
      root.removeFromParent()
      spill.dispose()
      kit.dispose()
    },
  }
}

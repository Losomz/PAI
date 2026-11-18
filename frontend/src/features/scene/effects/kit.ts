import {
  AdditiveBlending, BackSide, BufferGeometry, CanvasTexture, CatmullRomCurve3, CircleGeometry, Color, DoubleSide,
  Float32BufferAttribute, FrontSide, Group, LineBasicMaterial, Material, Mesh, MeshBasicMaterial, NormalBlending,
  ShaderMaterial, type Side, Sprite, SpriteMaterial, Texture, Vector3,
} from 'three'

// Shared pieces for spatial versions of PixelFX effects. Every effect is built in source pixels scaled by U, the
// scale of the flat sprite sheet, so the 3D version and the original stand the same size on the same spot.
export const U = 0.04
export const TAU = 2 * Math.PI

/** A spatial effect: a group whose origin is the effect's pivot on the floor, stepped at the source frame rate. */
export interface Volume {
  root: Group
  /** Advance to the given time. Returns whether a new source frame was reached. */
  update(elapsedMs: number): boolean
  dispose(): void
}

export const palette = (hexes: string[]) => hexes.map(hex => new Color(hex))

/** A stable random number in [0, 1) for any list of integers. */
export function hash(...ns: number[]) {
  let h = 0x811c9dc5
  for (const n of ns) {
    h = Math.imul(h ^ (n | 0), 0x01000193)
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
    h ^= h >>> 12
  }
  return (h >>> 0) / 4294967296
}

/**
 * Particles born at fixed points of a loop, the way PixelFX's cycle() spreads them: particle i is born at a random
 * point in the loop and lives `life(i)` seconds, wrapping round the loop's end. Calls back with its age while alive.
 */
export function cycle(t: number, duration: number, count: number, seed: number,
  life: (i: number) => number, each: (i: number, age: number, life: number) => void) {
  for (let i = 0; i < count; i++) {
    const span = life(i), age = (t - hash(seed, i, 1) * duration + duration * 2) % duration
    if (age < span) each(i, age, span)
  }
}

export interface RimOptions {
  /** The colour facing the camera, and at the silhouette. */
  inner: Color; rim: Color
  /** Opacity facing the camera, and the extra opacity gained towards the silhouette. */
  base: number; edge: number
  /** How tightly the extra opacity hugs the silhouette (1 = a sphere's projected radius squared). */
  power?: number
  /** A line of colour drawn where the surface turns away: [from (0..1 towards the edge), colour]. */
  line?: [number, Color]; outline?: [number, Color]
  additive?: boolean; side?: Side
  /** Horizontal scanlines in world space: period in world units, the fraction lit, the opacity they add. */
  stripes?: [number, number, number]
  /** Fade away towards uv.y = 1 by this much (cones fade as they rise). */
  taper?: number
  /** A specular glint for glass: light direction in world space. */
  glint?: Vector3
}

const rimVertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vView = cameraPosition - world.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}`

const rimFragment = /* glsl */ `
uniform vec3 inner, rim, lineColor, outlineColor, scanColor, lightDir;
uniform float base, edge, power, lineAt, outlineAt, stripe, stripeDuty, stripeBoost, stripeShift;
uniform float taper, scanY, scanBoost, interlace, gain, glint;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  if (interlace > 0.5 && mod(floor(gl_FragCoord.y), 2.0) > 0.5) discard;
  vec3 n = normalize(vNormal), v = normalize(vView);
  float facing = abs(dot(n, v));
  float f = pow(clamp(1.0 - facing * facing, 0.0, 1.0), power);
  vec3 color = mix(inner, rim, f);
  float alpha = base + edge * f;
  if (lineAt > 0.0 && f > lineAt) { color = lineColor; alpha = max(alpha, 0.9); }
  if (outlineAt > 0.0 && f > outlineAt) { color = outlineColor; alpha = max(alpha, 0.85); }
  if (stripe > 0.0 && fract((vWorld.y - stripeShift) / stripe) < stripeDuty) alpha += stripeBoost;
  if (scanBoost > 0.0) {
    float s = 1.0 - smoothstep(0.02, 0.07, abs(vWorld.y - scanY));
    color = mix(color, scanColor, s);
    alpha += scanBoost * s;
  }
  if (glint > 0.0) {
    vec3 l = normalize(lightDir), front = dot(n, v) < 0.0 ? -n : n;
    float spot = pow(max(dot(reflect(-l, front), v), 0.0), 60.0);
    float arc = step(0.55, f) * step(f, 0.8) * smoothstep(0.55, 0.8, dot(front, l));
    color = mix(color, vec3(1.0), clamp(spot * 2.0 + arc * 0.8, 0.0, 1.0));
    alpha = max(alpha, clamp(spot * 2.0 + arc * 0.7, 0.0, 1.0));
  }
  alpha *= 1.0 - taper * vUv.y;
  gl_FragColor = vec4(color, clamp(alpha * gain, 0.0, 1.0));
  #include <colorspace_fragment>
}`

/** Materials, sprites and geometry for one effect. Everything made through it is disposed together. */
export function createKit(hardware: boolean) {
  const owned: { dispose(): void }[] = []
  function own<T extends { dispose(): void }>(item: T) {
    owned.push(item)
    return item
  }
  let soft: Texture | null = null, band: Texture | null = null
  // A radial falloff like PixelFX's glow, and a thin ring of it for glows that hug an outline.
  function gradient(stops: [number, number][]) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')!
    const fill = context.createRadialGradient(64, 64, 0, 64, 64, 64)
    for (const [at, alpha] of stops) fill.addColorStop(at, `rgba(255,255,255,${alpha})`)
    context.fillStyle = fill
    context.fillRect(0, 0, 128, 128)
    return own(new CanvasTexture(canvas))
  }
  const softTexture = () => soft ??= gradient([[0, 1], [0.25, 0.55], [0.55, 0.18], [1, 0]])
  const bandTexture = () => band ??= gradient([[0, 0], [0.62, 0], [0.8, 1], [0.9, 0.35], [1, 0]])

  return {
    hardware,
    own,
    geometry<T extends BufferGeometry>(geometry: T) { return own(geometry) },

    /** A fresnel surface: glass, light cones, hologram faces. Falls back to a flat tint without WebGL. */
    rim(o: RimOptions): Material {
      if (!hardware) {
        return own(new MeshBasicMaterial({
          color: o.inner.clone().lerp(o.rim, 0.45), transparent: true, opacity: Math.min(1, o.base + o.edge * 0.45),
          side: o.side ?? FrontSide, depthWrite: false, toneMapped: false, fog: false,
        }))
      }
      return own(new ShaderMaterial({
        vertexShader: rimVertex, fragmentShader: rimFragment,
        transparent: true, depthWrite: false, side: o.side ?? FrontSide,
        blending: o.additive ? AdditiveBlending : NormalBlending,
        uniforms: {
          inner: { value: o.inner }, rim: { value: o.rim }, base: { value: o.base }, edge: { value: o.edge },
          power: { value: o.power ?? 1 },
          lineAt: { value: o.line?.[0] ?? 0 }, lineColor: { value: o.line?.[1] ?? new Color() },
          outlineAt: { value: o.outline?.[0] ?? 0 }, outlineColor: { value: o.outline?.[1] ?? new Color() },
          stripe: { value: o.stripes?.[0] ?? 0 }, stripeDuty: { value: o.stripes?.[1] ?? 0 },
          stripeBoost: { value: o.stripes?.[2] ?? 0 }, stripeShift: { value: 0 },
          taper: { value: o.taper ?? 0 },
          scanY: { value: -1e4 }, scanBoost: { value: 0 }, scanColor: { value: new Color(1, 1, 1) },
          interlace: { value: 0 }, gain: { value: 1 },
          glint: { value: o.glint ? 1 : 0 }, lightDir: { value: o.glint ?? new Vector3(0, 1, 0) },
        },
      }))
    },

    /** Light: added on top with WebGL, a plain translucent colour otherwise. */
    glow(color: Color, opacity = 1, vertexColors = false) {
      return own(new MeshBasicMaterial({
        color, opacity, transparent: true, vertexColors, depthWrite: false, toneMapped: false, fog: false,
        blending: hardware ? AdditiveBlending : NormalBlending, side: DoubleSide,
      }))
    },
    line(color: Color, opacity = 1) {
      return own(new LineBasicMaterial({ color, opacity, transparent: opacity < 1, toneMapped: false, fog: false }))
    },
    solid(color: Color) {
      return own(new MeshBasicMaterial({ color, toneMapped: false, fog: false }))
    },

    /** A camera-facing glow of the given radius (world units). Only drawn with WebGL. */
    halo(color: Color, radius: number, opacity: number, ring = false) {
      const sprite = new Sprite(own(new SpriteMaterial({
        map: ring ? bandTexture() : softTexture(), color, opacity, blending: AdditiveBlending,
        depthWrite: false, toneMapped: false, fog: false,
      })))
      sprite.scale.setScalar(radius * 2)
      sprite.visible = hardware
      sprite.userData.opacity = opacity
      return sprite
    },
    /** Light pooled on the floor round a point, radius in world units. Only drawn with WebGL. */
    pool(color: Color, radius: number, opacity: number) {
      const mesh = new Mesh(own(new CircleGeometry(1, 48)), own(new MeshBasicMaterial({
        map: softTexture(), color, opacity, transparent: true, blending: AdditiveBlending,
        depthWrite: false, toneMapped: false, fog: false,
      })))
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.006
      mesh.scale.setScalar(radius)
      mesh.visible = hardware
      mesh.userData.opacity = opacity
      // Light on the floor goes when the floor is hidden.
      mesh.userData.floorLight = true
      return mesh
    },

    dispose() {
      for (const item of owned) item.dispose()
      owned.length = 0
    },
  }
}

export type Kit = ReturnType<typeof createKit>

/** Set a uniform on a rim material; without WebGL, gain scales the fallback's opacity instead. */
export function setUniform(material: Material, name: string, value: number) {
  if (material instanceof ShaderMaterial) {
    if (material.uniforms[name]) material.uniforms[name].value = value
  } else if (name === 'gain') {
    material.userData.opacity ??= material.opacity
    material.opacity = material.userData.opacity * value
  }
}

/** Scale a halo's or pool's opacity from the strength it was made with. */
export function fade(object: { material: Material | Material[]; userData: Record<string, unknown> }, k: number) {
  const material = object.material as Material
  material.opacity = (object.userData.opacity as number) * k
}

/**
 * A tube along a smooth path through `points`, its radius varying along the way, optionally coloured per point
 * along its length. Used for strokes that must keep their width when seen end-on.
 */
export function tube(points: Vector3[], radius: (u: number) => number, segments: number, radial = 6,
  shade?: (u: number) => Color) {
  const curve = new CatmullRomCurve3(points)
  const frames = curve.computeFrenetFrames(segments, false)
  const position: number[] = [], uv: number[] = [], color: number[] = [], index: number[] = []
  const point = new Vector3()
  for (let i = 0; i <= segments; i++) {
    const u = i / segments, r = radius(u), normal = frames.normals[i], binormal = frames.binormals[i]
    curve.getPointAt(u, point)
    const tint = shade?.(u)
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r
      position.push(point.x + c * normal.x + s * binormal.x, point.y + c * normal.y + s * binormal.y,
        point.z + c * normal.z + s * binormal.z)
      uv.push(u, j / radial)
      if (tint) color.push(tint.r, tint.g, tint.b)
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  if (shade) geometry.setAttribute('color', new Float32BufferAttribute(color, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

export { BackSide, DoubleSide, FrontSide }

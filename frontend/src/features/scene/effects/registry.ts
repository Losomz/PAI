import portalAtlas from './portal/portal.png'
import portalSpec from './portal/portal.json'
import hologramAtlas from './hologram/hologram.png'
import hologramSpec from './hologram/hologram.json'
import orbAtlas from './orb/orb.png'
import orbSpec from './orb/orb.json'
import type { Volume } from './kit'
import { createPortal3D } from './portal3d'
import { createHologram3D } from './hologram3d'
import { createOrb3D } from './orb3d'

/** A baked sprite sheet of the original effect (scripts/bake-scene-effects.mjs). */
export interface Sheet {
  url: string
  spec: { fps: number; frames: number; frameSize: number[]; pivot: number[]; columns: number }
}

export interface SceneEffect {
  key: string
  /** The PixelFX effect it reinterprets. */
  id: string
  name: string
  /** Height above the pivot, in source pixels, that the camera centres on. */
  focus: number
  sheet: Sheet
  create(detailed: boolean): Volume
}

export const sceneEffects: SceneEffect[] = [
  { key: 'portal', id: 'arcane/portal', name: '传送门', focus: 34,
    sheet: { url: portalAtlas, spec: portalSpec }, create: createPortal3D },
  { key: 'hologram', id: 'scifi/hologram', name: '全息投影', focus: 42,
    sheet: { url: hologramAtlas, spec: hologramSpec }, create: createHologram3D },
  { key: 'orb', id: 'arcane/arcane-orb', name: '奥术法球', focus: 52,
    sheet: { url: orbAtlas, spec: orbSpec }, create: createOrb3D },
]

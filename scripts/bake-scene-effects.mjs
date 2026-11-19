// Rebuild the flat sprite sheets the 3D scene compares against. Pass effect folders to bake only those:
//   node scripts/bake-scene-effects.mjs [portal hologram orb]
// A folder holding its own copy of the PixelFX source (portal/portal.js) is rendered from that copy, so it can be
// edited alongside its 3D version; the others are rendered straight from the upstream checkout.
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { loadEffect, renderFrames, spriteSheet, FX_DIR } from '../tools/pixelfx/upstream/tools/lib/fxlib.mjs'

const effects = [
  // The original halo reaches 145 pixels from its centre.
  { folder: 'portal', id: 'arcane/portal', margin: 104 },
  { folder: 'hologram', id: 'scifi/hologram' },
  { folder: 'orb', id: 'arcane/arcane-orb' },
]
const root = new URL('../frontend/src/features/scene/effects/', import.meta.url)

async function load({ folder, id }) {
  const copy = fileURLToPath(new URL(`${folder}/${folder}.js`, root))
  if (!existsSync(copy)) return loadEffect(id)
  const { outputFiles } = await build({
    stdin: { contents: await readFile(copy, 'utf8'), sourcefile: `${folder}.js`, resolveDir: dirname(`${FX_DIR}/${id}.js`) },
    bundle: true, format: 'esm', write: false,
  })
  const mod = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
  return { id, meta: mod.meta, mod }
}

// The smallest margin that keeps every lit pixel of every frame, found on a generous canvas.
function fitMargin(effect) {
  const probe = 160, { w, h, frames } = renderFrames(effect, { bg: 'none', actor: false, margin: probe })
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (const { clear } of frames) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (clear[4 * (y * w + x) + 3] < 3) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return Math.max(0, probe - x0, probe - y0, x1 + 1 - (w - probe), y1 + 1 - (h - probe)) + 2
}

const wanted = process.argv.slice(2)
for (const entry of effects.filter(e => !wanted.length || wanted.includes(e.folder))) {
  const effect = await load(entry)
  const margin = entry.margin ?? fitMargin(effect)
  const frames = renderFrames(effect, { bg: 'none', actor: false, margin })
  const { png, json } = spriteSheet(effect, frames, entry.folder)
  const spec = json.meta.pixelfx
  spec.pivot = spec.pivot.map(v => v + margin)
  // The 2D view fits the effect's own canvas, not the room left round it for spilt light.
  spec.margin = margin
  await writeFile(new URL(`${entry.folder}/${entry.folder}.png`, root), png)
  await writeFile(new URL(`${entry.folder}/${entry.folder}.json`, root), JSON.stringify(spec, null, 2) + '\n')
  console.log(`${entry.id}: ${spec.frames} frames of ${spec.frameSize.join('x')}, margin ${margin}`)
}

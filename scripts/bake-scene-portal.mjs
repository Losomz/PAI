// Rebuild the scene's sprite sheet after editing its copy of the PixelFX effect.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { renderFrames, spriteSheet } from '../tools/pixelfx/upstream/tools/lib/fxlib.mjs'

const assets = new URL('../frontend/src/features/scene/effects/portal/', import.meta.url)
const helpers = new URL('../tools/pixelfx/upstream/src/fx/arcane/', import.meta.url)
const { outputFiles } = await build({
  stdin: { contents: await readFile(new URL('portal.js', assets), 'utf8'), sourcefile: 'portal.js', resolveDir: fileURLToPath(helpers) },
  bundle: true, format: 'esm', write: false,
})
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
const effect = { id: 'arcane/portal', meta: mod.meta, mod }
// The original halo reaches 145 pixels from its centre. Leave room around the original canvas.
const margin = 104
const frames = renderFrames(effect, { bg: 'none', actor: false, margin })
const { png, json } = spriteSheet(effect, frames, 'portal')
const spec = json.meta.pixelfx
spec.pivot = spec.pivot.map(v => v + margin)
await writeFile(new URL('portal.png', assets), png)
await writeFile(new URL('portal.json', assets), JSON.stringify(spec, null, 2) + '\n')

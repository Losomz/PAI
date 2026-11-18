import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { effects } from './upstream/src/fx/index.js'
import { loadEffect, renderAct, spriteSheet, contactSheet } from './upstream/tools/lib/fxlib.mjs'

const run = promisify(execFile)
const renderer = fileURLToPath(new URL('./upstream/tools/render.mjs', import.meta.url))
const catalogue = Object.entries(effects).sort(([a], [b]) => a.localeCompare(b)).map(([id, { meta, act }]) => ({
  id, name: meta.name, tags: meta.tags, size: meta.size, fps: meta.fps ?? 30, loop: !!meta.loop,
  seed: meta.options?.seed ?? 1, actorAvailable: !!act,
}))

export function listEffects(query = '') {
  const words = query.trim().toLowerCase().split(/\s+/)
  return catalogue.filter(({ id, name, tags }) => {
    const terms = [id, name, ...tags].join(' ').toLowerCase()
    return words.every(word => terms.includes(word))
  })
}

// act.mjs --sheet writes inside the upstream checkout. Its public helpers also work in a caller-owned directory.
async function exportAct(id, name, dest, { seed, fps, options }) {
  const fx = await loadEffect(id)
  const frames = renderAct(fx, { fps: fps ?? fx.meta.fps, seed, options, bg: 'none', hold: 0 })
  const sheet = spriteSheet(fx, frames, name)
  sheet.json.meta.pixelfx.pivot = frames.pivot
  await mkdir(dest, { recursive: true })
  await writeFile(path.join(dest, name + '.png'), sheet.png)
  await writeFile(path.join(dest, name + '.json'), JSON.stringify(sheet.json, null, 1))
  await writeFile(path.join(dest, 'contact.png'), contactSheet(fx, frames))
}

export async function exportEffect({ id, outputDir, seed, palette, flip, fps, actor }) {
  if (!Object.hasOwn(effects, id)) throw new Error('未知特效 ID')
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) throw new Error('输出目录须使用绝对路径')
  if (actor && !effects[id].act) throw new Error('此特效没有角色动作')
  const name = id.split('/')[1]
  const options = {}
  if (palette !== undefined) options.palette = palette
  if (flip !== undefined) options.flip = flip
  await mkdir(outputDir, { recursive: true })
  const staging = await mkdtemp(path.join(outputDir, '.pai-export-'))
  const dest = path.join(staging, id)
  const directory = path.join(outputDir, name + '-' + randomUUID())
  try {
    if (actor) {
      await exportAct(id, name, dest, { seed, fps, options })
    } else {
      const args = [renderer, id, '--sheet', '--out', staging, '--opts', JSON.stringify(options)]
      if (fps !== undefined) args.push('--fps', String(fps))
      if (seed !== undefined) args.push('--seed', String(seed))
      await run(process.execPath, args, { windowsHide: true })
    }
    const { meta } = JSON.parse(await readFile(path.join(dest, name + '.json'), 'utf8'))
    await rename(dest, directory)
    return { id, frames: meta.pixelfx.frames, fps: meta.pixelfx.fps, directory,
      sheet: path.join(directory, name + '.png'), atlas: path.join(directory, name + '.json'),
      preview: path.join(directory, 'contact.png') }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

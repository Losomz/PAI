import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { checkId } from './library.mjs'

export async function exportSheet(id, outputDir, result) {
  const name = checkId(id).split('/')[1]
  if (!path.isAbsolute(outputDir)) throw Error('导出目录须为绝对路径')
  const { width: w, height: h, frames: count, columns, fps, loop, png } = result
  const frames = Array.from({ length: count }, (_, i) => ({
    filename: name + ' ' + i, frame: { x: (i % columns) * w, y: Math.floor(i / columns) * h, w, h },
    rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h },
    duration: Math.round((i + 1) * 1000 / fps) - Math.round(i * 1000 / fps),
  }))
  const meta = { app: 'PAI Animation', format: 'RGBA8888', image: name + '.png', scale: '1',
    size: { w: columns * w, h: Math.ceil(count / columns) * h }, fps, loop,
    frameTags: [{ name, from: 0, to: count - 1, direction: 'forward' }] }
  await mkdir(outputDir, { recursive: true })
  const tmp = await mkdtemp(path.join(outputDir, '.animation-'))
  const directory = path.join(outputDir, name + '-' + randomUUID())
  try {
    await writeFile(path.join(tmp, name + '.png'), png)
    await writeFile(path.join(tmp, name + '.json'), JSON.stringify({ frames, meta }, null, 2))
    await rename(tmp, directory)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  return { id, frames: count, fps, directory, sheet: path.join(directory, name + '.png'), atlas: path.join(directory, name + '.json') }
}

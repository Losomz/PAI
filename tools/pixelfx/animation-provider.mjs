import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { effects } from './upstream/src/fx/index.js'
import { createPlayer } from './player.mjs'

export const templates = Object.entries(effects).map(([id, effect]) => ({ id, name: effect.meta.name }))

export function templatePath(id) {
  if (!Object.hasOwn(effects, id)) throw Error('素材不存在：' + id)
  return fileURLToPath(new URL('./upstream/src/fx/' + id + '.js', import.meta.url))
}
export function templateCode(id) {
  return fs.readFileSync(templatePath(id), 'utf8')
}

export function pixelEnvironment(id, code) {
  const original = templateCode(id)
  return {
    entry: 'upstream/src/fx/' + id + '.js',
    driver: fs.readFileSync(new URL('./player.mjs', import.meta.url), 'utf8'),
    module(name) {
      if (!/^upstream\/src\/(?:core|fx)\/(?:[\w-]+\/)*[\w-]+\.js$/.test(name)) throw Error('无法导入模块：' + name)
      return fs.readFileSync(new URL('./' + name, import.meta.url), 'utf8')
    },
    // Only modules imported from the pinned distribution can take the native fast path.
    trustedPlayer: code === original ? () => createPlayer(effects[id]) : undefined,
  }
}

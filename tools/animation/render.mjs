import path from 'node:path'
import pngjs from 'pngjs'
import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import { newQuickJSWASMModuleFromVariant, Scope } from 'quickjs-emscripten-core'
import { checkCode } from './library.mjs'
import { createPlayer as nativePlayer } from './native-player.mjs'

export function nativeEnvironment() {
  return { entry: 'effect.js', driver: 'export const createPlayer = ' + nativePlayer.toString() }
}

function collect(info, draw, validateOnly) {
  const { width, height, fps, duration, loop, name } = info
  // Where the animation stands on the ground, in canvas pixels; the effect maker stands it on this point.
  const origin = Array.isArray(info.origin) && info.origin.length === 2 && info.origin.every(Number.isFinite)
    ? info.origin.map(Number) : null
  // The animation's own canvas, inside a frame that may have room round it for light that spills past the edge.
  const canvas = Array.isArray(info.canvas) && info.canvas.length === 4 && info.canvas.every(Number.isInteger)
    ? info.canvas : [0, 0, width, height]
  const [left, top, size, rise] = canvas
  if (![size, rise].every(n => Number.isInteger(n) && n > 0 && n <= 1024) ||
      ![width, height].every(n => Number.isInteger(n) && n <= 1280) || left < 0 || top < 0 ||
      left + size > width || top + rise > height ||
      !Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isFinite(duration) || duration <= 0 || duration > 60) {
    throw Error('请检查 meta 中的画布尺寸（1–1024）、帧率（1–60）与时长（最多 60 秒）')
  }
  const frames = Math.max(1, Math.round(duration * fps) + (loop ? 0 : 1))
  if (width * height * frames > 48_000_000) throw Error('精灵图过大，请缩小画布或减少帧数')
  const columns = Math.min(frames, Math.ceil(Math.sqrt(frames * height / width)))
  const rows = Math.ceil(frames / columns)
  const meta = { width, height, fps, frames, columns, duration, loop: !!loop, name, origin, canvas }
  const sheet = validateOnly ? null : new pngjs.PNG({ width: columns * width, height: rows * height })
  for (let i = 0; i < (validateOnly ? 1 : frames); i++) {
    draw(i, bytes => {
      if (bytes.length !== width * height * 4) throw Error('动画帧的 RGBA 长度与画布尺寸不一致')
      if (!sheet) return
      const x = (i % columns) * width, y = Math.floor(i / columns) * height
      for (let row = 0; row < height; row++) {
        sheet.data.set(bytes.subarray(row * width * 4, (row + 1) * width * 4), ((row + y) * sheet.width + x) * 4)
      }
    })
  }
  return sheet ? { ...meta, png: pngjs.PNG.sync.write(sheet, { deflateLevel: 3, filterType: 1 }) } : meta
}

/** `room` asks a PixelFX player to draw that many pixels round the canvas as well (see its createPlayer). */
export async function renderCode(code, environment, validateOnly = false, room = 0) {
  checkCode(code)
  room = Number.isInteger(room) && room > 0 ? Math.min(room, 128) : 0
  if (environment.trustedPlayer) {
    const player = environment.trustedPlayer(room)
    return collect(player.info, (i, use) => use(new Uint8Array(player.draw(i))), validateOnly)
  }
  const engine = await newQuickJSWASMModuleFromVariant(variant)
  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(64 * 1024 * 1024)
  runtime.setMaxStackSize(1024 * 1024)
  let deadline = Date.now() + 3000
  const end = Date.now() + 90_000
  runtime.setInterruptHandler(() => Date.now() > deadline)
  runtime.setModuleLoader(name => {
    if (name === environment.entry) return code
    if (name === 'driver.mjs') return environment.driver
    if (environment.module) return environment.module(name)
    throw Error('独立动画只支持当前 animation.js')
  }, (base, name) => {
    if (base === 'main.mjs' && name === '@entry') return environment.entry
    if (base === 'main.mjs' && name === '@driver') return 'driver.mjs'
    if (!name.startsWith('./') && !name.startsWith('../')) throw Error('不支持导入：' + name)
    return path.posix.join(path.posix.dirname(base), name)
  })
  const vm = runtime.newContext()
  try {
    const program = 'import * as entry from "@entry"; import {createPlayer} from "@driver";' +
      `const player = createPlayer(entry, ${room}); const {width,height,fps,duration,loop,name} = player.info;` +
      'const origin = Array.isArray(player.info.origin) ? [+player.info.origin[0], +player.info.origin[1]] : null;' +
      'const canvas = Array.isArray(player.info.canvas) ? player.info.canvas.slice(0, 4).map(Number) : null;' +
      'export const info = {width:+width,height:+height,fps:+fps,duration:+duration,loop:!!loop,name:String(name ?? "").slice(0,120),origin,canvas};' +
      'export function frame(index) {return player.draw(index)}'
    return Scope.withScope(scope => {
      const exports = scope.manage(vm.unwrapResult(vm.evalCode(program, 'main.mjs', { type: 'module' })))
      const frame = scope.manage(vm.getProp(exports, 'frame'))
      const info = vm.dump(scope.manage(vm.getProp(exports, 'info')))
      return collect(info, (i, use) => Scope.withScope(step => {
        deadline = Math.min(end, Date.now() + 3000)
        const index = step.manage(vm.newNumber(i))
        const buffer = step.manage(vm.unwrapResult(vm.callFunction(frame, vm.undefined, index)))
        use(step.manage(vm.getArrayBuffer(buffer)).value)
      }), validateOnly)
    })
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}

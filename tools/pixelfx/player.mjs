import { createAct, actBounds, actTiming, createFx, createFrame, clearFrame, composite } from './upstream/src/core/index.js'

export function createPlayer(effect) {
  const { meta } = effect
  let [width, height] = meta.size
  let [x, y] = meta.origin
  let duration = meta.duration
  if (effect.act) {
    const b = actBounds(effect)
    width = b.x1 - b.x0 + 12
    height = b.y1 - b.y0 + 12
    x = 6 - b.x0
    y = 6 - b.y0
    const timing = actTiming(effect)
    duration += timing.windup + timing.recovery + timing.hits.reduce((sum, hit) => sum + hit.freeze, 0)
  }
  const fps = meta.fps ?? 30
  const frame = createFrame(width, height)
  const rgba = new Uint8ClampedArray(width * height * 4)
  const instance = effect.act ? createAct(effect, { x, y }) : createFx(effect, { x, y })
  return {
    info: { width, height, fps, duration, loop: !!meta.loop, name: meta.name },
    draw(index) {
      if (index) instance.update(1 / fps)
      instance.draw(clearFrame(frame))
      composite(frame, rgba, null)
      return rgba.buffer
    },
  }
}

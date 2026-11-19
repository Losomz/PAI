export function createPlayer(animation) {
  const { size: [width, height], fps = 24, duration, loop = false, name, origin } = animation.meta
  if (typeof animation.draw !== 'function') throw Error('请导出 draw(rgba, time, size) 函数')
  const pixels = new Uint8ClampedArray(width * height * 4)
  return {
    info: { width, height, fps, duration, loop, name, origin },
    draw(index) {
      pixels.fill(0)
      animation.draw(pixels, index / fps, { width, height })
      return pixels.buffer
    },
  }
}

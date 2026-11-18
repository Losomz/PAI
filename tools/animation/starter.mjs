export function starterCode(name) {
  return `// rgba is a transparent RGBA8 frame, time is measured in seconds.
export const meta = {
  name: ${JSON.stringify(name)}, size: [48, 48], fps: 24, duration: 1.5, loop: true,
}

export function draw(rgba, time, { width, height }) {
  const phase = time / meta.duration * Math.PI * 2
  const cx = Math.round(width / 2 + Math.cos(phase) * 10)
  const cy = Math.round(height / 2 + Math.sin(phase) * 8)
  for (let y = Math.max(0, cy - 5); y <= Math.min(height - 1, cy + 5); y++) {
    for (let x = Math.max(0, cx - 5); x <= Math.min(width - 1, cx + 5); x++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) <= 5) {
        rgba.set([104, 226, 200, 255], (y * width + x) * 4)
      }
    }
  }
}
`
}

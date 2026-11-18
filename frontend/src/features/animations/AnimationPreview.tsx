import { useEffect, useRef, useState } from 'react'
import { IconPause, IconPlayArrow, IconRefresh } from '@arco-design/web-react/icon'
import { errorText, type AnimationRecord, type Preview } from './types'

export default function AnimationPreview({ item }: { item: AnimationRecord }) {
  const [loaded, setLoaded] = useState<{ info: Preview; image: HTMLImageElement } | null>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState(0)
  const position = useRef(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const info = loaded?.info

  useEffect(() => {
    let active = true
    const api = window.pai.animations
    api.preview(item.id, item.revision).then(async info => {
      if (!active) return
      const image = new Image()
      image.src = info.image
      await image.decode()
      if (active) setLoaded({ info, image })
    }).catch(err => { if (active) setError(errorText(err)) })
    return () => { active = false; void api.cancelPreview().catch(() => {}) }
  }, [item.id, item.revision])

  useEffect(() => {
    if (!info || !playing) return
    const start = performance.now(), offset = position.current
    let timer: number
    function tick(now: number) {
      if (!info) return
      const elapsed = offset + Math.floor((now - start) * info.fps / 1000)
      position.current = info.loop ? elapsed % info.frames : Math.min(elapsed, info.frames - 1)
      setFrame(position.current)
      if (!info.loop && elapsed >= info.frames) { setPlaying(false); return }
      timer = requestAnimationFrame(tick)
    }
    timer = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(timer)
  }, [info, playing])

  useEffect(() => {
    if (!loaded || !canvas.current) return
    const { width, height, columns } = loaded.info
    const ctx = canvas.current.getContext('2d')!
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(loaded.image, (frame % columns) * width, Math.floor(frame / columns) * height, width, height, 0, 0, width, height)
  }, [loaded, frame])

  function seek(next: number) {
    setPlaying(false)
    position.current = next
    setFrame(next)
  }
  return <div className="anim-player">
    <div className="anim-stage">
      {loaded ? <canvas ref={canvas} width={loaded.info.width} height={loaded.info.height}
        aria-label={item.name + ' 动画预览'} style={{
          width: `min(92%, ${loaded.info.width * 4}px)`, height: `min(92%, ${loaded.info.height * 4}px)`,
        }} />
        : <p role={error ? 'alert' : 'status'}>{error || '正在生成预览…'}</p>}
    </div>
    {info && <div className="anim-transport">
      <button type="button" aria-label={playing ? '暂停' : '播放'} onClick={() => {
        if (!playing && position.current === info.frames - 1) { position.current = 0; setFrame(0) }
        setPlaying(!playing)
      }}>{playing ? <IconPause /> : <IconPlayArrow />}</button>
      <button type="button" aria-label="回到首帧" onClick={() => seek(0)}><IconRefresh /></button>
      <input aria-label="预览帧" type="range" min={0} max={info.frames - 1} value={frame}
        onChange={e => seek(Number(e.target.value))} />
      <span>{frame + 1} / {info.frames}</span>
    </div>}
    {info && <p className="anim-spec">{info.width} × {info.height} px <i>·</i> {info.fps} FPS <i>·</i> {info.loop ? '循环' : '单次播放'}</p>}
  </div>
}

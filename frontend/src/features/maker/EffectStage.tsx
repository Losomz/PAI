import { useEffect, useRef, useState } from 'react'
import {
  IconCompass, IconLayout, IconMinus, IconMoon, IconMosaic, IconPause, IconPlayArrow, IconPlus, IconRefresh,
  IconRotateRight, IconSkipPrevious,
} from '@arco-design/web-react/icon'
import { initialFov, mountViewport, type CameraMode, type ViewKind } from './viewport'
import type { Sheet } from './card'

/** The effect the stage shows. A different id starts it afresh; the same id with a new sheet is a re-render. */
export interface Shown { id: string; sheet: Sheet }

export default function EffectStage({ shown, loading, problem, hidden }: {
  shown: Shown | null
  /** The name of an effect being rendered, and why the last rendering failed. */
  loading: string; problem: string
  hidden: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewport = useRef<ReturnType<typeof mountViewport> | null>(null)
  const lastId = useRef<string | null>(null)
  const [kind, setKind] = useState<ViewKind>('2d')
  const [mode, setMode] = useState<CameraMode>('orbit')
  const [grid, setGrid] = useState(true)
  const [floor, setFloor] = useState(true)
  const [hasFloor, setHasFloor] = useState(false)
  const [dark, setDark] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [frame, setFrame] = useState(0)
  const [fov, setFov] = useState(initialFov)
  const [zoom, setZoom] = useState(3)
  const [error, setError] = useState('')
  const spec = shown?.sheet.spec

  useEffect(() => {
    if (!host.current) return
    try {
      const current = mountViewport(host.current, {
        error: setError, zoom: setZoom,
        frame(next, on) { setFrame(next); setPlaying(on) },
      })
      viewport.current = current
      lastId.current = null
      setHasFloor(current.hasFloor)
      return () => {
        current.dispose()
        viewport.current = null
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])
  useEffect(() => {
    viewport.current?.setSheet(shown?.sheet ?? null, (shown?.id ?? null) !== lastId.current)
    lastId.current = shown?.id ?? null
    setError('')
  }, [shown])

  function changeKind(next: ViewKind) {
    viewport.current?.setKind(next)
    setKind(next)
    host.current?.focus({ preventScroll: true })
  }
  function changeMode(value: CameraMode) {
    viewport.current?.setMode(value)
    setMode(value)
  }
  function changeFov(value: number) {
    viewport.current?.setFov(value)
    setFov(value)
  }
  function toggle(value: boolean, set: (value: boolean) => void, apply?: (value: boolean) => void) {
    apply?.(!value)
    set(!value)
  }
  const message = error || problem
  return <div className="maker-stage" hidden={hidden}>
    <div className="maker-toolbar">
      <div className="maker-modes" role="group" aria-label="视图">
        <button aria-pressed={kind === '2d'} onClick={() => changeKind('2d')}>2D 视图</button>
        <button aria-pressed={kind === '3d'} onClick={() => changeKind('3d')}>3D 视图</button>
      </div>
      {kind === '3d' && <div className="maker-modes" role="group" aria-label="相机模式">
        <button aria-pressed={mode === 'orbit'} onClick={() => changeMode('orbit')}><IconRotateRight /> 环绕</button>
        <button aria-pressed={mode === 'fly'} onClick={() => changeMode('fly')}><IconCompass /> 自由漫游</button>
      </div>}
      <button className="maker-plain" onClick={() => {
        if (kind === '3d') changeFov(initialFov)
        viewport.current?.reset()
      }}><IconRefresh /> 重置视角</button>
      <div className="maker-toggles">
        <button aria-pressed={dark} onClick={() => toggle(dark, setDark, v => viewport.current?.setDark(v))}>
          <IconMoon /> 暗场</button>
        {hasFloor && kind === '3d' && <button aria-pressed={floor}
          onClick={() => toggle(floor, setFloor, v => viewport.current?.setFloor(v))}><IconLayout /> 地板</button>}
        <button aria-pressed={grid} onClick={() => toggle(grid, setGrid, v => viewport.current?.setGrid(v))}>
          <IconMosaic /> 网格</button>
      </div>
    </div>
    <div className="maker-canvas">
      <div ref={host} className="maker-viewport" tabIndex={0} role="region" aria-label="特效预览"
        aria-describedby="maker-hint" data-view={kind} data-effect={shown?.id} />
      {kind === '3d' && <div className="maker-presets" role="group" aria-label="预设视角">
        <button onClick={() => viewport.current?.setView('front')}>正面</button>
        <button onClick={() => viewport.current?.setView('side')}>侧面</button>
        <button onClick={() => viewport.current?.setView('back')}>背面</button>
        <button onClick={() => viewport.current?.setView('top')}>俯视</button>
      </div>}
      {message && <p className="maker-problem" role="alert">{message}</p>}
      {loading && <p className="maker-loading" role="status">正在渲染「{loading}」…</p>}
      <p id="maker-hint" className="maker-hint">{kind === '2d' ? '拖动平移 · 滚轮按整数倍缩放'
        : mode === 'orbit' ? '左键环绕 · 右键平移 · 滚轮缩放' : '左键拖动转向 · WASD 移动 · Q 降 / E 升'}</p>
    </div>
    <div className="maker-transport">
      <button aria-label={playing ? '暂停' : '播放'} disabled={!spec}
        onClick={() => viewport.current?.setPlaying(!playing)}>{playing ? <IconPause /> : <IconPlayArrow />}</button>
      <button aria-label="回到首帧" disabled={!spec} onClick={() => viewport.current?.seek(0)}><IconSkipPrevious /></button>
      <input aria-label="预览帧" type="range" min={0} max={Math.max(0, (spec?.frames ?? 1) - 1)} value={frame}
        disabled={!spec} onChange={e => viewport.current?.seek(Number(e.target.value))} />
      <span className="maker-count">{spec ? `${frame + 1} / ${spec.frames}` : '–'}</span>
      {spec && <span className="maker-spec">{spec.canvas.slice(2).join(' × ')} px <i>·</i> {spec.fps} FPS <i>·</i> {spec.loop ? '循环' : '单次播放'}</span>}
      {kind === '2d'
        ? <div className="maker-zoom" role="group" aria-label="缩放">
          <button aria-label="缩小" onClick={() => viewport.current?.zoomBy(-1)}><IconMinus /></button>
          <output aria-label="缩放倍数">{zoom}×</output>
          <button aria-label="放大" onClick={() => viewport.current?.zoomBy(1)}><IconPlus /></button>
        </div>
        : <label className="maker-fov">视野
          <input aria-label="相机视野" type="range" min="25" max="80" value={fov}
            onChange={e => changeFov(Number(e.target.value))} />
          <output>{fov}°</output>
        </label>}
    </div>
  </div>
}

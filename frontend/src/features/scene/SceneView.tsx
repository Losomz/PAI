import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  IconCompass, IconDragArrow, IconLayout, IconMinus, IconMoon, IconMosaic, IconPause, IconPlayArrow, IconPlus,
  IconRefresh, IconRotateRight,
} from '@arco-design/web-react/icon'
import { initialFov, mountViewport, type CameraMode, type EffectVersion, type ViewKind } from './viewport'
import { sceneEffects, volumeFor, type Sheet } from './effects/registry'
import EffectPicker, { type Choice } from './EffectPicker'
import { errorText, type Preview } from '../animations/types'
import './scene.css'

// Without the desktop app (a plain browser) there is no library, only the effects that have 3D versions.
const builtIns: Choice[] = sceneEffects.map(effect => ({
  key: effect.key, id: effect.id, name: effect.name, animation: null, effect,
}))
// An animation that does not say where it stands stands on the middle of its bottom edge.
const sheetOf = (preview: Preview): Sheet => ({ url: preview.image, spec: {
  fps: preview.fps, frames: preview.frames, columns: preview.columns, frameSize: [preview.width, preview.height],
  pivot: preview.origin ?? [preview.width / 2, preview.height],
} })

export default function SceneView() {
  const library = window.pai?.animations
  const [params] = useSearchParams()
  const wanted = params.get('animation')
  const host = useRef<HTMLDivElement>(null)
  const viewport = useRef<ReturnType<typeof mountViewport> | null>(null)
  const [choices, setChoices] = useState<Choice[]>(library ? [] : builtIns)
  const [selected, setSelected] = useState(library ? '' : builtIns[0].key)
  const [generation, setGeneration] = useState(0)
  const [loading, setLoading] = useState('')
  const [kind, setKind] = useState<ViewKind>('2d')
  const kindNow = useRef<ViewKind>('2d')
  const [mode, setMode] = useState<CameraMode>('orbit')
  const [grid, setGrid] = useState(true)
  const [floor, setFloor] = useState(true)
  const [hasFloor, setHasFloor] = useState(false)
  const [dark, setDark] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [version, setVersion] = useState<EffectVersion>('flat')
  const [fov, setFov] = useState(initialFov)
  const [zoom, setZoom] = useState(3)
  const [error, setError] = useState('')
  // What the viewport shows, so a library change only re-renders an animation whose source changed.
  const shown = useRef({ key: '', revision: '' })
  const choice = choices.find(item => item.key === selected) ?? null
  // The buttons follow what is on screen, which lags the choice while a library animation renders.
  const [showing, setShowing] = useState<Choice | null>(null)

  useEffect(() => {
    if (!host.current) return
    try {
      const current = mountViewport(host.current, setError, setZoom)
      viewport.current = current
      shown.current = { key: '', revision: '' }
      setHasFloor(current.hasFloor)
      return () => {
        current.dispose()
        viewport.current = null
        void library?.cancelPreview().catch(() => {})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [library])

  // Edits to the library (by hand or by an agent) show up here as they are saved.
  useEffect(() => library?.onChange(() => setGeneration(n => n + 1)), [library])
  useEffect(() => {
    if (!library) return
    let active = true
    library.list().then(({ items }) => {
      if (!active) return
      const next = items.map(item => ({
        key: item.id, id: item.id, name: item.name, animation: item.id, effect: volumeFor(item.template),
      }))
      setChoices(next)
      setSelected(old => next.some(item => item.key === old) ? old : (next.find(item => item.key === wanted) ??
        next.find(item => item.id === sceneEffects[0].id) ?? next.find(item => item.effect) ?? next[0])?.key ?? '')
    }).catch(err => {
      if (!active) return
      setError(errorText(err))
      setChoices(builtIns)
      setSelected(old => old || builtIns[0].key)
    })
    return () => { active = false }
  }, [library, generation, wanted])

  useEffect(() => {
    const current = viewport.current
    if (!choice || !current) return
    // A new effect opens as its 3D version in the 3D view, as the original in 2D.
    function show(sheet: Sheet, revision: string) {
      if (!choice || !current) return
      const next = kindNow.current === '3d' && choice.effect ? 'volume' : 'flat'
      current.setSubject({ sheet, effect: choice.effect }, next)
      setVersion(next)
      setShowing(choice)
      shown.current = { key: choice.key, revision }
    }
    const api = library, id = choice.animation
    if (!api || !id) {
      if (shown.current.key !== choice.key && choice.effect) show(choice.effect.sheet, '')
      return
    }
    let active = true
    api.read(id).then(async record => {
      if (!active) return
      if (shown.current.key === choice.key && shown.current.revision === record.revision) { setLoading(''); return }
      setLoading(choice.name)
      const preview = await api.preview(id, record.revision)
      if (!active) return
      show(sheetOf(preview), record.revision)
      setError('')
    }).catch(err => { if (active) setError(errorText(err)) })
      .finally(() => { if (active) setLoading('') })
    return () => { active = false }
  }, [choice, library])

  function changeKind(next: ViewKind) {
    if (next === kind) return
    viewport.current?.setKind(next)
    kindNow.current = next
    setKind(next)
    changeVersion(next === '3d' && showing?.effect ? 'volume' : 'flat')
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
  function changeVersion(value: EffectVersion) {
    if (value === version) return
    viewport.current?.setVersion(value)
    setVersion(value)
    setError('')
  }
  function resetView() {
    if (kind === '3d') changeFov(initialFov)
    viewport.current?.reset()
  }
  return <section className="scene-view">
    <header className="scene-header">
      <h1>3D 场景</h1>
      <EffectPicker choices={choices} selected={selected} onSelect={key => { setSelected(key); setError('') }} />
      <div className="scene-header-actions">
        <div className="scene-modes" role="group" aria-label="视图">
          <button aria-pressed={kind === '2d'} onClick={() => changeKind('2d')}>2D 视图</button>
          <button aria-pressed={kind === '3d'} onClick={() => changeKind('3d')}>3D 视图</button>
        </div>
        {kind === '3d' && <div className="scene-modes" role="group" aria-label="相机模式">
          <button aria-pressed={mode === 'orbit'} onClick={() => changeMode('orbit')}><IconRotateRight /> 环绕</button>
          <button aria-pressed={mode === 'fly'} onClick={() => changeMode('fly')}><IconCompass /> 自由漫游</button>
        </div>}
        <button className="scene-reset" onClick={resetView}><IconRefresh /> 重置视角</button>
      </div>
    </header>
    <div className="scene-panel">
      <div className="scene-stage">
        <div ref={host} className="scene-viewport" tabIndex={0} role="region" aria-label="交互式 3D 场景"
          aria-describedby="scene-instructions" data-view={kind} data-effect={showing?.id} />
        {error && <p className="scene-error" role="alert">无法显示场景：{error}</p>}
        {loading && <p className="scene-loading" role="status">正在渲染「{loading}」…</p>}
        {kind === '3d' && <div className="scene-presets" role="group" aria-label="预设视角">
          <button onClick={() => viewport.current?.setView('front')}>正面</button>
          <button onClick={() => viewport.current?.setView('side')}>侧面</button>
          <button onClick={() => viewport.current?.setView('back')}>背面</button>
          <button onClick={() => viewport.current?.setView('top')}>俯视</button>
        </div>}
        {kind === '3d' && showing && !showing.effect &&
          <p className="scene-note">这个特效还没有立体版本，3D 视图里立着的是原版</p>}
        <div className="scene-toggles">
          <button aria-pressed={dark} onClick={() => {
            viewport.current?.setDark(!dark)
            setDark(!dark)
          }}><IconMoon /> 暗场</button>
          {hasFloor && kind === '3d' && <button aria-pressed={floor} onClick={() => {
            viewport.current?.setFloor(!floor)
            setFloor(!floor)
          }}><IconLayout /> 地板</button>}
          <button aria-pressed={grid} onClick={() => {
            viewport.current?.setGrid(!grid)
            setGrid(!grid)
          }}><IconMosaic /> 网格</button>
        </div>
      </div>
      <footer className="scene-footer">
        <div className="scene-modes" role="group" aria-label="特效版本">
          <button aria-pressed={version === 'flat'} onClick={() => changeVersion('flat')}>原版</button>
          <button aria-pressed={version === 'volume'} disabled={!showing?.effect}
            title={showing?.effect ? undefined : '这个特效还没有立体版本'} onClick={() => changeVersion('volume')}>立体版</button>
        </div>
        <button className="scene-playback" onClick={() => {
          viewport.current?.setPlaying(!playing)
          setPlaying(!playing)
        }}>{playing ? <IconPause /> : <IconPlayArrow />}{playing ? '暂停特效' : '播放特效'}</button>
        <span id="scene-instructions"><IconDragArrow /> {kind === '2d' ? '拖动平移 · 滚轮按整数倍缩放'
          : mode === 'orbit' ? '左键环绕 · 右键平移 · 滚轮缩放' : '左键拖动转向 · WASD 移动 · Q 降 / E 升'}</span>
        {kind === '2d'
          ? <div className="scene-zoom" role="group" aria-label="缩放">
            <button aria-label="缩小" onClick={() => viewport.current?.zoomBy(-1)}><IconMinus /></button>
            <output aria-label="缩放倍数">{zoom}×</output>
            <button aria-label="放大" onClick={() => viewport.current?.zoomBy(1)}><IconPlus /></button>
          </div>
          : <label className="scene-fov">视野
            <input aria-label="相机视野" type="range" min="25" max="80" value={fov}
              onChange={e => changeFov(Number(e.target.value))} />
            <output>{fov}°</output>
          </label>}
      </footer>
    </div>
  </section>
}

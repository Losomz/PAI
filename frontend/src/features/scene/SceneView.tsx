import { useEffect, useRef, useState } from 'react'
import {
  IconCompass, IconDragArrow, IconLayout, IconMoon, IconMosaic, IconPause, IconPlayArrow, IconRefresh, IconRotateRight,
} from '@arco-design/web-react/icon'
import { initialFov, mountViewport, type CameraMode, type EffectVersion } from './viewport'
import { sceneEffects } from './effects/registry'
import './scene.css'

export default function SceneView() {
  const host = useRef<HTMLDivElement>(null)
  const viewport = useRef<ReturnType<typeof mountViewport> | null>(null)
  const [mode, setMode] = useState<CameraMode>('orbit')
  const [grid, setGrid] = useState(true)
  const [floor, setFloor] = useState(true)
  const [hasFloor, setHasFloor] = useState(false)
  const [dark, setDark] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [effect, setEffect] = useState(sceneEffects[0].key)
  const [version, setVersion] = useState<EffectVersion>('volume')
  const [fov, setFov] = useState(initialFov)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!host.current) return
    try {
      const current = mountViewport(host.current, setError)
      viewport.current = current
      setHasFloor(current.hasFloor)
      return () => { current.dispose(); viewport.current = null }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

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
  function changeEffect(value: string) {
    if (value === effect) return
    viewport.current?.setEffect(value)
    setEffect(value)
    setError('')
  }
  function resetView() {
    changeFov(initialFov)
    viewport.current?.setView('home')
  }
  return <section className="scene-view">
    <header className="scene-header">
      <h1>3D 场景</h1>
      <div className="scene-modes scene-effects" role="group" aria-label="特效">
        {sceneEffects.map(item => <button key={item.key} title={item.id} aria-pressed={effect === item.key}
          onClick={() => changeEffect(item.key)}>{item.name}</button>)}
      </div>
      <div className="scene-header-actions">
        <div className="scene-modes" role="group" aria-label="相机模式">
          <button aria-pressed={mode === 'orbit'} onClick={() => changeMode('orbit')}><IconRotateRight /> 环绕</button>
          <button aria-pressed={mode === 'fly'} onClick={() => changeMode('fly')}><IconCompass /> 自由漫游</button>
        </div>
        <button className="scene-reset" onClick={resetView}><IconRefresh /> 重置视角</button>
      </div>
    </header>
    <div className="scene-panel">
      <div className="scene-stage">
        <div ref={host} className="scene-viewport" tabIndex={0} role="region" aria-label="交互式 3D 场景"
          aria-describedby="scene-instructions" />
        {error && <p className="scene-error" role="alert">无法显示场景：{error}</p>}
        <div className="scene-presets" role="group" aria-label="预设视角">
          <button onClick={() => viewport.current?.setView('front')}>正面</button>
          <button onClick={() => viewport.current?.setView('side')}>侧面</button>
          <button onClick={() => viewport.current?.setView('back')}>背面</button>
          <button onClick={() => viewport.current?.setView('top')}>俯视</button>
        </div>
        <div className="scene-toggles">
          <button aria-pressed={dark} onClick={() => {
            viewport.current?.setDark(!dark)
            setDark(!dark)
          }}><IconMoon /> 暗场</button>
          {hasFloor && <button aria-pressed={floor} onClick={() => {
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
          <button aria-pressed={version === 'volume'} onClick={() => changeVersion('volume')}>立体 3D</button>
          <button aria-pressed={version === 'flat'} onClick={() => changeVersion('flat')}>原版 2D</button>
        </div>
        <button className="scene-playback" onClick={() => {
          viewport.current?.setPlaying(!playing)
          setPlaying(!playing)
        }}>{playing ? <IconPause /> : <IconPlayArrow />}{playing ? '暂停特效' : '播放特效'}</button>
        <span id="scene-instructions"><IconDragArrow /> {mode === 'orbit'
          ? '左键环绕 · 右键平移 · 滚轮缩放' : '左键拖动转向 · WASD 移动 · Q 降 / E 升'}</span>
        <label className="scene-fov">视野
          <input aria-label="相机视野" type="range" min="25" max="80" value={fov}
            onChange={e => changeFov(Number(e.target.value))} />
          <output>{fov}°</output>
        </label>
      </footer>
    </div>
  </section>
}

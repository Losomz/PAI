import { useEffect, useMemo, useRef, useState } from 'react'
import { IconDown, IconSearch } from '@arco-design/web-react/icon'
import type { SceneEffect } from './effects/registry'

/** Something to show: a library animation, or one of the built-in effects when there is no library. */
export interface Choice { key: string; id: string; name: string; animation: string | null; effect: SceneEffect | null }

export default function EffectPicker({ choices, selected, onSelect }: {
  choices: Choice[]; selected: string; onSelect(key: string): void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const current = choices.find(choice => choice.key === selected)
  const query = search.trim().toLowerCase()
  // The ones that also open in 3D come first.
  const shown = useMemo(() => choices.filter(choice => (choice.name + ' ' + choice.id).toLowerCase().includes(query))
    .sort((a, b) => Number(!!b.effect) - Number(!!a.effect)), [choices, query])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  function pick(key: string) {
    onSelect(key)
    setOpen(false)
  }
  return <div className="scene-picker" ref={root} onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
    <button className="scene-picker-current" aria-label="选择特效" aria-haspopup="dialog" aria-expanded={open}
      disabled={!choices.length} onClick={() => setOpen(!open)}>
      <span><strong>{current?.name ?? '正在载入特效…'}</strong><small>{current?.id}</small></span><IconDown />
    </button>
    {open && <div className="scene-picker-panel" role="dialog" aria-label="选择特效">
      <label className="scene-search"><IconSearch />
        <input type="search" autoFocus aria-label="搜索特效" placeholder="搜索名称或 ID" value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && shown[0]) pick(shown[0].key) }} />
      </label>
      <div className="scene-picker-list" role="listbox" aria-label="特效">
        {shown.map(choice => <button key={choice.key} role="option" aria-selected={choice.key === selected}
          onClick={() => pick(choice.key)}>
          <span><strong>{choice.name}</strong><small>{choice.id}</small></span>{choice.effect && <em>立体</em>}
        </button>)}
        {!shown.length && <p>没有匹配的特效</p>}
      </div>
    </div>}
  </div>
}

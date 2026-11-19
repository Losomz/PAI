import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@arco-design/web-react'
import { useNavigate } from 'react-router-dom'
import { IconCode, IconCopy, IconDelete, IconDownload, IconEye, IconFile, IconFolder, IconPlus, IconSearch } from '@arco-design/web-react/icon'
import AnimationPreview from './AnimationPreview'
import CreateAnimation from './CreateAnimation'
import { errorText, type AnimationInventory, type AnimationRecord } from './types'
import './animations.css'

const api = () => window.pai.animations
export default function AnimationLibraryView() {
  const [inventory, setInventory] = useState<AnimationInventory | null>(null)
  const [selected, setSelected] = useState('')
  const [record, setRecord] = useState<AnimationRecord | null>(null)
  const [generation, setGeneration] = useState(0)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('')
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [create, setCreate] = useState<'blank' | 'template' | null>(null)
  const [remove, setRemove] = useState<AnimationRecord | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const selectedRow = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const refresh = useCallback(() => setGeneration(n => n + 1), [])

  useEffect(() => api().onChange(refresh), [refresh])
  useEffect(() => {
    let active = true
    api().list().then(data => {
      if (!active) return
      setInventory(data)
      setSelected(old => data.items.some(item => item.id === old) ? old
        : (data.items.find(item => item.id === 'fire/torch') ?? data.items[0])?.id ?? '')
    }).catch(err => { if (active) setError(errorText(err)) })
    return () => { active = false }
  }, [generation])
  useEffect(() => {
    if (!selected) { setRecord(null); return }
    let active = true
    api().read(selected).then(data => {
      if (!active) return
      setRecord(old => old?.id === data.id && old.revision === data.revision ? old : data)
      setError('')
    }).catch(err => { if (active) { setRecord(null); setError(errorText(err)) } })
    return () => { active = false }
  }, [selected, generation])

  const groups = useMemo(() => [...new Set(inventory?.items.map(item => item.id.split('/')[0]))], [inventory])
  const items = useMemo(() => inventory?.items.filter(item =>
    (!group || item.id.startsWith(group + '/')) && (item.name + ' ' + item.id).toLowerCase().includes(search.trim().toLowerCase())
  ) ?? [], [inventory, group, search])
  const current = selected === record?.id ? record : null
  useEffect(() => { selectedRow.current?.scrollIntoView({ block: 'nearest' }) }, [selected, inventory?.items.length])
  function open(id: string) {
    setNotice(''); setError(''); setSelected(id); setTab('preview')
  }
  async function action(fn: () => Promise<string | undefined>) {
    setWorking(true); setError(''); setNotice('')
    try { setNotice((await fn()) ?? '') }
    catch (err) { setError(errorText(err)) }
    finally { setWorking(false) }
  }
  return <section className="animations">
    <header className="anim-header"><h1>动画库</h1>
      <div className="anim-actions">
        <button disabled={!inventory?.templates.length} onClick={() => setCreate('template')}><IconFolder /> 从素材添加</button>
        <button className="anim-primary" disabled={!inventory} onClick={() => setCreate('blank')}><IconPlus /> 新建动画</button>
      </div>
    </header>
    <div className="anim-workspace">
      <aside className="anim-index" aria-label="动画列表">
        <div className="anim-filters">
          <label className="anim-search"><IconSearch /><input type="search" aria-label="搜索动画" placeholder="搜索动画或 ID" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <div className="anim-categories"><select aria-label="动画分类" value={group} onChange={e => setGroup(e.target.value)}>
            <option value="">全部分类</option>{groups.map(g => <option key={g}>{g}</option>)}
          </select><span>{items.length} 项</span></div>
        </div>
        <div className="anim-list">
          {items.map(item => <button key={item.id} aria-pressed={item.id === selected} ref={item.id === selected ? selectedRow : undefined} onClick={() => open(item.id)}>
            <strong>{item.name}</strong><small>{item.id}</small>
          </button>)}
          {!items.length && <p>{!inventory ? '正在载入动画库…' : inventory.items.length ? '没有匹配的动画' : '动画库为空'}</p>}
        </div>
      </aside>
      <main className="anim-detail">
        {current ? <>
          <header className="anim-detail-head"><div><small>{current.id}</small><h2>{current.name}</h2></div>
            <button aria-label={'移除 ' + current.name} title="从库中移除" disabled={working} onClick={() => setRemove(current)}><IconDelete /></button>
          </header>
          <div className="anim-tabs"><div role="tablist" aria-label="动画视图">
            <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>动画预览</button>
            <button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}><IconCode /> 源代码</button>
          </div><div><button className="anim-export" onClick={() => navigate('/scene?animation=' + encodeURIComponent(current.id))}>
            <IconEye /> 在场景中查看</button><button className="anim-export" disabled={working} onClick={() => action(async () => {
            const result = await api().export(current.id, current.revision)
            return result ? '已导出到 ' + result.directory : undefined
          })}><IconDownload /> 导出精灵图</button></div></div>
          <div role="tabpanel">{tab === 'preview' ? <AnimationPreview key={current.id + current.revision} item={current} />
            : <pre className="anim-code" tabIndex={0} aria-label="动画源代码"><code>{current.code}</code></pre>}</div>
          <div className="anim-file"><div><IconFile /><div><strong>animation.js</strong><span title={current.codePath}>{current.codePath}</span></div></div>
            <div className="anim-file-actions">
              <button onClick={() => action(async () => { await api().copyPath(current.id); return '已复制源码路径' })}><IconCopy /> 复制路径</button>
              <button onClick={() => action(async () => { await api().reveal(current.id); return undefined })}><IconFolder /> 打开目录</button>
            </div>
          </div>
        </> : <div className="anim-idle">{inventory?.items.length === 0 ? '新建动画或从素材添加，开始建立你的库。' : '正在读取动画…'}</div>}
        {error && <p role="alert" className="anim-message">{error}</p>}
        {notice && <p role="status" className="anim-message">{notice}</p>}
      </main>
    </div>
    {create && inventory && <CreateAnimation inventory={inventory} fromTemplate={create === 'template'} close={() => setCreate(null)}
      onCreate={item => { setCreate(null); setGroup(''); setSearch(''); setRecord(item); open(item.id); refresh() }} />}
    {remove && <Modal visible title="从动画库移除" okText="移除动画" cancelText="取消" okButtonProps={{ status: 'danger' }}
      confirmLoading={working} onCancel={() => setRemove(null)} onOk={() => action(async () => {
        try {
          await api().remove(remove.id, remove.revision)
          refresh()
          return '已移除 ' + remove.name
        } finally { setRemove(null) }
      })}>
      <p>移除「{remove.name}」后，源码会移到本地动画库的 .trash 目录。</p>
    </Modal>}
  </section>
}

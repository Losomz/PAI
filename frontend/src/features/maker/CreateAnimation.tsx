import { useState } from 'react'
import { Modal } from '@arco-design/web-react'
import { errorText, type AnimationInventory, type AnimationRecord } from './types'

export default function CreateAnimation({ inventory, fromTemplate, close, onCreate }: {
  inventory: AnimationInventory; fromTemplate: boolean; close(): void; onCreate(item: AnimationRecord): void
}) {
  const first = inventory.templates.find(t => !inventory.items.some(item => item.id === t.id)) ?? inventory.templates[0]
  const [template, setTemplate] = useState(first?.id ?? '')
  const [name, setName] = useState(fromTemplate ? first?.name ?? '' : '')
  const makeId = (source: string) => inventory.items.some(item => item.id === source)
    ? 'custom/' + source.split('/')[1] + '-' + crypto.randomUUID().slice(0, 6) : source
  const [id, setId] = useState(() => fromTemplate && first ? makeId(first.id) : 'custom/clip-' + crypto.randomUUID().slice(0, 6))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = inventory.templates.filter(t => (t.id + ' ' + t.name).toLowerCase().includes(query.trim().toLowerCase()))
  function choose(value: string) {
    setTemplate(value)
    const selected = inventory.templates.find(t => t.id === value)
    setName(selected?.name ?? '')
    if (selected) setId(makeId(value))
  }
  async function save() {
    setBusy(true); setError('')
    try {
      const item = await window.pai.animations.create({ id: id.trim(), name: name.trim(), template: fromTemplate ? template : undefined })
      onCreate(item)
    } catch (err) { setError(errorText(err)) }
    finally { setBusy(false) }
  }
  return <Modal visible title={fromTemplate ? '从素材添加特效' : '新建特效'} onCancel={close}
    maskClosable={!busy} closable={!busy} escToExit={!busy} onOk={save}
    okText={fromTemplate ? '添加特效' : '创建特效'} cancelText="取消" confirmLoading={busy}
    okButtonProps={{ disabled: !name.trim() || !id.trim() || (fromTemplate && !options.some(t => t.id === template)) }}>
    <form className="maker-form" onSubmit={e => { e.preventDefault(); if (!busy && name.trim()) void save() }}>
      {fromTemplate && <>
        <label>搜索素材<input value={query} placeholder="名称或特效 ID" onChange={e => {
          const q = e.target.value; setQuery(q)
          const hit = inventory.templates.find(t => (t.id + ' ' + t.name).toLowerCase().includes(q.trim().toLowerCase()))
          choose(hit?.id ?? '')
        }} /></label>
        <label>官方素材<select value={template} onChange={e => choose(e.target.value)}>
          {options.map(t => <option key={t.id} value={t.id}>{t.name} · {t.id}</option>)}
        </select></label>
      </>}
      <label>特效名称<input autoFocus={!fromTemplate} value={name} maxLength={120} placeholder="例如 月光粒子" onChange={e => setName(e.target.value)} /></label>
      <label>特效 ID<input value={id} onChange={e => setId(e.target.value)} spellCheck={false} /></label>
      <p>创建后可把源码路径交给 AI，修改保存后预览会自动刷新。</p>
      {error && <p role="alert">{error}</p>}
    </form>
  </Modal>
}

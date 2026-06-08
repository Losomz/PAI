import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Card,
  Space,
  Button,
  Input,
  Modal,
  Form,
  Tag,
  Spin,
  Message,
  Popconfirm,
} from '@arco-design/web-react'
import {
  IconSync,
  IconPlus,
  IconFolder,
  IconDelete,
  IconEdit,
  IconRight,
} from '@arco-design/web-react/icon'

// ── Types ──

interface SyncRecord {
  id: string
  name: string
  from_path: string
  to_path: string
  ref_name: string | null
  created_at: string
}

// ── Helpers ──

function isRemoteUrl(path: string): boolean {
  const p = path.toLowerCase()
  return (
    p.startsWith('http://') ||
    p.startsWith('https://') ||
    p.startsWith('git://') ||
    p.startsWith('ssh://')
  )
}

function displayFrom(raw: string): { repo: string; sub: string | null } {
  if (isRemoteUrl(raw)) {
    const idx = raw.indexOf('::')
    if (idx >= 0) {
      return { repo: raw.substring(0, idx), sub: raw.substring(idx + 2) }
    }
    return { repo: raw, sub: null }
  }
  return { repo: raw, sub: null }
}

// ── Component ──

export default function SyncView() {
  const [records, setRecords] = useState<SyncRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formRepoUrl, setFormRepoUrl] = useState('')
  const [formSubPath, setFormSubPath] = useState('')
  const [formRefName, setFormRefName] = useState('')
  const [formTo, setFormTo] = useState('')
  const [saving, setSaving] = useState(false)

  const isRemoteMode = useMemo(() => {
    const url = formRepoUrl.trim().toLowerCase()
    return (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('git://') ||
      url.startsWith('ssh://')
    )
  }, [formRepoUrl])

  // ── Methods ──

  async function loadRecords() {
    setLoading(true)
    try {
      const list = await invoke<SyncRecord[]>('list_sync_records')
      setRecords(list)
    } catch (e) {
      console.error('加载记录失败:', e)
      Message.error('加载记录失败: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingId(null)
    setFormName('')
    setFormRepoUrl('')
    setFormSubPath('')
    setFormRefName('')
    setFormTo('')
    setShowModal(true)
  }

  function openEdit(record: SyncRecord) {
    setEditingId(record.id)
    setFormName(record.name)

    const raw = record.from_path
    if (isRemoteUrl(raw)) {
      const idx = raw.indexOf('::')
      if (idx >= 0) {
        setFormRepoUrl(raw.substring(0, idx))
        setFormSubPath(raw.substring(idx + 2))
      } else {
        setFormRepoUrl(raw)
        setFormSubPath('')
      }
    } else {
      setFormRepoUrl(raw)
      setFormSubPath('')
    }

    setFormRefName(record.ref_name || '')
    setFormTo(record.to_path)
    setShowModal(true)
  }

  function buildFromPath(): string {
    const url = formRepoUrl.trim()
    const sub = formSubPath.trim()
    if (sub) return url + '::' + sub
    return url
  }

  async function saveRecord() {
    const name = formName.trim()
    const toPath = formTo.trim()
    const repoUrl = formRepoUrl.trim()

    if (!name) {
      Message.warning('请输入名称')
      return
    }
    if (!repoUrl) {
      Message.warning('请输入源路径或仓库地址')
      return
    }
    if (!toPath) {
      Message.warning('请选择目标路径')
      return
    }

    const fromPath = buildFromPath()
    const refName = formRefName.trim() || null

    setSaving(true)
    try {
      await invoke<SyncRecord>('save_sync_record', {
        id: editingId,
        name,
        fromPath,
        toPath,
        refName,
      })
      Message.success(editingId ? '已更新' : '已创建')
      setShowModal(false)
      await loadRecords()
    } catch (e) {
      console.error('保存失败:', e)
      Message.error('保存失败: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord(id: string) {
    try {
      await invoke('delete_sync_record', { id })
      Message.success('已删除')
      await loadRecords()
    } catch (e) {
      Message.error('删除失败: ' + String(e))
    }
  }

  async function selectDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择目标目录',
      })
      if (selected && typeof selected === 'string') {
        setFormTo(selected)
      }
    } catch {
      // User cancelled
    }
  }

  async function selectSourceDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择源目录',
      })
      if (selected && typeof selected === 'string') {
        setFormRepoUrl(selected)
      }
    } catch {
      // User cancelled
    }
  }

  async function syncRecord(record: SyncRecord, mode: 'full' | 'incremental') {
    setSyncingId(record.id)
    try {
      const result = await invoke<{
        from: string
        to: string
        skipped: boolean
        error?: string
      }>('sync_direct', {
        fromPath: record.from_path,
        toPath: record.to_path,
        refName: record.ref_name,
        syncMode: mode,
      })

      if (result.skipped) {
        Message.info('源与目标相同，已跳过')
      } else if (result.error) {
        Message.error('同步失败: ' + result.error)
      } else {
        Message.success(
          `✓ ${mode === 'full' ? '全量同步' : '增量同步'}完成: ${record.name}`,
        )
      }
    } catch (e) {
      Message.error('同步失败: ' + String(e))
    } finally {
      setSyncingId(null)
    }
  }

  // ── Lifecycle ──

  useEffect(() => {
    loadRecords()
  }, [])

  // ── Render ──

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: 22, fontWeight: 600 }}>
            🔄 同步记录
          </h2>
          <p style={{ margin: 0, color: '#999' }}>
            管理同步任务，点击即可执行。
          </p>
        </div>
        <Button type="primary" icon={<IconPlus />} onClick={openCreate}>
          新建同步
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size={40} />
        </div>
      )}

      {/* Empty state */}
      {!loading && records.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: '#999' }}>
          暂无同步记录，点击右上角新建
        </div>
      )}

      {/* Record list */}
      {!loading &&
        records.map((record) => (
          <Card
            key={record.id}
            style={{ marginBottom: 16 }}
            hoverable
            title={
              <Space align="center" size={8}>
                <span style={{ fontWeight: 600 }}>{record.name}</span>
                {isRemoteUrl(record.from_path) ? (
                  <Tag size="small" color="blue">
                    远程仓库
                  </Tag>
                ) : (
                  <Tag size="small" color="green">
                    本地路径
                  </Tag>
                )}
              </Space>
            }
          >
            {/* Path display */}
            <div
              style={{
                fontFamily: "'Cascadia Code', monospace",
                fontSize: 13,
                marginBottom: 12,
                lineHeight: 1.8,
              }}
            >
              <div>
                <Tag size="small" color="green" style={{ marginRight: 4 }}>
                  源
                </Tag>
                <span style={{ wordBreak: 'break-all' }}>
                  {displayFrom(record.from_path).repo}
                </span>
              </div>
              {displayFrom(record.from_path).sub && (
                <div style={{ paddingLeft: 34, color: '#bbb' }}>
                  📂 {displayFrom(record.from_path).sub}
                </div>
              )}
              {record.ref_name && (
                <div style={{ paddingLeft: 34, color: '#bbb' }}>
                  🔀 {record.ref_name}
                </div>
              )}
              <div style={{ margin: '4px 0' }}>
                <IconRight style={{ color: '#666' }} />
              </div>
              <div>
                <Tag size="small" color="orange" style={{ marginRight: 4 }}>
                  目标
                </Tag>
                <span style={{ wordBreak: 'break-all' }}>{record.to_path}</span>
              </div>
            </div>

            {/* Actions */}
            <Space>
              <Button
                type="primary"
                size="small"
                icon={<IconSync />}
                loading={syncingId === record.id}
                onClick={() => syncRecord(record, 'incremental')}
              >
                增量同步
              </Button>
              <Popconfirm
                title="⚠️ 全量同步可能会导致文件丢失，请确认已做好备份！"
                onOk={() => syncRecord(record, 'full')}
              >
                <Button
                  size="small"
                  icon={<IconSync />}
                  loading={syncingId === record.id}
                >
                  全量同步
                </Button>
              </Popconfirm>
              <Button
                size="small"
                icon={<IconEdit />}
                onClick={() => openEdit(record)}
              >
                编辑
              </Button>
              <Popconfirm
                title={`确定删除「${record.name}」？`}
                onOk={() => deleteRecord(record.id)}
              >
                <Button size="small" status="danger" icon={<IconDelete />}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </Card>
        ))}

      {/* Create / Edit Modal */}
      <Modal
        title={editingId ? '编辑同步记录' : '新建同步记录'}
        visible={showModal}
        onCancel={() => setShowModal(false)}
        maskClosable={false}
        confirmLoading={saving}
        onOk={saveRecord}
        okText={editingId ? '保存' : '创建'}
        cancelText="取消"
        style={{ maxWidth: 520 }}
      >
        <Form layout="vertical">
          <Form.Item label="名称">
            <Input
              value={formName}
              onChange={setFormName}
              placeholder="例如：Agent 模板同步"
            />
          </Form.Item>

          <Form.Item label="源路径 / 仓库地址">
            <Space style={{ width: '100%' }}>
              <Input
                value={formRepoUrl}
                onChange={setFormRepoUrl}
                placeholder="本地路径 或 https://github.com/xxx/yyy.git"
                style={{ flex: 1 }}
              />
              <Button
                icon={<IconFolder />}
                onClick={selectSourceDirectory}
              />
            </Space>
          </Form.Item>

          {isRemoteMode && (
            <Form.Item label="仓库内路径（可选）">
              <Input
                value={formSubPath}
                onChange={setFormSubPath}
                placeholder="例如：agents 或 configs/.pi，留空同步整个仓库"
              />
            </Form.Item>
          )}

          {isRemoteMode && (
            <Form.Item label="分支 / Tag（可选）">
              <Input
                value={formRefName}
                onChange={setFormRefName}
                placeholder="默认 main"
              />
            </Form.Item>
          )}

          <Form.Item label="目标路径">
            <Space style={{ width: '100%' }}>
              <Input
                value={formTo}
                onChange={setFormTo}
                placeholder="同步到的目标目录"
                style={{ flex: 1 }}
              />
              <Button icon={<IconFolder />} onClick={selectDirectory} />
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

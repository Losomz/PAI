<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  NCard,
  NSpace,
  NButton,
  NInput,
  NIcon,
  NPopconfirm,
  NModal,
  NForm,
  NFormItem,
  NEmpty,
  NTag,
  NSpin,
  useMessage,
} from 'naive-ui'
import {
  SyncOutline,
  AddOutline,
  FolderOpenOutline,
  TrashOutline,
  CreateOutline,
  ArrowForwardOutline,
  GitBranchOutline,
} from '@vicons/ionicons5'

// ── Types ──

interface SyncRecord {
  id: string
  name: string
  from_path: string
  to_path: string
  ref_name: string | null
  created_at: string
}

// ── State ──

const message = useMessage()

const records = ref<SyncRecord[]>([])
const loading = ref(true)
const syncingId = ref<string | null>(null)

// Modal state
const showModal = ref(false)
const editingId = ref<string | null>(null)
const formName = ref('')
const formRepoUrl = ref('')
const formSubPath = ref('')
const formRefName = ref('')
const formTo = ref('')
const saving = ref(false)

// Whether the user is in "remote" mode
const isRemoteMode = computed(() => {
  const url = formRepoUrl.value.trim().toLowerCase()
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('git://') ||
    url.startsWith('ssh://')
  )
})

// ── Methods ──

async function loadRecords() {
  loading.value = true
  try {
    records.value = await invoke<SyncRecord[]>('list_sync_records')
  } catch (e) {
    console.error('加载记录失败:', e)
    message.error('加载记录失败: ' + String(e))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  formName.value = ''
  formRepoUrl.value = ''
  formSubPath.value = ''
  formRefName.value = ''
  formTo.value = ''
  showModal.value = true
}

function openEdit(record: SyncRecord) {
  editingId.value = record.id
  formName.value = record.name

  // Parse from_path: if it contains "::", split into repo + subpath
  const raw = record.from_path
  if (isRemoteUrl(raw)) {
    const idx = raw.indexOf('::')
    if (idx >= 0) {
      formRepoUrl.value = raw.substring(0, idx)
      formSubPath.value = raw.substring(idx + 2)
    } else {
      formRepoUrl.value = raw
      formSubPath.value = ''
    }
  } else {
    formRepoUrl.value = raw
    formSubPath.value = ''
  }

  formRefName.value = record.ref_name || ''
  formTo.value = record.to_path
  showModal.value = true
}

function isRemoteUrl(path: string): boolean {
  const p = path.toLowerCase()
  return p.startsWith('http://') || p.startsWith('https://') || p.startsWith('git://') || p.startsWith('ssh://')
}

/** Build the combined from_path for storage */
function buildFromPath(): string {
  const url = formRepoUrl.value.trim()
  const sub = formSubPath.value.trim()
  if (sub) {
    return url + '::' + sub
  }
  return url
}

async function saveRecord() {
  const name = formName.value.trim()
  const toPath = formTo.value.trim()
  const repoUrl = formRepoUrl.value.trim()

  if (!name) {
    message.warning('请输入名称')
    return
  }
  if (!repoUrl) {
    message.warning('请输入源路径或仓库地址')
    return
  }
  if (!toPath) {
    message.warning('请选择目标路径')
    return
  }

  const fromPath = buildFromPath()
  const refName = formRefName.value.trim() || null

  saving.value = true
  try {
    await invoke<SyncRecord>('save_sync_record', {
      id: editingId.value,
      name,
      fromPath,
      toPath,
      refName,
    })
    message.success(editingId.value ? '已更新' : '已创建')
    showModal.value = false
    await loadRecords()
  } catch (e) {
    console.error('保存失败:', e)
    message.error('保存失败: ' + String(e))
  } finally {
    saving.value = false
  }
}

async function deleteRecord(id: string) {
  try {
    await invoke('delete_sync_record', { id })
    message.success('已删除')
    await loadRecords()
  } catch (e) {
    message.error('删除失败: ' + String(e))
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
      formTo.value = selected
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
      formRepoUrl.value = selected
    }
  } catch {
    // User cancelled
  }
}

async function syncRecord(record: SyncRecord, mode: 'full' | 'incremental') {
  syncingId.value = record.id
  try {
    const result = await invoke<{ from: string; to: string; skipped: boolean; error?: string }>(
      'sync_direct',
      {
        fromPath: record.from_path,
        toPath: record.to_path,
        refName: record.ref_name,
        syncMode: mode,
      },
    )

    if (result.skipped) {
      message.info('源与目标相同，已跳过')
    } else if (result.error) {
      message.error('同步失败: ' + result.error)
    } else {
      message.success(`✓ ${mode === 'full' ? '全量同步' : '增量同步'}完成: ${record.name}`)
    }
  } catch (e) {
    message.error('同步失败: ' + String(e))
  } finally {
    syncingId.value = null
  }
}

/** Pretty-print from_path for display */

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

// ── Lifecycle ──

onMounted(() => {
  loadRecords()
})
</script>

<template>
  <div style="max-width: 800px; margin: 0 auto">
    <!-- Header -->
    <n-space justify="space-between" align="center" style="margin-bottom: 20px">
      <div>
        <h2 style="margin: 0 0 4px 0; font-size: 22px; font-weight: 600">🔄 同步记录</h2>
        <p style="margin: 0; color: #999">管理同步任务，点击即可执行。</p>
      </div>
      <n-button type="primary" @click="openCreate">
        <template #icon><n-icon><AddOutline /></n-icon></template>
        新建同步
      </n-button>
    </n-space>

    <!-- Loading -->
    <n-space v-if="loading" justify="center" style="padding: 48px">
      <n-spin size="large" />
    </n-space>

    <!-- Empty state -->
    <n-empty
      v-else-if="records.length === 0"
      description="暂无同步记录，点击右上角新建"
      style="padding: 64px 0"
    />

    <!-- Record list -->
    <n-space v-else vertical size="large">
      <n-card
        v-for="record in records"
        :key="record.id"
        size="small"
        hoverable
        style="cursor: default"
      >
        <template #header>
          <n-space align="center" :size="8">
            <span style="font-weight: 600">{{ record.name }}</span>
            <n-tag v-if="isRemoteUrl(record.from_path)" size="tiny" :bordered="false" type="info">
              远程仓库
            </n-tag>
            <n-tag v-else size="tiny" :bordered="false" type="success">本地路径</n-tag>
          </n-space>
        </template>

        <!-- Path display -->
        <div
          style="
            font-family: 'Cascadia Code', monospace;
            font-size: 13px;
            margin-bottom: 12px;
            line-height: 1.8;
          "
        >
          <div>
            <n-tag :bordered="false" type="success" size="small" style="margin-right: 4px">源</n-tag>
            <span style="word-break: break-all">{{ displayFrom(record.from_path).repo }}</span>
          </div>
          <div v-if="displayFrom(record.from_path).sub" style="padding-left: 34px; color: #bbb">
            📂 {{ displayFrom(record.from_path).sub }}
          </div>
          <div v-if="record.ref_name" style="padding-left: 34px; color: #bbb">
            <n-icon size="12" style="vertical-align: middle; margin-right: 2px">
              <GitBranchOutline />
            </n-icon>
            {{ record.ref_name }}
          </div>
          <div style="margin-top: 4px">
            <n-icon size="14" style="vertical-align: middle; margin: 0 4px; color: #666">
              <ArrowForwardOutline />
            </n-icon>
          </div>
          <div>
            <n-tag :bordered="false" type="warning" size="small" style="margin-right: 4px">目标</n-tag>
            <span style="word-break: break-all">{{ record.to_path }}</span>
          </div>
        </div>

        <!-- Actions -->
        <n-space>
          <n-button
            type="primary"
            size="small"
            :loading="syncingId === record.id"
            @click="syncRecord(record, 'full')"
          >
            <template #icon><n-icon><SyncOutline /></n-icon></template>
            全量同步
          </n-button>
          <n-button
            type="warning"
            size="small"
            ghost
            :loading="syncingId === record.id"
            @click="syncRecord(record, 'incremental')"
          >
            <template #icon><n-icon><SyncOutline /></n-icon></template>
            增量同步
          </n-button>
          <n-button size="small" @click="openEdit(record)">
            <template #icon><n-icon><CreateOutline /></n-icon></template>
            编辑
          </n-button>
          <n-popconfirm @positive-click="deleteRecord(record.id)">
            <template #trigger>
              <n-button size="small" type="error" ghost>
                <template #icon><n-icon><TrashOutline /></n-icon></template>
                删除
              </n-button>
            </template>
            确定删除「{{ record.name }}」？
          </n-popconfirm>
        </n-space>
      </n-card>
    </n-space>

    <!-- Create / Edit Modal -->
    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="editingId ? '编辑同步记录' : '新建同步记录'"
      style="max-width: 520px"
      :mask-closable="false"
    >
      <n-form label-placement="top">
        <n-form-item label="名称">
          <n-input
            v-model:value="formName"
            placeholder="例如：Agent 模板同步"
          />
        </n-form-item>

        <n-form-item label="源路径 / 仓库地址">
          <n-space align="center" style="width: 100%" :size="8">
            <n-input
              v-model:value="formRepoUrl"
              placeholder="本地路径 或 https://github.com/xxx/yyy.git"
              style="flex: 1"
            />
            <n-button @click="selectSourceDirectory">
              <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
            </n-button>
          </n-space>
        </n-form-item>

        <n-form-item v-if="isRemoteMode" label="仓库内路径（可选）">
          <n-input
            v-model:value="formSubPath"
            placeholder="例如：agents 或 configs/.pi，留空同步整个仓库"
          />
        </n-form-item>

        <n-form-item v-if="isRemoteMode" label="分支 / Tag（可选）">
          <n-input
            v-model:value="formRefName"
            placeholder="默认 main"
          />
        </n-form-item>

        <n-form-item label="目标路径">
          <n-space align="center" style="width: 100%" :size="8">
            <n-input
              v-model:value="formTo"
              placeholder="同步到的目标目录"
              style="flex: 1"
            />
            <n-button @click="selectDirectory">
              <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
            </n-button>
          </n-space>
        </n-form-item>

      </n-form>

      <template #action>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveRecord">
            {{ editingId ? '保存' : '创建' }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

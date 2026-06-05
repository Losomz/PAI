<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  NCard,
  NSpace,
  NButton,
  NInput,
  NTag,
  NCollapse,
  NCollapseItem,
  NCheckbox,
  NCheckboxGroup,
  NSpin,
  NIcon,
  NPopconfirm,
  useMessage,
} from 'naive-ui'
import {
  SyncOutline,
  CloudDownloadOutline,
  FolderOpenOutline,
  RefreshOutline,
} from '@vicons/ionicons5'

// ── 类型定义 ──

interface SyncTarget {
  from: string
  to: string
  after?: string
}

interface SyncPackage {
  name: string
  key: string
  category: string
  entry_name: string
  title: string
  description: string
  commit_scope: string
  targets: SyncTarget[]
}

interface SyncCategory {
  name: string
  title: string
  items: SyncPackage[]
}

interface SyncResultItem {
  from: string
  to: string
  skipped: boolean
  error?: string
}

interface RepoInfo {
  ready: boolean
  commit: string
  branch: string
}

interface GitCommitResult {
  status: string
  reason: string
  message: string
}

// ── 状态 ──

const message = useMessage()

const repoUrl = ref('')
const refName = ref('')
const cacheDir = ref('')

const catalog = ref<SyncCategory[]>([])
const selectedKeys = ref<string[]>([])
const targetDir = ref('')

const loading = ref(false)
const syncing = ref(false)
const logLines = ref<string[]>([])

const repoInfo = ref<RepoInfo | null>(null)

// ── 计算属性 ──

const cacheReady = computed(() => repoInfo.value?.ready ?? false)

const canSync = computed(
  () =>
    !syncing.value &&
    selectedKeys.value.length > 0 &&
    targetDir.value.length > 0 &&
    cacheReady.value,
)

const allPackages = computed(() => catalog.value.flatMap((c) => c.items))

const selectedPackages = computed(() =>
  allPackages.value.filter((pkg) => selectedKeys.value.includes(pkg.key)),
)

// ── 日志 ──

function addLog(line: string) {
  const time = new Date().toLocaleTimeString()
  logLines.value.push(`[${time}] ${line}`)
}

function clearLog() {
  logLines.value = []
}

// ── 方法 ──

async function loadConfig() {
  try {
    const config = await invoke<{ repo_url: string; ref_name: string; cache_dir: string }>(
      'get_default_config',
    )
    // Tauri command 返回的是 Rust 的 serde_json::Value，字段名用 camelCase
    repoUrl.value = (config as any).repoUrl || ''
    refName.value = (config as any).refName || ''
    cacheDir.value = (config as any).cacheDir || ''
  } catch (e) {
    message.error('加载配置失败: ' + String(e))
  }
}

async function loadRepoInfo() {
  try {
    repoInfo.value = await invoke<RepoInfo>('get_repo_info', { cacheDir: cacheDir.value })
  } catch {
    repoInfo.value = null
  }
}

async function loadCatalog() {
  if (!cacheReady.value) return
  try {
    catalog.value = await invoke<SyncCategory[]>('get_sync_catalog', {
      repoRoot: cacheDir.value,
    })
    addLog(`已加载同步目录：${catalog.value.length} 个分类`)
  } catch (e) {
    message.error('加载目录失败: ' + String(e))
    addLog('加载目录失败: ' + String(e))
  }
}

async function updateCache() {
  loading.value = true
  clearLog()
  addLog(`正在更新缓存: ${repoUrl.value}`)
  try {
    await invoke<string>('ensure_repo', {
      repoUrl: repoUrl.value,
      refName: refName.value,
      cacheDir: cacheDir.value,
    })
    addLog('✓ 缓存更新成功')
    await loadRepoInfo()
    await loadCatalog()
    message.success('缓存更新成功')
  } catch (e) {
    const msg = String(e)
    addLog('✗ 缓存更新失败: ' + msg)
    message.error('缓存更新失败: ' + msg)
  } finally {
    loading.value = false
  }
}

async function selectTargetDir() {
  try {
    const selected = await open({ directory: true, multiple: false, title: '选择目标目录' })
    if (selected && typeof selected === 'string') {
      targetDir.value = selected
      addLog(`目标目录: ${selected}`)
    }
  } catch {
    // 用户取消
  }
}

async function syncSelected() {
  if (!canSync.value) return
  syncing.value = true
  addLog('─── 开始同步 ───')

  try {
    // 1. 执行文件同步
    const results = await invoke<SyncResultItem[]>('sync_execute', {
      repoRoot: cacheDir.value,
      projectDir: targetDir.value,
      packages: selectedPackages.value,
    })

    let allOk = true
    for (const r of results) {
      if (r.skipped) {
        addLog(`- 跳过: ${r.from} → ${r.to}`)
      } else if (r.error) {
        addLog(`✗ 失败: ${r.from} → ${r.to}: ${r.error}`)
        allOk = false
      } else {
        addLog(`✓ 已同步: ${r.from} → ${r.to}`)
      }
    }

    // 2. 自动提交
    if (allOk) {
      const commitPaths = results
        .filter((r) => !r.skipped && !r.error)
        .map((r) => r.to)
      const uniquePaths = [...new Set(commitPaths)]

      if (uniquePaths.length > 0) {
        const scope =
          selectedPackages.value.length === 1
            ? selectedPackages.value[0].commit_scope
            : 'tools'
        const commitMsg = `✨ feat(${scope}): 工具升级`
        addLog(`正在提交: ${commitMsg}`)

        try {
          const gitResult = await invoke<GitCommitResult>('git_auto_commit', {
            projectDir: targetDir.value,
            paths: uniquePaths,
            message: commitMsg,
            skipPush: false,
          })
          if (gitResult.status === 'committed-and-pushed') {
            addLog(`✓ 已提交并推送: ${gitResult.message}`)
          } else {
            addLog(`Git: ${gitResult.reason}`)
          }
        } catch (e) {
          addLog(`⚠ 提交失败: ${String(e)}（文件已同步）`)
        }
      }
    }

    addLog('─── 同步完成 ───')
    message.success('同步完成')
  } catch (e) {
    addLog(`✗ 同步失败: ${String(e)}`)
    message.error('同步失败: ' + String(e))
  } finally {
    syncing.value = false
  }
}

async function syncAll() {
  selectedKeys.value = allPackages.value.map((p) => p.key)
  await syncSelected()
}

function selectAll() {
  selectedKeys.value = allPackages.value.map((p) => p.key)
}

function deselectAll() {
  selectedKeys.value = []
}

// ── 生命周期 ──

onMounted(async () => {
  await loadConfig()
  await loadRepoInfo()
  if (cacheReady.value) {
    await loadCatalog()
  }
})
</script>

<template>
  <div style="max-width: 960px; margin: 0 auto">
    <n-h2 style="margin-bottom: 8px">📦 AgentFramework 同步</n-h2>
    <n-p depth="3">从 AgentFramework 仓库同步配置和 Agent 模板到目标项目目录。</n-p>

    <!-- 同步源信息 -->
    <n-card title="同步源" size="small" style="margin-bottom: 16px">
      <n-space vertical>
        <n-space align="center">
          <span style="min-width: 60px">仓库:</span>
          <n-tag size="small" type="info">{{ repoUrl }}</n-tag>
        </n-space>
        <n-space align="center">
          <span style="min-width: 60px">分支:</span>
          <n-tag size="small">{{ refName }}</n-tag>
        </n-space>
        <n-space align="center">
          <span style="min-width: 60px">缓存:</span>
          <n-tag :type="cacheReady ? 'success' : 'warning'" size="small">
            {{ cacheReady ? `就绪 (${repoInfo?.branch} @ ${repoInfo?.commit})` : '未缓存' }}
          </n-tag>
          <n-button
            size="small"
            :loading="loading"
            @click="updateCache"
          >
            <template #icon><n-icon><RefreshOutline /></n-icon></template>
            {{ cacheReady ? '更新缓存' : '拉取缓存' }}
          </n-button>
        </n-space>
      </n-space>
    </n-card>

    <!-- 目标目录 -->
    <n-card title="目标目录" size="small" style="margin-bottom: 16px">
      <n-space align="center">
        <n-input
          :value="targetDir"
          readonly
          placeholder="选择要同步到的目标项目目录"
          style="flex: 1"
        />
        <n-button @click="selectTargetDir">
          <template #icon><n-icon><FolderOpenOutline /></n-icon></template>
          选择目录
        </n-button>
      </n-space>
    </n-card>

    <!-- 可同步内容 -->
    <n-card title="可同步内容" size="small" style="margin-bottom: 16px">
      <template v-if="catalog.length === 0">
        <n-space justify="center" style="padding: 24px">
          <n-spin v-if="loading" />
          <n-p v-else depth="3">
            暂无内容。请先点击「拉取缓存」获取仓库数据。
          </n-p>
        </n-space>
      </template>

      <template v-else>
        <n-space style="margin-bottom: 12px">
          <n-button size="tiny" @click="selectAll">全选</n-button>
          <n-button size="tiny" @click="deselectAll">取消全选</n-button>
        </n-space>

        <n-checkbox-group v-model:value="selectedKeys">
          <n-collapse :default-expanded-names="catalog.map((c) => c.name)">
            <n-collapse-item
              v-for="category in catalog"
              :key="category.name"
              :title="`${category.title}（${category.items.length} 项）`"
              :name="category.name"
            >
              <n-space vertical>
                <n-checkbox
                  v-for="item in category.items"
                  :key="item.key"
                  :value="item.key"
                >
                  <span>{{ item.title }}</span>
                  <span style="color: #999; margin-left: 8px; font-size: 12px">
                    {{ item.description }}
                  </span>
                </n-checkbox>
              </n-space>
            </n-collapse-item>
          </n-collapse>
        </n-checkbox-group>
      </template>
    </n-card>

    <!-- 操作按钮 -->
    <n-space style="margin-bottom: 16px">
      <n-button
        type="primary"
        :loading="syncing"
        :disabled="!canSync"
        @click="syncSelected"
      >
        <template #icon><n-icon><SyncOutline /></n-icon></template>
        同步选中项 ({{ selectedKeys.length }})
      </n-button>
      <n-popconfirm @positive-click="syncAll">
        <template #trigger>
          <n-button :loading="syncing" :disabled="!cacheReady || !targetDir">
            <template #icon><n-icon><CloudDownloadOutline /></n-icon></template>
            全部同步
          </n-button>
        </template>
        确定要同步全部内容吗？这会覆盖目标目录中的同名文件。
      </n-popconfirm>
    </n-space>

    <!-- 同步日志 -->
    <n-card
      v-if="logLines.length > 0"
      title="同步日志"
      size="small"
      style="margin-bottom: 16px"
    >
      <div
        style="
          max-height: 300px;
          overflow-y: auto;
          font-family: 'Cascadia Code', 'Fira Code', monospace;
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
        "
      >
        <div v-for="(line, i) in logLines" :key="i">{{ line }}</div>
      </div>
      <template #action>
        <n-button size="tiny" @click="clearLog">清除日志</n-button>
      </template>
    </n-card>
  </div>
</template>

import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { Modal, Progress, Message } from '@arco-design/web-react'
import { useState, useEffect, useCallback } from 'react'

export function useUpdater() {
  const [progress, setProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)

  const doUpdate = useCallback(async (silent = true) => {
    try {
      const update = await check()

      if (!update?.available) {
        if (!silent) {
          Message.info('当前已是最新版本')
        }
        return
      }

      // 用 Promise 等待用户确认
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '发现新版本',
          content: `当前版本：${update.currentVersion} → 新版本：${update.version}`,
          okText: '立即更新',
          cancelText: '稍后再说',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })

      if (!confirmed) return

      setDownloading(true)
      let downloaded = 0
      let total = 0

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            if (total > 0) {
              setProgress(Math.round((downloaded / total) * 100))
            }
            break
          case 'Finished':
            break
        }
      })

      setDownloading(false)
      await relaunch()
    } catch (e) {
      console.error('更新检查失败:', e)
      Message.error('更新检查失败: ' + String(e))
      setDownloading(false)
    }
  }, [])

  // 启动时自动检查（静默模式）
  useEffect(() => {
    const timer = setTimeout(() => doUpdate(true), 3000)
    return () => clearTimeout(timer)
  }, [doUpdate])

  // Download progress modal
  useEffect(() => {
    if (!downloading) return

    let modalInstance: ReturnType<typeof Modal.info> | null = null

    modalInstance = Modal.info({
      title: '正在下载更新...',
      content: (
        <div>
          <Progress percent={progress} style={{ marginTop: 8 }} />
          <p style={{ textAlign: 'center', color: '#999', marginTop: 8 }}>
            {progress}%
          </p>
        </div>
      ),
      footer: null,
      maskClosable: false,
      closable: false,
    })

    return () => {
      if (modalInstance) {
        modalInstance.close()
      }
    }
  }, [downloading, progress])

  // 返回手动检查更新的方法
  const checkForUpdate = useCallback(() => {
    doUpdate(false)
  }, [doUpdate])

  return {
    checkForUpdate,
    downloading,
    progress,
  }
}

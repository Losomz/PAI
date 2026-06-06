import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { Modal, Progress } from '@arco-design/web-react'
import { useState, useEffect, useCallback } from 'react'

export function useUpdater() {
  const [progress, setProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)

  const doUpdate = useCallback(async () => {
    try {
      const update = await check()

      if (!update?.available) return

      let confirmed = false

      Modal.confirm({
        title: '发现新版本',
        content: `当前版本：${update.currentVersion} → 新版本：${update.version}`,
        okText: '立即更新',
        cancelText: '稍后再说',
        onOk: async () => {
          confirmed = true
        },
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
      setDownloading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(doUpdate, 3000)
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
}

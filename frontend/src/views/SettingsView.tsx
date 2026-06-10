import { Button, Divider } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'

interface SettingsViewProps {
  onCheckUpdate: () => void
  downloading: boolean
}

export default function SettingsView({ onCheckUpdate, downloading }: SettingsViewProps) {
  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>应用设置</h3>

      <Divider />

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ marginBottom: 8 }}>更新</h4>
        <p style={{ color: '#999', marginBottom: 12, fontSize: 13 }}>
          检查是否有新版本可用
        </p>
        <Button
          type="primary"
          icon={<IconRefresh />}
          onClick={onCheckUpdate}
          loading={downloading}
          long
        >
          检查更新
        </Button>
      </div>
    </div>
  )
}

import { getVersion } from '@tauri-apps/api/app'
import { useState, useEffect } from 'react'

export default function HomeView() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    getVersion().then(setVersion)
  }, [])

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1>PAI</h1>
      <p>个人AI工具箱</p>

      <div style={{ marginTop: 'auto', paddingTop: 40, textAlign: 'center', color: '#999' }}>
        {version && <p style={{ fontSize: 12 }}>v{version}</p>}
      </div>
    </div>
  )
}

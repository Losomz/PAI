import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'

export default function HomeView() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.pai.version().then(setVersion)
  }, [])

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1>PAI</h1>
      <p>个人AI工具箱</p>
      <Link to="/maker">打开特效制作器 →</Link>

      <div style={{ marginTop: 'auto', paddingTop: 40, textAlign: 'center', color: '#999' }}>
        {version && <p style={{ fontSize: 12 }}>v{version}</p>}
      </div>
    </div>
  )
}

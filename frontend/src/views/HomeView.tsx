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
      <Link to="/animations">打开动画库 →</Link>
      <Link to="/pixelfx">浏览 PixelFX 原版画廊 →</Link>

      <div style={{ marginTop: 'auto', paddingTop: 40, textAlign: 'center', color: '#999' }}>
        {version && <p style={{ fontSize: 12 }}>v{version}</p>}
      </div>
    </div>
  )
}

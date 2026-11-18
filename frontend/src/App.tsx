import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import HomeView from './views/HomeView'
import SyncView from './views/SyncView'

const PixelFX = lazy(() => import('./views/PixelFXView'))
const Animations = lazy(() => import('./features/animations/AnimationLibraryView'))

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<HomeView />} />
        <Route path="animations" element={<Suspense fallback={<p>正在加载动画库…</p>}><Animations /></Suspense>} />
        <Route path="pixelfx" element={<Suspense fallback={<p>正在加载特效库…</p>}><PixelFX /></Suspense>} />
        <Route path="sync" element={<SyncView />} />
      </Route>
    </Routes>
  )
}

export default App

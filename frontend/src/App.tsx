import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import HomeView from './views/HomeView'
import SyncView from './views/SyncView'

const Maker = lazy(() => import('./features/maker/MakerView'))

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<HomeView />} />
        <Route path="maker" element={<Suspense fallback={<p>正在加载特效制作器…</p>}><Maker /></Suspense>} />
        <Route path="sync" element={<SyncView />} />
      </Route>
    </Routes>
  )
}

export default App

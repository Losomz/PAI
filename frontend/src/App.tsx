import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import HomeView from './views/HomeView'
import SyncView from './views/SyncView'

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<HomeView />} />
        <Route path="sync" element={<SyncView />} />
      </Route>
    </Routes>
  )
}

export default App

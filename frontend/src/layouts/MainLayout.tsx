import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Drawer } from '@arco-design/web-react'
import {
  IconHome,
  IconSync,
  IconLeft,
  IconRight,
  IconSettings,
} from '@arco-design/web-react/icon'
import SettingsView from '../views/SettingsView'
import { useUpdater } from '../composables/useUpdater'

const { Sider, Content } = Layout

const menuItems = [
  { key: '/', label: '首页', icon: <IconHome /> },
  { key: '/sync', label: '同步记录', icon: <IconSync /> },
]

export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const { checkForUpdate, downloading } = useUpdater()

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(val: boolean) => setCollapsed(val)}
        trigger={collapsed ? <IconRight /> : <IconLeft />}
        width={200}
        collapsedWidth={64}
        style={{ borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}
      >
        <div
          style={{
            padding: 16,
            fontSize: 20,
            fontWeight: 'bold',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {collapsed ? 'P' : 'PAI'}
        </div>
        <Menu
          selectedKeys={[location.pathname]}
          onClickMenuItem={(key: string) => navigate(key)}
          collapse={collapsed}
        >
          {menuItems.map((item) => (
            <Menu.Item key={item.key}>
              {item.icon}
              {item.label}
            </Menu.Item>
          ))}
        </Menu>
        <div style={{ flex: 1 }} />
        <div
          style={{
            padding: 16,
            borderTop: '1px solid var(--color-border)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          onClick={() => setSettingsVisible(true)}
        >
          <IconSettings style={{ fontSize: 18 }} />
          {!collapsed && <span style={{ marginLeft: 8 }}>设置</span>}
        </div>
      </Sider>
      <Drawer
        title="设置"
        visible={settingsVisible}
        onCancel={() => setSettingsVisible(false)}
        footer={null}
        width={320}
      >
        <SettingsView
          onCheckUpdate={checkForUpdate}
          downloading={downloading}
        />
      </Drawer>
      <Layout>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

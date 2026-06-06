import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu } from '@arco-design/web-react'
import {
  IconHome,
  IconSync,
  IconLeft,
  IconRight,
} from '@arco-design/web-react/icon'

const { Sider, Content } = Layout

const menuItems = [
  { key: '/', label: '首页', icon: <IconHome /> },
  { key: '/sync', label: '同步记录', icon: <IconSync /> },
]

export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(val: boolean) => setCollapsed(val)}
        trigger={collapsed ? <IconRight /> : <IconLeft />}
        width={200}
        collapsedWidth={64}
        style={{ borderRight: '1px solid var(--color-border)' }}
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
      </Sider>
      <Layout>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

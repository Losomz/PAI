<script setup lang="ts">
import { h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NLayout, NLayoutSider, NLayoutContent, NMenu, NIcon } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { HomeOutline, SyncOutline } from '@vicons/ionicons5'

const router = useRouter()
const collapsed = ref(false)

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions: MenuOption[] = [
  {
    label: '首页',
    key: 'home',
    icon: renderIcon(HomeOutline),
  },
  {
    label: '同步记录',
    key: 'sync',
    icon: renderIcon(SyncOutline),
  },
]

function handleMenuClick(key: string) {
  router.push({ name: key })
}
</script>

<template>
  <n-layout has-sider style="height: 100vh">
    <n-layout-sider
      bordered
      :collapsed="collapsed"
      collapse-mode="width"
      :collapsed-width="64"
      :width="200"
      show-trigger
      @collapse="collapsed = true"
      @expand="collapsed = false"
    >
      <div
        style="
          padding: 16px;
          font-size: 20px;
          font-weight: bold;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
        "
      >
        {{ collapsed ? 'P' : 'PAI' }}
      </div>
      <n-menu
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        :value="String($route.name)"
        @update:value="handleMenuClick"
      />
    </n-layout-sider>
    <n-layout>
      <n-layout-content content-style="padding: 24px;">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

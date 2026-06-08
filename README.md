# PAI - 个人AI工具箱

一个基于 Tauri + React 构建的桌面工具集，支持自动更新。

## 功能

- 🔄 **同步记录管理** — 支持本地路径和远程 Git 仓库的全量/增量同步，一键执行
- 📦 **自动更新** — 应用启动后自动检测新版本，一键下载安装

## 技术栈

- **前端：** React + TypeScript + Arco Design
- **后端：** Rust + Tauri 2
- **打包：** GitHub Actions 自动构建 Windows 安装包
- **更新：** Tauri Updater 签名验证 + 增量更新

## 开发

```bash
# 安装依赖
npm install
cd frontend && npm install && cd ..

# 开发模式
npx tauri dev

# 构建安装包
npx tauri build
```

## 项目结构

```
PAI/
├── frontend/              # React 前端
│   └── src/
│       ├── views/         # 页面组件
│       ├── layouts/       # 布局组件
│       └── composables/   # 通用逻辑（自动更新等）
├── src-tauri/             # Rust 后端
│   └── src/
│       ├── git/           # Git 操作（clone/fetch/commit）
│       ├── sync/          # 同步逻辑（全量/增量）
│       └── records.rs     # 同步记录持久化
├── docs/releases/         # 版本发布说明
└── .github/workflows/     # CI 自动打包
```

## 下载

前往 [Releases](https://github.com/Losomz/PAI/releases) 下载最新版本。

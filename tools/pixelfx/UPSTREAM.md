PixelFX 0.3.1 通过 Git 子模块 `upstream/` 固定在提交 `5294518ce7c72e48b6100a744596e0acf57f2826`。[上游源码](https://github.com/patch-gg/pixelfx/tree/5294518ce7c72e48b6100a744596e0acf57f2826)

桌面窗口加载上游的 `gallery/index.html`。Agent 的普通精灵图导出执行 `tools/render.mjs --sheet`，角色模式使用同一仓库中 `tools/act.mjs` 调用的函数，把结果写入 Agent 指定的目录。

安装包包含原始画廊代码、特效、命令行工具和许可声明。Patch Pixel 字体由作者单独保留权利，安装版通过官方画廊地址加载该字体，离线时使用上游 CSS 声明的后备字体。[字体声明](upstream/gallery/fonts/NOTICE.md)

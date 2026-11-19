PixelFX 0.3.1 通过 Git 子模块 `upstream/` 固定在提交 `5294518ce7c72e48b6100a744596e0acf57f2826`。[上游源码](https://github.com/patch-gg/pixelfx/tree/5294518ce7c72e48b6100a744596e0acf57f2826)

桌面端的特效制作器直接运行上游的特效源码。Agent 的普通精灵图导出执行 `tools/render.mjs --sheet`，角色模式使用同一仓库中 `tools/act.mjs` 调用的函数，把结果写入 Agent 指定的目录。

安装包包含上游的特效、命令行工具和许可声明，不含画廊页面和单独保留权利的 Patch Pixel 字体。

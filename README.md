# PAI 个人 AI 工具箱

PAI 使用 Electron、React 和 TypeScript。桌面端提供可编辑源码的动画库、PixelFX 官方画廊、本地与 Git 仓库同步和 Windows 签名更新。Agent 可以通过 stdio MCP 独立管理和导出动画。

## 运行与打包

使用 Node.js 24 和 npm。从仓库根目录运行：

```sh
git submodule update --init tools/pixelfx/upstream
npm ci
npm --prefix frontend ci
npm run dev
```

`npm run build` 构建离线界面和 MCP 入口，`npm start` 打开构建后的应用。`npm run pack` 或 `build.bat` 在 Windows 生成 `release/windows/PAI-<版本>-Setup.exe`。`npm test` 验证特效、MCP、同步和更新签名，`npm run test:packaged` 验证打包后的实际窗口和无界面导出。

## 动画库

打开侧栏的 **动画库**。首次使用时会从 PixelFX 复制 244 个动画入口，每个作品有自己的目录，包含源码 `animation.js` 和记录名称及素材来源的 `animation.json`。**新建动画**生成可运行的 JS 模块，**从素材添加**可以恢复内置动画或为同一个素材创建独立版本。移除会把该作品移入库内的 `.trash`，重新启动后仍保留此次删减。

默认库在 `~/.agentframework/animations`。把 **复制路径** 得到的文件路径交给 AI，它可以直接修改源码，桌面预览会自动刷新。正在修复的代码即使有语法错误，也能从 **源代码** 标签查看。若要把库放进自己的项目，可为桌面端和 MCP 设置同一个绝对路径环境变量 `PAI_ANIMATION_HOME`。

独立 Node 模块位于 `tools/animation`，提供文件库、隔离执行和 PNG 精灵图导出。自建动画导出 `meta`（包括 `name`、`size`、`fps`、`duration`、`loop`）及 `draw(rgba, time, { width, height })`。每次绘制收到透明的 RGBA8 帧，时间以秒计。PixelFX 副本保留原有的 `draw`、`create`、`act` 接口和相对导入。`animation_read` 返回的 `templatePath` 指向原版入口，可用于查阅依赖。AI 编辑 `codePath` 指向的个人副本。

## PixelFX

打开侧栏的 **PixelFX 原版画廊** 即可使用原版英文画廊。可以搜索或按分类浏览，点击特效查看播放、调色板和镜像等控件。点击 **sprite sheet** 生成精灵图，右键图片可保存 PNG。动画和精灵图均可离线生成。

完整上游仓库位于 `tools/pixelfx/upstream`。在该目录运行 `node tools/render.mjs fire/flamethrower --sheet` 即可直接使用官方命令。Agent 导出会返回精灵图 PNG、帧数据 JSON 和多帧预览图 `contact.png`。[版本与许可](tools/pixelfx/UPSTREAM.md)

## 3D 场景

很多 PixelFX 特效先在代码里算出 3D 位置，再压扁成 2D：倾斜的光环分前后两半来画，球面按朝向决定明暗。**3D 场景** 把这类特效改写成真实的几何体，可以环绕、漫游和调整视野，从任意角度观察。目前有 **传送门**、**全息投影** 和 **奥术法球** 三个。**原版 2D** 会把原版精灵图立在同一位置，方便对比。场景默认使用 PixelFX 自带的夜色和石地背景，发光特效在这种背景下最接近原作；关闭 **暗场** 可切换到浅色背景，**地板** 和 **网格** 可以分别隐藏。

每个立体版本都在 `frontend/src/features/scene/effects/` 下，使用原版的像素尺寸，按 0.04 个场景单位换算 1 像素，所以两个版本大小一致。新增特效时，先参照 `kit.ts` 编写立体版本，在 `registry.ts` 和 `scripts/bake-scene-effects.mjs` 的列表中各登记一次，然后运行 `node scripts/bake-scene-effects.mjs <目录名>` 生成原版对照用的精灵图。

## 连接 Agent

在支持 MCP 的客户端中注册 stdio 服务。开发目录示例：

```json
{
  "mcpServers": {
    "pai": {
      "command": "node",
      "args": ["D:/UGit/PAI/tools/mcp.mjs"]
    }
  }
}
```

安装版也提供可独立启动的入口。将下面两个路径改成实际安装目录；此配置使用随应用安装的 Node 运行时，桌面窗口可以关闭。

```json
{
  "mcpServers": {
    "pai": {
      "command": "C:/实际安装目录/PAI.exe",
      "args": ["C:/实际安装目录/resources/tools/pai-mcp.mjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

AI 通过 `animation_*` 工具操作本地作品。

- `animation_list` 查询当前动画库。传入 `collection: "templates"` 可查询可添加的原版素材。
- `animation_create` 接收 `id` 和 `name`，可选 `template` 或完整 `code`。例如以 `fire/torch` 为模板创建 `custom/blue-torch`。
- `animation_read` 返回源码、文件路径和 `revision`。`animation_update` 接收 `id`、刚读取的 `revision` 和新 `code`，验证模块和首帧后保存。版本冲突时重新读取。
- `animation_render` 以当前源码在无窗口环境渲染，接收 `id` 和绝对路径 `outputDir`，返回透明 PNG 与帧数据 JSON。`animation_delete` 按 `id` 和 `revision` 移除作品。

原有的两个工具直接读取官方素材。

- `pixelfx_list` 按英文名称、分类或标签查询，支持 `query`、`offset` 和 `limit`，返回可用的效果 ID。
- `pixelfx_render` 接受 `id`、绝对路径 `outputDir`，以及可选的 `seed`、`fps`、`flip`、`actor`、`palette`。成功时返回输出路径和帧数。重复调用会生成独立目录。

例如让 Agent 调用 `pixelfx_render`：

```json
{
  "id": "fire/torch",
  "outputDir": "D:/Game/Assets/Effects",
  "seed": 4,
  "fps": 30,
  "palette": ["#0b173e", "#155ca8", "#35bce0", "#aeffff", "#ffffff"]
}
```

## 同步与发布

旧版本的同步记录继续从 `~/.agentframework/sync_records.json` 读取。全量同步替换目标内容，增量同步保留目标中的额外文件；远程源支持 `仓库地址::子路径`、分支或标签。

Windows 发布沿用现有更新源、签名密钥和 `latest.json` 格式。发布流程见 [更新签名](docs/updater-signing.md)。

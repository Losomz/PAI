# PAI 个人 AI 工具箱

PAI 使用 Electron、React 和 TypeScript。桌面端提供可编辑源码的特效制作器、本地与 Git 仓库同步和 Windows 签名更新。Agent 可以通过 stdio MCP 独立管理和导出动画。

## 运行与打包

使用 Node.js 24 和 npm。从仓库根目录运行：

```sh
git submodule update --init tools/pixelfx/upstream
npm ci
npm --prefix frontend ci
npm run dev
```

`npm run build` 构建离线界面和 MCP 入口，`npm start` 打开构建后的应用。`npm run pack` 或 `build.bat` 在 Windows 生成 `release/windows/PAI-<版本>-Setup.exe`。`npm test` 验证特效、MCP、同步和更新签名，`npm run test:packaged` 验证打包后的实际窗口和无界面导出。

## 特效制作器

打开侧栏的 **特效制作器**。首次使用时会从 PixelFX 复制 244 个特效，每个特效有自己的目录，包含源码 `animation.js` 和记录名称及素材来源的 `animation.json`。左侧可以按名称、ID 或分类查找。**新建特效** 生成可运行的 JS 模块，**从素材添加** 可以恢复内置特效或为同一个素材创建独立版本。移除会把特效移入库内的 `.trash`，重新启动后仍保留此次删减。

特效立在一个 3D 场景的地板中央。**2D 视图** 用正交相机正对它，一个源像素对应整数个屏幕像素；拖动平移，滚轮按整数倍缩放。很多 PixelFX 特效的光晕会超出自己声明的画布，预览会在画布四周多渲染 64 像素，让光自然散开；导出的精灵图和 PixelFX 一样，裁在画布范围内。**3D 视图** 可以环绕、漫游和调整视野，从侧面、背面或俯视等角度看同一张画面。下方可以播放、暂停和逐帧拖动，**重置视角** 会让特效重新完整居中。场景默认使用 PixelFX 的夜色和石地，关闭 **暗场** 可切换到浅色背景，**地板** 和 **网格** 可以分别隐藏。场景按 0.04 个单位换算 1 像素，以后给某个特效做立体版本，可以按同样的比例放进这个场景。

默认库在 `~/.agentframework/animations`。把 **复制路径** 得到的文件路径交给 AI，它可以直接修改源码，保存后预览会自动重新渲染。正在修复的代码即使有语法错误，也能从 **源代码** 标签查看。若要把库放进自己的项目，可为桌面端和 MCP 设置同一个绝对路径环境变量 `PAI_ANIMATION_HOME`。

独立 Node 模块位于 `tools/animation`，提供文件库、隔离执行和 PNG 精灵图导出。自建动画导出 `meta`（包括 `name`、`size`、`fps`、`duration`、`loop`，可选落脚点 `origin`，即特效站在地板上的那个像素，默认是底边中点）及 `draw(rgba, time, { width, height })`。每次绘制收到透明的 RGBA8 帧，时间以秒计。PixelFX 副本保留原有的 `draw`、`create`、`act` 接口和相对导入。`animation_read` 返回的 `templatePath` 指向原版入口，可用于查阅依赖。AI 编辑 `codePath` 指向的个人副本。

## PixelFX

完整上游仓库位于 `tools/pixelfx/upstream`。在该目录运行 `node tools/render.mjs fire/flamethrower --sheet` 即可直接使用官方命令。Agent 导出会返回精灵图 PNG、帧数据 JSON 和多帧预览图 `contact.png`。[版本与许可](tools/pixelfx/UPSTREAM.md)

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

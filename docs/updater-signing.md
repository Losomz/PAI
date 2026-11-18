# Windows 更新签名

Windows 安装包由 electron-builder 生成。为兼容已有 PAI 客户端，发布流程沿用 Tauri signer 的 minisign 签名格式、GitHub Release 的 latest.json 地址和仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`。Electron 客户端根据内置公钥验证安装包，然后启动安装程序。

- 公钥与更新源在 `desktop/update-source.json`。
- `npm run signer -- generate --ci -w <安全目录>/pai-update.key` 可用于新部署。现有发布请继续使用原有密钥。
- GitHub Secret 保存旧流程使用的单行 base64 私钥。密钥和密码不进入版本库。
- 推送版本标签时，CI 使用标签版本构建并签名，将安装包、对应 .sig 和 latest.json 上传至该标签的 Release。`workflow_dispatch` 只构建并上传工作流产物。
- 首次切换到 Electron 时，先在测试机用旧版与新版验证同一份已签名的更新包，再正式发布。

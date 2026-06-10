# Tauri Updater 签名配置

PAI 使用 Tauri 官方 updater 进行应用内自动更新。该 updater 会在下载更新包后校验签名，因此发布构建需要一组 Tauri signer 密钥。

## 生成无密码密钥

在本地执行：

```bash
npm run tauri -- signer generate --ci -w src-tauri/pai-update-private.key
```

该命令会生成两个本地文件：

- `src-tauri/pai-update-private.key`：私钥，只能保存到 GitHub Secret 或本地安全位置，不能提交。
- `src-tauri/pai-update-private.key.pub`：公钥，用来更新 `src-tauri/tauri.conf.json` 里的 `plugins.updater.pubkey`。

无密码场景下不要传 `--password`。

## GitHub Secret

只需要配置一个 Repository Secret：

```text
TAURI_SIGNING_PRIVATE_KEY
```

Secret 的值必须是 `src-tauri/pai-update-private.key` 文件里的完整内容。当前 Tauri CLI 生成的无密码私钥是一整行 base64 字符串，应原样复制。

不要在 GitHub Secrets 里配置：

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_SIGNING_PRIVATE_KEY_PATH`
- PEM/RSA 格式私钥
- `.pub` 公钥内容
- 额外 base64 编码后的内容

Workflow 会在构建步骤中显式设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ""`，这表示无密码，不需要创建对应 GitHub Secret。

## 公钥配置

`src-tauri/tauri.conf.json` 中的 `plugins.updater.pubkey` 必须和 GitHub Secret 中的私钥配对。

如果重新生成私钥，必须同步替换 `plugins.updater.pubkey`，否则安装包可以构建，但应用内更新会验签失败。

## 发布验证

修改签名配置后，先用 GitHub Actions 的 `workflow_dispatch` 手动跑一次 Windows Release。

确认构建产物包含：

- Windows 安装包 `.exe`
- updater signature `.sig`，由 Tauri build 生成
- updater manifest `latest.json`，由 GitHub Actions 根据 `.sig` 和 Release asset URL 生成

确认成功后再创建新的版本 tag。

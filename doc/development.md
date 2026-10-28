# 开发与调试

## 环境

- Node.js 20+、pnpm
- Rust stable（edition 2024）
- Windows：WebView2 运行时、MSVC 构建工具
- Linux：WebKitGTK 等 Tauri 2 依赖
- macOS：Xcode 命令行工具

首次安装：

```bash
pnpm install
```

## 运行

```bash
pnpm dev          # 只启动 Vite（http://localhost:1420），没有 Tauri 能力
pnpm tauri dev    # 启动桌面应用，推荐
```

`pnpm dev` 适合调纯 UI；由于没有 Tauri，`invoke` 会失败，数据库、扩展、媒体代理都不可用。

## 验证

提交前至少执行：

```bash
pnpm build          # vue-tsc --noEmit + vite build
pnpm check:locales  # 所有语言文件的 vue-i18n 语法
cargo check --manifest-path src-tauri/Cargo.toml   # 改动 Rust 后
```

`cargo check` 当前有 3 个已知警告（CookieStore 的 JSON API 已弃用、`HttpOptions.redirect` 未使用），不是新问题。

### 手工冒烟路径

1. 启动应用，首页 / 搜索 / 收藏 / 设置 / 调试页可切换；
2. 安装一个测试扩展（导入文件或仓库）；
3. 搜索 → 详情 → 播放 / 阅读；
4. 返回首页确认历史与进度；
5. 删除单条历史、清空全部；
6. 设置中切换语言 / 主题，确认无残留硬编码；
7. 调试页查看日志与网络；
8. 打开扩展设置、代码编辑并保存。

## 实时调试（WebView2 CDP）

Windows 下通过环境变量打开 WebView2 的远程调试端口：

PowerShell：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
pnpm tauri dev
```

Git Bash：

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" pnpm tauri dev
```

然后访问 `http://127.0.0.1:9222/json` 获取调试目标，或用支持 CDP 的客户端连接。可用于：

- 查看主页面 DOM 与控制台；
- 检查扩展 iframe（`about:srcdoc`）的 console；
- 执行 `fetch`、读取 `window.__TAURI__` 之外的页面状态；
- 截图 / 点击自动化验证。

注意：应用内数据库有 250ms 防抖保存，测试脚本修改数据后要等待落盘或调用正常 UI 流程。

## 数据与测试数据

数据目录见 [README](README.md#运行时数据位置) 或设置 / 调试页展示的路径。手动修改数据前必须**关闭应用**，否则内存中的数据库会覆盖文件。

`database.json` 需要保留信封格式：

```json
{ "version": 1, "data": { "seq": 1, "settings": {}, "favorites": [], "history": [] } }
```

安装测试扩展最安全的方式：

1. 把 `<package>.js` 放到 `extensions` 目录（应用关闭时），或使用扩展页“从文件导入”；
2. 启动 / 刷新扩展页；
3. 在调试页运行 `latest` / `search` / `detail` 验证；
4. 测试完成后卸载扩展，避免污染真实数据。

不要执行来源不明的扩展；虽然运行在 sandbox iframe 中，它仍可发起网络请求并通过宿主读写扩展设置。

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 设置页或其它页面整页空白 | 某条 i18n 文案含未转义的 `@` / `{}`；运行 `pnpm check:locales`，按提示转义 |
| 界面出现原始 key（如 `common.cookies-saved`） | 文案没加到 locale；至少加到 `en.json` |
| 扩展搜索页报错 | 扩展 `createFilter` 可选；若仍报错，查看调试页日志，确认返回值结构 |
| 扩展一直加载 / 超时 | 默认 120 秒；检查网络日志、`load()` 是否卡住、请求是否被墙 |
| 首页历史没有更新提示 | 扩展未实现 `checkUpdate`，或元数据加载失败；查看扩展错误列表 |
| 字幕为 0 条 | 扩展返回的 SRT/ASS 时间戳异常；用调试页查看原始字幕内容 |
| 视频黑屏 / 无法拖动 | 确认媒体代理已启动（不是浏览器模式）、扩展 headers 正确、目标支持 Range |
| 仓库版本显示 `vv...` 或一直提示更新 | 版本比较应使用去 `v` 后的值；检查 `stores/extensions.ts` 的 `normalizedVersion` |
| 打开站点窗口后应用卡死 | WebView 相关命令必须 async；Cookie 读取不要放在事件循环线程 |
| BT 远程版本检查失败 | 本机无法访问 `api.github.com`；属于网络问题 |
| 代理设置后所有请求失败 | 检查代理地址是否需要 scheme；`DIRECT` 时地址应留空 |
| 外部播放器没有字幕 | 字幕下载失败或格式扩展名不被识别；查看 `cache/subtitles` |
| 语言切换后部分文本没变 | 该文本是硬编码；改为 `t()` 并补 locale |
| `pnpm build` 报 chunk 过大 | 已知警告（播放器 / hls.js）；不是构建失败 |

## 修改指引

### 改 UI 文案

1. 在 `src/locales/en.json` 添加 key（必要时同步 `zh.json`）；
2. 组件中使用 `t('key')`；
3. 运行 `pnpm check:locales`。

### 改设置

1. `lib/defaults.ts` 加 `SettingKey` 和默认值；
2. `stores/settings.ts` 加 getter（可选）；
3. `SettingsView.vue` 加控件；
4. 需要后端生效时调用对应命令；
5. 更新文档与 locale。

### 改后端命令

1. Rust 实现 `#[tauri::command]`；
2. `lib.rs` 注册；
3. 需要权限时改 `capabilities/default.json`；
4. 前端 `call<T>()` 调用；
5. 更新 [backend.md](backend.md)。

### 改扩展 API

- 宿主 RPC：`src/lib/extension-runtime.ts` 的 `handleRpc`；
- shim：同文件 `shim()`；
- DOM/XPath：`src/lib/extension-dom.ts`；
- 同步更新 [extension-development.md](extension-development.md)、`types/models.ts` 与调试页的方法列表。

## 发布构建

```bash
pnpm tauri build
```

产物在 `src-tauri/target/release/bundle/`。发布前确认：

- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处版本一致；
- `tauri.conf.json` 的 identifier、产品名、图标正确；
- 目标平台具备 WebView2（Windows）；
- BT Server 是运行时下载，不需要打包；
- 应用**没有**自更新插件；如需自动更新，需要新增 `tauri-plugin-updater`、签名密钥与发布端点，并在设置中接入 `AutoCheckUpdate`（当前该设置未被使用）。

## 已知技术债

- Rust 后端部分错误文案仍为中文，尚未接入前端 i18n。
- `HttpOptions.redirect` 预留未用。
- CookieStore 的 `load_json` / `save_json` 已弃用，升级依赖时需迁移。
- CSP 为 `null`；收紧前要验证扩展 iframe、Blob 字幕、HLS 与媒体代理。
- 应用自更新缺失。
- 部分外部能力（AniList OAuth、TMDB、BT 下载、DLNA、外部播放器、真实第三方扩展）需要真实凭据 / 网络 / 设备才能端到端验证。

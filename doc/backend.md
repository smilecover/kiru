# 后端（Rust / Tauri）

## 模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| store | `src-tauri/src/store.rs` | `AppState`、数据目录、数据库、Cookie、日志、reqwest client |
| http | `src-tauri/src/http.rs` | 通用 HTTP 请求、代理配置、Cookie 增删查 |
| proxy | `src-tauri/src/proxy.rs` | 本地媒体代理（axum）、Range、HLS 重写 |
| webview | `src-tauri/src/webview.rs` | AniList 登录窗口、站点 Cookie 窗口、普通网页窗口 |
| bt | `src-tauri/src/bt.rs` | BT Server 下载 / 启停 / 种子 / 文件 / 流 URL |
| dlna | `src-tauri/src/dlna.rs` | SSDP 发现、SOAP 控制 |
| external | `src-tauri/src/external.rs` | 外部播放器拉起、字幕下载与缓存 |
| extensions | `src-tauri/src/extensions.rs` | 扩展文件读写、导入文件读取 |

命令在 `src-tauri/src/lib.rs` 的 `generate_handler!` 中注册；新增命令必须在此登记，否则前端 `invoke` 会报“command not found”。

## AppState

`AppState` 由 `setup` 创建并托管：

```rust
pub struct AppState {
    pub cookie_store: Arc<CookieStoreMutex>,
    pub cookie_path: PathBuf,
    pub client: RwLock<reqwest::Client>,        // 90s 超时
    pub media_client: RwLock<reqwest::Client>,  // 无全局超时，用于长视频
    pub proxy_type: RwLock<String>,
    pub proxy_addr: RwLock<String>,
    pub bt_child: Mutex<Option<std::process::Child>>,
    pub proxy_base: RwLock<String>,
}
```

- 两个 client 共用同一 Cookie store。
- `net_config` 会重建两个 client，并保留当前 Cookie。
- 本机代理（`localhost`、`127.0.0.1`、`::1`）始终绕过用户配置的代理。
- 退出事件中会终止 BT 子进程并保存 Cookie。

## Tauri 命令参考

参数名在前端使用 camelCase（Tauri 默认转换），Rust 侧是 snake_case。

### 数据与日志（`store.rs`）

| 命令 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `db_load` | - | `object \| null` | 读取 `database.json` 的 `data` 字段 |
| `db_save` | `data` | `void` | 写临时文件后原子 rename |
| `app_paths` | - | `{ data, extensions, logs }` | 展示 / 打开目录用 |
| `log_append` | `line` | `void` | 追加一行到 `logs/kiru.log` |
| `log_read` | - | `string` | 读取日志文件 |
| `log_clear` | - | `void` | 删除日志文件 |
| `log_export` | `target` | `void` | 导出日志到用户选择路径 |

### 网络（`http.rs`）

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `http_request` | `options: HttpOptions` | `HttpResult` |
| `net_config` | `proxyType`, `proxy` | `void` |
| `cookies_get` | `url` | `string`（`a=1; b=2`） |
| `cookies_set` | `url`, `cookies` | `void` |
| `cookies_clear` | `url` | `void` |

`HttpOptions`（camelCase）：

```ts
{
  url: string;
  method?: string;            // 默认 GET
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
  bodyBase64?: string;        // 二进制请求体
  timeoutMs?: number;
  responseType?: 'text' | 'base64';
  redirect?: boolean;         // 预留，当前未使用
}
```

`HttpResult`：`{ status, url, headers, body, base64 }`。选择 `base64` 时 `body` 为空。

代理类型：`DIRECT`、`PROXY`（HTTP，地址可带或不带 scheme）、`SOCKS4`、`SOCKS5`。地址不带 scheme 时会自动补全。

### 媒体代理（`proxy.rs`）

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `proxy_base` | - | `string`（未启动时报错） |
| `media_proxy_url` | `url`, `headers?` | `string` |

启动时绑定随机端口并生成 token：

```text
http://127.0.0.1:<port>/<token>
```

`/media?u=<base64url>&h=<base64url>` 的行为：

- 仅接受 GET / HEAD；
- 透传 `Range`、`If-Range`、`Accept`、`Accept-Language`；
- 回传 `content-type`、`content-length`、`content-range`、`accept-ranges`、`cache-control`、`last-modified`、`etag`、`content-disposition`；
- m3u8 播放列表会重写所有 `URI="..."`，保留请求头；
- 响应统一加 CORS；OPTIONS 返回允许的方法与头；
- 出错返回 502 与文本错误。

### 扩展文件（`extensions.rs`）

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `extensions_list` | - | `{ filename, content }[]` |
| `extension_read` | `filename` | `string` |
| `extension_write` | `filename`, `content` | `void` |
| `extension_delete` | `filename` | `void` |
| `extension_exists` | `filename` | `boolean` |
| `extensions_path` | - | `string` |
| `read_text_file` | `path` | `string`（导入扩展用） |
| `write_text_file` | `path`, `content` | `void` |

文件名限制：必须以 `.js` 结尾，不能包含 `/`、`\`、`..`，且必须是纯文件名。

### 窗口（`webview.rs`）

| 命令 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `open_anilist_login` | - | `void` | 打开 AniList OAuth 窗口 |
| `open_site_window` | `url`, `title?` | `string`（窗口 label） | 注入保存 Cookie 按钮 |
| `open_url_window` | `url`, `title?` | `void` | 普通网页窗口 |

窗口都使用移动端 UA，尺寸与最小尺寸在代码中固定。窗口 label 带随机 UUID，可同时打开多个。

### BT（`bt.rs`）

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `bt_remote_version` | - | `string` |
| `bt_install` | - | `string`（安装到的版本） |
| `bt_is_installed` | - | `boolean` |
| `bt_start` | - | `void` |
| `bt_stop` | - | `void` |
| `bt_uninstall` | - | `void` |
| `bt_status` | - | `{ running, version, installed }` |
| `bt_add_torrent` | `url`, `headers` | `string`（infoHash） |
| `bt_files` | `infoHash` | `string[]` |
| `bt_remove_torrent` | `infoHash` | `void` |
| `bt_stream_url` | `infoHash`, `file` | `string` |

BT Server 信息：

- 版本来源：`api.github.com/repos/miru-project/bt-server/releases/latest`；
- 下载地址：`https://github.com/miru-project/bt-server/releases/download/v<ver>/bt-server-v<ver>-<platform>-<arch>[.exe]`；
- 平台：Windows / Linux；架构：amd64 / arm64 / 386 / arm；
- 本地 API：`http://localhost:3000`；
- 可执行文件存放在数据目录，启动时隐藏窗口（Windows `CREATE_NO_WINDOW`）；
- 安装过程中每 120ms emit `bt-download-progress`。

### DLNA（`dlna.rs`）

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `dlna_discover` | - | `DlnaDevice[]` |
| `dlna_action` | `controlUrl`, `serviceType`, `action`, `value?`, `title?` | `{ state, position, duration, raw }` |

`action` 取值与 SOAP 动作映射：

| action | SOAP |
| --- | --- |
| `setUri` | `SetAVTransportURI`（`value` 是媒体 URL） |
| `play` | `Play` |
| `pause` / `playPause` | `Pause` |
| `stop` | `Stop` |
| `seek` | `Seek`（`value` 是秒数，转为 `HH:MM:SS`） |
| `info` | `GetTransportInfo` |
| `position` | `GetPositionInfo` |

返回字段从 SOAP 响应中解析 `CurrentTransportState`、`RelTime`、`TrackDuration`。

### 外部播放器（`external.rs`）

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `launch_external_player` | `player`, `url`, `headers?`, `subtitles?` | `void` |

- `player`：`vlc` / `mpv` / `potplayer` / 其它（系统默认）；
- URL 会再次经过媒体代理，保证播放器能拿到扩展请求头；
- 字幕先下载到 `cache/subtitles`，7 天后清理；
- Windows 上 VLC 会附加 `--http-referrer` / `--http-user-agent`；PotPlayer 使用 `potplayer://` 协议。

## 事件

| 事件 | payload | 来源 | 消费方 |
| --- | --- | --- | --- |
| `anilist-token` | `{ token }` | AniList 登录窗口 | `main.ts`、`AnilistView` |
| `anilist-error` | `{ error }` | AniList 登录窗口 | `main.ts`、`AnilistView` |
| `site-cookies` | `{ label, url, cookies }` | 站点 Cookie 窗口 | `main.ts` |
| `bt-download-progress` | `{ received, total }` | BT 安装 | `BtManagerDialog` |

`main.ts` 负责全局处理：保存 AniList token、提示登录结果、把站点 Cookie 写入 Cookie store。`AnilistView` 另外监听一次用于刷新界面，需注意组件卸载时 `unlisten`。

## 存储

数据目录：`app_data_dir()/kiru`。

| 文件 | 内容 |
| --- | --- |
| `database.json` | `{ "version": 1, "data": { ... } }`，原子写 |
| `cookies.json` | reqwest_cookie_store 的 JSON 格式 |
| `extensions/*.js` | 扩展源码 |
| `logs/kiru.log` | 文本日志 |
| `cache/subtitles/*` | 外部播放器字幕缓存 |
| `btserver.exe` / `btserver` | BT Server 二进制 |

Cookie 使用 `CookieStore::load_json` / `save_json`（已弃用但可用，升级时注意 API 变化）。

## 新增 Tauri 命令

1. 在对应模块加 `#[tauri::command]` 函数，返回 `Result<T, String>`；
2. 在 `lib.rs` 的 `generate_handler!` 中注册；
3. 前端通过 `call<T>('command_name', { camelCaseArgs })` 调用；
4. 需要新权限（窗口、文件系统等）时改 `src-tauri/capabilities/default.json`；
5. 更新本文档的命令表。

## 后端注意事项

### 命令必须 async 或绝不阻塞

WebView 窗口创建、`cookies_for_url` 等操作在 Windows 上如果同步执行，会阻塞事件循环并死锁。项目中的窗口命令已改为 `async fn`；Cookie 读取放在独立线程中。新增涉及 WebView / 窗口 / 同步 IO 的命令时，优先 `async` 或 `spawn_blocking`。

### 媒体与普通请求的 client 不同

- 普通请求 90 秒超时；
- 媒体请求无全局超时，避免大文件被中断；
- 两者都共用 Cookie store，但修改代理后必须同时重建。

### 错误文案

Rust 侧仍有部分中文错误（BT、DLNA、代理、Cookie 等），会原样显示在前端 Toast / 错误区域。新增错误建议使用英文，或在调用处映射为 i18n 文案。

### BT 卸载与文件锁

Windows 上正在运行的 exe 无法删除，`bt_uninstall` 会先停止子进程。安装新版本时也会先停止旧进程。

### 代理是随机端口

不要在前端硬编码端口；一律使用 `proxy_base` / `getProxyBase()`。浏览器开发模式（`pnpm dev`）没有 Tauri，因此代理不可用，视频可能受 CORS 限制。

### CSP

`tauri.conf.json` 中 `csp` 为 `null`。若收紧 CSP，至少放行：

- `blob:`（字幕、封面）；
- `http://127.0.0.1:*`（媒体代理）；
- `https://image.tmdb.org`、TMDB / AniList API；
- 扩展 iframe 的 `data:` / `srcdoc` 与 `script-src 'unsafe-eval'`（扩展执行需要）。

### 文件安全

扩展文件名、外部字幕文件名都做了清洗；扩展源码来自第三方，前端运行时已在隔离 iframe 中执行，但后端文件命令本身不做内容校验，不要在未确认路径的情况下扩展其用途。

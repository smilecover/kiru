# 架构

## 总览

```text
┌─────────────────────────────────────────────────────────────┐
│ Vue 3 SPA（WebView2）                                        │
│                                                             │
│  views ──► stores ──► lib/db（reactive 数据库 + 防抖持久化）  │
│    │          │                                             │
│    │          ├──► lib/http ───────────┐                    │
│    │          └──► lib/extension-runtime│                    │
│    │                                    │                    │
│    └──► lib/media ──► 本地媒体代理 URL   │                    │
│                                         ▼                    │
│                              Tauri invoke / events           │
└─────────────────────────────────────────┬───────────────────┘
                                          │
┌─────────────────────────────────────────▼───────────────────┐
│ Rust（src-tauri/src）                                        │
│                                                             │
│  store      数据库 / Cookie / 路径 / 日志 / AppState          │
│  http       reqwest 请求、代理配置、Cookie 读写               │
│  proxy      axum 本地媒体代理（Range、HLS 重写、任意请求头）    │
│  webview    AniList 登录窗、站点 Cookie 窗、普通网页窗         │
│  bt         BT Server 下载 / 启停 / 种子 / 文件 / 流 URL      │
│  dlna       SSDP 发现、SOAP 控制                              │
│  external   外部播放器拉起 + 字幕下载                         │
│  extensions 扩展文件增删改查                                  │
└─────────────────────────────────────────────────────────────┘
```

前端负责界面、扩展逻辑与数据编排；Rust 负责所有不能或不应在 WebView 里完成的事情：无 CORS 的网络请求、持久 Cookie、本地媒体流代理、跨域窗口、系统进程与局域网设备。

## 启动流程

入口在 `src/main.ts`：

1. `initDb()` 通过 `db_load` 读取 `database.json`，与默认设置合并，建立响应式 `db`。
2. 创建 Vue app + Pinia，读取 `settings.language` / `settings.theme` 并应用。
3. 注册 i18n、router、全局错误处理（写入日志）。
4. 并行执行：
   - `initMediaProxy()` 取回本地代理 base URL；
   - `applyNetworkConfig()` 把代理设置推给 Rust；
   - `restoreWindowState()` 恢复窗口尺寸 / 位置；
   - `setupTauriEvents()` 注册 AniList 与 Cookie 事件监听。
5. `router.isReady()` 后挂载，随后启动窗口状态跟踪。
6. 加载扩展元数据（`extensions.loadExtensions()`）。失败只警告，不阻塞界面。
7. `beforeunload` 时 flush 数据库并停止窗口跟踪。

启动失败会渲染一个最小错误页，而不是白屏。

## 前端分层

| 层 | 职责 |
| --- | --- |
| `views/` | 页面级编排、路由参数解析、加载 / 错误状态 |
| `components/` | 可复用 UI（标题栏、侧栏、卡片、对话框、Toast） |
| `stores/` | 跨页面状态：设置、媒体库、扩展、全局 UI |
| `lib/` | 无 UI 的业务能力（DB、HTTP、运行时、代理、元数据、解析） |
| `types/models.ts` | 所有共享数据结构 |
| `i18n/`、`locales/` | 语言识别与文案 |

原则：网络与 Tauri 调用集中在 `lib/`；视图不直接拼后端参数；跨页数据放 store 或 `db`。

### 四个 store

- `settings`：读取 `db.settings` 的响应式包装，提供 `get/set/setMany/toggle`。修改语言时同步切换 i18n。
- `library`：收藏、历史、详情缓存、TMDB 缓存、漫画阅读模式。所有写操作调用 `persist()`。
- `extensions`：扩展元数据、源码缓存、运行时实例、仓库列表、安装 / 卸载 / 设置。
- `ui`：Toast、确认对话框、侧栏折叠、全局 loading。

## 扩展数据流

### 搜索 / 浏览

1. `extensions.loadExtensions()` 调用 `extensions_list`，Rust 读取数据目录下所有 `.js`。
2. `parseExtensionMeta()` 解析头部；文件名必须等于 `<package>.js`，否则该扩展记入错误列表。
3. `ensureRuntime(package)` 创建 `ExtensionRuntime`，在隐藏 iframe 中加载扩展。
4. `runtime.latest(page)` / `runtime.search(keyword, page, filter)` 通过 `postMessage` RPC 调用扩展方法。
5. 宿主为每条结果补齐默认请求头（Referer、UA、站点 Cookie），并记录网络日志。

### 详情与播放

1. 详情页先用 `library.getCachedDetail()`，没有缓存或没有剧集时调用 `runtime.detail(url)`，然后写回 `miruDetails`。
2. 点击剧集 → `/watch?package=&url=&type=&group=&episode=`。
3. `WatchView` 再次确保详情可用，按类型渲染 `VideoWatch` / `ComicReader` / `NovelReader`。
4. 播放器调用 `runtime.watch(episodeUrl)`，按扩展类型得到：
   - bangumi：`{ type: 'hls'|'mp4'|'torrent', url, subtitles, headers, audioTrack }`
   - manga：`{ urls, headers }`
   - fikushon：`{ content, title, subtitle }`
5. 媒体 URL 经 `mediaUrl(url, headers)` 包装后交给 `<video>` / `<img>` / HLS。
6. 播放进度通过 `@progress` 回到 `WatchView`，写入历史。
7. 退出或卸载时按设置自动向 AniList 同步进度。

## 媒体代理

Rust 在启动时绑定 `127.0.0.1:0`（随机端口），生成随机 token，base URL 形如：

```text
http://127.0.0.1:<port>/<token>
```

前端包装后的 URL：

```text
<base>/media?u=<base64url(目标URL)>&h=<base64url(JSON请求头)>
```

特性：

- 透传 `Range`、`If-Range`、`Accept`、`Accept-Language`，支持视频拖动与分段加载；
- 透传响应状态和关键头（`content-range`、`content-length`、`etag` 等）；
- 识别 m3u8（按 URL、Content-Type 或 `#EXTM3U`），把播放列表中的 `URI="..."` 重写为代理 URL；
- 使用独立的无全局超时 client（`media_client`），避免长视频被截断；
- 提供 CORS 与 OPTIONS，供 WebView 内的 `<video>`、HLS 使用；
- token 防止本机其它网页随意借用代理。

代理只接受 GET/HEAD。DLNA 投屏使用扩展返回的原始 URL，不经过本机代理（电视无法访问 127.0.0.1）。

## 播放链路

### 直链 / HLS

- `hls.js` 优先；Safari 类原生 HLS 能力存在时可直接设置 `src`。
- 清晰度切换读取 `hls.levels`，自动模式使用 `currentLevel = -1`。
- 音轨切换读取 `hls.audioTracks`。
- 字幕支持扩展提供的远程 SRT / ASS / SSA / VTT，也支持本地文件：
  `rawRequest` → `subtitleToVtt()` → Blob URL → 自定义字幕层渲染。
- 字幕样式（大小、粗细、颜色、背景、透明度、对齐）来自设置。

### BT

1. `resolveTorrentStream()` 启动 BT Server，添加种子，轮询文件列表。
2. 选择第一个视频文件；所有字幕文件也生成流 URL。
3. 视频通过 BT Server 的 HTTP 流地址播放；BT 在设置弹窗中管理。
4. 切换种子内文件、查看状态、停止 / 升级都在 `BtManagerDialog.vue`。

BT Server 是外部二进制，由 Rust 下载到数据目录并作为子进程管理，退出应用时终止。

### 本地视频进度

进度以“秒”字符串写入历史；详情页显示进度条并提供“继续播放”。切换集数时按 `episodeGroupId` / `episodeId` 恢复。

## 元数据

### TMDB

- API Key 存在设置 `TMDBKey`，未配置时详情页不请求。
- `lib/tmdb.ts` 负责多类型搜索、详情、剧照、演职员；语言由当前 locale 映射为 TMDB 的 `language`。
- 结果缓存到 `db.tmdb`（按 `tmdbID`），详情与扩展条目的绑定关系存在 `miruDetails.tmdbID`。

### AniList

- OAuth 使用固定 client id `16214`，在独立 WebView 窗口打开；token 通过 `anilist-token` 事件回传，错误通过 `anilist-error`。
- token 与 userId 存在设置 `AniListToken` / `AniListUserId`。
- GraphQL 调用集中在 `lib/anilist.ts`：用户信息、收藏列表、媒体搜索、保存进度、删除条目、自动追踪。
- 条目绑定 ID 存在 `miruDetails.aniListID`；播放退出时 `autoTrackProgress()` 更新进度（受 `AutoTracking` 开关控制）。

## 持久化

`src/lib/db.ts` 维护一个 `reactive` 对象，结构为：

```ts
{
  version, seq,
  settings, favorites, history, extensionSettings,
  mangaSettings, miruDetails, tmdb
}
```

- 所有写入调用 `persist()`，250ms 防抖后 `db_save`；
- Rust 侧写临时文件再原子 rename，文件格式为 `{ "version": 1, "data": { ... } }`；
- `nextId()` 使用持久化的 `seq`，加载时会用现有最大 id 修正，避免重复；
- 关闭窗口前 `flushDb()`；`beforeunload` 还有一次尽力而为的同步保存。

`normalize()` 对旧数据做容错：缺失字段补空数组，设置与默认值合并，非法数据不至于导致白屏。

## Cookie 与网络

- 所有请求共用一个 `reqwest_cookie_store`，持久化到 `cookies.json`。
- 每次 `http_request` 完成后都会保存 Cookie。
- 站点 Cookie 抓取窗口注入按钮，跳转到伪域名，由 Rust 读取 WebView 的 Cookie 并 emit `site-cookies`。
- 扩展的 `request` 默认带 `Referer`、`User-Agent`、站点 Cookie；每条列表项也可以提供自己的 headers。
- 代理类型支持 `DIRECT` / `PROXY`（HTTP）/ `SOCKS4` / `SOCKS5`；本机代理地址永远绕过代理。

## 窗口

- 主窗口无系统装饰，标题栏由 `AppTitlebar.vue` 绘制，并使用 `core:window` 权限做最小化 / 最大化 / 关闭 / 拖动。
- `/watch` 路由带 `meta.immersive`，隐藏侧栏。
- 窗口尺寸 / 位置存设置 `WindowsSize` / `WindowsPosition`，启动时恢复并约束在最小尺寸内。
- AniList 登录、站点窗口、普通网页窗口都是独立 WebView 窗口，统一使用移动端 UA，避免部分站点返回桌面复杂布局或拒绝登录。

## 安全模型

- 扩展运行在 `sandbox="allow-scripts"` 的 `about:srcdoc` iframe 中，没有同源权限，拿不到 Tauri API、应用 DOM、`localStorage`。
- 扩展的一切外部能力都经由 `postMessage` RPC 回到宿主：网络、Cookie、设置、日志、HTML 解析。
- HTML 解析使用 `DOMParser`，不会执行脚本或加载资源。
- 媒体代理带随机 token，并且只监听 127.0.0.1。
- `tauri.conf.json` 的 CSP 为 `null`（Tauri 默认宽松配置）；如果后续要收紧，需要同时验证扩展 iframe、Blob 字幕、HLS 与 TMDB 图片。
- 扩展文件写入有文件名白名单（仅 `.js`、拒绝路径分隔符与 `..`）。

## 与 Miru 的差异

- 清空全部历史改为首页显式按钮（Miru 依赖右键菜单），单条删除仍在卡片上。
- 首页历史卡片直接显示扩展 `checkUpdate` 的返回值。
- 仓库版本比较会去掉前导 `v`，避免 `1.0.0` 与 `v1.0.0` 误报更新。
- 应用自更新未实现：Kiru 没有分发端点，`AutoCheckUpdate` 仅保留为内部设置。
- 后端部分错误文案仍为中文（从 Miru 迁移时保留），前端展示时会原样透出。

## 已知限制

- 依赖外部凭据 / 网络的能力无法在离线环境完整验证：AniList OAuth、TMDB、BT Server 下载、DLNA 设备、外部播放器、真实第三方扩展。
- BT Server 只支持 Windows 与 Linux 的 x86_64 / arm64 / x86 / arm；其它平台直接报错。
- 外部播放器在 Windows 支持 VLC / PotPlayer / 系统默认，Linux/macOS 支持 VLC / mpv / 系统默认。

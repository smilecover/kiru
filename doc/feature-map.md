# 功能定位表

修改功能前先在这里找到主文件，再结合 [架构](architecture.md) 理解调用链。

## 浏览与媒体库

| 功能 | 主要文件 | 说明 |
| --- | --- | --- |
| 首页继续观看 | `views/HomeView.vue`、`components/HistoryCard.vue` | 历史倒序；卡片可单条删除；标题栏“清空全部”带确认 |
| 历史更新提示 | `components/HistoryCard.vue` | 挂载后调用扩展 `checkUpdate(url)`，等待扩展加载完成 |
| 收藏分组 | `views/HomeView.vue`、`views/FavoritesView.vue` | 按 bangumi / manga / fikushon 分行，首页最多 20 条 |
| 收藏 / 历史读写 | `stores/library.ts` | `(package, url)` 为历史与详情缓存主键 |
| 聚合搜索 | `views/SearchView.vue` | 所有扩展并行搜索；空关键词展示 `latest` |
| 单扩展搜索与筛选 | `views/ExtensionSearchView.vue` | 分页、筛选器、去重、结束提示 |
| 详情页 | `views/DetailView.vue` | 缓存、剧集分组、收藏、TMDB、AniList、外部播放器、站点窗口 |
| 视频播放 | `views/watch/VideoWatch.vue`、`views/watch/WatchView.vue` | HLS / MP4 / BT、清晰度、音轨、字幕、倍速、全屏、DLNA |
| 漫画阅读 | `views/watch/ComicReader.vue` | 标准 / 右到左 / 条漫、缩放、翻页、键盘、进度 |
| 小说阅读 | `views/watch/NovelReader.vue` | 章节、字号、键盘翻页、进度 |
| 播放历史与自动追踪 | `views/watch/WatchView.vue`、`lib/anilist.ts` | 退出 / 卸载时同步 AniList 进度 |

## 扩展

| 功能 | 主要文件 | 说明 |
| --- | --- | --- |
| 扩展元数据解析 | `lib/extension-parser.ts` | 头部字段、文件名一致性、类名转换 |
| 扩展运行时 | `lib/extension-runtime.ts` | iframe 沙箱、RPC、生命周期、设置、日志 |
| DOM / XPath | `lib/extension-dom.ts` | 惰性 HTML 解析，不执行脚本 |
| 已安装扩展管理 | `views/ExtensionsView.vue` | 导入 URL / 文件、打开目录、错误列表、卸载 |
| 扩展仓库 | `views/ExtensionRepoView.vue` | 索引、搜索、类型 Tab、安装 / 更新 / 卸载 |
| 扩展设置 | `views/ExtensionSettingsView.vue` | input / radio / toggle、站点 Cookie 清理 |
| 代码编辑 | `views/CodeEditView.vue` | 未保存提示、保存后重建运行时 |
| 扩展安装与文件 | `stores/extensions.ts`、`src-tauri/src/extensions.rs` | 文件读写、包名校验、运行时失效 |

扩展 API 细节见 [extension-development.md](extension-development.md)。

## 元数据与追踪

| 功能 | 主要文件 | 说明 |
| --- | --- | --- |
| TMDB 搜索 | `lib/tmdb.ts`、`components/TmdbBindDialog.vue` | 多类型搜索、按标题自动绑定 |
| TMDB 详情 | `views/DetailView.vue`、`lib/tmdb.ts` | 海报、背景、简介、剧照、演职员、事实 |
| AniList 登录 | `src-tauri/src/webview.rs`、`views/AnilistView.vue` | OAuth 窗口，`anilist-token` / `anilist-error` 事件 |
| AniList 列表 | `views/AnilistView.vue`、`views/AnilistMoreView.vue` | 收藏概览、状态筛选、“在扩展中搜索标题” |
| AniList 绑定 / 进度 | `components/AnilistBindDialog.vue`、`components/AnilistTrackDialog.vue`、`lib/anilist.ts` | 条目绑定存在 `miruDetails.aniListID` |
| 自动追踪 | `lib/anilist.ts`、`views/watch/WatchView.vue` | 受 `AutoTracking` 设置控制 |

## 播放增强

| 功能 | 主要文件 | 说明 |
| --- | --- | --- |
| 媒体代理 | `lib/media.ts`、`src-tauri/src/proxy.rs` | 请求头、Cookie、CORS、Range、HLS 重写 |
| 字幕 | `lib/media.ts`、`views/watch/VideoWatch.vue` | 远程 SRT / ASS / SSA / VTT + 本地文件，Blob URL |
| BT 播放 | `lib/playback.ts`、`src-tauri/src/bt.rs`、`components/BtManagerDialog.vue` | 启动服务器、添加种子、选择文件、字幕 |
| DLNA | `components/DlnaDialog.vue`、`src-tauri/src/dlna.rs`、`views/watch/VideoWatch.vue` | SSDP 发现、播放 / 暂停 / 停止 / 快进、进度轮询 |
| 外部播放器 | `src-tauri/src/external.rs`、`views/DetailView.vue` | VLC / mpv / PotPlayer / 系统默认；字幕下载 |
| 图片代理 | `components/SmartImage.vue`、`lib/media.ts` | 带请求头的封面、头像、剧照 |

## 设置与系统

| 功能 | 主要文件 | 说明 |
| --- | --- | --- |
| 设置页 | `views/SettingsView.vue` | 分区滚动、语言、主题、播放器、键位、阅读、代理、日志 |
| 设置存储 | `stores/settings.ts`、`lib/defaults.ts`、`lib/db.ts` | 键名与默认值集中在 `defaults.ts` |
| 主题 | `lib/theme.ts`、`styles/base.css` | `system` / `light` / `dark`，CSS 变量 |
| 语言 | `i18n/index.ts`、`locales/*.json` | 14 种语言，英文兜底 |
| 窗口状态 | `lib/window.ts`、`components/AppTitlebar.vue` | 无边框标题栏、尺寸 / 位置恢复 |
| 应用日志 | `lib/log.ts`、`src-tauri/src/store.rs`、`views/DebugView.vue` | 扩展日志、网络日志、文本日志、导出 |
| 调试 | `views/DebugView.vue`、`lib/extension-runtime.ts` | 日志 / 网络 / 方法运行器 |
| 打开网页 / 目录 | `@tauri-apps/plugin-opener` | 设置页链接、扩展目录 |

## 后端能力

| 能力 | 模块 | 命令前缀 / 入口 |
| --- | --- | --- |
| 数据库、路径、日志 | `store.rs` | `db_*`、`app_paths`、`log_*` |
| HTTP、Cookie、代理配置 | `http.rs` | `http_request`、`net_config`、`cookies_*` |
| 媒体代理 | `proxy.rs` | `proxy_base`、`media_proxy_url` |
| 窗口 | `webview.rs` | `open_anilist_login`、`open_site_window`、`open_url_window` |
| BT | `bt.rs` | `bt_*` |
| DLNA | `dlna.rs` | `dlna_*` |
| 外部播放器 | `external.rs` | `launch_external_player` |
| 扩展文件 | `extensions.rs` | `extension_*`、`extensions_*` |

命令参数与返回见 [backend.md](backend.md)。

## Miru 功能对照中的设计差异

| 项目 | Miru | Kiru |
| --- | --- | --- |
| 清空历史 | 右键菜单 | 首页显式按钮 + 确认框 |
| 历史卡片更新提示 | 卡片展示 `checkUpdate` | 保留，并处理扩展延迟加载 |
| 仓库版本比较 | 原始字符串 | 忽略前导 `v`，避免误报 |
| 应用自更新 | 有检查逻辑 | 未实现（无分发端点），设置项保留未使用 |
| 后端错误文案 | 中文 | 部分中文保留，新代码建议英文或 i18n |
| 播放器实现 | Flutter 播放器 | 原生 `<video>` + hls.js，字幕为自定义层 |
| 扩展执行 | Dart JS 运行时 | WebView iframe + 宿主 RPC |

## 常用检索入口

```bash
# 谁调用了某个后端命令
grep -rn "cookies_set" src

# 某个设置键的所有使用点
grep -rn "SettingKey.videoPlayer" src

# 某个 i18n key 的使用
grep -rn "home.clear-history-confirm" src

# 扩展 API 的宿主实现
grep -n "case '" src/lib/extension-runtime.ts
```

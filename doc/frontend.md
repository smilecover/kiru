# 前端

## 路由

路由使用 hash history，定义在 `src/router/index.ts`。

| 路径 | name | 组件 | 说明 |
| --- | --- | --- | --- |
| `/` | `home` | `HomeView` | 继续观看、收藏分组、清空历史 |
| `/search` | `search` | `SearchView` | 聚合所有扩展搜索；关键词为空时展示 `latest` |
| `/search-extension` | `extension-search` | `ExtensionSearchView` | 单个扩展的搜索 / 筛选 / 分页；参数 `package`、`type`、`keyWord` |
| `/favorites/:type?` | `favorites` | `FavoritesView` | 按扩展类型筛选收藏 |
| `/extensions` | `extensions` | `ExtensionsView` | 已安装管理、导入 URL / 文件、打开目录 |
| `/extensions/repo` | `extension-repo` | `ExtensionRepoView` | 扩展仓库列表、安装 / 更新 / 卸载 |
| `/extensions/:package/settings` | `extension-settings` | `ExtensionSettingsView` | 扩展设置、站点 Cookie 清理、打开代码 |
| `/extensions/:package/code` | `extension-code` | `CodeEditView` | 在线编辑扩展源码 |
| `/detail` | `detail` | `DetailView` | 参数 `package`、`url`、`type` |
| `/watch` | `watch` | `WatchView` | immersive；参数 `package`、`url`、`type`、`group`、`episode` |
| `/settings` | `settings` | `SettingsView` | 分区滚动设置页 |
| `/settings/anilist` | `anilist` | `AnilistView` | AniList 登录、收藏概览 |
| `/settings/anilist/more` | `anilist-more` | `AnilistMoreView` | 参数 `type`、`status` |
| `/debug` | `debug` | `DebugView` | 日志 / 网络 / 方法调试 |
| 其它 | - | - | 重定向首页 |

页面通过 `route.query` 传参，`App.vue` 以 `route.fullPath` 作为 `RouterView` key，因此切换剧集 / 查询会重新挂载页面。

## 应用外壳

- `App.vue`：标题栏 + 侧栏 + 内容区 + Toast + 确认框 + 全局 loading；`meta.immersive` 隐藏侧栏；监听系统主题变化。
- `AppTitlebar.vue`：自绘标题栏，处理拖动、最小化、最大化、关闭、后退、窗口状态。
- `AppSidebar.vue`：分组导航，可折叠；折叠状态存 `localStorage`。
- `ToastHost.vue` / `ConfirmDialog.vue`：由 `ui` store 驱动。
- 通用组件：`SmartImage`（代理图片 + 占位 + 失败态）、`MediaCard`、`HistoryCard`、`HorizontalRow`、`EmptyState`、`AppModal`、`SwitchToggle`、`SettingsRow`。
- 业务对话框：`DlnaDialog`、`BtManagerDialog`、`TmdbBindDialog`、`AnilistBindDialog`、`AnilistTrackDialog`。

### SmartImage

`SmartImage` 会把远程图片交给 `mediaUrl()`，从而带上扩展请求头、站点 Cookie 并绕开 CORS。TMDB 图片可直接用 `tmdbImage()`，不需要代理。本地绝对路径会转换为 `file://`。

## 视图职责

### 首页 `HomeView`

- 历史按时间倒序，`HistoryCard` 可单条删除；
- 标题栏提供“清空全部”并二次确认；
- 收藏按 `bangumi` / `manga` / `fikushon` 分行，最多 20 条，更多跳转收藏页；
- 完全没有数据时展示空状态与扩展仓库入口。

`HistoryCard` 挂载后异步调用扩展的 `checkUpdate(url)`，展示更新文本。扩展可能尚未加载完成，组件会等待 store 的加载 promise，但不会因此阻塞渲染。

### 搜索

- `SearchView`：所有可见扩展并行搜索，结果按扩展分行，有结果的扩展排前面；输入 450ms 防抖，空关键词回退到 `latest(1)`。
- `ExtensionSearchView`：单扩展搜索，支持 `createFilter()` 返回的筛选器、滚动触底分页、重复结果去重、结束提示。

`createFilter` 是可选方法：扩展未实现时 runtime 返回 `{}`，页面不会初始化失败。

### 详情 `DetailView`

- 优先使用详情缓存；支持手动 / 自动刷新；
- 剧集分组、网格 / 列表模式、正序 / 倒序、继续播放定位；
- 收藏切换、在扩展站点窗口打开；
- TMDB：自动按标题搜索绑定、手动选择、海报 / 背景图 / 简介 / 演职员 / 剧照 / 事实信息；
- AniList：绑定 / 解绑、记录进度、打开登录；
- 外部播放器：根据设置决定“立即播放”的行为，外部播放器需要先取 `watch()` 得到真实地址和字幕。

### 播放 `WatchView`

统一解析详情、剧集、历史与进度，按扩展类型分发：

- `VideoWatch.vue`（bangumi）：HLS / MP4 / BT；播放控制、清晰度、音轨、字幕、倍速、剧集侧栏、全屏、DLNA 投屏、BT 文件管理、外部播放器退出回调。
- `ComicReader.vue`（manga）：标准 / 右到左 / 条漫三种模式，缩放、翻页、键盘、剧集切换、进度。
- `NovelReader.vue`（fikushon）：章节内容、字号、键盘翻页、上一章 / 下一章、进度。

`WatchView` 负责历史写入和退出时的 AniList 自动追踪；各播放器只负责渲染与上报进度。

### 扩展管理

- `ExtensionsView`：过滤 / 搜索已安装扩展，导入 URL 或本地文件，查看错误，打开数据目录，进入设置 / 代码 / 站点，卸载。
- `ExtensionRepoView`：仓库索引、类型 Tab、搜索、NSFW 过滤、安装 / 更新 / 卸载；版本比较忽略前导 `v`。
- `ExtensionSettingsView`：读取扩展注册的设置（input / radio / toggle），保存到数据库；支持刷新、清理站点 Cookie、打开站点、打开代码、卸载。
- `CodeEditView`：编辑源码、未保存提示、快捷键保存、Tab 缩进、滚动同步；保存后写盘并重建运行时。

### 设置 `SettingsView`

左侧分区导航 + 右侧滚动，滚动时自动高亮当前区块：

| 区块 | 内容 |
| --- | --- |
| 通用 | 语言、主题、列表模式、NSFW |
| 扩展 | 仓库地址、扩展目录、导入入口 |
| 视频 | 播放器选择、键位（I/J、左右方向） |
| 阅读 | 默认阅读模式、小说字号 |
| 追踪 | AniList 自动追踪、登录入口 |
| 网络 | 代理类型 / 地址、Windows UA |
| 日志 | 写入开关、导出日志 |
| 关于 | 版本、Miru 项目链接 |

### 调试 `DebugView`

三个 Tab：

- 日志：按扩展、等级、关键词过滤，自动滚动，复制 / 清空；
- 网络：按扩展、URL 过滤，查看请求头、请求体、响应头、响应体、状态码；
- 调试：选择扩展与方法（`latest` / `search` / `createFilter` / `detail` / `watch` / `checkUpdate`），填写参数，直接运行并查看 JSON 结果。

调试页是开发扩展的主要入口，方法调用与正常页面走同一套 runtime。

## Pinia stores

### `stores/settings.ts`

对 `db.settings` 的响应式读取；`set()` 会持久化，语言变更时调用 `setLocale()`。常用 getter：`theme`、`language`、`listMode`、`enableNSFW`、`repoUrl`、`anilistToken`、`autoTracking`、`novelFontSize`、`readingMode`、`subtitleTextAlign`、`saveLog`。

### `stores/library.ts`

收藏 / 历史 / 详情缓存 / TMDB 缓存 / 漫画阅读模式的增删改查。历史主键是 `(package, url)`；详情缓存主键也是 `(package, url)`。

### `stores/extensions.ts`

- 文件级缓存 `extensionSources`，运行时缓存 `runtimes`，加载 promise 去重；
- 源码变化、扩展被删除或重载时销毁对应运行时；
- 安装 / 卸载 / 保存源码后 `reloadExtensions()`；
- `hasUpdate()` 做去 `v` 版本比较；
- 仓库 URL 来自设置，索引地址 `${repo}/index.json`。

### `stores/ui.ts`

Toast 队列、确认对话框 Promise、侧栏折叠、全局 loading。`notify()` 支持动作按钮；`notifyError()` 统一抽取错误文本。

## lib 模块

| 文件 | 作用 |
| --- | --- |
| `db.ts` | 响应式数据库、默认值合并、防抖 / 原子持久化 |
| `defaults.ts` | 设置键常量、默认设置、默认 UA |
| `http.ts` | 统一请求、UA、body 编码、代理配置、Cookie |
| `media.ts` | 代理 URL、图片 URL、字幕 SRT/ASS → VTT、Blob 生命周期 |
| `playback.ts` | BT 流解析、视频 / 字幕扩展名判断 |
| `extension-parser.ts` | 扩展头部解析、类名生成、源码转换 |
| `extension-runtime.ts` | iframe 运行时、RPC、扩展方法封装 |
| `extension-dom.ts` | 惰性 HTML 解析、CSS / XPath 查询 |
| `anilist.ts` | AniList GraphQL、登录 token、自动追踪 |
| `tmdb.ts` | TMDB 搜索 / 详情 / 绑定 |
| `log.ts` | 扩展日志、网络日志、日志文件写入 |
| `labels.ts` | 类型 / 状态 / 阅读模式的本地化标签 |
| `markdown.ts` | marked + DOMPurify 渲染简介 |
| `theme.ts` | 系统主题解析、`html.dark` 切换 |
| `window.ts` | 窗口状态恢复与跟踪 |
| `util.ts` | 时间 / 大小 / URL / 格式化 / 类型守卫 |
| `tauri.ts` | `invoke` 包装与错误信息提取 |

## 样式

`src/styles/base.css` 定义全部设计变量：

- 浅色在 `:root`，深色在 `html.dark`；
- 颜色、圆角、阴影、字体、标题栏高度、侧栏宽度都是 CSS 变量；
- 通用类：`.page`、`.page-scroll`、`.page-header`、`.btn`、`.btn-primary`、`.btn-ghost`、`.btn-sm`、`.chip`、`.muted`、`.spinner`。
- 页面样式使用 `<style scoped>`，优先复用变量，不要写死颜色。

## i18n

- 初始化在 `src/i18n/index.ts`；`fallbackLocale: 'en'`，缺失键逐条回退。
- 支持 14 种语言；语言代码与 `Intl` / TMDB 的映射也在该文件。
- 所有文案至少加到 `src/locales/en.json`；中文用户界面建议同步 `zh.json`，繁体可选 `zhHant.json`。
- **特殊字符必须转义**，否则 vue-i18n 编译会报错甚至导致整页空白：
  - `@` 写成 `{'@'}`
  - `{` 写成 `{'{'}`，`}` 写成 `{'}'}`
  - 占位符保持 `{name}`、`{count}` 形式
- 修改语言文件后运行：

```bash
pnpm check:locales
```

脚本会遍历所有 JSON，用 vue-i18n 的 `createParser` 检查每条消息，有错误时以非零码退出。新增文案前可先跑一次，确认基线。

## 新增功能的落点

### 新增页面

1. 在 `src/views/` 新建 `<script setup lang="ts">` 组件；
2. 在 `src/router/index.ts` 添加懒加载路由（沉浸式页面加 `meta: { immersive: true }`）；
3. 如需导航入口，改 `AppSidebar.vue` 的 `navItems`；
4. 文案加到 locales；
5. `pnpm build` 验证类型与模板。

### 新增设置项

1. 在 `lib/defaults.ts` 的 `SettingKey` 与 `defaultSettings` 中登记；
2. 需要响应式 getter 时加到 `stores/settings.ts`；
3. 在 `SettingsView.vue` 对应 section 渲染控件；
4. 后端需要的配置通过 `lib/http.ts` 或新命令下发；
5. 文案加到 locales。

### 新增全局提示 / 确认

```ts
const ui = useUiStore();
ui.notify(t('...'), 'success');
ui.notifyError(error);
const ok = await ui.confirm({
  message: t('...'),
  destructive: true,
  confirmText: t('common.delete-all'),
});
```

## 编码约定

- 全部使用 `<script setup lang="ts">`，`strict` 类型检查；避免 `any`，必要时用 `unknown` + 收窄。
- 异步操作要有 loading / error 状态；错误提示用 `errorMessage()` 或 `ui.notifyError()`。
- 列表渲染必须带稳定 `:key`。
- 组件卸载时清理定时器、事件监听、Blob URL、HLS 实例。
- 颜色、间距、圆角使用 CSS 变量；不要新增一套设计 token。
- 用户可见文案一律 i18n；日志与内部错误可保留英文。

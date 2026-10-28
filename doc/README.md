# Kiru 开发文档

Kiru 是一个基于 **Tauri 2 + Vue 3 + TypeScript** 的桌面动漫 / 漫画 / 小说客户端。它兼容 Miru 的 JavaScript 扩展生态，扩展运行在隔离的 iframe 中，网络、Cookie、设置与日志由宿主应用代理。

本文档面向后续开发与维护。开始修改代码前，建议先读 [架构](architecture.md) 和 [开发调试](development.md)。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | 整体架构、启动流程、扩展 / 播放 / 代理数据流、持久化、安全模型 |
| [frontend.md](frontend.md) | 路由、视图、组件、Pinia store、lib 模块、i18n 与样式约定 |
| [backend.md](backend.md) | Rust 模块、Tauri 命令参考、事件、存储文件、代理 / BT / DLNA / 外部播放器 |
| [extension-development.md](extension-development.md) | Miru 扩展格式、运行时 API、设置 / 日志 / DOM / XPath、调试方法 |
| [feature-map.md](feature-map.md) | 功能到源码文件的定位表 |
| [development.md](development.md) | 环境、构建、CDP 调试、测试数据、常见问题、发布 |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust，edition 2024） |
| 前端 | Vue 3.5 `<script setup>`、TypeScript 6、Vite 8 |
| 状态 | Pinia 3（setup store） |
| 路由 | Vue Router 4（hash history） |
| 国际化 | vue-i18n 11，14 种语言，英文兜底 |
| 播放 | hls.js 1.5、原生 `<video>` |
| 渲染 | marked + DOMPurify、lucide-vue-next |
| 后端 | axum、reqwest、tokio、roxmltree、reqwest_cookie_store |

## 快速开始

前置条件：Node.js、pnpm、Rust 工具链，Windows 需要 WebView2 运行时。

```bash
pnpm install
pnpm tauri dev          # 启动桌面应用（Vite 端口 1420）
```

常用检查：

```bash
pnpm build              # vue-tsc --noEmit + vite build
pnpm check:locales      # 校验所有语言文件的 vue-i18n 语法
cargo check --manifest-path src-tauri/Cargo.toml
```

完整发布构建：`pnpm tauri build`。

## 目录结构

```text
kiru/
├─ doc/                    开发文档
├─ scripts/
│  └─ check-locales.mjs    语言文件语法校验
├─ public/                 静态资源（保留的运行时库副本）
├─ src/
│  ├─ components/          通用 UI 组件
│  ├─ extensions/vendor/   扩展注入库（CryptoJS / JSEncrypt / md5）
│  ├─ i18n/                i18n 初始化、语言识别、文案函数
│  ├─ lib/                 业务基础库（HTTP、DB、扩展运行时、播放等）
│  ├─ locales/             14 个语言的 JSON
│  ├─ router/              路由表
│  ├─ stores/              Pinia stores（settings / library / extensions / ui）
│  ├─ styles/base.css      设计变量、主题、通用控件样式
│  ├─ types/models.ts      共享数据模型
│  ├─ views/               页面（首页、搜索、详情、播放、设置、调试等）
│  │  └─ watch/            视频 / 漫画 / 小说三种播放器
│  ├─ App.vue              应用外壳
│  └─ main.ts              启动入口
├─ src-tauri/
│  ├─ src/                 Rust 后端模块
│  ├─ capabilities/        Tauri 权限配置
│  ├─ tauri.conf.json      窗口、构建、打包配置
│  └─ Cargo.toml
└─ package.json
```

## 运行时数据位置

数据目录由 Tauri 的 `app_data_dir` 决定，再拼接 `kiru` 子目录。Windows 上通常是：

```text
%APPDATA%\com.smilecover.kiru\kiru\
├─ database.json           设置、收藏、历史、扩展设置、详情缓存、TMDB 缓存
├─ cookies.json            全局 Cookie 存储
├─ extensions\*.js         已安装扩展
├─ logs\kiru.log           应用日志（可在设置中关闭写入）
├─ cache\subtitles\        外部播放器下载的字幕（7 天清理）
└─ btserver.exe            BT Server 可执行文件（安装后）
```

实际路径可通过后端命令 `app_paths` 获取；调试页与设置页会展示。

## 约定

- 新文案必须先加到 `src/locales/en.json`；其它语言缺失时会回退英文。
- 用户可见的硬编码英文 / 中文应改为 `t('...')`。
- 新增 Tauri 命令后同步更新 [backend.md](backend.md) 的命令表。
- 修改扩展 API 或数据模型后，同步更新 [extension-development.md](extension-development.md) 与 `src/types/models.ts`。
- 提交前至少跑 `pnpm build`、`pnpm check:locales`；动过 Rust 再跑 `cargo check`。

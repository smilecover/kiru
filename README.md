# Kiru

Kiru 是一个基于 Tauri 2 + Vue 3 + TypeScript 的桌面动漫、漫画与小说客户端，兼容 Miru 的 JavaScript 扩展生态。

## 开发

```bash
pnpm install
pnpm tauri dev
```

常用检查：

```bash
pnpm build
pnpm check:locales
cargo check --manifest-path src-tauri/Cargo.toml
```

完整开发文档见 [doc/README.md](doc/README.md)：

- [架构](doc/architecture.md)
- [前端](doc/frontend.md)
- [后端命令](doc/backend.md)
- [扩展开发](doc/extension-development.md)
- [功能定位](doc/feature-map.md)
- [开发与调试](doc/development.md)

## 说明

- 扩展运行在隔离 iframe 中，网络与 Cookie 由宿主代理。
- 运行时数据（数据库、Cookie、扩展、日志）位于系统应用数据目录下的 `com.smilecover.kiru/kiru`。
- 应用暂无自更新功能，发布需手动分发安装包。

# 扩展开发

Kiru 兼容 Miru 的 JavaScript 扩展格式。扩展是一个带元数据头部的 ES 模块源码文件，默认导出一个继承 `Extension` 的类。Kiru 会在隔离 iframe 中执行它，并通过宿主 RPC 提供网络、Cookie、设置、日志与 HTML 解析能力。

## 文件格式

```js
// ==MiruExtension==
// @name Example
// @package kiru.example
// @version v1.0.0
// @author Kiru
// @lang en
// @license MIT
// @type bangumi
// @webSite https://example.com
// @icon https://example.com/icon.png
// @description Demo extension
// @nsfw false
// ==/MiruExtension==

export default class Example extends Extension {
  async latest(page) {
    return [];
  }
}
```

### 头部字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `package` | 是 | 唯一包名，只能包含字母、数字、`.`、`_`、`@`、`+`、`-`；不能含 `..` |
| `name` | 是 | 显示名称 |
| `version` | 是 | 版本号；仓库比较时会忽略前导 `v` |
| `author` | 是 | 作者 |
| `lang` | 是 | 内容语言 |
| `license` | 是 | 许可证 |
| `type` | 是 | `bangumi` / `manga` / `fikushon` |
| `webSite` | 是 | 站点根地址；请求默认基址、Cookie 域名 |
| `icon` | 否 | 图标 URL |
| `description` | 否 | 简介 |
| `nsfw` | 否 | 字符串 `true` 时视为 NSFW |

解析器用 `@字段 值` 的形式扫描整份源码，所以字段必须写在注释中且每行一个。

### 文件名

扩展文件名必须是 `<package>.js`。安装时会校验头部 `package` 与文件名一致；不一致或重复包名会进入扩展页的错误列表，不会加载。

## 安装与仓库

- **URL 安装**：下载源码，解析 package，写入数据目录 `extensions/<package>.js`。
- **文件安装**：通过系统文件选择器读取 `.js` 源文件。
- **仓库安装**：读取 `${repoUrl}/index.json`，扩展文件地址为 `${repoUrl}/repo/${item.url || item.package + '.js'}`。
- 默认仓库：`https://miru-repo.0n0.dev`，可在设置中修改。
- 卸载会删除文件并销毁运行时；重装 / 保存源码后运行时自动重建。

### 仓库索引

`index.json` 是数组：

```json
[
  {
    "package": "kiru.example",
    "name": "Example",
    "version": "v1.0.0",
    "author": "Kiru",
    "lang": "en",
    "license": "MIT",
    "type": "bangumi",
    "webSite": "https://example.com",
    "nsfw": false,
    "icon": "https://example.com/icon.png",
    "url": "kiru.example.js",
    "description": "Demo extension"
  }
]
```

`url` 可省略，默认使用 `<package>.js`。

## 运行时

### 加载流水线

1. 宿主解析头部，得到元数据。
2. `ExtensionRuntime` 把以下内容拼成一个 bundle：
   - CryptoJS、JSEncrypt、md5；
   - shim（`Extension`、`Element`、`XPathNode`、`fetch`、日志捕获、RPC）；
   - 转译后的扩展源码；
   - bootstrap（实例化、调用 `load()`、上报 ready）。
3. 源码中的 `export default class ...` 会被替换成 `class <ClassName> extends Extension {`。
   - `ClassName` 由包名去掉 `.` 生成；含非字母字符时会被清洗并追加 `Renamed`。
   - **`export default class` 必须写在一行内**，否则转换失败。
4. bundle 以 base64 放入 `about:srcdoc` iframe，sandbox 只有 `allow-scripts`。
5. bootstrap 创建实例并调用 `load()`；成功后清理未注册的旧设置，然后发送 `ready`。
6. 宿主通过 `postMessage` 调用 `latest` / `search` / `detail` / `watch` / `checkUpdate` / `createFilter`。

加载与单次调用默认超时 **120 秒**。

### 生命周期

- `load()`：扩展初始化，通常在这里 `registerSetting()`。
  - `load()` 抛错会被记录到日志，但扩展仍会变为 ready（其余方法仍可调用）。
  - 只有 `load()` 成功时才会执行设置清理；失败的扩展不会删除旧设置。
- `latest(page)` / `search(keyword, page, filter)`：返回列表项数组。
- `createFilter(currentFilter?)`：可选，返回筛选器定义。
- `detail(url)`：返回详情与剧集分组。
- `watch(url)`：返回播放数据，结构由扩展类型决定。
- `checkUpdate(url)`：可选，返回更新提示文本（显示在首页历史卡片上）。

## API 参考

### `this.request(url, options?)`

最常用的请求方法。

```js
const html = await this.request('/list?page=1');
const json = await this.request('/api/search', {
  method: 'post',
  headers: { 'Content-Type': 'application/json' },
  queryParameters: { q: 'keyword' },
  data: { page: 1 },
});
```

行为：

- 最终 URL = `options.headers["Miru-Url"]`（若存在）或 `@webSite`，直接拼接 `url`。
  - 因此 `url` 应该是相对路径（如 `/search`）或以 `/` 开头。
  - 需要请求其它域名时，把完整基址放进 `Miru-Url`，例如：
    ```js
    await this.request('/api', { headers: { 'Miru-Url': 'https://api.example.org' } });
    ```
- `method` 默认 `get`，大小写不敏感。
- `queryParameters` 会追加到 URL。
- `data` 支持字符串、对象、`URLSearchParams` 或二进制；对象默认 JSON，`Content-Type` 为表单时自动编码。
- 自动补充 `User-Agent`（设置中的 Windows UA）与站点 Cookie。
- 非 2xx 会抛错。
- 返回字符串；能 `JSON.parse` 时自动返回对象。

### `fetch(input, init?)`

兼容标准 `fetch` 的简化实现，返回真正的 `Response`：

```js
const response = await fetch('https://api.example.com/data', {
  method: 'GET',
  headers: { Accept: 'application/json' },
});
const data = await response.json();
```

限制：

- 请求体只支持字符串；
- 不处理 cookies / credentials / redirect 等浏览器语义；
- 响应始终以文本构造，不能直接读取二进制；
- 非 2xx 不会抛错（与浏览器一致）。

### 日志

- `console.log` / `console.error` 会转发到宿主扩展日志；
- 未捕获异常与未处理的 Promise rejection 也会记录；
- 所有 `request` / `fetch` 会生成网络日志（响应体截断到 20,000 字符）。

在 **调试页 → 日志 / 网络** 中查看；日志写入文件受设置 `SaveLog` 控制（仅错误会写文件）。

### 设置

```js
async load() {
  await this.registerSetting({
    title: 'API 地址',
    key: 'api',
    type: 'input',
    defaultValue: 'https://example.com',
    description: '留空使用默认站点',
  });

  await this.registerSetting({
    title: '线路',
    key: 'line',
    type: 'radio',
    defaultValue: 'a',
    options: { a: '线路 A', b: '线路 B' },
  });

  await this.registerSetting({
    title: '显示 NSFW',
    key: 'nsfw',
    type: 'toggle',
    defaultValue: 'false',
  });
}

async latest(page) {
  const api = await this.getSetting('api');
  ...
}
```

- `type`：`input` / `radio` / `toggle`；未知类型按 `input` 处理。
- `radio` 必须提供 `options`，否则抛错。
- `getSetting(key)` 返回用户值，否则默认值，否则空字符串。toggle 的值为字符串 `"true"` / `"false"`。
- 设置保存在 `database.json` 的 `extensionSettings`。
- `load()` 成功后，未在本轮注册的该扩展设置会被删除。
- 设置页支持输入框、单选、开关；修改立即持久化。

### DOM 查询

所有查询都是**惰性字符串解析**，不会执行脚本或加载资源。

```js
const title = await this.querySelector(html, 'h1').text;
const cover = await this.querySelector(html, '.cover').getAttributeText('data-src');
const links = await this.querySelectorAll(html, '.episode a');
for (const link of links) {
  const name = (await link.text).trim();
  const href = await link.getAttributeText('href');
}
```

`querySelector(content, selector)` 返回 `Element`：

| 成员 | 说明 |
| --- | --- |
| `.text` | 文本内容 |
| `.outerHTML` / `.innerHTML` | HTML |
| `.excute(fun?)` | `text` / `innerHTML` / `outerHTML`，默认 `outerHTML` |
| `.querySelector(selector)` | 在当前元素内部继续查询 |
| `.querySelectorAll` | 使用扩展实例的 `querySelectorAll` |
| `.getAttributeText(attr)` | 当前元素的属性 |
| `.removeSelector(selector)` | 删除内部匹配元素，返回自身 |

`querySelectorAll(content, selector)` 返回 `Element[]`，每个元素以匹配项的 `outerHTML` 作为内容。

`getAttributeText(content, selector, attr)` 可直接取属性。

### XPath

```js
const text = await this.queryXPath(html, '//div[@class="item"]/text()').text;
const href = await this.queryXPath(html, '//a/@href').attr;
const all = await this.queryXPath(html, '//div[@class="item"]').allHTML;
const attrs = await this.queryXPath(html, '//a/@href').attrs; // JSON 字符串
```

`XPathNode` 成员：

| 成员 | 返回 |
| --- | --- |
| `.text` | 第一个节点文本 |
| `.outerHTML` | 第一个节点 HTML |
| `.allHTML` | 所有匹配元素 HTML 数组 |
| `.attr` | 第一个非空属性值；支持 `.../@href` 结尾的表达式 |
| `.attrs` | 所有属性值的 **JSON 字符串**，需要 `JSON.parse` |
| `.excute(fun?)` | 同上，默认 `text` |

### 注入的全局对象

- `Extension`：基类。
- `Element` / `XPathNode`：查询辅助类（会覆盖 iframe 内的 `window.Element`）。
- `CryptoJS`、`JSEncrypt`、`md5`：随 bundle 注入。
- `window.global`：指向 `window`。
- `fetch`：宿主代理实现。

没有 `XMLHttpRequest`、`localStorage`、Tauri API 或应用 DOM。由于 iframe 是 opaque origin，访问 `localStorage` 会抛异常。

## 返回结构

### 列表项

```ts
{
  title: string;
  url: string;
  cover?: string;
  update?: string;
  headers?: Record<string, string>;
}
```

未提供 `headers` 时，宿主补充 `Referer`（最近一次请求 URL）、`User-Agent`、站点 Cookie。

### 详情

```ts
{
  title: string;
  cover?: string;
  desc?: string;
  headers?: Record<string, string>;
  episodes?: { title: string; urls: { name: string; url: string }[] }[];
}
```

`episodes` 是分组数组；每组 `urls` 是实际剧集 / 章节。播放页只使用分组内的 `urls`。

### 播放数据

bangumi：

```ts
{
  type: 'hls' | 'mp4' | 'torrent';
  url: string;
  headers?: Record<string, string>;
  subtitles?: { title: string; url: string; language?: string }[];
  audioTrack?: string;
}
```

manga：

```ts
{ urls: string[]; headers?: Record<string, string> }
```

fikushon：

```ts
{ content: string[]; title: string; subtitle?: string }
```

### 筛选器

```ts
{
  [key: string]: {
    title: string;
    min: number;
    max: number;
    default: string;
    options: Record<string, string>; // value -> label
  };
}
```

`search(keyword, page, filter)` 收到的 `filter` 形如 `{ key: string[] }`，值为用户选中的 option key。

## 完整示例

```js
// ==MiruExtension==
// @name Example
// @package kiru.example
// @version v1.0.0
// @author Kiru
// @lang en
// @license MIT
// @type bangumi
// @webSite https://example.com
// @nsfw false
// ==/MiruExtension==

export default class Example extends Extension {
  async load() {
    await this.registerSetting({
      title: 'API host',
      key: 'api',
      type: 'input',
      defaultValue: 'https://example.com',
      description: 'Used instead of @webSite when set',
    });
  }

  async latest(page) {
    const html = await this.request(`/latest?page=${page}`);
    return await this.parseList(html);
  }

  async search(keyword, page) {
    const html = await this.request('/search', {
      queryParameters: { q: keyword, page },
    });
    return await this.parseList(html);
  }

  async createFilter() {
    return {
      genre: {
        title: 'Genre',
        min: 1,
        max: 1,
        default: 'all',
        options: { all: 'All', action: 'Action', comedy: 'Comedy' },
      },
    };
  }

  async parseList(html) {
    const cards = await this.querySelectorAll(html, '.card');
    const items = [];
    for (const card of cards) {
      const title = (await card.querySelector('.title').text).trim();
      const url = await card.querySelector('a').getAttributeText('href');
      const cover = await card.querySelector('img').getAttributeText('data-src');
      if (title && url) items.push({ title, url, cover });
    }
    return items;
  }

  async detail(url) {
    const html = await this.request(url);
    const title = (await this.querySelector(html, 'h1').text).trim();
    const desc = await this.querySelector(html, '.summary').text;
    const links = await this.querySelectorAll(html, '.episode a');
    const urls = [];
    for (const link of links) {
      urls.push({
        name: (await link.text).trim(),
        url: await link.getAttributeText('href'),
      });
    }
    return {
      title,
      desc,
      episodes: [{ title: 'Episodes', urls }],
    };
  }

  async watch(url) {
    return { type: 'hls', url, subtitles: [] };
  }

  async checkUpdate(url) {
    return '';
  }
}
```

## 调试

1. **调试页 → 调试**：选择扩展和方法，直接运行并查看 JSON 结果。`search` 支持 `keyWord`、`page`、筛选器 JSON；`detail` / `watch` / `checkUpdate` 需要 URL。
2. **调试页 → 网络**：确认请求地址、请求头、请求体、响应状态与响应体。
3. **调试页 → 日志**：`console.log`、异常、`load()` 失败都会出现在这里。
4. **代码编辑页**：改完保存会自动重建运行时，然后重新运行方法。
5. 扩展加载慢或网络卡住时，注意 120 秒超时；错误信息会包含方法名。

## 兼容性注意事项

- 扩展源码必须包含 `export default class ...`，且类声明与 `{` 在同一行。
- 文件名必须与 `package` 完全一致。
- 返回值必须可 JSON 序列化；不要返回 DOM、函数、循环引用、`undefined` 作为必需字段。
- 宿主对列表、详情、播放数据会做字段归一化；缺失字段会得到空字符串 / 空数组。
- `request` 的基址是字符串拼接，不要把绝对 URL 直接传给 `request`（会拼成 `webSitehttps://...`）；使用 `Miru-Url` header。
- 下拉筛选的 `options` 必须是对象；`radio` 设置缺 `options` 会抛错。
- iframe 没有应用 DOM 与 Tauri 权限；需要站点 HTML 时用 `request` 获取再解析。
- 第三方扩展代码在这个沙箱中执行，但仍应只安装可信来源；网络代理只监听本机并带随机 token。

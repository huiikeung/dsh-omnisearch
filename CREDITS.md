# CREDITS / 来源与许可

`dsh-omnisearch` 是上游项目的合并产物。宿主骨架、Provider 池、小红书/X 浏览器源、
Search Mode 与设置卡片来自 dsh-web-tools；免 Key 引擎族、平台搜索、timeRange 工具、
结果缓存与提示词注入来自 dsh-free-search。

## 1. A3Boy/dsh-web-tools（宿主骨架，MIT）

- 仓库：https://github.com/A3Boy/dsh-web-tools
- 采用内容：`src/host/**`（registry / pool / fallback / routing-policy / search-hints /
  providers/{exa,tavily,firecrawl,parallel,brave,you,jina,searxng} / sources / browser /
  quota / fetch-proxy / fetch-security / generic-fetch / search-mode-runtime / routes）、
  `src/client/**`（设置卡片）、`src/shared/**`、`test/**` 的大部分用例。
- 本仓库对应的初始快照：commit `9b45045ac8a011429d494399a49846ae907c07d3`（v0.3.3）。
- 原 `LICENSE`（MIT © A3Boy）原样保留在仓库根目录。

## 2. DDDMUC/dsh-free-search（引擎与工具，MIT）

- 仓库：https://github.com/DDDMUC/dsh-free-search
- 采用内容（按行为重写为本项目的适配器/工具，未复制其源码文件）：
  - 免 Key 引擎：Bing HTML、DuckDuckGo HTML / Lite、AnySearch REST、Keenable MCP；
    Exa MCP、Tavily keyless 头、Firecrawl 无鉴权 的匿名档语义。
  - 回退链语义：首选 → 其它引擎 → 剩余免 Key 引擎；`0 results` 计为失败；
    `Note:` 两种文案的确切判据；缺失 Key 视为可回退（而非终止）。
  - `advanced_search`（timeRange 三种形式、最近似档位映射、能过滤的引擎优先）、
    `platform_search`（8 平台公开 API 与解析）、`free_search_test`（逐引擎体检）。
  - 结果缓存（LRU 50、TTL 0–5 分钟、回退条目 TTL/5）、系统提示词引擎段（order 500）、
    `bingMarket` / `region` / `safeSearch` 配置语义。
- 合并前的逐行规格见 `notes/free-search-spec.md`（含端点、请求头、解析路径、错误语义）。

## 3. liustack/modsearch（设计参考，MIT）

- 仓库：https://github.com/liustack/modsearch
- 合并初期曾按其契约实现 CLI 桥（`x_search` / `read_page` / Firecrawl keyless 搜索），
  2026-09-20 应使用者要求整体移除；`notes/modsearch-spec.md` 规格文档保留作参考。
- 当前代码不包含也不调用 `@liustack/modsearch`。

## 商标与支持

Exa、Tavily、Firecrawl、Parallel、Brave、You.com、Jina、SearXNG、DuckDuckGo、Bing、
AnySearch、Keenable、X/Twitter、小红书、GitHub、V2EX、Bilibili、Reddit、Hacker News、
Stack Overflow、Wikipedia、npm 等名称与商标归各自所有者。上游各自的条款与免费额度约束
由使用者自行遵守。上游项目的 bug 与支持请求请提交到各自仓库；本项目只维护合并后的实现。

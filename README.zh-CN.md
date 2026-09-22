# dsh-omnisearch

**一个插件，两个上游的联网能力。** 以 [A3Boy/dsh-web-tools](https://github.com/A3Boy/dsh-web-tools) 的多 Provider 池架构为基础，整合
[DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search) 的免 Key 引擎与工具集。

## 解决了什么

1. **零 Key 可用**：首次安装、没有配置任何 API Key 也能搜索。`bing / ddg / ddg-lite / anysearch / keenable(MCP)` 完全免 Key；`exa(MCP) / tavily(keyless) / firecrawl(keyless)` 在没 Key 时自动走各自的匿名额度通道。
2. **不会因为一个引擎挂掉就断网**：默认链路 `exa → tavily → firecrawl → keenable → bing → anysearch → ddg → ddg-lite → searxng → parallel → brave → you → jina`，任何失败都自动换下一个，并在结果顶部附 `Note:` 说明实际使用的引擎和原因。
3. **一个插件、一个 seam**：不再出现「三个插件都往 `web` 行写 patch」导致 `web.searchProvider` 被覆盖、`fetchProvider` 丢失（`WEB_PROVIDER_AMBIGUOUS`）的问题 —— 本插件的 patch 同时显式钉住 `searchProvider` 与 `fetchProvider`。

## 能力对照（合并前 → 合并后）

| 能力 | 来源 | dsh-omnisearch |
|---|---|---|
| 8 大 Provider 原生参数适配（Exa/Tavily/Firecrawl/Parallel/Brave/You/Jina/SearXNG） | dsh-web-tools | ✅ 保留 |
| 多 Key 轮换、429 Retry-After 冷却、Ordered/Round-Robin/Random 路由 | dsh-web-tools | ✅ 保留 |
| 小红书 / X 浏览器会话源（`小红书:` `X:` 前缀） | dsh-web-tools | ✅ 保留 |
| 会话级 Search Mode（auto / required，`/search`，回合末尾强制联网） | dsh-web-tools | ✅ 保留 |
| 免 Key 引擎 Bing / DDG / DDG-Lite / AnySearch / Keenable-MCP | dsh-free-search | ✅ 原生实现 |
| Exa-MCP / Tavily-keyless / Firecrawl-keyless 匿名档 | dsh-free-search | ✅ 并入对应适配器 |
| `advanced_search`（timeRange：固定档 / 相对值 / 绝对日期） | dsh-free-search | ✅ 新增工具 + 按「能过滤的引擎优先」重排链路 |
| `platform_search`（GitHub/V2EX/B站/Reddit/HN/SO/Wikipedia/npm） | dsh-free-search | ✅ 新增工具 |
| `free_search_test` 引擎体检 | dsh-free-search | ✅ 新增工具 |
| 结果缓存（LRU 50，TTL 0–5 分钟，回退条目 1/5 TTL） | dsh-free-search | ✅ 新增 |
| 引擎链 / 免 Key 状态系统提示词注入 | dsh-free-search | ✅ 新增（order 500，设置变更即时重建） |
| 回退 `Note:` 两种文案判据 | dsh-free-search | ✅ 并入执行器（含 0 结果算失败） |
| SSRF / 私网拦截、DNS pin（通用抓取路径） | dsh-web-tools | ✅ 保留 |

## 工具一览（模型可见）

- `web_search` / `web_fetch`：走统一链路，原生工具接口不变
- `advanced_search`：显式 `timeRange`（`day|week|month|year`、`12h/3d/2mo/1y`、`2026-07-01`）
- `platform_search`：8 个平台的公开 API
- `free_search_test`：体检所有引擎，报告哪个能用、为什么不能用

## 界面双语标签（中文 + English）

命令弹窗、标签页、插件管理页这些位置的「中文 + English」双语标签，由独立插件
**[dsh-bilingual-ui](../dsh-bilingual-ui)** 提供（`/vol1/1000/Deepseek-Harness/工作台/插件/dsh-bilingual-ui`）——
它不依赖本插件：本插件被停用或替换，双语显示照常工作。其覆盖范围、词典与边界见那边的 README。

本插件只保留自己设置页左栏的名字：固定为「网页搜索 Web Search」（`src/client/i18n-dict.ts` 的 `nav`，中英文字典同值），
配套的地球图标由 `src/client/nav-glyph.ts` 在运行时钉上。

## 安装

```sh
cd /vol1/1000/Deepseek-Harness/工作台/插件/dsh-omnisearch
pnpm install && pnpm run build

dsh plugin --profile web add link:/vol1/1000/Deepseek-Harness/工作台/插件/dsh-omnisearch
# 若仍装着三个上游插件，先移除，避免同一个 web 行被多次 patch：
dsh plugin --profile web remove dsh-web-tools dsh-free-search @liustack/modsearch
# 重启生效
dsh web
```

设置入口：左侧「插件」页 → `dsh-omnisearch`。配置命名空间 `dsh-omnisearch`，凭据前缀 `DSH_OMNISEARCH_*`。

## 配置（`~/.dsh/settings.yaml` → `dsh-omnisearch`）

```yaml
dsh-omnisearch:
  defaultProvider: exa     # 首选引擎
  fallbackOrder: []        # 留空 = 使用内置默认链
  bingMarket: zh-CN        # Bing 市场（显式设置时同时决定 Accept-Language）
  region: ""               # DuckDuckGo kl（如 cn-zh）
  safeSearch: off          # off | moderate | strict（bing / ddg / ddg-lite）
  lang: zh                 # 结果语言档案
  cacheTtlMs: 300000       # 结果缓存 TTL，0 = 关闭，上限 300000
  promptSection: true      # 是否注入引擎/状态系统提示词段
  platformSearchEnabled:   # platform_search 工具可用平台
    github: true
    v2ex: true
    bilibili: true
    reddit: true
    hn: true
    stackoverflow: true
    wikipedia: true
    npm: true
```

API Key 写入 DSH 凭据中心（`DSH_OMNISEARCH_EXA`、`DSH_OMNISEARCH_TAVILY`、`DSH_OMNISEARCH_FIRECRAWL`、`DSH_OMNISEARCH_KEENABLE` …），或通过设置页填写。免 Key 引擎不需要任何 Key。

## 开发与验证

```sh
pnpm run typecheck   # host + client 双工程类型检查
pnpm test            # 单元测试
pnpm run build       # tsc + tsdown → lib/host/*、lib/client.js
```

本机实测（2026-09，keyless 全链路）：bing 533ms ✅ · anysearch 1.5s ✅ · keenable(MCP) 1.1s ✅ ·
exa(MCP) 1.6s ✅ · tavily(keyless) 5.7s ✅ · firecrawl(keyless) 1.1s ✅ · ddg/ddg-lite ❌（当前网络被反爬拦截，自动回退）。
浏览器相关用例（browser-lifecycle / XHS / SessionManager）在无 Edge/Chrome 的机器上会失败，属环境问题，与本次合并无关。

`notes/free-search-spec.md`、`notes/modsearch-spec.md` 是合并前对两个上游插件逐行核对得到的工程规格（端点、参数、解析路径、错误语义、工具 schema、桥接端点），保留作为实现依据与后续维护参考。

## 与上游的关系与许可

MIT。宿主代码来自 A3Boy/dsh-web-tools（其 LICENSE 原样保留），并合并了 DDDMUC/dsh-free-search 的行为规格与算法，详见 [CREDITS.md](./CREDITS.md)。
三个上游的版本更新与社区支持仍以各自仓库为准。

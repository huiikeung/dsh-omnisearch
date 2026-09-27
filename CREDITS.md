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
- 2026-09-27 复核：上游 `main` 仍停在该 commit（`pushed_at` 2026-09-03），无新提交可同步；
  未合并的 `feat/provider-capability-*` 分支不构成更新（见 README 的同步状态一节）。

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
- 合并前的逐行规格见 `notes/free-search-spec.md`（含端点、请求头、解析路径、错误语义），
  该规格记录的上游版本为 **v0.4.32**。
- 2026-09-27 增量同步至上游 **v0.4.39**（按本项目的适配器/工具架构重写，未复制源码）：
  - v0.4.33 提示注入防护：`<untrusted-web-content>` 边界（`src/host/untrusted-content.ts`）
    用于 `advanced_search` / `platform_search` / `free_search_test` 的 render，
    系统提示词段追加 PROMPT-INJECTION SAFETY 说明。
  - v0.4.35 Bing 无结果时返回无关缓存 SERP（issue #38）：查询词元/结果文本重叠判定，
    不相关即算 0 结果交给回退链。
  - v0.4.36–37 DSH 0.1.7 配置模型迁移：插件 Config 全字段补 schema 默认值 + `.volatile()`，
    设置注册双代兼容（≤0.1.6 `settings.register`；0.1.7+ `settings.configure` +
    `settings.update`，读取 Loader 传入的 live 引用）。
  - v0.4.38 保存失败明细：设置卡片/ProviderModal 展示 wire `code: message`。
  - v0.4.39 AnySearch 可选 API Key：401/403 时本进程忽略该 key 并回退匿名额度，
    写入新 key 时解除忽略。
  - 规格 §1.12 的 `serpbase` 引擎（Google organic，`SERPBASE` 凭据，需 Key）已实现，
    成为第 14 个引擎。

## 3. liustack/modsearch（设计参考，MIT）

- 仓库：https://github.com/liustack/modsearch
- 合并初期曾按其契约实现 CLI 桥（`x_search` / `read_page` / Firecrawl keyless 搜索），
  2026-09-20 应使用者要求整体移除；`notes/modsearch-spec.md` 规格文档保留作参考。
- 当前代码不包含也不调用 `@liustack/modsearch`。

## 商标与支持

Exa、Tavily、Firecrawl、Parallel、Brave、You.com、Jina、SearXNG、DuckDuckGo、Bing、
AnySearch、Keenable、SerpBase、X/Twitter、小红书、GitHub、V2EX、Bilibili、Reddit、Hacker News、
Stack Overflow、Wikipedia、npm 等名称与商标归各自所有者。上游各自的条款与免费额度约束
由使用者自行遵守。上游项目的 bug 与支持请求请提交到各自仓库；本项目只维护合并后的实现。

## 源自 dsh-web-search-enhanced（Yurzi，MIT）

- 仓库：https://github.com/Yurzi/dsh-web-search-enhanced
- `tinyfish` 适配器（免 Key 公共 MCP 通道 `agent.tinyfish.ai/mcp`，`X-TinyFish-Access-Mode: keyless`；REST `api.search.tinyfish.ai` 为有 Key 层）与 `openalex` 适配器（`api.openalex.org/works`，礼貌池 mailto、`abstract_inverted_index` 摘要重建）移植自该插件的 structured adapter，按 dsh-omnisearch 的 ProviderAdapter 契约改写。
- 实时性三档（fresh/realtime）未移植：仅 Firecrawl/Exa 实际生效，且 advanced_search 的 timeRange 已覆盖主要场景。

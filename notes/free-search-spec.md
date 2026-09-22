# dsh-free-search 工程规格（可直接照抄实现）

来源（只读，未修改）：

- `dsh-free-search/lib/index.js` — 2499 行，插件 host 端全部实现（v0.4.32）
- `dsh-free-search/lib/client.js` — 设置页 UI、i18n 键名、默认值
- `dsh-free-search/package.json` — `name: dsh-free-search`，`version: 0.4.32`，`type: module`，`main: lib/index.js`，唯一运行期依赖 `@deepseek-ai/schemastery`，peer 依赖 `@deepseek-ai/dsh-settings` / `@deepseek-ai/dsh-tools`

插件导出（`package.json` 的 `dsh` 字段）：

```json
"dsh": {
  "bundle": { "patch": "cordis.patch.yml" },
  "client": { "inject": ["@deepseek-ai/dsh-client-runtime"], "platform": "web" },
  "engines": { "dsh": ">=0.1.1-rc.1" }
}
```

插件身份：`const name = "web-search-free"; const inject = ["web"];`（`index.js:1727-1728`）。

---

## 0. 公共常量与归一化约定

### 0.1 URL / 头常量（`index.js:8-20`）

```js
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/";
const BING_URL = "https://www.bing.com/search";
const TAVILY_URL = "https://api.tavily.com/search";
const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/search";
const PARALLEL_URL = "https://api.parallel.ai/v1/search";
const PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";
const KEENABLE_URL = "https://api.keenable.ai/v1/search";
const KEENABLE_MCP_URL = "https://api.keenable.ai/mcp";
const SERPBASE_URL = "https://api.serpbase.dev/google/search";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ACCEPT_LANG = "zh-CN,zh;q=0.9,en;q=0.8";

// index.js:430-431
const ANYSEARCH_URL = "https://api.anysearch.com/v1/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
```

另有 Exa REST `https://api.exa.ai/search`、Perplexity `https://api.perplexity.ai/chat/completions`、DeepSeek `https://api.deepseek.com/anthropic/v1/messages` 为内联字面量。

### 0.2 引擎枚举（`index.js:51-52`）

```js
const FREE_ENGINES = ["ddg", "ddg-lite", "bing", "searxng", "anysearch"];
const ALL_ENGINES = ["ddg", "ddg-lite", "bing", "searxng", "anysearch", "exa", "tavily", "keenable",
  "firecrawl", "parallel", "perplexity", "serpbase", "deepseek-official"];
```

`ALL_ENGINES` 共 **13** 个。`FREE_ENGINES` 被导出但**不参与**回退链构造（链内自己另有一份数组，见 §3）。

### 0.3 统一结果对象（所有引擎的返回值形状）

```ts
type Source = { url: string; title?: string; snippet?: string; publishedAt?: string };
type EngineResult = { sources: Source[]; truncated: boolean; content?: string };
```

- `title` / `snippet` / `publishedAt` 一律**按存在才写**（用 `...(x ? {k:v} : {})` 展开），不写 `undefined` 字段（lossless JSON 要求）。
- 所有引擎的 `truncated` 都是字面量 `false`（无引擎真实实现截断标记）。
- 只有 `perplexity` 会额外返回 `content`（LLM 答案文本）。

### 0.4 公共工具函数（照抄）

```js
function decodeEntities(text) {            // index.js:158-168
  return String(text)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {                 // index.js:195-197
  return decodeEntities(String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractDdgUrl(rel) {              // index.js:199-211
  if (!rel) return null;
  const m = rel.match(/uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  if (rel.startsWith("//")) return `https:${rel}`;
  return rel;
}

function uniqueSources(sources, limit) {   // index.js:213-224 —— 按 url 去重且保序，满 limit 即 break
  const seen = new Set(); const out = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) { seen.add(s.url); out.push(s); }
    if (out.length >= limit) break;
  }
  return out;
}
```

绝大多数引擎以 `uniqueSources(sources, maxResults ?? 10)` 收尾（`searxng`/`exa`/`tavily`/`keenable`/`firecrawl`/`parallel`/`perplexity`/`serpbase`/`deepseek-official`）。例外：DDG/DDG-Lite/Bing 也是 `maxResults ?? 10`；`exa MCP`、`platform_search` 系列返回原始数组。

### 0.5 统一 snippet 清洗（只在回退链出口做一次，`index.js:182-193`）

```js
const SNIPPET_NOISE =
  /\b(sign up|sign in|log in|login|subscribe( to| for)?|member[- ]?only|become a member|create (a )?free account|read more|continue reading|story continues|get started|install (the )?app|view on|medium membership|join \w+ for free|get updates from this writer|stories in your inbox|remember me for|unlock this|free to read|become a patron)\b/gi;

function cleanSnippet(text) {
  if (!text) return text;
  return String(text)
    .replace(SNIPPET_NOISE, " ")
    .replace(/^\s*(#{1,6}\s*|\[\s*x?\s*\]\s*|-\s*\[\s*x?\s*\]\s*|>\s*)/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
```

### 0.6 HTML 抓取（DDG / DDG-Lite / Bing 共用）

```js
async function fetchHtml(url, signal, acceptLang) {   // index.js:226-254
  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);   // 单请求 12s
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, "accept-language": acceptLang ?? ACCEPT_LANG },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`connection error: ${error?.message ?? String(error)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.split("?")[0]}`);
  const html = await response.text();
  // 反爬检测对三个 HTML 引擎都生效（Bing 也会命中这段逻辑）
  if (response.status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(html.slice(0, 4000))) {
    throw new Error("DuckDuckGo is rate-limited right now (anti-bot challenge, usually temporary) - Bing works");
  }
  return html;
}

async function fetchHtmlWithRetry(url, signal, acceptLang) {   // index.js:257-270
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchHtml(url, signal, acceptLang);
      if (html.length > 500) return html;                 // 空响应判定阈值：<=500 字节算空
      lastError = new Error(`empty response (${html.length} bytes)`);
    } catch (error) { lastError = error; }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));  // 间隔 1.5s
  }
  throw lastError ?? new Error("fetch failed");
}
```

### 0.7 时间过滤解析（`index.js:114-156`）

```js
const TIME_RANGES = ["day", "week", "month", "year"];
const DAYS_BY_RANGE = { day: 1, week: 7, month: 30, year: 365 };
const KEENABLE_REL = { day: "1d", week: "7d", month: "1mo", year: "1y" };   // 定义后未被使用
const SEARXNG_TIME = { day: "day", week: "week", month: "month", year: "year" };

function isoDaysAgo(days) {   // 例：2026-07-01T00:00:00.000Z（毫秒位强制 .000Z）
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function parseTimeRange(input) {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "object") {
    if (typeof input.after === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.after)) return { after: input.after };
    if (typeof input.days === "number" && Number.isFinite(input.days) && input.days > 0) return { days: input.days };
    return undefined;
  }
  const s = String(input).trim().toLowerCase();
  if (s.length === 0) return undefined;
  if (TIME_RANGES.includes(s)) return { days: DAYS_BY_RANGE[s] };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { after: s };
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(h|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|year|years)$/);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2][0];           // 只取首字母：hour→h, mo→m, month→m, year→y
    const days = unit === "h" ? n / 24 : unit === "d" ? n : unit === "w" ? n * 7 : unit === "m" ? n * 30 : n * 365;
    return { days };
  }
  return undefined;
}

function approximateTimeRange(days) {    // 自定义天数 → 固定档
  if (days <= 2) return "day";
  if (days <= 14) return "week";
  if (days <= 90) return "month";
  return "year";
}
```

`parseTimeRange` 返回 `{ days }` 或 `{ after: "YYYY-MM-DD" }`，无效返回 `undefined`。各引擎调用处大量使用 `timeRange.days ?? 7` 兜底。

---

## 1. 引擎清单（13 个）

字段说明：**Key** = 是否需要 key 及来源；**时间过滤** = 参数名/值格式/精确度。

### 1.1 ddg — DuckDuckGo HTML

| 项 | 规格 |
|---|---|
| 请求 | `GET https://html.duckduckgo.com/html/?<URLSearchParams>` |
| 参数 | `q`=query；`kl`=options.region（**仅当设置里 region 非空才加**）；`adlt`；`df`（仅 timeRange 时） |
| 头 | `user-agent: USER_AGENT`，`accept-language: ACCEPT_LANG`（`fetchHtml` 默认；DDG 不传自定义 lang） |
| 重定向 | `follow`，单请求 12s，整体重试 3 次/间隔 1.5s |
| Key | 不需要 |
| 时间过滤 | `df`：`{day:"d",week:"w",month:"m",year:"y"}[approximateTimeRange(days ?? 7)]`，**近似固定档** |

```js
async function searchDdgHtml(query, maxResults, options, signal) {   // index.js:272-301
  const params = new URLSearchParams({ q: query });
  if (options?.region) params.set("kl", options.region);
  const adlt = options?.safeSearch ?? "off";
  params.set("adlt", adlt === "strict" ? "1" : adlt === "moderate" ? "0" : "-1");   // off → -1
  if (options?.timeRange) {
    const df = { day: "d", week: "w", month: "m", year: "y" }[approximateTimeRange(options.timeRange.days ?? 7)];
    if (df) params.set("df", df);
  }
  const html = await fetchHtmlWithRetry(`${DDG_HTML_URL}?${params}`, signal);
  ...
}
```

响应解析（HTML 正则）：

```js
const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? [];
for (const block of blocks) {
  const urlMatch     = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/);
  const titleMatch   = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
  const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
  const dateMatch    = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/);
  const url = extractDdgUrl(urlMatch?.[1]);      // 解 uddg= 或 // 前缀
  if (!url) continue;
  sources.push({
    url,
    ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
    ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {}),
    ...(dateMatch ? { publishedAt: dateMatch[1] } : {}),
  });
}
return { sources: uniqueSources(sources, maxResults ?? 10), truncated: false };
```

失败/限流语义：HTTP 非 2xx → `HTTP <status> from https://html.duckduckgo.com/html/`；正文前 4000 字符命中 `anomaly|captcha|unusual traffic|robot check` 或状态 202 → `DuckDuckGo is rate-limited right now (anti-bot challenge, usually temporary) - Bing works`；<=500 字节视为 `empty response (N bytes)` 并重试；重试 3 次后抛出最后错误。返回 0 条**算失败**（回退链判据，见 §3）。

### 1.2 ddg-lite — DuckDuckGo Lite

| 项 | 规格 |
|---|---|
| 请求 | `GET https://lite.duckduckgo.com/lite/?<URLSearchParams>` |
| 参数 | `q`；`adlt`（同上 -1/0/1）；`df`。**没有 `kl`**（此函数不读 region） |
| 头 | 同 `fetchHtml` 默认 |
| Key | 不需要 |
| 时间过滤 | `df`，同 DDG，近似固定档 |

```js
async function searchDdgLite(query, maxResults, options, signal) {   // index.js:303-331
  const params = new URLSearchParams({ q: query });
  const adlt = options?.safeSearch ?? "off";
  params.set("adlt", adlt === "strict" ? "1" : adlt === "moderate" ? "0" : "-1");
  if (options?.timeRange) { /* 同 DDG 的 df 映射 */ }
  const html = await fetchHtmlWithRetry(`${DDG_LITE_URL}?${params}`, signal);
  const linkMatches    = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
  const sources = [];
  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i];
    const hrefMatch  = tag.match(/href="([^"]*)"/);
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
    if (!hrefMatch) continue;
    const url = extractDdgUrl(hrefMatch[1]);
    if (!url) continue;
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
    sources.push({ url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippet ? { snippet: stripTags(snippet) } : {}) });
  }
  return { sources: uniqueSources(sources, maxResults ?? 10), truncated: false };
}
```

snippet 与 link **按下标配对**（`snippetMatches[i]`）。失败语义同 DDG（共用 `fetchHtmlWithRetry`，错误文案里写死 "DuckDuckGo"，Bing 命中时文案会是同一个字符串）。

### 1.3 bing — Bing Web

| 项 | 规格 |
|---|---|
| 请求 | `GET https://www.bing.com/search?<URLSearchParams>` |
| 参数 | `q`=query；`mkt`=market；`adlt`=`off`\|`moderate`\|`strict`（**off 也会显式加 `adlt=off`**） |
| 头 | `user-agent: USER_AGENT`，`accept-language`= 见下（**Bing 是唯一覆盖 accept-language 的引擎**） |
| 重定向 | follow，12s，重试 3 次 |
| Key | 不需要 |
| 时间过滤 | **不支持**（`bing` 不在 `timeEngines`，带 timeRange 时被跳过并产生 Note） |

market / accept-language 联动（`index.js:25-47`、`333-346`）：

```js
const LANG_PROFILES = {                       // lang 设置 → Bing 档案
  zh: { market: "zh-CN", acceptLang: "zh-CN,zh;q=0.9,en;q=0.8" },
  en: { market: "en-US", acceptLang: "en-US,en;q=0.9" },
  ru: { market: "ru-RU", acceptLang: "ru-RU,ru;q=0.9,en;q=0.8" },
  ja: { market: "ja-JP", acceptLang: "ja-JP,ja;q=0.9,en;q=0.8" },
  de: { market: "de-DE", acceptLang: "de-DE,de;q=0.9,en;q=0.8" },
  fr: { market: "fr-FR", acceptLang: "fr-FR,fr;q=0.9,en;q=0.8" },
  es: { market: "es-ES", acceptLang: "es-ES,es;q=0.9,en;q=0.8" },
  ko: { market: "ko-KR", acceptLang: "ko-KR,ko;q=0.9,en;q=0.8" },
};
const MARKET_TO_LANG = {                      // bingMarket 显式设置 → 反推 accept-language
  "zh-CN": "zh-CN,zh;q=0.9,en;q=0.8", "zh-TW": "zh-TW,zh;q=0.9,en;q=0.8",
  "en-US": "en-US,en;q=0.9",          "en-GB": "en-GB,en;q=0.9",
  "ru-RU": "ru-RU,ru;q=0.9,en;q=0.8", "ja-JP": "ja-JP,ja;q=0.9,en;q=0.8",
  "de-DE": "de-DE,de;q=0.9,en;q=0.8", "fr-FR": "fr-FR,fr;q=0.9,en;q=0.8",
  "es-ES": "es-ES,es;q=0.9,en;q=0.8", "ko-KR": "ko-KR,ko;q=0.9,en;q=0.8",
};

const profile    = LANG_PROFILES[options?.lang] ?? LANG_PROFILES.zh;
const market     = options?.bingMarket ?? profile.market;      // 显式 bingMarket 优先
const params     = new URLSearchParams({ q: query, mkt: market });
const acceptLang = options?.bingMarket
  ? (MARKET_TO_LANG[market] ?? ACCEPT_LANG)                    // 显式 market 时反推
  : (profile.acceptLang ?? ACCEPT_LANG);
```

注意：默认 `bingMarket` 是 `"zh-CN"`，所以**默认路径总是走 `MARKET_TO_LANG` 反推**（`LANG_PROFILES` 分支只在 `bingMarket` 为空字符串/undefined 时生效）。

解析（HTML 正则）：

```js
const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
for (const block of blocks) {
  const hrefMatch    = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
  const titleMatch   = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
  const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  if (!hrefMatch) continue;
  sources.push({ url: hrefMatch[1],
    ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
    ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {}) });
}
return { sources: uniqueSources(sources, maxResults ?? 10), truncated: false };
```

失败语义：同 `fetchHtmlWithRetry`（反爬正则命中时文案仍然是 "DuckDuckGo is rate-limited..."）；0 条算失败。

### 1.4 searxng — 元搜索（多实例自动故障转移）

| 项 | 规格 |
|---|---|
| 请求 | `GET ${base}/search?q=<query>&format=json[&time_range=...]`，逐个实例串行尝试 |
| 头 | `user-agent: USER_AGENT`，`accept: application/json` |
| 超时 | **每实例 8s**（比自己另建 AbortController，不与外层共享 12s 常量） |
| Key | 不需要 |
| 时间过滤 | `time_range` = `SEARXNG_TIME[approximateTimeRange(days ?? 7)]` → `day`\|`week`\|`month`\|`year`，**近似固定档** |

默认实例列表（`index.js:364-371`）：

```js
const SEARXNG_INSTANCES = [
  "https://opnxng.com",
  "https://priv.au",
  "https://searx.be",
  "https://searx.tiekoetter.com",
  "https://search.inetol.net",
  "https://paulgo.io",
];
```

```js
async function searchSearxng(query, maxResults, options, signal) {   // index.js:373-426
  const instances = options?.searxngInstances?.length ? options.searxngInstances : SEARXNG_INSTANCES;
  const errors = [];
  for (const base of instances) {
    try {
      const params = new URLSearchParams({ q: query, format: "json" });
      if (options?.timeRange) {
        const tr = SEARXNG_TIME[approximateTimeRange(options.timeRange.days ?? 7)];
        if (tr) params.set("time_range", tr);
      }
      /* fetch(`${base}/search?${params}`, { headers:{user-agent, accept:"application/json"}, signal: ctrl.signal }) 8s */
      if (!response.ok) { errors.push(`${base}: HTTP ${response.status}`); continue; }
      const data = await response.json().catch(() => null);
      if (!data || !Array.isArray(data.results)) { errors.push(`${base}: invalid JSON`); continue; }
      const sources = data.results.filter((r) => r.url).map((r) => ({
        url: r.url,
        ...(r.title ? { title: String(r.title) } : {}),
        ...(r.content ? { snippet: String(r.content) } : {}),
      }));
      if (sources.length > 0) return { sources: uniqueSources(sources, maxResults ?? 10), truncated: false };
      errors.push(`${base}: 0 results`);        // 单实例 0 条 → 继续下一个实例
    } catch (error) { errors.push(`${base}: ${error.message}`); }
  }
  const detail = errors.length > 0 ? errors.join(", ") : "no instances configured";
  throw new Error(`all SearXNG instances failed: ${detail.slice(0, 300)}`);   // 截断 300 字符
}
```

失败语义：`!response.ok` / JSON 无效 / 抛异常 / 该实例 0 条都只是"该实例失败"，继续下一个；**全部实例都无结果才抛错**，错误消息聚合所有实例原因并截断到 300 字符，兜底文案 `no instances configured`。

### 1.5 anysearch — AnySearch AI 搜索（keyless）

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.anysearch.com/v1/search`，`content-type: application/json` |
| Body | `{ query, max_results: maxResults ?? 5 }` |
| 头 | 只有 `content-type`（**无 UA、无 accept、无鉴权**） |
| 超时 | 12s |
| Key | 不需要 |
| 时间过滤 | **不支持**（不在 `timeEngines`） |

```js
// body
body: JSON.stringify({ query, max_results: maxResults ?? 5 })
// 响应
if (!response.ok) throw new Error(`AnySearch API error (HTTP ${response.status})`);
const data = await response.json();
if (data.code !== 0) throw new Error(`AnySearch API error: ${data.message ?? data.code}`);
const results = data.data?.results ?? [];
sources = results.filter((r) => r.url).map((r) => ({
  url: r.url,
  ...(r.title ? { title: String(r.title) } : {}),
  ...(r.snippet ? { snippet: String(r.snippet).slice(0, 300) } : {}),
}));
// 收尾：uniqueSources(sources, maxResults ?? 10) —— 注意这里没传 limit 到 map，limit 在 uniqueSources
```

JSON 路径：`data.code`（必须 `=== 0`）→ `data.data.results[]`，字段 `url` / `title` / `snippet`。

### 1.6 exa — 双路径（REST 有 key / MCP keyless）

**路径 A：REST（有 key）**

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.exa.ai/search`，`redirect: "error"` |
| Body | `{ query, type: "auto", contents: { highlights: { highlightsPerUrl: 1 } }, numResults?, startPublishedDate? }` |
| 头 | `authorization: Bearer ${apiKey}`、`content-type: application/json`、`accept: application/json`、`user-agent: deepseek-harness/free-search` |
| 超时 | 无自建超时，用调用方传入的 signal |
| Key | `EXA_API_KEY`（无 key 时走路径 B） |
| 时间过滤 | `startPublishedDate`：`timeRange.after` 原样，或 `isoDaysAgo(timeRange.days)`（**精确**，支持任意天数与绝对日期） |

```js
const body = { query, type: "auto", contents: { highlights: { highlightsPerUrl: 1 } },
  ...(maxResults !== undefined ? { numResults: maxResults } : {}) };
if (timeRange) {
  if (timeRange.after) body.startPublishedDate = timeRange.after;
  else if (timeRange.days !== undefined) body.startPublishedDate = isoDaysAgo(timeRange.days);
}
```

错误语义（`index.js:789-798`）：401 → `Exa API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Search`；402 → 长文案（"quota/billing error ... dashboard.exa.ai"+ detail.slice(0,200)）；其它 → `Exa API error (HTTP ${status}): ${detail.slice(0,200)}`。函数开头 `if (!apiKey) throw new Error("Exa search requires EXA_API_KEY")`。

解析：`data.results[]` → `snippet = result.highlights?.find(h => h.trim().length > 0)`；**没有 highlight 的条目被丢弃**（`return null` 后 `.filter(Boolean)`）；`publishedDate` → `publishedAt`。

**路径 B：MCP keyless**

| 项 | 规格 |
|---|---|
| 请求 | `POST https://mcp.exa.ai/mcp` |
| 头 | `content-type: application/json`、`accept: application/json, text/event-stream` |
| Body (JSON-RPC) | `{ jsonrpc:"2.0", id: Date.now(), method:"tools/call", params:{ name:"web_search_exa", arguments:{ query, numResults: maxResults ?? 5 } } }` |
| 超时 | 20s |
| 时间过滤 | **不支持**（MCP 路径完全不接受 timeRange；但 exa 在 timeEngines 里，只有"有 key"时才真正生效） |

解析（SSE 优先，`index.js:497-535`）：按行找 `data: ` 前缀并 `JSON.parse(line.slice(6))`；`json.error` 非空 → 抛错。取 `json.result.content` 中 `type === "text"` 的块 join 成文本，再按标题块解析：

```js
const blocks = textBlocks.split(/\n(?=Title:)/);
for (const block of blocks) {
  const title     = block.match(/^Title: (.+)$/m)?.[1];
  const url       = block.match(/^URL: (\S+)$/m)?.[1];
  const published = block.match(/^Published: (.+)$/m)?.[1];
  const highlights = block.split(/^Highlights:$/m)[1]?.split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("...")).slice(0, 3).join(" ");
  if (!url) continue;
  sources.push({ url, ...(title ? { title } : {}),
    ...(highlights ? { snippet: highlights.slice(0, 300) } : {}),
    ...(published && /^\d{4}-\d{2}-\d{2}/.test(published) ? { publishedAt: published } : {}) });
}
// 注意：这条路径不做 uniqueSources
return { sources, truncated: false };
```

### 1.7 tavily — 双档（keyless 头 / Bearer）

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.tavily.com/search`，`redirect: "error"` |
| Body | `{ query, max_results: Math.min(maxResults ?? 5, 20), search_depth: "basic", time_range? }` |
| 头 | `content-type: application/json`、`accept: application/json`，加 **二者之一**：有 key → `authorization: Bearer ${apiKey}`；无 key → `x-tavily-access-mode: keyless` |
| 超时 | 15s |
| Key | `TAVILY_API_KEY`，**可选**（无 key 走 keyless） |
| 时间过滤 | `time_range` = `approximateTimeRange(days ?? 7)` → `day`\|`week`\|`month`\|`year`（**近似固定档**） |

```js
headers: {
  "content-type": "application/json",
  accept: "application/json",
  ...(apiKey ? { authorization: `Bearer ${apiKey}` } : { "x-tavily-access-mode": "keyless" }),
}
```

错误语义：401 → `Tavily API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Search`；其它 → `Tavily API error (HTTP ${status}): ${detail.slice(0,200)}`。
解析：`data.results[]` → `url` / `title`(String) / `content`→`snippet`，snippet `.slice(0, 300)`。

### 1.8 keenable — 双路径（REST 有 key / MCP keyless）

**路径 A：REST（有 key）**

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.keenable.ai/v1/search` |
| Body | `{ query, mode: "realtime", published_after? }` |
| 头 | `x-api-key: ${apiKey}`、`content-type: application/json`、`accept: application/json` |
| 超时 | 20s |
| 时间过滤 | `published_after`：`timeRange.after` 原样，或 `formatKeenableRelative(days)`（**精确**） |

```js
function formatKeenableRelative(days) {   // index.js:1081-1087
  if (days <= 0.5) return "12h";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}
```

错误语义：401 → `Keenable API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Search`；其它 → `Keenable API error (HTTP ${status}): ...`。
解析：`data.results[]` → `url` / `title` / `snippet = r.snippet ?? r.description`（300 截断）/ `published_at`→`publishedAt`。

**路径 B：MCP keyless**

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.keenable.ai/mcp` |
| 头 | `content-type: application/json`、`accept: application/json, text/event-stream` |
| Body | `{ jsonrpc:"2.0", id: Date.now(), method:"tools/call", params:{ name:"search_web_pages", arguments:{ query, published_after? } } }` |
| 超时 | 25s |
| 时间过滤 | 同 REST 的 `published_after`（相对或绝对） |

解析：**`response.json()` 直读（不解析 SSE）** → `data.error` → 抛 `Keenable MCP error: ...`；`result.isError === true` → 抛 `Keenable MCP error: ${text.slice(0,200)}`；否则把 `result.content` 中 text 块 join 成文本，交给：

```js
function extractKeenableSources(text, maxResults) {   // index.js:1090-1108
  const blocks = String(text).split(/\n(?=Title:)/);
  for (const block of blocks) {
    const title     = block.match(/^Title: (.+)$/m)?.[1];
    const url       = block.match(/^URL: (\S+)$/m)?.[1];
    const published = block.match(/^Published: (.+)$/m)?.[1] ?? block.match(/^Acquired: (.+)$/m)?.[1];
    const snippets  = block.split(/^Snippets:$/m)[1]?.split("\n").filter((l) => l.trim()).slice(0, 3).join(" ");
    if (!url) continue;
    sources.push({ url, ...(title ? { title } : {}),
      ...(snippets ? { snippet: snippets.slice(0, 300) } : {}),
      ...(published && /^\d{4}-\d{2}-\d{2}/.test(published) ? { publishedAt: published } : {}) });
  }
  return uniqueSources(sources, maxResults ?? 10);
}
```

分派：`searchKeenable = (…apiKey…) => apiKey ? searchKeenableREST(…) : searchKeenableMCP(…)`。

### 1.9 firecrawl

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.firecrawl.dev/v2/search`，`redirect: "error"` |
| Body | `{ query, limit: Math.min(Math.max(maxResults ?? 5, 1), 10), tbs? }` |
| 头 | `content-type: application/json`、`accept: application/json`，有 key 时再加 `authorization: Bearer ${apiKey}`（**无 key 时不加任何鉴权头，即 keyless**） |
| 超时 | 20s |
| Key | `FIRECRAWL_API_KEY`，可选 |
| 时间过滤 | `tbs`：固定档 `FIRECRAWL_TBS[approximateTimeRange(days)]`；绝对日期 `cdr:1,cd_min:M/D/YYYY`（**近似固定档 + 精确区间**） |

```js
const FIRECRAWL_TBS = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };

function formatFirecrawlDate(date) {                 // "2026-07-01" → "7/1/2026"
  const [y, m, d] = String(date).split("-").map((n) => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

if (timeRange) {
  if (timeRange.after) body.tbs = `cdr:1,cd_min:${formatFirecrawlDate(timeRange.after)}`;
  else if (timeRange.days !== undefined) {
    const tr = approximateTimeRange(timeRange.days);
    if (FIRECRAWL_TBS[tr]) body.tbs = FIRECRAWL_TBS[tr];
  }
}
```

错误语义：401 → `Firecrawl API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Search`；**429 → `Firecrawl rate limit exceeded (HTTP 429) - configure FIRECRAWL_API_KEY for higher limits`**；其它 → `Firecrawl API error (HTTP ${status}): ...`。
解析：`data.data.web[]` → `url` / `title` / `description`→`snippet`(300)。

### 1.10 parallel — 双路径（REST 有 key / MCP keyless）

**路径 A：REST（有 key）**

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.parallel.ai/v1/search`，`redirect: "error"` |
| Body | `{ objective: query, search_queries: [query], mode: "fast", advanced_settings: { max_results: Math.min(Math.max(maxResults ?? 5, 1), 20), source_policy?: { after_date } } }` |
| 头 | `x-api-key: ${apiKey}`、`content-type: application/json`、`accept: application/json` |
| 超时 | 25s |
| Key | `PARALLEL_API_KEY`（**必填**：`if (!apiKey) throw new Error("Parallel search requires PARALLEL_API_KEY")`；无 key 时链路上层改走 MCP） |
| 时间过滤 | `advanced_settings.source_policy.after_date`（`YYYY-MM-DD`，**精确**） |

```js
if (timeRange) {
  const after = timeRange.after ?? (timeRange.days !== undefined ? isoDaysAgo(timeRange.days).slice(0, 10) : undefined);
  if (after) body.advanced_settings.source_policy = { after_date: after };
}
```

错误语义：401/403 → `Parallel API key is invalid (HTTP ${status}) - update it in Settings > Plugins > Free Search`；402 → `Parallel quota/billing error (HTTP 402) - check usage/credits at platform.parallel.ai. ...`；其它 → `Parallel API error (HTTP ${status}): ...`。
解析：`data.results[]` → `excerpt = (r.excerpts ?? []).find(e => String(e).trim().length > 0)` → `snippet`(300)；`publish_date` → `publishedAt`。

**路径 B：MCP keyless**

```js
// 模块级常量：32 位随机 hex session id，进程内固定
const PARALLEL_MCP_SESSION = (() => {
  let id = "";
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
})();
```

| 项 | 规格 |
|---|---|
| 请求 | `POST https://search.parallel.ai/mcp` |
| 头 | `content-type: application/json`、`accept: application/json, text/event-stream` |
| Body | `{ jsonrpc:"2.0", id: Date.now(), method:"tools/call", params:{ name:"web_search", arguments:{ objective, search_queries:[query], session_id: PARALLEL_MCP_SESSION } } }` |
| 超时 | 25s |
| 时间过滤 | **无日期参数**：软过滤，写进 objective |

```js
const after = timeRange
  ? timeRange.after ?? (timeRange.days !== undefined ? isoDaysAgo(timeRange.days).slice(0, 10) : undefined)
  : undefined;
const objective = after ? `${query} (prefer results published after ${after})` : query;
```

解析（JSON 与 SSE 双兼容，`index.js:1041-1078`）：先 `JSON.parse(text)`，失败再按 `data: ` 行解析；`json.error` → 抛错；`result.isError` → `Parallel MCP error: ${blocks.join(" ").slice(0,200) || "tool call failed"}`；把 text 块逐个 `JSON.parse` 取第一个成功的作为 `payload`，读 `payload.results[]`（字段同 REST：`url`/`title`/`excerpts`/`publish_date`）。

### 1.11 perplexity

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.perplexity.ai/chat/completions`，`redirect: "error"` |
| Body | `{ model: "sonar", max_tokens: 1024, messages: [{ role: "user", content: query }] }` |
| 头 | `authorization: Bearer ${apiKey}`、`content-type: application/json`、`accept: application/json`（**无 UA**） |
| 超时 | `AbortSignal.any([signal?, AbortSignal.timeout(20000)])`（20s 内置） |
| Key | `PERPLEXITY_API_KEY`（**必需**；链里无 key 直接 `continue` 跳过，不发起请求） |
| 时间过滤 | **不支持**（不在 `timeEngines`） |

```js
if (!apiKey) throw new Error("Perplexity search requires PERPLEXITY_API_KEY");
...
if (response.status === 401) throw new Error("Perplexity API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Search");
throw new Error(`Perplexity API error (HTTP ${response.status}): ${detail.slice(0, 200)}`);
```

解析（**唯一返回 `content` 的引擎**）：

```js
const answer    = data.choices?.[0]?.message?.content ?? "";
const citations = data.citations ?? [];
const sources   = citations.map((url) => ({ url, ...(answer ? { snippet: answer.slice(0, 200) } : {}) }));
return { content: answer, sources: uniqueSources(sources, maxResults ?? 10), truncated: false };
```

即 `choices[0].message.content` → `content` 且同时作为每条 citation 的 `snippet`（200 截断）；`citations[]` 是 URL 字符串数组。

### 1.12 serpbase — Google organic

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.serpbase.dev/google/search`，`redirect: "error"` |
| Body | `{ q: query, hl: locale.hl, gl: locale.gl, page: 1 }` |
| 头 | `X-API-Key: ${apiKey}`、`content-type: application/json`、`accept: application/json`、`user-agent: deepseek-harness/free-search` |
| 超时 | 15s |
| Key | `SERPBASE_API_KEY`（**必需**；链里无 key 直接跳过） |
| 时间过滤 | **不支持**（不在 `timeEngines`） |

`hl`/`gl` 跟随设置 `lang`（`index.js:1300-1314`）：

```js
const SERPBASE_LOCALE = {
  zh: { hl: "zh-CN", gl: "cn" }, en: { hl: "en", gl: "us" }, ru: { hl: "ru", gl: "ru" },
  ja: { hl: "ja", gl: "jp" },    de: { hl: "de", gl: "de" }, fr: { hl: "fr", gl: "fr" },
  es: { hl: "es", gl: "es" },    ko: { hl: "ko", gl: "kr" },
};
const locale = SERPBASE_LOCALE[options?.lang] ?? SERPBASE_LOCALE.en;   // 默认 en/us
```

错误语义（**key 的关键差异：始终 HTTP 200，业务状态在 body**）：

```js
if (!response.ok) throw new Error(`SerpBase API error (HTTP ${response.status}): ${detail.slice(0,200)}`);
const data = await response.json();
if (data.status !== 0) {
  if (data.status === 1001) {
    throw new Error("SerpBase API key is invalid or missing (status 1001) - update it in Settings > Plugins > Free Search");
  }
  throw new Error(`SerpBase API error (status ${data.status}): ${String(data.error ?? "").slice(0,200)}`);
}
```

状态码约定：`0`=成功，`1001`=key 无效/缺失，`1000`=请求非法。
解析：`data.organic[]` → `url = r.link`、`title`、`snippet`、`publishedAt = r.published_at ?? r.date`。

### 1.13 deepseek-official

| 项 | 规格 |
|---|---|
| 请求 | `POST https://api.deepseek.com/anthropic/v1/messages`（Anthropic Messages 兼容协议） |
| Body | `{ model: "deepseek-v4-flash", max_tokens: 4096, messages: [{ role:"user", content:[{ type:"text", text:`Perform a web search for the query: ${query}` }] }], tools: [{ type:"web_search_20250305", name:"web_search", max_uses: 1 }] }` |
| 头 | `x-api-key: ${apiKey}`、`authorization: Bearer ${apiKey}`（**两个都发**）、`anthropic-version: 2023-06-01`、`content-type`、`accept: application/json`、`user-agent: deepseek-harness/free-search` |
| 超时 | `AbortSignal.any([signal?, AbortSignal.timeout(20000)])` |
| Key | `DEEPSEEK_API_KEY`（**必需**；无 key 链中跳过） |
| 时间过滤 | **不支持** |

错误语义：401 → `DeepSeek API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Search`；其它 → `DeepSeek API error (HTTP ${status}): ...`。

解析（两趟，`index.js:1271-1294`）：

```js
const blocks = data.content ?? [];
const resultBlocks = blocks.filter((b) => b.type === "web_search_tool_result");
const snippets = new Map();
for (const block of blocks) {
  if (block.type !== "text") continue;
  for (const cite of block.citations ?? []) {
    if (cite.url && cite.cited_text && !snippets.has(cite.url)) snippets.set(cite.url, cite.cited_text);
  }
}
const sources = [];
for (const block of resultBlocks) {
  for (const item of block.content ?? []) {
    if (item.type !== "web_search_result" || !item.url) continue;
    if (sources.some((s) => s.url === item.url)) continue;
    sources.push({ url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(snippets.get(item.url) ? { snippet: snippets.get(item.url) } : {}),
      ...(item.page_age ? { publishedAt: item.page_age } : {}) });
  }
}
return { sources: uniqueSources(sources, maxResults ?? 10), truncated: false };
```

引用文本取自 text 块上的 `citations[].cited_text`（按 url 首次出现），结果条目取自 `web_search_tool_result` 块的 `content[].type === "web_search_result"`；`page_age` → `publishedAt`。

### 1.14 引擎 key 解析优先级（所有付费引擎共用）

映射表（`index.js:1731-1740`，同时是凭据中心白名单）：

```js
const KEY_REF_MAP = {
  exaApiKey: "EXA_API_KEY",            tavilyApiKey: "TAVILY_API_KEY",
  keenableApiKey: "KEENABLE_API_KEY",  firecrawlApiKey: "FIRECRAWL_API_KEY",
  parallelApiKey: "PARALLEL_API_KEY",  perplexityApiKey: "PERPLEXITY_API_KEY",
  serpbaseApiKey: "SERPBASE_API_KEY",  deepseekApiKey: "DEEPSEEK_API_KEY",
};
```

```js
// 优先级：credentials 凭据中心（.credentials.yaml）> settings 的 free-search.<x>ApiKey > 环境变量
const resolveApiKey = async (envName, settingsKey) => {
  const credentials = getCredentials();
  if (credentials) {
    try { const resolved = await credentials.resolve(envName); if (resolved?.value) return resolved.value; } catch {}
  }
  const cfg = current();
  if (settingsKey && cfg[settingsKey]) return cfg[settingsKey];
  return process.env[envName] ?? "";
};
```

注意：`resolveApiKey` **不读 `keyStorage`**；`keyStorage` 只影响设置页把新 key 写到哪（凭据中心 vs settings.yaml）。

### 1.15 引擎 → 支持时间过滤 一览

| 引擎 | 时间参数 | 精确度 |
|---|---|---|
| ddg | `df=d/w/m/y` | 近似固定档（`approximateTimeRange`） |
| ddg-lite | `df=d/w/m/y` | 近似固定档 |
| bing | — | 不支持 |
| searxng | `time_range=day/week/month/year` | 近似固定档 |
| anysearch | — | 不支持 |
| exa | REST: `startPublishedDate`（ISO）；MCP: — | 精确（有 key）/ 不支持（keyless MCP） |
| tavily | `time_range=day/week/month/year` | 近似固定档 |
| keenable | `published_after`（`12h`/`Nd`/`Nmo`/`Ny` 或 `YYYY-MM-DD`） | 精确 |
| firecrawl | `tbs=qdr:d/w/m/y` 或 `cdr:1,cd_min:M/D/YYYY` | 近似固定档 / 绝对日期精确 |
| parallel | REST: `advanced_settings.source_policy.after_date`；MCP: objective 软提示 | 精确（有 key）/ 软过滤（keyless） |
| perplexity | — | 不支持 |
| serpbase | — | 不支持 |
| deepseek-official | — | 不支持 |

---

## 2. 默认值与 settings 全量键

### 2.1 Schemastery Config（`index.js:1742-1761`，原样）

```js
const Config = z.object({
  provider: z.string().default("bing"),
  cache: z.boolean().default(true),          // 单 query 结果缓存开关
  cacheTtl: z.number().default(5),           // 分钟，0-5 可配置（使用处再 clamp）
  keyStorage: z.string().default("credentials"),   // credentials | settings
  lang: z.string().default("zh"),
  region: z.string(),                        // 无 default → undefined
  bingMarket: z.string().default("zh-CN"),
  safeSearch: z.string().default("off"),
  searxngInstances: z.array(z.string()),     // 无 default → undefined
  platforms: z.array(z.string()).default(["github", "v2ex", "bilibili", "reddit", "hn", "stackoverflow", "wikipedia", "npm"]),
  exaApiKey: z.string().role("secret"),
  tavilyApiKey: z.string().role("secret"),
  keenableApiKey: z.string().role("secret"),
  firecrawlApiKey: z.string().role("secret"),
  parallelApiKey: z.string().role("secret"),
  perplexityApiKey: z.string().role("secret"),
  serpbaseApiKey: z.string().role("secret"),
  deepseekApiKey: z.string().role("secret"),
});
```

命名空间：`const FREE_SEARCH_NS = "free-search";` → settings.yaml 下完整键名是 `free-search.<key>`：

| settings.yaml 键 | 类型 | 默认值 | 作用点 |
|---|---|---|---|
| `free-search.provider` | string | `"bing"` | 回退链首选引擎（`request.engine` 显式指定时被覆盖） |
| `free-search.cache` | boolean | `true` | 单 query 结果缓存总开关；`false` 完全禁用 |
| `free-search.cacheTtl` | number | `5` | 缓存分钟数，**使用处 clamp 到 0-5**；`<=0` 视为禁用 |
| `free-search.keyStorage` | string | `"credentials"` | 仅 UI 写入分流：`credentials`（默认，走 `/credentials-set`）或 `settings`（写 settings.yaml） |
| `free-search.lang` | string | `"zh"` | UI 语言；**同时驱动** Bing `LANG_PROFILES` 与 SerpBase `hl/gl`、Wikipedia 语言 |
| `free-search.region` | string | *undefined* | DDG HTML 的 `kl` 参数（README 示例 `cn-zh`；**DDG-Lite 不读**） |
| `free-search.bingMarket` | string | `"zh-CN"` | Bing `mkt` + 反推 `accept-language`；可选值 `zh-CN zh-TW en-US en-GB ru-RU ja-JP de-DE fr-FR es-ES ko-KR` |
| `free-search.safeSearch` | string | `"off"` | `off`\|`moderate`\|`strict`；**只作用于 bing / ddg / ddg-lite** |
| `free-search.searxngInstances` | string[] | *undefined* → 用内置 6 个实例 | SearXNG 实例列表（自定义则完全替换内置列表） |
| `free-search.platforms` | string[] | 8 平台全开 | `platform_search` 工具的平台白名单（**唯一的 enabled 开关**） |
| `free-search.exaApiKey` | secret string | *undefined* | Exa REST |
| `free-search.tavilyApiKey` | secret string | *undefined* | Tavily 账号档 |
| `free-search.keenableApiKey` | secret string | *undefined* | Keenable REST |
| `free-search.firecrawlApiKey` | secret string | *undefined* | Firecrawl 账号档 |
| `free-search.parallelApiKey` | secret string | *undefined* | Parallel REST |
| `free-search.perplexityApiKey` | secret string | *undefined* | Perplexity（必需） |
| `free-search.serpbaseApiKey` | secret string | *undefined* | SerpBase（必需） |
| `free-search.deepseekApiKey` | secret string | *undefined* | DeepSeek 官方（必需） |

**没有** 任何 per-engine `enabled` 布尔开关；引擎是否"启用"只由 `provider`（首选）+ key 是否存在 + `timeEngines` 决定。

### 2.2 safeSearch → 各引擎取值的精确映射

| safeSearch 值 | bing `adlt` | ddg / ddg-lite `adlt` |
|---|---|---|
| `off`（默认） | 显式 `adlt=off` | 显式 `adlt=-1` |
| `moderate` | 显式 `adlt=moderate` | 显式 `adlt=0` |
| `strict` | 显式 `adlt=strict` | 显式 `adlt=1` |
| 其它/空 | 走 `?? "off"` 分支 | 走 `?? "off"` 分支 |

实现对照：

```js
// bing
const adlt = options?.safeSearch ?? "off";
if (adlt === "off") params.set("adlt", "off");
else if (adlt === "moderate") params.set("adlt", "moderate");
else if (adlt === "strict") params.set("adlt", "strict");
// ddg / ddg-lite
const adlt = options?.safeSearch ?? "off";
params.set("adlt", adlt === "strict" ? "1" : adlt === "moderate" ? "0" : "-1");
```

设置页文案键（client.js）：`safeSearchLabel` / `safeSearchOff` / `safeSearchModerate` / `safeSearchStrict` / `safeSearchHint`；`bingMarketLabel` / `bingMarketHint` / `marketZhCN|marketZhTW|marketEnUS|marketEnGB|marketRuRU|marketJaJP|marketDeDE|marketFrFR|marketEsES|marketKoKR`。

### 2.3 缓存规格

```js
const CACHE_MAX_ENTRIES = 50;                        // index.js:171
const searchCache = new Map();                       // provider.search 闭包持有：key -> { value, expiresAt }

function buildCacheKey(query, maxResults, timeRangeLabel, preferred) {   // index.js:175-177
  return [query ?? "", maxResults ?? 5, timeRangeLabel ?? "", preferred].join("\u0000");
}

const cacheTtlMs  = (Math.min(Math.max(Number(cfg.cacheTtl) ?? 5, 0), 5)) * 60 * 1000;   // clamp 0..5 分钟
const cacheEnabled = cfg.cache !== false && cacheTtlMs > 0;
const cacheKey = cacheEnabled ? buildCacheKey(request.query, request.maxResults, timeRangeLabel, preferred) : null;
```

- 命中：`if (signal?.aborted) throw new Error("search aborted")`；`delete` 后 `set` 实现 LRU 提升；返回 `{ ...hit.value, sources: hit.value.sources?.slice(), _cache: "hit" }`（sources 浅拷贝隔离）。
- 过期：`if (hit && hit.expiresAt > Date.now())` 不满足则 `searchCache.delete(cacheKey)`。
- 写入（仅成功路径）：`const cached = { ...result, provider: engine, engine: engine };`
- **fallback 条目 TTL 缩短**：`const entryTtlMs = engine !== preferred ? Math.max(cacheTtlMs / 5, 1000) : cacheTtlMs;`（默认 5 分钟 → 回退条目 60s，首选条目 5 分钟）。
- 淘汰：`if (searchCache.size > CACHE_MAX_ENTRIES)` 删 `searchCache.keys().next().value`（最旧）。
- 失败不缓存（`throw` 路径）。
- `timeRangeLabel`：`typeof request.timeRange === "string" ? request.timeRange : String(timeRange?.days ?? timeRange?.after ?? "")`。

### 2.4 引擎测试工具的固定参数

`runEngineTest(engine, query, timeRange)`（`index.js:2051-2127`）：默认 query `"DeepSeek Harness"`，**每个引擎固定 `maxResults = 2`**；付费引擎无 key 时返回 `{ ok: false, error: "<ENV> not configured" }`（`PERPLEXITY_API_KEY not configured` / `DEEPSEEK_API_KEY not configured` / `SERPBASE_API_KEY not configured`），未知引擎返回 `{ ok:false, error:`unknown engine: ${engine}` }`；免费引擎返回 0 条时**等 1500ms 重试一次**；成功时对 snippet 做 `cleanSnippet`。

---

## 3. 统一回退链的确切算法

### 3.1 首选引擎判定（`index.js:1804-1808`）

```js
// 首选引擎：free_search 工具显式指定（request.engine）优先于设置（cfg.provider）
const preferred =
  typeof request.engine === "string" && ALL_ENGINES.includes(request.engine)
    ? request.engine
    : cfg.provider ?? "bing";
```

### 3.2 链构造（`index.js:1832-1857`，逐字）

```js
// 统一引擎链：首选优先，然后其他付费引擎（有 key 的优先尝试），最后免费引擎
const paidEngines = ["exa", "tavily", "keenable", "firecrawl", "parallel", "perplexity", "serpbase", "deepseek-official"];
const freeEngines = ["bing", "anysearch", "ddg", "ddg-lite", "searxng"];
// 支持 time_range 过滤的引擎：tavily / exa / keenable / firecrawl / parallel / searxng / ddg / ddg-lite
const timeEngines = ["tavily", "exa", "keenable", "firecrawl", "parallel", "searxng", "ddg", "ddg-lite"];
let chain;
let preferredSkippedReason = null;
if (timeRange) {
  // 有时间过滤需求时，把支持过滤的引擎排前面（首选引擎若支持仍优先）
  const preferredFirst = [preferred].filter((e) => timeEngines.includes(e));
  const otherTime = timeEngines.filter((e) => e !== preferred);
  const noTime = [...paidEngines, ...freeEngines].filter((e) => !timeEngines.includes(e) && e !== preferred);
  chain = [...preferredFirst, ...otherTime, ...noTime];
  if (!timeEngines.includes(preferred)) {
    // 首选引擎不支持时间过滤 → 它不在链里，不会被尝试（这不等于失败）
    preferredSkippedReason = "time-filter";
  }
} else {
  const othersPaid = paidEngines.filter((e) => e !== preferred);
  const othersFree = freeEngines.filter((e) => e !== preferred);
  chain = [preferred, ...othersPaid, ...othersFree];
}
```

**无 timeRange 时的完整链（以默认 `provider: bing` 为例）**：

```
bing, exa, tavily, keenable, firecrawl, parallel, perplexity, serpbase, deepseek-official,
anysearch, ddg, ddg-lite, searxng
```

**有 timeRange 时的完整链（以 `provider: bing` 为例，bing 不支持时间过滤）**：

```
tavily, exa, keenable, firecrawl, parallel, searxng, ddg, ddg-lite,
perplexity, serpbase, deepseek-official, anysearch
```

推导：`preferredFirst = []`（bing ∉ timeEngines）；`otherTime = timeEngines.filter(e => e !== "bing")` = 全部 8 个时间引擎；`noTime = [...paidEngines, ...freeEngines].filter(e => !timeEngines.includes(e) && e !== "bing")` = `perplexity, serpbase, deepseek-official`（来自 paidEngines）+ `anysearch`（来自 freeEngines）。**bing 完全不在链里**（这正是 `preferredSkippedReason = "time-filter"` 的来源）。

若首选是支持时间过滤的引擎（例如 `provider: exa`）：`chain = exa, tavily, keenable, firecrawl, parallel, searxng, ddg, ddg-lite, perplexity, serpbase, deepseek-official, bing, anysearch`（exa 提到最前，且 `preferredSkippedReason` 保持 `null`）。

### 3.3 串行执行、总预算与信号（`index.js:1859-1987`）

```js
let lastError = null, usedEngine = null, preferredFailure = null;
const BUDGET_MS = 30000;                       // 整条链总超时 30s
const deadline = Date.now() + BUDGET_MS;
for (const engine of chain) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`search timed out after ${BUDGET_MS / 1000}s`);
  const effSignal = AbortSignal.any([...(signal !== undefined ? [signal] : []), AbortSignal.timeout(remaining)]);
  try {
    /* 每个 engine 一个 if/else 分支：见 3.4 分派表 */
    if (result.sources.length > 0) {
      usedEngine = engine;
      result.sources = result.sources.map((s) => s.snippet ? { ...s, snippet: cleanSnippet(s.snippet) } : s);
      if (engine !== preferred) {
        if (preferredSkippedReason === "time-filter") {
          result.content = `Note: ${preferred} does not support time filtering (timeRange=${timeRangeLabel}), using ${engine}.`;
        } else if (preferredFailure) {
          result.content = `Note: ${preferred} unavailable or failed (${preferredFailure}), using ${engine}.`;
        } else {
          result.content = `Note: ${preferred} unavailable or failed, using ${engine}.`;
        }
      }
      const cached = { ...result, provider: engine, engine: engine };
      if (cacheKey !== null) { /* 见 §2.3 */ }
      return { ...cached, _cache: "miss" };
    }
    lastError = new Error(`engine "${engine}" returned 0 results`);
    if (engine === preferred) preferredFailure = "returned 0 results";
    logger.warn(`free-search: ${engine} returned 0 results, trying next engine`);
  } catch (error) {
    lastError = error;
    const message = error instanceof Error ? error.message : String(error);
    if (engine === preferred) preferredFailure = message;
    logger.warn(`free-search: engine "${engine}" failed (${message}), trying next engine`);
  }
}
throw lastError ?? new Error("all search engines failed");
```

出口校验（`index.js:1800-1802`）：`request.query` 非空字符串且 `trim().length > 0`，否则 `throw new Error("query is required")`；失败时返回最后一条错误（`all search engines failed` 兜底）。

### 3.4 每个 engine 的调用分派（`index.js:1874-1943`）

| engine | 调用（无 key / 有 key 分支） |
|---|---|
| ddg | `searchDdgHtml(query, maxResults, { ...cfg, timeRange }, effSignal)` |
| ddg-lite | `searchDdgLite(query, maxResults, { ...cfg, timeRange }, effSignal)` |
| bing | `searchBing(query, maxResults, cfg, effSignal)`（**不传 timeRange**） |
| searxng | `searchSearxng(query, maxResults, { ...cfg, timeRange }, effSignal)` |
| anysearch | `searchAnysearch(query, maxResults, effSignal)` |
| exa | 有 `EXA_API_KEY` → `searchExa(..., timeRange, ...)`；否则 `searchExaMCP(query, maxResults, effSignal)` |
| tavily | 总是 `searchTavily(query, maxResults, key, timeRange, effSignal)`（key 可为空串 → keyless 头） |
| keenable | `searchKeenable(query, maxResults, key, timeRange, effSignal)` → 内部分派 REST/MCP |
| firecrawl | 总是 `searchFirecrawl(query, maxResults, key, timeRange, effSignal)` |
| parallel | 有 key → `searchParallel(..., timeRange, ...)`；否则 `searchParallelMCP(query, maxResults, timeRange, effSignal)` |
| perplexity | 无 key：`lastError = new Error("Perplexity requires PERPLEXITY_API_KEY")`，若为首选则 `preferredFailure = "PERPLEXITY_API_KEY is not configured"`，`logger.warn`，`continue`（**不发请求**） |
| deepseek-official | 无 key：同上，`"DeepSeek requires DEEPSEEK_API_KEY"` / `"DEEPSEEK_API_KEY is not configured"` |
| serpbase | 无 key：同上，`"SerpBase requires SERPBASE_API_KEY"` / `"SERPBASE_API_KEY is not configured"` |
| 其它 | `continue` |

注意：`perplexity`/`deepseek-official`/`serpbase` 的"无 key"走的是 `continue`（**绕过 catch**），因此对它们 `preferredFailure` 由显式赋值给出；`exa`/`parallel` 无 key 时**不发请求也不报错**，直接改走 MCP keyless 路径（`searchExa` 内部的 `if (!apiKey) throw` 在该分支下不会被触发）。

### 3.5 `Note:` 两种文案的精确判据

| 判据 | 变量状态 | 文案 |
|---|---|---|
| 带 timeRange 且首选不在 `timeEngines` | `preferredSkippedReason = "time-filter"`（首选**从未被尝试**） | `Note: ${preferred} does not support time filtering (timeRange=${timeRangeLabel}), using ${engine}.` |
| 首选被尝试后失败（`lastError` 或 throw 或 0 条；或无 key 跳过） | `preferredFailure` 为具体原因字符串 | `Note: ${preferred} unavailable or failed (${preferredFailure}), using ${engine}.` |
| 首选未记录失败但实际由别的引擎服务 | `preferredFailure === null` | `Note: ${preferred} unavailable or failed, using ${engine}.` |

优先序：`time-filter` 分支**先判**，所以带 timeRange 且首选不支持时永远是第一种文案（即便该首选引擎在链尾被尝试并失败也不会出现——它根本不在链里）。`preferredFailure` 的取值为：`"returned 0 results"`、各引擎 catch 到的错误消息（含 `HTTP 401` 文案）、或 `"<ENV>_API_KEY is not configured"`。

### 3.6 "0 results" 是否算失败

**算失败。** 判据是 `result.sources.length > 0` 才接受：

```js
lastError = new Error(`engine "${engine}" returned 0 results`);
if (engine === preferred) preferredFailure = "returned 0 results";
```

即：空数组 → 继续下一个引擎；若全部引擎都 0 条，抛出最后一条 `engine "..." returned 0 results`。`searxng` 内部还把"单实例 0 条"当作该实例失败继续换实例（见 §1.4）。

### 3.7 引擎注册与 web.searchProvider 接管（`index.js:2039-2048`）

```js
ctx.web.registerSearchProvider(provider);   // provider = { id: "ddg", available() { return true; }, search(request, signal) {...} }

// 若上层 patch 把 searchProvider 抹掉（undefined），自动接管
if (!ctx.web.searchProviderId) {
  ctx.web.searchProviderId = provider.id;
  logger.info(`free-search: web.searchProvider was unset (patch override or missing config), taking over as "${provider.id}"`);
}
```

`cordis.patch.yml` 里注册的是：`id: web-search-free, name: dsh-free-search, config: { provider: bing, bingMarket: zh-CN }`，以及 `id: web` 的 `config: { searchProvider: ddg, fetchProvider: http }`（注释警告：patch 语义是整行替换 config，必须保留 `fetchProvider`）。

---

## 4. 额外工具规格

三个工具都用 `ctx.inject(["tools"], (sctx) => sctx.effect(() => { const dispose = sctx.tools.register(defineTool({...})); return () => dispose(); }, "free-search: ..."))` 注册。

### 4.1 `advanced_search`

参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `query` | string | 是 | — | 空/空白 → `throw new Error("query is required")` |
| `maxResults` | number | 否 | 5 | 工具内 `Math.min(args.maxResults ?? 5, 10)` |
| `timeRange` | string | 否 | — | 仅当 `parseTimeRange(args.timeRange) !== undefined` 才写入 request |
| `engine` | string | 否 | — | 仅当 `ALL_ENGINES.includes(args.engine)` 才写入 request；**不走直测，仍走回退链** |

```js
async execute(args) {
  if (!args.query || !String(args.query).trim()) throw new Error("query is required");
  const request = { query: args.query, maxResults: Math.min(args.maxResults ?? 5, 10) };
  if (parseTimeRange(args.timeRange) !== undefined) request.timeRange = args.timeRange;
  if (args.engine && ALL_ENGINES.includes(args.engine)) request.engine = args.engine;
  const result = await provider.search(request);
  return {
    provider: result.provider ?? result._provider ?? "bing",
    content: typeof result.content === "string" ? result.content : "",
    sources: (result.sources ?? []).map((s) => {     // 逐字段判空后才写，剔除 undefined/"" 
      const source = {};
      if (s.url !== undefined && s.url !== null && s.url !== "") source.url = s.url;
      if (s.title !== undefined && s.title !== null && s.title !== "") source.title = String(s.title);
      if (s.snippet !== undefined && s.snippet !== null && s.snippet !== "") source.snippet = String(s.snippet);
      if (s.publishedAt !== undefined && s.publishedAt !== null && s.publishedAt !== "") source.publishedAt = String(s.publishedAt);
      return source;
    }),
  };
}
```

输出 schema：`{ provider: string, content: string, sources: [{ url, title, snippet, publishedAt }] }`，`additionalProperties: false`，字段全部可选但**不出现 undefined**。

render（返回 ContentBlock[]，不是字符串）：

```js
render(args, value) {
  const lines = value.sources.map((s, i) => `- [${s.title ?? s.url}](${s.url})${s.snippet ? ` - ${s.snippet.slice(0, 120)}` : ""}${s.publishedAt ? ` (${s.publishedAt})` : ""}`);
  return [{ type: "text", text: `Search (${value.provider}${args.timeRange ? `, timeRange=${args.timeRange}` : ""}):\n${lines.join("\n") || "No results found."}${value.content ? `\n\n${value.content}` : ""}` }];
}
```

> 契约注释强调：`render` 必须直接返回 `ContentBlock[]`（`[{type:"text",text}]`），因为 `finalizeContent` 在 `tools/post-execute` 之后才执行，只返回裸字符串会让下游消费者崩溃。`finalizeContent(exec, result)` 只做幂等兜底：`result.content` 是非空字符串则包成 block 数组，否则 `undefined`。

### 4.2 `platform_search`

参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `platform` | string（枚举） | 是 | — | `github` \| `v2ex` \| `bilibili` \| `reddit` \| `hn` \| `stackoverflow` \| `wikipedia` \| `npm` |
| `query` | string | 是 | — | — |
| `maxResults` | number | 否 | 5 | `Math.min(args.maxResults ?? 5, 10)` |

错误处理（两处显式 throw）：

```js
if (!PLATFORMS[platform]) {
  throw new Error(`unknown platform "${platform}" - use one of: ${Object.keys(PLATFORMS).join(", ")}`);
}
const enabled = current().platforms ?? ["github","v2ex","bilibili","reddit","hn","stackoverflow","wikipedia","npm"];
if (!enabled.includes(platform)) {
  throw new Error(`platform "${platform}" is disabled in Free Search settings - enable it in Settings > Plugins > Free Search to use it`);
}
const limit = Math.min(args.maxResults ?? 5, 10);
const result = await searchPlatform(platform, args.query, limit, undefined, current().lang);   // signal = undefined
```

平台名映射（`index.js:539-548`）：`{ github:{name:"GitHub"}, v2ex:{name:"V2EX"}, bilibili:{name:"Bilibili"}, reddit:{name:"Reddit"}, hn:{name:"Hacker News"}, stackoverflow:{name:"Stack Overflow"}, wikipedia:{name:"Wikipedia"}, npm:{name:"npm"} }`。

返回值：`{ platform, sources: [{url?, title?, snippet?}] }`（逐字段判空后写入，`additionalProperties: false`）。
render：`` `Platform search (${value.platform}):\n` + lines.join("\n") || "No results found." ``，每行 `` `- [${s.title ?? s.url}](${s.url})${s.snippet ? ` - ${s.snippet.slice(0,120)}` : ""}` ``。

### 4.3 `free_search_test`

参数：

| 字段 | 类型 | 必填 | 默认 |
|---|---|---|---|
| `engines` | string[] | 否 | 空/未传 → `ALL_ENGINES`（全部 13 个） |
| `query` | string | 否 | `"DeepSeek Harness"`（`runEngineTest` 内 `const q = query || "DeepSeek Harness"`） |

执行：**串行** `for (const engine of engines) { const r = await runEngineTest(engine, args.query); ... }`（不传 timeRange）。

```js
async execute(args) {
  const engines = args.engines && args.engines.length > 0 ? args.engines : ALL_ENGINES;
  const results = [];
  for (const engine of engines) {
    const r = await runEngineTest(engine, args.query);
    if (r.ok) {
      const item = { engine, status: "ok", results: r.sources.length };
      if (r.sources[0]?.title) item.sampleTitle = String(r.sources[0].title);
      if (r.sources[0]?.url) item.sampleUrl = String(r.sources[0].url);
      results.push(item);
    } else {
      results.push({ engine, status: "fail", error: r.error ?? "unknown error" });
    }
  }
  return { results };
}
```

输出 schema：`{ results: [{ engine: string, status: string, results: number, error: string, sampleTitle: string, sampleUrl: string }] }`。
render：

```js
render(args, value) {
  const lines = value.results.map((r) => {
    if (r.status === "ok") return `- ${r.engine}: OK (${r.results} results${r.sampleTitle ? `, e.g. "${r.sampleTitle.slice(0, 40)}"` : ""})`;
    return `- ${r.engine}: FAIL - ${r.error}`;
  });
  return [{ type: "text", text: `Search engine test:\n${lines.join("\n")}` }];
}
```

`runEngineTest` 的错误兜底：`catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }`；成功时返回 `{ ok: true, sources, truncated }`。设置页的"测试引擎"按钮走的是**另一条路**——`/api/dsh-free-search-settings/raw-search` 带 `engine` 字段（直测该引擎，不走回退链）。

---

## 5. platform_search 的 8 个平台实现

统一：全部使用全局 `fetch`，`signal` 由 `...(...(signal !== undefined ? { signal } : {}))` 条件展开（`platform_search` 工具传 `undefined`，即无 signal）；失败一律 `throw new Error(\`<X> API error (HTTP ${response.status})\`)`。

### 5.1 github — GitHub Repositories

```js
const response = await fetch(
  `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${maxResults ?? 5}`,
  { headers: { "user-agent": USER_AGENT, accept: "application/vnd.github+json" }, ...(signal !== undefined ? { signal } : {}) }
);
if (!response.ok) throw new Error(`GitHub API error (HTTP ${response.status})`);
const data = await response.json();
sources = (data.items ?? []).map((item) => ({
  url: item.html_url,
  title: item.full_name ?? item.name,
  snippet: `${item.description ?? ""}${item.stargazers_count ? ` ⭐${item.stargazers_count}` : ""}`.trim(),
}));
```

无 key、无 OAuth。解析路径 `data.items[]`。

### 5.2 v2ex — 热门主题 + 客户端过滤

```js
const response = await fetch("https://www.v2ex.com/api/topics/hot.json", { headers: { "user-agent": USER_AGENT }, ...});
if (!response.ok) throw new Error(`V2EX API error (HTTP ${response.status})`);
const topics = await response.json();
const q = query.toLowerCase();
const matched = Array.isArray(topics)
  ? topics.filter((t) => (t.title ?? "").toLowerCase().includes(q) || (t.content ?? "").toLowerCase().includes(q))
  : [];
sources = matched.slice(0, maxResults ?? 5).map((t) => ({
  url: `https://www.v2ex.com/t/${t.id}`,
  title: t.title,
  ...(t.content ? { snippet: String(t.content).slice(0, 200) } : {}),
}));
```

**特殊处理**：V2EX 没有公开搜索 API，只能拉热门列表后在本地做大小写不敏感子串匹配（title 或 content），可能返回 0 条。

### 5.3 bilibili — 综合搜索

```js
const response = await fetch(
  `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(query)}`,
  { headers: { "user-agent": USER_AGENT, referer: "https://www.bilibili.com" }, ...}
);
if (!response.ok) throw new Error(`Bilibili API error (HTTP ${response.status})`);
const data = await response.json();
if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message ?? data.code}`);   // 业务状态码
const sources = [];
for (const section of data.data?.result ?? []) {
  for (const item of section.data ?? []) {
    if (!item.arcurl) continue;                       // 无 arcurl（如直播/番剧分区）跳过
    sources.push({
      url: item.arcurl,
      title: item.title ? String(item.title).replace(/<[^>]+>/g, "") : item.bvid,   // 标题含 <em class="keyword">
      ...(item.desc ? { snippet: String(item.desc).slice(0, 200) } : {}),
    });
    if (sources.length >= (maxResults ?? 5)) break;
  }
  if (sources.length >= (maxResults ?? 5)) break;
}
```

**特殊处理**：需要 `referer: https://www.bilibili.com`；`data.code !== 0` 是业务失败；标题必须剥 HTML 标签。

### 5.4 reddit — old.reddit 搜索

```js
const response = await fetch(
  `https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${maxResults ?? 5}&sort=relevance`,
  { headers: { "user-agent": `${USER_AGENT} (dsh-free-search; contact: github.com/DDDMUC)`, accept: "application/json" }, ...}
);
if (!response.ok) throw new Error(`Reddit API error (HTTP ${response.status})`);
const data = await response.json();
sources = (data.data?.children ?? [])
  .map((c) => c.data)
  .filter((p) => p && p.url)                       // 无 url 的条目丢弃
  .map((p) => ({ url: p.url, title: p.title ?? "", ...(p.selftext ? { snippet: String(p.selftext).slice(0, 200) } : {}) }));
```

**特殊处理**：UA 追加 `(dsh-free-search; contact: github.com/DDDMUC)`（Reddit 要求可识别 UA）；解析路径 `data.data.children[].data`。

### 5.5 hn — Hacker News（Algolia）

```js
const response = await fetch(
  `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${maxResults ?? 5}`,
  { headers: { "user-agent": USER_AGENT, accept: "application/json" }, ...}
);
if (!response.ok) throw new Error(`Hacker News API error (HTTP ${response.status})`);
const data = await response.json();
sources = (data.hits ?? [])
  .filter((h) => h.title || h.story_title)
  .map((h) => ({
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,   // 有外链用外链，纯讨论帖用 HN 页
    title: h.title ?? h.story_title,
    ...((h.points !== undefined && h.points !== null) || (h.num_comments !== undefined && h.num_comments !== null)
      ? { snippet: `HN discussion · ${h.points ?? 0} points · ${h.num_comments ?? 0} comments` } : {}),
  }));
```

**特殊处理**：snippet 是合成字符串（不是原文摘要）；URL 优先 `h.url`，否则用 `objectID` 拼 HN 讨论页。

### 5.6 stackoverflow — Stack Exchange API 2.3

```js
const response = await fetch(
  `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${maxResults ?? 5}&filter=!nNPvSNVZJS`,
  { headers: { "user-agent": USER_AGENT, accept: "application/json" }, ...}
);
if (!response.ok) throw new Error(`Stack Exchange API error (HTTP ${response.status})`);
const data = await response.json();
if (data.error_message) throw new Error(`Stack Exchange API error: ${data.error_message}`);   // 业务错误
sources = (data.items ?? []).map((it) => ({
  url: it.link,
  title: it.title,
  ...(it.score !== undefined || it.answer_count !== undefined
    ? { snippet: `${it.is_answered ? "✓ answered" : "unanswered"} · score ${it.score ?? 0} · ${it.answer_count ?? 0} answers` } : {}),
}));
```

**特殊处理**：固定 `filter=!nNPvSNVZJS`（自定义 filter，让响应带 `is_answered`/`score`/`answer_count`）；snippet 是合成字符串。

### 5.7 wikipedia — MediaWiki action API（语言切换）

```js
const host = lang === "en" ? "en.wikipedia.org" : "zh.wikipedia.org";   // 只有 en 与 zh 两档
const response = await fetch(
  `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults ?? 5}`,
  { headers: { "user-agent": USER_AGENT, accept: "application/json" }, ...}
);
if (!response.ok) throw new Error(`Wikipedia API error (HTTP ${response.status})`);
const data = await response.json();
sources = (data.query?.search ?? []).map((s) => ({
  url: `https://${host}/wiki/${encodeURIComponent(String(s.title).replace(/ /g, "_"))}`,
  title: s.title,
  ...(s.snippet ? { snippet: stripTags(s.snippet).slice(0, 200) } : {}),   // 含 <span class="searchmatch"> 高亮标签
}));
```

**特殊处理**：语言由设置的 `lang` 决定（`lang === "en"` → en，其它一律 zh）；URL 用 `encodeURIComponent(title.replace(/ /g,"_"))` 手工拼接；snippet 必须剥 `<span class="searchmatch">` 标签。

### 5.8 npm — registry 搜索

```js
const response = await fetch(
  `https://registry.npmjs.com/-/v1/search?text=${encodeURIComponent(query)}&size=${maxResults ?? 5}`,
  { headers: { "user-agent": USER_AGENT, accept: "application/json" }, ...}
);
if (!response.ok) throw new Error(`npm registry API error (HTTP ${response.status})`);
const data = await response.json();
sources = (data.objects ?? [])
  .map((o) => o.package)
  .filter((p) => p && p.name)
  .map((p) => ({
    url: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
    title: p.name,
    ...((p.description || p.version) ? { snippet: `v${p.version ?? "?"}${p.description ? ` — ${String(p.description).slice(0, 160)}` : ""}` } : {}),
  }));
```

**特殊处理**：解析路径 `data.objects[].package`；URL 优先 `links.npm`；snippet 是合成的 `vX.Y.Z — description`（description 截 160）。

### 5.9 分派器

```js
async function searchPlatform(platform, query, maxResults, signal, lang) {
  switch (platform) {
    case "github":        return searchGithub(query, maxResults, signal);
    case "v2ex":          return searchV2ex(query, maxResults, signal);
    case "bilibili":      return searchBilibili(query, maxResults, signal);
    case "reddit":        return searchReddit(query, maxResults, signal);
    case "hn":            return searchHackerNews(query, maxResults, signal);
    case "stackoverflow": return searchStackOverflow(query, maxResults, signal);
    case "wikipedia":     return searchWikipedia(query, maxResults, signal, lang);
    case "npm":           return searchNpm(query, maxResults, signal);
    default:              throw new Error(`unknown platform: ${platform}`);
  }
}
```

平台引擎**不参与**回退链，也**不经过** snippet 清洗；无 key、无缓存。

---

## 6. 系统提示词注入

注册方式（`index.js:2394-2447`）：

```js
ctx.inject(["systemPrompt"], (sctx) => {
  let disposeSection = null;
  refreshPrompt = () => {
    if (disposeSection) { disposeSection(); disposeSection = null; }
    disposeSection = sctx.systemPrompt.section({
      name: "free-search:engines",
      order: 500,
      text: [ /* 见下 */ ].join("\n"),
    });
  };
  sctx.effect(() => {
    refreshPrompt();
    return () => { if (disposeSection) disposeSection(); disposeSection = null; };
  }, "free-search: engine list prompt section");
});
```

- **section name**：`"free-search:engines"`；**order**：`500`。
- **刷新时机**：① `ctx.inject(["systemPrompt"])` 的 effect 首次执行时；② settings 注册回调的 `onChange: () => { if (typeof refreshPrompt === "function") refreshPrompt(); }`（即任何设置变更 → 先 dispose 旧 section 再注册新的）。
- 文本是**动态拼接**的：其中 `current().provider`（默认 `"bing"`）、`current().safeSearch`（默认 `"off"`）、`current().bingMarket`（默认 `"zh-CN"`）三处随设置变化。

完整文本（逐行，含动态插值位置）：

```
## Available web search engines (free-search plugin)

You have the web_search tool. Its backend engine is chosen in Settings > Plugins > Free Search.
Current engine: <current().provider ?? "bing">
Safe search filter (Settings > Plugins > Free Search): <current().safeSearch ?? "off"> (off|moderate|strict). Engine default off; applies to bing/ddg/ddg-lite.
Bing market: <current().bingMarket ?? "zh-CN"> (mkt + Accept-Language; e.g. ru-RU returns Russian results for Cyrillic queries).

Available engines and their requirements:
- ddg (DuckDuckGo HTML) - FREE, no key (may be rate-limited)
- ddg-lite (DuckDuckGo Lite) - FREE, no key (may be rate-limited)
- bing (Bing) - FREE, no key (most stable)
- searxng (meta-search, multi-instance) - FREE, no key
- anysearch (AI search) - FREE, no key
- exa - FREE keyless (MCP) or EXA_API_KEY for higher limits
- tavily - FREE keyless or TAVILY_API_KEY for higher limits
- keenable - FREE keyless (MCP) or KEENABLE_API_KEY for higher limits
- firecrawl - FREE keyless or FIRECRAWL_API_KEY for higher limits
- parallel - FREE keyless (MCP) or PARALLEL_API_KEY for higher limits
- perplexity - requires PERPLEXITY_API_KEY
- deepseek-official - requires DEEPSEEK_API_KEY
- serpbase - Google organic results via API, requires SERPBASE_API_KEY (100 free queries on signup)

IMPORTANT: If the configured engine fails (missing key, invalid key, 401, rate limit, or network error), web_search automatically tries other engines in this order: (1) the configured engine first, (2) then other engines with API keys configured (exa/tavily/keenable/firecrawl/parallel work keyless too, so they are tried even without a key), (3) then the remaining free engines (Bing, AnySearch, DuckDuckGo, SearXNG). This applies to ALL engines - paid or free. The results include a note showing which engine was actually used and why the preferred one was skipped. Understand the two note forms: (a) 'Note: X does not support time filtering (timeRange=...), using Y.' means X cannot filter by time so it was skipped BEFORE any attempt (X did NOT fail); (b) 'Note: X unavailable or failed (reason), using Y.' means X was actually tried but failed (missing key / invalid key / 401 / rate limit / network / 0 results). Never tell the user search is unavailable - it always falls back.

Use the free_search_test tool to test which engines actually work right now.

When the user wants results from a specific time window (e.g. 'last week', 'this month', 'last 3 days'), use the advanced_search tool with timeRange. Fixed tiers: day|week|month|year. Custom: 12h, 3d, 2mo, 1y, or an absolute date like 2026-07-01.

For platform-specific searches (GitHub repos, V2EX threads, Bilibili videos, Reddit posts, Hacker News discussions, Stack Overflow questions, Wikipedia articles, npm packages), use the platform_search tool with platform: github|v2ex|bilibili|reddit|hn|stackoverflow|wikipedia|npm.

The user can switch the search engine themselves by typing /free-search-engine in the chat — it opens a picker to choose an engine, just like the settings page. This changes the preferred engine; search still falls back to other engines automatically if it fails. You should not switch engines on your own; let the user decide.
```

---

## 7. 端口 / 桥接（设置页 HTTP API）

### 7.1 注册方式

```js
const BRIDGE_PREFIX = "/api/dsh-free-search-settings";     // index.js:50

ctx.inject(["webServer", "settings"], (sctx) => {
  sctx.effect(() => {
    const disposers = makeBridgeRoutes(
      sctx.settings,
      (request) => provider.search(request, undefined),               // rawSearch 走完整回退链
      (engine, query, timeRange) => runEngineTest(engine, query, timeRange),   // 指定 engine 时直测
      getCredentials
    ).map((route) => sctx.webServer.register(route));
    return () => { for (const dispose of disposers) dispose(); };
  }, "free-search: settings bridge");
});
```

每个路由都是 `{ kind: "exact", path, handler: async (req, res) => {...} }`。**全部只接受 POST**。

### 7.2 通用守卫与响应（`index.js:1365-1409, 1626-1636`）

```js
const MAX_JSON_BODY_BYTES = 64 * 1024;   // 64KB 上限

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try { hostUrl = new URL("http://" + host); } catch { return false; }
  if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === hostUrl.host; } catch { return false; }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "referrer-policy": "no-referrer" });
  res.end(payload);
}

async function readJsonBody(req) {        // 超 64KB 或 JSON 解析失败 → undefined
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return undefined; }
}
```

守卫拒绝：非 loopback → `403 { error: "loopback requests only" }`；非 POST → `405 { error: "method not allowed: <METHOD>" }`；body 非法 → `400 { ok:false, code:"<x>-rejected", message:"malformed JSON body" }`。

### 7.3 端点清单（8 个）

| 方法 | 路径 | 请求 body | 成功响应 |
|---|---|---|---|
| POST | `/api/dsh-free-search-settings/describe` | `{}`（忽略） | `{ ok:true, value:{ namespaces:[View], writable:boolean } }` |
| POST | `/api/dsh-free-search-settings/mutate` | `{ ns, ops, expectedRevision? }` | `{ ok:true, value: View }` |
| POST | `/api/dsh-free-search-settings/credentials-status` | `{}` | `{ ok:true, value:{ configured:{ [settingsKey]:boolean }, available:true } }` |
| POST | `/api/dsh-free-search-settings/credentials-set` | `{ key, value }` | `{ ok:true, value:{ ref, set:true } }` |
| POST | `/api/dsh-free-search-settings/credentials-unset` | `{ key }` | `{ ok:true, value:{ ref, set:false } }` |
| POST | `/api/dsh-free-search-settings/check-update` | `{}` | `{ ok:true, value:{ current, latest, hasUpdate, updateUrl, repoUrl, installable, installMode } }` |
| POST | `/api/dsh-free-search-settings/update` | `{}` | `{ ok:true, value:{ updated:true, latest, message, output } }` |
| POST | `/api/dsh-free-search-settings/raw-search` | `{ query, maxResults?, timeRange?, engine? }` | `{ ok:true, value:{ provider, sources, content, cache } }` |

`View` 形状（`toView`，`index.js:1411-1423`）：

```js
{ ns: string, schema, value, base?, user?, secrets?: [{ path: string[], set: boolean }], revision }
```

- `describe` 只暴露 `String(descriptor.ns) === "free-search"` 的命名空间，且用 `settings.describe({ redactSecrets: true })` 脱敏；`writable: settings.writable !== false`。
- `mutate`：请求体校验 `{ ns: string, ops: array }`，否则 `{ ok:false, code:"settings-rejected", message:"malformed bridge settings request" }`；`ns` 不在白名单 → `code:"settings-not-exposed"`；`SettingsConflictError` → `code:"settings-conflict"`；其它异常 → `code:"internal"`；成功后返回新的 View，若命名空间在 mutate 后消失 → `code:"internal"`。
- `credentials-*`：使用 `KEY_REF_MAP` 白名单；未知 key → `{ ok:false, code:"credentials-rejected", message:'unknown credential key "<key>"' }`；`credentials-set` 要求 `value` 为非空字符串（会 `trim()`）；无凭据服务 → `code:"credentials-unavailable"`；写入异常 → `code:"credentials-write-failed"`。`credentials-status` 逐 key 调 `credentials.describe(ref)` 并取 `info.configured === true`（异常记 `false`）。
- `check-update`：`fetchLatestVersion()` 打 `https://registry.npmjs.org/dsh-free-search/latest`（10s 超时，`user-agent: deepseek-harness/free-search`，失败返回 `null`）；npm 不可达 → `{ ok:false, code:"update-check-failed", message:"could not reach the npm registry (network/proxy) - check your connection" }`；否则 `hasUpdate = compareVersions(latest, PLUGIN_VERSION) > 0`，`installable = mode !== null && !mode.isLink`，`installMode = mode?.isLink ? "link" : mode !== null ? "registry" : "unknown"`。`detectInstallMode()` 扫 `path.join(process.cwd(), "profiles")/*/node_modules/dsh-free-search` 并 `lstatSync().isSymbolicLink()`。
- `update`：link 模式 → `{ ok:false, code:"local-link-mode", message:"local development install (symlink) - update the source repo instead (git pull), then restart dsh" }`；找不到 → `code:"install-not-found"`；否则 `exec("pnpm add dsh-free-search@latest", { cwd: mode.profileDir, timeout: 120000 })`，失败 → `code:"upgrade-failed"`。
- `raw-search`（设置页"测试引擎"和 agent 手动测引擎都走它）：

```js
async rawSearch(request) {
  if (request === null || typeof request !== "object" || typeof request.query !== "string" || request.query.length === 0) {
    return { ok: false, code: "search-rejected", message: "malformed bridge search request (query is required)" };
  }
  const maxResults = Math.min(Math.max(Number(request.maxResults) || 5, 1), 10);
  const timeRange = parseTimeRange(request.timeRange);
  // 指定 engine：直测该引擎本身（不走回退链），报告它自己的可用性
  if (typeof request.engine === "string" && request.engine.length > 0) {
    if (typeof testEngine !== "function") return { ok:false, code:"search-unavailable", message:"engine test is not wired" };
    try {
      const result = await testEngine(request.engine, request.query, timeRange);
      if (result.ok === false) return { ok:false, code:"engine-failed", message: result.error ?? `${request.engine} failed` };
      return { ok:true, value:{ provider: request.engine, sources: result.sources ?? [], content: result.content ?? "" } };
    } catch (error) { return { ok:false, code:"engine-failed", message: String(error?.message ?? error) }; }
  }
  if (typeof search !== "function") return { ok:false, code:"search-unavailable", message:"search provider is not wired" };
  try {
    const result = await search({ ...request, maxResults, timeRange });
    return { ok:true, value:{
      provider: result.provider ?? request.engine ?? request.provider ?? "bing",
      sources: result.sources ?? [],
      content: result.content ?? "",
      cache: result._cache === "hit" ? "hit" : "miss",
    }};
  } catch (error) { return { ok:false, code:"search-failed", message: String(error?.message ?? error) }; }
}
```

### 7.4 前端调用约定（client.js）

```js
const BRIDGE_PREFIX = "/api/dsh-free-search-settings";
const NS = "free-search";

const bridgeDescribe = () => fetch(`${BRIDGE_PREFIX}/describe`, { method:"POST", headers:{"content-type":"application/json"}, body:"{}" }).then(r => r.json());
const bridgeMutate   = (payload) => fetch(`${BRIDGE_PREFIX}/mutate`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(payload) }).then(r => r.json());
const bridgeRawSearch= (payload) => fetch(`${BRIDGE_PREFIX}/raw-search`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(payload) }).then(r => r.json());
// 同理：check-update / credentials-status（body "{}"），credentials-set / credentials-unset（JSON body）
```

保存时构造的 ops（`client.js:463-476`）：

```js
const ops = [{ op: "set", path: ["provider"], value: provider }];
ops.push({ op: "set", path: ["lang"], value: lang });
ops.push({ op: "set", path: ["keyStorage"], value: keyStorage });
ops.push({ op: "set", path: ["safeSearch"], value: safeSearch });
ops.push({ op: "set", path: ["bingMarket"], value: bingMarket });
if (keyStorage !== "credentials") { for (const [field, value] of keyFields) if (value.trim()) ops.push({ op:"set", path:[field], value:value.trim() }); }
ops.push({ op: "set", path: ["platforms"], value: platforms });
ops.push({ op: "set", path: ["cacheTtl"], value: Math.min(Math.max(Number(cacheTtl) ?? 5, 0), 5) });
const result = await bridgeMutate({ ns: NS, ops });
```

`keyStorage === "credentials"` 时 key 走 `credentials-set`，逐个 `{ key: "<x>ApiKey", value: "<trimmed>" }`。

设置页测试引擎（`client.js:498-508`）：

```js
const result = await bridgeRawSearch({ query: "DeepSeek Harness", maxResults: 2, engine: provider });
```

设置页读取默认值时的**业务侧兜底**与 Config 默认不一致的两处（注意照抄取舍）：

| 字段 | Config 默认 | client.js 兜底 |
|---|---|---|
| `provider` | `"bing"` | `v.provider ?? "ddg"`（client.js:374） |
| `bingMarket` | `"zh-CN"` | `v.bingMarket === undefined ? "zh-CN" : v.bingMarket`（一致） |
| `cacheTtl` | `5` | `Math.min(Math.max(Number(v.cacheTtl) ?? 5, 0), 5)` |
| `platforms` | 8 平台 | 值为非空数组才用，否则 8 平台全开 |
| `keyStorage` | `"credentials"` | 非 `"settings"` 一律 `"credentials"` |
| `lang` | `"zh"` | 非 `"en"` 一律 `"zh"` |
| `safeSearch` | `"off"` | 非 `strict`/`moderate` 一律 `"off"` |

### 7.5 与设置系统对接（双 API 兼容，`index.js:1991-2023`）

```js
ctx.inject(["settings"], (sctx) => {
  if (typeof sctx.settings.installSection === "function") {
    sctx.settings.installSection(ctx, FREE_SEARCH_NS, Config, config ?? {}, {
      setSource: (source) => { current = source; },
      onChange: () => { if (typeof refreshPrompt === "function") refreshPrompt(); },
    });
  } else {
    void (async () => {
      const legacy = await import("@deepseek-ai/dsh-settings");
      if (typeof legacy.installSettingsSection === "function" && legacy.settingsNamespace) {
        const legacyNs = legacy.settingsNamespace(FREE_SEARCH_NS);
        legacy.installSettingsSection(ctx, legacyNs, Config, config ?? {}, {
          setSource: (source) => { current = source; },
          onChange: () => { if (typeof refreshPrompt === "function") refreshPrompt(); },
        });
      } else {
        sctx.logger?.warn?.("free-search: dsh-settings 无可用注册 API（installSection/installSettingsSection 均缺失）");
      }
    })();
  }
});
```

`current()` 即 `source()`（设置源）；`apply` 初始为 `() => config ?? {}`，安装后由 `setSource` 接管。

---

## 8. 引擎覆盖清单（本规格 §1 逐条覆盖）

| # | 引擎 id | keyless 变体 | 需 key | 时间过滤 |
|---|---|---|---|---|
| 1 | `ddg` | 本身即免费 | 否 | 近似（`df`） |
| 2 | `ddg-lite` | 本身即免费 | 否 | 近似（`df`） |
| 3 | `bing` | 本身即免费 | 否 | 不支持 |
| 4 | `searxng` | 多实例免费 | 否 | 近似（`time_range`） |
| 5 | `anysearch` | 本身即免费 | 否 | 不支持 |
| 6 | `exa` | `https://mcp.exa.ai/mcp` JSON-RPC `web_search_exa` | 否（key 提升额度） | 有 key 精确 |
| 7 | `tavily` | 同 URL + 头 `x-tavily-access-mode: keyless` | 否（key 提升额度） | 近似（`time_range`） |
| 8 | `keenable` | `https://api.keenable.ai/mcp` JSON-RPC `search_web_pages` | 否（key 提升额度） | 精确（`published_after`） |
| 9 | `firecrawl` | 同 URL，无鉴权头 | 否（key 提升额度） | 近似 + 绝对日期 |
| 10 | `parallel` | `https://search.parallel.ai/mcp` JSON-RPC `web_search` | 否（key 提升额度） | 有 key 精确 / keyless 软过滤 |
| 11 | `perplexity` | 无 | **是** | 不支持 |
| 12 | `serpbase` | 无 | **是** | 不支持 |
| 13 | `deepseek-official` | 无 | **是** | 不支持 |

—— 共 13 个引擎，另有 8 个 platform_search 平台与 3 个工具。

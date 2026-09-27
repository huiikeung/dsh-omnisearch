# dsh-omnisearch

**One plugin, the web capabilities of two.** Built on the multi-provider pool
architecture of [A3Boy/dsh-web-tools](https://github.com/A3Boy/dsh-web-tools),
merging the keyless engines and tools of
[DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search).

## What it fixes

1. **Works with zero API keys.** `bing / ddg / ddg-lite / anysearch / keenable (MCP)`
   need no credential at all, and `exa (MCP) / tavily (keyless) / firecrawl (keyless) /
   parallel (keyless)` fall back to their anonymous tiers when no key is configured.
   `anysearch` additionally accepts an OPTIONAL key for a higher quota: a rejected key
   is ignored for the process and the engine silently drops back to the anonymous tier.
2. **One failing engine never drops the search.** Default chain:
   `exa → tavily → firecrawl → keenable → bing → anysearch → ddg → ddg-lite → searxng → parallel → tinyfish → openalex → serpbase → brave → you → jina`;
   every failure fails over and the result carries a `Note:` naming the engine
   that actually served it and why the preferred one did not. `serpbase`
   (Google organic, key required) is simply skipped while unconfigured.
3. **One plugin, one seam.** The three upstream plugins each patch the same
   `web` config row — the last one wins, and a patch that omits `fetchProvider`
   leaves two fetch providers registered, so every fetch fails with
   `WEB_PROVIDER_AMBIGUOUS`. dsh-omnisearch always pins both.
4. **Web text is fenced as untrusted data.** The plugin's own tools wrap result
   text in `<untrusted-web-content>` and the injected system-prompt section tells
   the model never to follow instructions found inside it.

## Tools exposed to the model

- `web_search` / `web_fetch` — the native tools, executed through the chain
- `advanced_search` — explicit `timeRange` (`day|week|month|year`, `12h/3d/2mo/1y`, `2026-07-01`)
- `platform_search` — GitHub, V2EX, Bilibili, Reddit, Hacker News, Stack Overflow, Wikipedia, npm
- `free_search_test` — probe every engine and report what works right now

## Synced from dsh-free-search v0.4.33 → v0.4.39

The merge baseline was the upstream spec at **v0.4.32**; these later fixes are in as well:

| Upstream | Here |
|---|---|
| v0.4.33 prompt-injection guard | `<untrusted-web-content>` boundary around the three own-tool renders + a PROMPT-INJECTION SAFETY paragraph in the prompt section |
| v0.4.35 Bing unrelated cached SERP (#38) | query/result overlap check in the Bing adapter — a mismatch counts as 0 results so the chain moves on |
| v0.4.36/37 DSH 0.1.7 settings migration | `settings.register` (≤ 0.1.6) and the profile-entry `configure`/`update` model (0.1.7+, `.volatile()` fields + schema defaults) are both supported |
| v0.4.38 save-failure detail | the settings card and the provider dialog report the wire `code: message` instead of a bare "save failed" |
| v0.4.39 optional AnySearch key | the adapter sends `Bearer <key>` when configured, ignores a 401/403 key for the process and retries anonymously (cleared when a key is written) |
| spec §1.12 `serpbase` | implemented (Google organic, `DSH_OMNISEARCH_SERPBASE`; always HTTP 200 with the business status in the body) |
| `tinyfish` / `openalex` | ported from dsh-web-search-enhanced v0.1.4 (Yurzi, MIT): Tinyfish keyless via the public MCP channel (web/news only without a key), OpenAlex scholarly graph with polite-pool mailto; OpenAlex honours advanced_search date windows via `filter=from_publication_date` |

## Bilingual UI labels (中文 + English)

The "中文 + English" labels in the slash popup, tab strips and Plugins page come from the standalone **[dsh-bilingual-ui](../dsh-bilingual-ui)** plugin, which does not depend on this one — the bilingual display keeps working even if this plugin is disabled or replaced. See its README for coverage, glossary and boundaries.

This plugin only owns its own Settings-nav name: fixed to「网页搜索」 (`nav` in `src/client/i18n-dict.ts`, same value in both dictionaries — Chinese only, per request), with the globe glyph pinned at runtime by `src/client/nav-glyph.ts`.

## Install

```sh
pnpm install && pnpm run build
dsh plugin --profile web add link:/vol1/1000/Deepseek-Harness/工作台/插件/dsh-omnisearch
dsh plugin --profile web remove dsh-web-tools dsh-free-search @liustack/modsearch
dsh web   # restart
```

Full configuration reference (settings namespace `dsh-omnisearch`, credential prefix
`DSH_OMNISEARCH_*`) and the feature-by-feature merge matrix live in
[README.zh-CN.md](./README.zh-CN.md).

## License

MIT — the host code derives from A3Boy/dsh-web-tools (its LICENSE is kept
verbatim); see [CREDITS.md](./CREDITS.md).

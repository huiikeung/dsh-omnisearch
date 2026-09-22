# dsh-omnisearch

**One plugin, the web capabilities of two.** Built on the multi-provider pool
architecture of [A3Boy/dsh-web-tools](https://github.com/A3Boy/dsh-web-tools),
merging the keyless engines and tools of
[DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search).

## What it fixes

1. **Works with zero API keys.** `bing / ddg / ddg-lite / anysearch / keenable (MCP)`
   need no credential at all, and `exa (MCP) / tavily (keyless) / firecrawl (keyless)`
   fall back to their anonymous tiers when no key is configured.
2. **One failing engine never drops the search.** Default chain:
   `exa → tavily → firecrawl → keenable → bing → anysearch → ddg → ddg-lite → searxng → parallel → brave → you → jina`;
   every failure fails over and the result carries a `Note:` naming the engine
   that actually served it and why the preferred one did not.
3. **One plugin, one seam.** The three upstream plugins each patch the same
   `web` config row — the last one wins, and a patch that omits `fetchProvider`
   leaves two fetch providers registered, so every fetch fails with
   `WEB_PROVIDER_AMBIGUOUS`. dsh-omnisearch always pins both.

## Tools exposed to the model

- `web_search` / `web_fetch` — the native tools, executed through the chain
- `advanced_search` — explicit `timeRange` (`day|week|month|year`, `12h/3d/2mo/1y`, `2026-07-01`)
- `platform_search` — GitHub, V2EX, Bilibili, Reddit, Hacker News, Stack Overflow, Wikipedia, npm
- `free_search_test` — probe every engine and report what works right now

## Bilingual UI labels (中文 + English)

The "中文 + English" labels in the slash popup, tab strips and Plugins page come from the standalone **[dsh-bilingual-ui](../dsh-bilingual-ui)** plugin, which does not depend on this one — the bilingual display keeps working even if this plugin is disabled or replaced. See its README for coverage, glossary and boundaries.

This plugin only owns its own Settings-nav name: fixed to「网页搜索 Web Search」 (`nav` in `src/client/i18n-dict.ts`, same value in both dictionaries), with the globe glyph pinned at runtime by `src/client/nav-glyph.ts`.

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

/**
 * dsh-omnisearch — browser client plugin entry.
 *
 * Registers a top-level Settings page (`settings.section`, id `omnisearch`)
 * — the same slot contract the official Models / Plugins pages use — so the
 * plugin appears in the Settings nav as "Web Search / 网页搜索", not buried
 * under Plugins → Plugin configuration.
 *
 * The page talks to the Host exclusively through the plugin's fenced
 * `/omnisearch/api` HTTP routes (see ../host/routes.ts) — credentials never
 * reach the browser.
 *
 * Copy is registered through the DSH locale service (zh/en dictionaries
 * in ./i18n-dict.ts). The page follows the DSH UI language by default, and additionally
 * offers its own language selector (Follow system / 中文 / English) that is
 * persisted in the plugin's own config — it never changes the DSH-wide
 * language.
 * @module
 */
import { WebToolsSection } from "./WebToolsSection.js";
import { registerSettingsSection } from "./registration.js";
import { zhDict, enDict } from "./i18n-dict.js";
import { adoptWebToolsStyles } from "./ui/styles.js";
import { navGlyph, pinNavGlyph } from "./nav-glyph.js";
import * as React from "react";
export { zhDict, enDict };
/** Locale namespace for this page's copy. */
export const NS = "dsh-omnisearch";
/** Services required by this client plugin. */
export const inject = ["slots", "locale"];
/** Register the Settings page. */
class SectionErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error("[dsh-omnisearch] WebToolsSection render error", error, info);
    }
    render() {
        if (this.state.error !== null) {
            return React.createElement("div", { style: { padding: 12, color: "#e5484d", fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.5 } }, "[dsh-omnisearch] 页面渲染失败:\n" + (this.state.error.stack ?? String(this.state.error)));
        }
        return this.props.children;
    }
}
function SectionWithBoundary(props) {
    return React.createElement(SectionErrorBoundary, null, React.createElement(WebToolsSection, props));
}
export function apply(ctx) {
    adoptWebToolsStyles();
    // Settings-nav glyph. `settings.section` carries no icon field, so without
    // this the section renders the core's gear fallback. Pinned from here so it
    // survives DSH runtime updates and other plugins' patches — see nav-glyph.ts.
    // The `nav` label is the same string in both dictionaries, so one label
    // covers every DSH UI language.
    pinNavGlyph(["网页搜索 Web Search"], "data-omnisearch-nav-icon", navGlyph);
    // Bilingual ("中文 English") labels for plugin UI now live in the standalone
    // dsh-bilingual-ui plugin (../../dsh-bilingual-ui) so they survive this
    // plugin being disabled or replaced. Keep only this plugin's own glyph here.
    ctx.effect(() => ctx.locale.register(NS, {
        zh: zhDict,
        en: enDict,
    }));
    const t = ctx.locale.bind(NS);
    const ui = {
        getActiveLocale: () => ctx.locale.getLocale().active,
        subscribeLocale: (fn) => ctx.locale.subscribe(fn),
        zhDict,
        enDict,
    };
    registerSettingsSection(ctx, t, SectionWithBoundary, ui);
    // The per-session "联网搜索" toggle used to live here as a composer button
    // (`conversation.input.left`). It was removed on request: the search tools
    // are always callable regardless of the toggle, and the keyless engine chain
    // works out of the box, so a forced-search switch added chrome without value.
    // The capability itself is unchanged — `/search` still toggles the same
    // per-session Search Mode on the Host side (see search-mode-runtime.ts).
}

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
import { pinNavGlyph } from "./nav-glyph.js";
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
    // The label list includes the bilingual form the nav row is rewritten to.
    pinNavGlyph(["网页搜索", "Web Search", "网页搜索 Web Search"], "data-omnisearch-nav-icon", () => ({
        viewBox: "0 0 14 14",
        markup: '<path fill-rule="evenodd" clip-rule="evenodd" d="M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z" fill="currentColor"></path>',
    }));
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

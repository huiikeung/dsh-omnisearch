/**
 * dsh-omnisearch — prompt-injection boundary for web-sourced text
 * (merged from dsh-free-search v0.4.33).
 *
 * The plugin's OWN tools (`advanced_search` / `platform_search` /
 * `free_search_test`) render web text (result titles, snippets) straight into
 * the tool result the model reads. That text is attacker-controlled, so it is
 * wrapped in an explicit "untrusted data" boundary, matched by the
 * PROMPT-INJECTION SAFETY paragraph in the injected system-prompt section.
 *
 * Two deliberate non-goals, copied from upstream:
 *  - the native `web_search` / `web_fetch` tools are NOT wrapped: DSH core
 *    already ships its own EXTERNAL_WEB_CONTENT_NOTICE for them.
 *  - `source.snippet` itself is never tagged: the same string is rendered
 *    verbatim in the DSH result card, where boundary tags would show up as
 *    literal noise.
 *
 * @module
 */
/** Opening tag of the untrusted-data boundary. */
export const UNTRUSTED_BOUNDARY_OPEN = "<untrusted-web-content>";
/** Closing tag of the untrusted-data boundary. */
export const UNTRUSTED_BOUNDARY_CLOSE = "</untrusted-web-content>";
/** Forged boundary tags inside web text (case-insensitive). */
const UNTRUSTED_BOUNDARY_TAG = /<\/?untrusted-web-content>/gi;
/**
 * Strip boundary tags a page may have embedded itself, so it cannot close the
 * boundary early and have the rest of its text read as trusted instructions.
 */
export function stripBoundaryTags(text) {
    return typeof text === "string" ? text.replace(UNTRUSTED_BOUNDARY_TAG, "") : text;
}
/** Wrap web-sourced text in the untrusted-data boundary (tags stripped first). */
export function wrapUntrustedBlock(text) {
    return `${UNTRUSTED_BOUNDARY_OPEN}\n${stripBoundaryTags(text)}\n${UNTRUSTED_BOUNDARY_CLOSE}`;
}

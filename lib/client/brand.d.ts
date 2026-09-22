/**
 * dsh-omnisearch — Provider brand map (client-only, no Host dependency).
 *
 * Real provider SVG logos inlined as data URIs to avoid bundler plugin
 * dependencies for SVG file imports. Falls back to colored-letter placeholder
 * when a provider has no dedicated logo.
 * @module
 */
export interface BrandEntry {
    /** Data URI of the SVG icon (24×24). */
    icon: string;
    label: string;
}
/** Icons for the two browser-session platform rows (小红书 / X). */
export declare const BROWSER_PLATFORM_ICONS: Record<string, string>;
export interface PlatformBrandEntry {
    icon: string;
    label: string;
    domain: string;
}
export declare const PLATFORM_BRAND: Record<string, PlatformBrandEntry>;
export declare const PROVIDER_BRAND: Record<string, BrandEntry>;

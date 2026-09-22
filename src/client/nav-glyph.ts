/**
 * Pin this plugin's settings-nav glyph at runtime.
 *
 * The `settings.section` slot contract carries no icon field — the core reads
 * only id/label/order from the registration options, and its `navIcon(id)` is a
 * hard-coded map that falls back to the settings gear for every unknown id.
 * Market plugins therefore all render the gear.
 *
 * Patching that core bundle is not durable: a DSH runtime re-extract, or any
 * other plugin installing or removing its own patch, wipes it (observed on this
 * machine when dsh-search was replaced by dsh-omnisearch). So instead of
 * touching the core, find our own nav cell and rewrite its <svg> in place:
 *
 *  - the cell is located by its visible label text, which this plugin owns and
 *    localizes itself, so every shipped language is listed;
 *  - the shell's element, class and box are kept, so the shell's own styling and
 *    the hashed class names it generates keep working across DSH versions;
 *  - a MutationObserver re-applies the glyph whenever the shell re-renders the
 *    nav (ledger bump, locale change) and would otherwise restore the gear.
 *
 * @module
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** One nav-cell glyph: the shell's box is kept, only the geometry changes. */
export type GlyphSpec = { viewBox: string; markup: string };

/**
 * Pin `paint` onto the settings-nav cell whose label is one of `labels`.
 *
 * @param labels - every localized form of this section's nav label.
 * @param mark - attribute stamped on the rewritten <svg> to stay idempotent.
 * @param glyph - pure; returns the markup. It runs to completion BEFORE any DOM
 *   mutation, so a throwing glyph leaves the shell's own icon in place instead
 *   of blanking the nav cell.
 */
export function pinNavGlyph(labels: readonly string[], mark: string, glyph: () => GlyphSpec): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  const apply = () => {
    // Cheap guard: the nav only exists while the settings panel is open.
    if (document.querySelector('[role="dialog"]') === null) return;
    for (const cell of Array.from(document.querySelectorAll('[role="dialog"] nav button'))) {
      // An <svg> contributes no text, so this is exactly the nav label.
      if (labels.indexOf(cell.textContent?.trim() ?? "") < 0) continue;
      const svg = cell.querySelector("svg");
      if (svg === null || svg.getAttribute(mark) === "1") continue;
      let spec: GlyphSpec;
      try {
        spec = glyph();
      } catch (error) {
        console.warn("[dsh-omnisearch] nav glyph failed; keeping the shell icon", error);
        continue;
      }
      svg.setAttribute("viewBox", spec.viewBox);
      svg.setAttribute("fill", "none");
      svg.innerHTML = spec.markup;
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute(mark, "1");
    }
  };
  apply();
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}

export { SVG_NS };

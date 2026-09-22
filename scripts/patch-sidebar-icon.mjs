#!/usr/bin/env node
/**
 * dsh-omnisearch — pin the sidebar icon for this settings section.
 *
 * DSH renders pinned settings-section icons through a hard-coded id→icon map
 * (`navIcon(id)` in @deepseek-ai/dsh-client-ui-settings-general). The
 * settings.section slot contract carries no icon field, so the only way to get
 * a globe (联网搜索) icon instead of the gear fallback is a tiny core patch.
 *
 * Idempotent; writes a .dsh-omnisearch.bak next to the file on first patch.
 * Re-run after every DSH runtime update.
 *
 * Usage: node scripts/patch-sidebar-icon.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [
  process.env.DSH_RUNTIME && join(process.env.DSH_RUNTIME, "node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js"),
  // fnOS app layout on this machine
  "/vol1/@appdata/deepseek.harness/dsh-runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js",
  join(homedir(), ".dsh", "runtime", "node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js"),
].filter(Boolean);

const target = candidates.find((p) => existsSync(p));
if (!target) {
  console.error(`[dsh-omnisearch] settings-general client bundle not found; set DSH_RUNTIME and re-run.`);
  process.exit(1);
}

let s = readFileSync(target, "utf8");
if (s.includes('id === "omnisearch"')) {
  console.log("[dsh-omnisearch] sidebar icon patch already present:", target);
  process.exit(0);
}

const anchor = `\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline16, {
\t\t\t\tclassName: SettingsRoot_module_css_default.navIcon,
\t\t\t\tsize: 16
\t\t\t});
\t\t}`;
const inject = `\t\t\tif (id === "omnisearch") return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutline14, {
\t\t\t\tclassName: SettingsRoot_module_css_default.navIcon,
\t\t\t\tsize: 16
\t\t\t});
` + anchor;

if (!s.includes(anchor)) {
  console.error("[dsh-omnisearch] navIcon anchor not found (DSH bundle changed?); patch NOT applied.");
  process.exit(1);
}
if (!existsSync(target + ".dsh-omnisearch.bak")) copyFileSync(target, target + ".dsh-omnisearch.bak");
writeFileSync(target, s.replace(anchor, inject));
console.log("[dsh-omnisearch] sidebar icon patched: omnisearch → IconGlobeOutline14 in", target);

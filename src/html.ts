/**
 * Interactive HTML artifact (#13) — the rich-tier viewer.
 *
 * Wraps a rendered SVG into a single self-contained, offline HTML document that
 * **inlines** the SVG (not `<img>` — inlining is what lets page CSS/JS reach
 * into the picture) and layers on:
 *
 * - a **theme switcher** that recolors live by overriding the `--pin-*` vars on
 *   the document root (the painter already emits a `:root` block; inline styles
 *   on `<html>` win over it, so no re-render is needed),
 * - **hover** tooltips and a **click inspector** that reads a node's full attrs
 *   straight from the IR.
 *
 * Strictly additive: the standalone `.svg` is unchanged. The interactivity hangs
 * off `data-node-id` hooks the painter already stamps on each node, plus the IR
 * and theme tables embedded below. No external assets — works offline.
 */
import type { GraphIR, IRNode } from "./ir.ts";
import { THEMES, getTheme, type Theme } from "./theme.ts";
import { esc } from "./paint/svg.ts";

export interface HtmlOptions {
  /** Document title and on-page heading. */
  title?: string;
  /** Theme baked into the SVG; the switcher starts on this one. */
  theme?: Theme;
}

/** Embed a value as a JSON literal that's safe inside a `<script>` (a literal
 * `</script>` or `<!--` in the data would otherwise end the element). */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Theme name -> token map, for the live switcher (drops the `name` field). */
function themeTable(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, theme] of Object.entries(THEMES)) out[name] = theme.tokens;
  return out;
}

/** Node id -> the fields the inspector shows. The whole IRNode is small and
 * already serializable, so embed it as-is. */
function nodeTable(ir: GraphIR): Record<string, IRNode> {
  const out: Record<string, IRNode> = {};
  for (const n of ir.nodes) out[n.id] = n;
  return out;
}

/** Wrap a rendered SVG into the interactive HTML artifact. */
export function renderHtml(ir: GraphIR, svg: string, opts: HtmlOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const title = opts.title ?? "Infrastructure";
  const themeNames = Object.keys(THEMES);

  const options = themeNames
    .map((n) => `<option value="${esc(n)}"${n === theme.name ? " selected" : ""}>${esc(n)}</option>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · pinhole</title>
${PAGE_CSS}
</head>
<body>
<header class="pin-bar">
  <h1>${esc(title)}</h1>
  <label class="pin-theme">theme
    <select id="pin-theme-select">${options}</select>
  </label>
</header>
<main class="pin-stage" id="pin-stage">${svg}</main>
<div class="pin-tooltip" id="pin-tooltip" hidden></div>
<aside class="pin-inspector" id="pin-inspector" hidden>
  <button class="pin-close" id="pin-close" aria-label="Close inspector">&times;</button>
  <div id="pin-inspector-body"></div>
</aside>
<script>
const THEMES = ${jsonScript(themeTable())};
const NODES = ${jsonScript(nodeTable(ir))};
${VIEWER_JS}
</script>
</body>
</html>
`;
}

/** Page chrome. Everything that can key off a theme token does, via the same
 * `--pin-*` vars the SVG sets on `:root`, so the chrome recolors with the SVG. */
const PAGE_CSS = `<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: var(--pin-text, #E6EDF3);
    background: var(--pin-bg0, #0B0E14);
  }
  .pin-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 12px 20px;
    border-bottom: 1px solid var(--pin-neutralStroke, #252C38);
    background: var(--pin-bg1, #0F141D);
    position: sticky; top: 0; z-index: 5;
  }
  .pin-bar h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: .2px; }
  .pin-theme { font-size: 12px; color: var(--pin-textMuted, #7A8699); display: flex; gap: 8px; align-items: center; }
  .pin-theme select {
    font: inherit; color: var(--pin-text, #E6EDF3);
    background: var(--pin-neutralFill, #161B24);
    border: 1px solid var(--pin-neutralStroke, #252C38);
    border-radius: 6px; padding: 4px 8px;
  }
  .pin-stage { padding: 16px; }
  .pin-stage svg { max-width: 100%; height: auto; display: block; }
  .pin-stage [data-node-id] { cursor: pointer; }
  .pin-stage .pin-sel { filter: drop-shadow(0 0 6px var(--pin-accentBar, #4C8DFF)); }
  .pin-tooltip {
    position: fixed; z-index: 10; pointer-events: none;
    padding: 4px 8px; border-radius: 6px; font-size: 12px;
    color: var(--pin-text, #E6EDF3);
    background: var(--pin-neutralFill, #161B24);
    border: 1px solid var(--pin-neutralStroke, #252C38);
    box-shadow: 0 4px 14px rgba(0,0,0,.35);
  }
  .pin-tooltip b { color: var(--pin-accentBar, #4C8DFF); }
  .pin-inspector {
    position: fixed; top: 0; right: 0; bottom: 0; width: 320px; max-width: 80vw;
    z-index: 8; overflow: auto; padding: 16px 18px 24px;
    background: var(--pin-bg1, #0F141D);
    border-left: 1px solid var(--pin-neutralStroke, #252C38);
    box-shadow: -8px 0 24px rgba(0,0,0,.3);
  }
  .pin-close {
    float: right; font-size: 20px; line-height: 1; cursor: pointer;
    color: var(--pin-textMuted, #7A8699); background: none; border: 0;
  }
  .pin-inspector h2 { margin: 0 0 2px; font-size: 15px; word-break: break-all; }
  .pin-inspector .pin-sub { color: var(--pin-textFaint, #8A93A3); font-size: 12px; margin-bottom: 14px; }
  .pin-inspector dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 12.5px; }
  .pin-inspector dt { color: var(--pin-textFaint, #8A93A3); }
  .pin-inspector dd { margin: 0; color: var(--pin-textMuted, #7A8699); word-break: break-word; }
  .pin-inspector dd.ref { color: var(--pin-accentBar, #4C8DFF); }
  .pin-inspector .pin-section { margin-top: 16px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--pin-textFaint, #8A93A3); }
</style>`;

/** Client logic: live theme switch, hover tooltip, click inspector. Plain DOM,
 * no dependencies, runs from a `file://` open. */
const VIEWER_JS = String.raw`
const root = document.documentElement;
const stage = document.getElementById("pin-stage");
const tip = document.getElementById("pin-tooltip");
const inspector = document.getElementById("pin-inspector");
const inspectorBody = document.getElementById("pin-inspector-body");

// --- live theme switch: override --pin-* on <html> (beats the SVG's :root) ---
function applyTheme(name) {
  const tokens = THEMES[name];
  if (!tokens) return;
  for (const key in tokens) root.style.setProperty("--pin-" + key, tokens[key]);
}
document.getElementById("pin-theme-select").addEventListener("change", (e) => applyTheme(e.target.value));

// --- node lookup from an event target ---
function nodeElFrom(target) {
  return target && target.closest ? target.closest("[data-node-id]") : null;
}

// --- hover tooltip ---
stage.addEventListener("mousemove", (e) => {
  const el = nodeElFrom(e.target);
  if (!el) { tip.hidden = true; return; }
  const node = NODES[el.getAttribute("data-node-id")];
  if (!node) { tip.hidden = true; return; }
  tip.innerHTML = "<b>" + escapeHtml(node.id) + "</b> · " + escapeHtml(node.kind);
  tip.hidden = false;
  tip.style.left = (e.clientX + 14) + "px";
  tip.style.top = (e.clientY + 14) + "px";
});
stage.addEventListener("mouseleave", () => { tip.hidden = true; });

// --- click inspector ---
let selected = null;
function select(el) {
  if (selected) selected.classList.remove("pin-sel");
  selected = el;
  if (el) el.classList.add("pin-sel");
}
stage.addEventListener("click", (e) => {
  const el = nodeElFrom(e.target);
  if (!el) return;
  const node = NODES[el.getAttribute("data-node-id")];
  if (!node) return;
  select(el);
  inspectorBody.innerHTML = renderInspector(node);
  inspector.hidden = false;
});
document.getElementById("pin-close").addEventListener("click", () => {
  inspector.hidden = true;
  select(null);
});

function renderInspector(node) {
  let html = "<h2>" + escapeHtml(node.id) + "</h2>";
  html += "<div class='pin-sub'>" + escapeHtml(node.kind) + " · " + escapeHtml(node.lexicon) + "</div>";

  const meta = [];
  if (node.compositeInstance) meta.push(["composite", node.compositeInstance]);
  if (node.compositeParent) meta.push(["from type", node.compositeParent]);
  if (node.sourceLoc && node.sourceLoc.file) {
    meta.push(["source", node.sourceLoc.file + (node.sourceLoc.line ? ":" + node.sourceLoc.line : "")]);
  }
  if (meta.length) html += "<dl>" + meta.map(rowPlain).join("") + "</dl>";

  const attrs = node.attrs || {};
  const keys = Object.keys(attrs);
  if (keys.length) {
    html += "<div class='pin-section'>attributes</div>";
    html += "<dl>" + keys.map((k) => rowAttr(k, attrs[k])).join("") + "</dl>";
  }
  return html;
}

function rowPlain(pair) {
  return "<dt>" + escapeHtml(pair[0]) + "</dt><dd>" + escapeHtml(pair[1]) + "</dd>";
}
function rowAttr(key, value) {
  const ref = value && typeof value === "object" && "$ref" in value;
  const cls = ref ? " class='ref'" : "";
  return "<dt>" + escapeHtml(key) + "</dt><dd" + cls + ">" + escapeHtml(formatValue(value)) + "</dd>";
}
function formatValue(v) {
  if (v == null) return String(v);
  if (typeof v === "object") {
    if ("$ref" in v) return "→ " + v["$ref"];
    return JSON.stringify(v);
  }
  return String(v);
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
`;

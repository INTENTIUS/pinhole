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
<div class="pin-backdrop" id="pin-backdrop" hidden>
  <aside class="pin-inspector" id="pin-inspector" role="dialog" aria-modal="true">
    <button class="pin-close" id="pin-close" aria-label="Close inspector">&times;</button>
    <div id="pin-inspector-body"></div>
  </aside>
</div>
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
  .pin-stage [data-node-id], .pin-stage [data-edge-from] { cursor: pointer; }
  .pin-stage .pin-sel { filter: drop-shadow(0 0 6px var(--pin-accentBar, #4C8DFF)); }
  /* edge rollover: brighten the line, glow its two endpoint nodes */
  .pin-stage [data-edge-from]:hover .pin-edge-line { stroke: var(--pin-accentBar, #4C8DFF); stroke-width: 2.4; }
  .pin-stage .pin-edge-node { filter: drop-shadow(0 0 5px var(--pin-accentBar, #4C8DFF)); }
  .pin-tooltip {
    position: fixed; z-index: 10; pointer-events: none;
    padding: 4px 8px; border-radius: 6px; font-size: 12px;
    color: var(--pin-text, #E6EDF3);
    background: var(--pin-neutralFill, #161B24);
    border: 1px solid var(--pin-neutralStroke, #252C38);
    box-shadow: 0 4px 14px rgba(0,0,0,.35);
  }
  .pin-tooltip b { color: var(--pin-accentBar, #4C8DFF); }
  .pin-tooltip .pin-ref { display: block; margin-top: 3px; color: var(--pin-textMuted, #7A8699);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  /* A centered, wide modal — long AWS names/ARNs need the room a side rail can't give. */
  .pin-backdrop {
    position: fixed; inset: 0; z-index: 8; padding: 24px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.55);
  }
  .pin-backdrop[hidden] { display: none; }
  .pin-inspector {
    width: 680px; max-width: 92vw; max-height: 82vh; overflow: auto;
    padding: 20px 24px 24px;
    background: var(--pin-bg1, #0F141D);
    border: 1px solid var(--pin-neutralStroke, #252C38);
    border-radius: 14px;
    box-shadow: 0 24px 64px rgba(0,0,0,.5);
  }
  .pin-close {
    float: right; font-size: 22px; line-height: 1; cursor: pointer;
    color: var(--pin-textMuted, #7A8699); background: none; border: 0;
  }
  .pin-inspector h2 { margin: 0 0 2px; font-size: 18px; word-break: break-all; }
  .pin-inspector .pin-sub { color: var(--pin-textFaint, #8A93A3); font-size: 12.5px; margin-bottom: 16px; }
  .pin-inspector .pin-section { margin: 18px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--pin-textFaint, #8A93A3); }
  /* meta is short → a tidy two-column grid */
  .pin-inspector dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; font-size: 12.5px; }
  .pin-inspector dt { color: var(--pin-textFaint, #8A93A3); }
  .pin-inspector dd { margin: 0; color: var(--pin-textMuted, #7A8699); word-break: break-word; }
  /* attrs stack key-over-value so long keys and ARNs/refs get the full width */
  .pin-attrs { display: flex; flex-direction: column; gap: 10px; }
  .pin-attr .k { color: var(--pin-textFaint, #8A93A3); font-size: 11.5px; word-break: break-all; }
  .pin-attr .v { margin-top: 1px; color: var(--pin-textMuted, #7A8699); font-size: 12.5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; white-space: pre-wrap; }
  .pin-attr .v.ref { color: var(--pin-accentBar, #4C8DFF); }
</style>`;

/** Client logic: live theme switch, hover tooltip, click inspector. Plain DOM,
 * no dependencies, runs from a `file://` open. */
const VIEWER_JS = String.raw`
const root = document.documentElement;
const stage = document.getElementById("pin-stage");
const tip = document.getElementById("pin-tooltip");
const backdrop = document.getElementById("pin-backdrop");
const inspector = document.getElementById("pin-inspector");
const inspectorBody = document.getElementById("pin-inspector-body");

// --- live theme switch: override --pin-* on <html> (beats the SVG's :root) ---
function applyTheme(name) {
  const tokens = THEMES[name];
  if (!tokens) return;
  for (const key in tokens) root.style.setProperty("--pin-" + key, tokens[key]);
}
document.getElementById("pin-theme-select").addEventListener("change", (e) => applyTheme(e.target.value));

// --- lookups from an event target ---
function nodeElFrom(target) {
  return target && target.closest ? target.closest("[data-node-id]") : null;
}
function edgeElFrom(target) {
  return target && target.closest ? target.closest("[data-edge-from]") : null;
}

// --- hover tooltip: nodes, and edges (the relationship + its ref value) ---
let litNodes = [];
function clearEdgeHighlight() {
  litNodes.forEach((el) => el.classList.remove("pin-edge-node"));
  litNodes = [];
}
function placeTip(e) {
  tip.hidden = false;
  tip.style.left = (e.clientX + 14) + "px";
  tip.style.top = (e.clientY + 14) + "px";
}
// the exact $ref a consumer attr holds, e.g. "vpc.VpcId" — the producer attribute
// the relationship actually flows through.
function refValue(from, via, to, toAttr) {
  if (toAttr) return to + "." + toAttr;
  const node = NODES[from];
  const v = node && node.attrs && via ? node.attrs[via] : null;
  const pick = (x) => (x && typeof x === "object" && "$ref" in x ? x["$ref"] : null);
  if (Array.isArray(v)) {
    for (const it of v) { const r = pick(it); if (r && r.indexOf(to + ".") === 0) return r; }
  }
  return pick(v) || to;
}
function highlightEndpoints(g) {
  clearEdgeHighlight();
  for (const id of [g.getAttribute("data-edge-from"), g.getAttribute("data-edge-to")]) {
    const el = stage.querySelector('[data-node-id="' + (id || "").replace(/"/g, '\\"') + '"]');
    if (el) { el.classList.add("pin-edge-node"); litNodes.push(el); }
  }
}
stage.addEventListener("mousemove", (e) => {
  const nodeEl = nodeElFrom(e.target);
  if (nodeEl) {
    const node = NODES[nodeEl.getAttribute("data-node-id")];
    if (node) {
      tip.innerHTML = "<b>" + escapeHtml(node.id) + "</b> · " + escapeHtml(node.kind);
      placeTip(e);
      clearEdgeHighlight();
      return;
    }
  }
  const edgeEl = edgeElFrom(e.target);
  if (edgeEl) {
    const from = edgeEl.getAttribute("data-edge-from");
    const to = edgeEl.getAttribute("data-edge-to");
    const via = edgeEl.getAttribute("data-edge-via");
    const toAttr = edgeEl.getAttribute("data-edge-to-attr");
    let html = "<b>" + escapeHtml(from) + "</b>" + (via ? "." + escapeHtml(via) : "") +
      " &rarr; <b>" + escapeHtml(to) + "</b>" + (toAttr ? "." + escapeHtml(toAttr) : "");
    const ref = refValue(from, via, to, toAttr);
    if (ref) html += "<span class='pin-ref'>" + escapeHtml(ref) + "</span>";
    tip.innerHTML = html;
    placeTip(e);
    highlightEndpoints(edgeEl);
    return;
  }
  tip.hidden = true;
  clearEdgeHighlight();
});
stage.addEventListener("mouseleave", () => { tip.hidden = true; clearEdgeHighlight(); });

// --- click inspector ---
let selected = null;
function select(el) {
  if (selected) selected.classList.remove("pin-sel");
  selected = el;
  if (el) el.classList.add("pin-sel");
}
function openInspector(node, el) {
  select(el);
  inspectorBody.innerHTML = renderInspector(node);
  backdrop.hidden = false;
  inspector.scrollTop = 0;
}
function closeInspector() {
  backdrop.hidden = true;
  select(null);
}
stage.addEventListener("click", (e) => {
  const el = nodeElFrom(e.target);
  if (!el) return;
  const node = NODES[el.getAttribute("data-node-id")];
  if (node) openInspector(node, el);
});
document.getElementById("pin-close").addEventListener("click", closeInspector);
// click the dimmed backdrop (but not the dialog) to dismiss
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeInspector(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) closeInspector(); });

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
    html += "<div class='pin-attrs'>" + keys.map((k) => rowAttr(k, attrs[k])).join("") + "</div>";
  }
  return html;
}

function rowPlain(pair) {
  return "<dt>" + escapeHtml(pair[0]) + "</dt><dd>" + escapeHtml(pair[1]) + "</dd>";
}
// Stacked key-over-value so long keys and ARNs/$refs get the dialog's full width.
function rowAttr(key, value) {
  const ref = value && typeof value === "object" && "$ref" in value;
  const vcls = ref ? "v ref" : "v";
  return "<div class='pin-attr'><div class='k'>" + escapeHtml(key) + "</div>" +
    "<div class='" + vcls + "'>" + escapeHtml(formatValue(value)) + "</div></div>";
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

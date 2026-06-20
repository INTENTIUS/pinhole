/**
 * Cross-view morph (#9, the showpiece). chant's node ids are stable across
 * detail tiers and lenses, so the artifact can FLIP/morph between views instead
 * of re-rendering from scratch: nodes present in both views glide to their new
 * position, a composite collapses/expands in place, and out-of-scope nodes fade.
 * Identity continuity comes free from the IR — most diagram tools can't do this.
 *
 * One self-contained, offline HTML file holds every view (node positions + edges
 * per view, the union of nodes drawn once as transform-placed glyph badges). A
 * view switcher morphs between them; the theme switcher, hover, and click
 * inspector work as in the single-view artifact.
 */
import type { GraphIR, IRNode } from "./ir.ts";
import { getTheme, v, defs, THEMES, type Theme } from "./theme.ts";
import { resolveGlyph } from "./icons.ts";
import { clip, esc } from "./paint/svg.ts";

const MARGIN = 80;
const TITLE_BAND = 90;

/** One view to morph between — a rendered IR at some detail/lens, with chant's
 * layout positions. */
export interface MorphView {
  name: string;
  ir: GraphIR;
  layout: { width: number; height: number; nodes: Array<{ id: string; x: number; y: number }> };
}

export interface MorphOptions {
  title?: string;
  theme?: Theme;
}

/** `<` -safe JSON for embedding in a `<script>`. */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Map a view's layout (y-up) into centred screen coordinates in a shared canvas
 * sized to the largest view, so morphs read as expand-in-place, not drift. */
function place(view: MorphView, morphW: number, morphH: number): Record<string, { x: number; y: number }> {
  const w = Math.ceil(view.layout.width + MARGIN * 2);
  const h = Math.ceil(view.layout.height + MARGIN * 2 + TITLE_BAND);
  const ox = (morphW - w) / 2;
  const oy = (morphH - h) / 2;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of view.layout.nodes) {
    pos[n.id] = {
      x: Math.round(MARGIN + n.x + ox),
      y: Math.round(MARGIN + TITLE_BAND + (view.layout.height - n.y) + oy),
    };
  }
  return pos;
}

function viewCanvas(view: MorphView): { w: number; h: number } {
  return {
    w: Math.ceil(view.layout.width + MARGIN * 2),
    h: Math.ceil(view.layout.height + MARGIN * 2 + TITLE_BAND),
  };
}

/** A glyph badge drawn at the origin (0,0) so a transform can place/move it. */
function badge(id: string, glyph: string, theme: Theme): string {
  const k = (26 / 24).toFixed(4);
  return (
    `<g class="pin-mnode" data-node-id="${esc(id)}" transform="translate(0,0)" style="opacity:0">` +
    `<rect x="-22" y="-22" width="44" height="44" rx="12" fill="${v(theme, "neutralFill")}" stroke="${v(theme, "neutralStroke")}" stroke-width="1.4"/>` +
    `<rect x="-22" y="-22" width="44" height="4" rx="2" fill="${v(theme, "neutralBar")}"/>` +
    `<g transform="translate(-13 -12) scale(${k})" fill="none" stroke="${v(theme, "textFaint")}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
    `<text y="36" text-anchor="middle" fill="${v(theme, "text")}" font-size="11" font-weight="600">${esc(clip(id, 16))}</text>` +
    `</g>`
  );
}

/** Build the cross-view morph artifact. */
export function renderMorphHtml(views: MorphView[], opts: MorphOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const title = opts.title ?? "Infrastructure";

  const morphW = Math.max(400, ...views.map((view) => viewCanvas(view).w));
  const morphH = Math.max(300, ...views.map((view) => viewCanvas(view).h));

  // Per-view data: node positions + edges. And the union of node metadata.
  const viewData = views.map((view) => ({
    name: view.name,
    pos: place(view, morphW, morphH),
    edges: view.ir.edges.map((e) => ({ from: e.from, to: e.to, via: e.viaAttr, toAttr: e.toAttr })),
  }));

  const meta: Record<string, Pick<IRNode, "kind" | "lexicon" | "attrs">> = {};
  for (const view of views) {
    for (const n of view.ir.nodes) {
      if (!meta[n.id]) meta[n.id] = { kind: n.kind, lexicon: n.lexicon, attrs: n.attrs };
    }
  }

  const badges = Object.keys(meta)
    .map((id) => badge(id, resolveGlyph({ lexicon: meta[id].lexicon, kind: meta[id].kind }).body, theme))
    .join("");

  const themeOptions = Object.keys(THEMES)
    .map((n) => `<option value="${esc(n)}"${n === theme.name ? " selected" : ""}>${esc(n)}</option>`)
    .join("");
  const viewButtons = viewData
    .map((vw, i) => `<button class="pin-view" data-view="${i}"${i === 0 ? " aria-current=\"true\"" : ""}>${esc(vw.name)}</button>`)
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${morphW} ${morphH}" ` +
    `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">` +
    defs(theme) +
    `<rect width="${morphW}" height="${morphH}" fill="url(#pin-bg)"/>` +
    `<rect width="${morphW}" height="${morphH}" fill="url(#pin-dots)" opacity="0.6"/>` +
    `<g id="pin-edges"></g>` +
    badges +
    `</svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · pinhole morph</title>
${PAGE_CSS}
</head>
<body>
<header class="pin-bar">
  <h1>${esc(title)}</h1>
  <div class="pin-views" id="pin-views">${viewButtons}</div>
  <label class="pin-theme">theme <select id="pin-theme-select">${themeOptions}</select></label>
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
const THEMES = ${jsonScript(Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, t.tokens])))};
const VIEWS = ${jsonScript(viewData)};
const META = ${jsonScript(meta)};
${VIEWER_JS}
</script>
</body>
</html>
`;
}

const PAGE_CSS = `<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: var(--pin-text, #E6EDF3); background: var(--pin-bg0, #0B0E14); }
  .pin-bar { display: flex; align-items: center; gap: 16px; padding: 12px 20px;
    border-bottom: 1px solid var(--pin-neutralStroke, #252C38); background: var(--pin-bg1, #0F141D);
    position: sticky; top: 0; z-index: 5; }
  .pin-bar h1 { margin: 0; font-size: 16px; font-weight: 700; }
  .pin-views { display: flex; gap: 6px; margin-left: auto; }
  .pin-view { font: 12px 'Inter', system-ui, sans-serif; cursor: pointer; padding: 5px 12px; border-radius: 7px;
    color: var(--pin-textMuted, #7A8699); background: var(--pin-neutralFill, #161B24);
    border: 1px solid var(--pin-neutralStroke, #252C38); }
  .pin-view[aria-current="true"] { color: var(--pin-text, #E6EDF3); border-color: var(--pin-accentBar, #4C8DFF);
    box-shadow: 0 0 0 1px var(--pin-accentBar, #4C8DFF) inset; }
  .pin-theme { font-size: 12px; color: var(--pin-textMuted, #7A8699); display: flex; gap: 8px; align-items: center; }
  .pin-theme select { font: inherit; color: var(--pin-text, #E6EDF3); background: var(--pin-neutralFill, #161B24);
    border: 1px solid var(--pin-neutralStroke, #252C38); border-radius: 6px; padding: 4px 8px; }
  .pin-stage { padding: 16px; }
  .pin-stage svg { max-width: 100%; height: auto; display: block; }
  .pin-mnode { cursor: pointer; transition: transform .6s cubic-bezier(.4,0,.2,1), opacity .4s ease; }
  .pin-mnode.pin-instant { transition: none; }
  .pin-mnode:hover { filter: drop-shadow(0 0 6px var(--pin-accentBar, #4C8DFF)); }
  .pin-medge { stroke: var(--pin-edge, #3A434F); fill: none; stroke-width: 1.4; stroke-linecap: round;
    transition: opacity .35s ease; }
  .pin-tooltip { position: fixed; z-index: 10; pointer-events: none; padding: 4px 8px; border-radius: 6px;
    font-size: 12px; color: var(--pin-text, #E6EDF3); background: var(--pin-neutralFill, #161B24);
    border: 1px solid var(--pin-neutralStroke, #252C38); box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .pin-tooltip b { color: var(--pin-accentBar, #4C8DFF); }
  .pin-backdrop { position: fixed; inset: 0; z-index: 8; padding: 24px; display: flex; align-items: center;
    justify-content: center; background: rgba(0,0,0,.55); }
  .pin-backdrop[hidden] { display: none; }
  .pin-inspector { width: 680px; max-width: 92vw; max-height: 82vh; overflow: auto; padding: 20px 24px 24px;
    background: var(--pin-bg1, #0F141D); border: 1px solid var(--pin-neutralStroke, #252C38);
    border-radius: 14px; box-shadow: 0 24px 64px rgba(0,0,0,.5); }
  .pin-close { float: right; font-size: 22px; line-height: 1; cursor: pointer;
    color: var(--pin-textMuted, #7A8699); background: none; border: 0; }
  .pin-inspector h2 { margin: 0 0 2px; font-size: 18px; word-break: break-all; }
  .pin-inspector .pin-sub { color: var(--pin-textFaint, #8A93A3); font-size: 12.5px; margin-bottom: 16px; }
  .pin-inspector .pin-section { margin: 18px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px;
    color: var(--pin-textFaint, #8A93A3); }
  .pin-attrs { display: flex; flex-direction: column; gap: 10px; }
  .pin-attr .k { color: var(--pin-textFaint, #8A93A3); font-size: 11.5px; word-break: break-all; }
  .pin-attr .v { margin-top: 1px; color: var(--pin-textMuted, #7A8699); font-size: 12.5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; white-space: pre-wrap; }
  .pin-attr .v.ref { color: var(--pin-accentBar, #4C8DFF); }
</style>`;

const VIEWER_JS = String.raw`
const SVGNS = "http://www.w3.org/2000/svg";
const root = document.documentElement;
const stage = document.getElementById("pin-stage");
const tip = document.getElementById("pin-tooltip");
const edgeLayer = document.getElementById("pin-edges");
const backdrop = document.getElementById("pin-backdrop");
const inspectorBody = document.getElementById("pin-inspector-body");
const nodeEls = {};
stage.querySelectorAll("[data-node-id]").forEach((el) => { nodeEls[el.getAttribute("data-node-id")] = el; });
let current = -1;
let edgeTimer = 0;

// --- live theme switch ---
function applyTheme(name) {
  const tokens = THEMES[name];
  if (!tokens) return;
  for (const key in tokens) root.style.setProperty("--pin-" + key, tokens[key]);
}
document.getElementById("pin-theme-select").addEventListener("change", (e) => applyTheme(e.target.value));

// --- morph between views ---
function buildEdges(view) {
  edgeLayer.innerHTML = "";
  for (const e of view.edges) {
    const a = view.pos[e.from], b = view.pos[e.to];
    if (!a || !b) continue;
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("class", "pin-medge");
    p.setAttribute("d", "M " + a.x + " " + a.y + " C " + a.x + " " + ((a.y + b.y) / 2) + ", " + b.x + " " + ((a.y + b.y) / 2) + ", " + b.x + " " + b.y);
    p.style.opacity = "0";
    edgeLayer.appendChild(p);
    requestAnimationFrame(() => { p.style.opacity = "1"; });
  }
}
function applyView(i, instant) {
  const view = VIEWS[i];
  if (!view) return;
  current = i;
  document.querySelectorAll(".pin-view").forEach((b, j) => b.setAttribute("aria-current", j === i ? "true" : "false"));
  // fade the current edges out; rebuild after the nodes have moved
  edgeLayer.querySelectorAll(".pin-medge").forEach((p) => { p.style.opacity = "0"; });
  for (const id in nodeEls) {
    const g = nodeEls[id];
    if (instant) g.classList.add("pin-instant");
    const p = view.pos[id];
    if (p) { g.style.transform = "translate(" + p.x + "px," + p.y + "px)"; g.style.opacity = "1"; }
    else { g.style.opacity = "0"; } // out of this view — fade, keep last position
    if (instant) requestAnimationFrame(() => g.classList.remove("pin-instant"));
  }
  clearTimeout(edgeTimer);
  if (instant) buildEdges(view);
  else edgeTimer = setTimeout(() => buildEdges(view), 620);
}
document.getElementById("pin-views").addEventListener("click", (e) => {
  const b = e.target.closest(".pin-view");
  if (b) applyView(+b.getAttribute("data-view"), false);
});

// --- hover tooltip ---
function nodeElFrom(t) { return t && t.closest ? t.closest("[data-node-id]") : null; }
stage.addEventListener("mousemove", (e) => {
  const el = nodeElFrom(e.target);
  if (!el || el.style.opacity === "0") { tip.hidden = true; return; }
  const m = META[el.getAttribute("data-node-id")];
  if (!m) { tip.hidden = true; return; }
  tip.innerHTML = "<b>" + escapeHtml(el.getAttribute("data-node-id")) + "</b> · " + escapeHtml(m.kind);
  tip.hidden = false;
  tip.style.left = (e.clientX + 14) + "px";
  tip.style.top = (e.clientY + 14) + "px";
});
stage.addEventListener("mouseleave", () => { tip.hidden = true; });

// --- click inspector ---
stage.addEventListener("click", (e) => {
  const el = nodeElFrom(e.target);
  if (!el || el.style.opacity === "0") return;
  const id = el.getAttribute("data-node-id");
  if (!META[id]) return;
  inspectorBody.innerHTML = renderInspector(id, META[id]);
  backdrop.hidden = false;
});
document.getElementById("pin-close").addEventListener("click", () => { backdrop.hidden = true; });
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") backdrop.hidden = true; });

function renderInspector(id, m) {
  let html = "<h2>" + escapeHtml(id) + "</h2>";
  html += "<div class='pin-sub'>" + escapeHtml(m.kind) + " · " + escapeHtml(m.lexicon) + "</div>";
  const attrs = m.attrs || {};
  const keys = Object.keys(attrs);
  if (keys.length) {
    html += "<div class='pin-section'>attributes</div><div class='pin-attrs'>";
    html += keys.map((k) => rowAttr(k, attrs[k])).join("");
    html += "</div>";
  }
  return html;
}
function rowAttr(key, value) {
  const ref = value && typeof value === "object" && "$ref" in value;
  return "<div class='pin-attr'><div class='k'>" + escapeHtml(key) + "</div>" +
    "<div class='" + (ref ? "v ref" : "v") + "'>" + escapeHtml(fmt(value)) + "</div></div>";
}
function fmt(v) {
  if (v == null) return String(v);
  if (typeof v === "object") return "$ref" in v ? "→ " + v["$ref"] : JSON.stringify(v);
  return String(v);
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

applyView(0, true);
`;

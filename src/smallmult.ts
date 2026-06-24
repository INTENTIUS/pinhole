/**
 * Linked small-multiples (#3) — N environments side by side, the same project
 * graphed per environment, aligned so each composite sits in one row across all
 * columns. A gap in a row *is* the drift (a composite present in some environments
 * but not others). Synchronized hover: pointing at a composite in one environment
 * highlights its counterparts in the rest.
 *
 * Reads the composite tier (one IR per environment). The grid SVG is portable;
 * the interactive artifact adds the synced highlight.
 */
import type { GraphIR } from "./ir.ts";
import { getTheme, v, defs, THEMES, type Theme } from "./theme.ts";
import { resolveGlyph } from "./icons.ts";
import { clip, esc } from "./paint/svg.ts";

export interface SmallMultPanel { env: string; composites: GraphIR }
export interface SmallMultOptions { title?: string; theme?: Theme }

const LABEL_W = 140, ENV_W = 180, ROW_H = 64, ROW_GAP = 14, HEAD_H = 44, M = 60;

/** The grid SVG: rows = composites (union), columns = environments. */
export function smallMultiplesSvg(panels: SmallMultPanel[], theme: Theme, title: string): string {
  const has = (p: SmallMultPanel, id: string) => p.composites.nodes.some((n) => n.id === id);
  const nodeOf = (p: SmallMultPanel, id: string) => p.composites.nodes.find((n) => n.id === id);
  // Row order: first env's composites, then any later-env-only ones appended.
  const ids: string[] = [];
  for (const p of panels) for (const n of p.composites.nodes) if (!ids.includes(n.id)) ids.push(n.id);

  const colX = (c: number) => M + LABEL_W + c * ENV_W;
  const rowY = (r: number) => M + HEAD_H + 24 + r * (ROW_H + ROW_GAP);
  const W = Math.ceil(colX(panels.length) + M - 20);
  const H = Math.ceil(rowY(ids.length) + M - ROW_GAP);

  const head = panels
    .map((p, c) => `<text x="${colX(c) + (ENV_W - 30) / 2}" y="${M + HEAD_H}" text-anchor="middle" fill="${v(theme, "text")}" font-size="14" font-weight="700">${esc(p.env)}</text>`)
    .join("");

  const cells = ids
    .map((id, r) => {
      const present = panels.filter((p) => has(p, id)).length;
      const drift = present !== panels.length; // missing in ≥1 env
      const y = rowY(r);
      const label = `<text x="${M}" y="${y + ROW_H / 2 + 4}" fill="${drift ? v(theme, "warnBar") : v(theme, "textMuted")}" font-size="12" font-weight="600">${esc(clip(id, 17))}</text>`;
      const row = panels
        .map((p, c) => {
          const x = colX(c);
          const n = nodeOf(p, id);
          if (!n) {
            // a gap — this composite isn't in this environment (drift)
            return `<rect x="${x}" y="${y}" width="${ENV_W - 30}" height="${ROW_H}" rx="10" fill="none" stroke="${v(theme, "neutralStroke")}" stroke-width="1.2" stroke-dasharray="3 5" opacity="0.5"/>` +
              `<text x="${x + (ENV_W - 30) / 2}" y="${y + ROW_H / 2 + 4}" text-anchor="middle" fill="${v(theme, "textFaint")}" font-size="12">—</text>`;
          }
          const glyph = resolveGlyph({ lexicon: n.lexicon, kind: n.kind });
          const members = (n.attrs as { members?: number } | undefined)?.members;
          return (
            `<g class="pin-cell" data-node-id="${esc(id)}">` +
            `<rect x="${x}" y="${y}" width="${ENV_W - 30}" height="${ROW_H}" rx="10" fill="${v(theme, "neutralFill")}" stroke="${drift ? v(theme, "warnStroke") : v(theme, "accentStroke")}" stroke-width="1.4"/>` +
            `<g transform="translate(${x + 12} ${y + 13}) scale(1.0833)" fill="none" stroke="${v(theme, "textFaint")}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph.body}</g>` +
            `<text x="${x + 42}" y="${y + 26}" fill="${v(theme, "text")}" font-size="13" font-weight="700">${esc(clip(id, 11))}</text>` +
            (members != null ? `<text x="${x + 42}" y="${y + 43}" fill="${v(theme, "textFaint")}" font-size="10">${members} resources</text>` : "") +
            `</g>`
          );
        })
        .join("");
      return label + row;
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">` +
    defs(theme) +
    `<rect width="${W}" height="${H}" fill="url(#pin-bg)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#pin-dots)" opacity="0.6"/>` +
    `<text x="${M}" y="44" fill="${v(theme, "text")}" font-size="22" font-weight="700">${esc(title)}</text>` +
    head + cells +
    `</svg>`
  );
}

/** Interactive artifact: the grid + synchronized hover highlight across columns. */
export function renderSmallMultiples(panels: SmallMultPanel[], opts: SmallMultOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const title = opts.title ?? "Environments";
  const svg = smallMultiplesSvg(panels, theme, title);
  const themeVars = JSON.stringify(Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, t.tokens]))).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · pinhole</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px 'Inter', system-ui, sans-serif; color: var(--pin-text, #E6EDF3); background: var(--pin-bg0, #0B0E14); }
  header { display: flex; gap: 14px; align-items: baseline; padding: 12px 18px; border-bottom: 1px solid var(--pin-neutralStroke, #252C38); }
  header h1 { font-size: 14px; margin: 0; }
  .pin-hint { color: var(--pin-textFaint, #8A93A3); font-size: 12px; }
  main { padding: 16px; display: flex; justify-content: center; }
  svg { max-width: 100%; height: auto; }
  .pin-cell { cursor: pointer; }
  .pin-cell rect { transition: stroke .12s ease, filter .12s ease; }
  .pin-cell.pin-hl rect { stroke: var(--pin-accentBar, #4C8DFF) !important; stroke-width: 2.4 !important; filter: drop-shadow(0 0 6px var(--pin-accentBar, #4C8DFF)); }
</style></head>
<body>
<header><h1>${esc(title)}</h1><span class="pin-hint">hover a composite — its counterparts light up across environments · a dashed gap is drift</span>
<label class="pin-hint">theme <select id="pin-theme">${Object.keys(THEMES).map((n) => `<option${n === theme.name ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label></header>
<main>${svg}</main>
<script>
const THEMES = ${themeVars};
const root = document.documentElement;
function applyTheme(name){ const t = THEMES[name]; if(!t) return; for(const k in t) root.style.setProperty("--pin-"+k, t[k]); }
const sel = document.getElementById("pin-theme"); sel.addEventListener("change", () => applyTheme(sel.value)); applyTheme(sel.value);
const stage = document.querySelector("main");
const cellsFor = (id) => stage.querySelectorAll('[data-node-id="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');
stage.addEventListener("mouseover", (e) => { const g = e.target.closest && e.target.closest("[data-node-id]"); if(!g) return; cellsFor(g.getAttribute("data-node-id")).forEach((c)=>c.classList.add("pin-hl")); });
stage.addEventListener("mouseout", (e) => { const g = e.target.closest && e.target.closest("[data-node-id]"); if(!g) return; cellsFor(g.getAttribute("data-node-id")).forEach((c)=>c.classList.remove("pin-hl")); });
</script>
</body></html>
`;
}

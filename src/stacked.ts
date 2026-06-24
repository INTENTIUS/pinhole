/**
 * Stacked tie-line view (#3) — the deployment-drift showpiece. Each environment
 * is a layered plane; a tie connects the same composite across planes. A straight
 * tie means the composite is consistent across the two environments; an accent
 * tie means it changed; a missing tie means drift — the composite exists in one
 * environment but not the other (added in target / removed from base).
 *
 * Reads the composite tier (one IR per environment) plus the drift status from
 * {@link diffTiers}; portable SVG, like the flow lens.
 */
import type { GraphIR } from "./ir.ts";
import { getTheme, v, defs, type Theme } from "./theme.ts";
import { resolveGlyph } from "./icons.ts";
import { clip, esc } from "./paint/svg.ts";
import type { DiffStatus } from "./diff.ts";

export interface StackedPlane { env: string; composites: GraphIR }
export interface StackedOptions { title?: string; theme?: Theme }

const CARD_W = 150, CARD_H = 64, COL_GAP = 44, PLANE_DX = 48, M = 60;

/** Render two environment planes with drift ties. `status` is the composite-level
 * drift of target vs base (from diffTiers): added / removed / changed / same. */
export function renderStacked(base: StackedPlane, target: StackedPlane, status: Record<string, DiffStatus>, opts: StackedOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const title = opts.title ?? `${base.env} → ${target.env}`;

  const baseIds = base.composites.nodes.map((n) => n.id);
  const targetIds = target.composites.nodes.map((n) => n.id);
  const ids = [...targetIds, ...baseIds.filter((id) => !targetIds.includes(id))]; // target order, then base-only
  const nodeOf = (p: StackedPlane, id: string) => p.composites.nodes.find((n) => n.id === id);
  const colX = (i: number) => M + 150 + i * (CARD_W + COL_GAP);

  // base plane is the back layer (top), target the front layer (bottom, shifted).
  const baseY = M + 70, targetY = baseY + 150;
  const planeX = (plane: 0 | 1) => plane * PLANE_DX;
  const canvasW = colX(ids.length - 1) + CARD_W + PLANE_DX + M;
  const canvasH = targetY + CARD_H + 80;

  const tint = (st: DiffStatus | undefined, isBase: boolean): { stroke: string; bar: string; label: string } => {
    if (st === "added") return { stroke: v(theme, "goodStroke"), bar: v(theme, "goodBar"), label: v(theme, "goodBar") };
    if (st === "removed") return { stroke: v(theme, "warnStroke"), bar: v(theme, "warnBar"), label: v(theme, "warnBar") };
    if (st === "changed") return { stroke: v(theme, "accentStroke"), bar: v(theme, "accentBar"), label: v(theme, "accentBar") };
    return { stroke: v(theme, "neutralStroke"), bar: v(theme, "neutralBar"), label: v(theme, "text") };
  };

  const card = (id: string, i: number, plane: 0 | 1, isBase: boolean): string => {
    const n = nodeOf(isBase ? base : target, id);
    if (!n) return "";
    const x = colX(i) + planeX(plane), y = isBase ? baseY : targetY;
    const st = status[id];
    // the base plane is the baseline: only a *removed* node is tinted there.
    const t = tint(isBase ? (st === "removed" ? "removed" : "same") : st, isBase);
    const glyph = resolveGlyph({ lexicon: n.lexicon, kind: n.kind });
    const members = (n.attrs as { members?: number } | undefined)?.members;
    const dashed = (isBase && st === "removed") ? ` stroke-dasharray="4 4"` : "";
    return (
      `<g data-node-id="${esc(id)}" data-diff="${st ?? "same"}">` +
      `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="11" fill="${v(theme, "neutralFill")}" stroke="${t.stroke}" stroke-width="1.5"${dashed}/>` +
      `<rect x="${x}" y="${y}" width="${CARD_W}" height="4" rx="2" fill="${t.bar}"/>` +
      `<g transform="translate(${x + 12} ${y + 14}) scale(1.0833)" fill="none" stroke="${v(theme, "textFaint")}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph.body}</g>` +
      `<text x="${x + 44}" y="${y + 27}" fill="${t.label}" font-size="13" font-weight="700">${esc(clip(id, 13))}</text>` +
      (members != null ? `<text x="${x + 44}" y="${y + 44}" fill="${v(theme, "textFaint")}" font-size="10">${members} resources</text>` : "") +
      `</g>`
    );
  };

  // Ties: a node in both planes gets a tie (straight=same, accent=changed); a
  // node in only one plane has no tie — that gap *is* the drift.
  const tie = (id: string, i: number): string => {
    if (!nodeOf(base, id) || !nodeOf(target, id)) return ""; // drift → no tie
    const st = status[id];
    const x1 = colX(i) + CARD_W / 2, y1 = baseY + CARD_H;
    const x2 = colX(i) + PLANE_DX + CARD_W / 2, y2 = targetY;
    const accent = st === "changed";
    return `<path class="pin-tie" data-tie="${esc(id)}" d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${accent ? v(theme, "accentBar") : v(theme, "edge")}" stroke-width="${accent ? 2 : 1.3}" stroke-dasharray="${accent ? "" : "1 5"}" opacity="${accent ? "0.95" : "0.6"}"/>`;
  };

  const planeLabel = (env: string, plane: 0 | 1, isBase: boolean): string => {
    const y = (isBase ? baseY : targetY) + CARD_H / 2 + 4;
    return `<text x="${M - 10 + planeX(plane)}" y="${y}" text-anchor="end" fill="${v(theme, "textMuted")}" font-size="13" font-weight="700" letter-spacing=".3">${esc(env)}</text>`;
  };

  const W = Math.ceil(canvasW), H = Math.ceil(canvasH);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">` +
    defs(theme) +
    `<rect width="${W}" height="${H}" fill="url(#pin-bg)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#pin-dots)" opacity="0.6"/>` +
    `<text x="${M}" y="48" fill="${v(theme, "text")}" font-size="22" font-weight="700">${esc(title)}</text>` +
    `<text x="${M}" y="68" fill="${v(theme, "textFaint")}" font-size="11">straight tie = same · blue tie = changed · no tie = drift (green added / red removed)</text>` +
    ids.map((id, i) => tie(id, i)).join("") +
    planeLabel(base.env, 0, true) + planeLabel(target.env, 1, false) +
    ids.map((id, i) => card(id, i, 0, true)).join("") +
    ids.map((id, i) => card(id, i, 1, false)).join("") +
    `</svg>`
  );
}

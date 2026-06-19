import type { GraphIR, IRNode, Layout } from "../ir.ts";
import { getTheme, type Theme } from "../theme.ts";
import { resolveGlyph } from "../icons.ts";
import { Canvas, type Status } from "./svg.ts";

const CARD_W = 180;
const CARD_H = 64;
const MARGIN = 80;
const TITLE_BAND = 90;

/** Paint a graph IR into an SVG document, given chant's layout positions. */
export function renderSvg(
  ir: GraphIR,
  layout: Layout,
  opts: { title?: string; theme?: Theme } = {},
): string {
  const theme = opts.theme ?? getTheme();
  // chant's --format layout gives positions as an array of {id,x,y} in Graphviz
  // space (y grows upward). Index them, then map into a px canvas with a title
  // band on top and y flipped so the graph reads top-to-bottom.
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const contentW = layout.width + CARD_W;
  const contentH = layout.height + CARD_H;
  const W = Math.ceil(contentW + MARGIN * 2);
  const H = Math.ceil(contentH + MARGIN * 2 + TITLE_BAND);

  const place = (id: string): { cx: number; cy: number } | undefined => {
    const p = pos.get(id);
    if (!p) return undefined;
    return {
      cx: MARGIN + p.x,
      cy: MARGIN + TITLE_BAND + (layout.height - p.y),
    };
  };

  const c = new Canvas(W, H, theme);
  c.title(MARGIN, 56, opts.title ?? "Infrastructure", `${ir.nodes.length} resources · ${ir.edges.length} references`);

  // Edges first so cards sit on top.
  for (const e of ir.edges) {
    const a = place(e.from);
    const b = place(e.to);
    if (!a || !b) continue;
    c.edge(`M ${a.cx} ${a.cy} C ${a.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${b.cy}`, 1.4);
  }

  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  for (const [id, node] of byId) {
    const p = place(id);
    if (!p) continue;
    const x = Math.round(p.cx - CARD_W / 2);
    const y = Math.round(p.cy - CARD_H / 2);
    const glyph = resolveGlyph({ lexicon: node.lexicon, kind: node.kind });
    c.nodeCard(x, y, CARD_W, CARD_H, statusFor(node), node.id, `${node.kind} · ${node.lexicon}`, glyph.body);
  }

  return c.toString();
}

/** Placeholder status mapping. A real design system will key off kind/lexicon. */
function statusFor(_node: IRNode): Status {
  return "neutral";
}

import type { GraphIR, IRNode, Layout } from "../ir.ts";
import { getTheme, type Theme } from "../theme.ts";
import { resolveGlyph } from "../icons.ts";
import { resolveFields, type Field } from "../labels.ts";
import { Canvas, type Status } from "./svg.ts";

const CARD_W = 180;
const CARD_BASE = 52; // title + sub
const ROW_H = 16; // per field row
const MARGIN = 80;
const TITLE_BAND = 90;

/** Per-node override of presentation (fields shown). */
export interface NodeOverride {
  fields?: Field[];
}

export interface RenderOptions {
  title?: string;
  theme?: Theme;
  /** "portable" = native SVG text (default); "rich" = foreignObject HTML labels. */
  tier?: "portable" | "rich";
  /** Per-node presentation overrides, keyed by node id. */
  overrides?: Record<string, NodeOverride>;
  /** Ambient animation (semantic motion; reduced-motion guarded in CSS). */
  animate?: {
    /** Node ids to emphasize (pulse). */
    pulse?: string[];
    /** Animate flow direction along all edges. */
    flow?: boolean;
  };
}

/** Paint a graph IR into an SVG document, given chant's layout positions. */
export function renderSvg(ir: GraphIR, layout: Layout, opts: RenderOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const tier = opts.tier ?? "portable";
  const pulse = new Set(opts.animate?.pulse ?? []);
  const flow = opts.animate?.flow ?? false;
  // chant's --format layout gives positions as an array of {id,x,y} in Graphviz
  // space (y grows upward). Index them, then map into a px canvas with a title
  // band on top and y flipped so the graph reads top-to-bottom.
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const maxCardH = CARD_BASE + 4 * ROW_H; // size the canvas for the tallest card
  const W = Math.ceil(layout.width + CARD_W + MARGIN * 2);
  const H = Math.ceil(layout.height + maxCardH + MARGIN * 2 + TITLE_BAND);

  const place = (id: string): { cx: number; cy: number } | undefined => {
    const p = pos.get(id);
    if (!p) return undefined;
    return { cx: MARGIN + p.x, cy: MARGIN + TITLE_BAND + (layout.height - p.y) };
  };

  const c = new Canvas(W, H, theme);
  c.title(MARGIN, 56, opts.title ?? "Infrastructure", `${ir.nodes.length} resources · ${ir.edges.length} references`);

  // Edges first (connect at layout-point centers) so cards sit on top.
  for (const e of ir.edges) {
    const a = place(e.from);
    const b = place(e.to);
    if (!a || !b) continue;
    c.edge(`M ${a.cx} ${a.cy} C ${a.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${b.cy}`, 1.4, flow);
  }

  for (const node of ir.nodes) {
    const p = place(node.id);
    if (!p) continue;
    const fields = resolveFields(node, { override: opts.overrides?.[node.id]?.fields });
    const h = CARD_BASE + fields.length * ROW_H;
    const x = Math.round(p.cx - CARD_W / 2);
    const y = Math.round(p.cy - h / 2);
    const status = statusFor(node);
    const sub = `${node.kind} · ${node.lexicon}`;
    const emphasize = pulse.has(node.id);
    if (tier === "rich") {
      c.nodeCardRich(x, y, CARD_W, h, status, node.id, sub, fields, emphasize, node.id);
    } else {
      const glyph = resolveGlyph({ lexicon: node.lexicon, kind: node.kind });
      c.nodeCard(x, y, CARD_W, h, status, node.id, sub, glyph.body, fields, emphasize, node.id);
    }
  }

  return c.toString();
}

/** Placeholder status mapping. A real design system will key off kind/lexicon. */
function statusFor(_node: IRNode): Status {
  return "neutral";
}

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
const CARD_GAP = 28; // min empty space between adjacent cards
const MAX_SCALE = 10; // guard against a degenerate near-coincident pair

/**
 * How much to stretch the layout's coordinate space so fixed-size cards don't
 * overlap. A band-aid over chant's size-blind layout — see #16 / chant#509 for
 * the real fix (feed card sizes into layout). Pure; exported for testing.
 *
 * chant lays out `rankdir=TB`, so every node in a rank shares a y — the graph is
 * a stack of discrete rows. That gives a clean, non-explosive rule:
 *
 * - **Vertical**: push consecutive rows apart until they clear a card height.
 *   Any two nodes in *different* rows are then ≥ a card height apart, so they
 *   can never overlap regardless of their x.
 * - **Horizontal**: only nodes in the *same* row can collide side-to-side, so
 *   scale x by the tightest same-row neighbour pair alone.
 *
 * The earlier version tested "roughly same row" as `dy < cardHeight`, which
 * swept in adjacent-rank pairs (tiny dx, modest dy) and forced absurd horizontal
 * spread. Keying off true rows avoids that. Only grows (never below 1), capped
 * so a degenerate near-coincident pair can't blow up the canvas.
 */
export function fitScale(
  nodes: Array<{ x: number; y: number }>,
  needX: number,
  needY: number,
): { sx: number; sy: number } {
  if (nodes.length < 2) return { sx: 1, sy: 1 };
  const ROW_EPS = 1; // nodes within this y are the same rank
  let sx = 1;
  let sy = 1;

  // Horizontal: tightest same-row neighbour pair.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.abs(nodes[i].y - nodes[j].y) > ROW_EPS) continue;
      const dx = Math.abs(nodes[i].x - nodes[j].x);
      if (dx > 1) sx = Math.min(MAX_SCALE, Math.max(sx, needX / dx));
    }
  }

  // Vertical: tightest gap between consecutive distinct rows.
  const rows = [...new Set(nodes.map((n) => Math.round(n.y)))].sort((a, b) => a - b);
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i] - rows[i - 1];
    if (gap > 1) sy = Math.min(MAX_SCALE, Math.max(sy, needY / gap));
  }

  return { sx, sy };
}

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
  // dot lays out centers for its own small default node; pinhole paints big
  // fixed cards on those centers, so neighbours collide. Stretch the coordinate
  // space until the tightest conflicting pair clears a card footprint. Proper
  // fix is feeding real node sizes into layout (chant-side) — see #16.
  const { sx, sy } = fitScale(layout.nodes, CARD_W + CARD_GAP, maxCardH + CARD_GAP);
  const scaledW = layout.width * sx;
  const scaledH = layout.height * sy;
  const W = Math.ceil(scaledW + CARD_W + MARGIN * 2);
  const H = Math.ceil(scaledH + maxCardH + MARGIN * 2 + TITLE_BAND);

  const place = (id: string): { cx: number; cy: number } | undefined => {
    const p = pos.get(id);
    if (!p) return undefined;
    return { cx: MARGIN + p.x * sx, cy: MARGIN + TITLE_BAND + (scaledH - p.y * sy) };
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

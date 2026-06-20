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
const ICON_W = 104; // icon-mode node footprint
const ICON_H = 92;

/** How a node is drawn: a full "card" (icon + name + kind + fields) or "icon"
 * (a glyph badge + a truncated label only — identity at a glance for dense
 * graphs; the full name/attrs come from hover + the click popover). */
export type NodeStyle = "card" | "icon";

/** Per-node override of presentation (fields shown). */
export interface NodeOverride {
  fields?: Field[];
}

interface FootprintOptions {
  style?: NodeStyle;
  override?: NodeOverride;
}

/** A node's painted footprint, in px. The single source of truth for both the
 * layout sizes pinhole feeds chant (`--node-sizes`) and what it paints, so
 * spacing and drawing agree. Icon nodes are a fixed compact badge; card width is
 * fixed and height grows with the field rows shown. */
export function cardFootprint(node: IRNode, opts: FootprintOptions = {}): { w: number; h: number } {
  if (opts.style === "icon") return { w: ICON_W, h: ICON_H };
  const fields = resolveFields(node, { override: opts.override?.fields });
  return { w: CARD_W, h: CARD_BASE + fields.length * ROW_H };
}

/** Footprints for every node, keyed by id — the `--node-sizes` map for chant's
 * size-aware layout (#509). */
export function cardSizes(
  ir: GraphIR,
  opts: { style?: NodeStyle; overrides?: Record<string, NodeOverride> } = {},
): Record<string, { w: number; h: number }> {
  const out: Record<string, { w: number; h: number }> = {};
  for (const node of ir.nodes) {
    out[node.id] = cardFootprint(node, { style: opts.style, override: opts.overrides?.[node.id] });
  }
  return out;
}

export interface RenderOptions {
  title?: string;
  theme?: Theme;
  /** "portable" = native SVG text (default); "rich" = foreignObject HTML labels. */
  tier?: "portable" | "rich";
  /** "card" (default) or "icon" — a compact glyph + truncated label. */
  style?: NodeStyle;
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
  const style = opts.style ?? "card";
  const pulse = new Set(opts.animate?.pulse ?? []);
  const flow = opts.animate?.flow ?? false;
  // chant's --format layout gives positions as an array of {id,x,y}, y-up
  // (origin bottom-left). When pinhole passes --node-sizes (it does, via
  // cardSizes), the layout already spaces for real card footprints — no overlap,
  // nothing to post-scale (#509). Map into a px canvas with a title band on top,
  // flipping y so the graph reads top-to-bottom.
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const W = Math.ceil(layout.width + MARGIN * 2);
  const H = Math.ceil(layout.height + MARGIN * 2 + TITLE_BAND);

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
    c.edge(`M ${a.cx} ${a.cy} C ${a.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${b.cy}`, 1.4, flow, {
      from: e.from,
      to: e.to,
      via: e.viaAttr,
      toAttr: e.toAttr,
    });
  }

  for (const node of ir.nodes) {
    const p = place(node.id);
    if (!p) continue;
    const status = statusFor(node);
    const emphasize = pulse.has(node.id);
    const glyph = resolveGlyph({ lexicon: node.lexicon, kind: node.kind });

    if (style === "icon") {
      const x = Math.round(p.cx - ICON_W / 2);
      const y = Math.round(p.cy - ICON_H / 2);
      c.nodeIcon(x, y, ICON_W, ICON_H, status, node.id, glyph.body, emphasize, node.id);
      continue;
    }

    const fields = resolveFields(node, { override: opts.overrides?.[node.id]?.fields });
    const h = CARD_BASE + fields.length * ROW_H;
    const x = Math.round(p.cx - CARD_W / 2);
    const y = Math.round(p.cy - h / 2);
    const sub = `${node.kind} · ${node.lexicon}`;
    if (tier === "rich") {
      c.nodeCardRich(x, y, CARD_W, h, status, node.id, sub, fields, emphasize, node.id);
    } else {
      c.nodeCard(x, y, CARD_W, h, status, node.id, sub, glyph.body, fields, emphasize, node.id);
    }
  }

  return c.toString();
}

/** Placeholder status mapping. A real design system will key off kind/lexicon. */
function statusFor(_node: IRNode): Status {
  return "neutral";
}

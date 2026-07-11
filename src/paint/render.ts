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

/** A titled boundary region behind a group of cards (concept diagrams). Position
 * is a card *center* in the same y-up plane as the layout nodes. */
export interface GroupBox {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FootprintOptions {
  style?: NodeStyle;
  override?: NodeOverride;
  /** Content-fit width: size each card to its longest line (title / sub / field)
   * instead of the fixed grid width. For concept diagrams, whose labels are
   * descriptive phrases, not short infra names. Off by default — infra cards stay
   * a uniform grid. */
  fit?: boolean;
}

// Approx glyph advances for the fixed faces, used only to size content-fit cards.
const CH_TITLE = 8.4; // 15px/700
const CH_SUB = 5.9; //   11px
const FIT_MIN = 170;
const FIT_MAX = 420;

/** A node's painted footprint, in px. The single source of truth for both the
 * layout sizes pinhole feeds the layout engine and what it paints, so spacing and
 * drawing agree. Icon nodes are a fixed compact badge; a card's height grows with
 * its field rows, and its width is the fixed grid width unless `fit` is set, in
 * which case it grows to hold its longest line. */
export function cardFootprint(node: IRNode, opts: FootprintOptions = {}): { w: number; h: number } {
  if (opts.style === "icon") return { w: ICON_W, h: ICON_H };
  const fields = resolveFields(node, { override: opts.override?.fields });
  const h = CARD_BASE + fields.length * ROW_H;
  if (!opts.fit) return { w: CARD_W, h };
  const titleW = 46 + node.id.length * CH_TITLE + 14;
  const subW = 16 + `${node.kind} · ${node.lexicon}`.length * CH_SUB + 14;
  const fieldW = fields.reduce((m, f) => Math.max(m, 16 + `${f.label}: ${f.value}`.length * CH_SUB + 14), 0);
  const w = Math.min(FIT_MAX, Math.max(FIT_MIN, Math.ceil(Math.max(titleW, subW, fieldW))));
  return { w, h };
}

/** Footprints for every node, keyed by id — the `--node-sizes` map for chant's
 * size-aware layout (#509). */
export function cardSizes(
  ir: GraphIR,
  opts: { style?: NodeStyle; overrides?: Record<string, NodeOverride>; fit?: boolean } = {},
): Record<string, { w: number; h: number }> {
  const out: Record<string, { w: number; h: number }> = {};
  for (const node of ir.nodes) {
    out[node.id] = cardFootprint(node, { style: opts.style, override: opts.overrides?.[node.id], fit: opts.fit });
  }
  return out;
}

export interface RenderOptions {
  title?: string;
  /** Line under the title. Defaults to the infra count ("N resources · N
   * references"); concept diagrams pass their own (or "" to omit). */
  subtitle?: string;
  theme?: Theme;
  /** "portable" = native SVG text (default); "rich" = foreignObject HTML labels. */
  tier?: "portable" | "rich";
  /** "card" (default) or "icon" — a compact glyph + truncated label. */
  style?: NodeStyle;
  /** Content-fit cards (see cardFootprint). Must match the value passed to
   * cardSizes for the layout, so spacing and drawing agree. */
  fit?: boolean;
  /** Per-node presentation overrides, keyed by node id. */
  overrides?: Record<string, NodeOverride>;
  /** Drop the title band entirely — no heading, no reserved space. For embedding
   * where the surrounding context (a docs figure caption) supplies the heading. */
  hideTitle?: boolean;
  /** Titled boundary regions drawn behind the cards (concept diagrams). */
  groups?: GroupBox[];
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
  const band = opts.hideTitle ? 0 : TITLE_BAND;
  // Canvas must also hold the title band text, which can be wider than a narrow
  // graph (e.g. a 3-node stack under a long heading) — size to whichever is wider.
  const titlePx = opts.hideTitle
    ? 0
    : MARGIN + Math.max((opts.title ?? "").length * 15.6, (opts.subtitle ?? "").length * 7.5) + MARGIN;
  const W = Math.ceil(Math.max(layout.width + MARGIN * 2, titlePx));
  const H = Math.ceil(layout.height + MARGIN * 2 + band);

  const place = (id: string): { cx: number; cy: number } | undefined => {
    const p = pos.get(id);
    if (!p) return undefined;
    return { cx: MARGIN + p.x, cy: MARGIN + band + (layout.height - p.y) };
  };

  const c = new Canvas(W, H, theme);
  if (!opts.hideTitle) {
    const subtitle = opts.subtitle ?? `${ir.nodes.length} resources · ${ir.edges.length} references`;
    c.title(MARGIN, 56, opts.title ?? "Infrastructure", subtitle);
  }

  // Group boundary boxes first, so edges and cards sit on top of them.
  for (const grp of opts.groups ?? []) {
    const cx = MARGIN + grp.x;
    const cy = MARGIN + band + (layout.height - grp.y);
    c.groupBox(Math.round(cx - grp.w / 2), Math.round(cy - grp.h / 2), Math.round(grp.w), Math.round(grp.h), grp.title);
  }

  // Edges (connect at layout-point centers) so cards sit on top.
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
    const cardW = opts.fit
      ? cardFootprint(node, { style: "card", override: opts.overrides?.[node.id], fit: true }).w
      : CARD_W;
    const h = CARD_BASE + fields.length * ROW_H;
    const x = Math.round(p.cx - cardW / 2);
    const y = Math.round(p.cy - h / 2);
    const sub = [node.kind, node.lexicon].filter(Boolean).join(" · ");
    if (tier === "rich") {
      c.nodeCardRich(x, y, cardW, h, status, node.id, sub, fields, emphasize, node.id);
    } else {
      c.nodeCard(x, y, cardW, h, status, node.id, sub, glyph.body, fields, emphasize, node.id);
    }
  }

  return c.toString();
}

/** Placeholder status mapping. A real design system will key off kind/lexicon. */
function statusFor(_node: IRNode): Status {
  return "neutral";
}

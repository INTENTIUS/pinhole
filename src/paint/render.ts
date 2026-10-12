import type { GraphIR, IRNode, Layout } from "../ir.ts";
import { getTheme, type Theme } from "../theme.ts";
import { resolveGlyph, type Glyph, type GlyphSpec } from "../icons.ts";
import { resolveFields, type Field } from "../labels.ts";
import { Canvas, statusGround, type Status } from "./svg.ts";
import { edgeLanes, laneOffset } from "../edges.ts";

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
  /** Nesting depth (0 = outermost). Boxes draw outer-first so inner boxes and
   * cards sit on top. Absent = flat (depth 0). */
  depth?: number;
  /** Status tint for the box border + title (the card `_status` vocabulary).
   * `layoutArchitecture` sets it from the container node's own `_status` when
   * the container id is a real IR node; callers building boxes by hand set it
   * directly. Absent/neutral = the untinted panel. */
  status?: Status;
  /** The container's identity (`layoutArchitecture`'s `byContainer` key),
   * stamped onto the rect as `data-group-id` (pinhole#103) so downstream
   * interaction — behold's hover/click matching — can address the box
   * structurally instead of sniffing rx + sibling text. Absent for concept
   * diagrams, whose groups have no container node behind them. */
  id?: string;
  /** An identity glyph for the box, in the *node* mark vocabulary (#95): a
   * {@link GENERIC_GLYPHS} key (unknown keys degrade to "generic") or a pack's
   * own {@link GlyphSpec} geometry, `colored` if it carries its own paint.
   * Painted in the box's top-right gutter, on the title row.
   *
   * A box could be titled but never badged (pinhole#119), which left a consumer
   * that wants to mark one box out of many — behold marking the operator's own
   * namespace — with only the title to smuggle it through, and titles are
   * load-bearing (behold re-parses `namespace <ns>` to re-parent helm releases).
   * This is that channel: the same vocabulary the cards use, so a caller with a
   * pack already has the glyph.
   *
   * Monochrome geometry is stroked with the box's title colour, so it follows
   * the theme and the status tint exactly as the title does. Absent = the box
   * renders byte-identical to before this field existed. */
  mark?: string | GlyphSpec;
  /** A short piece of TEXT the box asserts about itself (pinhole#122), painted
   * on the title row at the right, in the title's colour at a lighter weight.
   *
   * `mark` badges a box with a glyph from a fixed vocabulary; some things a box
   * needs to say are a name, and a name is not a glyph. The consumer this
   * exists for is behold naming the identity an operating loop runs as on the
   * loop's own box — "who is allowed to do this", readable off the estate.
   *
   * Text rather than a title suffix, for the reason `mark` exists: titles are
   * load-bearing downstream (pinhole#119), and a consumer that re-parses one
   * would silently break. Keep it short — it shares the title row, and nothing
   * truncates it. Absent = the box renders byte-identical to before. */
  badge?: string;
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

  // Group boundary boxes first, so edges and cards sit on top. Outer-first
  // (by depth) so nested boxes (VPC ⊃ subnet) layer correctly.
  const orderedGroups = [...(opts.groups ?? [])].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  for (const grp of orderedGroups) {
    const cx = MARGIN + grp.x;
    const cy = MARGIN + band + (layout.height - grp.y);
    c.groupBox(
      Math.round(cx - grp.w / 2),
      Math.round(cy - grp.h / 2),
      Math.round(grp.w),
      Math.round(grp.h),
      grp.title,
      grp.status,
      grp.id,
      groupMark(grp),
      grp.badge,
    );
  }

  // Edges (connect at layout-point centers) so cards sit on top. Two kinds on
  // one pair (a job that both `needs` and `extends` another — #128) are two
  // lanes, drawn apart; an edge alone on its pair takes the exact path it
  // always had.
  const lanes = edgeLanes(ir.edges);
  // A node's painted rect, for keeping a parallel lane's label off the cards.
  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  const footprintAt = (id: string, p: { cx: number; cy: number }): Rect => {
    const n = nodeById.get(id);
    const f = n
      ? cardFootprint(n, { style, override: opts.overrides?.[id], fit: opts.fit })
      : { w: 0, h: 0 };
    return { x: p.cx - f.w / 2, y: p.cy - f.h / 2, w: f.w, h: f.h };
  };
  ir.edges.forEach((e, i) => {
    const a = place(e.from);
    const b = place(e.to);
    if (!a || !b) return;
    // Concept edges may carry an optional `style: "dashed"` in the IR JSON
    // (untyped in GraphIR) for optional / secondary relations.
    const dashed = (e as { style?: string }).style === "dashed";
    const rel = { from: e.from, to: e.to, via: e.viaAttr, kind: e.kind, cross: e.crossPipeline };
    const lane = lanes[i];
    let d = `M ${a.cx} ${a.cy} C ${a.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${(a.cy + b.cy) / 2}, ${b.cx} ${b.cy}`;
    let label = { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 };
    if (lane.lanes > 1) {
      const lp = lanePath(a, b, laneOffset(lane), lane, [footprintAt(e.from, a), footprintAt(e.to, b)]);
      d = lp.d;
      label = lp.label;
    }
    c.edge(d, 1.4, flow, { ...rel, toAttr: e.toAttr }, dashed);
    // Draw the relation/branch label on the edge (concept diagrams). Placed at the
    // path midpoint as a chip that cuts across the line, stamped with its edge's
    // identity (#110) so it is not an anonymous sibling. Parallel lanes stagger
    // their chips along the edge so two labels never sit on one spot.
    if (e.viaAttr) c.edgeLabel(label.x, label.y, e.viaAttr, rel);
  });

  for (const node of ir.nodes) {
    const p = place(node.id);
    if (!p) continue;
    const status = statusFor(node);
    const emphasize = pulse.has(node.id);
    // The card/badge fill is decided here, before the glyph is resolved, so the
    // pack is told the ground its mark will be painted on (#107).
    const glyph = resolveGlyph(
      { lexicon: node.lexicon, kind: node.kind },
      { ground: statusGround(status, theme) },
    );

    if (style === "icon") {
      const x = Math.round(p.cx - ICON_W / 2);
      const y = Math.round(p.cy - ICON_H / 2);
      c.nodeIcon(x, y, ICON_W, ICON_H, status, node.id, glyph, emphasize, node.id);
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
      c.nodeCard(x, y, cardW, h, status, node.id, sub, glyph, fields, emphasize, node.id);
    }
  }

  return c.toString();
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inRect = (r: Rect, x: number, y: number): boolean =>
  x > r.x - 4 && x < r.x + r.w + 4 && y > r.y - 4 && y < r.y + r.h + 4;

/** One lane of a parallel pair (#128): the pair's usual bezier shifted `off` px
 * perpendicular to the line from `a` to `b`, and a point on it for the lane's
 * label. The labels of a pair are spread evenly over the stretch of curve that
 * runs between the two cards (sampled, since the curve is a bezier), lane by
 * lane, so each chip sits on visible line and no two land on one spot. */
function lanePath(
  a: { cx: number; cy: number },
  b: { cx: number; cy: number },
  off: number,
  lane: { lane: number; lanes: number },
  cards: Rect[],
): { d: string; label: { x: number; y: number } } {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * off;
  const oy = (dx / len) * off;
  const my = (a.cy + b.cy) / 2;
  const p0 = { x: a.cx + ox, y: a.cy + oy };
  const p1 = { x: a.cx + ox, y: my + oy };
  const p2 = { x: b.cx + ox, y: my + oy };
  const p3 = { x: b.cx + ox, y: b.cy + oy };
  const at = (t: number): { x: number; y: number } => {
    const u = 1 - t;
    const k = (q: "x" | "y"): number => u * u * u * p0[q] + 3 * u * u * t * p1[q] + 3 * u * t * t * p2[q] + t * t * t * p3[q];
    return { x: k("x"), y: k("y") };
  };
  // The visible stretch: the first and last sampled t not under either card.
  const STEPS = 64;
  let t0 = 0;
  let t1 = 1;
  const clear = (t: number): boolean => {
    const p = at(t);
    return !cards.some((r) => inRect(r, p.x, p.y));
  };
  for (let i = 0; i <= STEPS; i++) if (clear(i / STEPS)) { t0 = i / STEPS; break; }
  for (let i = STEPS; i >= 0; i--) if (clear(i / STEPS)) { t1 = i / STEPS; break; }
  if (t1 <= t0) { t0 = 0; t1 = 1; }
  const label = at(t0 + ((lane.lane + 1) / (lane.lanes + 1)) * (t1 - t0));
  const pt = (p: { x: number; y: number }): string => `${r1(p.x)} ${r1(p.y)}`;
  return {
    d: `M ${pt(p0)} C ${pt(p1)}, ${pt(p2)}, ${pt(p3)}`,
    label: { x: r1(label.x), y: r1(label.y) },
  };
}

/** A box's `mark` (#119) resolved to paintable geometry, or undefined when the
 * box has none. The mark is an *override* in `resolveGlyph`'s chain, so it never
 * consults a pack or the kind heuristic — a box has no lexicon or kind of its
 * own — but an unknown key still degrades to "generic" exactly as it does on a
 * card. No `ground` is offered: the box fill is painted at `fill-opacity` 0.6,
 * so pinhole cannot honestly name what a glyph on it sits over (icons.ts,
 * IconContext.ground). Exported for the morph, which paints the same boxes. */
export function groupMark(grp: GroupBox): Glyph | undefined {
  if (grp.mark === undefined) return undefined;
  return resolveGlyph({ lexicon: "", kind: grp.id ?? grp.title }, { override: grp.mark });
}

const STATUS_VALUES = new Set<Status>(["neutral", "accent", "good", "warn", "runtime", "selected"]);

/** A node's status colour. Concept diagrams set it with a reserved `_status`
 * attr (accent / good / warn / selected) — e.g. a decision node (accent) or an
 * affected file (warn). The attr is filtered out of the visible fields upstream.
 * Exported so the layouts can read the same vocabulary off a container node
 * when they turn it into a `GroupBox`. */
export function statusFor(node: IRNode): Status {
  const s = (node.attrs as Record<string, unknown>)?._status;
  return typeof s === "string" && STATUS_VALUES.has(s as Status) ? (s as Status) : "neutral";
}

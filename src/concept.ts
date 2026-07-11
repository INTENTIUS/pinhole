import dagre from "@dagrejs/dagre";
import type { GraphIR, Layout } from "./ir.ts";
import { cardSizes, type NodeStyle, type NodeOverride } from "./paint/render.ts";

/**
 * Lay out an arbitrary graph IR locally, with dagre, so the card painter can draw
 * a *concept* diagram — a hand-authored node/edge graph that isn't a chant
 * project. The infra render path asks chant for layout (size-aware, lint-gated);
 * a concept diagram has no project behind it, so pinhole runs the same layout
 * step itself and reuses `renderSvg` unchanged. Docs diagrams (layers, pipelines,
 * fan-outs) are authored as `<name>.ir.json` and painted through here.
 *
 * The layout matches what `renderSvg` expects: node positions are card *centers*
 * in a y-up plane (origin bottom-left); `renderSvg` flips y and adds the margins
 * and title band.
 */
export interface ConceptLayoutOptions {
  /** Node style — card (default) or icon — so footprints match what's painted. */
  style?: NodeStyle;
  /** Flow direction. "TB" (default) reads top-to-bottom; "BT" puts roots at the
   * bottom (a foundation-up stack); "LR"/"RL" for wide pipelines. */
  rankdir?: "TB" | "BT" | "LR" | "RL";
  /** Rank spacing (between layers). */
  ranksep?: number;
  /** Node spacing (within a layer). */
  nodesep?: number;
  /** Per-node presentation overrides (fields), keyed by id — same object passed
   * to `renderSvg`, so footprint and drawing agree. */
  overrides?: Record<string, NodeOverride>;
  /** Content-fit card widths (default true for concept diagrams). */
  fit?: boolean;
}

export function layoutIr(ir: GraphIR, opts: ConceptLayoutOptions = {}): Layout {
  const sizes = cardSizes(ir, { style: opts.style, overrides: opts.overrides, fit: opts.fit ?? true });
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: opts.rankdir ?? "TB",
    ranksep: opts.ranksep ?? 72,
    nodesep: opts.nodesep ?? 64,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of ir.nodes) {
    const s = sizes[n.id] ?? { w: 180, h: 60 };
    g.setNode(n.id, { width: s.w, height: s.h });
  }
  for (const e of ir.edges) {
    if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to, {}, `${e.from}->${e.to}`);
  }

  dagre.layout(g);

  const gg = g.graph();
  const height = gg.height ?? 0;
  // dagre gives centers in a y-down plane; renderSvg wants y-up, so flip.
  const nodes = ir.nodes
    .filter((n) => g.hasNode(n.id))
    .map((n) => {
      const p = g.node(n.id);
      return { id: n.id, x: p.x, y: height - p.y };
    });

  return { nodes, width: gg.width ?? 0, height };
}

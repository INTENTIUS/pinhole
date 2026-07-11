import dagre from "@dagrejs/dagre";
import type { GraphIR, Layout } from "./ir.ts";
import { cardSizes, type NodeStyle, type NodeOverride, type GroupBox } from "./paint/render.ts";

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
  /** Titled groups — `{ title: [nodeIds] }`. Members are kept together (dagre
   * compound layout) and framed by a boundary box. A node may sit in one group. */
  groups?: Record<string, string[]>;
}

/** The concept layout also carries its group boxes (empty when ungrouped). */
export interface ConceptLayout extends Layout {
  groups: GroupBox[];
}

export function layoutIr(ir: GraphIR, opts: ConceptLayoutOptions = {}): ConceptLayout {
  const sizes = cardSizes(ir, { style: opts.style, overrides: opts.overrides, fit: opts.fit ?? true });
  const groupEntries = Object.entries(opts.groups ?? {}).filter(([, ids]) => ids.length > 0);
  const compound = groupEntries.length > 0;

  const g = new dagre.graphlib.Graph({ multigraph: true, compound });
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
  // Cluster nodes (prefixed so they never collide with a real id) + membership.
  const clusterId = (title: string) => `__grp__:${title}`;
  for (const [title, ids] of groupEntries) {
    const cid = clusterId(title);
    g.setNode(cid, {});
    for (const id of ids) {
      if (g.hasNode(id)) g.setParent(id, cid);
    }
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

  const groups: GroupBox[] = groupEntries
    .map(([title]) => {
      const b = g.node(clusterId(title)) as { x: number; y: number; width: number; height: number } | undefined;
      return b ? { title, x: b.x, y: height - b.y, w: b.width, h: b.height } : undefined;
    })
    .filter((b): b is GroupBox => b !== undefined);

  return { nodes, width: gg.width ?? 0, height, groups };
}

const shortKind = (kind: string): string => kind.split("::").pop() ?? kind;

/**
 * Architecture layout (chant#74): a *provisioned* IR whose `groups.byContainer`
 * (chant#779) nests resources inside their containers — VPC ⊃ subnet ⊃ resource.
 * Container nodes become **titled boundary boxes** (not cards); everything else
 * is a card inside them, wired by the reconstructed edges (chant#778). Uses
 * dagre's *nested* compound layout so a subnet box sits inside its VPC box.
 *
 * `byContainer` is `containerNodeId → [memberIds]`; a member may itself be a
 * container (the nesting). Cards are the non-container nodes.
 */
export function layoutArchitecture(
  ir: GraphIR,
  byContainer: Record<string, string[]>,
  opts: ConceptLayoutOptions = {},
): ConceptLayout {
  const containerIds = new Set(Object.keys(byContainer));
  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  // parent-of: member → its container. Depth = chain length to a root container.
  const parentOf = new Map<string, string>();
  for (const [c, members] of Object.entries(byContainer)) for (const m of members) parentOf.set(m, c);
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = id;
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
      d++;
    }
    return d;
  };

  const leaves = ir.nodes.filter((n) => !containerIds.has(n.id));
  const sizes = cardSizes({ nodes: leaves, edges: [], groups: {} }, { style: opts.style, overrides: opts.overrides, fit: opts.fit ?? true });

  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  g.setGraph({ rankdir: opts.rankdir ?? "TB", ranksep: opts.ranksep ?? 60, nodesep: opts.nodesep ?? 48, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  const cId = (id: string) => `__box__:${id}`;
  for (const n of leaves) {
    const s = sizes[n.id] ?? { w: 180, h: 60 };
    g.setNode(n.id, { width: s.w, height: s.h });
  }
  for (const c of containerIds) g.setNode(cId(c), {});
  // Nest: each member sits in its container's box (a member that's itself a
  // container nests as a sub-box).
  for (const [m, c] of parentOf) {
    const child = containerIds.has(m) ? cId(m) : m;
    if (g.hasNode(child) && g.hasNode(cId(c))) g.setParent(child, cId(c));
  }
  // Edges connect cards (leaves); references to a container box are skipped.
  for (const e of ir.edges) {
    if (leaves.some((n) => n.id === e.from) && leaves.some((n) => n.id === e.to)) {
      g.setEdge(e.from, e.to, {}, `${e.from}->${e.to}`);
    }
  }

  dagre.layout(g);
  const gg = g.graph();
  const height = gg.height ?? 0;

  const nodes = leaves
    .filter((n) => g.hasNode(n.id))
    .map((n) => {
      const p = g.node(n.id);
      return { id: n.id, x: p.x, y: height - p.y };
    });

  const groups: GroupBox[] = [...containerIds]
    .map((id): GroupBox | undefined => {
      const b = g.node(cId(id)) as { x: number; y: number; width: number; height: number } | undefined;
      if (!b) return undefined;
      const node = nodeById.get(id);
      const title = node?.kind ? `${id}  ·  ${shortKind(node.kind)}` : id;
      return { title, x: b.x, y: height - b.y, w: b.width, h: b.height, depth: depthOf(id) };
    })
    .filter((b): b is GroupBox => b !== undefined);

  return { nodes, width: gg.width ?? 0, height, groups };
}

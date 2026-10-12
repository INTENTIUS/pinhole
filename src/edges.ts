/**
 * Edge identity (pinhole#128). Since chant 0.124.18 one pair of nodes can be
 * joined by edges of different kinds — a GitLab job that both `needs` and
 * `extends` another — so `from` and `to` no longer name an edge on their own.
 * The kind is part of the identity, except for "ref": a ref edge keeps the key
 * it had before kinds existed, so every ref-only diagram, diff and layout comes
 * out exactly as it did.
 */

/** The fields that identify an edge. `kind` absent reads as "ref". */
export interface EdgeIdentity {
  from: string;
  to: string;
  kind?: string;
}

const kindSuffix = (kind: string | undefined, sep: string): string =>
  kind && kind !== "ref" ? `${sep}${kind}` : "";

/** An edge's diff key: `from>to` for a ref edge, `from>to>kind` otherwise. The
 * key `diffEdges` classifies by, and the one a consumer looks a diff status up
 * with. */
export function edgeKey(e: EdgeIdentity): string {
  return `${e.from}>${e.to}${kindSuffix(e.kind, ">")}`;
}

/** An edge's name in the layout's dagre multigraph: `from->to` for a ref edge,
 * `from->to:kind` otherwise, so two kinds on one pair are two edges to dagre. */
export function layoutEdgeName(e: EdgeIdentity): string {
  return `${e.from}->${e.to}${kindSuffix(e.kind, ":")}`;
}

/** Where an edge sits among the parallel edges of its pair. */
export interface EdgeLane {
  /** 0-based lane, in order of each kind's first appearance on the pair. */
  lane: number;
  /** How many lanes the pair has. 1 = the edge is drawn alone, as before. */
  lanes: number;
}

/**
 * The lane of each edge (same order as `edges`). Edges of one `from`→`to` pair
 * get one lane per distinct key, so a pair joined by `needs` and `extends` has
 * two lanes and is drawn as two lines. Edges sharing a key (two ref edges on one
 * pair, via different attributes) share a lane, so they still draw as one line,
 * as they always have; and a pair can only reach two lanes through a non-ref
 * kind, which keeps every ref-only diagram byte-identical.
 */
export function edgeLanes(edges: readonly EdgeIdentity[]): EdgeLane[] {
  const keysByPair = new Map<string, string[]>();
  for (const e of edges) {
    const pair = `${e.from}>${e.to}`;
    const keys = keysByPair.get(pair) ?? [];
    const k = edgeKey(e);
    if (!keys.includes(k)) keys.push(k);
    keysByPair.set(pair, keys);
  }
  return edges.map((e) => {
    const keys = keysByPair.get(`${e.from}>${e.to}`)!;
    return { lane: keys.indexOf(edgeKey(e)), lanes: keys.length };
  });
}

/** Gap between neighbouring parallel edges, in px. */
export const LANE_GAP = 18;

/** The perpendicular offset of a lane from the pair's centre line, in px. */
export function laneOffset(l: EdgeLane): number {
  return (l.lane - (l.lanes - 1) / 2) * LANE_GAP;
}

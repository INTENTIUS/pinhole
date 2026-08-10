/**
 * Graph IR types — re-exported from chant. The IR is chant's contract (emitted by
 * `chant graph --format ir`); pinhole consumes it. As of chant 0.10.0 the types
 * live in `@intentius/chant`, so pinhole imports them rather than keeping a copy.
 */
import type { GraphIR } from "@intentius/chant";

export type {
  GraphIR,
  IRNode,
  IREdge,
  IRGroups,
  IRExport,
  IRImport,
  SourceLoc,
  Layout,
  Point,
} from "@intentius/chant";

/**
 * Put the resource view's attributes back onto a composite-tier IR.
 *
 * chant 0.44 (chant#1489) made the detail dial prune each node's attribute
 * payload, not only the graph's shape: at T1 (composites) a node keeps overlay
 * paint (`_`-prefixed) and composite membership, nothing else. pinhole's
 * default altitude is T1 — the declarations the author actually wrote — and its
 * cards print a couple of short scalar fields from `attrs`, so on a bare 0.44
 * T1 IR every card comes out fieldless.
 *
 * `resource` is the T2 IR of the same project. Nodes T1 left standing get their
 * attrs back, keyed by id; the tier's own attrs win, so overlay paint survives
 * and a collapsed composite (which has no T2 counterpart under its instance id)
 * keeps the `{ members }` summary. Pure — neither input is mutated.
 */
export function withResourceAttrs(tier: GraphIR, resource: GraphIR): GraphIR {
  const attrsById = new Map(resource.nodes.map((n) => [n.id, n.attrs]));
  return {
    ...tier,
    nodes: tier.nodes.map((n) => {
      const attrs = attrsById.get(n.id);
      return attrs ? { ...n, attrs: { ...attrs, ...n.attrs } } : n;
    }),
  };
}

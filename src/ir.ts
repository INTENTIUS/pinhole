/**
 * Graph IR — the contract pinhole consumes from chant.
 *
 * These types mirror the draft schema in chant epic #492 / issue #493
 * (`chant graph --format ir`). They live here as a local copy so pinhole can be
 * built and tested before the core emitter lands. Once #493 ships and exports
 * the IR type from `@intentius/chant`, replace this file with a re-export:
 *
 *   export type { GraphIR, IRNode, IREdge } from "@intentius/chant";
 *
 * The IR is a pure function of lint-clean chant source. Every node traces to a
 * source line; every edge is a real cross-resource reference (AttrRef).
 */

/** Where in the source a node came from. */
export interface SourceLoc {
  file: string;
  line: number;
}

/** One resource in the graph. */
export interface IRNode {
  /** Logical name (the export name in chant source). */
  id: string;
  /** Resource type, e.g. "GkeCluster". */
  kind: string;
  /** Lexicon the resource belongs to, e.g. "gcp". */
  lexicon: string;
  /** Logical name of the composite this was expanded from, if any. */
  compositeParent?: string;
  /** Literal/const-resolved props, scrubbed of secrets and runtime values. */
  attrs: Record<string, unknown>;
  sourceLoc: SourceLoc;
}

/** A directed dependency: `from` references `to`. */
export interface IREdge {
  from: string;
  to: string;
  /** "ref" for an AttrRef-derived edge; future kinds for intrinsics etc. */
  kind: "ref" | string;
  /** The attribute the reference flows through, when derivable. */
  viaAttr?: string;
}

/** Grouping metadata for cluster/subgraph rendering. Maps group name -> node ids. */
export interface IRGroups {
  byLexicon?: Record<string, string[]>;
  byStack?: Record<string, string[]>;
  byComposite?: Record<string, string[]>;
}

/** The full graph IR for a project at a chosen detail level and lens. */
export interface GraphIR {
  nodes: IRNode[];
  edges: IREdge[];
  groups: IRGroups;
}

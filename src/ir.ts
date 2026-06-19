/**
 * Graph IR types — re-exported from chant. The IR is chant's contract (emitted by
 * `chant graph --format ir`); pinhole consumes it. As of chant 0.10.0 the types
 * live in `@intentius/chant`, so pinhole imports them rather than keeping a copy.
 */
export type {
  GraphIR,
  IRNode,
  IREdge,
  IRGroups,
  SourceLoc,
  Layout,
  Point,
} from "@intentius/chant";

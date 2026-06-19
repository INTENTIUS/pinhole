import type { GraphIR } from "../ir.ts";

/** A laid-out position in the layout engine's coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** The result of laying out a graph: node positions plus the bounding box. */
export interface Layout {
  /** Node id -> position. */
  nodes: Record<string, Point>;
  /** Graph width and height in the engine's coordinate space. */
  width: number;
  height: number;
}

/**
 * A layout engine turns the IR's nodes and edges into coordinates. The painter
 * consumes the result and draws — it never asks the engine to paint.
 *
 * First implementation shells out to Graphviz (`dot -Tjson`); see #497. The
 * interface exists so a pure-JS engine (elkjs / dagre) can drop in later for a
 * zero-native-dependency path — closing the install gap so the custom painter
 * works without `dot` installed.
 */
export interface LayoutEngine {
  readonly name: string;
  layout(ir: GraphIR): Promise<Layout>;
}

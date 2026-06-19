import { describe, it, expect } from "vitest";
import { toDot, parseLayout } from "./graphviz.ts";
import type { GraphIR } from "../ir.ts";

const ir: GraphIR = {
  nodes: [
    { id: "vpc", kind: "Vpc", lexicon: "gcp", attrs: {}, sourceLoc: { file: "a.ts", line: 1 } },
    { id: "subnet", kind: "Subnet", lexicon: "gcp", attrs: {}, sourceLoc: { file: "a.ts", line: 5 } },
  ],
  edges: [{ from: "subnet", to: "vpc", kind: "ref", viaAttr: "network" }],
  groups: {},
};

describe("toDot", () => {
  it("emits a node per IR node and an edge per IR edge", () => {
    const dot = toDot(ir);
    expect(dot).toContain('"vpc";');
    expect(dot).toContain('"subnet";');
    expect(dot).toContain('"subnet"->"vpc";');
  });
});

describe("parseLayout", () => {
  it("parses bounding box and node positions from dot -Tjson", () => {
    const json = JSON.stringify({
      bb: "0,0,200,300",
      objects: [
        { name: "vpc", pos: "100,280" },
        { name: "subnet", pos: "100,20" },
      ],
    });
    const layout = parseLayout(json);
    expect(layout.width).toBe(200);
    expect(layout.height).toBe(300);
    expect(layout.nodes.vpc).toEqual({ x: 100, y: 280 });
    expect(layout.nodes.subnet).toEqual({ x: 100, y: 20 });
  });

  it("throws on a malformed bounding box", () => {
    expect(() => parseLayout(JSON.stringify({ bb: "0,0", objects: [] }))).toThrow();
  });
});

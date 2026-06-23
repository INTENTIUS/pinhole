import { describe, it, expect } from "vitest";
import { diffNodes, diffTiers, deltaSummary, unionGraph } from "./diff.ts";
import type { GraphIR } from "./ir.ts";

const n = (id: string, attrs: Record<string, unknown> = {}, composite?: string) =>
  ({ id, kind: "k", lexicon: "aws", attrs, ...(composite ? { compositeInstance: composite } : {}) });

describe("diffNodes — align by id, classify", () => {
  it("classifies added / removed / changed / same", () => {
    const before = [n("keep", { x: 1 }), n("gone"), n("edit", { count: 2 })];
    const after = [n("keep", { x: 1 }), n("edit", { count: 3 }), n("new")];
    const { status, deltas } = diffNodes(before, after);
    expect(status).toEqual({ keep: "same", gone: "removed", edit: "changed", new: "added" });
    expect(deltas.edit).toEqual([{ key: "count", before: 2, after: 3 }]);
  });
});

describe("diffTiers — roll member changes up to the composite", () => {
  const beforeComp: GraphIR = { nodes: [n("app", { members: 11 }), n("net", { members: 17 })], edges: [], groups: {} };
  const afterComp: GraphIR = { nodes: [n("app", { members: 11 }), n("net", { members: 17 }), n("db", { members: 3 })], edges: [], groups: {} };
  const beforeMem: GraphIR = { nodes: [n("appService", { DesiredCount: 2 }, "app"), n("netVpc", {}, "net")], edges: [], groups: {} };
  const afterMem: GraphIR = { nodes: [n("appService", { DesiredCount: 3 }, "app"), n("netVpc", {}, "net"), n("dbDb", {}, "db")], edges: [], groups: {} };
  const d = diffTiers(beforeComp, afterComp, beforeMem, afterMem);

  it("flags a composite as changed when only a member changed (its own attrs are equal)", () => {
    // `app`'s attrs are identical ({members:11}); it's `changed` because appService changed.
    expect(d.status.app).toBe("changed");
    expect(d.status.appService).toBe("changed");
  });

  it("keeps an untouched composite same, and surfaces added composites/members", () => {
    expect(d.status.net).toBe("same");
    expect(d.status.db).toBe("added");
    expect(d.status.dbDb).toBe("added");
  });
});

describe("unionGraph — keep removed nodes on the canvas", () => {
  const before: GraphIR = { nodes: [n("keep", { x: 1 }), n("gone", { y: 9 })], edges: [{ from: "gone", to: "keep", kind: "ref", viaAttr: "R" }], groups: {} };
  const after: GraphIR = { nodes: [n("keep", { x: 2 }), n("new")], edges: [], groups: {} };
  const u = unionGraph(before, after);

  it("includes every node from either side", () => {
    expect(u.nodes.map((m) => m.id).sort()).toEqual(["gone", "keep", "new"]);
  });
  it("prefers the after version of a surviving node, carries the before version of a removed one", () => {
    expect(u.nodes.find((m) => m.id === "keep")!.attrs).toEqual({ x: 2 }); // after wins
    expect(u.nodes.find((m) => m.id === "gone")!.attrs).toEqual({ y: 9 }); // removed carried from before
  });
  it("carries a removed edge so it can be ghosted", () => {
    expect(u.edges).toContainEqual({ from: "gone", to: "keep", kind: "ref", viaAttr: "R" });
  });
});

describe("deltaSummary", () => {
  it("shows scalar before→after, and marks structural changes", () => {
    expect(deltaSummary([{ key: "DesiredCount", before: 2, after: 3 }])).toBe("DesiredCount: 2 → 3");
    expect(deltaSummary([{ key: "ContainerDefinitions", before: [1], after: [1, 2] }])).toBe("ContainerDefinitions: changed");
    expect(deltaSummary([{ key: "X", before: undefined, after: 5 }])).toBe("X: ∅ → 5");
  });
});

import { describe, it, expect } from "vitest";
import { withResourceAttrs } from "./ir.ts";
import type { GraphIR } from "./ir.ts";

const ir = (nodes: GraphIR["nodes"]): GraphIR => ({ nodes, edges: [], groups: {} });
const n = (id: string, attrs: Record<string, unknown> = {}) => ({ id, kind: "K8s::Core::Service", lexicon: "k8s", attrs });

describe("withResourceAttrs — put the resource view back on a composite-tier IR", () => {
  it("gives a surviving node the attrs chant#1489 pruned at T1", () => {
    const tier = ir([n("service"), n("pdb")]);
    const resource = ir([n("service", { name: "web", port: 80 }), n("pdb", { minAvailable: 1 })]);
    const merged = withResourceAttrs(tier, resource);
    expect(merged.nodes.map((x) => x.attrs)).toEqual([{ name: "web", port: 80 }, { minAvailable: 1 }]);
  });

  it("keeps the tier's own attrs — overlay paint and the composite summary win", () => {
    const tier = ir([n("service", { _status: "drift" }), n("network", { members: 4 })]);
    const resource = ir([n("service", { _status: "good", name: "web" })]);
    const merged = withResourceAttrs(tier, resource);
    // `network` is a collapsed composite: no T2 counterpart, so it passes through.
    expect(merged.nodes[0].attrs).toEqual({ _status: "drift", name: "web" });
    expect(merged.nodes[1].attrs).toEqual({ members: 4 });
  });

  it("is pure — neither input is mutated, and edges/groups carry over", () => {
    const tier: GraphIR = { nodes: [n("service")], edges: [{ from: "service", to: "pdb", kind: "ref" }], groups: { byLexicon: { k8s: ["service"] } } };
    const resource = ir([n("service", { name: "web" })]);
    const merged = withResourceAttrs(tier, resource);
    expect(tier.nodes[0].attrs).toEqual({});
    expect(merged.edges).toEqual(tier.edges);
    expect(merged.groups).toEqual(tier.groups);
  });
});

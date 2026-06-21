import { describe, it, expect } from "vitest";
import { composeStacks, shortStackNames } from "./compose.ts";
import type { GraphIR } from "./ir.ts";

describe("shortStackNames", () => {
  it("strips the common prefix to readable names", () => {
    expect(shortStackNames(["x/gitlab-aws-alb-infra", "x/gitlab-aws-alb-api", "x/gitlab-aws-alb-ui"])).toEqual(["infra", "api", "ui"]);
  });
  it("returns the bare basename for a single path", () => {
    expect(shortStackNames(["a/b/infra"])).toEqual(["infra"]);
  });
});

describe("composeStacks", () => {
  const a: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
      { id: "web", kind: "AWS::EC2::Instance", lexicon: "aws", attrs: { Net: { $ref: "vpc.VpcId" } } },
    ],
    edges: [{ from: "web", to: "vpc", kind: "ref", viaAttr: "VpcId" }],
    groups: {},
  };
  const b: GraphIR = { nodes: [{ id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} }], edges: [], groups: {} };
  const merged = composeStacks([{ name: "infra", ir: a }, { name: "api", ir: b }]);

  it("namespaces ids so colliding names across stacks don't clash", () => {
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(["api/vpc", "infra/vpc", "infra/web"]);
  });

  it("namespaces edge endpoints and $ref producers under their stack", () => {
    expect(merged.edges).toEqual([{ from: "infra/web", to: "infra/vpc", kind: "ref", viaAttr: "VpcId" }]);
    const web = merged.nodes.find((n) => n.id === "infra/web")!;
    expect(web.attrs.Net).toEqual({ $ref: "infra/vpc.VpcId" });
  });

  it("groups byStack so each stack renders as a boundary box", () => {
    expect(merged.groups.byStack).toEqual({ infra: ["infra/vpc", "infra/web"], api: ["api/vpc"] });
  });
});

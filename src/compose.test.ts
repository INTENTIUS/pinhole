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

describe("composeStacks — cross-stack edges (#513)", () => {
  const infra = {
    nodes: [{ id: "cluster", kind: "AWS::ECS::Cluster", lexicon: "aws", attrs: {} }],
    edges: [],
    groups: {},
    exports: [{ name: "ClusterArn", node: "cluster", attr: "Arn" }],
  } as unknown as GraphIR;
  const api: GraphIR = {
    nodes: [
      { id: "clusterArn", kind: "AWS::CloudFormation::Parameter", lexicon: "aws", attrs: {} },
      { id: "other", kind: "AWS::CloudFormation::Parameter", lexicon: "aws", attrs: {} },
    ],
    edges: [],
    groups: {},
  };
  const merged = composeStacks([{ name: "infra", ir: infra }, { name: "api", ir: api }]);

  it("links an import socket to the producing node in another stack (name match, case-insensitive)", () => {
    expect(merged.edges).toContainEqual({ from: "api/clusterArn", to: "infra/cluster", kind: "ref", viaAttr: "import" });
  });

  it("leaves an unmatched import socket unconnected", () => {
    expect(merged.edges.some((e) => e.from === "api/other")).toBe(false);
  });
});

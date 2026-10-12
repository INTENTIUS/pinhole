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

describe("composeStacks — runtimeOwner namespacing (#100)", () => {
  it("namespaces runtimeOwner when it names a node of the stack being prefixed", () => {
    const ir: GraphIR = {
      nodes: [
        { id: "appA", kind: "K8s::Apps::Deployment", lexicon: "k8s", attrs: {} },
        { id: "appA-pod-1", kind: "K8s::Core::Pod", lexicon: "k8s", attrs: {}, runtimeOwner: "appA" },
      ],
      edges: [],
      groups: {},
    };
    const merged = composeStacks([{ name: "control-plane", ir }]);
    const pod = merged.nodes.find((n) => n.id === "control-plane/appA-pod-1")!;
    expect(pod.runtimeOwner).toBe("control-plane/appA");
  });

  it("leaves a cross-stack runtimeOwner untouched — it doesn't name a node of this stack", () => {
    const ir: GraphIR = {
      nodes: [{ id: "appA-pod-1", kind: "K8s::Core::Pod", lexicon: "k8s", attrs: {}, runtimeOwner: "argoApp" }],
      edges: [],
      groups: {},
    };
    const merged = composeStacks([{ name: "control-plane", ir }]);
    const pod = merged.nodes.find((n) => n.id === "control-plane/appA-pod-1")!;
    expect(pod.runtimeOwner).toBe("argoApp");
  });

  it("leaves a node with no runtimeOwner untouched", () => {
    const ir: GraphIR = {
      nodes: [{ id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} }],
      edges: [],
      groups: {},
    };
    const merged = composeStacks([{ name: "infra", ir }]);
    const vpc = merged.nodes.find((n) => n.id === "infra/vpc")!;
    expect(vpc.runtimeOwner).toBeUndefined();
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

describe("composeStacks — CI edges, dangling refs and the other groups (#124)", () => {
  const ci: GraphIR = {
    nodes: [
      { id: "wf", kind: "GitHub::Actions::Workflow", lexicon: "github", attrs: {} },
      { id: "build", kind: "GitHub::Actions::Job", lexicon: "github", attrs: {} },
      { id: "test", kind: "GitHub::Actions::Job", lexicon: "github", attrs: {} },
    ],
    edges: [
      { from: "test", to: "build", kind: "needs", viaAttr: "needs" },
      { from: "build", to: "wf", kind: "calls", viaAttr: "uses", crossPipeline: true },
    ],
    groups: {
      byPipeline: { ci: ["wf", "build", "test"] },
      byContainer: { wf: ["build", "test"] },
      byWave: { "wave-0": ["build"], "wave-1": ["test"] },
    },
    dangling: [
      { from: "test", kind: "needs", path: "needs", value: "lint" },
      { from: "build", kind: "calls", path: "uses", value: "org/repo/.github/workflows/x.yml@main", crossPipeline: true },
    ],
  };
  const other: GraphIR = {
    nodes: [{ id: "build", kind: "GitHub::Actions::Job", lexicon: "github", attrs: {} }],
    edges: [],
    groups: { byPipeline: { ci: ["build"] } },
  };
  const merged = composeStacks([{ name: "app", ir: ci }, { name: "lib", ir: other }]);

  it("keeps each edge's kind and crossPipeline as it namespaces the endpoints", () => {
    expect(merged.edges).toEqual([
      { from: "app/test", to: "app/build", kind: "needs", viaAttr: "needs" },
      { from: "app/build", to: "app/wf", kind: "calls", viaAttr: "uses", crossPipeline: true },
    ]);
  });

  it("keeps dangling refs, namespacing `from` and leaving the written value alone", () => {
    expect(merged.dangling).toEqual([
      { from: "app/test", kind: "needs", path: "needs", value: "lint" },
      { from: "app/build", kind: "calls", path: "uses", value: "org/repo/.github/workflows/x.yml@main", crossPipeline: true },
    ]);
  });

  it("keeps byPipeline per stack, so two stacks' same-named pipelines stay apart", () => {
    expect(merged.groups.byPipeline).toEqual({ "app/ci": ["app/wf", "app/build", "app/test"], "lib/ci": ["lib/build"] });
  });

  it("keeps byContainer and byWave, keys and members prefixed", () => {
    expect(merged.groups.byContainer).toEqual({ "app/wf": ["app/build", "app/test"] });
    expect(merged.groups.byWave).toEqual({ "app/wave-0": ["app/build"], "app/wave-1": ["app/test"] });
  });

  it("adds none of them when no stack carried any", () => {
    const plain = composeStacks([{ name: "lib", ir: { ...other, groups: {} } }]);
    expect(Object.keys(plain.groups).sort()).toEqual(["byComposite", "byLexicon", "byStack"]);
    expect("dangling" in plain).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { summarizeIr, describeText } from "./inspect.ts";
import type { GraphIR } from "./ir.ts";

const ir: GraphIR = {
  nodes: [
    { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {}, compositeInstance: "net" },
    { id: "subnet", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: {}, compositeInstance: "net" },
    { id: "alb", kind: "AWS::ELBv2::LoadBalancer", lexicon: "aws", attrs: {}, compositeInstance: "app" },
    { id: "bucket", kind: "AWS::S3::Bucket", lexicon: "aws", attrs: {} },
  ],
  edges: [
    { from: "subnet", to: "vpc", kind: "ref", viaAttr: "VpcId" },
    { from: "alb", to: "subnet", kind: "ref", viaAttr: "Subnets" },
  ],
  groups: {},
};

describe("summarizeIr", () => {
  it("counts nodes, edges, lexicons, kinds, and composites", () => {
    const s = summarizeIr(ir);
    expect(s.counts.nodes).toBe(4);
    expect(s.counts.edges).toBe(2);
    expect(s.counts.byLexicon).toEqual({ aws: 4 });
    expect(s.counts.byKind["AWS::EC2::VPC"]).toBe(1);
    expect(s.counts.composites).toBe(2);
  });

  it("groups nodes by composite instance", () => {
    const s = summarizeIr(ir);
    expect(s.composites.net).toEqual(["vpc", "subnet"]);
    expect(s.composites.app).toEqual(["alb"]);
  });

  it("carries through node identity and edge wiring with attrs", () => {
    const s = summarizeIr(ir);
    expect(s.nodes[0]).toEqual({ id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", composite: "net" });
    expect(s.nodes[3]).toEqual({ id: "bucket", kind: "AWS::S3::Bucket", lexicon: "aws" }); // no composite key
    expect(s.edges[1]).toEqual({ from: "alb", to: "subnet", via: "Subnets" });
  });
});

describe("describeText", () => {
  it("renders a readable digest an agent can scan", () => {
    const text = describeText(ir);
    expect(text).toContain("4 nodes, 2 edges, 2 composites");
    expect(text).toContain("lexicons: aws:4");
    expect(text).toContain("alb  AWS::ELBv2::LoadBalancer  (app)");
    expect(text).toContain("alb → subnet  via Subnets");
    expect(text).toContain("net: vpc, subnet");
  });
});

import { describe, it, expect } from "vitest";
import { renderFlow } from "./flow.ts";
import type { GraphIR } from "./ir.ts";

const node = (id: string, kind: string) => ({ id, kind, lexicon: "aws", attrs: {} });

// VPC with a public RT (route → IGW) and a private RT (route → NAT), each
// associated to a subnet; an ALB (ingress), a service (workload), a DB (data),
// plus plumbing (IGW/NAT) that the flow lens must drop.
const ir: GraphIR = {
  nodes: [
    node("vpc", "AWS::EC2::VPC"),
    node("pubSub", "AWS::EC2::Subnet"),
    node("privSub", "AWS::EC2::Subnet"),
    node("igw", "AWS::EC2::InternetGateway"),
    node("nat", "AWS::EC2::NatGateway"),
    node("pubRt", "AWS::EC2::RouteTable"),
    node("privRt", "AWS::EC2::RouteTable"),
    node("pubRoute", "AWS::EC2::Route"),
    node("privRoute", "AWS::EC2::Route"),
    node("pubAssoc", "AWS::EC2::SubnetRouteTableAssociation"),
    node("privAssoc", "AWS::EC2::SubnetRouteTableAssociation"),
    node("alb", "AWS::ElasticLoadBalancingV2::LoadBalancer"),
    node("svc", "AWS::ECS::Service"),
    node("db", "AWS::RDS::DBInstance"),
  ],
  edges: [
    { from: "pubRoute", to: "pubRt", kind: "ref", viaAttr: "RouteTableId" },
    { from: "pubRoute", to: "igw", kind: "ref", viaAttr: "GatewayId" },
    { from: "privRoute", to: "privRt", kind: "ref", viaAttr: "RouteTableId" },
    { from: "privRoute", to: "nat", kind: "ref", viaAttr: "NatGatewayId" },
    { from: "pubAssoc", to: "pubSub", kind: "ref", viaAttr: "SubnetId" },
    { from: "pubAssoc", to: "pubRt", kind: "ref", viaAttr: "RouteTableId" },
    { from: "privAssoc", to: "privSub", kind: "ref", viaAttr: "SubnetId" },
    { from: "privAssoc", to: "privRt", kind: "ref", viaAttr: "RouteTableId" },
  ],
  groups: {},
};

describe("flow lens", () => {
  const svg = renderFlow(ir, {});

  it("lays out the request path: internet → ingress → workload → data", () => {
    expect(svg).toContain("Internet");
    expect(svg).toContain('data-node-id="alb"'); // ingress
    expect(svg).toContain('data-node-id="svc"'); // workload
    expect(svg).toContain('data-node-id="db"'); // data
    expect(svg).toContain("PUBLIC");
    expect(svg).toContain("PRIVATE");
  });

  it("drops plumbing — gateways/NAT are not flow subjects even though 'gateway' matches ingress", () => {
    expect(svg).not.toContain('data-node-id="igw"');
    expect(svg).not.toContain('data-node-id="nat"');
  });

  it("renders flow arrows (directional)", () => {
    expect(svg).toContain("marker-end=\"url(#pin-arrow)\"");
  });
});

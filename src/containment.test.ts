import { describe, it, expect } from "vitest";
import { roleForKind, renderContainment, containmentNotes, renderContainmentApp } from "./containment.ts";
import type { GraphIR } from "./ir.ts";

describe("roleForKind", () => {
  it("classifies places, policies, things, and plumbing", () => {
    expect(roleForKind("AWS::EC2::VPC")).toBe("place");
    expect(roleForKind("AWS::EC2::Subnet")).toBe("place");
    expect(roleForKind("AWS::EC2::SecurityGroup")).toBe("policy");
    expect(roleForKind("AWS::EC2::Instance")).toBe("thing");
    expect(roleForKind("AWS::S3::Bucket")).toBe("thing");
    expect(roleForKind("AWS::EC2::RouteTable")).toBe("plumbing");
    expect(roleForKind("AWS::EC2::Route")).toBe("plumbing");
    expect(roleForKind("AWS::EC2::InternetGateway")).toBe("plumbing");
    expect(roleForKind("AWS::EC2::SubnetRouteTableAssociation")).toBe("plumbing");
  });
});

// vpc ⊃ subnet ⊃ web; sg in vpc; web uses sg; routeTable is plumbing; bucket floats
const ir: GraphIR = {
  nodes: [
    { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
    { id: "subnet", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: {} },
    { id: "web", kind: "AWS::EC2::Instance", lexicon: "aws", attrs: {} },
    { id: "sg", kind: "AWS::EC2::SecurityGroup", lexicon: "aws", attrs: {} },
    { id: "routeTable", kind: "AWS::EC2::RouteTable", lexicon: "aws", attrs: {} },
    { id: "assets", kind: "AWS::S3::Bucket", lexicon: "aws", attrs: {} },
  ],
  edges: [
    { from: "subnet", to: "vpc", kind: "ref", viaAttr: "VpcId" }, // lives-in
    { from: "sg", to: "vpc", kind: "ref", viaAttr: "VpcId" }, // lives-in
    { from: "web", to: "subnet", kind: "ref", viaAttr: "SubnetId" }, // lives-in
    { from: "web", to: "sg", kind: "ref", viaAttr: "SecurityGroupIds" }, // dependency
    { from: "routeTable", to: "vpc", kind: "ref", viaAttr: "VpcId" },
  ],
  groups: {},
};

const svg = renderContainment(ir, { title: "T" });

function rectOf(id: string): { x: number; y: number; w: number; h: number } | null {
  const m = svg.match(new RegExp(`<g data-node-id="${id}"><rect x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`));
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}
const inside = (a: any, b: any) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;

describe("renderContainment", () => {
  it("drops plumbing (route table) from the diagram", () => {
    expect(svg).not.toContain('data-node-id="routeTable"');
    expect(svg).toContain('data-node-id="vpc"');
  });

  it("nests lives-in references as boxes: web ⊂ subnet ⊂ vpc", () => {
    const vpc = rectOf("vpc")!, subnet = rectOf("subnet")!, web = rectOf("web")!;
    expect(inside(subnet, vpc)).toBe(true);
    expect(inside(web, subnet)).toBe(true);
  });

  it("keeps a security group in the VPC but draws the dependency as a line", () => {
    expect(inside(rectOf("sg")!, rectOf("vpc")!)).toBe(true);
    // web → sg is a dependency (dashed line), not containment
    expect(svg).toContain('stroke-dasharray="5 5"');
  });

  it("makes the dependency lines interactive (rollover/click hooks)", () => {
    expect(svg).toContain('data-edge-from="web"');
    expect(svg).toContain('data-edge-to="sg"');
    expect(svg).toContain('pointer-events="stroke"'); // wide hit-path
  });

  it("notes what each place contains and hides (drill-in)", () => {
    const notes = containmentNotes(ir);
    expect(notes.vpc).toContainEqual({ label: "contains", value: expect.stringContaining("subnet") });
    expect(notes.vpc).toContainEqual({ label: "hides", value: "routeTable" });
  });
});

describe("composite-primary grouping", () => {
  // a net composite (VPC+subnet) and an app composite (ALB+service); the ALB
  // points at the network's subnet across composites.
  const cir: GraphIR = {
    nodes: [
      { id: "netVpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {}, compositeInstance: "net", compositeParent: "VpcDefault" },
      { id: "netSubnet", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: {}, compositeInstance: "net", compositeParent: "VpcDefault" },
      { id: "appAlb", kind: "AWS::ELBv2::LoadBalancer", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" },
      { id: "appSvc", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" },
    ],
    edges: [
      { from: "netSubnet", to: "netVpc", kind: "ref", viaAttr: "VpcId" }, // within net → nest
      { from: "appAlb", to: "netSubnet", kind: "ref", viaAttr: "Subnets" }, // cross composite → line
    ],
    groups: {},
  };
  const csvg = renderContainment(cir, {});
  const rect = (id: string) => {
    const m = csvg.match(new RegExp(`<g data-node-id="${id}"><rect x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`));
    return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
  };
  const within = (a: any, b: any) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;

  it("makes each composite a box holding its members", () => {
    expect(rect("net")).not.toBeNull();
    expect(rect("app")).not.toBeNull();
    expect(within(rect("appAlb"), rect("app"))).toBe(true);
    expect(within(rect("appSvc"), rect("app"))).toBe(true);
  });

  it("nests network lives-in within a composite (vpc ⊂ net, subnet ⊂ vpc)", () => {
    expect(within(rect("netVpc"), rect("net"))).toBe(true);
    expect(within(rect("netSubnet"), rect("netVpc"))).toBe(true);
  });

  it("draws cross-composite references as dependency lines", () => {
    expect(csvg).toContain('data-edge-from="appAlb"');
    expect(csvg).toContain('data-edge-to="netSubnet"');
  });
});

describe("renderContainmentApp (interactive expand)", () => {
  const app = renderContainmentApp(ir, { title: "T" });

  it("is a self-contained offline document with the expand engine", () => {
    expect(app.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(app).not.toContain("src=");
    expect(app).toContain("function applyState");
  });

  it("makes the VPC expandable (it hides plumbing) and reveals it on expand", () => {
    const script = app.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
    const STATES = JSON.parse(script.match(/const STATES = (\[[\s\S]*?\]);\n/)![1]);
    const EXPAND = JSON.parse(script.match(/const EXPAND = (\{[\s\S]*?\});\n/)![1]);
    expect("vpc" in EXPAND).toBe(true);
    // routeTable is hidden in the collapsed state, present once the VPC expands
    expect(STATES[0].pos.routeTable).toBeUndefined();
    expect(STATES[EXPAND.vpc].pos.routeTable).toBeDefined();
    // the plumbing leaf is drawn (once) as a movable badge
    expect(app).toContain('data-node-id="routeTable"');
  });

  it("ships a syntactically valid viewer", () => {
    const script = app.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
    expect(() => new Function(script)).not.toThrow();
  });

  it("floats a node with no lives-in parent at the top level", () => {
    const assets = rectOf("assets")!, vpc = rectOf("vpc")!;
    expect(inside(assets, vpc)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { roleForKind, renderContainment, containmentNotes, renderContainmentApp } from "./containment.ts";
import type { GraphIR } from "./ir.ts";

describe("roleForKind", () => {
  it("classifies places, policies, things, and plumbing", () => {
    expect(roleForKind("AWS::EC2::VPC")).toBe("place");
    expect(roleForKind("AWS::EC2::Subnet")).toBe("plumbing"); // collapsed into the VPC
    expect(roleForKind("AWS::EC2::SecurityGroup")).toBe("plumbing"); // drill-down only by default
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
    { from: "subnet", to: "vpc", kind: "ref", viaAttr: "VpcId" }, // lives-in (collapsed)
    { from: "sg", to: "vpc", kind: "ref", viaAttr: "VpcId" }, // lives-in (collapsed)
    { from: "web", to: "subnet", kind: "ref", viaAttr: "SubnetId" }, // lives-in → web ⊂ vpc
    { from: "web", to: "sg", kind: "ref", viaAttr: "SecurityGroupIds" }, // to hidden sg → no line
    { from: "web", to: "assets", kind: "ref", viaAttr: "BackupBucket" }, // dependency between kept things
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

  it("collapses the subnet into the VPC: web ⊂ vpc (resolved through the subnet)", () => {
    expect(svg).not.toContain('data-node-id="subnet"'); // subnet is collapsed plumbing
    expect(inside(rectOf("web")!, rectOf("vpc")!)).toBe(true);
  });

  it("hides security groups by default (drill-down only)", () => {
    expect(svg).not.toContain('data-node-id="sg"'); // not on the default diagram
    expect(rectOf("sg")).toBeNull();
  });

  it("makes the dependency lines interactive (rollover/click hooks)", () => {
    expect(svg).toContain('data-edge-from="web"');
    expect(svg).toContain('data-edge-to="assets"');
    expect(svg).toContain('pointer-events="stroke"'); // wide hit-path
  });

  it("notes what the VPC contains and hides (drill-in)", () => {
    const notes = containmentNotes(ir);
    expect(notes.vpc).toContainEqual({ label: "contains", value: expect.stringContaining("web") });
    // the collapsed subnet, route table, and security group are recoverable on expand
    const hides = notes.vpc.find((r) => r.label === "hides")!.value;
    expect(hides).toContain("subnet");
    expect(hides).toContain("routeTable");
    expect(hides).toContain("sg");
  });
});

describe("topology — incidental detection from relationship shape", () => {
  // ALB (hub: a listener points at it, it points at a SG) + the listener
  // (single-attachment component) + a target group (parked: only a VPC ref) +
  // a service (subject: points at two deps).
  const tir: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
      { id: "alb", kind: "AWS::ELBv2::LoadBalancer", lexicon: "aws", attrs: {} },
      { id: "sg", kind: "AWS::EC2::SecurityGroup", lexicon: "aws", attrs: {} },
      { id: "listener", kind: "AWS::ELBv2::Listener", lexicon: "aws", attrs: {} },
      { id: "targetGroup", kind: "AWS::ELBv2::TargetGroup", lexicon: "aws", attrs: {} },
      { id: "svc", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {} },
      { id: "cluster", kind: "AWS::ECS::Cluster", lexicon: "aws", attrs: {} },
      { id: "taskDef", kind: "AWS::ECS::TaskDefinition", lexicon: "aws", attrs: {} },
    ],
    edges: [
      { from: "alb", to: "vpc", kind: "ref", viaAttr: "Subnets" }, // alb in vpc
      { from: "alb", to: "sg", kind: "ref", viaAttr: "SecurityGroups" }, // alb → sg
      { from: "listener", to: "alb", kind: "ref", viaAttr: "LoadBalancerArn" }, // single-attachment → incidental
      { from: "targetGroup", to: "vpc", kind: "ref", viaAttr: "VpcId" }, // parked, no deps → incidental
      { from: "svc", to: "cluster", kind: "ref", viaAttr: "Cluster" }, // subject with two deps
      { from: "svc", to: "taskDef", kind: "ref", viaAttr: "TaskDefinition" },
    ],
    groups: {},
  };
  const t = renderContainment(tir, {});

  it("collapses incidental components and parked nodes (listener, target group)", () => {
    expect(t).not.toContain('data-node-id="listener"');
    expect(t).not.toContain('data-node-id="targetGroup"');
  });

  it("keeps hubs and multi-dependency subjects (alb, service)", () => {
    expect(t).toContain('data-node-id="alb"');
    expect(t).toContain('data-node-id="svc"');
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
      { id: "appSg", kind: "AWS::EC2::SecurityGroup", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" },
      { id: "appListener", kind: "AWS::ELBv2::Listener", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" },
      { id: "appSvc", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" },
    ],
    edges: [
      { from: "netSubnet", to: "netVpc", kind: "ref", viaAttr: "VpcId" }, // subnet collapses into vpc
      { from: "appAlb", to: "netSubnet", kind: "ref", viaAttr: "Subnets" }, // app's ALB spans → lives in the vpc
      { from: "appAlb", to: "appSg", kind: "ref", viaAttr: "SecurityGroups" }, // ALB → its SG (a real dependency)
      { from: "appListener", to: "appAlb", kind: "ref", viaAttr: "LoadBalancerArn" }, // listener → ALB (incidental, collapses)
    ],
    groups: {},
  };
  const csvg = renderContainment(cir, {});
  const rect = (id: string) => {
    const m = csvg.match(new RegExp(`<g data-node-id="${id}"><rect x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`));
    return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
  };
  const within = (a: any, b: any) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;

  it("encapsulates app resources in the VPC across composites (the ALB resolves through the subnet)", () => {
    expect(rect("netVpc")).not.toBeNull();
    expect(rect("netSubnet")).toBeNull(); // subnet collapsed into the VPC
    expect(within(rect("appAlb"), rect("netVpc"))).toBe(true);
  });

  it("groups a composite's networkless members into a sub-box nested in the VPC", () => {
    expect(rect("app")).not.toBeNull();
    expect(within(rect("appSvc"), rect("app"))).toBe(true); // ECS service in the app box
    expect(within(rect("app"), rect("netVpc"))).toBe(true); // …which sits inside the VPC
  });

  it("hints an implied ingress→workload edge the composite implies but the IR lacks", () => {
    // appAlb (ingress) and appSvc (workload) share the FargateAlb composite but
    // have no direct reference — draw it as an implied (dotted) edge.
    expect(csvg).toContain('data-edge-from="appAlb" data-edge-to="appSvc" data-edge-implied="1"');
  });
});

describe("renderContainmentApp (interactive expand)", () => {
  const app = renderContainmentApp(ir, { title: "T" });

  it("is a self-contained offline document with the expand engine", () => {
    expect(app.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(app).not.toContain("src=");
    expect(app).toContain("function applyState");
  });

  it("toggles the VPC between app and network views, structuring the network on drill-down", () => {
    const script = app.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
    const STATES = JSON.parse(script.match(/const STATES = (\[[\s\S]*?\]);\n/)![1]);
    const EXPAND = JSON.parse(script.match(/const EXPAND = (\{[\s\S]*?\});\n/)![1]);
    expect("vpc" in EXPAND).toBe(true); // clicking the VPC switches focus
    // the route table is collapsed in the app view, a structured box in network view
    expect(STATES[0].boxes).not.toContain('data-node-id="routeTable"');
    expect(STATES[EXPAND.vpc].boxes).toContain('data-node-id="routeTable"');
  });

  it("ships a syntactically valid viewer", () => {
    const script = app.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
    expect(() => new Function(script)).not.toThrow();
  });

  it("polishes inspector values: pretty JSON + per-value scroll + copy buttons", () => {
    expect(app).toContain("JSON.stringify(v, null, 2)");
    expect(app).toContain("class='pin-copy'");
    expect(app).toContain("function copyText");
    expect(app).toContain("max-height: 240px");
  });

  it("floats a node with no lives-in parent at the top level", () => {
    const assets = rectOf("assets")!, vpc = rectOf("vpc")!;
    expect(inside(assets, vpc)).toBe(false);
  });
});

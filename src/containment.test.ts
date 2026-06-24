import { describe, it, expect } from "vitest";
import { roleForKind, renderContainment, containmentNotes, renderContainmentApp, renderTiersApp, subtitleFor } from "./containment.ts";
import { defaultPack } from "./pack.ts";
import { composeStacks } from "./compose.ts";
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
    expect(roleForKind("AWS::ElasticLoadBalancingV2::TargetGroup")).toBe("plumbing"); // routing glue, drill-down only
    expect(roleForKind("AWS::ElasticLoadBalancingV2::ListenerRule")).toBe("plumbing");
    expect(roleForKind("AWS::ElasticLoadBalancingV2::Listener")).toBe("plumbing"); // not top-level
    expect(roleForKind("AWS::ECS::TaskDefinition")).toBe("plumbing"); // drill-into, not high-level
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

describe("headline default — only subjects + places survive (the whiteboard view)", () => {
  // A subject (service) in a place (VPC), an ingress (ALB), plus the config/glue/
  // pipeline that supports them (an IAM role, a log group, a CI job).
  const ir: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
      { id: "svc", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {} },
      { id: "alb", kind: "AWS::ElasticLoadBalancingV2::LoadBalancer", lexicon: "aws", attrs: {} },
      { id: "role", kind: "AWS::IAM::Role", lexicon: "aws", attrs: {} },
      { id: "logs", kind: "AWS::Logs::LogGroup", lexicon: "aws", attrs: {} },
      { id: "job", kind: "GitLab::CI::Job", lexicon: "gitlab", attrs: {} },
    ],
    edges: [
      { from: "svc", to: "vpc", kind: "ref", viaAttr: "VpcId" },
      { from: "svc", to: "role", kind: "ref", viaAttr: "Role" },
      { from: "svc", to: "logs", kind: "ref", viaAttr: "LogGroup" },
    ],
    groups: {},
  };
  const s = renderContainment(ir, {});

  it("keeps the subjects (workload, ingress) and their place", () => {
    expect(s).toContain('data-node-id="vpc"');
    expect(s).toContain('data-node-id="svc"');
    expect(s).toContain('data-node-id="alb"');
  });

  it("folds config, glue, and pipeline into drill-down — not drawn as cards", () => {
    for (const id of ["role", "logs", "job"]) expect(s).not.toContain(`data-node-id="${id}"`);
  });
});

describe("drop — framework config components (#38)", () => {
  const withConfig: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
      { id: "web", kind: "AWS::EC2::Instance", lexicon: "aws", attrs: {} },
      { id: "tags", kind: "chant:aws:defaultTags", lexicon: "aws", attrs: {} },
    ],
    edges: [{ from: "web", to: "vpc", kind: "ref", viaAttr: "VpcId" }],
    groups: {},
  };

  it("removes a chant: pseudo-resource entirely (not even recoverable on expand)", () => {
    const out = renderContainment(withConfig, {});
    expect(out).not.toContain('data-node-id="tags"');
    expect(out).toContain('data-node-id="vpc"');
    // it's dropped, not stashed in the VPC's hidden set
    const hides = (containmentNotes(withConfig).vpc ?? []).find((r) => r.label === "hides");
    expect(hides?.value ?? "").not.toContain("tags");
  });
});

describe("presentation pack + manual hints (#28)", () => {
  it("roleForKind honours a swapped pack (taxonomy lives in the pack)", () => {
    const pack = { ...defaultPack, roleRules: [[/widget/, "place"] as [RegExp, "place"]] };
    expect(roleForKind("Acme::Widget", "app", pack)).toBe("place");
    expect(roleForKind("AWS::EC2::VPC", "app", pack)).toBe("thing"); // custom rules replace the defaults
    expect(roleForKind("AWS::EC2::VPC", "app")).toBe("place"); // default pack unchanged
  });

  it("overrides a node's role — force-keep plumbing, force-drop a thing", () => {
    const kept = renderContainment(ir, { hints: { roles: { routeTable: "thing" } } });
    expect(kept).toContain('data-node-id="routeTable"'); // normally dropped plumbing, now kept
    const dropped = renderContainment(ir, { hints: { roles: { assets: "plumbing" } } });
    expect(dropped).not.toContain('data-node-id="assets"'); // normally a kept thing, now hidden
  });

  it("asserts a relationship the IR lacks, drawn as the implied hint", () => {
    const hir: GraphIR = {
      nodes: [
        { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
        { id: "alb", kind: "AWS::ELBv2::LoadBalancer", lexicon: "aws", attrs: {} },
        { id: "svc", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {} },
      ],
      edges: [{ from: "alb", to: "vpc", kind: "ref", viaAttr: "Subnets" }],
      groups: {},
    };
    const out = renderContainment(hir, { hints: { edges: [{ from: "alb", to: "svc" }] } });
    expect(out).toContain('data-edge-from="alb" data-edge-to="svc" data-edge-implied="1"');
  });
});

describe("subtitleFor — enriched place info-bar", () => {
  const enriched: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: { CidrBlock: "10.0.0.0/16", Region: "us-east-1" } },
      { id: "snA", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: { AvailabilityZone: "us-east-1a" } },
      { id: "snB", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: { AvailabilityZone: "us-east-1b" } },
    ],
    edges: [],
    groups: {},
  };

  it("carries CIDR, AZ spread, and region beyond the bare CIDR", () => {
    const sub = subtitleFor("vpc", enriched)!;
    expect(sub).toContain("10.0.0.0/16");
    expect(sub).toContain("2 AZs"); // distinct AZs across the subnets
    expect(sub).toContain("us-east-1");
  });

  it("shows a subnet's own AZ", () => {
    expect(subtitleFor("snA", enriched)).toContain("us-east-1a");
  });

  it("returns nothing for a node with no place attrs", () => {
    const bare: GraphIR = { nodes: [{ id: "x", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} }], edges: [], groups: {} };
    expect(subtitleFor("x", bare)).toBeUndefined();
  });
});

describe("--focus security — SGs as the subject, workload dimmed", () => {
  const sec = renderContainment(ir, { focus: "security" });

  it("reveals security groups (hidden under app focus) and accents them as the subject", () => {
    expect(sec).toContain('data-node-id="sg"');
    expect(sec).toMatch(/data-node-id="sg"><rect[^>]*stroke="var\(--pin-accentStroke/);
  });

  it("dims the workload to context", () => {
    expect(sec).toMatch(/data-node-id="web"><rect[^>]*fill-opacity="0.35"/);
  });

  it("draws the resource→SG relationship that app focus drops", () => {
    expect(sec).toContain('data-edge-from="web"');
    expect(sec).toContain('data-edge-to="sg"');
  });
});

describe("topology v2 — fixpoint folding + valuable-noun tie-break", () => {
  // A chain of generic config (not kinds the pack already silences): wrapper →
  // adapter → alb(ingress). v1 (single pass) would collapse the wrapper but leave
  // the adapter (its in-degree from the wrapper still counted). v2 recomputes
  // after each collapse, so the whole chain folds to the ingress.
  const chain: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
      { id: "alb", kind: "AWS::ELBv2::LoadBalancer", lexicon: "aws", attrs: {} },
      { id: "adapter", kind: "AWS::Acme::Adapter", lexicon: "aws", attrs: {} },
      { id: "wrapper", kind: "AWS::Acme::Wrapper", lexicon: "aws", attrs: {} },
    ],
    edges: [
      { from: "alb", to: "vpc", kind: "ref", viaAttr: "Subnets" },
      { from: "adapter", to: "alb", kind: "ref", viaAttr: "TargetArn" },
      { from: "wrapper", to: "adapter", kind: "ref", viaAttr: "AdapterArn" },
    ],
    groups: {},
  };
  const c = renderContainment(chain, {});

  it("folds a chain of single-attachment config to a fixpoint", () => {
    expect(c).not.toContain('data-node-id="wrapper"');
    expect(c).not.toContain('data-node-id="adapter"'); // v1 would have left this
    expect(c).toContain('data-node-id="alb"');
  });

  // A parked filesystem (only a containment ref, no deps). v1's parked rule would
  // collapse it; v2 protects valuable nouns so the resource the diagram is about
  // still shows.
  const valuable: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
      { id: "fs", kind: "AWS::EFS::FileSystem", lexicon: "aws", attrs: {} },
    ],
    edges: [{ from: "fs", to: "vpc", kind: "ref", viaAttr: "VpcId" }],
    groups: {},
  };

  it("protects a parked valuable noun from incidental collapse", () => {
    expect(renderContainment(valuable, {})).toContain('data-node-id="fs"');
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

  it("makes a composite box expandable to reveal its collapsed glue in place (#38 item 1)", () => {
    const appIr: GraphIR = {
      nodes: [
        { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
        { id: "alb", kind: "AWS::ELBv2::LoadBalancer", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" },
        { id: "svc", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" },
        { id: "role", kind: "AWS::IAM::Role", lexicon: "aws", attrs: {}, compositeInstance: "app", compositeParent: "FargateAlb" }, // plumbing → hidden under the app box
      ],
      edges: [{ from: "alb", to: "vpc", kind: "ref", viaAttr: "Subnets" }],
      groups: {},
    };
    const out = renderContainmentApp(appIr, {});
    const script = out.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
    const EXPAND = JSON.parse(script.match(/const EXPAND = (\{[\s\S]*?\});\n/)![1]);
    const STATES = JSON.parse(script.match(/const STATES = (\[[\s\S]*?\]);\n/)![1]);
    expect("app" in EXPAND).toBe(true); // the composite box has its own expand state
    expect(STATES[0].pos).not.toHaveProperty("role"); // collapsed in the base view
    expect(STATES[EXPAND.app].pos).toHaveProperty("role"); // revealed when the box is expanded
  });

  it("offers per-box drill-down: lists what each box collapsed (#38 item 1)", () => {
    const script = app.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
    const DRILL = JSON.parse(script.match(/const DRILL = (\{[\s\S]*?\});\n/)![1]);
    const vpcHidden = (DRILL.vpc ?? []).map((d: { id: string }) => d.id);
    // the VPC's collapsed plumbing is reachable from its inspector
    expect(vpcHidden).toContain("subnet");
    expect(vpcHidden).toContain("routeTable");
    expect(vpcHidden).toContain("sg");
    // each entry carries the kind, and the inspector renders the section
    expect((DRILL.vpc ?? [])[0]).toHaveProperty("kind");
    expect(app).toContain("DRILL[id]");
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

describe("byStack boundary boxes (#42 / chant#513 phase 1)", () => {
  const multi: GraphIR = {
    nodes: [
      { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
      { id: "web", kind: "AWS::EC2::Instance", lexicon: "aws", attrs: {} },
      { id: "deploy", kind: "GitLab::Deployment", lexicon: "gitlab", attrs: {} },
    ],
    edges: [{ from: "web", to: "vpc", kind: "ref", viaAttr: "VpcId" }],
    groups: { byStack: { aws: ["vpc", "web"], gitlab: ["deploy"] } },
  };

  it("wraps each stack's resources in a labelled boundary box", () => {
    const s = renderContainment(multi, {});
    expect(s).toContain('data-node-id="stack·aws"');
    expect(s).toContain('data-node-id="stack·gitlab"');
  });

  it("nests each resource inside its own stack box (stacks side by side)", () => {
    const s = renderContainment(multi, {});
    const rect = (id: string) => {
      const m = s.match(new RegExp(`<g data-node-id="${id}"><rect x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`));
      return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
    };
    const within = (a: any, b: any) => a && b && a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
    expect(within(rect("vpc"), rect("stack·aws"))).toBe(true);
    expect(within(rect("deploy"), rect("stack·gitlab"))).toBe(true);
    expect(within(rect("deploy"), rect("stack·aws"))).toBe(false);
  });

  it("does not wrap when there is only one stack (no boundary needed)", () => {
    const one: GraphIR = { ...multi, groups: { byStack: { aws: ["vpc", "web"] } } };
    expect(renderContainment(one, {})).not.toContain("data-node-id=\"stack·");
  });
});

describe("collapsable stack boxes (#45)", () => {
  // Each stack needs a surviving *subject* to draw a box (the headline view folds
  // pure glue away): infra exposes a shared ALB (ingress), api runs a service that
  // imports it.
  const infra = {
    nodes: [{ id: "alb", kind: "AWS::ElasticLoadBalancingV2::LoadBalancer", lexicon: "aws", attrs: {} }],
    edges: [], groups: {}, exports: [{ name: "AlbArn", node: "alb", attr: "Arn" }],
  } as unknown as GraphIR;
  const api: GraphIR = {
    nodes: [
      { id: "svc", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {} },
      { id: "albArn", kind: "AWS::CloudFormation::Parameter", lexicon: "aws", attrs: {} },
    ],
    edges: [], groups: {},
  };
  const merged = composeStacks([{ name: "infra", ir: infra }, { name: "api", ir: api }]);
  const app = renderContainmentApp(merged, {});
  const script = app.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
  const EXPAND = JSON.parse(script.match(/const EXPAND = (\{[\s\S]*?\});\n/)![1]);
  const STATES = JSON.parse(script.match(/const STATES = (\[[\s\S]*?\]);\n/)![1]);

  it("makes each stack box foldable", () => {
    expect("stack·infra" in EXPAND).toBe(true);
    expect("stack·api" in EXPAND).toBe(true);
  });

  it("folding a stack drops its contents and re-anchors its cross-stack edges to the folded box", () => {
    const folded = STATES[EXPAND["stack·infra"]];
    expect(folded.boxes).not.toContain("infra/alb"); // contents folded away
    expect(folded.edges).toContain('data-edge-to="stack·infra"'); // the api→infra/alb import re-anchors
  });
});

describe("renderTiersApp — composite tier-zoom (render chant's altitude, drill on demand)", () => {
  // What the author wrote: two composites with a dependency. Each expands to the
  // declarables it owns (the next detail tier), tagged by compositeInstance.
  const composites: GraphIR = {
    nodes: [
      { id: "app", kind: "FargateAlb", lexicon: "aws", attrs: {} },
      { id: "net", kind: "VpcDefault", lexicon: "aws", attrs: {} },
    ],
    edges: [{ from: "app", to: "net", kind: "ref", viaAttr: "vpcId" }],
    groups: {},
  };
  const members: GraphIR = {
    nodes: [
      { id: "appService", kind: "AWS::ECS::Service", lexicon: "aws", attrs: {}, compositeInstance: "app" },
      { id: "appCluster", kind: "AWS::ECS::Cluster", lexicon: "aws", attrs: {}, compositeInstance: "app" },
      { id: "netVpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {}, compositeInstance: "net" },
    ],
    edges: [{ from: "appService", to: "appCluster", kind: "ref", viaAttr: "Cluster" }],
    groups: {},
  };
  const app = renderTiersApp(composites, members, {});
  const script = app.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
  const EXPAND = JSON.parse(script.match(/const EXPAND = (\{[\s\S]*?\});\n/)![1]);
  const STATES = JSON.parse(script.match(/const STATES = (\[[\s\S]*?\]);\n/)![1]);

  it("defaults to the composite altitude — the declarations the author wrote", () => {
    expect(STATES[0].boxes).toContain('data-node-id="app"');
    expect(STATES[0].boxes).toContain('data-node-id="net"');
    // members are not on the canvas until you drill in
    expect(STATES[0].pos.appService).toBeUndefined();
  });

  it("renders a collapsed composite as a card — type + member count", () => {
    expect(STATES[0].boxes).toContain("FargateAlb"); // the composite's type
    expect(STATES[0].boxes).toContain("members"); // the drill-in affordance
  });

  it("makes each composite drillable into the resources it declares", () => {
    expect("app" in EXPAND).toBe(true);
    expect("net" in EXPAND).toBe(true);
    const drilled = STATES[EXPAND.app];
    expect(drilled.pos.appService).toBeTruthy(); // member laid out inside app
    expect(drilled.pos.appCluster).toBeTruthy();
    expect(drilled.pos.netVpc).toBeUndefined(); // other composite stays collapsed
  });

  it("infers containment structurally — a grouping ref nests, a one-off dependency ref doesn't", () => {
    const comp: GraphIR = { nodes: [{ id: "net", kind: "VpcDefault", lexicon: "aws", attrs: {} }], edges: [], groups: {} };
    const mem: GraphIR = {
      nodes: [
        { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {}, compositeInstance: "net" },
        { id: "sub1", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: {}, compositeInstance: "net" },
        { id: "sub2", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: {}, compositeInstance: "net" },
        { id: "nat", kind: "AWS::EC2::NatGateway", lexicon: "aws", attrs: {}, compositeInstance: "net" },
      ],
      edges: [
        { from: "sub1", to: "vpc", kind: "ref", viaAttr: "VpcId" }, // VpcId groups 2 subnets → containment
        { from: "sub2", to: "vpc", kind: "ref", viaAttr: "VpcId" },
        { from: "nat", to: "sub1", kind: "ref", viaAttr: "SubnetId" }, // one-off → dependency, not nesting
      ],
      groups: {},
    };
    const out = renderTiersApp(comp, mem, {});
    const sc = out.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<");
    const EX = JSON.parse(sc.match(/const EXPAND = (\{[\s\S]*?\});\n/)![1]);
    const ST = JSON.parse(sc.match(/const STATES = (\[[\s\S]*?\]);\n/)![1]);
    const d = ST[EX.net];
    expect(d.boxes).toContain('data-node-id="vpc"'); // grouping ref → the VPC is a bounding box
    expect(d.boxes).not.toContain('data-node-id="sub1"'); // one child via SubnetId ≠ a container; sub1 stays a leaf
  });
});

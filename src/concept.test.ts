import { describe, it, expect } from "vitest";
import { layoutIr, layoutArchitecture } from "./concept.ts";
import { renderSvg } from "./paint/render.ts";
import type { GraphIR } from "./ir.ts";

// A hand-authored concept graph — a 3-layer stack with descriptive labels, the
// kind of diagram that isn't a chant project (docs "philosophy layers").
const ir: GraphIR = {
  nodes: [
    { id: "Deterministic Core", kind: "the foundation", lexicon: "", attrs: { build: "discover · evaluate · serialize" } },
    { id: "The Lifecycle You Choose", kind: "per environment", lexicon: "", attrs: { dial: "observe · reconcile · apply" } },
    { id: "Agent / CI / Operator", kind: "the runtime edge", lexicon: "", attrs: {} },
  ],
  edges: [
    { from: "Deterministic Core", to: "The Lifecycle You Choose", kind: "ref" },
    { from: "The Lifecycle You Choose", to: "Agent / CI / Operator", kind: "ref" },
  ],
  groups: {},
};

describe("concept layout", () => {
  it("positions every node with real extents", () => {
    const layout = layoutIr(ir);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const n of ir.nodes) {
      expect(layout.nodes.find((p) => p.id === n.id)).toBeDefined();
    }
  });

  it("fits card width to the longest label, not the fixed grid width", () => {
    // The default (non-fit) footprint is 180; the long ids here must widen cards.
    const overrides = Object.fromEntries(
      ir.nodes.map((n) => [n.id, { fields: Object.entries(n.attrs).map(([label, value]) => ({ label, value: String(value) })) }]),
    );
    const layout = layoutIr(ir, { overrides, fit: true });
    // Three stacked layers, each one rank apart — width is a single wide card,
    // comfortably past the 180 grid width.
    expect(layout.width).toBeGreaterThan(180);
  });

  it("renders to an SVG with each label present (no truncation)", () => {
    const overrides = Object.fromEntries(
      ir.nodes.map((n) => [n.id, { fields: Object.entries(n.attrs).map(([label, value]) => ({ label, value: String(value) })) }]),
    );
    const svg = renderSvg(ir, layoutIr(ir, { overrides, fit: true }), { title: "Layers", subtitle: "core → lifecycle → edge", fit: true, overrides });
    expect(svg).toContain("Deterministic Core");
    expect(svg).toContain("The Lifecycle You Choose");
    expect(svg).toContain("Agent / CI / Operator");
    expect(svg).not.toContain("…"); // nothing ellipsized
  });

  it("hideTitle drops the heading and reclaims the band", () => {
    const layout = layoutIr(ir);
    const withTitle = renderSvg(ir, layout, { title: "Layers", subtitle: "core → edge" });
    const noTitle = renderSvg(ir, layout, { hideTitle: true });
    expect(withTitle).toContain("Layers");
    expect(noTitle).not.toContain("Layers");
    // No reserved band → a shorter canvas.
    const hOf = (svg: string) => Number(/viewBox="0 0 \d+ (\d+)"/.exec(svg)?.[1] ?? /height="(\d+)"/.exec(svg)?.[1]);
    expect(hOf(noTitle)).toBeLessThan(hOf(withTitle));
  });

  it("frames a declared group in a boundary box that contains its members", () => {
    const groups = { "digest bundle": ["The Lifecycle You Choose", "Agent / CI / Operator"] };
    const layout = layoutIr(ir, { groups });
    expect(layout.groups).toHaveLength(1);
    const box = layout.groups[0];
    expect(box.title).toBe("digest bundle");
    // Every member node sits inside the box extents (y-up centers).
    const within = (id: string) => {
      const n = layout.nodes.find((p) => p.id === id)!;
      return Math.abs(n.x - box.x) <= box.w / 2 && Math.abs(n.y - box.y) <= box.h / 2;
    };
    expect(within("The Lifecycle You Choose")).toBe(true);
    expect(within("Agent / CI / Operator")).toBe(true);
  });

  it("has no group boxes when none are declared", () => {
    expect(layoutIr(ir).groups).toHaveLength(0);
  });

  it("draws visible edge labels from viaAttr", () => {
    const labelled: GraphIR = {
      nodes: [
        { id: "Q", kind: "", lexicon: "", attrs: {} },
        { id: "A", kind: "", lexicon: "", attrs: {} },
      ],
      edges: [{ from: "Q", to: "A", kind: "ref", viaAttr: "yes — keep it" }],
      groups: {},
    };
    const svg = renderSvg(labelled, layoutIr(labelled), { hideTitle: true });
    expect(svg).toContain("yes — keep it");
  });

  it("renders a dashed edge when the edge carries style: dashed", () => {
    const g: GraphIR = {
      nodes: [
        { id: "A", kind: "", lexicon: "", attrs: {} },
        { id: "B", kind: "", lexicon: "", attrs: {} },
      ],
      edges: [{ from: "A", to: "B", kind: "ref", style: "dashed" } as GraphIR["edges"][number]],
      groups: {},
    };
    const svg = renderSvg(g, layoutIr(g), { hideTitle: true });
    expect(svg).toContain("stroke-dasharray");
  });

  it("maps a reserved _status attr to the card status token", () => {
    const decision: GraphIR = {
      nodes: [{ id: "Existing pipeline?", kind: "", lexicon: "", attrs: { _status: "accent" } }],
      edges: [],
      groups: {},
    };
    const svg = renderSvg(decision, layoutIr(decision), { hideTitle: true });
    // The accent card uses the accentStroke token; a neutral one would not.
    expect(svg).toContain("--pin-accentStroke");
  });

  it("architecture layout: containers become nested titled boxes, leaves become cards", () => {
    const arch: GraphIR = {
      nodes: [
        { id: "vpc", kind: "AWS::EC2::VPC", lexicon: "aws", attrs: {} },
        { id: "subnet", kind: "AWS::EC2::Subnet", lexicon: "aws", attrs: {} },
        { id: "sg", kind: "AWS::EC2::SecurityGroup", lexicon: "aws", attrs: {} },
        { id: "instance", kind: "AWS::EC2::Instance", lexicon: "aws", attrs: {} },
      ],
      edges: [{ from: "instance", to: "sg", kind: "ref", viaAttr: "sg" }],
      groups: {},
    };
    const byContainer = { vpc: ["subnet", "sg"], subnet: ["instance"] };
    const layout = layoutArchitecture(arch, byContainer);

    // Containers are boxes, not cards; leaves are cards.
    const cardIds = layout.nodes.map((n) => n.id).sort();
    expect(cardIds).toEqual(["instance", "sg"]);
    const boxTitles = layout.groups.map((g) => g.title.split("  ·  ")[0]).sort();
    expect(boxTitles).toEqual(["subnet", "vpc"]);

    // Nesting depth: vpc outer (0), subnet inner (1).
    const depthOf = (id: string) => layout.groups.find((g) => g.title.startsWith(id))!.depth;
    expect(depthOf("vpc")).toBe(0);
    expect(depthOf("subnet")).toBe(1);

    // The subnet box sits inside the vpc box.
    const vpc = layout.groups.find((g) => g.title.startsWith("vpc"))!;
    const subnet = layout.groups.find((g) => g.title.startsWith("subnet"))!;
    expect(subnet.w).toBeLessThan(vpc.w);
  });

  it("architecture layout: a childless container still gets a finite box, not NaN", () => {
    // A declared-but-empty namespace is a real boundary an estate renderer
    // wants to draw. Before the default dims, dagre laid the childless
    // compound node out with undefined extents and the SVG carried a NaN rect.
    const arch: GraphIR = {
      nodes: [
        { id: "cluster", kind: "K3d::Cluster", lexicon: "k3d", attrs: {} },
        { id: "web", kind: "K8s::Apps::Deployment", lexicon: "k8s", attrs: {} },
      ],
      edges: [],
      groups: {},
    };
    const byContainer = { cluster: ["namespace empty", "namespace apps"], "namespace apps": ["web"], "namespace empty": [] };
    const layout = layoutArchitecture(arch, byContainer);

    const empty = layout.groups.find((g) => g.title === "namespace empty")!;
    expect(empty).toBeDefined();
    for (const v of [empty.x, empty.y, empty.w, empty.h]) expect(Number.isFinite(v)).toBe(true);
    expect(empty.w).toBeGreaterThan(0);

    const svg = renderSvg(arch, layout, { hideTitle: true, groups: layout.groups });
    expect(svg).not.toContain("NaN");
    expect(svg).toContain("namespace empty");
  });

  it("architecture layout: a container node's _status tints its box", () => {
    const arch: GraphIR = {
      nodes: [
        { id: "cluster", kind: "AWS::EKS::Cluster", lexicon: "aws", attrs: { _status: "good" } },
        { id: "web", kind: "K8s::Apps::Deployment", lexicon: "k8s", attrs: {} },
      ],
      edges: [],
      groups: {},
    };
    const layout = layoutArchitecture(arch, { cluster: ["web"] });
    expect(layout.groups.find((g) => g.title.startsWith("cluster"))!.status).toBe("good");

    const svg = renderSvg(arch, layout, { hideTitle: true, groups: layout.groups });
    // The box border reads the good stroke token, not the neutral one.
    expect(svg).toContain("--pin-goodStroke");
  });

  it("layoutIr: a group whose members are absent from the graph lays out finite", () => {
    const g: GraphIR = {
      nodes: [{ id: "a", kind: "T", lexicon: "", attrs: {} }],
      edges: [],
      groups: {},
    };
    const layout = layoutIr(g, { groups: { ghosts: ["not-a-node"] } });
    const box = layout.groups.find((b) => b.title === "ghosts")!;
    expect(box).toBeDefined();
    for (const v of [box.x, box.y, box.w, box.h]) expect(Number.isFinite(v)).toBe(true);
  });

  it("respects rankdir (BT flips the vertical order vs TB)", () => {
    const tb = layoutIr(ir, { rankdir: "TB" });
    const bt = layoutIr(ir, { rankdir: "BT" });
    const yOf = (l: typeof tb, id: string) => l.nodes.find((n) => n.id === id)!.y;
    // The core is a root; TB and BT put it on opposite ends of the y-up plane.
    expect(Math.sign(yOf(tb, "Deterministic Core") - yOf(tb, "Agent / CI / Operator")))
      .toBe(-Math.sign(yOf(bt, "Deterministic Core") - yOf(bt, "Agent / CI / Operator")));
  });
});

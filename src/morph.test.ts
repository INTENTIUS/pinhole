import { describe, it, expect } from "vitest";
import { renderMorphHtml, type MorphView } from "./morph.ts";
import type { GraphIR } from "./ir.ts";

// detail 1: a composite "net" + a standalone "assets"
const collapsed: GraphIR = {
  nodes: [
    { id: "net", kind: "VpcDefault", lexicon: "aws", attrs: { cidr: "10.0.0.0/16" } },
    { id: "assets", kind: "Bucket", lexicon: "aws", attrs: {} },
  ],
  edges: [],
  groups: {},
};
// detail 2: the composite expanded into members; "assets" persists (same id)
const expanded: GraphIR = {
  nodes: [
    { id: "netVpc", kind: "VPC", lexicon: "aws", attrs: {} },
    { id: "netSubnet", kind: "Subnet", lexicon: "aws", attrs: {} },
    { id: "assets", kind: "Bucket", lexicon: "aws", attrs: {} },
  ],
  edges: [{ from: "netSubnet", to: "netVpc", kind: "ref", viaAttr: "VpcId" }],
  groups: {},
};

const views: MorphView[] = [
  { name: "detail 1", ir: collapsed, layout: { width: 200, height: 100, nodes: [{ id: "net", x: 60, y: 50 }, { id: "assets", x: 160, y: 50 }] } },
  { name: "detail 2", ir: expanded, layout: { width: 300, height: 200, nodes: [{ id: "netVpc", x: 80, y: 160 }, { id: "netSubnet", x: 80, y: 40 }, { id: "assets", x: 240, y: 100 }] } },
];

const html = renderMorphHtml(views, { title: "Morph" });

describe("renderMorphHtml", () => {
  it("is a self-contained offline document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).not.toContain("src=");
    expect(html).not.toMatch(/href="https?:/);
  });

  it("has a switcher button per view", () => {
    expect(html).toContain('data-view="0"');
    expect(html).toContain('data-view="1"');
    expect(html).toContain(">detail 1<");
    expect(html).toContain(">detail 2<");
  });

  it("draws each union node once (shared ids are not duplicated)", () => {
    for (const id of ["net", "assets", "netVpc", "netSubnet"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
    // "assets" is in both views but appears as a single badge
    const count = (html.match(/data-node-id="assets"/g) || []).length;
    expect(count).toBe(1);
  });

  it("embeds per-view positions and edges for the morph", () => {
    const VIEWS = JSON.parse(html.match(/const VIEWS = (\[[\s\S]*?\]);\n/)![1].replace(/\\u003c/g, "<"));
    expect(VIEWS).toHaveLength(2);
    expect(Object.keys(VIEWS[0].pos).sort()).toEqual(["assets", "net"]);
    expect(Object.keys(VIEWS[1].pos).sort()).toEqual(["assets", "netSubnet", "netVpc"]);
    expect(VIEWS[1].edges).toEqual([{ from: "netSubnet", to: "netVpc", via: "VpcId" }]);
  });

  it("ships the morph engine (FLIP transitions + edge rebuild) and the inspector", () => {
    expect(html).toContain("function applyView");
    expect(html).toContain("function buildEdges");
    expect(html).toContain(".pin-mnode { cursor: pointer; transition: transform"); // FLIP transition
    expect(html).toContain("function renderInspector");
  });

  it("carries node attrs for the inspector", () => {
    const META = JSON.parse(html.match(/const META = (\{[\s\S]*?\});\n/)![1].replace(/\\u003c/g, "<"));
    expect(META.net.kind).toBe("VpcDefault");
    expect(META.net.attrs.cidr).toBe("10.0.0.0/16");
  });

  // #81: the same engine morphs an ordered sequence of *time* frames (not just
  // detail tiers). A node present in frames 1 and 3 but absent in 2 must keep its
  // identity — animate out and back — driven by node id.
  it("morphs a time-frame sequence, preserving identity across a gap", () => {
    const frame = (nodes: string[]): GraphIR => ({
      nodes: nodes.map((id) => ({ id, kind: "K", lexicon: "aws", attrs: {} })),
      edges: [],
      groups: {},
    });
    const lay = (ids: string[]) => ({ width: 200, height: 100, nodes: ids.map((id, i) => ({ id, x: 40 + i * 60, y: 50 })) });
    const t: MorphView[] = [
      { name: "t0", ir: frame(["vpc", "sg"]), layout: lay(["vpc", "sg"]) },
      { name: "t1", ir: frame(["vpc"]), layout: lay(["vpc"]) }, // sg gone
      { name: "t2", ir: frame(["vpc", "sg"]), layout: lay(["vpc", "sg"]) }, // sg back
    ];
    const out = renderMorphHtml(t, { title: "Time" });
    const VIEWS = JSON.parse(out.match(/const VIEWS = (\[[\s\S]*?\]);\n/)![1].replace(/\\u003c/g, "<"));
    expect(VIEWS).toHaveLength(3);
    // one badge for "sg" across all frames (identity, not re-created)
    expect((out.match(/data-node-id="sg"/g) || []).length).toBe(1);
    // present at t0 and t2, absent at t1
    expect(Object.keys(VIEWS[0].pos)).toContain("sg");
    expect(Object.keys(VIEWS[1].pos)).not.toContain("sg");
    expect(Object.keys(VIEWS[2].pos)).toContain("sg");
  });
});

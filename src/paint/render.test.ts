import { describe, it, expect } from "vitest";
import { renderSvg, cardFootprint, cardSizes } from "./render.ts";
import type { GraphIR, Layout } from "../ir.ts";

const ir: GraphIR = {
  nodes: [
    { id: "vpc", kind: "Vpc", lexicon: "gcp", attrs: { region: "us-east1" } },
    { id: "subnet", kind: "Subnet", lexicon: "gcp", attrs: {} },
  ],
  edges: [{ from: "subnet", to: "vpc", kind: "ref", viaAttr: "network" }],
  groups: {},
};
const layout: Layout = {
  width: 200,
  height: 200,
  nodes: [
    { id: "vpc", x: 100, y: 180 },
    { id: "subnet", x: 100, y: 20 },
  ],
};

describe("renderSvg animation", () => {
  it("applies no animation classes by default (CSS is present, unused)", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).not.toContain('class="pin-pulse"');
    expect(svg).not.toContain('class="pin-flow"');
  });

  it("pulses highlighted nodes only", () => {
    const svg = renderSvg(ir, layout, { animate: { pulse: ["vpc"] } });
    // exactly one card group carries the pulse class
    expect(svg.match(/class="pin-pulse"/g)?.length).toBe(1);
  });

  it("animates edge flow when requested", () => {
    const svg = renderSvg(ir, layout, { animate: { flow: true } });
    expect(svg).toMatch(/class="pin-edge-line pin-flow"/);
  });

  it("always ships the reduced-motion-guarded keyframes", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).toContain("prefers-reduced-motion: no-preference");
    expect(svg).toContain("@keyframes pin-pulse");
    expect(svg).toContain("@keyframes pin-flow");
  });

  it("portable output never contains foreignObject", () => {
    const svg = renderSvg(ir, layout, { animate: { pulse: ["vpc"], flow: true } });
    expect(svg).not.toContain("foreignObject");
  });
});

describe("renderSvg edge hooks (relationship rollover)", () => {
  it("stamps each edge with its reference (from/to/via) for rollover", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).toContain('data-edge-from="subnet"');
    expect(svg).toContain('data-edge-to="vpc"');
    expect(svg).toContain('data-edge-via="network"');
  });

  it("gives each edge a transparent wide hit-path so thin lines are hoverable", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).toContain('stroke="transparent"');
    expect(svg).toContain('pointer-events="stroke"');
  });
});

describe("renderSvg node hooks", () => {
  it("stamps data-node-id on every node, in both tiers", () => {
    for (const tier of ["portable", "rich"] as const) {
      const svg = renderSvg(ir, layout, { tier });
      expect(svg).toContain('data-node-id="vpc"');
      expect(svg).toContain('data-node-id="subnet"');
    }
  });

  it("keeps the data-node-id and the pulse class together when emphasized", () => {
    const svg = renderSvg(ir, layout, { animate: { pulse: ["vpc"] } });
    expect(svg).toMatch(/data-node-id="vpc" class="pin-pulse"/);
  });
});

describe("renderSvg text fitting", () => {
  const longId = "aVeryLongResourceNameThatOverflowsTheCard";
  const longIr: GraphIR = { nodes: [{ id: longId, kind: "Vpc", lexicon: "aws", attrs: {} }], edges: [], groups: {} };
  const longLayout: Layout = { width: 200, height: 100, nodes: [{ id: longId, x: 100, y: 50 }] };

  it("ellipsizes a card title too wide for the card (portable text can't clip itself)", () => {
    const svg = renderSvg(longIr, longLayout);
    const title = svg.match(/font-weight="700">([^<]*)</)?.[1] ?? "";
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThan(longId.length);
    // the full id still rides on the hook for hover/inspect, just not as visible text
    expect(svg).toContain(`data-node-id="${longId}"`);
  });
});

describe("card sizes (the --node-sizes map for chant's layout)", () => {
  it("gives a fixed width and a height that grows with field rows", () => {
    const a = cardFootprint({ id: "a", kind: "Vpc", lexicon: "aws", attrs: {} });
    const b = cardFootprint({ id: "b", kind: "Vpc", lexicon: "aws", attrs: { region: "us-east1", cidr: "10.0.0.0/16" } });
    expect(a.w).toBe(b.w); // width is fixed
    expect(b.h).toBeGreaterThan(a.h); // more fields → taller card
  });

  it("matches the height renderSvg paints for the same node", () => {
    // cardSizes feeds the layout; the painter must draw at that same height, or
    // spacing and drawing disagree. Both derive from cardFootprint.
    const node = ir.nodes[0];
    const { h } = cardFootprint(node);
    const svg = renderSvg(ir, layout);
    expect(svg).toContain(`height="${h}"`);
  });

  it("covers every node id", () => {
    expect(Object.keys(cardSizes(ir)).sort()).toEqual(["subnet", "vpc"]);
  });

  it("honours per-node field overrides", () => {
    const base = cardFootprint(ir.nodes[0]);
    const overridden = cardFootprint(ir.nodes[0], { override: { fields: [{ label: "x", value: "1" }, { label: "y", value: "2" }] } });
    expect(overridden.h).not.toBe(base.h);
  });

  it("icon style is a fixed compact footprint, uniform across nodes", () => {
    const a = cardFootprint(ir.nodes[0], { style: "icon" });
    const b = cardFootprint({ id: "b", kind: "Vpc", lexicon: "aws", attrs: { region: "x", cidr: "y", az: "z" } }, { style: "icon" });
    expect(a).toEqual(b); // independent of attrs/fields
    expect(a.w).toBeLessThan(180); // smaller than a card
    const sizes = cardSizes(ir, { style: "icon" });
    expect(Object.values(sizes).every((s) => s.w === a.w && s.h === a.h)).toBe(true);
  });
});

describe("renderSvg icon style", () => {
  it("draws a glyph + a single truncated label, no kind/field text", () => {
    const longIr: GraphIR = {
      nodes: [{ id: "aVeryLongNodeNameToTruncate", kind: "SecurityGroup", lexicon: "aws", attrs: { region: "us-east1" } }],
      edges: [],
      groups: {},
    };
    const longLayout: Layout = { width: 200, height: 100, nodes: [{ id: "aVeryLongNodeNameToTruncate", x: 100, y: 50 }] };
    const svg = renderSvg(longIr, longLayout, { style: "icon" });
    expect(svg).toContain('text-anchor="middle"'); // centered label
    expect(svg).toContain('data-node-id="aVeryLongNodeNameToTruncate"');
    expect(svg).toContain("…"); // label truncated
    expect(svg).not.toContain("SecurityGroup · aws"); // no kind sub-label
    expect(svg).not.toContain("region"); // no fields on an icon node
  });
});

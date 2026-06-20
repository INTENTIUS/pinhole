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
    expect(svg).toContain('class="pin-flow"');
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
    const overridden = cardFootprint(ir.nodes[0], { fields: [{ label: "x", value: "1" }, { label: "y", value: "2" }] });
    expect(overridden.h).not.toBe(base.h);
  });
});

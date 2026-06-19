import { describe, it, expect } from "vitest";
import { renderSvg, fitScale } from "./render.ts";
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

describe("fitScale", () => {
  it("never shrinks (factors are >= 1)", () => {
    const { sx, sy } = fitScale([{ x: 0, y: 0 }, { x: 1000, y: 1000 }], 208, 144);
    expect(sx).toBe(1);
    expect(sy).toBe(1);
  });

  it("spreads a tight row horizontally until cards clear", () => {
    // three centers 130 apart on one row; need 208 of clearance
    const row = [{ x: 0, y: 0 }, { x: 130, y: 0 }, { x: 260, y: 0 }];
    const { sx, sy } = fitScale(row, 208, 144);
    expect(sx).toBeCloseTo(208 / 130, 5);
    expect(sy).toBe(1); // nothing stacked vertically
    // after scaling, the gap between adjacent centers covers a card width
    expect(130 * sx).toBeGreaterThanOrEqual(208);
  });

  it("spreads a tight column vertically", () => {
    const col = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
    const { sx, sy } = fitScale(col, 208, 144);
    expect(sy).toBeCloseTo(144 / 100, 5);
    expect(sx).toBe(1);
  });

  it("caps the factor for a near-coincident pair", () => {
    const { sx } = fitScale([{ x: 0, y: 0 }, { x: 2, y: 0 }], 208, 144);
    expect(sx).toBe(10); // MAX_SCALE, not 104
  });
});

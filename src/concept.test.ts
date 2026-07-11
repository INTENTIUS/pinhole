import { describe, it, expect } from "vitest";
import { layoutIr } from "./concept.ts";
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

  it("respects rankdir (BT flips the vertical order vs TB)", () => {
    const tb = layoutIr(ir, { rankdir: "TB" });
    const bt = layoutIr(ir, { rankdir: "BT" });
    const yOf = (l: typeof tb, id: string) => l.nodes.find((n) => n.id === id)!.y;
    // The core is a root; TB and BT put it on opposite ends of the y-up plane.
    expect(Math.sign(yOf(tb, "Deterministic Core") - yOf(tb, "Agent / CI / Operator")))
      .toBe(-Math.sign(yOf(bt, "Deterministic Core") - yOf(bt, "Agent / CI / Operator")));
  });
});

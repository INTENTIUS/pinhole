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

  it("respects rankdir (BT flips the vertical order vs TB)", () => {
    const tb = layoutIr(ir, { rankdir: "TB" });
    const bt = layoutIr(ir, { rankdir: "BT" });
    const yOf = (l: typeof tb, id: string) => l.nodes.find((n) => n.id === id)!.y;
    // The core is a root; TB and BT put it on opposite ends of the y-up plane.
    expect(Math.sign(yOf(tb, "Deterministic Core") - yOf(tb, "Agent / CI / Operator")))
      .toBe(-Math.sign(yOf(bt, "Deterministic Core") - yOf(bt, "Agent / CI / Operator")));
  });
});

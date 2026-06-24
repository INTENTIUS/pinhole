import { describe, it, expect } from "vitest";
import { smallMultiplesSvg, renderSmallMultiples } from "./smallmult.ts";
import { getTheme } from "./theme.ts";
import type { GraphIR } from "./ir.ts";

const comp = (ids: string[]): GraphIR => ({
  nodes: ids.map((id) => ({ id, kind: "FargateAlb", lexicon: "aws", attrs: { members: 3 } })),
  edges: [],
  groups: {},
});

describe("linked small-multiples", () => {
  // db is in staging + prod but not dev → drift.
  const panels = [
    { env: "dev", composites: comp(["app", "net"]) },
    { env: "staging", composites: comp(["app", "net", "db"]) },
    { env: "prod", composites: comp(["app", "net", "db"]) },
  ];
  const svg = smallMultiplesSvg(panels, getTheme(), "envs");

  it("renders one column per environment", () => {
    for (const e of ["dev", "staging", "prod"]) expect(svg).toContain(`>${e}<`);
  });

  it("places a composite present everywhere in every column", () => {
    expect([...svg.matchAll(/data-node-id="app"/g)]).toHaveLength(3);
  });

  it("shows a gap where a composite is missing (drift)", () => {
    // db is a card in 2 envs (staging, prod) and a dashed gap in dev.
    expect([...svg.matchAll(/data-node-id="db"/g)]).toHaveLength(2);
    expect(svg).toMatch(/stroke-dasharray="3 5"/); // the gap cell
  });

  it("wraps in an interactive artifact with synced-hover JS", () => {
    const html = renderSmallMultiples(panels, {});
    expect(html).toContain("pin-hl");
    expect(html).toContain("mouseover");
  });
});

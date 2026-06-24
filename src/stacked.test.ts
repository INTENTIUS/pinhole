import { describe, it, expect } from "vitest";
import { renderStacked } from "./stacked.ts";
import type { GraphIR } from "./ir.ts";

const comp = (ids: string[]): GraphIR => ({
  nodes: ids.map((id) => ({ id, kind: "FargateAlb", lexicon: "aws", attrs: { members: 3 } })),
  edges: [],
  groups: {},
});

describe("renderStacked — deployment-drift tie-lines", () => {
  // dev has app + net; prod adds db, changes app, keeps net.
  const base = { env: "dev", composites: comp(["app", "net"]) };
  const target = { env: "prod", composites: comp(["app", "net", "db"]) };
  const status = { app: "changed", net: "same", db: "added" } as const;
  const svg = renderStacked(base, target, status, {});

  it("labels both environment planes", () => {
    expect(svg).toContain(">dev<");
    expect(svg).toContain(">prod<");
  });

  it("tints cards by drift status", () => {
    expect(svg).toContain('data-node-id="db" data-diff="added"');
    expect(svg).toContain('data-node-id="app" data-diff="changed"');
  });

  it("ties only the composites present in both planes — a missing tie is the drift", () => {
    const ties = [...svg.matchAll(/data-tie="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(ties).toEqual(["app", "net"]); // app + net tie across planes; db (added) has no tie
  });
});

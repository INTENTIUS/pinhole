import { describe, it, expect } from "vitest";
import { layoutIr } from "./concept.ts";
import { renderSvg, type GroupBox } from "./paint/render.ts";
import { composeStacks } from "./compose.ts";
import type { GraphIR } from "./ir.ts";

// #125: pipelines boxed inside the stack boxes of a composed estate.
const job = (id: string) => ({ id, kind: "GitLab::CI::Job", lexicon: "gitlab", attrs: {} });
const res = (id: string) => ({ id, kind: "AWS::S3::Bucket", lexicon: "aws", attrs: {} });
const estate: GraphIR = composeStacks([
  {
    name: "web",
    ir: {
      nodes: [job("build"), job("deploy"), job("lint"), job("audit"), res("site")],
      edges: [
        { from: "deploy", to: "build", kind: "needs" },
        { from: "audit", to: "lint", kind: "needs" },
        { from: "deploy", to: "site", kind: "ref" },
      ],
      groups: { byPipeline: { app: ["build", "deploy"], checks: ["lint", "audit"] } },
    },
  },
  {
    name: "api",
    ir: {
      nodes: [job("build"), job("deploy"), res("fn")],
      edges: [
        { from: "deploy", to: "build", kind: "needs" },
        { from: "deploy", to: "fn", kind: "ref" },
      ],
      groups: { byPipeline: { release: ["build", "deploy"] } },
    },
  },
]);
const byStack = estate.groups.byStack as Record<string, string[]>;
const byPipeline = estate.groups.byPipeline!;

// Box edges in the y-up layout plane.
const edges = (b: { x: number; y: number; w: number; h: number }) => ({
  l: b.x - b.w / 2,
  r: b.x + b.w / 2,
  b: b.y - b.h / 2,
  t: b.y + b.h / 2,
});
const overlaps = (p: GroupBox, q: GroupBox) => {
  const a = edges(p), c = edges(q);
  return a.l < c.r && c.l < a.r && a.b < c.t && c.b < a.t;
};

describe("layoutIr subgroups (#125)", () => {
  for (const rankdir of ["TB", "LR"] as const) {
    describe(rankdir, () => {
      const L = layoutIr(estate, { rankdir, groups: byStack, subgroups: byPipeline });
      const outer = L.groups.filter((g) => g.depth === undefined);
      const inner = L.groups.filter((g) => g.depth === 1);

      it("returns the outer boxes as before and one nested box per pipeline", () => {
        expect(outer.map((g) => g.id)).toEqual(["web", "api"]);
        expect(inner.map((g) => [g.id, g.parent])).toEqual([
          ["web/app", "web"],
          ["web/checks", "web"],
          ["api/release", "api"],
        ]);
      });

      it("draws each pipeline box inside its stack box, below the stack's title row", () => {
        for (const box of inner) {
          const o = edges(outer.find((g) => g.id === box.parent)!);
          const i = edges(box);
          expect(i.l).toBeGreaterThan(o.l);
          expect(i.r).toBeLessThan(o.r);
          expect(i.b).toBeGreaterThan(o.b);
          // y is up: the outer title row is the top 30px of the outer box.
          expect(o.t - i.t).toBeGreaterThanOrEqual(30);
        }
      });

      it("overlaps no box with a sibling", () => {
        expect(overlaps(outer[0], outer[1])).toBe(false);
        for (let a = 0; a < inner.length; a++) for (let b = a + 1; b < inner.length; b++) expect(overlaps(inner[a], inner[b])).toBe(false);
      });

      it("puts each pipeline's cards inside its box", () => {
        const at = new Map(L.nodes.map((n) => [n.id, n]));
        for (const box of inner) {
          const e = edges(box);
          for (const id of byPipeline[box.id!]) {
            const p = at.get(id)!;
            expect(p.x > e.l && p.x < e.r && p.y > e.b && p.y < e.t).toBe(true);
          }
        }
      });
    });
  }

  it("paints the nested boxes over their stack boxes, with their keys as data-group-id", () => {
    const L = layoutIr(estate, { groups: byStack, subgroups: byPipeline });
    const svg = renderSvg(estate, L, { groups: L.groups });
    const order = [...svg.matchAll(/data-group-id="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["web", "api", "web/app", "web/checks", "api/release"]);
  });

  it("is exactly the flat layout when subgroups are absent or empty", () => {
    const flat = layoutIr(estate, { groups: byStack });
    expect(layoutIr(estate, { groups: byStack, subgroups: {} })).toEqual(flat);
    expect(layoutIr(estate, { groups: byStack, subgroups: { none: [] } })).toEqual(flat);
    expect(renderSvg(estate, layoutIr(estate, { groups: byStack, subgroups: {} }), { groups: flat.groups })).toBe(
      renderSvg(estate, flat, { groups: flat.groups }),
    );
  });

  it("nests a subgroup in the box holding most of its members and leaves the rest where they were", () => {
    const L = layoutIr(estate, {
      groups: byStack,
      subgroups: { mixed: ["web/build", "web/deploy", "api/fn"] },
    });
    const mixed = L.groups.find((g) => g.id === "mixed")!;
    expect(mixed.parent).toBe("web");
    const e = edges(mixed);
    const fn = L.nodes.find((n) => n.id === "api/fn")!;
    expect(fn.x > e.l && fn.x < e.r && fn.y > e.b && fn.y < e.t).toBe(false);
    const api = edges(L.groups.find((g) => g.id === "api")!);
    expect(fn.x > api.l && fn.x < api.r && fn.y > api.b && fn.y < api.t).toBe(true);
  });

  it("lays a subgroup out as a top-level box when no outer group holds its members", () => {
    const L = layoutIr(estate, { subgroups: { "web/app": byPipeline["web/app"] } });
    expect(L.groups).toHaveLength(1);
    expect(L.groups[0].depth).toBeUndefined();
    expect(L.groups[0].parent).toBeUndefined();
  });

  it("skips a subgroup none of whose members is in the graph", () => {
    const L = layoutIr(estate, { groups: byStack, subgroups: { gone: ["nope"] } });
    expect(L.groups.map((g) => g.id)).toEqual(["web", "api"]);
  });
});

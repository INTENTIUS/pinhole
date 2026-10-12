import { describe, it, expect } from "vitest";
import { edgeKey, layoutEdgeName, edgeLanes, laneOffset, LANE_GAP } from "./edges.ts";
import { layoutIr } from "./concept.ts";
import { renderSvg } from "./paint/render.ts";
import { renderMorphHtml } from "./morph.ts";
import type { GraphIR } from "./ir.ts";

const node = (id: string) => ({ id, kind: "job", lexicon: "gitlab", attrs: {} });

// A GitLab job that both `needs` and `extends` another (#128).
const twoKinds: GraphIR = {
  nodes: [node("deploy"), node("build")],
  edges: [
    { from: "deploy", to: "build", kind: "needs", viaAttr: "needs" },
    { from: "deploy", to: "build", kind: "extends", viaAttr: "extends" },
  ],
  groups: {},
};

describe("edge identity (#128)", () => {
  it("keeps a ref edge's keys exactly as before kinds existed", () => {
    expect(edgeKey({ from: "a", to: "b", kind: "ref" })).toBe("a>b");
    expect(edgeKey({ from: "a", to: "b" })).toBe("a>b");
    expect(layoutEdgeName({ from: "a", to: "b", kind: "ref" })).toBe("a->b");
    expect(layoutEdgeName({ from: "a", to: "b" })).toBe("a->b");
  });

  it("adds the kind for any other kind, so two kinds on a pair are two keys", () => {
    expect(edgeKey({ from: "a", to: "b", kind: "needs" })).toBe("a>b>needs");
    expect(layoutEdgeName({ from: "a", to: "b", kind: "extends" })).toBe("a->b:extends");
    expect(edgeKey(twoKinds.edges[0])).not.toBe(edgeKey(twoKinds.edges[1]));
  });
});

describe("edgeLanes", () => {
  it("gives each kind on a pair its own lane", () => {
    expect(edgeLanes(twoKinds.edges)).toEqual([{ lane: 0, lanes: 2 }, { lane: 1, lanes: 2 }]);
  });

  it("keeps edges that share a key (two refs on one pair) in one lane", () => {
    const refs = [
      { from: "a", to: "b", kind: "ref" },
      { from: "a", to: "b", kind: "ref" },
      { from: "b", to: "a", kind: "ref" },
    ];
    expect(edgeLanes(refs).every((l) => l.lanes === 1)).toBe(true);
  });

  it("centres the lanes on the pair's line", () => {
    const [a, b] = edgeLanes(twoKinds.edges);
    expect(laneOffset(a)).toBe(-LANE_GAP / 2);
    expect(laneOffset(b)).toBe(LANE_GAP / 2);
    expect(laneOffset({ lane: 1, lanes: 3 })).toBe(0);
  });
});

const chips = (svg: string) =>
  [...svg.matchAll(/<g data-edge-from="[^"]*" data-edge-to="[^"]*"[^>]*><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="(\d+)" rx="9"/g)].map(
    (m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }),
  );
const paths = (svg: string) => [...svg.matchAll(/<path class="pin-edge-line" d="([^"]+)"/g)].map((m) => m[1]);

describe("parallel edges render apart (#128)", () => {
  for (const rankdir of ["TB", "LR"] as const) {
    it(`draws two kinds on one pair as two lines with non-overlapping labels (${rankdir})`, () => {
      const svg = renderSvg(twoKinds, layoutIr(twoKinds, { rankdir }), { hideTitle: true });
      const [p, q] = paths(svg);
      expect(p).toBeDefined();
      expect(q).toBeDefined();
      expect(p).not.toBe(q);
      // Both start points sit LANE_GAP apart.
      const start = (d: string) => d.match(/^M ([\d.-]+) ([\d.-]+)/)!.slice(1).map(Number);
      const [x1, y1] = start(p);
      const [x2, y2] = start(q);
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(LANE_GAP, 0);
      const [c1, c2] = chips(svg);
      const overlap = c1.x < c2.x + c2.w && c2.x < c1.x + c1.w && c1.y < c2.y + c2.h && c2.y < c1.y + c1.h;
      expect(overlap).toBe(false);
      expect(svg).toContain(`data-edge-kind="needs"`);
      expect(svg).toContain(`data-edge-kind="extends"`);
    });
  }

  for (const rankdir of ["TB", "LR"] as const) {
    it(`keeps three lanes' labels apart and off the cards (${rankdir})`, () => {
      const three: GraphIR = {
        ...twoKinds,
        edges: [...twoKinds.edges, { from: "deploy", to: "build", kind: "includes", viaAttr: "includes" }],
      };
      const L = layoutIr(three, { rankdir });
      const svg = renderSvg(three, L, { hideTitle: true });
      const cs = chips(svg);
      expect(cs).toHaveLength(3);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          const [p, q] = [cs[i], cs[j]];
          expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false);
        }
      // Each chip's centre is off both cards.
      const cards = [...svg.matchAll(/<g[^>]*data-node-id="[^"]*"[^>]*>\s*<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)].map((m) => m.slice(1).map(Number));
      expect(cards).toHaveLength(2);
      for (const c of cs) {
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        for (const [x, y, w, h] of cards) expect(cx > x && cx < x + w && cy > y && cy < y + h).toBe(false);
      }
    });
  }

  it("leaves a single-kind pair on its exact old path", () => {
    const one: GraphIR = { ...twoKinds, edges: [twoKinds.edges[0]] };
    const L = layoutIr(one);
    const svg = renderSvg(one, L, { hideTitle: true });
    const [a, b] = L.nodes;
    // renderSvg's plane: MARGIN 80, y flipped.
    const ay = 80 + (L.height - a.y), by = 80 + (L.height - b.y);
    const ax = 80 + a.x, bx = 80 + b.x;
    expect(paths(svg)[0]).toBe(`M ${ax} ${ay} C ${ax} ${(ay + by) / 2}, ${bx} ${(ay + by) / 2}, ${bx} ${by}`);
  });

  it("the morph shifts a parallel lane and leaves a lone edge's data unchanged", () => {
    const html = renderMorphHtml([{ name: "v", ir: twoKinds, layout: layoutIr(twoKinds) }]);
    expect(html).toContain(`"kind":"needs","off":-9`);
    expect(html).toContain(`"kind":"extends","off":9`);
    const lone = renderMorphHtml([{ name: "v", ir: { ...twoKinds, edges: [twoKinds.edges[0]] }, layout: layoutIr(twoKinds) }]);
    expect(lone).not.toContain(`"off"`);
  });
});

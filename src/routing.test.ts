import { describe, it, expect } from "vitest";
import { borderAnchor, segHitsRect, routeEdge } from "./containment.ts";

// Build a minimal Layout from a set of {id: rect}.
function layoutOf(rects: Record<string, { x: number; y: number; w: number; h: number }>) {
  const X: Record<string, number> = {}, Y: Record<string, number> = {}, W: Record<string, number> = {}, H: Record<string, number> = {};
  for (const [id, r] of Object.entries(rects)) { X[id] = r.x; Y[id] = r.y; W[id] = r.w; H[id] = r.h; }
  return { X, Y, W, H, pack: {} };
}

// Parse "M x y C x1 y1, x2 y2, x3 y3" and sample the cubic at N points.
function sampleCubic(d: string, n = 40): Array<{ x: number; y: number }> {
  const nums = d.match(/-?[\d.]+/g)!.map(Number);
  const [ax, ay, c1x, c1y, c2x, c2y, bx, by] = nums;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx,
      y: u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by,
    });
  }
  return pts;
}
const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }, pad = 0) =>
  p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad;

describe("borderAnchor", () => {
  const r = { x: 0, y: 0, w: 100, h: 40 }; // center (50, 20)

  it("lands on the border facing the target", () => {
    expect(borderAnchor(r, { x: 50, y: 200 })).toEqual({ x: 50, y: 40 }); // straight down → bottom edge
    expect(borderAnchor(r, { x: 50, y: -200 })).toEqual({ x: 50, y: 0 }); // straight up → top edge
    expect(borderAnchor(r, { x: 300, y: 20 })).toEqual({ x: 100, y: 20 }); // right → right edge
  });

  it("never returns a point inside the rect", () => {
    const p = borderAnchor(r, { x: 180, y: 120 });
    const onBorder = p.x === 0 || p.x === 100 || p.y === 0 || p.y === 40;
    expect(onBorder).toBe(true);
  });
});

describe("segHitsRect", () => {
  const box = { x: 40, y: 40, w: 40, h: 40 }; // spans x∈[40,80], y∈[40,80]

  it("detects a segment passing through the box", () => {
    expect(segHitsRect({ x: 0, y: 60 }, { x: 200, y: 60 }, box)).toBe(true); // horizontal through middle
    expect(segHitsRect({ x: 60, y: 0 }, { x: 60, y: 200 }, box)).toBe(true); // vertical through middle
  });

  it("clears a segment that misses the box", () => {
    expect(segHitsRect({ x: 0, y: 0 }, { x: 30, y: 0 }, box)).toBe(false); // well above-left
    expect(segHitsRect({ x: 0, y: 200 }, { x: 200, y: 200 }, box)).toBe(false); // below
  });

  it("respects the pad: a near-miss counts as a hit when grown", () => {
    const justBelow = [{ x: 0, y: 92 }, { x: 200, y: 92 }] as const; // 12px under the box
    expect(segHitsRect(justBelow[0], justBelow[1], box)).toBe(false);
    expect(segHitsRect(justBelow[0], justBelow[1], box, 16)).toBe(true);
  });
});

describe("routeEdge", () => {
  it("draws a simple curve when nothing blocks", () => {
    const L = layoutOf({ a: { x: 0, y: 0, w: 80, h: 40 }, b: { x: 0, y: 200, w: 80, h: 40 } });
    const obstacle = { x: 300, y: 100, w: 80, h: 40 }; // off to the side, not between
    const pts = sampleCubic(routeEdge("a", "b", L, [obstacle]));
    expect(pts.every((p) => !inside(p, obstacle))).toBe(true);
  });

  it("clears an obstacle straddled horizontally by the endpoints (arc over/under)", () => {
    // a (left) and b (right) flank an obstacle in the middle — a side bow can't
    // help; the route must arc over or under it.
    const L = layoutOf({ a: { x: 0, y: 100, w: 80, h: 40 }, b: { x: 400, y: 100, w: 80, h: 40 } });
    const obstacle = { x: 180, y: 90, w: 120, h: 60 };
    const pts = sampleCubic(routeEdge("a", "b", L, [obstacle]));
    expect(pts.every((p) => !inside(p, obstacle, -1))).toBe(true);
  });

  it("clears an obstacle between vertically-stacked endpoints (side bow)", () => {
    const L = layoutOf({ a: { x: 0, y: 0, w: 80, h: 40 }, b: { x: 0, y: 300, w: 80, h: 40 } });
    const obstacle = { x: -30, y: 140, w: 90, h: 60 }; // directly between, on the centerline
    const pts = sampleCubic(routeEdge("a", "b", L, [obstacle]));
    expect(pts.every((p) => !inside(p, obstacle, -1))).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { borderAnchor, segHitsRect } from "./containment.ts";

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

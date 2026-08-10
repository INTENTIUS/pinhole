import { describe, it, expect } from "vitest";
import { glyphMarkup } from "./svg.ts";

const BODY = `<rect x="4" y="4" width="16" height="16" rx="3"/>`;
const MARK = `<circle cx="16" cy="16" r="12" fill="#326ce5"/><path d="M16 8v16" stroke="#fff"/>`;

describe("glyphMarkup (#95)", () => {
  it("strokes a monochrome glyph with the caller's token, as it always has", () => {
    expect(glyphMarkup({ name: "generic", body: BODY }, 10, 20, 22, "#abc")).toBe(
      `<g transform="translate(10 20) scale(0.9167)" fill="none" stroke="#abc" ` +
        `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BODY}</g>`,
    );
  });

  it("accepts a bare geometry string and treats it as monochrome", () => {
    expect(glyphMarkup(BODY, 10, 20, 22, "#abc")).toBe(glyphMarkup({ name: "g", body: BODY }, 10, 20, 22, "#abc"));
  });

  it("emits a colored mark with no paint attributes at all, so it renders as authored", () => {
    expect(glyphMarkup({ name: "Deployment", body: MARK, colored: true }, 10, 20, 22, "#abc")).toBe(
      `<g transform="translate(10 20) scale(0.9167)">${MARK}</g>`,
    );
  });

  it("never leaks the theme token into a colored mark", () => {
    const out = glyphMarkup({ name: "d", body: MARK, colored: true, viewBox: "0 0 32 32" }, 0, 0, 24, "#abc");
    expect(out).not.toContain("#abc");
    expect(out).not.toContain('fill="none"');
    expect(out).not.toContain("stroke-width");
    expect(out).toContain(MARK);
  });

  it("scales a non-24 viewBox to the requested size", () => {
    // 32-unit box into a 26px square: 26/32 = 0.8125, no centring offset (square).
    expect(glyphMarkup({ name: "d", body: MARK, viewBox: "0 0 32 32" }, 12, 14, 26, "#abc")).toContain(
      `transform="translate(12 14) scale(0.8125)"`,
    );
  });

  it("fits a non-square viewBox into the square, aspect preserved and centred", () => {
    // 48x24 into a 24px square: k = 0.5, width fills, height (12) centres → +6.
    expect(glyphMarkup({ name: "d", body: BODY, viewBox: "0 0 48 24" }, 100, 200, 24, "#abc")).toContain(
      `transform="translate(100 206) scale(0.5)"`,
    );
  });

  it("honours a viewBox origin offset", () => {
    // "4 4 16 16" into 24px: k = 1.5, and the 4-unit origin shifts back by 6px.
    expect(glyphMarkup({ name: "d", body: BODY, viewBox: "4 4 16 16" }, 100, 200, 24, "#abc")).toContain(
      `transform="translate(94 194) scale(1.5)"`,
    );
  });

  it("falls back to 0 0 24 24 for a malformed viewBox", () => {
    for (const vb of ["", "nonsense", "0 0 24", "0 0 0 24", "0 0 24 24 24"]) {
      expect(glyphMarkup({ name: "d", body: BODY, viewBox: vb }, 0, 0, 24, "#abc"), vb).toContain(`scale(1)`);
    }
  });

  it("reproduces the scale factors the call sites emitted before they consolidated", () => {
    // These are the literals that used to be hand-written / toFixed(4)'d in
    // containment, morph, flow, stacked and smallmult. Parity, pinned.
    const at = (size: number) => glyphMarkup(BODY, 0, 0, size, "#abc").match(/scale\(([\d.]+)\)/)![1];
    expect(at(32)).toBe("1.3333"); // containment badge / origin badge
    expect(at(28)).toBe("1.1667"); // flow card
    expect(at(26)).toBe("1.0833"); // morph badge, stacked, smallmult
    expect(at(24)).toBe("1"); // the identity case
    expect(at(22)).toBe("0.9167"); // containment box, card icon
  });
});

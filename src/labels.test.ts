import { describe, it, expect, afterEach } from "vitest";
import { defaultFields, resolveFields, MAX_FIELDS } from "./labels.ts";
import { registerPack, clearPacks } from "./icons.ts";
import type { IRNode } from "./ir.ts";

function node(attrs: Record<string, unknown>, over: Partial<IRNode> = {}): IRNode {
  return { id: "n", kind: "Thing", lexicon: "x", attrs, ...over };
}

afterEach(() => {
  clearPacks();
  registerPack({ lexicon: "gitlab", iconFor: (k) => (/job/i.test(k) ? "pipeline" : undefined) });
});

describe("defaultFields", () => {
  it("keeps scalar attrs, sorted, and skips refs/objects/arrays", () => {
    const f = defaultFields(node({ region: "us-east1", size: 3, on: true, net: { $ref: "vpc.id" }, tags: ["a"] }));
    expect(f).toEqual([
      { label: "on", value: "true" },
      { label: "region", value: "us-east1" },
      { label: "size", value: "3" },
    ]);
  });

  it("caps at MAX_FIELDS", () => {
    const attrs = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    expect(defaultFields(node(attrs)).length).toBe(MAX_FIELDS);
  });

  it("truncates long values", () => {
    const f = defaultFields(node({ x: "y".repeat(50) }));
    expect(f[0].value.endsWith("…")).toBe(true);
    expect(f[0].value.length).toBeLessThanOrEqual(28);
  });
});

describe("resolveFields (chain)", () => {
  it("override wins", () => {
    const f = resolveFields(node({ region: "x" }), { override: [{ label: "a", value: "b" }] });
    expect(f).toEqual([{ label: "a", value: "b" }]);
  });

  it("a lexicon pack's fields win over the default", () => {
    clearPacks();
    registerPack({
      lexicon: "x",
      iconFor: () => undefined,
      fields: () => [{ label: "from", value: "pack" }],
    });
    expect(resolveFields(node({ region: "x" }))).toEqual([{ label: "from", value: "pack" }]);
  });

  it("falls back to default scalar attrs", () => {
    expect(resolveFields(node({ region: "us" }))).toEqual([{ label: "region", value: "us" }]);
  });
});

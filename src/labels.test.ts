import { describe, it, expect, afterEach } from "vitest";
import { defaultFields, resolveFields } from "./labels.ts";
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
  it("keeps short scalar attrs, sorted, and skips refs/objects/arrays", () => {
    // lean card: at most a couple of short facts; the rest is in the popover.
    const f = defaultFields(node({ region: "us-east1", on: true, net: { $ref: "vpc.id" }, tags: ["a"] }));
    expect(f).toEqual([
      { label: "on", value: "true" },
      { label: "region", value: "us-east1" },
    ]);
  });

  it("caps to a lean count even with many scalars", () => {
    const attrs = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    expect(defaultFields(node(attrs)).length).toBe(2);
  });

  it("leaves long values to the popover (blobs aren't card facts)", () => {
    expect(defaultFields(node({ desc: "y".repeat(50) }))).toEqual([]);
    // short companions still show
    expect(defaultFields(node({ desc: "y".repeat(50), tier: "db" }))).toEqual([{ label: "tier", value: "db" }]);
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

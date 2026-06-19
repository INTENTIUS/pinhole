import { describe, it, expect, afterEach } from "vitest";
import {
  GENERIC_GLYPHS,
  categoryForKind,
  resolveGlyph,
  registerPack,
  clearPacks,
} from "./icons.ts";

afterEach(() => {
  // The default gitlab pack is registered at import; restore it after tests
  // that clear the registry.
  clearPacks();
  registerPack({ lexicon: "gitlab", iconFor: (k) => (/job/i.test(k) ? "pipeline" : undefined) });
});

describe("GENERIC_GLYPHS", () => {
  it("every glyph has non-empty geometry", () => {
    for (const [name, body] of Object.entries(GENERIC_GLYPHS)) {
      expect(body, name).toMatch(/<(path|rect|circle|ellipse)/);
    }
  });
  it("has a generic default", () => {
    expect(GENERIC_GLYPHS.generic).toBeTruthy();
  });
});

describe("categoryForKind", () => {
  it("maps kinds to categories by keyword", () => {
    expect(categoryForKind("GcsBucket")).toBe("storage");
    expect(categoryForKind("CockroachDbCluster")).toBe("database"); // db keyword wins
    expect(categoryForKind("PubSubTopic")).toBe("queue");
    expect(categoryForKind("GkeNodePool")).toBe("container");
    expect(categoryForKind("Vpc")).toBe("network");
    expect(categoryForKind("SomethingUnknown")).toBe("generic");
  });
});

describe("resolveGlyph (chain)", () => {
  it("override wins over everything", () => {
    expect(resolveGlyph({ lexicon: "gcp", kind: "Vpc" }, { override: "secret" }).name).toBe("secret");
  });

  it("a lexicon pack wins over the heuristic", () => {
    // gitlab pack maps Job → pipeline (heuristic would also say pipeline, so use
    // a pack that disagrees with the heuristic to prove precedence)
    clearPacks();
    registerPack({ lexicon: "gcp", iconFor: (k) => (k === "Vpc" ? "secret" : undefined) });
    expect(resolveGlyph({ lexicon: "gcp", kind: "Vpc" }).name).toBe("secret"); // not "network"
  });

  it("falls through to the heuristic when no pack matches", () => {
    expect(resolveGlyph({ lexicon: "gcp", kind: "GcsBucket" }).name).toBe("storage");
  });

  it("falls back to generic for unknown kinds", () => {
    const g = resolveGlyph({ lexicon: "x", kind: "Zzz" });
    expect(g.name).toBe("generic");
    expect(g.body).toBe(GENERIC_GLYPHS.generic);
  });

  it("an unknown override key degrades to generic", () => {
    expect(resolveGlyph({ lexicon: "x", kind: "y" }, { override: "nope" }).name).toBe("generic");
  });
});

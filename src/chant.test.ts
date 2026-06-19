import { describe, it, expect } from "vitest";
import { graphFlags } from "./chant.ts";

describe("graphFlags", () => {
  it("is empty for no options", () => {
    expect(graphFlags({})).toEqual([]);
  });

  it("passes --detail (including 0)", () => {
    expect(graphFlags({ detail: 0 })).toEqual(["--detail", "0"]);
    expect(graphFlags({ detail: 2 })).toEqual(["--detail", "2"]);
  });

  it("passes --lens and direction flags", () => {
    expect(graphFlags({ lens: "blast:vpc", down: true })).toEqual([
      "--lens",
      "blast:vpc",
      "--down",
    ]);
  });

  it("combines options in a stable order", () => {
    expect(graphFlags({ detail: 1, lens: "lexicon:gcp", up: true, down: true })).toEqual([
      "--detail",
      "1",
      "--lens",
      "lexicon:gcp",
      "--up",
      "--down",
    ]);
  });
});

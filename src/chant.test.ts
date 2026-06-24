import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { graphFlags, chantBinFrom } from "./chant.ts";

describe("chantBinFrom (project-first chant resolution, #36)", () => {
  it("finds a project's own @intentius/chant bin", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinhole-proj-"));
    const pkgDir = join(dir, "node_modules", "@intentius", "chant");
    mkdirSync(join(pkgDir, "bin"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@intentius/chant", version: "9.9.9", main: "index.js", bin: { chant: "bin/chant" } }),
    );
    writeFileSync(join(pkgDir, "index.js"), "module.exports = {};");
    writeFileSync(join(pkgDir, "bin", "chant"), "#!/bin/sh\n");

    const req = createRequire(join(dir, "noop.js")); // resolves from inside the project
    // realpath may normalise symlinks (macOS /var → /private/var), so match the tail.
    expect(chantBinFrom(req)).toMatch(/@intentius[/\\]chant[/\\]bin[/\\]chant$/);
  });

  it("returns undefined when chant isn't resolvable from there (→ caller falls back)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinhole-empty-"));
    expect(chantBinFrom(createRequire(join(dir, "noop.js")))).toBeUndefined();
  });
});

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

  it("passes --env so chant re-evaluates the project for that environment", () => {
    expect(graphFlags({ env: "prod" })).toEqual(["--env", "prod"]);
  });

  it("combines options in a stable order", () => {
    expect(graphFlags({ detail: 1, lens: "lexicon:gcp", up: true, down: true, env: "prod" })).toEqual([
      "--detail",
      "1",
      "--lens",
      "lexicon:gcp",
      "--up",
      "--down",
      "--env",
      "prod",
    ]);
  });
});

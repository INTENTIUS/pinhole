import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GUIDE } from "./guide.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("agent guide", () => {
  it("documents the verbs and the loop", () => {
    for (const verb of ["describe", "check", "render", "guide"]) {
      expect(GUIDE).toContain(`pinhole ${verb}`);
    }
    expect(GUIDE).toContain("--json");
    expect(GUIDE).toContain("lint gate");
  });

  it("stays in sync with AGENTS.md (run `npm run gen:agents` after editing the guide)", () => {
    const agentsMd = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsMd).toBe(GUIDE);
  });
});

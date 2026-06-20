import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GraphIR, Layout, NodeSize } from "@intentius/chant";

/**
 * Thin wrapper over the chant CLI. pinhole gets its data by shelling `chant
 * graph` — the IR (`--format ir`) and node positions (`--format layout`) — and
 * paints them. chant owns synthesis, the lint gate, and layout (size-aware, via
 * the sizes pinhole passes); pinhole owns the picture.
 */

/** Shared graph options passed through to chant so IR and layout node sets align. */
export interface GraphOptions {
  /** Detail tier 0..3 (stacks|composites|declarables|attributes). */
  detail?: number;
  /** Lens, e.g. "lexicon:gcp" or "blast:vpc". */
  lens?: string;
  /** blast lens: include upstream producers. */
  up?: boolean;
  /** blast lens: include downstream dependents. */
  down?: boolean;
}

/** Build the chant flags for a set of graph options. Pure; exported for testing. */
export function graphFlags(opts: GraphOptions): string[] {
  const flags: string[] = [];
  if (opts.detail !== undefined) flags.push("--detail", String(opts.detail));
  if (opts.lens) flags.push("--lens", opts.lens);
  if (opts.up) flags.push("--up");
  if (opts.down) flags.push("--down");
  return flags;
}

/** Locate the chant bin from the installed dependency. Walks up from the resolved
 * package entry to the package root (chant's `exports` map blocks resolving
 * `package.json` directly), then returns its `bin/chant`. */
function chantBin(): string {
  const require = createRequire(import.meta.url);
  let dir = dirname(require.resolve("@intentius/chant"));
  for (let i = 0; i < 8; i++) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; bin?: Record<string, string> };
      if (pkg.name === "@intentius/chant") {
        const rel = pkg.bin?.chant ?? "bin/chant";
        return join(dir, rel);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the @intentius/chant bin");
}

function runChant(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(chantBin(), args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout!.on("data", (d) => (out += d));
    proc.stderr!.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`chant graph exited ${code}: ${err.trim() || out.trim()}`));
    });
    if (input !== undefined) {
      proc.stdin!.write(input);
      proc.stdin!.end();
    }
  });
}

/** Get the graph IR for a chant project. */
export async function graphIr(projectDir: string, opts: GraphOptions = {}): Promise<GraphIR> {
  const out = await runChant(["graph", projectDir, "--format", "ir", ...graphFlags(opts)]);
  return JSON.parse(out) as GraphIR;
}

/** Get node positions for a chant project. chant lays out (dagre by default, no
 * native dependency); pinhole paints. Pass `sizes` (the painter's measured card
 * footprints) so the layout spaces for real cards — no overlap (#509). Sizes go
 * over stdin to dodge arg-length limits on large graphs. */
export async function graphLayout(
  projectDir: string,
  opts: GraphOptions = {},
  sizes?: Record<string, NodeSize>,
): Promise<Layout> {
  const args = ["graph", projectDir, "--format", "layout", ...graphFlags(opts)];
  let input: string | undefined;
  if (sizes && Object.keys(sizes).length > 0) {
    args.push("--node-sizes", "-");
    input = JSON.stringify(sizes);
  }
  const out = await runChant(args, input);
  return JSON.parse(out) as Layout;
}

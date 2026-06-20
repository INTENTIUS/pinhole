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

/** Result of a chant invocation that doesn't throw on a non-zero exit — used by
 * the gate, where a failing exit is data (the source is dirty), not an error. */
export interface ChantRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn chant and resolve with its exit code + streams, never rejecting on a
 * non-zero exit (only on a spawn failure). */
export function runChantRaw(args: string[], input?: string): Promise<ChantRun> {
  return new Promise((resolve, reject) => {
    const proc = spawn(chantBin(), args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout!.on("data", (d) => (stdout += d));
    proc.stderr!.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input !== undefined) {
      proc.stdin!.write(input);
      proc.stdin!.end();
    }
  });
}

function runChant(args: string[], input?: string): Promise<string> {
  return runChantRaw(args, input).then(({ code, stdout, stderr }) => {
    if (code === 0) return stdout;
    throw new Error(`chant ${args[0]} exited ${code}: ${stderr.trim() || stdout.trim()}`);
  });
}

/** A chant lint report. `ok` mirrors chant's exit (clean source → true).
 * `diagnostics` is chant's `--format json` payload, passed through unreshaped so
 * the gate's verdict is chant's, not pinhole's reinterpretation. */
export interface LintReport {
  ok: boolean;
  diagnostics: unknown;
  /** chant's default (stylish) rendering, for human output. */
  stylish: string;
}

/** Run the lint gate. This is the same check that gates `chant graph` (and thus
 * every rendered diagram): clean source lints, exits 0, and renders. */
export async function lint(projectDir: string): Promise<LintReport> {
  const json = await runChantRaw(["lint", projectDir, "--format", "json"]);
  let diagnostics: unknown = [];
  try {
    diagnostics = JSON.parse(json.stdout || "[]");
  } catch {
    diagnostics = []; // non-JSON on stdout (shouldn't happen) — fall back to the exit code
  }
  const human = await runChantRaw(["lint", projectDir]);
  return { ok: json.code === 0, diagnostics, stylish: (human.stdout + human.stderr).trim() };
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

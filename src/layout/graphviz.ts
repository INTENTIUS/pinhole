import { spawn } from "node:child_process";
import type { GraphIR } from "../ir.ts";
import type { Layout, LayoutEngine, Point } from "./engine.ts";

/**
 * GraphvizLayout lays out the IR with `dot -Tjson` and returns node positions.
 * Graphviz is used for LAYOUT ONLY — the painter draws the visuals. This mirrors
 * the rackattack approach (`internal/render`): build a DOT graph, parse the
 * `bb` bounding box and each object's `pos`, discard Graphviz's rendering.
 *
 * Requires `dot` on PATH (`brew install graphviz`). This is the "upgrade" path;
 * Mermaid is the zero-install default. See #497.
 */
export class GraphvizLayout implements LayoutEngine {
  readonly name = "graphviz";

  async layout(ir: GraphIR): Promise<Layout> {
    const dot = toDot(ir);
    const json = await runDot(dot);
    return parseLayout(json);
  }
}

/** Build a DOT graph from the IR. Fixed-size boxes; clusters left to the painter. */
export function toDot(ir: GraphIR): string {
  const parts: string[] = [];
  parts.push(
    "digraph{rankdir=TB;nodesep=0.5;ranksep=1.0;" +
      "node[shape=box,fixedsize=true,width=2.4,height=1.0];"
  );
  for (const n of ir.nodes) parts.push(`"${esc(n.id)}";`);
  for (const e of ir.edges) parts.push(`"${esc(e.from)}"->"${esc(e.to)}";`);
  parts.push("}");
  return parts.join("");
}

function esc(s: string): string {
  return s.replace(/"/g, '\\"');
}

function runDot(dot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn("dot", ["-Tjson"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(installHint(err));
      return;
    }
    let out = "";
    let errOut = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (errOut += d));
    proc.on("error", (err) => reject(installHint(err)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pinhole: dot exited ${code}: ${errOut.trim()}`));
        return;
      }
      resolve(out);
    });
    proc.stdin.write(dot);
    proc.stdin.end();
  });
}

function installHint(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(
    `pinhole: could not run 'dot' (${msg}). Graphviz is required for the ` +
      `graphviz layout engine — install it with 'brew install graphviz', or ` +
      `use the Mermaid output, which needs no native dependency.`
  );
}

interface DotJson {
  bb?: string;
  objects?: Array<{ name?: string; pos?: string }>;
}

/** Parse `dot -Tjson` output into a Layout. Graphviz y grows upward; we keep its space. */
export function parseLayout(json: string): Layout {
  const parsed = JSON.parse(json) as DotJson;
  const bb = (parsed.bb ?? "").split(",");
  if (bb.length !== 4) throw new Error(`pinhole: bad bounding box ${parsed.bb}`);
  const width = atof(bb[2]);
  const height = atof(bb[3]);
  if (width === 0 || height === 0) throw new Error("pinhole: zero graph bounds");

  const nodes: Record<string, Point> = {};
  for (const o of parsed.objects ?? []) {
    if (!o.name || !o.pos) continue;
    const p = o.pos.split(",");
    if (p.length !== 2) continue;
    nodes[o.name] = { x: atof(p[0]), y: atof(p[1]) };
  }
  return { nodes, width, height };
}

function atof(s: string): number {
  const f = Number.parseFloat(s.trim());
  return Number.isFinite(f) ? f : 0;
}

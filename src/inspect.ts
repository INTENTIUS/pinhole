import type { GraphIR } from "./ir.ts";

/** A compact, machine-readable digest of a graph IR — what an agent reads to
 * learn the current shape of a project before editing it. Stable field names so
 * `--json` consumers can rely on them. */
export interface IrSummary {
  counts: {
    nodes: number;
    edges: number;
    byLexicon: Record<string, number>;
    byKind: Record<string, number>;
    composites: number;
  };
  nodes: Array<{ id: string; kind: string; lexicon: string; composite?: string }>;
  edges: Array<{ from: string; to: string; via?: string }>;
  /** Composite instances → the ids they group (from compositeInstance tags). */
  composites: Record<string, string[]>;
}

/** Build the digest. Pure — exported for testing and reuse by the CLI. */
export function summarizeIr(ir: GraphIR): IrSummary {
  const byLexicon: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const composites: Record<string, string[]> = {};

  for (const n of ir.nodes) {
    byLexicon[n.lexicon] = (byLexicon[n.lexicon] ?? 0) + 1;
    byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    if (n.compositeInstance) (composites[n.compositeInstance] ??= []).push(n.id);
  }

  return {
    counts: {
      nodes: ir.nodes.length,
      edges: ir.edges.length,
      byLexicon,
      byKind,
      composites: Object.keys(composites).length,
    },
    nodes: ir.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      lexicon: n.lexicon,
      ...(n.compositeInstance ? { composite: n.compositeInstance } : {}),
    })),
    edges: ir.edges.map((e) => ({ from: e.from, to: e.to, ...(e.viaAttr ? { via: e.viaAttr } : {}) })),
    composites,
  };
}

/** A readable digest for terminal output (the non-`--json` path). */
export function describeText(ir: GraphIR): string {
  const s = summarizeIr(ir);
  const lines: string[] = [];
  lines.push(`${s.counts.nodes} nodes, ${s.counts.edges} edges, ${s.counts.composites} composites`);

  const lex = Object.entries(s.counts.byLexicon).map(([k, v]) => `${k}:${v}`).join("  ");
  if (lex) lines.push(`lexicons: ${lex}`);

  lines.push("");
  lines.push("nodes:");
  for (const n of s.nodes) {
    lines.push(`  ${n.id}  ${n.kind}${n.composite ? `  (${n.composite})` : ""}`);
  }

  if (s.edges.length) {
    lines.push("");
    lines.push("edges:");
    for (const e of s.edges) lines.push(`  ${e.from} → ${e.to}${e.via ? `  via ${e.via}` : ""}`);
  }

  if (s.counts.composites) {
    lines.push("");
    lines.push("composites:");
    for (const [name, ids] of Object.entries(s.composites)) lines.push(`  ${name}: ${ids.join(", ")}`);
  }

  return lines.join("\n") + "\n";
}

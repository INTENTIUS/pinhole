/**
 * Change diff (#3 core primitive). Align two graph IRs by id and classify each
 * node `added` / `removed` / `changed` / `same`, with attr-level deltas. Pure and
 * deterministic — this diffs *validated intent* (the IR), not scraped live state.
 *
 * The headline altitude is the composite tier, so `diffTiers` rolls member-level
 * changes up: a composite whose own attrs are unchanged still reads as `changed`
 * when a declarable it owns was added/removed/changed — otherwise an internal edit
 * (a bumped `desiredCount`) would be invisible at the altitude you actually read.
 */
import type { GraphIR, IRNode } from "./ir.ts";

export type DiffStatus = "added" | "removed" | "changed" | "same";
export interface AttrDelta { key: string; before: unknown; after: unknown }
export interface GraphDiff {
  status: Record<string, DiffStatus>;
  deltas: Record<string, AttrDelta[]>;
}

function attrDeltas(b: Record<string, unknown> = {}, a: Record<string, unknown> = {}): AttrDelta[] {
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: k, before: b[k], after: a[k] }));
}

/** Classify two node sets by id. */
export function diffNodes(before: IRNode[], after: IRNode[]): GraphDiff {
  const bm = new Map(before.map((n) => [n.id, n]));
  const am = new Map(after.map((n) => [n.id, n]));
  const status: Record<string, DiffStatus> = {};
  const deltas: Record<string, AttrDelta[]> = {};
  for (const id of new Set([...bm.keys(), ...am.keys()])) {
    const b = bm.get(id), a = am.get(id);
    if (b && !a) status[id] = "removed";
    else if (!b && a) status[id] = "added";
    else {
      const d = attrDeltas(b!.attrs as Record<string, unknown>, a!.attrs as Record<string, unknown>);
      if (d.length) { status[id] = "changed"; deltas[id] = d; } else status[id] = "same";
    }
  }
  return { status, deltas };
}

/** Composite-tier diff with member roll-up (see file header). `before`/`after`
 * are the composite-tier IRs; `beforeMembers`/`afterMembers` the next tier down
 * (nodes carry `compositeInstance`). Status/deltas cover composites *and* members. */
export function diffTiers(before: GraphIR, after: GraphIR, beforeMembers: GraphIR, afterMembers: GraphIR): GraphDiff {
  const comp = diffNodes(before.nodes, after.nodes);
  const mem = diffNodes(beforeMembers.nodes, afterMembers.nodes);
  const compositeOf = (n: IRNode): string | undefined => (n as { compositeInstance?: string }).compositeInstance;
  const touched = new Set<string>();
  for (const ns of [beforeMembers.nodes, afterMembers.nodes]) {
    for (const n of ns) {
      const c = compositeOf(n);
      if (c && mem.status[n.id] && mem.status[n.id] !== "same") touched.add(c);
    }
  }
  for (const c of touched) if (comp.status[c] === "same") comp.status[c] = "changed";
  return { status: { ...mem.status, ...comp.status }, deltas: { ...mem.deltas, ...comp.deltas } };
}

/** Merge two IRs for *rendering* a diff: every node/edge from either side, so a
 * `removed` node still has a place on the canvas. A node present in both keeps the
 * **after** version (current attrs + `compositeInstance`); a node only in `before`
 * (removed) is carried over so the renderer can ghost it. Pure. */
export function unionGraph(before: GraphIR, after: GraphIR): GraphIR {
  const byId = new Map<string, IRNode>();
  for (const n of before.nodes) byId.set(n.id, n);
  for (const n of after.nodes) byId.set(n.id, n); // after wins on collision
  const edges = [...after.edges];
  const seen = new Set(after.edges.map((e) => `${e.from}>${e.to}>${e.viaAttr ?? ""}`));
  for (const e of before.edges) {
    const k = `${e.from}>${e.to}>${e.viaAttr ?? ""}`;
    if (!seen.has(k)) { seen.add(k); edges.push(e); }
  }
  return { nodes: [...byId.values()], edges, groups: after.groups };
}

/** A one-line, human summary of a node's attr deltas (for the inspector). */
export function deltaSummary(deltas: AttrDelta[]): string {
  const scalar = (v: unknown): boolean => v === null || typeof v !== "object";
  const fmt = (v: unknown): string => (v === undefined ? "∅" : String(v));
  return deltas
    .map((d) => (scalar(d.before) && scalar(d.after) ? `${d.key}: ${fmt(d.before)} → ${fmt(d.after)}` : `${d.key}: changed`))
    .join(" · ");
}

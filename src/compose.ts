import type { GraphIR, IRNode, IREdge, IRDanglingRef, IRGroups } from "./ir.ts";

/**
 * Multi-stack composition. pinhole renders *the IR*, not chant — so several
 * independent stacks (each its own IR, from chant or any source via --ir) compose
 * into one diagram here, in the viewer, not in the producer. Each stack becomes a
 * boundary box (via `groups.byStack`); cross-stack edges are a later layer (they
 * need the producer to expose import/export handles in the IR).
 */

const SEP = "/";

/** A cross-stack export a stack publishes (from chant's `ir.exports`, #513). */
interface IRExport {
  name: string;
  node?: string;
  attr?: string;
}

/** Normalise a cross-stack handle for matching: an export `ClusterArn` and a
 * Parameter import `clusterArn` are the same socket. */
const normHandle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True for a node that is a cross-stack import socket (a CloudFormation Parameter
 * or equivalent), matched by name to another stack's export. */
export const isImportSocket = (kind: string): boolean => /::parameter$|\bparameter$/i.test(kind);

/** Shorten stack paths/labels to readable names by stripping the longest common
 * prefix (so `gitlab-aws-alb-{infra,api,ui}` reads as `infra`/`api`/`ui`). */
export function shortStackNames(paths: string[]): string[] {
  const bases = paths.map((p) => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p);
  if (bases.length < 2) return bases;
  let prefix = bases[0];
  for (const b of bases) while (prefix && !b.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.replace(/[^-_./]*$/, ""); // trim back to a separator so we don't cut mid-word
  return bases.map((b) => b.slice(prefix.length) || b);
}

/** Rewrite `$ref` producers under a stack prefix so the inspector resolves them. */
function remapRefs(value: unknown, prefix: string): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => remapRefs(v, prefix));
  const o = value as Record<string, unknown>;
  if (typeof o.$ref === "string") {
    const dot = o.$ref.indexOf(".");
    const producer = dot >= 0 ? o.$ref.slice(0, dot) : o.$ref;
    const rest = dot >= 0 ? o.$ref.slice(dot) : "";
    return { ...o, $ref: `${prefix}${SEP}${producer}${rest}` };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = remapRefs(v, prefix);
  return out;
}

/**
 * Compose N stacks into one IR: namespace every id by its stack (so ids never
 * collide across stacks), merge nodes/edges, and group `byStack` by stack so each
 * renders as a boundary box. Pure — exported for testing.
 */
export function composeStacks(stacks: Array<{ name: string; ir: GraphIR }>): GraphIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  const byStack: Record<string, string[]> = {};
  const byLexicon: Record<string, string[]> = {};
  const byComposite: Record<string, string[]> = {};
  // Groups keyed by a name the stack chose (a pipeline, a wave) or by a node id
  // (a container): both the key and the members take the stack prefix, so two
  // stacks' `ci` pipelines (or `wave-0`s) stay two groups.
  const byPipeline: Record<string, string[]> = {};
  const byContainer: Record<string, string[]> = {};
  const byWave: Record<string, string[]> = {};
  const dangling: IRDanglingRef[] = [];

  // Each stack's exports, keyed by normalised name → its (namespaced) producer.
  const producerOf = new Map<string, string>();
  for (const { name, ir } of stacks) {
    for (const e of (ir as { exports?: IRExport[] }).exports ?? []) {
      if (e.node) producerOf.set(normHandle(e.name), `${name}${SEP}${e.node}`);
    }
  }

  for (const { name, ir } of stacks) {
    const ns = (id: string): string => `${name}${SEP}${id}`;
    // Pre-composition ids of this stack's own nodes — the membership test for
    // `runtimeOwner` below (chant#1180's field postdates composeStacks, so it
    // isn't namespaced by the id/compositeInstance rewrite above). Only rewrite
    // an owner that names one of THIS stack's nodes; chant resolves the owner
    // chain within a project, so a name that isn't a member here is a cross-stack
    // (or already-composed) reference better left untouched than rewritten into
    // a different lie (behold's `namespaceRuntimeOwners`, src/estate.ts, #241).
    const own = new Set(ir.nodes.map((n) => n.id));
    for (const n of ir.nodes) {
      const id = ns(n.id);
      const node: IRNode = { ...n, id, attrs: remapRefs(n.attrs, name) as Record<string, unknown> };
      if (n.compositeInstance) node.compositeInstance = ns(n.compositeInstance);
      if (n.runtimeOwner && own.has(n.runtimeOwner)) node.runtimeOwner = ns(n.runtimeOwner);
      nodes.push(node);
      (byStack[name] ??= []).push(id);
      (byLexicon[n.lexicon] ??= []).push(id);
      if (node.compositeInstance) (byComposite[node.compositeInstance] ??= []).push(id);
      // Cross-stack edge: an import socket (Parameter `clusterArn`) → the node that
      // produces the matching export (`ClusterArn`) in another stack. The IR can't
      // express the within-stack consumer→param link (it's an opaque intrinsic), so
      // the Parameter node is the visible bridge between the two stacks (#513).
      if (isImportSocket(n.kind)) {
        const producer = producerOf.get(normHandle(n.id));
        if (producer && producer !== id) edges.push({ from: id, to: producer, kind: "ref", viaAttr: "import" });
      }
    }
    for (const e of ir.edges) edges.push({ ...e, from: ns(e.from), to: ns(e.to) });
    // `value` is the reference as written in source and names nothing in this
    // graph, so only `from` is namespaced.
    for (const d of ir.dangling ?? []) dangling.push({ ...d, from: ns(d.from) });
    const g = ir.groups ?? {};
    for (const [src, dst] of [
      [g.byPipeline, byPipeline],
      [g.byContainer, byContainer],
      [g.byWave, byWave],
    ] as const) {
      for (const [key, ids] of Object.entries(src ?? {})) (dst[ns(key)] ??= []).push(...ids.map(ns));
    }
  }

  const groups: IRGroups = { byStack, byLexicon, byComposite };
  // Present only when some stack carried one, so a composition of plain stacks
  // is unchanged.
  if (Object.keys(byPipeline).length) groups.byPipeline = byPipeline;
  if (Object.keys(byContainer).length) groups.byContainer = byContainer;
  if (Object.keys(byWave).length) groups.byWave = byWave;
  const out: GraphIR = { nodes, edges, groups };
  if (dangling.length) out.dangling = dangling;
  return out;
}

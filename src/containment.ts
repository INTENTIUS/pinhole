/**
 * Salience + containment view (experiment for #9 follow-up).
 *
 * Two ideas, from the observation that a flat node-link graph is the wrong shape
 * for infra:
 *
 *  1. **Salience** — resources have roles. *Places* (VPC, subnet) become bounding
 *     boxes; *things* (instances, load balancers, buckets) are nodes inside them;
 *     *policies* (security groups) are dependency targets; *plumbing* (route
 *     tables, routes, associations, gateway attachments) adds little to a diagram
 *     and is dropped.
 *  2. **Containment** — a *lives-in* reference (`VpcId`, `SubnetId`) is nesting,
 *     not a line. So an instance sits inside its subnet inside its VPC. Only the
 *     remaining *dependency* refs (e.g. SecurityGroupIds) are drawn as lines.
 *
 * This is a prototype renderer with its own simple nested-grid layout (it doesn't
 * go through chant's flat layout). Output reuses the theme/glyphs, and stamps
 * `data-node-id` so the HTML artifact's hover/inspect work over it.
 */
import type { GraphIR } from "./ir.ts";
import { getTheme, v, defs, THEMES, type Theme } from "./theme.ts";
import { resolveGlyph } from "./icons.ts";
import { clip, esc } from "./paint/svg.ts";
import { defaultPack, type Role, type Focus, type SaliencePack, type Hints } from "./pack.ts";

// The salience taxonomy now lives in a swappable presentation pack (#28); these
// types are re-exported so existing importers keep working.
export type { Role, Focus, SaliencePack, Hints };

/** Classify a resource kind into a diagram role, given the diagram's focus and
 * the presentation pack. Under `network` focus subnets/route tables become places
 * (structured boxes); under `security` focus security groups are first-class
 * policies. Otherwise the pack's role rules apply, defaulting to `thing`. */
export function roleForKind(kind: string, focus: Focus = "app", pack: SaliencePack = defaultPack): Role {
  const k = kind.toLowerCase();
  if (focus === "network" && pack.networkPlace.test(k)) return "place";
  if (focus === "security" && pack.securityPolicy.test(k)) return "policy";
  for (const [re, role] of pack.roleRules) if (re.test(k)) return role;
  return "thing";
}

const MARGIN = 60;
const TITLE_BAND = 84;
const LEAF_W = 124;
const LEAF_H = 86;
const PAD = 16;
const BOX_TITLE = 30;
const GAP = 18;
const MIN_ASPECT = 0.32; // grow a box's height toward this fraction of its width…
const MIN_ASPECT_PAD = 44; // …but add at most this much padding on each side.

export interface ContainmentOptions {
  title?: string;
  theme?: Theme;
  /** What the diagram is about (default "app"). */
  focus?: Focus;
  /** Salience taxonomy (default: the built-in `defaultPack`). */
  pack?: SaliencePack;
  /** Manual overrides: assert roles/edges the IR can't express. */
  hints?: Hints;
}

interface Layout {
  W: Record<string, number>;
  H: Record<string, number>;
  X: Record<string, number>;
  Y: Record<string, number>;
  /** Row-packing per box: each row's y offset and its children's x offsets. */
  pack: Record<string, Array<{ y: number; items: Array<{ id: string; x: number; dy: number }> }>>;
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

interface Analysis {
  role: Record<string, Role>;
  kept: Set<string>;
  meta: Record<string, { kind: string; lexicon: string }>;
  parent: Record<string, string>;
  children: Record<string, string[]>;
  depEdges: Array<{ from: string; to: string; via?: string; toAttr?: string }>;
  /** Edges the IR doesn't carry but a composite implies (an ALB fronts the
   * service it was created with) — drawn as a hint, distinct from real refs. */
  implied: Array<{ from: string; to: string }>;
  /** place id → plumbing ids that live in it (dropped from the diagram). */
  hidden: Record<string, string[]>;
}

/** Salience + containment of an IR.
 *
 * **Network containment is primary** — a lives-in/spans ref (VpcId/SubnetId/
 * Subnets) nests a resource in its place (subnet ⊂ VPC), so the VPC encapsulates
 * everything that lives in it, regardless of which composite expanded it. The
 * **composite is a secondary grouping**: a composite's members that have *no*
 * network home (an ECS cluster/service/task definition) gather into a sub-box
 * nested inside the network their networked siblings anchor to. Only refs that
 * are neither lives-in nor spans stay as dependency lines, and plumbing is hidden
 * under the place it lives in.
 *
 * Taxonomy comes from `pack` (#28); `hints` lets a caller override roles and
 * assert relationships the IR can't express. */
function analyze(ir: GraphIR, focus: Focus = "app", pack: SaliencePack = defaultPack, hints: Hints = {}): Analysis {
  const LIVES_IN = new Set(pack.livesIn);
  const SPANS = new Set(pack.spans);
  const role: Record<string, Role> = {};
  const kept = new Set<string>();
  const meta: Record<string, { kind: string; lexicon: string }> = {};
  const composite: Record<string, string> = {};
  const compositeType: Record<string, string> = {};
  const overridden = new Set<string>();
  const dropped = new Set<string>(); // framework config, removed entirely (not hidden)
  for (const n of ir.nodes) {
    role[n.id] = roleForKind(n.kind, focus, pack);
    meta[n.id] = { kind: n.kind, lexicon: n.lexicon };
    if (pack.drop?.test(n.kind.toLowerCase())) dropped.add(n.id);
    else if (role[n.id] !== "plumbing") kept.add(n.id);
    if (n.compositeInstance) {
      composite[n.id] = n.compositeInstance;
      compositeType[n.compositeInstance] = n.compositeParent ?? "composite";
    }
  }

  // Manual role overrides (#28): authoritative, and protected from collapse.
  for (const [id, r] of Object.entries(hints.roles ?? {})) {
    if (!(id in role)) continue;
    role[id] = r;
    if (r === "plumbing") kept.delete(id);
    else kept.add(id);
    overridden.add(id);
  }

  // Topology pass (v2): infer *incidental* resources from the relationship shape,
  // rather than hardcoding kinds. We iterate to a fixpoint so chains of config
  // fold one link at a time. Counting only dependency refs (not containment) and
  // only among still-kept nodes, a "thing" collapses to drill-down when it is:
  //  - a single-attachment leaf: nothing depends on it and it touches exactly one
  //    kept node (a listener → its ALB; after that folds, a rule → that listener);
  //  - parked: no dependency refs either way, only a containment ref (a target
  //    group whose only edge is its VPC).
  // Guarded so the diagram never collapses to nothing: places/policies, ingress
  // and workload subjects, valuable nouns, and anything *depended upon* (in-degree
  // > 0, e.g. a referenced bucket) all survive. Degree alone can't tell a valuable
  // leaf from config — these guards are the tie-break.
  const placed = new Set<string>();
  for (const e of ir.edges) {
    if (e.from === e.to) continue;
    if (e.viaAttr && (LIVES_IN.has(e.viaAttr) || SPANS.has(e.viaAttr))) placed.add(e.from);
  }
  // Topology hints key on the resource *type* (the last "::" segment), not the
  // full kind — otherwise a namespace like "ElasticLoadBalancingV2" makes every
  // sub-resource (listener, target group) match the ingress rule "loadbalanc".
  const typeOf = (id: string): string => (meta[id].kind.split("::").pop() ?? meta[id].kind).toLowerCase();
  const protectedSubject = (id: string): boolean =>
    overridden.has(id) ||
    typeOf(id) === "parameter" || // a cross-stack import socket — the anchor for an inter-stack edge
    pack.ingress.test(typeOf(id)) || pack.workload.test(typeOf(id)) || pack.valuable.test(typeOf(id));
  for (let changed = true; changed; ) {
    changed = false;
    const di: Record<string, number> = {};
    const dout: Record<string, number> = {};
    const nbr: Record<string, Set<string>> = {};
    for (const e of ir.edges) {
      if (e.from === e.to) continue;
      if (e.viaAttr && (LIVES_IN.has(e.viaAttr) || SPANS.has(e.viaAttr))) continue;
      if (!kept.has(e.from) || !kept.has(e.to)) continue; // only kept↔kept, so collapses ripple
      dout[e.from] = (dout[e.from] ?? 0) + 1;
      di[e.to] = (di[e.to] ?? 0) + 1;
      (nbr[e.from] ??= new Set()).add(e.to);
      (nbr[e.to] ??= new Set()).add(e.from);
    }
    for (const n of ir.nodes) {
      const id = n.id;
      if (!kept.has(id) || role[id] !== "thing" || protectedSubject(id)) continue;
      const inDeg = di[id] ?? 0;
      const deg = nbr[id] ? nbr[id].size : 0;
      const singleAttach = inDeg === 0 && deg === 1;
      const parked = inDeg === 0 && (dout[id] ?? 0) === 0 && placed.has(id);
      if (singleAttach || parked) { role[id] = "plumbing"; kept.delete(id); changed = true; }
    }
  }

  // Where each node nests: its lives-in target, or (failing that) what it spans.
  const nestTarget: Record<string, string> = {};
  for (const e of ir.edges) if (e.viaAttr && LIVES_IN.has(e.viaAttr) && !nestTarget[e.from]) nestTarget[e.from] = e.to;
  for (const e of ir.edges) if (e.viaAttr && SPANS.has(e.viaAttr) && !nestTarget[e.from]) nestTarget[e.from] = e.to;

  // The nearest *kept place* a node lives in, walking the chain through collapsed
  // plumbing (an instance → its subnet → the VPC resolves to the VPC).
  const homeOf = (id: string): string | undefined => {
    let cur: string | undefined = id;
    const seen = new Set<string>();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const t: string | undefined = nestTarget[cur];
      if (t == null) return undefined;
      if (kept.has(t) && role[t] === "place") return t;
      cur = t;
    }
    return undefined;
  };

  // Nest everything into the nearest place it lives in — including secondary
  // places (a subnet nests in its VPC; in network focus an instance nests in its
  // subnet). The top place (the VPC) has no home, so it stays a root.
  const parent: Record<string, string> = {};
  for (const id of kept) {
    const h = homeOf(id);
    if (h && h !== id) parent[id] = h;
  }

  // A composite's members with no network home gather into a sub-box, nested in
  // the place its networked siblings anchor to.
  const anchor: Record<string, string> = {};
  for (const id of kept) {
    const inst = composite[id];
    if (inst && parent[id] && !(inst in anchor)) anchor[inst] = parent[id];
  }
  const orphans: Record<string, string[]> = {};
  for (const id of kept) {
    const inst = composite[id];
    if (!inst || parent[id] || role[id] === "place") continue;
    (orphans[inst] = orphans[inst] || []).push(id);
  }
  for (const inst of Object.keys(orphans)) {
    role[inst] = "place";
    meta[inst] = { kind: compositeType[inst] ?? "composite", lexicon: meta[orphans[inst][0]].lexicon };
    kept.add(inst);
    if (anchor[inst]) parent[inst] = anchor[inst];
    for (const o of orphans[inst]) parent[o] = inst;
  }

  // Dependency lines: kept→kept refs that didn't become containment.
  const depEdges: Array<{ from: string; to: string; via?: string; toAttr?: string }> = [];
  const seenEdge = new Set<string>();
  for (const e of ir.edges) {
    if (e.from === e.to || !kept.has(e.from) || !kept.has(e.to)) continue;
    if (e.viaAttr && (LIVES_IN.has(e.viaAttr) || SPANS.has(e.viaAttr))) continue;
    const key = `${e.from}>${e.to}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    depEdges.push({ from: e.from, to: e.to, via: e.viaAttr, toAttr: e.toAttr });
  }

  const children: Record<string, string[]> = {};
  for (const id of kept) if (parent[id]) (children[parent[id]] = children[parent[id]] || []).push(id);

  // Implied edges: the IR may not connect an ingress to its workload (the
  // listener→target-group→service refs aren't captured), but a composite implies
  // it. Within each composite, connect a kept ingress (ALB/gateway) to a kept
  // workload (service/instance/function) when no real ref already links them.
  const implied: Array<{ from: string; to: string }> = [];
  const existing = new Set<string>();
  for (const e of depEdges) { existing.add(`${e.from}>${e.to}`); existing.add(`${e.to}>${e.from}`); }
  const byComposite: Record<string, string[]> = {};
  for (const id of kept) if (composite[id]) (byComposite[composite[id]] = byComposite[composite[id]] || []).push(id);
  for (const members of Object.values(byComposite)) {
    const ingress = members.filter((id) => pack.ingress.test(typeOf(id)));
    const workload = members.filter((id) => pack.workload.test(typeOf(id)));
    for (const i of ingress) for (const w of workload) {
      if (i !== w && !existing.has(`${i}>${w}`)) { implied.push({ from: i, to: w }); existing.add(`${i}>${w}`); }
    }
  }
  // Manually asserted relationships (#28): the IR can't express some links (an
  // ALB→service), so let a caller declare them — drawn as the implied hint.
  for (const e of hints.edges ?? []) {
    if (kept.has(e.from) && kept.has(e.to) && e.from !== e.to && !existing.has(`${e.from}>${e.to}`)) {
      implied.push({ from: e.from, to: e.to });
      existing.add(`${e.from}>${e.to}`);
    }
  }

  // Plumbing (incl. collapsed subnets) is hidden under the place it lives in,
  // else its composite's sub-box — recoverable by expanding that box.
  const hidden: Record<string, string[]> = {};
  for (const n of ir.nodes) {
    if (dropped.has(n.id) || role[n.id] !== "plumbing") continue;
    const h = homeOf(n.id);
    const inst = composite[n.id];
    const home = h && kept.has(h) ? h : inst && kept.has(inst) ? inst : inst ? anchor[inst] : undefined;
    if (home && kept.has(home)) (hidden[home] = hidden[home] || []).push(n.id);
  }
  return { role, kept, meta, parent, children, depEdges, implied, hidden };
}

/** Wrap each top-level root in a synthetic boundary box for its deployable stack
 * (`groups.byStack`), so multiple stacks render box-bounded in one diagram
 * (#42 / chant#513). Only wraps when there are ≥2 stacks — a single stack needs
 * no boundary. A root's stack is its own (a real node) or that of a kept
 * descendant (a synthetic composite box inherits its members' stack). */
function withStackBoxes(a: Analysis, byStack: Record<string, string[]> | undefined): Analysis {
  if (!byStack || Object.keys(byStack).length < 2) return a;
  const stackOf: Record<string, string> = {};
  for (const [s, ids] of Object.entries(byStack)) for (const id of ids) stackOf[id] = s;
  const stackForRoot = (root: string): string | undefined => {
    const seen = new Set<string>();
    const walk = (id: string): string | undefined => {
      if (seen.has(id)) return undefined;
      seen.add(id);
      if (stackOf[id]) return stackOf[id];
      for (const c of a.children[id] ?? []) { const s = walk(c); if (s) return s; }
      return undefined;
    };
    return walk(root);
  };
  const role = { ...a.role };
  const meta = { ...a.meta };
  const parent = { ...a.parent };
  const children: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(a.children)) children[k] = [...v];
  const kept = new Set(a.kept);
  for (const root of [...a.kept].filter((id) => !a.parent[id]).sort()) {
    const s = stackForRoot(root);
    if (!s) continue;
    const boxId = stackBoxId(s);
    if (!kept.has(boxId)) {
      kept.add(boxId);
      role[boxId] = "place";
      meta[boxId] = { kind: "stack", lexicon: s };
      children[boxId] = [];
    }
    parent[root] = boxId;
    children[boxId].push(root);
  }
  return { ...a, role, meta, parent, children, kept };
}
/** Id for a stack's boundary box. Prefixed so it never collides with a node id. */
const stackBoxId = (stack: string): string => `stack·${stack}`;
/** A stack box is a synthetic place whose meta kind is "stack". */
const isStackBox = (id: string, meta: Record<string, { kind: string }>): boolean => meta[id]?.kind === "stack";

/** Collapse one stack to a summary: drop its contents, leave the (now childless)
 * stack box as a compact box, and re-anchor any edge that touched the stack's
 * interior to the box — so a folded stack still shows its cross-stack wiring. */
function collapseStack(a: Analysis, stackBox: string): Analysis {
  const inside = new Set<string>();
  const collect = (id: string): void => { for (const c of a.children[id] ?? []) { inside.add(c); collect(c); } };
  collect(stackBox);
  if (inside.size === 0) return a;

  const kept = new Set([...a.kept].filter((id) => !inside.has(id)));
  const children: Record<string, string[]> = { ...a.children, [stackBox]: [] };
  const parent: Record<string, string> = { ...a.parent };
  for (const id of inside) { delete children[id]; delete parent[id]; }

  const anchor = (id: string): string => (inside.has(id) ? stackBox : id);
  const keep = (e: { from: string; to: string }): boolean => e.from !== e.to && kept.has(e.from) && kept.has(e.to);
  const depEdges = a.depEdges.map((e) => ({ ...e, from: anchor(e.from), to: anchor(e.to) })).filter(keep);
  const seen = new Set<string>();
  const dedup = depEdges.filter((e) => { const k = `${e.from}>${e.to}>${e.via ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const implied = a.implied.map((e) => ({ from: anchor(e.from), to: anchor(e.to) })).filter(keep);

  return { ...a, kept, children, parent, depEdges: dedup, implied };
}

/** Per-node inspector notes for the containment view: what a place *contains*
 * (its kept children) and what plumbing it *hides* (dropped resources that live
 * in it). So clicking a box drills into the detail the salience filter removed. */
export function containmentNotes(ir: GraphIR): Record<string, Array<{ label: string; value: string }>> {
  const { kept, children, hidden } = analyze(ir);
  const notes: Record<string, Array<{ label: string; value: string }>> = {};
  for (const id of kept) {
    const rows: Array<{ label: string; value: string }> = [];
    if (children[id]?.length) rows.push({ label: "contains", value: uniq(children[id]).join(", ") });
    if (hidden[id]?.length) rows.push({ label: "hides", value: uniq(hidden[id]).join(", ") });
    if (rows.length) notes[id] = rows;
  }
  return notes;
}

/** Is this node drawn as a container box (has children, or is a place)? */
function isBox(id: string, children: Record<string, string[]>, role: Record<string, Role>): boolean {
  return (children[id]?.length ?? 0) > 0 || role[id] === "place";
}

/** Nested-grid layout: size bottom-up, place top-down, roots in a row. Pure;
 * reused per expand-state by the interactive view. */
function computeLayout(
  roots: string[],
  children: Record<string, string[]>,
  role: Record<string, Role>,
): { L: Layout; canvasW: number; canvasH: number } {
  const L: Layout = { W: {}, H: {}, X: {}, Y: {}, pack: {} };
  // Size bottom-up with greedy row packing (variable cell widths) so a box hugs
  // its contents instead of an n×n grid of the widest child.
  const size = (id: string): void => {
    const ch = children[id] ?? [];
    if (ch.length === 0) {
      L.W[id] = LEAF_W;
      L.H[id] = LEAF_H;
      return;
    }
    ch.forEach(size);
    const widest = Math.max(...ch.map((c) => L.W[c]));
    const avg = ch.reduce((s, c) => s + L.W[c], 0) / ch.length;
    const target = Math.max(widest, Math.ceil(Math.sqrt(ch.length)) * (avg + GAP));
    const pack: Array<{ y: number; items: Array<{ id: string; x: number; dy: number }> }> = [];
    let row: Array<{ id: string; x: number; dy: number }> = [];
    let rowW = PAD;
    let y = BOX_TITLE + PAD;
    let maxRowW = 0;
    const flush = (): void => {
      if (!row.length) return;
      const rh = Math.max(...row.map((it) => L.H[it.id]));
      for (const it of row) it.dy = (rh - L.H[it.id]) / 2; // centre shorter items in the row band
      pack.push({ y, items: row });
      maxRowW = Math.max(maxRowW, rowW - GAP + PAD);
      y += rh + GAP;
      row = [];
      rowW = PAD;
    };
    for (const c of ch) {
      if (row.length && rowW + L.W[c] > target + PAD) flush();
      row.push({ id: c, x: rowW, dy: 0 });
      rowW += L.W[c] + GAP;
    }
    flush();
    L.W[id] = Math.max(maxRowW, BOX_TITLE);
    let h = y - GAP + PAD;
    // Grow a very wide/short box toward a minimum aspect so it reads as a panel,
    // not a letterbox — distribute the slack as top/bottom padding (capped).
    const slack = Math.min((L.W[id] * MIN_ASPECT - h) / 2, MIN_ASPECT_PAD);
    if (slack > 0) {
      for (const r of pack) r.y += slack;
      h += slack * 2;
    }
    L.H[id] = h;
    L.pack[id] = pack;
  };
  const place = (id: string, x: number, y: number): void => {
    L.X[id] = x;
    L.Y[id] = y;
    for (const r of L.pack[id] ?? []) for (const it of r.items) place(it.id, x + it.x, y + r.y + it.dy);
  };
  roots.forEach(size);
  let rx = MARGIN;
  let maxH = 0;
  for (const r of roots) {
    place(r, rx, MARGIN + TITLE_BAND);
    rx += L.W[r] + GAP * 2;
    maxH = Math.max(maxH, L.H[r]);
  }
  return { L, canvasW: Math.max(rx + MARGIN, 480), canvasH: MARGIN + TITLE_BAND + maxH + MARGIN };
}

/** Render a graph IR as a salience-filtered containment diagram (SVG string). */
export function renderContainment(ir: GraphIR, opts: ContainmentOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const focus = opts.focus ?? "app";
  const { role, kept, meta, parent, children, depEdges, implied } = withStackBoxes(analyze(ir, focus, opts.pack, opts.hints), ir.groups.byStack);
  const roots = [...kept].filter((id) => !parent[id]).sort();
  const { L, canvasW, canvasH } = computeLayout(roots, children, role);

  // Paint: boxes (outer→inner), dependency lines, then leaf badges.
  let boxes = "";
  let badges = "";
  const walk = (id: string): void => {
    if (isBox(id, children, role)) boxes += box(id, L, role[id], meta[id], theme, subtitleFor(id, ir));
    else badges += badge(id, L, role[id], meta[id], theme, focus);
    (children[id] ?? []).forEach(walk);
  };
  roots.forEach(walk);

  // Dependency lines as interactive edge groups — same hooks the HTML artifact
  // uses, so hover shows the reference + ref value and click pins the relationship.
  // Routed around sibling boxes (border anchors + obstacle bow), not center-to-center.
  const obstacleIds = [...kept].filter((id) => id in L.X);
  const route = (from: string, to: string): string => routeEdge(from, to, L, obstaclesFor(from, to, obstacleIds, L, parent));
  let lines = "";
  for (const e of depEdges) lines += depEdgeStr(e.from, e.to, route(e.from, e.to), e.via, e.toAttr, theme);
  for (const e of implied) lines += depEdgeStr(e.from, e.to, route(e.from, e.to), undefined, undefined, theme, true);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(canvasW)} ${Math.ceil(canvasH)}" ` +
    `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">` +
    defs(theme) +
    `<rect width="${Math.ceil(canvasW)}" height="${Math.ceil(canvasH)}" fill="url(#pin-bg)"/>` +
    `<rect width="${Math.ceil(canvasW)}" height="${Math.ceil(canvasH)}" fill="url(#pin-dots)" opacity="0.6"/>` +
    `<text x="${MARGIN}" y="52" fill="${v(theme, "text")}" font-size="22" font-weight="700">${esc(opts.title ?? "Infrastructure")}</text>` +
    boxes +
    lines +
    badges +
    `</svg>`
  );
}

/** A place/container box: rounded rect, a title row with its glyph (and an
 * optional info-bar subtitle, e.g. a VPC's CIDR), children drawn over it. */
/** Distinct AZs across the IR's subnets — a VPC-level "spread" stat. */
function azCount(ir: GraphIR): number {
  const s = new Set<string>();
  for (const n of ir.nodes) {
    const z = (n.attrs as Record<string, unknown> | undefined)?.AvailabilityZone;
    if (/subnet/i.test(n.kind) && typeof z === "string") s.add(z);
  }
  return s.size;
}

/** An enriched place subtitle: CIDR, own AZ, AZ spread (for a VPC), region —
 * whatever the attrs provide, beyond the bare CIDR. */
export function subtitleFor(id: string, ir: GraphIR): string | undefined {
  const n = ir.nodes.find((x) => x.id === id);
  if (!n) return undefined;
  const a = (n.attrs ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const cidr = a.CidrBlock ?? a.cidr;
  if (typeof cidr === "string") parts.push(cidr);
  const az = a.AvailabilityZone ?? a.availabilityZone;
  if (typeof az === "string") parts.push(az);
  if (/vpc|vnet/i.test(n.kind)) { const c = azCount(ir); if (c > 1) parts.push(`${c} AZs`); }
  const region = a.Region ?? a.region;
  if (typeof region === "string") parts.push(region);
  return parts.length ? parts.join(" · ") : undefined;
}

function box(id: string, L: Layout, role: Role, m: { kind: string; lexicon: string }, theme: Theme, subtitle?: string): string {
  const x = L.X[id];
  const y = L.Y[id];
  const w = L.W[id];
  const h = L.H[id];
  // A stack boundary box reads differently: dashed border, the stack name as the
  // label, and a "stack" badge instead of a resource glyph.
  const isStack = m.kind === "stack";
  const label = isStack ? m.lexicon : id;
  const glyph = resolveGlyph({ lexicon: m.lexicon, kind: m.kind });
  const stroke = isStack ? v(theme, "neutralStroke") : role === "place" ? v(theme, "accentStroke") : v(theme, "neutralStroke");
  const dash = isStack ? ` stroke-dasharray="3 4"` : "";
  // only annotate boxes wide enough to hold it, so a CIDR doesn't run off a subnet
  const room = Math.floor((w - 52) / 7.5) - label.length - 3;
  const sub = isStack
    ? `<tspan fill="${v(theme, "textFaint")}" font-weight="400"> stack</tspan>`
    : subtitle && w >= 200 && room > 4 ? `<tspan fill="${v(theme, "textFaint")}" font-weight="400"> · ${esc(clip(subtitle, room))}</tspan>` : "";
  return (
    `<g data-node-id="${esc(id)}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${v(theme, "neutralFill")}" fill-opacity="${isStack ? "0.25" : "0.5"}" stroke="${stroke}" stroke-width="1.4"${dash}/>` +
    (isStack ? "" : glyphAt(glyph.body, x + 14, y + 7, 18, theme)) +
    `<text x="${x + (isStack ? 16 : 40)}" y="${y + 21}" fill="${v(theme, "text")}" font-size="13" font-weight="700">${esc(clip(label, Math.floor((w - 52) / 7.5)))}${sub}</text>` +
    `</g>`
  );
}

/** Focus-driven emphasis for a leaf. By default policies are context (dependency
 * targets, dimmed); under security focus the lens inverts — security policies are
 * the *subject* (bright, accented) and the workload dims to context. */
function emphasis(role: Role, focus: Focus): { context: boolean; subject: boolean } {
  if (focus === "security") return { context: role === "thing", subject: role === "policy" };
  return { context: role === "policy", subject: false };
}

/** A leaf node (thing/policy): glyph badge + a label below it. */
function badge(id: string, L: Layout, role: Role, m: { kind: string; lexicon: string }, theme: Theme, focus: Focus = "app"): string {
  const x = L.X[id];
  const y = L.Y[id];
  const w = L.W[id];
  const cx = x + w / 2;
  const badgeSize = 48;
  const bx = cx - badgeSize / 2;
  const by = y + 6;
  const glyph = resolveGlyph({ lexicon: m.lexicon, kind: m.kind });
  const { context, subject } = emphasis(role, focus);
  const fillOpacity = context ? "0.35" : "1";
  const stroke = subject ? v(theme, "accentStroke") : v(theme, "neutralStroke");
  const bar = subject ? v(theme, "accentBar") : v(theme, "neutralBar");
  return (
    `<g data-node-id="${esc(id)}">` +
    `<rect x="${bx}" y="${by}" width="${badgeSize}" height="${badgeSize}" rx="13" fill="${v(theme, "neutralFill")}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${subject ? 1.8 : 1.4}"/>` +
    `<rect x="${bx}" y="${by}" width="${badgeSize}" height="4" rx="2" fill="${bar}"/>` +
    glyphAt(glyph.body, cx - 13, by + 12, 26, theme) +
    `<text x="${cx}" y="${by + badgeSize + 16}" text-anchor="middle" fill="${v(theme, "text")}" font-size="11" font-weight="600" opacity="${context ? "0.55" : "1"}">${esc(clip(id, Math.floor(w / 6.2)))}</text>` +
    `</g>`
  );
}

/** Place a 0 0 24 24 glyph at (gx,gy), scaled to `size`. */
function glyphAt(body: string, gx: number, gy: number, size: number, theme: Theme): string {
  const k = (size / 24).toFixed(4);
  return (
    `<g transform="translate(${gx} ${gy}) scale(${k})" fill="none" stroke="${v(theme, "textFaint")}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`
  );
}

// ---------------------------------------------------------------------------
// Interactive expandable containment (#9 follow-up): click a place to expand it
// in place and reveal the plumbing the salience filter hid; click again to
// collapse. Leaf nodes are drawn once and glide (FLIP) between states; the box
// and edge layers are pre-rendered per state and swapped.
// ---------------------------------------------------------------------------

/** A leaf badge drawn at the origin (0,0), so a transform can place/move it. */
function originBadge(id: string, role: Role, m: { kind: string; lexicon: string }, theme: Theme, focus: Focus = "app"): string {
  const k = (26 / 24).toFixed(4);
  const { context, subject } = emphasis(role, focus);
  const dim = role === "plumbing" || context ? ` opacity="0.5"` : "";
  const stroke = subject ? v(theme, "accentStroke") : v(theme, "neutralStroke");
  const bar = subject ? v(theme, "accentBar") : v(theme, "neutralBar");
  return (
    `<g class="pin-cnode" data-node-id="${esc(id)}" transform="translate(0,0)" style="opacity:0"${dim}>` +
    `<rect x="-24" y="-24" width="48" height="48" rx="13" fill="${v(theme, "neutralFill")}" stroke="${stroke}" stroke-width="${subject ? 1.8 : 1.4}"/>` +
    `<rect x="-24" y="-24" width="48" height="4" rx="2" fill="${bar}"/>` +
    `<g transform="translate(-13 -12) scale(${k})" fill="none" stroke="${v(theme, "textFaint")}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${resolveGlyph({ lexicon: m.lexicon, kind: m.kind }).body}</g>` +
    `<text class="pin-clabel" y="33" text-anchor="middle" fill="${v(theme, "text")}" font-size="10" font-weight="600">${esc(clip(id, 14))}</text>` +
    `</g>`
  );
}

/** An interactive edge group between two centres. A real reference is a dashed
 * line in the edge colour; an `implied` edge (composite-inferred, e.g. an ALB
 * fronting its service) is a dotted accent line, flagged for the tooltip. */
export interface Rect { x: number; y: number; w: number; h: number }
const rectOf = (L: Layout, id: string): Rect => ({ x: L.X[id], y: L.Y[id], w: L.W[id], h: L.H[id] });
const rnd = (n: number): number => Math.round(n * 10) / 10;

/** The point on a rect's border along the ray from its center toward `t` — so an
 * edge meets the box at its edge, not buried in the middle. */
export function borderAnchor(r: Rect, t: { x: number; y: number }): { x: number; y: number } {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = t.x - cx, dy = t.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Does segment a→b cross rect `r` (grown by `pad`)? Liang–Barsky clip test. */
export function segHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect, pad = 0): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - (r.x - pad)],
    [dx, r.x + r.w + pad - a.x],
    [-dy, a.y - (r.y - pad)],
    [dy, r.y + r.h + pad - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // parallel and outside this slab
      continue;
    }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}

const CLEAR = 16;
const cubic = (a: { x: number; y: number }, c1: { x: number; y: number }, c2: { x: number; y: number }, b: { x: number; y: number }): string =>
  `M ${rnd(a.x)} ${rnd(a.y)} C ${rnd(c1.x)} ${rnd(c1.y)}, ${rnd(c2.x)} ${rnd(c2.y)}, ${rnd(b.x)} ${rnd(b.y)}`;

/** Route an edge from box→box, clear of sibling boxes. Pure SVG so the static
 * `-o` export routes identically to the artifact.
 *
 * - no obstacle  → a gentle vertical S-curve between border anchors;
 * - stacked (endpoints mostly vertically apart) → bow to the side with less room;
 * - straddle (endpoints on opposite horizontal sides) → arc over/under, since a
 *   side bow can't clear an obstacle the line's endpoints flank.
 */
export function routeEdge(from: string, to: string, L: Layout, obstacles: Rect[]): string {
  const ra = rectOf(L, from), rb = rectOf(L, to);
  const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
  const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
  const side = borderAnchor(ra, cb), sideB = borderAnchor(rb, ca);
  const blockers = obstacles.filter((o) => segHitsRect(side, sideB, o, 6));
  if (!blockers.length) {
    const my = (side.y + sideB.y) / 2;
    return cubic(side, { x: side.x, y: my }, { x: sideB.x, y: my }, sideB);
  }

  // Straddle: the line spans the obstacle horizontally more than vertically — a
  // side bow would still cut through, so arc over the top or under the bottom.
  if (Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y)) {
    const minT = Math.min(...blockers.map((o) => o.y));
    const maxB = Math.max(...blockers.map((o) => o.y + o.h));
    const midY = (ca.y + cb.y) / 2;
    // Cost = vertical excursion to crest; veto going over if it'd leave the canvas top.
    const overCost = minT - CLEAR < 4 ? Infinity : midY - (minT - CLEAR);
    const goOver = overCost <= maxB + CLEAR - midY;
    // Anchor on the top (or bottom) edge centers and lift the controls so the
    // curve crests past the obstacle by ~CLEAR (the cubic peaks at ¾ of the way).
    const a = { x: ca.x, y: goOver ? ra.y : ra.y + ra.h };
    const b = { x: cb.x, y: goOver ? rb.y : rb.y + rb.h };
    const crest = goOver ? minT - CLEAR : maxB + CLEAR;
    const cy = (crest - 0.25 * (a.y + b.y) / 2) / 0.75; // solve peak = crest
    return cubic(a, { x: a.x, y: cy }, { x: b.x, y: cy }, b);
  }

  // Stacked: bow to whichever side needs the shorter excursion.
  const leftX = Math.min(...blockers.map((o) => o.x)) - CLEAR;
  const rightX = Math.max(...blockers.map((o) => o.x + o.w)) + CLEAR;
  const avgX = (side.x + sideB.x) / 2;
  const midX = avgX - leftX <= rightX - avgX ? leftX : rightX;
  return cubic(side, { x: midX, y: side.y }, { x: midX, y: sideB.y }, sideB);
}

/** Obstacle rects for an edge: every rendered box/badge except the endpoints and
 * their container ancestors (which legitimately enclose the line). */
function obstaclesFor(from: string, to: string, ids: string[], L: Layout, parent: Record<string, string>): Rect[] {
  const skip = new Set<string>([from, to]);
  for (const end of [from, to]) for (let c = parent[end]; c; c = parent[c]) skip.add(c);
  return ids.filter((id) => !skip.has(id) && id in L.X).map((id) => rectOf(L, id));
}

function depEdgeStr(from: string, to: string, d: string, via: string | undefined, toAttr: string | undefined, theme: Theme, implied = false): string {
  const attrs =
    ` data-edge-from="${esc(from)}" data-edge-to="${esc(to)}"` +
    (via ? ` data-edge-via="${esc(via)}"` : "") +
    (toAttr ? ` data-edge-to-attr="${esc(toAttr)}"` : "") +
    (implied ? ` data-edge-implied="1"` : "");
  const stroke = implied ? v(theme, "accentBar") : v(theme, "edge");
  const dash = implied ? "2 5" : "5 5";
  const op = implied ? ` opacity="0.75"` : "";
  return (
    `<g${attrs}><path class="pin-edge-line" d="${esc(d)}" fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="${dash}"${op}/>` +
    `<path d="${esc(d)}" fill="none" stroke="transparent" stroke-width="14" stroke-linecap="round" pointer-events="stroke"/></g>`
  );
}

function jsonScriptC(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Build the interactive expandable containment artifact (offline HTML). */
export function renderContainmentApp(ir: GraphIR, opts: ContainmentOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const title = opts.title ?? "Infrastructure";

  // State 0 is the primary (app, or security when that's the lens); state 1 is
  // "network" (subnets/route tables become structured boxes). Beyond those, each
  // box that collapsed members gets its *own* expanded state that un-collapses
  // them in place. Clicking a box toggles to its expanded state. Leaf nodes are
  // drawn once and glide between states.
  const focus = opts.focus ?? "app";
  const primaryFocus: Focus = focus === "security" ? "security" : "app";
  const wrap = (a: Analysis): Analysis => withStackBoxes(a, ir.groups.byStack);
  const primary = wrap(analyze(ir, primaryFocus, opts.pack, opts.hints));
  const variants = [primary, wrap(analyze(ir, "network", opts.pack, opts.hints))];
  const realNodes = new Set(ir.nodes.map((n) => n.id));
  const expandIndex: Record<string, number> = {};
  // A real place (the VPC) toggles to the structured network view (state 1).
  for (const id of primary.kept) if (realNodes.has(id) && primary.role[id] === "place") expandIndex[id] = 1;
  // Any *other* box that hid members (a composite sub-box, e.g. the ALB group's
  // listener + execution role) gets a dedicated expanded variant: force its
  // hidden members kept (role override) so they nest inside it, revealed in place.
  for (const [box, ids] of Object.entries(primary.hidden)) {
    if (box in expandIndex || ids.length === 0) continue;
    const roles: Record<string, Role> = { ...(opts.hints?.roles ?? {}) };
    for (const hid of ids) roles[hid] = "thing";
    expandIndex[box] = variants.length;
    variants.push(wrap(analyze(ir, primaryFocus, opts.pack, { ...opts.hints, roles })));
  }
  // Multi-stack: each stack box folds to a summary. Clicking it collapses the
  // stack's contents (others stay full, re-laid out) and re-anchors its
  // cross-stack edges to the folded box — same single-active toggle as the boxes.
  const stackBoxes = [...primary.kept].filter((id) => isStackBox(id, primary.meta));
  if (stackBoxes.length >= 2) {
    for (const sb of stackBoxes) {
      if (sb in expandIndex) continue;
      expandIndex[sb] = variants.length;
      variants.push(collapseStack(primary, sb));
    }
  }
  const subtitleOf = (id: string): string | undefined => subtitleFor(id, ir);
  const center = (L: Layout, id: string) => ({ x: Math.round(L.X[id] + L.W[id] / 2), y: Math.round(L.Y[id] + L.H[id] / 2) });

  // Pass 1 — lay out each variant; collect which ids are boxes vs leaves anywhere.
  let maxW = 480;
  let maxH = 300;
  const boxAny = new Set<string>();
  const leafAny = new Set<string>();
  const metaOf: Record<string, { kind: string; lexicon: string }> = {};
  const roleOf: Record<string, Role> = {};
  const laid = variants.map((a) => {
    const roots = [...a.kept].filter((id) => !a.parent[id]).sort();
    const { L, canvasW, canvasH } = computeLayout(roots, a.children, a.role);
    maxW = Math.max(maxW, canvasW);
    maxH = Math.max(maxH, canvasH);
    const walk = (id: string): void => {
      (isBox(id, a.children, a.role) ? boxAny : leafAny).add(id);
      if (!metaOf[id]) { metaOf[id] = a.meta[id]; roleOf[id] = a.role[id]; }
      (a.children[id] ?? []).forEach(walk);
    };
    roots.forEach(walk);
    return { a, L, roots };
  });
  // A node that is ever a box is rendered as a per-state box; the rest are leaf
  // badges drawn once and moved/faded between states.
  const badgeIds = [...leafAny].filter((id) => !boxAny.has(id));

  // Pass 2 — per-state box/edge HTML + leaf positions.
  const states = laid.map(({ a, L, roots }) => {
    let boxesHtml = "";
    const walk = (id: string): void => {
      if (isBox(id, a.children, a.role)) boxesHtml += box(id, L, a.role[id], a.meta[id], theme, subtitleOf(id));
      (a.children[id] ?? []).forEach(walk);
    };
    roots.forEach(walk);
    const pos: Record<string, { x: number; y: number }> = {};
    for (const id of badgeIds) if (id in L.X) pos[id] = center(L, id);
    const obstacleIds = [...a.kept].filter((id) => id in L.X);
    const route = (from: string, to: string): string => routeEdge(from, to, L, obstaclesFor(from, to, obstacleIds, L, a.parent));
    let edgesHtml = "";
    for (const e of a.depEdges) {
      if (!(e.from in L.X) || !(e.to in L.X)) continue;
      edgesHtml += depEdgeStr(e.from, e.to, route(e.from, e.to), e.via, e.toAttr, theme);
    }
    for (const e of a.implied) {
      if (!(e.from in L.X) || !(e.to in L.X)) continue;
      edgesHtml += depEdgeStr(e.from, e.to, route(e.from, e.to), undefined, undefined, theme, true);
    }
    return { boxes: boxesHtml, edges: edgesHtml, pos };
  });
  // the network view (index 1) is dense → badges go icon-only (label on hover).
  const stateMeta = states.map((s, i) => ({ ...s, dense: i === 1 }));

  const badges = badgeIds.map((id) => originBadge(id, roleOf[id], metaOf[id], theme, focus)).join("");

  const startState = focus === "network" ? 1 : 0;

  const META: Record<string, { kind: string; lexicon: string; attrs: unknown }> = {};
  for (const n of ir.nodes) META[n.id] = { kind: n.kind, lexicon: n.lexicon, attrs: n.attrs };

  // Per-box drill-down: what each box collapsed (its hidden plumbing/glue), so a
  // click can reveal it. Merge the hidden sets across states — a node revealed as
  // a structured box in the network view is still "collapsed" from the app view,
  // and the composite boxes' glue (a listener, an SG) is collapsed in every view.
  const drill: Record<string, Array<{ id: string; kind: string }>> = {};
  for (const a of variants) {
    for (const [place, ids] of Object.entries(a.hidden)) {
      const seen = new Set((drill[place] ??= []).map((d) => d.id));
      for (const hid of ids) if (!seen.has(hid)) { drill[place].push({ id: hid, kind: META[hid]?.kind ?? "" }); seen.add(hid); }
    }
  }

  const themeOptions = Object.keys(THEMES).map((n) => `<option value="${esc(n)}"${n === theme.name ? " selected" : ""}>${esc(n)}</option>`).join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(maxW)} ${Math.ceil(maxH)}" ` +
    `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">` +
    defs(theme) +
    `<rect width="${Math.ceil(maxW)}" height="${Math.ceil(maxH)}" fill="url(#pin-bg)"/>` +
    `<rect width="${Math.ceil(maxW)}" height="${Math.ceil(maxH)}" fill="url(#pin-dots)" opacity="0.6"/>` +
    `<text x="60" y="52" fill="${v(theme, "text")}" font-size="22" font-weight="700">${esc(title)}</text>` +
    `<g id="pin-boxes"></g><g id="pin-edges"></g>${badges}</svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · pinhole containment</title>
${CONTAIN_CSS}
</head>
<body>
<header class="pin-bar">
  <h1>${esc(title)}</h1>
  <span class="pin-hint">click a box to expand what it collapsed · click a stack box to fold the whole stack</span>
  <label class="pin-theme">theme <select id="pin-theme-select">${themeOptions}</select></label>
</header>
<main class="pin-stage" id="pin-stage">${svg}</main>
<div class="pin-tooltip" id="pin-tooltip" hidden></div>
<div class="pin-backdrop" id="pin-backdrop" hidden>
  <aside class="pin-inspector" id="pin-inspector" role="dialog" aria-modal="true">
    <button class="pin-close" id="pin-close" aria-label="Close inspector">&times;</button>
    <div id="pin-inspector-body"></div>
  </aside>
</div>
<script>
const THEMES = ${jsonScriptC(Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, t.tokens])))};
const STATES = ${jsonScriptC(stateMeta)};
const EXPAND = ${jsonScriptC(expandIndex)};
const META = ${jsonScriptC(META)};
const DRILL = ${jsonScriptC(drill)};
const START = ${startState};
${CONTAIN_JS}
</script>
</body>
</html>
`;
}

const CONTAIN_CSS = `<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--pin-text, #E6EDF3); background: var(--pin-bg0, #0B0E14); }
  .pin-bar { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--pin-neutralStroke, #252C38); background: var(--pin-bg1, #0F141D); position: sticky; top: 0; z-index: 5; }
  .pin-bar h1 { margin: 0; font-size: 16px; font-weight: 700; }
  .pin-hint { font-size: 12px; color: var(--pin-textFaint, #8A93A3); }
  .pin-theme { margin-left: auto; font-size: 12px; color: var(--pin-textMuted, #7A8699); display: flex; gap: 8px; align-items: center; }
  .pin-theme select { font: inherit; color: var(--pin-text, #E6EDF3); background: var(--pin-neutralFill, #161B24); border: 1px solid var(--pin-neutralStroke, #252C38); border-radius: 6px; padding: 4px 8px; }
  .pin-stage { padding: 16px; }
  .pin-stage svg { max-width: 100%; height: auto; display: block; }
  .pin-cnode { transition: transform .55s cubic-bezier(.4,0,.2,1), opacity .35s ease; cursor: pointer; }
  .pin-cnode.pin-instant { transition: none; }
  .pin-cnode:hover { filter: drop-shadow(0 0 6px var(--pin-accentBar, #4C8DFF)); }
  .pin-stage.pin-dense .pin-clabel { display: none; } /* dense (network) view: icon-only, label on hover */
  .pin-implied { opacity: .75; }
  #pin-boxes [data-node-id] { cursor: pointer; }
  #pin-boxes [data-node-id]:hover rect { stroke: var(--pin-accentBar, #4C8DFF); }
  .pin-edge-line { transition: opacity .3s ease; }
  [data-edge-from]:hover .pin-edge-line { stroke: var(--pin-accentBar, #4C8DFF); stroke-width: 2.4; }
  .pin-tooltip { position: fixed; z-index: 10; pointer-events: none; padding: 4px 8px; border-radius: 6px; font-size: 12px; color: var(--pin-text, #E6EDF3); background: var(--pin-neutralFill, #161B24); border: 1px solid var(--pin-neutralStroke, #252C38); box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .pin-tooltip b { color: var(--pin-accentBar, #4C8DFF); }
  .pin-tooltip .pin-ref { display: block; margin-top: 3px; color: var(--pin-textMuted, #7A8699); font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
  .pin-backdrop { position: fixed; inset: 0; z-index: 8; padding: 24px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); }
  .pin-backdrop[hidden] { display: none; }
  .pin-inspector { width: 680px; max-width: 92vw; max-height: 82vh; overflow: auto; padding: 20px 24px 24px; background: var(--pin-bg1, #0F141D); border: 1px solid var(--pin-neutralStroke, #252C38); border-radius: 14px; box-shadow: 0 24px 64px rgba(0,0,0,.5); }
  .pin-close { float: right; font-size: 22px; line-height: 1; cursor: pointer; color: var(--pin-textMuted, #7A8699); background: none; border: 0; }
  .pin-inspector h2 { margin: 0 0 2px; font-size: 18px; word-break: break-all; }
  .pin-inspector .pin-sub { color: var(--pin-textFaint, #8A93A3); font-size: 12.5px; margin-bottom: 16px; }
  .pin-inspector .pin-section { margin: 18px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--pin-textFaint, #8A93A3); }
  .pin-attrs { display: flex; flex-direction: column; gap: 10px; }
  .pin-attr .k { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--pin-textFaint, #8A93A3); font-size: 11.5px; word-break: break-all; }
  .pin-attr .v { margin-top: 1px; color: var(--pin-textMuted, #7A8699); font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; overflow: auto; max-height: 240px; }
  .pin-attr .v.ref { color: var(--pin-accentBar, #4C8DFF); }
  .pin-copy { flex: none; cursor: pointer; background: none; border: 1px solid var(--pin-neutralStroke, #252C38); border-radius: 5px; color: var(--pin-textFaint, #8A93A3); font-size: 10px; padding: 1px 6px; }
  .pin-copy:hover { color: var(--pin-textMuted, #7A8699); }
  .pin-copy.copied { color: var(--pin-accentBar, #4C8DFF); border-color: var(--pin-accentBar, #4C8DFF); }
  .pin-drill { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; max-height: 220px; overflow: auto; }
  .pin-drill li { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 4px 8px; border-radius: 6px; background: var(--pin-neutralFill, #1A2230); }
  .pin-drill .pin-did { color: var(--pin-textMuted, #7A8699); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .pin-drill .pin-dk { color: var(--pin-textFaint, #8A93A3); white-space: nowrap; }
</style>`;

const CONTAIN_JS = String.raw`
const root = document.documentElement;
const stage = document.getElementById("pin-stage");
const tip = document.getElementById("pin-tooltip");
const boxLayer = document.getElementById("pin-boxes");
const edgeLayer = document.getElementById("pin-edges");
const backdrop = document.getElementById("pin-backdrop");
const inspectorBody = document.getElementById("pin-inspector-body");
const cnodes = {};
stage.querySelectorAll(".pin-cnode").forEach((el) => { cnodes[el.getAttribute("data-node-id")] = el; });
let cur = -1;

document.getElementById("pin-theme-select").addEventListener("change", (e) => {
  const t = THEMES[e.target.value]; if (!t) return;
  for (const k in t) root.style.setProperty("--pin-" + k, t[k]);
});

function applyState(i, instant) {
  const s = STATES[i]; if (!s) return;
  cur = i;
  stage.classList.toggle("pin-dense", !!s.dense);
  boxLayer.innerHTML = s.boxes;
  edgeLayer.innerHTML = s.edges;
  for (const id in cnodes) {
    const g = cnodes[id];
    if (instant) g.classList.add("pin-instant");
    const p = s.pos[id];
    if (p) { g.style.transform = "translate(" + p.x + "px," + p.y + "px)"; g.style.opacity = (META[id] && isPlumbing(id)) ? "0.6" : "1"; }
    else { g.style.opacity = "0"; }
    if (instant) requestAnimationFrame(() => g.classList.remove("pin-instant"));
  }
}
function isPlumbing(id) { return !(id in EXPAND) && STATES[0].pos[id] === undefined && true; }

function nodeFrom(t) { return t && t.closest ? t.closest("[data-node-id]") : null; }
function edgeFrom(t) { return t && t.closest ? t.closest("[data-edge-from]") : null; }

stage.addEventListener("click", (e) => {
  const ed = edgeFrom(e.target);
  if (ed) { openInspector(edgeBody(ed)); return; }
  const nd = nodeFrom(e.target);
  if (!nd) return;
  const id = nd.getAttribute("data-node-id");
  if (id in EXPAND) { applyState(cur === EXPAND[id] ? 0 : EXPAND[id], false); return; }
  if (META[id]) openInspector(nodeBody(id, META[id]));
});

stage.addEventListener("mousemove", (e) => {
  const nd = nodeFrom(e.target);
  if (nd && (!cnodes[nd.getAttribute("data-node-id")] || cnodes[nd.getAttribute("data-node-id")].style.opacity !== "0")) {
    const id = nd.getAttribute("data-node-id"); const m = META[id];
    tip.innerHTML = m ? "<b>" + esc(id) + "</b> · " + esc(m.kind) : "<b>" + esc(id) + "</b>";
    return tipAt(e);
  }
  const ed = edgeFrom(e.target);
  if (ed) {
    const from = ed.getAttribute("data-edge-from"), to = ed.getAttribute("data-edge-to"), via = ed.getAttribute("data-edge-via"), ta = ed.getAttribute("data-edge-to-attr");
    const detail = ed.getAttribute("data-edge-implied")
      ? "<span class='pin-ref'>implied — created in the same composite</span>"
      : "<span class='pin-ref'>" + esc(refValue(from, via, to, ta)) + "</span>";
    tip.innerHTML = "<b>" + esc(from) + "</b>" + (via ? "." + esc(via) : "") + " &rarr; <b>" + esc(to) + "</b>" + (ta ? "." + esc(ta) : "") + detail;
    return tipAt(e);
  }
  tip.hidden = true;
});
stage.addEventListener("mouseleave", () => { tip.hidden = true; });
function tipAt(e) { tip.hidden = false; tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY + 14) + "px"; }

function refValue(from, via, to, toAttr) {
  if (toAttr) return to + "." + toAttr;
  const n = META[from]; const val = n && n.attrs && via ? n.attrs[via] : null;
  const pick = (x) => (x && typeof x === "object" && "$ref" in x ? x["$ref"] : null);
  if (Array.isArray(val)) { for (const it of val) { const r = pick(it); if (r && r.indexOf(to + ".") === 0) return r; } }
  return pick(val) || to;
}
function openInspector(html) { inspectorBody.innerHTML = html; backdrop.hidden = false; }
document.getElementById("pin-close").addEventListener("click", () => { backdrop.hidden = true; });
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") backdrop.hidden = true; });

function nodeBody(id, m) {
  let h = "<h2>" + esc(id) + "</h2><div class='pin-sub'>" + esc(m.kind) + " · " + esc(m.lexicon) + "</div>";
  // Drill-down: what this box collapsed (silenced plumbing/glue), with kinds.
  const drill = DRILL[id];
  if (drill && drill.length) {
    const isVpc = EXPAND[id] != null;
    h += "<div class='pin-section'>collapsed · " + drill.length + (isVpc ? " (click the box to reveal the network)" : "") + "</div>";
    h += "<ul class='pin-drill'>" + drill.map((d) => "<li><span class='pin-did'>" + esc(d.id) + "</span><span class='pin-dk'>" + esc(d.kind) + "</span></li>").join("") + "</ul>";
  }
  const attrs = m.attrs || {}; const keys = Object.keys(attrs);
  if (keys.length) h += "<div class='pin-section'>attributes</div><div class='pin-attrs'>" + keys.map((k) => attrRow(k, attrs[k])).join("") + "</div>";
  return h;
}
function edgeBody(ed) {
  const from = ed.getAttribute("data-edge-from"), to = ed.getAttribute("data-edge-to"), via = ed.getAttribute("data-edge-via"), ta = ed.getAttribute("data-edge-to-attr");
  const k = (m) => (m ? " · " + m.kind : "");
  if (ed.getAttribute("data-edge-implied")) {
    return "<h2>" + esc(from) + " &rarr; " + esc(to) + "</h2><div class='pin-sub'>implied relationship</div><div class='pin-attrs'>" +
      attrRow("ingress", from + k(META[from])) + attrRow("workload", to + k(META[to])) +
      attrRow("source", "inferred from the composite — the IR has no direct reference") + "</div>";
  }
  return "<h2>" + esc(from) + " &rarr; " + esc(to) + "</h2><div class='pin-sub'>reference</div><div class='pin-attrs'>" +
    attrRow("consumer", from + k(META[from])) + attrRow("via", via || "—") + attrRow("producer", to + k(META[to])) + attrRow("ref", refValue(from, via, to, ta)) + "</div>";
}
function attrRow(key, value) {
  const ref = value && typeof value === "object" && "$ref" in value;
  return "<div class='pin-attr'><div class='k'><span>" + esc(key) + "</span><button class='pin-copy' type='button'>copy</button></div><div class='" + (ref ? "v ref" : "v") + "'>" + esc(fmt(value)) + "</div></div>";
}
function fmt(v) { if (v == null) return String(v); if (typeof v === "object") return "$ref" in v ? "→ " + v["$ref"] : JSON.stringify(v, null, 2); return String(v); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function copyText(text, btn) {
  const flash = () => { if (!btn) return; const prev = btn.textContent; btn.textContent = "copied"; btn.classList.add("copied"); setTimeout(() => { btn.textContent = prev; btn.classList.remove("copied"); }, 1100); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(flash, () => fallbackCopy(text, flash));
  else fallbackCopy(text, flash);
}
function fallbackCopy(text, flash) {
  const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); flash(); } catch (e) { /* no clipboard */ }
  document.body.removeChild(ta);
}
document.addEventListener("click", function (e) {
  const btn = e.target.closest && e.target.closest(".pin-copy");
  if (!btn) return;
  e.stopPropagation();
  const attr = btn.closest(".pin-attr"); const v = attr && attr.querySelector(".v");
  if (v) copyText(v.textContent, btn);
});

applyState(typeof START === "number" ? START : 0, true);
`;

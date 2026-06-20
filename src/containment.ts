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
import { getTheme, v, defs, type Theme } from "./theme.ts";
import { resolveGlyph } from "./icons.ts";
import { clip, esc } from "./paint/svg.ts";

export type Role = "place" | "policy" | "thing" | "plumbing";

const ROLE_RULES: Array<[RegExp, Role]> = [
  // plumbing first — these would otherwise look like things/places
  [/routetable|\broute\b|routeassociation|gatewayattachment|internetgateway|natgateway|\beip\b|elasticip|dbsubnetgroup|ingress|egress|\bacl\b/, "plumbing"],
  [/\bvpc|\bvnet|subnet/, "place"],
  [/securitygroup|firewall|\bwaf|networkacl/, "policy"],
];

/** Classify a resource kind into a diagram role. Defaults to "thing". */
export function roleForKind(kind: string): Role {
  const k = kind.toLowerCase();
  for (const [re, role] of ROLE_RULES) if (re.test(k)) return role;
  return "thing";
}

/** Consumer-side attrs that mean "lives in" (containment), not "uses" (dependency). */
const LIVES_IN = new Set(["VpcId", "SubnetId"]);

const MARGIN = 60;
const TITLE_BAND = 84;
const LEAF_W = 124;
const LEAF_H = 86;
const PAD = 16;
const BOX_TITLE = 30;
const GAP = 18;

export interface ContainmentOptions {
  title?: string;
  theme?: Theme;
}

interface Layout {
  W: Record<string, number>;
  H: Record<string, number>;
  X: Record<string, number>;
  Y: Record<string, number>;
  grid: Record<string, { cols: number; cellW: number; cellH: number }>;
}

/** Render a graph IR as a salience-filtered containment diagram (SVG string). */
export function renderContainment(ir: GraphIR, opts: ContainmentOptions = {}): string {
  const theme = opts.theme ?? getTheme();

  // 1. Salience: keep everything that isn't plumbing.
  const role: Record<string, Role> = {};
  const kept = new Set<string>();
  const meta: Record<string, { kind: string; lexicon: string }> = {};
  for (const n of ir.nodes) {
    role[n.id] = roleForKind(n.kind);
    meta[n.id] = { kind: n.kind, lexicon: n.lexicon };
    if (role[n.id] !== "plumbing") kept.add(n.id);
  }

  // 2. Containment: a lives-in edge (kept→kept) gives a parent.
  const parent: Record<string, string> = {};
  const children: Record<string, string[]> = {};
  const depEdges: Array<{ from: string; to: string }> = [];
  for (const e of ir.edges) {
    if (!kept.has(e.from) || !kept.has(e.to) || e.from === e.to) continue;
    if (e.viaAttr && LIVES_IN.has(e.viaAttr) && !parent[e.from]) {
      parent[e.from] = e.to;
      (children[e.to] = children[e.to] || []).push(e.from);
    } else {
      depEdges.push({ from: e.from, to: e.to });
    }
  }
  const roots = [...kept].filter((id) => !parent[id]).sort();

  // 3. Layout: size bottom-up (nested grid), then place top-down.
  const L: Layout = { W: {}, H: {}, X: {}, Y: {}, grid: {} };
  const isBox = (id: string): boolean => (children[id]?.length ?? 0) > 0 || role[id] === "place";
  const size = (id: string): void => {
    const ch = children[id] ?? [];
    if (ch.length === 0) {
      L.W[id] = isBox(id) ? LEAF_W : LEAF_W;
      L.H[id] = isBox(id) ? LEAF_H : LEAF_H;
      return;
    }
    ch.forEach(size);
    const cols = Math.ceil(Math.sqrt(ch.length));
    const cellW = Math.max(...ch.map((c) => L.W[c]));
    const cellH = Math.max(...ch.map((c) => L.H[c]));
    const rows = Math.ceil(ch.length / cols);
    L.W[id] = cols * cellW + (cols - 1) * GAP + 2 * PAD;
    L.H[id] = BOX_TITLE + rows * cellH + (rows - 1) * GAP + 2 * PAD;
    L.grid[id] = { cols, cellW, cellH };
  };
  const place = (id: string, x: number, y: number): void => {
    L.X[id] = x;
    L.Y[id] = y;
    const ch = children[id] ?? [];
    if (ch.length === 0) return;
    const { cols, cellW, cellH } = L.grid[id];
    const cx0 = x + PAD;
    const cy0 = y + BOX_TITLE + PAD;
    ch.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cellX = cx0 + col * (cellW + GAP);
      const cellY = cy0 + row * (cellH + GAP);
      place(c, cellX + (cellW - L.W[c]) / 2, cellY + (cellH - L.H[c]) / 2);
    });
  };
  roots.forEach(size);
  let rx = MARGIN;
  let maxH = 0;
  for (const r of roots) {
    place(r, rx, MARGIN + TITLE_BAND);
    rx += L.W[r] + GAP * 2;
    maxH = Math.max(maxH, L.H[r]);
  }
  const canvasW = Math.max(rx + MARGIN, 480);
  const canvasH = MARGIN + TITLE_BAND + maxH + MARGIN;

  // 4. Paint: boxes (outer→inner), dependency lines, then leaf badges.
  const center = (id: string): { x: number; y: number } => ({ x: L.X[id] + L.W[id] / 2, y: L.Y[id] + L.H[id] / 2 });
  let boxes = "";
  let badges = "";
  const walk = (id: string): void => {
    if (isBox(id)) boxes += box(id, L, role[id], meta[id], theme);
    else badges += badge(id, L, role[id], meta[id], theme);
    (children[id] ?? []).forEach(walk);
  };
  roots.forEach(walk);

  let lines = "";
  for (const e of depEdges) {
    const a = center(e.from);
    const b = center(e.to);
    lines += `<path d="M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}" fill="none" stroke="${v(theme, "edge")}" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="5 5"/>`;
  }

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

/** A place/container box: rounded rect, a title row with its glyph, children
 * drawn separately on top. */
function box(id: string, L: Layout, role: Role, m: { kind: string; lexicon: string }, theme: Theme): string {
  const x = L.X[id];
  const y = L.Y[id];
  const w = L.W[id];
  const h = L.H[id];
  const glyph = resolveGlyph({ lexicon: m.lexicon, kind: m.kind });
  const stroke = role === "place" ? v(theme, "accentStroke") : v(theme, "neutralStroke");
  return (
    `<g data-node-id="${esc(id)}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${v(theme, "neutralFill")}" fill-opacity="0.5" stroke="${stroke}" stroke-width="1.4"/>` +
    glyphAt(glyph.body, x + 14, y + 7, 18, theme) +
    `<text x="${x + 40}" y="${y + 21}" fill="${v(theme, "text")}" font-size="13" font-weight="700">${esc(clip(id, Math.floor((w - 52) / 7.5)))}</text>` +
    `</g>`
  );
}

/** A leaf node (thing/policy): glyph badge + a label below it. Policies render
 * dimmer (they're dependency targets, not primary things). */
function badge(id: string, L: Layout, role: Role, m: { kind: string; lexicon: string }, theme: Theme): string {
  const x = L.X[id];
  const y = L.Y[id];
  const w = L.W[id];
  const cx = x + w / 2;
  const badgeSize = 48;
  const bx = cx - badgeSize / 2;
  const by = y + 6;
  const glyph = resolveGlyph({ lexicon: m.lexicon, kind: m.kind });
  const fillOpacity = role === "policy" ? "0.35" : "1";
  return (
    `<g data-node-id="${esc(id)}">` +
    `<rect x="${bx}" y="${by}" width="${badgeSize}" height="${badgeSize}" rx="13" fill="${v(theme, "neutralFill")}" fill-opacity="${fillOpacity}" stroke="${v(theme, "neutralStroke")}" stroke-width="1.4"/>` +
    `<rect x="${bx}" y="${by}" width="${badgeSize}" height="4" rx="2" fill="${v(theme, "neutralBar")}"/>` +
    glyphAt(glyph.body, cx - 13, by + 12, 26, theme) +
    `<text x="${cx}" y="${by + badgeSize + 16}" text-anchor="middle" fill="${v(theme, "text")}" font-size="11" font-weight="600">${esc(clip(id, Math.floor(w / 6.2)))}</text>` +
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

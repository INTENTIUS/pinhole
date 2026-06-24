/**
 * Flow / topology lens (#50) — the *other* view. Where the tier-zoom answers
 * "what did I declare and what's inside it" (structure / provenance), this answers
 * the questions a normal architecture diagram answers — **how does traffic get
 * in, what's public vs private, where does it flow**. Same IR (the declarable
 * tier), a different read: lay subjects out along the request path
 * (internet → ingress → workload → data) and band them public vs private.
 *
 * Two bits of CF-semantic interpretation the structure view doesn't need:
 *  - **public vs private** is derived structurally — a subnet is public if its
 *    route table routes to an internet gateway, private if to a NAT;
 *  - the **ingress → workload → data** path is *implied* (the IR rarely carries
 *    listener→target→service or app→db as clean refs), the same inference the
 *    salience view used. A v1: heuristic but legible.
 */
import type { GraphIR, IRNode } from "./ir.ts";
import { getTheme, v, defs, type Theme } from "./theme.ts";
import { resolveGlyph } from "./icons.ts";
import { clip, esc } from "./paint/svg.ts";
import { defaultPack, type SaliencePack } from "./pack.ts";
import { roleForKind } from "./containment.ts";

/** Data stores that anchor the "data" stage — broader than the salience pack's
 * `valuable` (which a flow diagram treats as the request's destination). */
const DATA = /\bbucket\b|database|\bdb|\brds\b|dbinstance|dbcluster|\btable\b|\bqueue\b|topic|\bcache\b|filesystem|\befs\b|secret|repository|registry|\bstream\b|\bvolume\b/;

export interface FlowOptions { title?: string; theme?: Theme; pack?: SaliencePack }

const typeOf = (n: IRNode): string => (n.kind.split("::").pop() ?? n.kind).toLowerCase();

/** Which subnets are public (route table → internet gateway) vs private (→ NAT). */
function subnetZones(ir: GraphIR): Record<string, "public" | "private"> {
  const kind: Record<string, string> = {};
  for (const n of ir.nodes) kind[n.id] = typeOf(n);
  // route → its route table, route → its gateway target
  const routeRt: Record<string, string> = {};
  const rtZone: Record<string, "public" | "private"> = {};
  for (const e of ir.edges) {
    if (kind[e.from] !== "route") continue;
    if (e.viaAttr === "RouteTableId") routeRt[e.from] = e.to;
    if (kind[e.to] === "internetgateway") rtZone[routeRt[e.from] ?? ""] = "public";
    if (kind[e.to] === "natgateway") rtZone[routeRt[e.from] ?? ""] = "private";
  }
  // resolve once more in case the gateway edge was seen before the RouteTableId one
  for (const e of ir.edges) {
    if (kind[e.from] !== "route" || !routeRt[e.from]) continue;
    if (kind[e.to] === "internetgateway") rtZone[routeRt[e.from]] = "public";
    if (kind[e.to] === "natgateway") rtZone[routeRt[e.from]] = "private";
  }
  // subnet ← association → route table
  const zones: Record<string, "public" | "private"> = {};
  const assocSub: Record<string, string> = {};
  const assocRt: Record<string, string> = {};
  for (const e of ir.edges) {
    if (!/routetableassociation/.test(kind[e.from])) continue;
    if (e.viaAttr === "SubnetId") assocSub[e.from] = e.to;
    if (e.viaAttr === "RouteTableId") assocRt[e.from] = e.to;
  }
  for (const a of Object.keys(assocSub)) {
    const z = rtZone[assocRt[a]];
    if (z) zones[assocSub[a]] = z;
  }
  return zones;
}

interface Card { id: string; node: IRNode; zone: "public" | "private" }

/** Render the flow/topology lens as a portable SVG. */
export function renderFlow(ir: GraphIR, opts: FlowOptions = {}): string {
  const theme = opts.theme ?? getTheme();
  const pack = opts.pack ?? defaultPack;
  const title = opts.title ?? "Infrastructure";
  const zones = subnetZones(ir);

  // The subjects, in request order. ingress is public; workload/data sit private.
  // Exclude plumbing — a flow diagram shows the workload and its ingress, not the
  // gateways/NAT/attachments that "gateway" in the ingress rule would sweep in.
  const isPlumbing = (n: IRNode) => roleForKind(n.kind, "app", pack) === "plumbing";
  const match = (re: RegExp) => ir.nodes.filter((n) => re.test(typeOf(n)) && !isPlumbing(n));
  const stages: Array<{ key: string; nodes: IRNode[]; zone: "public" | "private" }> = [
    { key: "ingress", nodes: match(pack.ingress), zone: "public" },
    { key: "workload", nodes: match(pack.workload), zone: "private" },
    { key: "data", nodes: match(DATA), zone: "private" },
  ];
  const cards: Card[] = stages.flatMap((s) => s.nodes.map((node) => ({ id: node.id, node, zone: s.zone })));
  const place = ir.nodes.find((n) => /\bvpc\b|\bvnet\b/.test(typeOf(n)));

  // Layout: internet at the left, then a VPC frame split into a public band (top)
  // and a private band (bottom); each stage is a column, cards stack within it.
  const CARD_W = 150, CARD_H = 76, COL_GAP = 60, ROW_GAP = 20, M = 60;
  const bandPadTop = 64, bandH = (zone: "public" | "private") => {
    const perStage = stages.filter((s) => s.zone === zone).map((s) => s.nodes.length);
    const rows = Math.max(1, ...perStage);
    return bandPadTop + rows * (CARD_H + ROW_GAP) - ROW_GAP + 20;
  };
  const pubH = bandH("public"), privH = bandH("private");
  const colX = (i: number) => M + 200 + 40 + i * (CARD_W + COL_GAP);
  const vpcX = M + 200, vpcY = M + 40;
  const vpcW = 40 + stages.length * (CARD_W + COL_GAP) - COL_GAP + 40;
  const pubY = vpcY + 44, privY = pubY + pubH + 24;
  const vpcH = 44 + pubH + 24 + privH + 24;
  const canvasW = vpcX + vpcW + M;
  const canvasH = Math.max(vpcY + vpcH + M, 360);

  // Position each card (by stage column, banded, stacked within the column).
  const pos: Record<string, { x: number; y: number }> = {};
  stages.forEach((s, si) => {
    const bandTop = (s.zone === "public" ? pubY : privY) + bandPadTop - 20;
    s.nodes.forEach((n, ni) => { pos[n.id] = { x: colX(si), y: bandTop + ni * (CARD_H + ROW_GAP) }; });
  });
  const internet = { x: M, y: pubY + bandPadTop - 20 + CARD_H / 2 };

  const card = (c: Card): string => {
    const p = pos[c.id];
    const glyph = resolveGlyph({ lexicon: c.node.lexicon, kind: c.node.kind });
    return (
      `<g data-node-id="${esc(c.id)}">` +
      `<rect x="${p.x}" y="${p.y}" width="${CARD_W}" height="${CARD_H}" rx="12" fill="${v(theme, "neutralFill")}" stroke="${v(theme, "accentStroke")}" stroke-width="1.4"/>` +
      `<g transform="translate(${p.x + 14} ${p.y + 14}) scale(1.1667)" fill="none" stroke="${v(theme, "textFaint")}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph.body}</g>` +
      `<text x="${p.x + 48}" y="${p.y + 30}" fill="${v(theme, "text")}" font-size="13" font-weight="700">${esc(clip(c.id, 14))}</text>` +
      `<text x="${p.x + 48}" y="${p.y + 47}" fill="${v(theme, "textFaint")}" font-size="10">${esc(clip(c.node.kind.split("::").pop() ?? "", 18))}</text>` +
      `</g>`
    );
  };

  // Flow edges along the request path: internet → ingress → workload → data.
  const center = (id: string) => ({ x: pos[id].x + CARD_W / 2, y: pos[id].y + CARD_H / 2 });
  const arrow = (a: { x: number; y: number }, b: { x: number; y: number }): string => {
    const mx = (a.x + b.x) / 2;
    return `<path d="M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}" fill="none" stroke="${v(theme, "accentBar")}" stroke-width="1.6" marker-end="url(#pin-arrow)" opacity="0.85"/>`;
  };
  let flow = "";
  const ing = stages[0].nodes, wl = stages[1].nodes, dt = stages[2].nodes;
  for (const i of ing) flow += arrow({ x: internet.x + 130, y: internet.y }, { x: pos[i.id].x, y: center(i.id).y });
  for (const i of ing) for (const w of wl) flow += arrow({ x: pos[i.id].x + CARD_W, y: center(i.id).y }, { x: pos[w.id].x, y: center(w.id).y });
  for (const w of wl) for (const d of dt) flow += arrow({ x: pos[w.id].x + CARD_W, y: center(w.id).y }, { x: pos[d.id].x, y: center(d.id).y });

  const band = (label: string, y: number, h: number, accent: boolean): string =>
    `<rect x="${vpcX + 16}" y="${y}" width="${vpcW - 32}" height="${h}" rx="10" fill="${accent ? v(theme, "accentFill") : v(theme, "neutralFill")}" fill-opacity="0.25" stroke="${v(theme, "neutralStroke")}" stroke-dasharray="2 4"/>` +
    `<text x="${vpcX + 28}" y="${y + 20}" fill="${v(theme, "textFaint")}" font-size="11" font-weight="600" letter-spacing=".4">${esc(label)}</text>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(canvasW)} ${Math.ceil(canvasH)}" width="${Math.ceil(canvasW)}" height="${Math.ceil(canvasH)}" ` +
    `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">` +
    defs(theme) +
    `<marker id="pin-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${v(theme, "accentBar")}"/></marker>` +
    `<rect width="${Math.ceil(canvasW)}" height="${Math.ceil(canvasH)}" fill="url(#pin-bg)"/>` +
    `<rect width="${Math.ceil(canvasW)}" height="${Math.ceil(canvasH)}" fill="url(#pin-dots)" opacity="0.6"/>` +
    `<text x="${M}" y="52" fill="${v(theme, "text")}" font-size="22" font-weight="700">${esc(title)}</text>` +
    // VPC frame
    `<g data-node-id="${esc(place?.id ?? "vpc")}"><rect x="${vpcX}" y="${vpcY}" width="${vpcW}" height="${vpcH}" rx="16" fill="none" stroke="${v(theme, "accentStroke")}" stroke-width="1.4"/>` +
    `<text x="${vpcX + 16}" y="${vpcY + 24}" fill="${v(theme, "text")}" font-size="13" font-weight="700">${esc(place?.id ?? "network")}</text></g>` +
    band("PUBLIC", pubY, pubH, true) +
    band("PRIVATE", privY, privH, false) +
    // internet
    `<g><rect x="${internet.x}" y="${internet.y - CARD_H / 2}" width="120" height="${CARD_H}" rx="12" fill="${v(theme, "neutralFill")}" stroke="${v(theme, "neutralStroke")}" stroke-width="1.4"/>` +
    `<text x="${internet.x + 60}" y="${internet.y + 5}" text-anchor="middle" fill="${v(theme, "text")}" font-size="13" font-weight="700">Internet</text></g>` +
    flow +
    cards.map(card).join("") +
    `</svg>`
  );
}

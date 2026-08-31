/**
 * The custom painter: a small builder that emits SVG in pinhole's design system.
 * Layout is computed by chant (`chant graph --format layout`); this module only
 * paints. Ported from the rackattack `internal/render/svg` painter.
 *
 * Colors come from a Theme. Every color is emitted inline as
 * `var(--pin-<token>, <baked>)` (not via CSS classes) so the portable output
 * survives a stripped `<style>`, while the `:root` block from `defs()` still
 * lets a browser switch themes live. See theme.ts.
 */
import { type Theme, type ThemeTokenName, v, defs } from "../theme.ts";
import type { Field } from "../labels.ts";
import type { Glyph } from "../icons.ts";

/** Drives the color of a node card. */
export type Status = "neutral" | "accent" | "good" | "warn" | "runtime" | "selected";

/** The reference an edge encodes — `from` references `to` through `via` (and, at
 * detail T3, the producer attribute `toAttr`). Stamped onto the edge for rollover. */
export interface EdgeRel {
  from: string;
  to: string;
  via?: string;
  toAttr?: string;
}

interface StatusTokens {
  fill: ThemeTokenName;
  stroke: ThemeTokenName;
  bar: ThemeTokenName;
}

/** Exported for the morph's group boxes (#110-adjacent): a box status must
 * resolve to the same stroke token a `groupBox` would use, so a tinted box
 * reads identically in the static SVG and the morph artifact. */
export function statusTokens(s: Status): StatusTokens {
  switch (s) {
    case "accent":
      return { fill: "accentFill", stroke: "accentStroke", bar: "accentBar" };
    case "good":
      return { fill: "goodFill", stroke: "goodStroke", bar: "goodBar" };
    case "warn":
      return { fill: "warnFill", stroke: "warnStroke", bar: "warnBar" };
    case "runtime":
      // A runtime child (a Pod its Deployment's controller created — expected,
      // never drift) reads apart from managed/foreign/pending AND from
      // neutral: falling through to neutral painted "the cluster made this"
      // exactly like "nobody looked at this".
      return { fill: "runtimeFill", stroke: "runtimeStroke", bar: "runtimeBar" };
    case "selected":
      return { fill: "accentFill", stroke: "selectedStroke", bar: "accentBar" };
    default:
      return { fill: "neutralFill", stroke: "neutralStroke", bar: "neutralBar" };
  }
}

/**
 * The fill a card / icon badge of this status is painted with, in the emitted
 * `var(--pin-<token>, <baked>)` form. This is the string handed to a pack as
 * `IconContext.ground` (#107): the glyph sits on this fill, at full opacity, so
 * a pack can trust it as the ground its mark has to read against. Exported so
 * every painter that puts a glyph on an opaque status fill names the ground the
 * same way — the value must stay identical to what `nodeCard` / `nodeIcon`
 * write into the rect, which the render tests pin by comparing the two.
 */
export function statusGround(s: Status, theme: Theme): string {
  return v(theme, statusTokens(s).fill);
}

/** Accumulates SVG markup in pinhole's design system, themed by `theme`. */
export class Canvas {
  private readonly theme: Theme;
  private body = "";

  constructor(w: number, h: number, theme: Theme) {
    this.theme = theme;
    // Emit an intrinsic pixel size (not just a viewBox) so the artifact's
    // `max-width:100%` scales a *large* graph down to fit but never blows a small
    // one (e.g. a 2-node composite view) up to fill the page.
    this.body +=
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
      `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">`;
    this.body += defs(theme);
    this.body += `<rect width="${w}" height="${h}" fill="url(#pin-bg)"/>`;
    this.body += `<rect width="${w}" height="${h}" fill="url(#pin-dots)" opacity="0.6"/>`;
  }

  /** A themed color reference for a token. */
  private c(token: ThemeTokenName): string {
    return v(this.theme, token);
  }

  raw(s: string): void {
    this.body += s;
  }

  title(x: number, y: number, h1: string, sub: string): void {
    this.body += `<text x="${x}" y="${y}" fill="${this.c("text")}" font-size="26" font-weight="700" letter-spacing=".2">${esc(h1)}</text>`;
    if (sub) {
      this.body += `<text x="${x}" y="${y + 24}" fill="${this.c("textMuted")}" font-size="12.5" letter-spacing=".3">${esc(sub)}</text>`;
    }
  }

  /** A titled boundary region behind a group of cards (concept diagrams). A soft
   * panel fill + border, with the group name in the top gutter. Drawn before the
   * cards so they sit on top. A `status` tints the border and title with the
   * card status tokens — a helm release box or a cluster boundary can then say
   * deployed/failed/pending itself, not only through the cards inside it. The
   * fill stays the soft panel: a status-filled region would fight the cards.
   * `groupId` (the container key — pinhole#103) is stamped as `data-group-id`
   * on the rect, the same hook `data-node-id` gives cards, so downstream
   * interaction can address a box structurally instead of sniffing rx + sibling
   * text. `mark` (pinhole#119) is an identity glyph for the box itself, painted
   * in the opposite gutter from the title — a box can then be badged without the
   * badge being smuggled into its title, which downstream consumers re-parse.
   * Monochrome mark geometry is stroked in the title's colour, so it follows the
   * theme and the status tint the way the title does. */
  groupBox(
    x: number,
    y: number,
    w: number,
    h: number,
    title?: string,
    status?: Status,
    groupId?: string,
    mark?: Glyph | string,
  ): void {
    const stroke = status && status !== "neutral" ? statusTokens(status).stroke : "neutralStroke";
    const idAttr = groupId ? ` data-group-id="${esc(groupId)}"` : "";
    this.body += `<rect${idAttr} x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${this.c("bg1")}" fill-opacity="0.6" stroke="${this.c(stroke)}" stroke-width="1.2"/>`;
    const titleFill = status && status !== "neutral" ? this.c(stroke) : this.c("textMuted");
    if (title) {
      this.body += `<text x="${x + 18}" y="${y + 23}" fill="${titleFill}" font-size="12" font-weight="700" letter-spacing=".5">${esc(title)}</text>`;
    }
    if (mark) this.body += groupMarkMarkup(mark, x, y, w, titleFill);
  }

  /** Portable status card (native SVG text): accent bar, type icon, title,
   * sub-label, and field rows. Works as a static .svg / `<img>` / GitHub. */
  nodeCard(
    x: number,
    y: number,
    w: number,
    h: number,
    s: Status,
    title: string,
    sub: string,
    icon?: string | Glyph,
    fields: Field[] = [],
    emphasize = false,
    nodeId?: string,
  ): void {
    const t = statusTokens(s);
    const textX = icon ? x + 46 : x + 16;
    const idAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : "";
    // Native SVG <text> doesn't wrap or clip, so budget characters to the card
    // width and ellipsize — the full text lives in the tooltip + inspector.
    const titleMax = Math.floor((x + w - 8 - textX) / 8.2);
    const subMax = Math.floor((x + w - 8 - textX) / 6);
    const rowMax = Math.floor((w - 24) / 6);
    this.body += emphasize ? `<g${idAttr} class="pin-pulse">` : `<g${idAttr}>`;
    this.body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${this.c(t.fill)}" stroke="${this.c(t.stroke)}" stroke-width="1.2"/>`;
    this.body += `<rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${this.c(t.bar)}"/>`;
    if (icon) this.body += this.glyph(icon, x + 14, y + 15, 22);
    this.body += `<text x="${textX}" y="${y + 26}" fill="${this.c("text")}" font-size="15" font-weight="700">${esc(clip(title, titleMax))}</text>`;
    if (sub) {
      this.body += `<text x="${textX}" y="${y + 44}" fill="${this.c("textFaint")}" font-size="11">${esc(clip(sub, subMax))}</text>`;
    }
    fields.forEach((f, i) => {
      const fy = y + 64 + i * 16;
      const label = clip(f.label, Math.min(14, rowMax - 6));
      const value = clip(f.value, Math.max(4, rowMax - label.length - 2));
      this.body += `<text x="${x + 16}" y="${fy}" font-size="11">`;
      this.body += `<tspan fill="${this.c("textFaint")}">${esc(label)}: </tspan>`;
      this.body += `<tspan fill="${this.c("textMuted")}">${esc(value)}</tspan>`;
      this.body += `</text>`;
    });
    this.body += `</g>`;
  }

  /** Rich status card using `<foreignObject>` HTML — fields as a list, themed
   * via the same `--pin-*` vars. Browser/inline only; never put in the portable
   * export. */
  nodeCardRich(
    x: number,
    y: number,
    w: number,
    h: number,
    s: Status,
    title: string,
    sub: string,
    fields: Field[] = [],
    emphasize = false,
    nodeId?: string,
  ): void {
    const t = statusTokens(s);
    const idAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : "";
    const cls = emphasize ? ` class="pin-pulse"` : "";
    // Rich tier is in a browser, so CSS handles the clipping: nowrap + ellipsis
    // on each line, the value column allowed to shrink (min-width:0).
    const ell = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    const items = fields
      .map(
        (f) =>
          `<li style="display:flex;gap:6px;margin:2px 0;min-width:0">` +
          `<span style="color:${this.c("textFaint")};flex:none">${esc(f.label)}</span>` +
          `<span style="color:${this.c("textMuted")};${ell}">${esc(f.value)}</span></li>`,
      )
      .join("");
    this.body +=
      `<foreignObject x="${x}" y="${y}" width="${w}" height="${h}"${idAttr}${cls}>` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;height:100%;` +
      `border-radius:12px;border:1.2px solid ${this.c(t.stroke)};border-left:4px solid ${this.c(t.bar)};` +
      `background:${this.c(t.fill)};padding:8px 12px;` +
      `font:13px 'Inter',system-ui,sans-serif;overflow:hidden">` +
      `<div style="color:${this.c("text")};font-weight:700;font-size:15px;${ell}">${esc(title)}</div>` +
      (sub ? `<div style="color:${this.c("textFaint")};font-size:11px;${ell}">${esc(sub)}</div>` : "") +
      (items ? `<ul style="list-style:none;margin:6px 0 0;padding:0;font-size:11px;min-width:0">${items}</ul>` : "") +
      `</div></foreignObject>`;
  }

  /** Compact icon node: a glyph badge with a single truncated label. Identity at
   * a glance for dense graphs — the full name and attrs come from the hover
   * tooltip and the click inspector. Native SVG (tier-agnostic), with the same
   * `data-node-id` hook as the cards. */
  nodeIcon(
    x: number,
    y: number,
    w: number,
    h: number,
    s: Status,
    label: string,
    icon: string | Glyph,
    emphasize = false,
    nodeId?: string,
  ): void {
    const t = statusTokens(s);
    const idAttr = nodeId ? ` data-node-id="${esc(nodeId)}"` : "";
    const badge = 48;
    const cx = x + w / 2;
    const bx = cx - badge / 2;
    const by = y + 8;
    this.body += emphasize ? `<g${idAttr} class="pin-pulse">` : `<g${idAttr}>`;
    this.body += `<rect x="${bx}" y="${by}" width="${badge}" height="${badge}" rx="13" fill="${this.c(t.fill)}" stroke="${this.c(t.stroke)}" stroke-width="1.4"/>`;
    this.body += `<rect x="${bx}" y="${by}" width="${badge}" height="4" rx="2" fill="${this.c(t.bar)}"/>`;
    this.body += this.glyph(icon, cx - 13, by + 12, 26);
    const max = Math.floor((w - 8) / 6.2);
    this.body += `<text x="${cx}" y="${by + badge + 18}" text-anchor="middle" fill="${this.c("text")}" font-size="12" font-weight="600">${esc(clip(label, max))}</text>`;
    this.body += `</g>`;
  }

  /** Place a glyph at (gx,gy), scaled to `size`. Monochrome geometry is stroked
   * in the theme's text color; a pack's `colored` mark paints as authored. */
  private glyph(glyph: Glyph | string, gx: number, gy: number, size: number): string {
    return glyphMarkup(glyph, gx, gy, size, this.c("textFaint"));
  }

  /** A bezier path between two points, in the theme's edge color. With `flow`, a
   * marching dash animates direction. With `rel` (the reference this edge
   * encodes), the path is wrapped in a group carrying `data-edge-*` hooks and an
   * invisible wide hit-path, so the interactive artifact can roll over a thin
   * edge to show the relationship + ref value. */
  edge(d: string, width: number, flow = false, rel?: EdgeRel, dashed = false): void {
    const lineCls = flow ? ` class="pin-edge-line pin-flow"` : ` class="pin-edge-line"`;
    const dash = dashed ? ` stroke-dasharray="5 4"` : "";
    const line = `<path${lineCls} d="${esc(d)}" fill="none" stroke="${this.c("edge")}" stroke-width="${width}"${dash} stroke-linecap="round"/>`;
    if (!rel) {
      this.body += line;
      return;
    }
    const attrs =
      ` data-edge-from="${esc(rel.from)}" data-edge-to="${esc(rel.to)}"` +
      (rel.via ? ` data-edge-via="${esc(rel.via)}"` : "") +
      (rel.toAttr ? ` data-edge-to-attr="${esc(rel.toAttr)}"` : "");
    // The hit-path is transparent but `pointer-events="stroke"` makes its full
    // width hoverable — a 1.4px line is otherwise near-impossible to hit.
    this.body +=
      `<g${attrs}>${line}` +
      `<path d="${esc(d)}" fill="none" stroke="transparent" stroke-width="14" stroke-linecap="round" pointer-events="stroke"/></g>`;
  }

  /** A visible label on an edge (concept diagrams — branch conditions, relations).
   * A small chip in the page-background color so it cuts cleanly across the line.
   * With `rel`, the chip group carries the same `data-edge-*` hooks as the edge
   * it labels (#110) — downstream re-anchoring (behold's hand-layout) pairs
   * chip and line by identity instead of document order, which its own
   * hover-raise re-appending destroys. */
  edgeLabel(x: number, y: number, text: string, rel?: EdgeRel): void {
    const relAttrs = rel
      ? ` data-edge-from="${esc(rel.from)}" data-edge-to="${esc(rel.to)}"` + (rel.via ? ` data-edge-via="${esc(rel.via)}"` : "")
      : "";
    const w = text.length * 5.7 + 14;
    this.body +=
      `<g${relAttrs}><rect x="${(x - w / 2).toFixed(1)}" y="${y - 9}" width="${w.toFixed(1)}" height="18" rx="9" ` +
      `fill="${this.c("bg0")}" stroke="${this.c("neutralStroke")}" stroke-width="1"/>` +
      `<text x="${x.toFixed(1)}" y="${y + 3.5}" text-anchor="middle" fill="${this.c("textMuted")}" font-size="10.5">${esc(text)}</text></g>`;
  }

  toString(): string {
    return this.body + `</svg>`;
  }
}

const DEFAULT_VIEWBOX = "0 0 24 24";

/** Round to 4dp and drop trailing zeros, so a transform reads 1.0833, not
 * 1.0833333333333333. */
function num(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Parse "minX minY w h", falling back to the 0 0 24 24 the bundled set uses. */
function viewBoxOf(vb: string | undefined): [number, number, number, number] {
  const parts = (vb ?? DEFAULT_VIEWBOX).trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) {
    return [0, 0, 24, 24];
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

/**
 * Place a glyph at (gx,gy), scaled to fit a `size` square. The single emitter
 * for every glyph pinhole paints (#95) — the card icon, the icon-node badge, the
 * containment box/leaf/origin badges, the morph badge, and the flow / stacked /
 * small-multiples cells all come through here, so the geometry contract is
 * honoured in one place.
 *
 * A monochrome glyph is stroked with `stroke` (the caller's theme token) exactly
 * as it always has been. A `colored` glyph is emitted with no paint attributes
 * at all, so an authored brand mark keeps its own fills and strokes. A non-24
 * viewBox is fitted into the square, aspect preserved and centred.
 *
 * Accepts a bare geometry string for callers that only have a body.
 */
export function glyphMarkup(glyph: Glyph | string, gx: number, gy: number, size: number, stroke: string): string {
  const g: Glyph = typeof glyph === "string" ? { name: "", body: glyph } : glyph;
  const [minX, minY, vbW, vbH] = viewBoxOf(g.viewBox);
  const k = size / Math.max(vbW, vbH);
  const dx = num(gx + (size - vbW * k) / 2 - minX * k);
  const dy = num(gy + (size - vbH * k) / 2 - minY * k);
  const transform = `translate(${dx} ${dy}) scale(${num(k)})`;
  // Authored colour survives only if the painter says nothing about paint.
  if (g.colored) return `<g transform="${transform}">${g.body}</g>`;
  return (
    `<g transform="${transform}" fill="none" stroke="${stroke}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${g.body}</g>`
  );
}

/** The box mark's square, and its inset from the box's right edge — the mirror
 * of the 18px left inset the title sits at, so title and mark bracket the same
 * top gutter. */
const GROUP_MARK_SIZE = 18;
const GROUP_MARK_INSET = 18;

/**
 * Place a box's identity mark (pinhole#119) in the top-right gutter of a box at
 * (x,y) of width `w`, vertically centred on the title row. The single emitter
 * for it, the way `glyphMarkup` is for node glyphs — the static painter and the
 * morph both come through here, so a marked box sits in the same corner in both.
 */
export function groupMarkMarkup(mark: Glyph | string, x: number, y: number, w: number, stroke: string): string {
  return glyphMarkup(mark, x + w - GROUP_MARK_INSET - GROUP_MARK_SIZE, y + 9, GROUP_MARK_SIZE, stroke);
}

/** Ellipsize to a character budget (native SVG text can't clip itself). */
export function clip(s: string, max: number): string {
  if (max <= 1) return s.length ? "…" : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

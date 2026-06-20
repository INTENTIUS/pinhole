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

/** Drives the color of a node card. */
export type Status = "neutral" | "accent" | "good" | "warn" | "selected";

interface StatusTokens {
  fill: ThemeTokenName;
  stroke: ThemeTokenName;
  bar: ThemeTokenName;
}

function statusTokens(s: Status): StatusTokens {
  switch (s) {
    case "accent":
      return { fill: "accentFill", stroke: "accentStroke", bar: "accentBar" };
    case "good":
      return { fill: "goodFill", stroke: "goodStroke", bar: "goodBar" };
    case "warn":
      return { fill: "warnFill", stroke: "warnStroke", bar: "warnBar" };
    case "selected":
      return { fill: "accentFill", stroke: "selectedStroke", bar: "accentBar" };
    default:
      return { fill: "neutralFill", stroke: "neutralStroke", bar: "neutralBar" };
  }
}

/** Accumulates SVG markup in pinhole's design system, themed by `theme`. */
export class Canvas {
  private readonly theme: Theme;
  private body = "";

  constructor(w: number, h: number, theme: Theme) {
    this.theme = theme;
    this.body +=
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
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
    icon?: string,
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

  /** Place a monochrome glyph (0 0 24 24 geometry) at (gx,gy), scaled to `size`,
   * stroked in the theme's text color. */
  private glyph(body: string, gx: number, gy: number, size: number): string {
    const k = size / 24;
    return (
      `<g transform="translate(${gx} ${gy}) scale(${k})" fill="none" stroke="${this.c("textFaint")}" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`
    );
  }

  /** A bezier path between two points, in the theme's edge color. With `flow`,
   * a marching dash animates direction along the edge. */
  edge(d: string, width: number, flow = false): void {
    const cls = flow ? ` class="pin-flow"` : "";
    this.body += `<path d="${esc(d)}" fill="none" stroke="${this.c("edge")}" stroke-width="${width}" stroke-linecap="round"${cls}/>`;
  }

  toString(): string {
    return this.body + `</svg>`;
  }
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

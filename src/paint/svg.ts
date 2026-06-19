/**
 * The custom painter: a small builder that emits SVG in pinhole's design system.
 * Layout is computed elsewhere (Graphviz today; a JS engine later) — this module
 * only paints. Ported from the rackattack `internal/render/svg` painter.
 */

/** Drives the color of a node card. */
export type Status = "neutral" | "accent" | "good" | "warn" | "selected";

interface Palette {
  fill: string;
  stroke: string;
  accent: string;
}

function palette(s: Status): Palette {
  switch (s) {
    case "accent":
      return { fill: "fCard", stroke: "#4C8DFF", accent: "#4C8DFF" };
    case "good":
      return { fill: "fSurv", stroke: "#1F6B49", accent: "#43DC94" };
    case "warn":
      return { fill: "fDead", stroke: "#7A2C30", accent: "#FF5A5F" };
    case "selected":
      return { fill: "fCard", stroke: "#4C8DFF", accent: "#4C8DFF" };
    default:
      return { fill: "fCtx", stroke: "#252C38", accent: "#3A434F" };
  }
}

const DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0B0E14"/><stop offset="1" stop-color="#0F141D"/>
  </linearGradient>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
    <circle cx="1.5" cy="1.5" r="1.1" fill="#1A2230"/>
  </pattern>
  <linearGradient id="fDead" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2A1417"/><stop offset="1" stop-color="#1A0D10"/>
  </linearGradient>
  <linearGradient id="fSurv" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#102A1E"/><stop offset="1" stop-color="#0B1C15"/>
  </linearGradient>
  <linearGradient id="fCtx" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#161B24"/><stop offset="1" stop-color="#11151D"/>
  </linearGradient>
  <linearGradient id="fCard" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#141A24"/><stop offset="1" stop-color="#0F141C"/>
  </linearGradient>
  <style>
    .h1{ fill:#E6EDF3; font-size:26px; font-weight:700; letter-spacing:.2px; }
    .sub{ fill:#7A8699; font-size:12.5px; letter-spacing:.3px; }
    .nT{ fill:#E6EDF3; font-size:15px; font-weight:700; }
    .lbl{ fill:#8A93A3; font-size:11px; }
    .legend{ fill:#9AA3B2; font-size:12px; }
  </style>
</defs>`;

/** Accumulates SVG markup in pinhole's design system. */
export class Canvas {
  private readonly w: number;
  private readonly h: number;
  private body = "";

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.body +=
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
      `font-family="'Inter','SF Pro Display',system-ui,-apple-system,'Segoe UI',sans-serif">`;
    this.body += DEFS;
    this.body += `<rect width="${w}" height="${h}" fill="url(#bg)"/>`;
    this.body += `<rect width="${w}" height="${h}" fill="url(#dots)" opacity="0.6"/>`;
  }

  raw(s: string): void {
    this.body += s;
  }

  title(x: number, y: number, h1: string, sub: string): void {
    this.body += `<text x="${x}" y="${y}" class="h1">${esc(h1)}</text>`;
    if (sub) this.body += `<text x="${x}" y="${y + 24}" class="sub">${esc(sub)}</text>`;
  }

  /** A rounded status card with an accent bar, title and sub-label. */
  nodeCard(
    x: number,
    y: number,
    w: number,
    h: number,
    s: Status,
    title: string,
    sub: string
  ): void {
    const { fill, stroke, accent } = palette(s);
    this.body += `<g>`;
    this.body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="url(#${fill})" stroke="${stroke}" stroke-width="1.2"/>`;
    this.body += `<rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${accent}"/>`;
    this.body += `<text x="${x + 16}" y="${y + 26}" class="nT">${esc(title)}</text>`;
    if (sub) this.body += `<text x="${x + 16}" y="${y + 44}" class="lbl">${esc(sub)}</text>`;
    this.body += `</g>`;
  }

  /** A bezier path between two points. */
  edge(d: string, color: string, width: number): void {
    this.body += `<path d="${esc(d)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  }

  toString(): string {
    return this.body + `</svg>`;
  }
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

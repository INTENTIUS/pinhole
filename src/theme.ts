/**
 * Themes — a `Theme` is a named set of color tokens. The painter emits every
 * color as `var(--pin-<token>, <baked-fallback>)`, so one theme drives two
 * layers (#5):
 *
 * - **baked**: the fallback is the chosen theme's value, so a standalone .svg,
 *   an `<img>`, or GitHub renders correctly even if the `<style>` is dropped.
 * - **live**: a `:root` block sets the same values as CSS variables, so when the
 *   SVG is inlined in a browser a switcher can override `--pin-*` and recolor
 *   with no re-render.
 *
 * Caveat: very old SVG rasterizers that don't understand `var()` won't theme;
 * browsers and modern rasterizers do.
 */

export type ThemeTokenName =
  | "bg0" | "bg1" | "dots"
  | "text" | "textMuted" | "textFaint"
  | "edge"
  | "neutralFill" | "neutralStroke" | "neutralBar"
  | "accentFill" | "accentStroke" | "accentBar"
  | "goodFill" | "goodStroke" | "goodBar"
  | "warnFill" | "warnStroke" | "warnBar"
  | "selectedStroke";

export type ThemeTokens = Record<ThemeTokenName, string>;

export interface Theme {
  name: string;
  tokens: ThemeTokens;
}

export const TOKEN_NAMES: ThemeTokenName[] = [
  "bg0", "bg1", "dots",
  "text", "textMuted", "textFaint",
  "edge",
  "neutralFill", "neutralStroke", "neutralBar",
  "accentFill", "accentStroke", "accentBar",
  "goodFill", "goodStroke", "goodBar",
  "warnFill", "warnStroke", "warnBar",
  "selectedStroke",
];

const dark: Theme = {
  name: "dark",
  tokens: {
    bg0: "#0B0E14", bg1: "#0F141D", dots: "#1A2230",
    text: "#E6EDF3", textMuted: "#7A8699", textFaint: "#8A93A3",
    edge: "#3A434F",
    neutralFill: "#161B24", neutralStroke: "#252C38", neutralBar: "#3A434F",
    accentFill: "#141A24", accentStroke: "#4C8DFF", accentBar: "#4C8DFF",
    goodFill: "#102A1E", goodStroke: "#1F6B49", goodBar: "#43DC94",
    warnFill: "#2A1417", warnStroke: "#7A2C30", warnBar: "#FF5A5F",
    selectedStroke: "#4C8DFF",
  },
};

const light: Theme = {
  name: "light",
  tokens: {
    bg0: "#F7F9FC", bg1: "#EDF1F7", dots: "#D5DCE6",
    text: "#1A2230", textMuted: "#5A6577", textFaint: "#7A8699",
    edge: "#B7C0CE",
    neutralFill: "#FFFFFF", neutralStroke: "#D5DCE6", neutralBar: "#9AA7B8",
    accentFill: "#EAF1FF", accentStroke: "#4C8DFF", accentBar: "#4C8DFF",
    goodFill: "#E6F7EE", goodStroke: "#1F6B49", goodBar: "#1FAE6B",
    warnFill: "#FDEAEA", warnStroke: "#C0392B", warnBar: "#E5484D",
    selectedStroke: "#4C8DFF",
  },
};

const blueprint: Theme = {
  name: "blueprint",
  tokens: {
    bg0: "#0A2A43", bg1: "#08243A", dots: "#15405E",
    text: "#DCEEFF", textMuted: "#8FB7D6", textFaint: "#6E97B6",
    edge: "#3E7FA8",
    neutralFill: "#0E3552", neutralStroke: "#2E6489", neutralBar: "#5FC9E8",
    accentFill: "#103E5E", accentStroke: "#5FC9E8", accentBar: "#5FC9E8",
    goodFill: "#0E3F3A", goodStroke: "#2E9C8E", goodBar: "#4FE3C8",
    warnFill: "#3E2230", warnStroke: "#B5536B", warnBar: "#FF6F91",
    selectedStroke: "#FFD479",
  },
};

export const THEMES: Record<string, Theme> = { dark, light, blueprint };
export const DEFAULT_THEME = "dark";

/** Resolve a theme by name. Throws on an unknown name (with the valid list). */
export function getTheme(name?: string): Theme {
  const theme = THEMES[name ?? DEFAULT_THEME];
  if (!theme) {
    throw new Error(`unknown theme "${name}". Available: ${Object.keys(THEMES).join(", ")}`);
  }
  return theme;
}

/** A CSS-var reference with the theme's value baked in as the fallback. */
export function v(theme: Theme, token: ThemeTokenName): string {
  return `var(--pin-${token}, ${theme.tokens[token]})`;
}

/**
 * Ambient animation CSS — semantic motion classes (#9). Entirely inside a
 * `prefers-reduced-motion: no-preference` guard, so motion is off for users who
 * opt out (and in print). CSS `@keyframes` animate even when the SVG is loaded
 * as `<img>` in a browser; static rasterizers / GitHub show the still frame.
 *
 * - `pin-pulse`  — emphasis (focus / lens / blast / diff scope)
 * - `pin-flow`   — flow direction along an edge (a marching dash)
 */
const ANIMATION_CSS =
  `@media (prefers-reduced-motion: no-preference){` +
  `@keyframes pin-pulse{0%,100%{opacity:1}50%{opacity:.5}}` +
  `.pin-pulse{animation:pin-pulse 1.6s ease-in-out infinite}` +
  `@keyframes pin-flow{to{stroke-dashoffset:-20}}` +
  `.pin-flow{stroke-dasharray:4 6;animation:pin-flow .9s linear infinite}` +
  `}`;

/** The shared `<defs>`: a `:root` block (live theming) plus the bg gradient and
 * dot pattern, all referencing the tokens. */
export function defs(theme: Theme): string {
  const root = TOKEN_NAMES.map((t) => `--pin-${t}:${theme.tokens[t]};`).join("");
  return (
    `<defs>` +
    `<style>:root{${root}}${ANIMATION_CSS}</style>` +
    `<linearGradient id="pin-bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${v(theme, "bg0")}"/>` +
    `<stop offset="1" stop-color="${v(theme, "bg1")}"/>` +
    `</linearGradient>` +
    `<pattern id="pin-dots" width="28" height="28" patternUnits="userSpaceOnUse">` +
    `<circle cx="1.5" cy="1.5" r="1.1" fill="${v(theme, "dots")}"/>` +
    `</pattern>` +
    `</defs>`
  );
}

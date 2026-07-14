export type { GraphIR, IRNode, IREdge, IRGroups, SourceLoc, Layout, Point } from "./ir.ts";
export { graphIr, graphLayout, graphFlags, type GraphOptions } from "./chant.ts";
export {
  type Theme,
  type ThemeTokens,
  type ThemeTokenName,
  THEMES,
  TOKEN_NAMES,
  DEFAULT_THEME,
  getTheme,
  v,
  defs,
} from "./theme.ts";
export {
  type Glyph,
  type PresentationPack,
  GENERIC_GLYPHS,
  categoryForKind,
  resolveGlyph,
  registerPack,
  getPack,
  clearPacks,
} from "./icons.ts";
export { type Field, MAX_FIELDS, defaultFields, resolveFields } from "./labels.ts";
export { Canvas, type Status } from "./paint/svg.ts";
export {
  renderSvg,
  cardSizes,
  cardFootprint,
  type RenderOptions,
  type NodeOverride,
  type NodeStyle,
  type GroupBox,
} from "./paint/render.ts";
export {
  layoutIr,
  layoutArchitecture,
  type ConceptLayout,
  type ConceptLayoutOptions,
} from "./concept.ts";
export { renderHtml, type HtmlOptions } from "./html.ts";
export { renderMorphHtml, type MorphView, type MorphOptions } from "./morph.ts";
// Multi-stack composition (#513/#42/#46): merge N project IRs into one — namespaced
// ids, byStack grouping, and cross-stack edges from export↔import handle matching.
export { composeStacks, shortStackNames, isImportSocket } from "./compose.ts";

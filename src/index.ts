export type { GraphIR, IRNode, IREdge, IREdgeKind, IRDanglingRef, IRGroups, IRExport, IRImport, SourceLoc, Layout, Point } from "./ir.ts";
export { withResourceAttrs } from "./ir.ts";
// The chant CLI wrapper (graphIr, graphLayout, graphFlags, lint) spawns chant,
// so it lives at the `@intentius/pinhole/chant` subpath. The root entry imports
// no node builtins and bundles for a browser.
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
  type GlyphSpec,
  type IconContext,
  type PresentationPack,
  GENERIC_GLYPHS,
  categoryForKind,
  resolveGlyph,
  registerPack,
  getPack,
  clearPacks,
} from "./icons.ts";
export { type Field, MAX_FIELDS, defaultFields, resolveFields } from "./labels.ts";
export { Canvas, glyphMarkup, groupMarkMarkup, statusGround, type Status } from "./paint/svg.ts";
export {
  renderSvg,
  cardSizes,
  cardFootprint,
  groupMark,
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
export { edgeKey, layoutEdgeName, edgeLanes, type EdgeIdentity, type EdgeLane } from "./edges.ts";
export { renderHtml, type HtmlOptions } from "./html.ts";
export { renderMorphHtml, type MorphView, type MorphOptions } from "./morph.ts";
// Multi-stack composition (#513/#42/#46): merge N project IRs into one — namespaced
// ids, byStack grouping, and cross-stack edges from export↔import handle matching.
export { composeStacks, shortStackNames, isImportSocket } from "./compose.ts";

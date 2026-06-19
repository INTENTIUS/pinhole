import type { IRNode } from "./ir.ts";
import { getPack } from "./icons.ts";

/**
 * Label fields (#7). A node's body can show a few fields from its IR attrs. The
 * set of fields is chosen by a template, resolved through a chain:
 *
 *   per-node override → lexicon presentation pack → default (scalar attrs)
 *
 * The same field list drives both label tiers — native SVG text (portable) and
 * `<foreignObject>` HTML (rich) — so they never diverge.
 */

/** One label field: a name and a display value. */
export interface Field {
  label: string;
  value: string;
}

/** Max fields shown on a node so cards stay within the layout's vertical room. */
export const MAX_FIELDS = 4;

function isScalar(v: unknown): v is string | number | boolean {
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
}

function truncate(s: string, n = 28): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Default template: the node's scalar attrs, sorted, capped. Skips refs/objects. */
export function defaultFields(node: Pick<IRNode, "attrs">): Field[] {
  const out: Field[] = [];
  for (const key of Object.keys(node.attrs).sort()) {
    const v = node.attrs[key];
    if (isScalar(v)) out.push({ label: key, value: truncate(String(v)) });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** Resolve a node's fields via override → lexicon pack → default. */
export function resolveFields(node: IRNode, opts: { override?: Field[] } = {}): Field[] {
  if (opts.override) return opts.override.slice(0, MAX_FIELDS);
  const packFields = getPack(node.lexicon)?.fields?.(node);
  if (packFields) return packFields.slice(0, MAX_FIELDS);
  return defaultFields(node);
}

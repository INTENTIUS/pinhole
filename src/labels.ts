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

/** Max fields a curated template (override/pack) may show on a node. */
export const MAX_FIELDS = 4;

/** The card carries identity + a couple of high-signal facts; everything else is
 * in the click inspector. So the *default* (uncurated) template is deliberately
 * lean: a few short scalar attrs, never the long blobs (descriptions, ARNs). */
const CARD_FIELDS = 2;
/** A value longer than this is "detail", not a card fact — leave it to the popover. */
const MAX_VALUE_LEN = 22;

function isScalar(v: unknown): v is string | number | boolean {
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
}

function truncate(s: string, n = 22): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Default template: a couple of the node's *short* scalar attrs, sorted. Skips
 * refs/objects (popover-only) and long values (descriptions, ARNs → popover). */
export function defaultFields(node: Pick<IRNode, "attrs">): Field[] {
  const out: Field[] = [];
  for (const key of Object.keys(node.attrs).sort()) {
    const v = node.attrs[key];
    if (!isScalar(v)) continue;
    const value = String(v);
    if (value.length > MAX_VALUE_LEN) continue; // a blob — belongs in the popover
    out.push({ label: key, value });
    if (out.length >= CARD_FIELDS) break;
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

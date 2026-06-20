/**
 * Icon resolution (#6). A node's icon is resolved through a chain, not a flat
 * map:
 *
 *   per-node override → lexicon presentation pack (kind→category) →
 *   generic category (keyword heuristic) → default
 *
 * Glyphs are monochrome line icons (geometry only — no color), so the painter
 * strokes them with a theme token and they recolor with the theme. Brand /
 * provider-authentic icon packs are a separate, opt-in concern (different
 * package; full color; not themeable) — out of scope here.
 */

/** A resolved glyph: a name plus its SVG geometry (paths/shapes, no color). */
export interface Glyph {
  name: string;
  body: string;
}

/**
 * Generic, license-clean line glyphs in a 0 0 24 24 box. Geometry only — the
 * painter sets `stroke` from a theme token. Keyed by semantic category.
 */
export const GENERIC_GLYPHS: Record<string, string> = {
  generic: `<rect x="4" y="4" width="16" height="16" rx="3"/>`,
  compute: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>`,
  container: `<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v12M14 6v12"/>`,
  storage: `<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="13" width="16" height="6" rx="1"/><path d="M7 7h.01M7 16h.01"/>`,
  database: `<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>`,
  network: `<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.6 8 11 15.6M16.4 8 13 15.6M8.4 6h7.2"/>`,
  // a bordered network boundary with hosts — distinct from generic/network
  subnet: `<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 12h16M12 4v16"/>`,
  firewall: `<path d="M12 3 5.5 5.5v5.5c0 4 2.8 7 6.5 8.5 3.7-1.5 6.5-4.5 6.5-8.5V5.5z"/><path d="M9.5 11.5 11.5 13.5 15 9.5"/>`,
  gateway: `<path d="M4 20v-7a8 8 0 0 1 16 0v7"/><path d="M9.5 20v-5a2.5 2.5 0 0 1 5 0v5"/>`,
  route: `<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16 15.5 8.5"/><path d="M12 8.5h3.5V12"/>`,
  queue: `<rect x="3" y="8" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="8" rx="1"/><rect x="17" y="8" width="4" height="8" rx="1"/>`,
  function: `<path d="M13 3 5 13h6l-2 8 10-12h-7z"/>`,
  loadbalancer: `<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v3M5 16.5 11 12M19 16.5 13 12M12 12v4.5"/>`,
  dns: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`,
  secret: `<circle cx="8.5" cy="12" r="3.5"/><path d="M12 12h7.5M17 12v3M19.5 12v2.5"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-6 7-6s7 2 7 6"/>`,
  internet: `<path d="M6.5 17.5a4 4 0 0 1 0-8 5 5 0 0 1 9.7-1.4A3.6 3.6 0 0 1 17.5 17.5z"/>`,
  pipeline: `<circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 12h2M14.5 12h2"/>`,
};

/** Keyword heuristics mapping a resource kind to a generic category. First match wins. */
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/bucket|storage|disk|volume|blob|fileshare/, "storage"],
  // Word-boundary the short, collision-prone tokens: `\bdb` so "loadbalancer"
  // isn't a DB, `\brds` so "RecordSet" isn't (it contains "rds").
  [/sql|\bdb|database|crdb|cockroach|postgres|mysql|\brds|spanner|dynamo|mongo|redis/, "database"],
  [/queue|topic|sns|sqs|pubsub|pub-sub|kafka|eventhub|servicebus/, "queue"],
  [/function|lambda|cloudfunction/, "function"],
  [/cluster|kubernetes|gke|eks|aks|node|pod|deployment|statefulset|container|fargate|ecs/, "container"],
  // DNS before network so route53/clouddns aren't caught by the network `route`.
  [/dns|zone|record|route53|clouddns/, "dns"],
  // Split the old catch-all "network" into recognisable types, so a security
  // group looks like a shield, a gateway like a gateway, etc. — and these come
  // before the load-balancer rule so e.g. InternetGateway isn't read as an ALB.
  [/firewall|securitygroup|security-group|networkacl|\bnacl|\bwaf/, "firewall"],
  [/internetgateway|natgateway|transitgateway|vpngateway|gatewayattachment|\bigw\b/, "gateway"],
  [/routetable|routeassociation|\broute\b|peering/, "route"],
  [/subnet/, "subnet"],
  [/\bvpc|\bvnet|network|router/, "network"],
  [/loadbalanc|ingress|\balb|\belb|frontdoor|appgateway|apigateway/, "loadbalancer"],
  [/secret|kms|cert|vault|keyvault|credential|password/, "secret"],
  [/job|pipeline|workflow|action|build|stage/, "pipeline"],
  [/user|account|role|identity|principal|serviceaccount/, "user"],
  [/internet|cdn|edge|public/, "internet"],
  [/instance|vm|compute|machine|server/, "compute"],
];

/** Infer a generic category from a resource kind. Returns "generic" if none match. */
export function categoryForKind(kind: string): string {
  const k = kind.toLowerCase();
  for (const [re, cat] of CATEGORY_RULES) if (re.test(k)) return cat;
  return "generic";
}

/** A per-lexicon presentation pack: icon mapping and optional label fields. */
export interface PresentationPack {
  lexicon: string;
  /** Return a glyph/category name for a kind, or undefined to fall through. */
  iconFor(kind: string): string | undefined;
  /** Pick label fields for a node, or undefined to fall through to the default. */
  fields?(node: { kind: string; lexicon: string; attrs: Record<string, unknown> }): import("./labels.ts").Field[] | undefined;
}

const packs = new Map<string, PresentationPack>();

/** Register a presentation pack for a lexicon. */
export function registerPack(pack: PresentationPack): void {
  packs.set(pack.lexicon, pack);
}

/** Get the registered pack for a lexicon, if any. */
export function getPack(lexicon: string): PresentationPack | undefined {
  return packs.get(lexicon);
}

/** Clear all registered packs (test helper). */
export function clearPacks(): void {
  packs.clear();
}

/**
 * Resolve a node to a glyph via the chain: override → lexicon pack → generic
 * category → default. Always returns a glyph (falls back to "generic").
 */
export function resolveGlyph(
  node: { lexicon: string; kind: string },
  opts: { override?: string } = {},
): Glyph {
  const key = opts.override ?? getPack(node.lexicon)?.iconFor(node.kind) ?? categoryForKind(node.kind);
  const body = GENERIC_GLYPHS[key];
  return body ? { name: key, body } : { name: "generic", body: GENERIC_GLYPHS.generic };
}

// One example lexicon pack, to prove the plugin shape (#6). GitLab CI is jobs in
// a pipeline, which the keyword heuristic already gets — this just makes the
// mapping explicit and overridable.
registerPack({
  lexicon: "gitlab",
  iconFor: (kind) => (/job/i.test(kind) ? "pipeline" : undefined),
});

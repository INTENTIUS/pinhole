/**
 * Salience presentation pack — the *taxonomy home* (#28).
 *
 * The containment view's classification has two layers:
 *  - **topology** (in `containment.ts`) is lexicon-agnostic: it folds incidental
 *    config from the relationship shape, no kind knowledge needed.
 *  - **taxonomy** (here) is lexicon knowledge: which kinds are places vs plumbing,
 *    which attrs mean "lives in", and which kinds read as ingress / workload /
 *    valuable. That residue lives in a *pack* so it can be swapped or extended per
 *    lexicon (the #6 presentation-pack lane) instead of being baked into the
 *    renderer. `defaultPack` is the built-in AWS-flavoured heuristic set.
 */

export type Role = "place" | "policy" | "thing" | "plumbing";

/** What the diagram is *about* — drives what's salient. `app` (default): the
 * network is light context, the workload is the subject. `network`: VPC/subnets
 * are the structured subject. `security`: security groups are first-class. */
export type Focus = "app" | "network" | "security";

export interface SaliencePack {
  /** kind → role, plumbing-first; first match wins, default `thing`. */
  roleRules: Array<[RegExp, Role]>;
  /** kinds promoted to a structured `place` under network focus. */
  networkPlace: RegExp;
  /** kinds promoted to first-class `policy` under security focus. */
  securityPolicy: RegExp;
  /** consumer attrs that mean "lives in" (containment, not a line). */
  livesIn: string[];
  /** consumer attrs where a resource *spans* places (lives in their common ancestor). */
  spans: string[];
  /** topology tie-breaks: kinds that read as an ingress, a workload, or a valuable
   * noun. Ingress/workload seed implied edges; all three are protected from
   * incidental collapse. */
  ingress: RegExp;
  workload: RegExp;
  valuable: RegExp;
}

export const defaultPack: SaliencePack = {
  roleRules: [
    // plumbing first — these would otherwise look like things/places. Collapsed
    // into the nearest place, recoverable on drill-down. Covers network detail,
    // security policy, and supporting resources (IAM roles, logs).
    [/subnet|routetable|\broute\b|routeassociation|gatewayattachment|internetgateway|natgateway|\beip\b|elasticip|securitygroup|firewall|\bwaf|networkacl|ingress|egress|\bacl\b|::role|loggroup|targetgroup|listener|taskdefinition/, "plumbing"],
    [/\bvpc|\bvnet/, "place"],
  ],
  networkPlace: /^(?=.*(?:subnet|routetable))(?!.*(?:association|group)).*$/,
  securityPolicy: /securitygroup|firewall|\bwaf|networkacl/,
  livesIn: ["VpcId", "SubnetId"],
  spans: ["Subnets", "SubnetIds"],
  ingress: /loadbalanc|\balb\b|gateway|apigateway|cloudfront|distribution/,
  workload: /\bservice\b|\binstance\b|lambda|function|\btask\b|deployment|statefulset|\bpod\b/,
  valuable: /\bbucket\b|database|\bdb\b|\btable\b|\bqueue\b|topic|\bcache\b|filesystem|\befs\b|secret|repository|registry|\bstream\b|warehouse|datalake|\bvolume\b/,
};

/** Manual override channel (#28): assert what the IR can't express. */
export interface Hints {
  /** force a node's role, overriding classification (and protecting it from
   * incidental collapse). */
  roles?: Record<string, Role>;
  /** assert relationships the IR lacks (e.g. an ALB→service link); drawn as the
   * implied/dotted hint between kept nodes. */
  edges?: Array<{ from: string; to: string; label?: string }>;
}

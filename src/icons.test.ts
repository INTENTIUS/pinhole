import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  GENERIC_GLYPHS,
  categoryForKind,
  resolveGlyph,
  registerPack,
  getPack,
  clearPacks,
  awsIconPack,
  type IconContext,
  type PresentationPack,
} from "./icons.ts";

afterEach(() => {
  // The default gitlab pack is registered at import; restore it after tests
  // that clear the registry.
  clearPacks();
  registerPack({ lexicon: "gitlab", iconFor: (k) => (/job/i.test(k) ? "pipeline" : undefined) });
});

describe("GENERIC_GLYPHS", () => {
  it("every glyph has non-empty geometry", () => {
    for (const [name, body] of Object.entries(GENERIC_GLYPHS)) {
      expect(body, name).toMatch(/<(path|rect|circle|ellipse)/);
    }
  });
  it("has a generic default", () => {
    expect(GENERIC_GLYPHS.generic).toBeTruthy();
  });
});

describe("categoryForKind", () => {
  it("maps kinds to categories by keyword", () => {
    expect(categoryForKind("GcsBucket")).toBe("storage");
    expect(categoryForKind("CockroachDbCluster")).toBe("database"); // db keyword wins
    expect(categoryForKind("PubSubTopic")).toBe("queue");
    expect(categoryForKind("GkeNodePool")).toBe("container");
    expect(categoryForKind("Vpc")).toBe("network");
    expect(categoryForKind("SomethingUnknown")).toBe("generic");
  });

  it("classifies AWS resource types to recognisable, type-specific icons", () => {
    expect(categoryForKind("AWS::EC2::Instance")).toBe("compute");
    expect(categoryForKind("AWS::S3::Bucket")).toBe("storage");
    expect(categoryForKind("AWS::RDS::DBInstance")).toBe("database");
    expect(categoryForKind("AWS::EC2::VPC")).toBe("network");
    expect(categoryForKind("AWS::EC2::Subnet")).toBe("subnet");
    expect(categoryForKind("AWS::EC2::SecurityGroup")).toBe("firewall");
    expect(categoryForKind("AWS::ElasticLoadBalancingV2::LoadBalancer")).toBe("loadbalancer");
  });

  it("splits the old catch-all network into gateway/route, not load balancer", () => {
    // `gateway` used to be a load-balancer keyword; these were also all one icon.
    expect(categoryForKind("AWS::EC2::InternetGateway")).toBe("gateway");
    expect(categoryForKind("AWS::EC2::VPCGatewayAttachment")).toBe("gateway");
    expect(categoryForKind("AWS::EC2::RouteTable")).toBe("route");
    expect(categoryForKind("AWS::EC2::Route")).toBe("route");
    expect(categoryForKind("AWS::EC2::SubnetRouteTableAssociation")).toBe("route"); // routing beats subnet
    // but real DNS routing still wins for route53
    expect(categoryForKind("AWS::Route53::RecordSet")).toBe("dns");
  });
});

describe("resolveGlyph (chain)", () => {
  it("override wins over everything", () => {
    expect(resolveGlyph({ lexicon: "gcp", kind: "Vpc" }, { override: "secret" }).name).toBe("secret");
  });

  it("a lexicon pack wins over the heuristic", () => {
    // gitlab pack maps Job → pipeline (heuristic would also say pipeline, so use
    // a pack that disagrees with the heuristic to prove precedence)
    clearPacks();
    registerPack({ lexicon: "gcp", iconFor: (k) => (k === "Vpc" ? "secret" : undefined) });
    expect(resolveGlyph({ lexicon: "gcp", kind: "Vpc" }).name).toBe("secret"); // not "network"
  });

  it("falls through to the heuristic when no pack matches", () => {
    expect(resolveGlyph({ lexicon: "gcp", kind: "GcsBucket" }).name).toBe("storage");
  });

  it("falls back to generic for unknown kinds", () => {
    const g = resolveGlyph({ lexicon: "x", kind: "Zzz" });
    expect(g.name).toBe("generic");
    expect(g.body).toBe(GENERIC_GLYPHS.generic);
  });

  it("an unknown override key degrades to generic", () => {
    expect(resolveGlyph({ lexicon: "x", kind: "y" }, { override: "nope" }).name).toBe("generic");
  });
});

describe("packs that carry their own geometry (#95)", () => {
  const MARK = `<circle cx="16" cy="16" r="12" fill="#326ce5"/><path d="M16 8v16" stroke="#fff"/>`;

  it("passes a GlyphSpec straight through, named by the kind", () => {
    clearPacks();
    registerPack({
      lexicon: "k8s",
      iconFor: (k) => (k === "Deployment" ? { body: MARK, colored: true, viewBox: "0 0 32 32" } : undefined),
    });
    const g = resolveGlyph({ lexicon: "k8s", kind: "Deployment" });
    expect(g.body).toBe(MARK);
    expect(g.colored).toBe(true);
    expect(g.viewBox).toBe("0 0 32 32");
    expect(g.name).toBe("Deployment"); // no GENERIC_GLYPHS key to be named by
  });

  it("a GlyphSpec may be monochrome — colored/viewBox are optional", () => {
    clearPacks();
    registerPack({ lexicon: "k8s", iconFor: () => ({ body: `<path d="M0 0h4"/>` }) });
    const g = resolveGlyph({ lexicon: "k8s", kind: "Anything" });
    expect(g.body).toBe(`<path d="M0 0h4"/>`);
    expect(g.colored).toBeUndefined();
    expect(g.viewBox).toBeUndefined();
  });

  it("a pack returning undefined for a kind still falls through to the heuristic", () => {
    clearPacks();
    registerPack({
      lexicon: "k8s",
      iconFor: (k) => (k === "Deployment" ? { body: MARK, colored: true } : undefined),
    });
    const g = resolveGlyph({ lexicon: "k8s", kind: "GcsBucket" });
    expect(g.name).toBe("storage");
    expect(g.body).toBe(GENERIC_GLYPHS.storage);
    expect(g.colored).toBeUndefined();
  });

  it("string-key packs are unchanged by the widened contract", () => {
    clearPacks();
    registerPack({ lexicon: "gcp", iconFor: (k) => (k === "Vpc" ? "secret" : undefined) });
    const g = resolveGlyph({ lexicon: "gcp", kind: "Vpc" });
    expect(g).toEqual({ name: "secret", body: GENERIC_GLYPHS.secret });
  });

  it("an unknown string key from a pack still degrades to generic", () => {
    clearPacks();
    registerPack({ lexicon: "gcp", iconFor: () => "no-such-glyph" });
    const g = resolveGlyph({ lexicon: "gcp", kind: "Vpc" });
    expect(g.name).toBe("generic");
    expect(g.body).toBe(GENERIC_GLYPHS.generic);
  });

  it("a GlyphSpec override wins over the pack", () => {
    clearPacks();
    registerPack({ lexicon: "gcp", iconFor: () => "secret" });
    const g = resolveGlyph({ lexicon: "gcp", kind: "Vpc" }, { override: { body: MARK, colored: true } });
    expect(g.body).toBe(MARK);
    expect(g.colored).toBe(true);
  });
});

describe("the ground a pack is told about (#107)", () => {
  const PLAIN = `<path d="M0 0h4"/>`;
  const PLATED = `<rect width="24" height="24" fill="#fff"/><path d="M0 0h4"/>`;

  /** A pack that records every ctx it was handed. */
  const spyPack = (seen: Array<IconContext | undefined>) =>
    registerPack({
      lexicon: "k8s",
      iconFor: (_kind, ctx) => {
        seen.push(ctx);
        return { body: PLAIN, colored: true };
      },
    });

  it("threads the caller's ground into iconFor", () => {
    clearPacks();
    const seen: Array<IconContext | undefined> = [];
    spyPack(seen);
    resolveGlyph({ lexicon: "k8s", kind: "Deployment" }, { ground: "var(--pin-warnFill, #2A1417)" });
    expect(seen).toEqual([{ ground: "var(--pin-warnFill, #2A1417)" }]);
  });

  it("always hands the pack a ctx object, with ground undefined when the caller has none", () => {
    clearPacks();
    const seen: Array<IconContext | undefined> = [];
    spyPack(seen);
    resolveGlyph({ lexicon: "k8s", kind: "Deployment" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeDefined();
    expect(seen[0]!.ground).toBeUndefined();
  });

  it("lets a pack pick a plate per ground, and the unplated mark elsewhere", () => {
    clearPacks();
    registerPack({
      lexicon: "k8s",
      // The behold case (#246/#255): plate only where the ground is the one the
      // mark's ink dies on, instead of baking a plate that works everywhere.
      iconFor: (_kind, ctx) => ({ body: ctx?.ground?.includes("warnFill") ? PLATED : PLAIN, colored: true }),
    });
    expect(resolveGlyph({ lexicon: "k8s", kind: "D" }, { ground: "var(--pin-warnFill, #2A1417)" }).body).toBe(PLATED);
    expect(resolveGlyph({ lexicon: "k8s", kind: "D" }, { ground: "var(--pin-goodFill, #102A1E)" }).body).toBe(PLAIN);
    expect(resolveGlyph({ lexicon: "k8s", kind: "D" }).body).toBe(PLAIN);
  });

  it("a single-argument pack is unaffected — same glyph, ground or no ground", () => {
    clearPacks();
    // Written exactly as packs were before #107: one parameter, no ctx. That it
    // type-checks as a PresentationPack is half the contract.
    const pack: PresentationPack = { lexicon: "gcp", iconFor: (kind) => (kind === "Vpc" ? "secret" : undefined) };
    registerPack(pack);
    const withGround = resolveGlyph({ lexicon: "gcp", kind: "Vpc" }, { ground: "var(--pin-warnFill, #2A1417)" });
    expect(withGround).toEqual(resolveGlyph({ lexicon: "gcp", kind: "Vpc" }));
    expect(withGround).toEqual({ name: "secret", body: GENERIC_GLYPHS.secret });
  });

  it("an override short-circuits the pack, so no ground is offered", () => {
    clearPacks();
    const seen: Array<IconContext | undefined> = [];
    spyPack(seen);
    const g = resolveGlyph(
      { lexicon: "k8s", kind: "Deployment" },
      { override: "secret", ground: "var(--pin-goodFill, #102A1E)" },
    );
    expect(g.name).toBe("secret");
    expect(seen).toEqual([]);
  });

  it("ground does not reach the heuristic fallback", () => {
    clearPacks();
    const g = resolveGlyph({ lexicon: "nobody", kind: "GcsBucket" }, { ground: "var(--pin-warnFill, #2A1417)" });
    expect(g).toEqual({ name: "storage", body: GENERIC_GLYPHS.storage });
  });
});

describe("aws icon pack (#75)", () => {
  // The file's afterEach clears packs (restoring only gitlab), so re-register.
  beforeEach(() => registerPack(awsIconPack));

  it("maps common AWS types precisely", () => {
    const pack = getPack("aws")!;
    expect(pack.iconFor("AWS::RDS::DBInstance")).toBe("database");
    expect(pack.iconFor("AWS::S3::Bucket")).toBe("bucket");
    expect(pack.iconFor("AWS::DynamoDB::Table")).toBe("table");
    expect(pack.iconFor("AWS::EC2::SecurityGroup")).toBe("firewall");
    expect(pack.iconFor("AWS::ElasticLoadBalancingV2::LoadBalancer")).toBe("loadbalancer");
  });
  it("falls through to the heuristic for unmapped kinds", () => {
    expect(getPack("aws")!.iconFor("AWS::Weird::Thing")).toBeUndefined();
  });
  it("resolveGlyph uses the pack for aws nodes", () => {
    expect(resolveGlyph({ lexicon: "aws", kind: "AWS::S3::Bucket" }).name).toBe("bucket");
  });
});

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  GENERIC_GLYPHS,
  categoryForKind,
  resolveGlyph,
  registerPack,
  getPack,
  clearPacks,
  awsIconPack,
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

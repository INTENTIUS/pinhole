import { describe, it, expect, afterEach } from "vitest";
import { renderSvg, cardFootprint, cardSizes, type GroupBox } from "./render.ts";
import { registerPack, clearPacks, GENERIC_GLYPHS, awsIconPack } from "../icons.ts";
import { getTheme, v } from "../theme.ts";
import type { GraphIR, Layout } from "../ir.ts";

const ir: GraphIR = {
  nodes: [
    { id: "vpc", kind: "Vpc", lexicon: "gcp", attrs: { region: "us-east1" } },
    { id: "subnet", kind: "Subnet", lexicon: "gcp", attrs: {} },
  ],
  edges: [{ from: "subnet", to: "vpc", kind: "ref", viaAttr: "network" }],
  groups: {},
};
const layout: Layout = {
  width: 200,
  height: 200,
  nodes: [
    { id: "vpc", x: 100, y: 180 },
    { id: "subnet", x: 100, y: 20 },
  ],
};

describe("renderSvg animation", () => {
  it("applies no animation classes by default (CSS is present, unused)", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).not.toContain('class="pin-pulse"');
    expect(svg).not.toContain('class="pin-flow"');
  });

  it("pulses highlighted nodes only", () => {
    const svg = renderSvg(ir, layout, { animate: { pulse: ["vpc"] } });
    // exactly one card group carries the pulse class
    expect(svg.match(/class="pin-pulse"/g)?.length).toBe(1);
  });

  it("animates edge flow when requested", () => {
    const svg = renderSvg(ir, layout, { animate: { flow: true } });
    expect(svg).toMatch(/class="pin-edge-line pin-flow"/);
  });

  it("always ships the reduced-motion-guarded keyframes", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).toContain("prefers-reduced-motion: no-preference");
    expect(svg).toContain("@keyframes pin-pulse");
    expect(svg).toContain("@keyframes pin-flow");
  });

  it("portable output never contains foreignObject", () => {
    const svg = renderSvg(ir, layout, { animate: { pulse: ["vpc"], flow: true } });
    expect(svg).not.toContain("foreignObject");
  });
});

describe("renderSvg edge hooks (relationship rollover)", () => {
  it("stamps each edge with its reference (from/to/via) for rollover", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).toContain('data-edge-from="subnet"');
    expect(svg).toContain('data-edge-to="vpc"');
    expect(svg).toContain('data-edge-via="network"');
  });

  it("gives each edge a transparent wide hit-path so thin lines are hoverable", () => {
    const svg = renderSvg(ir, layout);
    expect(svg).toContain('stroke="transparent"');
    expect(svg).toContain('pointer-events="stroke"');
  });
});

describe("renderSvg node hooks", () => {
  it("stamps data-node-id on every node, in both tiers", () => {
    for (const tier of ["portable", "rich"] as const) {
      const svg = renderSvg(ir, layout, { tier });
      expect(svg).toContain('data-node-id="vpc"');
      expect(svg).toContain('data-node-id="subnet"');
    }
  });

  it("keeps the data-node-id and the pulse class together when emphasized", () => {
    const svg = renderSvg(ir, layout, { animate: { pulse: ["vpc"] } });
    expect(svg).toMatch(/data-node-id="vpc" class="pin-pulse"/);
  });
});

describe("renderSvg text fitting", () => {
  const longId = "aVeryLongResourceNameThatOverflowsTheCard";
  const longIr: GraphIR = { nodes: [{ id: longId, kind: "Vpc", lexicon: "aws", attrs: {} }], edges: [], groups: {} };
  const longLayout: Layout = { width: 200, height: 100, nodes: [{ id: longId, x: 100, y: 50 }] };

  it("ellipsizes a card title too wide for the card (portable text can't clip itself)", () => {
    const svg = renderSvg(longIr, longLayout);
    const title = svg.match(/font-weight="700">([^<]*)</)?.[1] ?? "";
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThan(longId.length);
    // the full id still rides on the hook for hover/inspect, just not as visible text
    expect(svg).toContain(`data-node-id="${longId}"`);
  });
});

describe("card sizes (the --node-sizes map for chant's layout)", () => {
  it("gives a fixed width and a height that grows with field rows", () => {
    const a = cardFootprint({ id: "a", kind: "Vpc", lexicon: "aws", attrs: {} });
    const b = cardFootprint({ id: "b", kind: "Vpc", lexicon: "aws", attrs: { region: "us-east1", cidr: "10.0.0.0/16" } });
    expect(a.w).toBe(b.w); // width is fixed
    expect(b.h).toBeGreaterThan(a.h); // more fields → taller card
  });

  it("matches the height renderSvg paints for the same node", () => {
    // cardSizes feeds the layout; the painter must draw at that same height, or
    // spacing and drawing disagree. Both derive from cardFootprint.
    const node = ir.nodes[0];
    const { h } = cardFootprint(node);
    const svg = renderSvg(ir, layout);
    expect(svg).toContain(`height="${h}"`);
  });

  it("covers every node id", () => {
    expect(Object.keys(cardSizes(ir)).sort()).toEqual(["subnet", "vpc"]);
  });

  it("honours per-node field overrides", () => {
    const base = cardFootprint(ir.nodes[0]);
    const overridden = cardFootprint(ir.nodes[0], { override: { fields: [{ label: "x", value: "1" }, { label: "y", value: "2" }] } });
    expect(overridden.h).not.toBe(base.h);
  });

  it("icon style is a fixed compact footprint, uniform across nodes", () => {
    const a = cardFootprint(ir.nodes[0], { style: "icon" });
    const b = cardFootprint({ id: "b", kind: "Vpc", lexicon: "aws", attrs: { region: "x", cidr: "y", az: "z" } }, { style: "icon" });
    expect(a).toEqual(b); // independent of attrs/fields
    expect(a.w).toBeLessThan(180); // smaller than a card
    const sizes = cardSizes(ir, { style: "icon" });
    expect(Object.values(sizes).every((s) => s.w === a.w && s.h === a.h)).toBe(true);
  });
});

describe("renderSvg icon style", () => {
  it("draws a glyph + a single truncated label, no kind/field text", () => {
    const longIr: GraphIR = {
      nodes: [{ id: "aVeryLongNodeNameToTruncate", kind: "SecurityGroup", lexicon: "aws", attrs: { region: "us-east1" } }],
      edges: [],
      groups: {},
    };
    const longLayout: Layout = { width: 200, height: 100, nodes: [{ id: "aVeryLongNodeNameToTruncate", x: 100, y: 50 }] };
    const svg = renderSvg(longIr, longLayout, { style: "icon" });
    expect(svg).toContain('text-anchor="middle"'); // centered label
    expect(svg).toContain('data-node-id="aVeryLongNodeNameToTruncate"');
    expect(svg).toContain("…"); // label truncated
    expect(svg).not.toContain("SecurityGroup · aws"); // no kind sub-label
    expect(svg).not.toContain("region"); // no fields on an icon node
  });
});

describe("runtime status (behold#144)", () => {
  it("paints a runtime child with its own tokens, not neutral's", () => {
    const runtimeIr: GraphIR = {
      nodes: [
        { id: "pod", kind: "K8s::Core::Pod", lexicon: "k8s", attrs: { _status: "runtime" } },
        { id: "ghost", kind: "K8s::Core::Pod", lexicon: "k8s", attrs: {} },
      ],
      edges: [],
      groups: {},
    };
    const runtimeLayout: Layout = {
      width: 200,
      height: 200,
      nodes: [
        { id: "pod", x: 100, y: 180 },
        { id: "ghost", x: 100, y: 20 },
      ],
    };
    const svg = renderSvg(runtimeIr, runtimeLayout);
    expect(svg).toContain("--pin-runtimeBar");
    // The unstatused node still rides neutral — runtime is opt-in per node.
    expect(svg).toContain("--pin-neutralBar");
  });
});

describe("a pack's own glyphs reach the paint (#95, behold#227)", () => {
  const MARK = `<circle cx="16" cy="16" r="12" fill="#326ce5"/><path d="M16 8v16" stroke="#fff" stroke-width="3"/>`;
  const packIr: GraphIR = {
    nodes: [{ id: "api", kind: "K8s::Apps::Deployment", lexicon: "k8s", attrs: {} }],
    edges: [],
    groups: {},
  };
  const packLayout: Layout = { width: 200, height: 100, nodes: [{ id: "api", x: 100, y: 50 }] };
  const faint = v(getTheme(), "textFaint");

  afterEach(() => {
    // The module registers gitlab + aws at import; restore them.
    clearPacks();
    registerPack({ lexicon: "gitlab", iconFor: (k) => (/job/i.test(k) ? "pipeline" : undefined) });
    registerPack(awsIconPack);
  });

  const colorPack = (viewBox?: string) =>
    registerPack({
      lexicon: "k8s",
      iconFor: (k) => (k.endsWith("Deployment") ? { body: MARK, colored: true, viewBox } : undefined),
    });

  it("paints a colored mark as authored — no theme stroke, no fill:none", () => {
    clearPacks();
    colorPack("0 0 32 32");
    const svg = renderSvg(packIr, packLayout);
    // The scaled <g> wrapping the mark carries a transform and nothing else.
    const g = svg.match(/<g transform="[^"]*"[^>]*>(?=<circle cx="16")/)![0];
    expect(g).toBe(`<g transform="translate(104 209) scale(0.6875)">`); // 22px into a 32 box
    expect(g).not.toContain("stroke");
    expect(g).not.toContain('fill="none"');
    expect(svg).toContain(MARK); // the authored fills survive verbatim
  });

  it("still strokes a pack glyph that did not ask to be colored", () => {
    clearPacks();
    registerPack({ lexicon: "k8s", iconFor: () => ({ body: MARK }) });
    const svg = renderSvg(packIr, packLayout);
    const g = svg.match(/<g transform="[^"]*"[^>]*>(?=<circle cx="16")/)![0];
    expect(g).toBe(
      `<g transform="translate(104 209) scale(0.9167)" fill="none" stroke="${faint}" ` +
        `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`,
    );
  });

  it("a string-key pack paints exactly as it did before the widening", () => {
    clearPacks();
    registerPack({ lexicon: "k8s", iconFor: () => "container" });
    const svg = renderSvg(packIr, packLayout);
    expect(svg).toContain(GENERIC_GLYPHS.container);
    expect(svg).toContain(
      `<g transform="translate(104 209) scale(0.9167)" fill="none" stroke="${faint}" ` +
        `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GENERIC_GLYPHS.container}</g>`,
    );
  });

  it("carries a colored mark into the compact icon style too", () => {
    clearPacks();
    colorPack("0 0 32 32");
    const svg = renderSvg(packIr, packLayout, { style: "icon" });
    expect(svg).toContain(MARK);
    expect(svg).not.toMatch(/<g transform="[^"]*"[^>]*fill="none"[^>]*><circle cx="16"/);
  });
});

describe("a group box can carry a mark (#119)", () => {
  // The geometry, worked out once: MARGIN 80 + the 90px title band, a box centred
  // at (100,100) in a 200-tall layout → rect at (80,210), 200x120. The mark is an
  // 18px square inset 18px from the right edge (the mirror of the title's inset),
  // sitting on the title row.
  const box: GroupBox = { title: "ns", id: "argocd", x: 100, y: 100, w: 200, h: 120 };
  const RECT_X = 80;
  const RECT_Y = 210;
  const MARK_X = RECT_X + 200 - 18 - 18;
  const MARK_Y = RECT_Y + 9;
  const muted = v(getTheme(), "textMuted");
  const stroked = (body: string, ink = muted) =>
    `<g transform="translate(${MARK_X} ${MARK_Y}) scale(0.75)" fill="none" stroke="${ink}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

  it("renders an unmarked box byte-identically to what it always did", () => {
    const svg = renderSvg(ir, layout, { groups: [box] });
    expect(svg).toContain(
      `<rect data-group-id="argocd" x="${RECT_X}" y="${RECT_Y}" width="200" height="120" rx="16" ` +
        `fill="${v(getTheme(), "bg1")}" fill-opacity="0.6" stroke="${v(getTheme(), "neutralStroke")}" stroke-width="1.2"/>` +
        `<text x="${RECT_X + 18}" y="${RECT_Y + 23}" fill="${muted}" font-size="12" font-weight="700" letter-spacing=".5">ns</text>`,
    );
  });

  it("adds the mark and nothing else — the rest of the document is untouched", () => {
    const plain = renderSvg(ir, layout, { groups: [box] });
    const marked = renderSvg(ir, layout, { groups: [{ ...box, mark: "database" }] });
    expect(marked).not.toBe(plain);
    expect(marked.replace(stroked(GENERIC_GLYPHS.database), "")).toBe(plain);
  });

  it("paints a GENERIC_GLYPHS key in the top-right gutter, stroked like the title", () => {
    const svg = renderSvg(ir, layout, { groups: [{ ...box, mark: "user" }] });
    expect(svg).toContain(stroked(GENERIC_GLYPHS.user));
  });

  it("degrades an unknown key to generic, the same as a card does", () => {
    const svg = renderSvg(ir, layout, { groups: [{ ...box, mark: "no-such-glyph" }] });
    expect(svg).toContain(stroked(GENERIC_GLYPHS.generic));
  });

  it("paints an authored colored mark as authored — no theme stroke, no fill:none", () => {
    const MARK = `<circle cx="16" cy="16" r="12" fill="#326ce5"/>`;
    const svg = renderSvg(ir, layout, { groups: [{ ...box, mark: { body: MARK, colored: true, viewBox: "0 0 32 32" } }] });
    // 18px into a 32 box → 0.5625, and the wrapper says nothing about paint.
    expect(svg).toContain(`<g transform="translate(${MARK_X} ${MARK_Y}) scale(0.5625)">${MARK}</g>`);
  });

  it("tints the mark with the box's status, exactly as it tints the title", () => {
    const svg = renderSvg(ir, layout, { groups: [{ ...box, status: "warn", mark: "secret" }] });
    const ink = v(getTheme(), "warnStroke");
    expect(svg).toContain(stroked(GENERIC_GLYPHS.secret, ink));
    // …the same value the title is painted in — one colour for the box's identity.
    expect(svg).toContain(`fill="${ink}" font-size="12" font-weight="700"`);
  });

  it("follows the theme: a mark in the light theme carries the light token", () => {
    const svg = renderSvg(ir, layout, { groups: [{ ...box, mark: "bucket" }], theme: getTheme("light") });
    expect(svg).toContain(`stroke="${v(getTheme("light"), "textMuted")}"`);
    expect(svg).not.toContain(muted);
  });

  it("leaves the title and the group id alone — the mark is not smuggled through them", () => {
    const svg = renderSvg(ir, layout, { groups: [{ ...box, mark: "queue" }] });
    expect(svg).toContain(`letter-spacing=".5">ns</text>`);
    expect(svg).toContain(`data-group-id="argocd"`);
  });

  it("marks a titleless box too — the mark does not depend on there being a title", () => {
    const svg = renderSvg(ir, layout, { groups: [{ ...box, title: "", mark: "dns" }] });
    expect(svg).toContain(stroked(GENERIC_GLYPHS.dns));
    expect(svg).not.toContain("letter-spacing=\".5\"");
  });
});

describe("the painter tells the pack what ground it picked (#107)", () => {
  const warnIr: GraphIR = {
    nodes: [{ id: "api", kind: "K8s::Apps::Deployment", lexicon: "k8s", attrs: { _status: "warn" } }],
    edges: [],
    groups: {},
  };
  const warnLayout: Layout = { width: 200, height: 100, nodes: [{ id: "api", x: 100, y: 50 }] };

  afterEach(() => {
    clearPacks();
    registerPack({ lexicon: "gitlab", iconFor: (k) => (/job/i.test(k) ? "pipeline" : undefined) });
    registerPack(awsIconPack);
  });

  /** Register a pack that records the ground it was handed and returns a mark. */
  const recordGround = (seen: Array<string | undefined>) => {
    clearPacks();
    registerPack({
      lexicon: "k8s",
      iconFor: (_k, ctx) => {
        seen.push(ctx?.ground);
        return { body: `<path d="M0 0h4"/>`, colored: true };
      },
    });
  };

  it("hands the pack the very string it paints the card with", () => {
    const seen: Array<string | undefined> = [];
    recordGround(seen);
    const svg = renderSvg(warnIr, warnLayout);
    // Pin the shape rather than trust it: the ground must be the `fill` on the
    // card rect the glyph lands on, character for character.
    const cardFill = svg.match(/<rect x="\d+" y="\d+" width="180"[^>]*fill="([^"]+)"/)![1];
    expect(seen).toEqual([cardFill]);
    // …and that string is the var(--pin-<token>, <baked>) form, naming the
    // status token pinhole chose and the colour it bakes for this theme.
    expect(cardFill).toBe(`var(--pin-warnFill, ${getTheme().tokens.warnFill})`);
    expect(cardFill).toBe("var(--pin-warnFill, #2A1417)");
  });

  it("names the neutral fill for an untinted card, and follows the theme", () => {
    const seen: Array<string | undefined> = [];
    recordGround(seen);
    renderSvg(
      { nodes: [{ id: "api", kind: "K8s::Apps::Deployment", lexicon: "k8s", attrs: {} }], edges: [], groups: {} },
      warnLayout,
      { theme: getTheme("light") },
    );
    expect(seen).toEqual([v(getTheme("light"), "neutralFill")]);
    expect(seen[0]).toBe("var(--pin-neutralFill, #FFFFFF)");
  });

  it("names the badge fill in the compact icon style too", () => {
    const seen: Array<string | undefined> = [];
    recordGround(seen);
    const svg = renderSvg(warnIr, warnLayout, { style: "icon" });
    const badgeFill = svg.match(/<rect x="\d+" y="\d+" width="48" height="48"[^>]*fill="([^"]+)"/)![1];
    expect(seen).toEqual([badgeFill]);
    expect(badgeFill).toBe("var(--pin-warnFill, #2A1417)");
  });

  it("a pack branching on the ground paints the variant it chose", () => {
    clearPacks();
    const PLATE = `<rect width="24" height="24" fill="#FFFFFF"/>`;
    registerPack({
      lexicon: "k8s",
      iconFor: (_k, ctx) => ({
        body: (ctx?.ground?.includes("warnFill") ? PLATE : "") + `<circle cx="12" cy="12" r="8" fill="#326ce5"/>`,
        colored: true,
      }),
    });
    expect(renderSvg(warnIr, warnLayout)).toContain(PLATE);
    const calm: GraphIR = { ...warnIr, nodes: [{ ...warnIr.nodes[0], attrs: {} }] };
    expect(renderSvg(calm, warnLayout)).not.toContain(PLATE);
  });

  it("leaves single-argument packs painting exactly what they did before", () => {
    clearPacks();
    registerPack({ lexicon: "k8s", iconFor: () => "container" });
    expect(renderSvg(warnIr, warnLayout)).toContain(GENERIC_GLYPHS.container);
  });
});

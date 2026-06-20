import { describe, it, expect } from "vitest";
import { renderHtml } from "./html.ts";
import { renderSvg } from "./paint/render.ts";
import { getTheme, THEMES } from "./theme.ts";
import type { GraphIR, Layout } from "./ir.ts";

const ir: GraphIR = {
  nodes: [
    { id: "vpc", kind: "Vpc", lexicon: "gcp", attrs: { region: "us-east1" } },
    { id: "subnet", kind: "Subnet", lexicon: "gcp", attrs: { network: { $ref: "vpc.id" } } },
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

const svg = renderSvg(ir, layout, { theme: getTheme() });
const html = renderHtml(ir, svg, { title: "My Infra", theme: getTheme() });

describe("renderHtml", () => {
  it("inlines the SVG verbatim (not an <img>)", () => {
    expect(html).toContain(svg);
    expect(html).not.toContain("<img");
  });

  it("is a full self-contained document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("uses the title in the heading and document title", () => {
    expect(html).toContain("<title>My Infra · pinhole</title>");
    expect(html).toContain("<h1>My Infra</h1>");
  });

  it("ships a theme switcher with every theme, starting on the baked one", () => {
    for (const name of Object.keys(THEMES)) {
      expect(html).toContain(`<option value="${name}"`);
    }
    expect(html).toContain('<option value="dark" selected>dark</option>');
  });

  it("embeds the theme token tables for live switching", () => {
    // a known token value should be present in the embedded THEMES map
    expect(html).toContain(THEMES.light.tokens.bg0);
    expect(html).toContain("root.style.setProperty");
  });

  it("embeds the IR node table for the inspector", () => {
    expect(html).toContain('"vpc"');
    expect(html).toContain('"region"');
    expect(html).toContain('"$ref"');
  });

  it("has hooks for hover tooltip and click inspector", () => {
    expect(html).toContain('id="pin-tooltip"');
    expect(html).toContain('id="pin-inspector"');
    expect(html).toContain('data-node-id="vpc"');
  });

  it("wires edge rollovers: relationship hooks + ref resolution", () => {
    // the inlined SVG carries the edge's reference …
    expect(html).toContain('data-edge-from="subnet"');
    expect(html).toContain('data-edge-to="vpc"');
    expect(html).toContain("data-edge-via");
    // … and the viewer resolves the exact $ref the consumer attr holds
    expect(html).toContain("function refValue");
    expect(html).toContain("class='pin-ref'");
  });

  it("triggers flow animation on the focused set when hovering (not the whole graph)", () => {
    expect(html).toContain("function focusNode");
    // hovering a node animates its incident edges via the guarded pin-flow class
    expect(html).toContain('classList.add("pin-flow")');
    expect(html).toContain("data-edge-from"); // edges are enumerated to find incident ones
    // the keyframes it reuses are reduced-motion guarded (shipped in the SVG defs)
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain("@keyframes pin-flow");
  });

  it("lets you click an edge to pin the relationship into the inspector", () => {
    expect(html).toContain("function renderEdgeInspector");
    expect(html).toContain("edgeElFrom(e.target)"); // click handler dispatches to edges
    // selecting an edge lights its endpoints + line (selection drives the modal)
    expect(html).toContain(".pin-sel .pin-edge-line");
  });

  it("renders the inspector as a centered modal dismissable by backdrop and Escape", () => {
    expect(html).toContain('id="pin-backdrop"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // backdrop-click and Escape close it
    expect(html).toContain('e.target === backdrop');
    expect(html).toContain('"Escape"');
    // attrs render as stacked key-over-value rows (room for long ARNs/keys)
    expect(html).toContain("class='pin-attrs'");
  });

  it("polishes inspector values: pretty JSON, per-value scroll, and copy buttons", () => {
    expect(html).toContain("JSON.stringify(v, null, 2)"); // objects/arrays pretty-printed
    expect(html).toContain("class='pin-copy'"); // a copy affordance per attr row
    expect(html).toContain("function copyText"); // clipboard with offline fallback
    expect(html).toContain("execCommand"); // the file:// fallback path
    expect(html).toContain("max-height: 240px"); // long values scroll within the row
  });

  it("works offline — no fetched external assets", () => {
    // xmlns="http://www.w3.org/..." is a namespace identifier, never fetched;
    // what must be absent is anything the browser would load over the network.
    expect(html).not.toContain("src=");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/href="https?:/);
    expect(html).not.toMatch(/url\(\s*https?:/);
  });

  it("never lets embedded data break out of the script element", () => {
    const sneaky: GraphIR = {
      nodes: [{ id: "x", kind: "K", lexicon: "l", attrs: { note: "</script><script>alert(1)" } }],
      edges: [],
      groups: {},
    };
    const out = renderHtml(sneaky, "<svg></svg>");
    // the literal closing tag from the data must be neutralized
    expect(out).not.toContain("</script><script>alert(1)");
    expect(out).toContain("\\u003c/script>");
  });

  it("defaults the title when none is given", () => {
    const out = renderHtml(ir, svg);
    expect(out).toContain("<title>Infrastructure · pinhole</title>");
  });
});

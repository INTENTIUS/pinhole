import { writeFile } from "node:fs/promises";
import { graphIr, graphLayout, type GraphOptions } from "./chant.ts";
import { getTheme } from "./theme.ts";
import { renderSvg, cardSizes } from "./paint/render.ts";
import { renderHtml } from "./html.ts";
import { renderMorphHtml, type MorphView } from "./morph.ts";
import { renderContainment } from "./containment.ts";

const USAGE = `pinhole — agentic infra diagrammer

Usage:
  pinhole render <project-dir> [-o out.svg] [--html out.html] [--title <text>]
                               [--theme <name>] [--rich] [--icon]
                               [--detail 0..3] [--lens <kind>:<target>] [--up] [--down]

Themes: dark (default), light, blueprint, aws.
--rich emits foreignObject HTML labels (browser/inline only); default is portable
native-SVG text that works as a static image and on GitHub.
--icon draws each node as a compact glyph + a truncated label (dense graphs);
the full name and attrs come from hover and the click inspector.
--morph (with --html) writes a multi-view artifact that morphs between detail
tiers — a composite expands into its members in place, shared nodes keep their
identity. Needs at least two distinct tiers.
--containment (experimental) drops low-signal plumbing and renders places (VPC,
subnet) as nested bounding boxes with their resources inside; only dependency
refs stay as lines.

--html writes a self-contained, offline interactive artifact: the SVG inlined,
plus a live theme switcher and hover/click inspection of node attrs. The plain
\`.svg\` output is unchanged.

Animation (CSS, reduced-motion guarded; animates in a browser, still elsewhere):
  --highlight <id,id>  pulse those nodes (emphasis)
  --flow               animate flow direction along edges

Renders a chant project to SVG. pinhole shells \`chant graph\` for the graph IR
and node positions (\`--format ir\` / \`--format layout\`) and paints them, so the
picture is always lint-clean infra. It feeds chant the measured card sizes so the
layout spaces for real cards; layout uses dagre, so no native dependency.

Options mirror \`chant graph\`: --detail and --lens shape what's drawn.
`;

/** CLI entry. Returns a process exit code. */
export async function run(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (cmd === "render") return runRender(argv.slice(1));

  process.stderr.write(`pinhole: unknown command '${cmd}'\n\n${USAGE}`);
  return 2;
}

async function runRender(args: string[]): Promise<number> {
  let dir: string | undefined;
  let out: string | undefined;
  let html: string | undefined;
  let title: string | undefined;
  let themeName: string | undefined;
  let tier: "portable" | "rich" = "portable";
  let style: "card" | "icon" = "card";
  let morph = false;
  let containment = false;
  let pulse: string[] | undefined;
  let flow = false;
  const opts: GraphOptions = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") out = args[++i];
    else if (a === "--html") html = args[++i];
    else if (a === "--title") title = args[++i];
    else if (a === "--theme") themeName = args[++i];
    else if (a === "--rich") tier = "rich";
    else if (a === "--icon" || a === "--icons") style = "icon";
    else if (a === "--morph") morph = true;
    else if (a === "--containment" || a === "--boxes") containment = true;
    else if (a === "--highlight") pulse = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--flow") flow = true;
    else if (a === "--detail") opts.detail = Number(args[++i]);
    else if (a === "--lens") opts.lens = args[++i];
    else if (a === "--up") opts.up = true;
    else if (a === "--down") opts.down = true;
    else if (!a.startsWith("-")) dir = a;
  }

  if (!dir) {
    process.stderr.write(`pinhole: render needs a project directory\n\n${USAGE}`);
    return 2;
  }

  try {
    const theme = getTheme(themeName);

    if (morph) {
      if (!html) {
        process.stderr.write(`pinhole: --morph writes an interactive artifact; pass --html <file>\n`);
        return 2;
      }
      const views = await buildMorphViews(dir, opts, title);
      if (views.length < 2) {
        process.stderr.write(`pinhole: --morph needs at least two distinct views (detail tiers); this graph collapses to one\n`);
        return 1;
      }
      await writeFile(html, renderMorphHtml(views, { title, theme }));
      process.stderr.write(`pinhole: wrote ${html} (${views.length} views)\n`);
      return 0;
    }

    // IR first so we can measure each node's card; then lay out with those sizes
    // (same options, so the IR and layout node sets line up) and paint.
    const ir = await graphIr(dir, opts);
    // Containment view does its own salience filter + nested-box layout (no chant
    // layout needed); everything else goes through chant's size-aware layout.
    const svg = containment
      ? renderContainment(ir, { title, theme })
      : renderSvg(ir, await graphLayout(dir, opts, cardSizes(ir, { style })), {
          title,
          theme,
          tier,
          style,
          animate: { pulse, flow },
        });
    if (html) {
      await writeFile(html, renderHtml(ir, svg, { title, theme }));
      process.stderr.write(`pinhole: wrote ${html}\n`);
    }
    if (out) {
      await writeFile(out, svg);
      process.stderr.write(`pinhole: wrote ${out}\n`);
    }
    if (!out && !html) {
      process.stdout.write(svg);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`pinhole: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/** Render the graph at each detail tier (0..3), keeping only views with a
 * distinct node set, so the morph has meaningful frames to flip between. Nodes
 * are sized in icon style (the morph paints glyph badges). */
async function buildMorphViews(dir: string, opts: GraphOptions, _title?: string): Promise<MorphView[]> {
  const views: MorphView[] = [];
  const seen = new Set<string>();
  for (const detail of [0, 1, 2, 3]) {
    const tierOpts = { ...opts, detail };
    let ir;
    try {
      ir = await graphIr(dir, tierOpts);
    } catch {
      continue; // a tier that doesn't apply (e.g. no stacks) — skip
    }
    const signature = ir.nodes.map((n) => n.id).sort().join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    const layout = await graphLayout(dir, tierOpts, cardSizes(ir, { style: "icon" }));
    views.push({ name: `detail ${detail}`, ir, layout });
  }
  return views;
}

// Allow `node dist/cli.js ...` directly as well as via the bin launcher.
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}

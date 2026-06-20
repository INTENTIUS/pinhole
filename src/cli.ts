import { writeFile } from "node:fs/promises";
import { graphIr, graphLayout, type GraphOptions } from "./chant.ts";
import { getTheme } from "./theme.ts";
import { renderSvg, cardSizes } from "./paint/render.ts";
import { renderHtml } from "./html.ts";

const USAGE = `pinhole — agentic infra diagrammer

Usage:
  pinhole render <project-dir> [-o out.svg] [--html out.html] [--title <text>]
                               [--theme <name>] [--rich]
                               [--detail 0..3] [--lens <kind>:<target>] [--up] [--down]

Themes: dark (default), light, blueprint.
--rich emits foreignObject HTML labels (browser/inline only); default is portable
native-SVG text that works as a static image and on GitHub.

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
    // IR first so we can measure each node's card; then lay out with those sizes
    // (same options, so the IR and layout node sets line up) and paint.
    const ir = await graphIr(dir, opts);
    const layout = await graphLayout(dir, opts, cardSizes(ir));
    const svg = renderSvg(ir, layout, { title, theme, tier, animate: { pulse, flow } });
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

// Allow `node dist/cli.js ...` directly as well as via the bin launcher.
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}

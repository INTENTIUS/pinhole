import { writeFile } from "node:fs/promises";
import { graphIr, graphLayout, type GraphOptions } from "./chant.ts";
import { renderSvg } from "./paint/render.ts";

const USAGE = `pinhole — agentic infra diagrammer

Usage:
  pinhole render <project-dir> [-o out.svg] [--title <text>]
                               [--detail 0..3] [--lens <kind>:<target>] [--up] [--down]

Renders a chant project to SVG. pinhole shells \`chant graph\` for the graph IR
and node positions (\`--format ir\` / \`--format layout\`) and paints them, so the
picture is always lint-clean infra. Graphviz (\`dot\`) must be installed for the
layout step (\`brew install graphviz\`).

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
  let title: string | undefined;
  const opts: GraphOptions = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") out = args[++i];
    else if (a === "--title") title = args[++i];
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
    // Same options to both calls so the IR and layout node sets line up.
    const [ir, layout] = await Promise.all([graphIr(dir, opts), graphLayout(dir, opts)]);
    const svg = renderSvg(ir, layout, { title });
    if (out) {
      await writeFile(out, svg);
      process.stderr.write(`pinhole: wrote ${out}\n`);
    } else {
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

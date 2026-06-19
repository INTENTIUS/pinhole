import { readFile, writeFile } from "node:fs/promises";
import type { GraphIR } from "./ir.ts";
import { GraphvizLayout } from "./layout/graphviz.ts";
import { renderSvg } from "./paint/render.ts";

const USAGE = `pinhole — agentic infra diagrammer

Usage:
  pinhole render <ir.json> [-o out.svg] [--title <text>]

Until chant ships \`chant graph --format ir\` (#493), pass a graph-IR JSON file
exported separately. The IR is painted via the custom SVG painter, laid out with
Graphviz (\`dot\` must be installed — \`brew install graphviz\`).
`;

/** CLI entry. Returns a process exit code. */
export async function run(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (cmd === "render") {
    return runRender(argv.slice(1));
  }

  process.stderr.write(`pinhole: unknown command '${cmd}'\n\n${USAGE}`);
  return 2;
}

async function runRender(args: string[]): Promise<number> {
  let input: string | undefined;
  let out: string | undefined;
  let title: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") out = args[++i];
    else if (a === "--title") title = args[++i];
    else if (!a.startsWith("-")) input = a;
  }

  if (!input) {
    process.stderr.write(`pinhole: render needs an IR JSON file\n\n${USAGE}`);
    return 2;
  }

  const ir = JSON.parse(await readFile(input, "utf8")) as GraphIR;
  const layout = await new GraphvizLayout().layout(ir);
  const svg = renderSvg(ir, layout, { title });

  if (out) {
    await writeFile(out, svg);
    process.stderr.write(`pinhole: wrote ${out}\n`);
  } else {
    process.stdout.write(svg);
  }
  return 0;
}

// Allow `node dist/cli.js ...` directly as well as via the bin launcher.
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}

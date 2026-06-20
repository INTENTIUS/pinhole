import { writeFile, readFile } from "node:fs/promises";
import { graphIr, graphLayout, lint, type GraphOptions } from "./chant.ts";
import { getTheme } from "./theme.ts";
import { renderSvg, cardSizes } from "./paint/render.ts";
import { renderHtml } from "./html.ts";
import { renderMorphHtml, type MorphView } from "./morph.ts";
import { renderContainment, renderContainmentApp, type Focus, type Hints } from "./containment.ts";
import { summarizeIr, describeText } from "./inspect.ts";
import { GUIDE } from "./guide.ts";

const USAGE = `pinhole — agentic infra diagrammer

pinhole is a tool any agent (or human) drives: edit chant source, then validate
and render. Run \`pinhole guide\` for the agent-facing workflow.

Usage:
  pinhole describe <project-dir> [--json]      current nodes, edges, composites
  pinhole check    <project-dir> [--json]      run the lint gate (exit 0 = clean)
  pinhole guide                                how an agent drives pinhole
  pinhole render <project-dir> [-o out.svg] [--html out.html] [--title <text>]
                               [--theme <name>] [--rich] [--icon] [--json]
                               [--detail 0..3] [--lens <kind>:<target>] [--up] [--down]

Themes: dark (default), light, blueprint, aws.
--rich emits foreignObject HTML labels (browser/inline only); default is portable
native-SVG text that works as a static image and on GitHub.
--icon draws each node as a compact glyph + a truncated label (dense graphs);
the full name and attrs come from hover and the click inspector.
--morph (with --html) writes a multi-view artifact that morphs between detail
tiers — a composite expands into its members in place, shared nodes keep their
identity. Needs at least two distinct tiers.
--containment (experimental) drops low-signal plumbing and renders the VPC as a
boundary with its resources inside; only dependency refs stay as lines. Click
the VPC (in --html) to switch between app and network views.
--focus app|network|security shapes what's salient (default app): network is
light context, or the structured subject, or security policy is first-class.
--hints <file.json> (with --containment) overrides salience: { "roles": { id:
"thing"|"plumbing"|"place"|"policy" }, "edges": [ { "from": id, "to": id } ] } —
force-keep/drop a node, or assert a relationship the IR can't express.

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
  if (cmd === "check") return runCheck(argv.slice(1));
  if (cmd === "describe") return runDescribe(argv.slice(1));
  if (cmd === "guide") {
    process.stdout.write(GUIDE);
    return 0;
  }

  process.stderr.write(`pinhole: unknown command '${cmd}'\n\n${USAGE}`);
  return 2;
}

/** Split a verb's args into the project dir, the `--json` flag, and the chant
 * graph options (shared by check/describe). */
function parseInspectArgs(args: string[]): { dir?: string; json: boolean; opts: GraphOptions } {
  let dir: string | undefined;
  let json = false;
  const opts: GraphOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--detail") opts.detail = Number(args[++i]);
    else if (a === "--lens") opts.lens = args[++i];
    else if (a === "--up") opts.up = true;
    else if (a === "--down") opts.down = true;
    else if (!a.startsWith("-")) dir = a;
  }
  return { dir, json, opts };
}

/** Validate a project against chant's lint gate. Exit 0 = clean (rendering will
 * succeed); exit 1 = diagnostics (printed). The gate, surfaced for agents. */
async function runCheck(args: string[]): Promise<number> {
  const { dir, json } = parseInspectArgs(args);
  if (!dir) {
    process.stderr.write(`pinhole: check needs a project directory\n`);
    return 2;
  }
  try {
    const report = await lint(dir);
    if (json) {
      process.stdout.write(JSON.stringify({ ok: report.ok, diagnostics: report.diagnostics }, null, 2) + "\n");
    } else {
      process.stdout.write((report.stylish || (report.ok ? "✓ clean" : "lint failed")) + "\n");
    }
    return report.ok ? 0 : 1;
  } catch (err) {
    return fail(err, json);
  }
}

/** Dump the current graph IR as a digest — what an agent reads before editing. */
async function runDescribe(args: string[]): Promise<number> {
  const { dir, json, opts } = parseInspectArgs(args);
  if (!dir) {
    process.stderr.write(`pinhole: describe needs a project directory\n`);
    return 2;
  }
  try {
    const ir = await graphIr(dir, opts);
    process.stdout.write(json ? JSON.stringify(summarizeIr(ir), null, 2) + "\n" : describeText(ir));
    return 0;
  } catch (err) {
    return fail(err, json);
  }
}

/** Report an error either as JSON (for agents) or prose, and return exit 1. */
function fail(err: unknown, json: boolean): number {
  const message = err instanceof Error ? err.message : String(err);
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  else process.stderr.write(`pinhole: ${message}\n`);
  return 1;
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
  let focus: Focus = "app";
  let hintsPath: string | undefined;
  let pulse: string[] | undefined;
  let flow = false;
  let json = false;
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
    else if (a === "--focus") focus = (args[++i] as Focus) ?? "app";
    else if (a === "--hints") hintsPath = args[++i];
    else if (a === "--highlight") pulse = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--flow") flow = true;
    else if (a === "--json") json = true;
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

  // Record each written file; report as prose (human) or collected at the end (json).
  const wrote: string[] = [];
  const note = (path: string, extra = "") => {
    wrote.push(path);
    if (!json) process.stderr.write(`pinhole: wrote ${path}${extra}\n`);
  };
  const done = () => {
    if (json) process.stdout.write(JSON.stringify({ ok: true, wrote }) + "\n");
    return 0;
  };

  try {
    const theme = getTheme(themeName);

    if (morph) {
      if (!html) return fail(new Error("--morph writes an interactive artifact; pass --html <file>"), json);
      const views = await buildMorphViews(dir, opts, title);
      if (views.length < 2) {
        return fail(new Error("--morph needs at least two distinct views (detail tiers); this graph collapses to one"), json);
      }
      await writeFile(html, renderMorphHtml(views, { title, theme }));
      note(html, ` (${views.length} views)`);
      return done();
    }

    const ir = await graphIr(dir, opts);

    // Containment does its own salience filter + nested-box layout (no chant
    // layout). --html gets the interactive expand artifact; -o gets a static SVG.
    if (containment) {
      const hints = hintsPath ? (JSON.parse(await readFile(hintsPath, "utf8")) as Hints) : undefined;
      const copts = { title, theme, focus, hints };
      if (html) {
        await writeFile(html, renderContainmentApp(ir, copts));
        note(html);
      }
      if (out) {
        await writeFile(out, renderContainment(ir, copts));
        note(out);
      }
      if (!out && !html && !json) process.stdout.write(renderContainment(ir, copts));
      return done();
    }

    // Otherwise measure each node's card, lay out with those sizes, and paint.
    const svg = renderSvg(ir, await graphLayout(dir, opts, cardSizes(ir, { style })), {
      title,
      theme,
      tier,
      style,
      animate: { pulse, flow },
    });
    if (html) {
      await writeFile(html, renderHtml(ir, svg, { title, theme }));
      note(html);
    }
    if (out) {
      await writeFile(out, svg);
      note(out);
    }
    if (!out && !html && !json) {
      process.stdout.write(svg);
    }
    return done();
  } catch (err) {
    if (json) return fail(err, json);
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

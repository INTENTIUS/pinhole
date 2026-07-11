import { writeFile, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { graphIr, graphLayout, lint, type GraphOptions } from "./chant.ts";
import { getTheme } from "./theme.ts";
import { renderSvg, cardSizes } from "./paint/render.ts";
import { renderHtml } from "./html.ts";
import { renderMorphHtml, type MorphView } from "./morph.ts";
import { renderContainment, renderContainmentApp, renderTiersApp, type Focus, type Hints } from "./containment.ts";
import { diffTiers, unionGraph, deltaSummary } from "./diff.ts";
import { renderFlow } from "./flow.ts";
import { layoutIr } from "./concept.ts";
import { renderStacked } from "./stacked.ts";
import { renderSmallMultiples, smallMultiplesSvg } from "./smallmult.ts";
import { composeStacks, shortStackNames } from "./compose.ts";
import type { GraphIR } from "./ir.ts";
import { summarizeIr, describeText } from "./inspect.ts";
import { GUIDE } from "./guide.ts";

const USAGE = `pinhole — agentic infra diagrammer

pinhole is a tool any agent (or human) drives: edit chant source, then validate
and render. Run \`pinhole guide\` for the agent-facing workflow.

Usage:
  pinhole describe <project-dir> [--json]      current nodes, edges, composites
  pinhole check    <project-dir> [--json]      run the lint gate (exit 0 = clean)
  pinhole guide                                how an agent drives pinhole
  pinhole render <project-dir>... [--ir <ir.json>]... [-o out.svg] [--html out.html]
                               [--title <text>] [--theme <name>] [--rich] [--icon]
                               [--json] [--detail 0..3] [--lens <k>:<t>] [--up] [--down]
                               [--env <name>] [--diff <dir>] [--drift <base>:<target>]
                               [--concept --ir <ir.json> [--rankdir TB|BT|LR|RL] [--subtitle <text>]]

Themes: dark (default), light, blueprint, aws.
--concept paints a single hand-authored graph (--ir <file.json>) directly — no
chant project. pinhole lays it out itself and content-fits each card to its label,
for conceptual diagrams (layers, pipelines, fan-outs) rather than infra. --rankdir
sets flow direction (BT = roots at the bottom); --subtitle sets the line under the
title.
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
With --containment, pass several project dirs and/or --ir files to render them as
separate stacks, each in its own boundary box (multi-stack composition). pinhole
renders the IR, so --ir <file.json> draws a pre-captured graph from any source —
no chant needed.
--env <name> renders the project as that environment (chant re-evaluates env-aware
source for it). --diff <dir> paints a change diff against another project (added
green, changed blue, removed red). --drift <base>:<target> is the env-drift diff:
the same project at <base> vs <target> — e.g. --drift dev:prod shows what prod adds
over dev. Both diff modes drill: click a changed composite to see which resources
changed. Add --stacked for the tie-line view: one plane per environment, ties
connecting the same composite across them (straight = same, accent = changed, no
tie = drift). --envs <a,b,c> renders linked small-multiples: the project at each
environment side by side, aligned by composite, synced hover, gaps = drift.
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
  const dirs: string[] = []; // project dirs (graphed via chant) — each a stack
  const irFiles: string[] = []; // pre-captured IR files (--ir) — source-agnostic stacks
  let out: string | undefined;
  let html: string | undefined;
  let title: string | undefined;
  let subtitle: string | undefined;
  let concept = false; // paint a hand-authored --ir graph directly (no chant)
  let noTitle = false; // drop the title band (docs supply their own caption)
  let rankdir: "TB" | "BT" | "LR" | "RL" = "TB";
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
  let diffDir: string | undefined; // the "before" project to diff the render against
  let driftBase: string | undefined; // `--drift base:target` — diff one project across two envs
  let topology = false; // flow/topology lens
  let stacked = false; // stacked tie-line view for a diff/drift
  let envsList: string[] | undefined; // `--envs a,b,c` — linked small-multiples
  const opts: GraphOptions = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") out = args[++i];
    else if (a === "--html") html = args[++i];
    else if (a === "--title") title = args[++i];
    else if (a === "--subtitle") subtitle = args[++i];
    else if (a === "--concept") concept = true;
    else if (a === "--no-title") noTitle = true;
    else if (a === "--rankdir") rankdir = (args[++i] as typeof rankdir) ?? "TB";
    else if (a === "--theme") themeName = args[++i];
    else if (a === "--rich") tier = "rich";
    else if (a === "--icon" || a === "--icons") style = "icon";
    else if (a === "--morph") morph = true;
    else if (a === "--containment" || a === "--boxes") containment = true;
    else if (a === "--focus") focus = (args[++i] as Focus) ?? "app";
    else if (a === "--hints") hintsPath = args[++i];
    else if (a === "--ir") irFiles.push(args[++i]);
    else if (a === "--highlight") pulse = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--flow") flow = true;
    else if (a === "--json") json = true;
    else if (a === "--detail") opts.detail = Number(args[++i]);
    else if (a === "--diff") diffDir = args[++i];
    else if (a === "--env") opts.env = args[++i];
    else if (a === "--drift") { const [b, t] = (args[++i] ?? "").split(":"); driftBase = b; if (t) opts.env = t; }
    else if (a === "--topology" || a === "--flow-view") topology = true;
    else if (a === "--stacked") stacked = true;
    else if (a === "--envs") envsList = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--lens") opts.lens = args[++i];
    else if (a === "--up") opts.up = true;
    else if (a === "--down") opts.down = true;
    else if (!a.startsWith("-")) dirs.push(a);
  }

  const dir = dirs[0]; // morph/normal render operate on a single project
  const stackCount = dirs.length + irFiles.length;
  if (stackCount === 0) {
    process.stderr.write(`pinhole: render needs a project directory (or --ir <file>)\n\n${USAGE}`);
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
      if (stackCount > 1) return fail(new Error("--morph renders a single project; multiple stacks / --ir need --containment"), json);
      if (!dir) return fail(new Error("--morph needs a project directory (it graphs detail tiers via chant, not --ir)"), json);
      if (!html) return fail(new Error("--morph writes an interactive artifact; pass --html <file>"), json);
      const views = await buildMorphViews(dir, opts, title);
      if (views.length < 2) {
        return fail(new Error("--morph needs at least two distinct views (detail tiers); this graph collapses to one"), json);
      }
      await writeFile(html, renderMorphHtml(views, { title, theme }));
      note(html, ` (${views.length} views)`);
      return done();
    }

    // Containment composes multiple stacks — project dirs (graphed via chant)
    // and/or pre-captured IRs (--ir, any source) — into one diagram, each a
    // boundary box. It does its own layout (no chant layout), so --ir renders
    // without chant at all.
    if (containment) {
      const stacks: Array<{ name: string; ir: GraphIR }> = [];
      for (const d of dirs) stacks.push({ name: d, ir: await graphIr(d, opts) });
      for (const f of irFiles) stacks.push({ name: f, ir: JSON.parse(await readFile(f, "utf8")) as GraphIR });
      const names = shortStackNames(stacks.map((s) => s.name));
      const ir = stacks.length === 1 ? stacks[0].ir : composeStacks(stacks.map((s, i) => ({ name: names[i], ir: s.ir })));
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

    // Flow/topology lens — the architecture-diagram view (internet → ingress →
    // workload → data, public/private bands). Reads the declarable tier, where the
    // subnets/routes/ingress live, and does its own band layout.
    if (topology) {
      const flowIr = dir ? await graphIr(dir, { ...opts, detail: 2 }) : JSON.parse(await readFile(irFiles[0], "utf8")) as GraphIR;
      const svg = renderFlow(flowIr, { title, theme });
      if (html) { await writeFile(html, renderHtml(flowIr, svg, { title, theme })); note(html); }
      if (out) { await writeFile(out, svg); note(out); }
      if (!out && !html && !json) process.stdout.write(svg);
      return done();
    }

    // Linked small-multiples (#3): the same project graphed at each of N
    // environments, side by side, aligned by composite; synced hover, gaps = drift.
    if (envsList) {
      if (!dir) return fail(new Error("--envs needs a project directory"), json);
      if (envsList.length < 2) return fail(new Error("--envs needs at least two environments, e.g. --envs dev,staging,prod"), json);
      const panels = await Promise.all(envsList.map(async (e) => ({ env: e, composites: await graphIr(dir, { ...opts, detail: 1, env: e }) })));
      const smTitle = title ?? `${basename(resolve(dir))} · ${envsList.join(" · ")}`;
      if (html) { await writeFile(html, renderSmallMultiples(panels, { title: smTitle, theme })); note(html); }
      if (out) { await writeFile(out, smallMultiplesSvg(panels, theme, smTitle)); note(out); }
      if (!out && !html && !json) process.stdout.write(smallMultiplesSvg(panels, theme, smTitle));
      return done();
    }

    // Stacked tie-line view (#3): one plane per environment, ties connecting the
    // same composite across them — drift is a missing/accent tie. Needs a diff
    // source (--drift base:target or --diff <dir>).
    if (stacked) {
      if (!dir) return fail(new Error("--stacked needs a project directory"), json);
      if (!diffDir && !driftBase) return fail(new Error("--stacked needs --drift base:target (or --diff <dir>)"), json);
      const targetEnv = opts.env ?? basename(resolve(dir));
      const baseDir = driftBase ? dir : diffDir!;
      const baseEnv = driftBase ?? basename(resolve(diffDir!));
      const baseGraphEnv = driftBase ?? opts.env; // base: this dir at base-env, or the other dir at the same env
      const [tComp, tMem] = await Promise.all([graphIr(dir, { ...opts, detail: 1 }), graphIr(dir, { ...opts, detail: 2 })]);
      const [bComp, bMem] = await Promise.all([graphIr(baseDir, { ...opts, detail: 1, env: baseGraphEnv }), graphIr(baseDir, { ...opts, detail: 2, env: baseGraphEnv })]);
      const d = diffTiers(bComp, tComp, bMem, tMem);
      const stackedTitle = title ?? `${baseEnv} → ${targetEnv}`;
      const svg = renderStacked({ env: baseEnv, composites: bComp }, { env: targetEnv, composites: tComp }, d.status, { title: stackedTitle, theme });
      if (html) { await writeFile(html, renderHtml(tComp, svg, { title: stackedTitle, theme })); note(html); }
      if (out) { await writeFile(out, svg); note(out); }
      if (!out && !html && !json) process.stdout.write(svg);
      return done();
    }

    // Concept view — paint a hand-authored graph (`--ir <file>`) directly. No
    // chant project behind it: pinhole runs the layout itself (dagre) and reuses
    // the card painter. For docs diagrams (layers, pipelines, fan-outs) authored
    // as `<name>.ir.json`, not infrastructure.
    if (concept) {
      if (irFiles.length !== 1) return fail(new Error("--concept paints one hand-authored graph; pass exactly one --ir <file>"), json);
      const ir = JSON.parse(await readFile(irFiles[0], "utf8")) as GraphIR;
      // A concept node's body is its attrs, shown in author order — the infra
      // field template (short scalars only) drops the descriptive phrases these
      // diagrams carry, so pass them through as explicit field overrides.
      const overrides = Object.fromEntries(
        ir.nodes.map((n) => [
          n.id,
          {
            fields: Object.entries(n.attrs)
              .filter(([label]) => !label.startsWith("_")) // reserved (e.g. _status) — not a visible field
              .map(([label, value]) => ({ label, value: String(value) }))
              .slice(0, 4),
          },
        ]),
      );
      const hideTitle = noTitle || (!title && !subtitle);
      // Titled groups come from `groups.byStack` (name → node ids) — a boundary
      // box per group, members kept together.
      const groups = ir.groups?.byStack;
      const layout = layoutIr(ir, { style, rankdir, overrides, fit: true, groups });
      const svg = renderSvg(ir, layout, { title, subtitle, theme, tier, style, fit: true, hideTitle, overrides, groups: layout.groups, animate: { pulse, flow } });
      if (html) { await writeFile(html, renderHtml(ir, svg, { title, theme })); note(html); }
      if (out) { await writeFile(out, svg); note(out); }
      if (!out && !html && !json) process.stdout.write(svg);
      return done();
    }

    // The card view lays out via chant (one project, real card sizes), so it
    // needs a single project dir — not --ir or multiple stacks.
    if (stackCount > 1 || irFiles.length || !dir) {
      return fail(new Error("multiple stacks / --ir need --containment (the card view lays out one project via chant)"), json);
    }
    // Default to the *composite* tier (the declarations the author actually wrote
    // — `FargateAlb`, `VpcDefault`), not chant's full CloudFormation expansion.
    // pinhole renders chant at the altitude it was authored; detail tiers are the
    // zoom. Pass `--detail 2|3` to drill down to declarables/attributes.
    if (opts.detail === undefined) opts.detail = 1;
    // Env-drift diff: name it "<project> · <base> → <target>" so the header reads
    // as the drift it shows.
    if (!title && driftBase) title = `${basename(resolve(dir))} · ${driftBase} → ${opts.env}`;
    const ir = await graphIr(dir, opts);
    // Otherwise measure each node's card, lay out with those sizes, and paint.
    const svg = renderSvg(ir, await graphLayout(dir, opts, cardSizes(ir, { style })), {
      title,
      theme,
      tier,
      style,
      animate: { pulse, flow },
    });
    if (html) {
      // The interactive artifact is a tier-zoom: composites at this altitude,
      // drilling into the next detail tier's resources in place. (At the deepest
      // tier there's nothing to drill into — fall back to the flat card artifact.)
      const deepEnough = (opts.detail ?? 1) < 3;
      if (deepEnough) {
        const members = await graphIr(dir, { ...opts, detail: (opts.detail ?? 1) + 1 });
        // The "before" side of a diff: another project dir (`--diff <dir>`), or
        // the *same* project under a different environment (`--drift base:target`
        // → before = this dir at `base`, after = this dir at `target`).
        const before = diffDir ? { dir: diffDir, env: opts.env } : driftBase ? { dir: dir!, env: driftBase } : undefined;
        if (before) {
          // Classify the after graph against the before graph and paint the delta
          // (added/changed/removed/unchanged), member changes rolled up to their
          // composite. Render the *union* so removed nodes still show.
          const bOpts = { ...opts, env: before.env };
          const [bComp, bMem] = await Promise.all([graphIr(before.dir, bOpts), graphIr(before.dir, { ...bOpts, detail: (opts.detail ?? 1) + 1 })]);
          const d = diffTiers(bComp, ir, bMem, members);
          const uComp = unionGraph(bComp, ir), uMem = unionGraph(bMem, members);
          for (const node of [...uComp.nodes, ...uMem.nodes]) {
            if (d.deltas[node.id]?.length) (node.attrs as Record<string, unknown>)["Δ changed"] = deltaSummary(d.deltas[node.id]);
          }
          await writeFile(html, renderTiersApp(uComp, uMem, { title, theme, diff: d.status, diffEdges: d.edges }));
        } else {
          // Recursive zoom (#53): fetch the stack tier above the composites so the
          // view drills stack → composite → declarable. Only at the composite tier.
          let stack: GraphIR | undefined;
          if ((opts.detail ?? 1) === 1) {
            const s = await graphIr(dir, { ...opts, detail: 0 }).catch(() => undefined);
            if (s?.nodes.length) stack = s;
          }
          await writeFile(html, renderTiersApp(ir, members, { title, theme, stack }));
        }
      } else {
        await writeFile(html, renderHtml(ir, svg, { title, theme }));
      }
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

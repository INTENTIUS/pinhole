# pinhole

**An agentic infra diagrammer built on [chant](https://github.com/INTENTIUS/chant).**

pinhole turns chant's resolved infrastructure graph into diagrams. You describe a
few resources, chant expands composites and resolves the dependency graph, and
pinhole paints it — gated by lint at every step, so the picture is always valid
infrastructure. Describe a little, see all the pieces that belong, with the graph
verified before anything is drawn.

## How it fits

chant owns the deterministic part — a lint-gated **graph IR** (`chant graph
--format ir`), detail tiers, and lenses. pinhole owns the visual and interactive
part: the painter, the design system, the agent loop. pinhole depends on chant as
a library; chant never depends on pinhole.

```
chant source (.ts) ──build/lint──▶ graph IR ──pinhole──▶ diagram
                     (deterministic, auditable)   (layout + paint)
```

## Render paths

- **Mermaid** — the zero-install default. Renders in GitHub, browsers, and docs
  with no native dependency. Lower fidelity. (Emitted by chant; see #496.)
- **Graphviz** — the upgrade for people who want more. Needs `dot`
  (`brew install graphviz`). Powers pinhole's custom SVG painter, which uses
  Graphviz for layout only and draws its own visuals (the rackattack pattern).

A future pure-JS layout engine (elkjs / dagre) will let the custom painter run
without `dot`, erasing the install gap.

## Status

Early scaffold. The custom SVG painter and the Graphviz layout engine are in
place. They consume a graph-IR JSON file today; once chant ships `chant graph
--format ir` (chant#493) the IR type becomes a direct import and the agent loop
lands. Tracked in chant#492 / chant#498.

## Usage

```sh
npm install
npm run build
pinhole render graph.json -o infra.svg
```

`graph.json` is a graph IR (the shape in `src/ir.ts`). The agent loop — natural
language to chant source edits to re-render — is not built yet.

## Develop

```sh
npm run tsc    # typecheck
npm test       # vitest
npm run build  # bundle to dist/cli.js
```

# pinhole

**An agentic infra diagrammer built on [chant](https://github.com/INTENTIUS/chant).**

Published as [`@intentius/pinhole`](https://www.npmjs.com/package/@intentius/pinhole); the CLI is `pinhole`.

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

Wired to chant 0.10.0. pinhole shells `chant graph` for the graph IR
(`--format ir`) and node positions (`--format layout`) and paints them with the
custom SVG painter. The IR types are imported from `@intentius/chant`. Still to
come: the theme system (chant#498) and the natural-language agent loop.

## Usage

```sh
npm install
npm run build
pinhole render ./my-chant-project -o infra.svg --title "My infra"
```

`render` takes a chant project directory. Options mirror `chant graph`:

```sh
pinhole render ./infra --detail 1            # composites as single nodes
pinhole render ./infra --lens blast:vpc --down   # focus on a node's dependents
pinhole render ./infra --theme blueprint     # dark (default) | light | blueprint
```

Themes are CSS-variable driven: the chosen theme is baked as fallbacks (so a
standalone `.svg` / `<img>` / GitHub renders right), and a `:root` block lets a
browser flip `--pin-*` variables live when the SVG is inlined.

Because pinhole renders chant's lint-gated IR, the picture is always valid infra.
Graphviz (`dot`) must be installed for the layout step.

## Develop

```sh
npm run tsc    # typecheck
npm test       # vitest
npm run build  # bundle to dist/cli.js
```

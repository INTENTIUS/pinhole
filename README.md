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
- **The custom SVG painter** — pinhole's own, and the higher-fidelity path.
  Layout comes from dagre (pure JS — chant's `--format layout` defaults to it,
  and the `layoutIr` / `layoutArchitecture` library path runs it in-process);
  pinhole draws the visuals itself. No `dot`, no native dependency.

## Status

Wired to chant 0.52; `@intentius/chant` `^0.52.2` is the supported floor. pinhole
shells `chant graph` for the graph IR (`--format ir`) and node positions
(`--format layout`) and paints them with the custom SVG painter; the IR types are
imported from `@intentius/chant`.

chant 0.44 moved the detail dial (chant#1489): a tier now prunes each node's
attributes as well as the graph's shape, so a composite-tier (T1) node carries
only overlay paint and composite membership. pinhole's default altitude *is* T1
and its cards print a couple of fields from `attrs`, so `render` also reads the
resource tier and merges those attributes back onto the nodes T1 left standing —
`withResourceAttrs`, exported for consumers laying out an IR themselves.

The theme system is in (see `--theme` below). Still to come: the
natural-language agent loop.

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

Nodes get a type icon, resolved through a chain: per-node override → lexicon
presentation pack → generic category (inferred from the resource kind) →
default. The built-in glyphs are monochrome line icons that recolor with the
theme.

A pack registered with `registerPack` is not limited to those. Its `iconFor` may
return a key into the built-in set (a string, as before) or its own geometry:

```ts
import { registerPack } from "@intentius/pinhole/icons";

registerPack({
  lexicon: "k8s",
  iconFor: (kind) =>
    kind.endsWith("Deployment")
      ? { body: `<circle cx="16" cy="16" r="12" fill="#326ce5"/>`, colored: true, viewBox: "0 0 32 32" }
      : undefined,
});
```

`colored: true` tells the painter to emit the mark as authored — no theme
stroke, no `fill="none"` — which is how a lexicon-native or provider-authentic
(brand) icon set plugs in. Without it the geometry is stroked with the theme
token like the bundled glyphs. `viewBox` defaults to `0 0 24 24`; any other box
is fitted to the icon slot, aspect preserved.

An authored mark lands on a card whose fill pinhole chose, so `iconFor` gets a
second argument saying which fill that is:

```ts
registerPack({
  lexicon: "k8s",
  iconFor: (kind, ctx) => ({
    // a plate only where the mark's ink would die, not on every card
    body: ctx?.ground?.includes("warnFill") ? PLATED_MARK : MARK,
    colored: true,
  }),
});
```

`ctx.ground` is the exact `fill` attribute the painter puts on the shape under
the glyph, in the same `var(--pin-<token>, <baked>)` form everything else is
painted with — e.g. `var(--pin-warnFill, #2A1417)`. The token name tells you
which ground was picked (that is, the node's status); the baked hex is what it
looks like in the theme being rendered, which is what contrast math needs. A
browser overriding `--pin-*` live can repaint the ground afterwards, so treat
the hex as true for the requested theme, not forever.

It is undefined where pinhole can't answer honestly — the containment views
paint at partial opacity, so the glyph reads against a composite, not the fill.
A pack that sees `undefined` should do whatever it did before there was a ground
to ask about. The parameter is optional throughout: a pack written as
`iconFor: (kind) => …` still type-checks and still resolves the same glyph.

The `@intentius/pinhole/icons` subpath is the icon module on its own — no chant,
no node builtins — so a browser bundle can register a pack without pulling the
CLI's dependencies. It shares a module instance with the package root, so a pack
registered through it is the pack `renderSvg` paints with.

Node bodies show a few fields from the IR attrs (chosen by a template: per-node
override → lexicon pack → default scalar attrs). The default **portable** output
draws them as native SVG text — works as a static image and on GitHub. `--rich`
switches to `<foreignObject>` HTML labels (lists, richer layout) for inlining in
a browser; don't use it for static export.

Ambient animation is opt-in and semantic: `--highlight <id,…>` pulses nodes
(emphasis), `--flow` marches a dash along edges (flow direction). It's CSS,
guarded by `prefers-reduced-motion`, so it animates in a browser and shows a
still frame in static exports / on GitHub.

Because pinhole renders chant's lint-gated IR, the picture is always valid infra.

## Develop

```sh
npm run tsc    # typecheck
npm test       # vitest
npm run build  # bundle to dist/cli.js
```

# Driving pinhole (for agents)

pinhole turns a **chant** infrastructure project (TypeScript) into a diagram.
The division of labour: *you* (the agent) edit the chant source to match the
user's intent; *pinhole* validates and renders. pinhole does not call a model and
is not tied to any agent runtime — it's a plain CLI you drive.

## The loop

    1. describe  — read the current graph so you know what exists.
    2. edit      — change the chant .ts source to match the user's intent.
    3. check     — validate. Non-zero exit means invalid; fix and repeat.
    4. render    — produce the diagram (only ever runs on valid source).

Every rendered diagram is valid infrastructure, because chant's graph IR is
lint-gated — `check` is that same gate, surfaced so you can act on it without
rendering.

## Verbs

    pinhole describe <dir> [--json]   Current nodes, edges, and composites.
    pinhole check    <dir> [--json]   Run the lint gate. Exit 0 = clean.
    pinhole render   <dir> [--json] [-o out.svg] [--html out.html] [...]
    pinhole guide                     This text.

Pass `--json` to any verb for machine-readable output — parse that, not the
prose. `check --json` emits chant's lint diagnostics verbatim under
`{ "ok": bool, "diagnostics": ... }`. `describe --json` emits a stable digest
(`counts`, `nodes`, `edges`, `composites`). `render --json` reports
`{ "ok": bool, "wrote": [...] }` or `{ "ok": false, "error": "..." }`.

## A typical session

    $ pinhole describe ./infra --json        # learn the current graph
    ... edit ./infra/src/*.ts ...
    $ pinhole check ./infra --json           # gate: [] diagnostics, ok:true
    $ pinhole render ./infra --html out.html # render the valid diagram

If `check` reports diagnostics, fix the source and re-run it before rendering —
`render` will refuse dirty source anyway, but `check` is faster and tells you
exactly what's wrong.

## render options

    --html <file>     self-contained offline interactive artifact (theme switch,
                      hover/click inspection). The plain .svg is unchanged.
    -o <file>         write SVG to a file (otherwise stdout).
    --theme <name>    dark (default), light, blueprint, aws.
    --detail 0..3     stacks | composites | declarables | attributes.
    --lens <k>:<t>    e.g. lexicon:aws, stack:web, blast:vpc (with --up/--down).
    --icon            compact glyph nodes for dense graphs.
    --containment     drop low-signal plumbing; render the VPC as a boundary with
                      its resources inside (--focus app|network|security).
    --hints <file>    (with --containment) override salience — { roles: { id:
                      role }, edges: [ { from, to } ] } to force-keep/drop a node
                      or assert a relationship the IR can't express.
    --morph           (with --html) flip between detail tiers, identity preserved.

Run `pinhole render` with no project dir for the full option list.

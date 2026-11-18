/**
 * pinhole's CI workflow, declared rather than hand-written.
 *
 * `npm run workflows` renders it into .github/workflows/ci.yml, and the
 * `check` job fails when a committed generated file differs from what its
 * source renders. The `check` job is the check main's ruleset requires, and
 * the release cut (release.green "forge-checks") reads it on the commit.
 * The release cut also compiles this directory (chant.config.ts sourceDir).
 */

import { ACTION_PINS, usesRef } from "@intentius/chant/action-pins";
import { Workflow, Job, Step } from "@intentius/chant-lexicon-github";

const CHECKOUT = usesRef(ACTION_PINS.checkout4);
const SETUP_NODE = usesRef(ACTION_PINS.setupNode4);

export const workflow = new Workflow({
  name: "ci",
  on: {
    pull_request: {},
    merge_group: {},
    push: { branches: ["main"] },
  },
  permissions: { contents: "read" },
  // Every main commit keeps its run, so the release cut can judge each one; a pull request's newer push cancels the older run.
  concurrency: { group: "ci-${{ github.ref }}", "cancel-in-progress": "${{ github.ref != 'refs/heads/main' }}" },
});

export const check = new Job({
  name: "check",
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 10,
  steps: [
    new Step({ uses: CHECKOUT }),
    new Step({ uses: SETUP_NODE, with: { "node-version": "22", cache: "npm" } }),
    new Step({ run: "npm ci" }),
    new Step({ name: "typecheck", run: "npm run tsc" }),
    new Step({ name: "test", run: "npm test" }),
    new Step({ name: "build", run: "npm run build" }),
    new Step({ name: "root entry bundles for a browser", run: "npm run check:browser" }),
    new Step({ name: "generated files match their sources", run: "npm run generated-check" }),
  ],
});

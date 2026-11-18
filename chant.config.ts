import type { ChantConfig } from "@intentius/chant";

/**
 * pinhole's chant config: the repository's CI workflow (ci/) and its release
 * (CONTRIBUTING.md, Releasing).
 *
 * A person cuts a release from a main commit whose checks passed with
 * `chant release cut <version> --yes` and pushes the v<version> tag.
 * .github/workflows/publish.yml runs on that tag, stamps the version into
 * package.json, builds, and publishes to npm with trusted publishing.
 */
export default {
  lexicons: ["github"],

  // chant.workspace.json declares no members; it holds the workspace's
  // security groups, so chant builds this root project alone.
  rootOnly: true,

  // What chant builds when no directory is named, and what the release cut
  // compiles: the declared CI workflow. Without it the build would load src/.
  sourceDir: "ci",

  environments: ["npm"],
  release: {
    tag: "v{version}",
    // Earlier chant releases were tagged release/<version>; chant still reads those as earlier releases.
    legacyTags: ["release/"],
    // The cut releases a commit whose check runs on GitHub passed, the ruleset's required `check` among them.
    green: "forge-checks",
    // The cut and the publish job stamp the label into package.json, so no
    // commit bumps the version; the committed version stays where it is.
    version: { packages: ["."] },
    workflow: {
      install: "npm ci",
      build: "npm run build",
      chant: "npx chant",
      // npm's trusted publisher for @intentius/pinhole names publish.yml; renaming it breaks publishing.
      file: ".github/workflows/publish.yml",
    },
    publish: [
      // stage: false publishes straight to latest. Staging under `next` and then moving
      // `latest` needs "Allow npm dist-tag" on the package's trusted-publisher record,
      // which is not confirmed for @intentius/pinhole (chant#3904).
      { type: "npm" as const, packages: ["."], access: "public" as const, stage: false, sbom: false as const },
    ],
  },

  lint: {
    rules: {
      // A workflow is a nested object: a job's steps and `with` blocks are its shape.
      COR001: "off",
      // The workflow file exports its jobs for the build to collect.
      COR004: "off",
    },
  },
} satisfies ChantConfig;

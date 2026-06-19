#!/usr/bin/env node
/**
 * pinhole bin launcher.
 *
 * Checked into git so it exists at npm pack-validation time (before `prepack` /
 * `build` runs). It loads the built dist/cli.js and calls the exported `run()`
 * with the process argv. A committed launcher survives npm's bin-path
 * validation, which happens before `prepack` builds dist/cli.js.
 */

import(new URL("../dist/cli.js", import.meta.url).href)
  .then((mod) => mod.run(process.argv.slice(2)))
  .catch((err) => {
    process.stderr.write(`pinhole: fatal: ${err?.message ?? err}\n`);
    process.exit(3);
  });

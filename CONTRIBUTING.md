# Contributing to pinhole

## Checks

`npm ci`, then what CI's `check` job runs:

```bash
npm run tsc
npm test
npm run build
npm run check:browser
npm run generated-check
```

## Workflows

The files under `.github/workflows/` are rendered, so edit their sources and run `npm run workflows`:

| File | Source |
|---|---|
| `ci.yml` | `ci/ci.ts` |
| `publish.yml` | `chant release workflow`, from `release` in `chant.config.ts` |

`npm run generated-check` fails when a committed file differs from its render. Keep the name `publish.yml`: npm's trusted publisher for `@intentius/pinhole` names that file.

## Releasing

A person releases. Agents never dispatch the release workflow, tag or publish.

A release is one dispatched run of `.github/workflows/publish.yml`, chant's release workflow, written by `npx chant release workflow` from `release` in `chant.config.ts`. Its label is the version, a plain version such as `0.6.2` or `0.7.0-rc.1`, with no `v`. No commit bumps `package.json`: the cut and the publish job stamp the label into it, and the committed version stays where it is.

```bash
gh workflow run publish.yml -R INTENTIUS/pinhole -f label=0.6.2
```

The run releases the head of `main`:

1. The gate takes the dispatched commit. With the label `auto` it asks `chant release next` for the version instead.
2. The cut releases the commit only when its checks on GitHub passed (`release.green: "forge-checks"`): a check run that failed or has not finished, or a missing `check` (the check main's ruleset requires), refuses it. It records the release on `chant/lifecycle`, builds, and pushes the tag `v<version>`.
3. The publish job stamps the version into `package.json`, builds, and runs `chant release publish` with npm trusted publishing. The package goes straight to `latest`. If the job fails part way, re-run it: the publish resumes from its record on `chant/lifecycle`.

`npx chant release next` prints the version the next release takes. Release tags are `v<version>`. Releases up to 0.6.0 were tagged `v<version>`, and 0.6.1 was tagged `release/0.6.1`; `release.legacyTags` keeps chant reading the `release/` tag as an earlier release.

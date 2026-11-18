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

A person releases. Agents never cut, tag or publish.

A release is cut from a commit on `main` whose checks on GitHub passed (`release.green: "forge-checks"` in `chant.config.ts`): the cut asks GitHub for the commit's check runs and refuses it when one failed, has not finished, or the ruleset's required `check` is missing. Its label is the version. No commit bumps `package.json`: the cut and the publish job stamp the label into it, and the committed version stays where it is.

```bash
git fetch origin main --tags
git checkout origin/main
export GH_TOKEN="$(gh auth token)"   # the cut reads the commit's checks with it
npx chant release cut 0.6.2          # a dry run: prints what the cut would record and publish
npx chant release cut 0.6.2 --yes    # cuts, pushes chant/lifecycle, tags v0.6.2 locally
git push origin v0.6.2
```

The label is a plain version such as `0.6.1` or `0.7.0-rc.1`, with no `v`. Release tags are `v<version>`. chant releases before 0.6.2 were tagged `release/<version>`, and `release.legacyTags` keeps chant reading them as earlier releases. The tag push starts `publish.yml`, which checks out the tag, stamps the version, builds, and runs `chant release publish` with npm trusted publishing. The package goes straight to `latest`. If the job fails part way, re-run it: the publish resumes from its record on `chant/lifecycle`.

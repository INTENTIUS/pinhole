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
| `chant-ci-green.yml` | `chant ci workflow`, from `ci.green` in `chant.workspace.json` |
| `publish.yml` | `chant release workflow`, from `release` in `chant.config.ts` |

`npm run generated-check` fails when a committed file differs from its render. Keep the name `publish.yml`: npm's trusted publisher for `@intentius/pinhole` names that file.

## Releasing

A person releases. Agents never cut, tag or publish.

Each commit on `main` that passes CI's `check` job gets a `ci/green/<sha>` tag from `chant-ci-green.yml`. A release is cut from the newest green commit, and its label is the version. No commit bumps `package.json`: the cut and the publish job stamp the label into it, and the committed version stays where it is.

```bash
git fetch origin main --tags
git checkout "$(npx chant ci last-green)"
npx chant release cut 0.6.1          # a dry run: prints what the cut would record and publish
npx chant release cut 0.6.1 --yes    # cuts, pushes chant/lifecycle, tags release/0.6.1 locally
git push origin release/0.6.1
```

The label is a plain version such as `0.6.1` or `0.7.0-rc.1`, with no `v`. The tag push starts `publish.yml`, which checks out the tag, stamps the version, builds, and runs `chant release publish` with npm trusted publishing. The package goes straight to `latest`. If the job fails part way, re-run it: the publish resumes from its record on `chant/lifecycle`.

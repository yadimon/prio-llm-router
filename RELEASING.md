# Releasing

`@yadimon/prio-llm-router` uses a simple single-package release flow:

1. publish the first version manually once
2. configure npm Trusted Publishing for GitHub Actions
3. release later versions by bumping the version locally and pushing the generated Git tag

Do not set `"private": true` in `package.json`; that blocks publishing entirely.

## First Publish

Before the first real publish:

```bash
npm login
npm run check
npm run publish:dry-run
```

Then publish the package once manually so it exists on npm:

```bash
npm publish --access public
```

This first manual publish is only needed to create the package on npm before Trusted Publishing can be configured.

## Trusted Publishing

After the package exists on npm:

1. open the package settings on npm
2. add a Trusted Publisher for:
   - GitHub user or org: `yadimon`
   - repository: `prio-llm-router`
   - workflow filename: `publish.yml`
3. keep using `.github/workflows/publish.yml` for future releases

This repository uses GitHub Actions for Trusted Publishing. npm also supports other CI providers, but this repo is already wired for GitHub Actions.

The publish workflow uses a current Node runtime and updates npm before publishing so Trusted Publishing keeps working with npm's current OIDC requirements.

## Normal Release Flow

After the one-time bootstrap:

1. choose one:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

These scripts:

- run `npm run check`
- run `npm version ...`
- create the Git commit and `v*` tag
- push the commit and tag to `origin`

2. GitHub Actions sees the pushed `v*` tag and publishes that version to npm with Trusted Publishing

If you prefer the manual equivalent, it is:

```bash
npm run check
npm version patch
git push origin HEAD --follow-tags
```

## Notes

- Trusted Publishing cannot be configured until the package already exists on npm.
- `repository`, `homepage`, and `bugs` in `package.json` must match the real GitHub repository exactly.
- For public packages published through Trusted Publishing from a public GitHub repository, npm generates provenance automatically.
- The publish workflow verifies that the pushed Git tag matches `package.json`.

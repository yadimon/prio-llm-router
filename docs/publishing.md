# Publishing Guide

This repository is structured to stay ready for public npm publishing.

Use a simple single-package release flow:

1. first manual publish
2. configure Trusted Publishing
3. later releases from version bump plus tag push

## Local Verification

Run:

```bash
npm run check
npm run pack
npm run publish:dry-run
```

This verifies:

- lint
- typecheck
- tests
- build
- `npm pack --dry-run`
- `publint`
- `npm publish --dry-run`

## What Gets Published

The published package includes:

- compiled output from `dist/`
- `README.md`
- `LICENSE`
- package metadata

The package is configured for:

- ESM consumers
- CommonJS consumers
- TypeScript declarations for both
- npm publication from GitHub Actions after bootstrap

## GitHub Actions

This repository includes:

- CI workflow: [ci.yml](../.github/workflows/ci.yml)
- publish workflow: [publish.yml](../.github/workflows/publish.yml)

## Trusted Publishing

The publish workflow is prepared for npm Trusted Publishing from GitHub Actions.

Trusted Publishing is the ongoing release path, not the first bootstrap step.

Before the first real release:

1. publish the package once manually so it exists on npm
2. configure npm to trust this GitHub repository and `publish.yml`
3. use tag-triggered GitHub Actions for later releases

The workflow already includes:

- current GitHub Actions Node runtime
- an npm CLI update step for current Trusted Publishing support
- `id-token: write`
- `npm publish`
- no long-lived `NPM_TOKEN`

## Release Checklist

### First Release Bootstrap

1. Ensure the repository metadata in `package.json` matches the real GitHub repo.
2. Log in to npm with an account that owns the `@yadimon` scope.
3. Run:

```bash
npm run check
npm run publish:dry-run
npm publish --access public
```

### Ongoing Releases

Use one of:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

These scripts run verification, bump the version, create the Git tag, and push commit plus tag to `origin`.

The publish workflow runs automatically on pushed `v*` tags and publishes the matching package version to npm.

## Notes

- Trusted Publishing does not have to mean GitHub Actions globally, but this repository is wired for GitHub Actions specifically.
- npm generates provenance automatically for public packages published from public GitHub repositories through Trusted Publishing.

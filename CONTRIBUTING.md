# Contributing

## Local checks

Use Node.js 24 and install the exact dependency graph from `package-lock.json`.

```powershell
rtk pwsh -NoProfile -Command 'rtk fnm use --silent-if-unchanged; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; rtk npm ci'
rtk pwsh -NoProfile -Command 'rtk fnm use --silent-if-unchanged; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; rtk npm run check'
```

Run `npm run gallery` after visual changes and inspect every generated image at full
resolution. The container is the only supported screenshot renderer; it runs an isolated,
real Obsidian process under Xvfb. Do not commit visual changes with stale screenshots.

## Versioning

Use the version script to update `package.json`, `manifest.json`, the lockfile,
and the compatibility mapping in `versions.json` together:

```sh
node tools/version.mjs patch
node tools/version.mjs minor
node tools/version.mjs major
node tools/version.mjs set 2.0.0 --compat 1.11.0
```

Versions must use numeric `X.Y.Z` format. Without `--compat`, the script keeps
the current `manifest.json.minAppVersion`. With it, the script updates that
minimum and writes `"<theme version>": "<compat version>"` in `versions.json`.
Existing compatibility entries are preserved. The script works from any
working directory and does not create commits or tags.

Run `npm test` to check the script in temporary repositories. These tests also
run as part of `npm run check` and the CI and release workflows.

## Release checklist

1. Run `npm run check` locally.
2. Run `npm run gallery`, then inspect the regenerated screenshots.
3. Push a numeric tag matching `manifest.json`.
4. Verify that GitHub Actions created a draft release with `manifest.json` and
   `theme.css`.
5. Add release notes, publish the draft, and verify the release assets.

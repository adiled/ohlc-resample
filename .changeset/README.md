# Changesets

This directory holds the source of truth for release notes and version bumps.

## How it works

Every PR that affects users (or anything you'd want to mention in a release) carries a markdown file in this directory. The CI workflow `release.yml` consumes these files when publishing.

## Adding a changeset

```bash
pnpm changeset
```

The CLI prompts for:
1. Bump type — `patch` (bugfix), `minor` (backward-compatible feature), or `major` (breaking change).
2. A summary — used as the release note.

It writes a file like `.changeset/quiet-foxes-paint.md`. Commit it alongside your code change.

## Manual format

If you'd rather write the file directly (LLM-friendly), the format is:

```markdown
---
"ohlc-resample": minor
---

One-line summary of the change.

Optional longer description in markdown. Bullets, code blocks, links — whatever
makes the release note useful.
```

The filename can be anything ending in `.md` other than `README.md` and `config.json`.

## What happens after merge

1. PR with code + changeset → merges to `main`
2. `release.yml` opens (or updates) a "Version Packages" PR that:
   - Bumps `package.json#version`
   - Prepends a `CHANGELOG.md` section assembled from pending changesets
   - Deletes the consumed changeset files
3. Merging the Version Packages PR triggers `release.yml` again, which:
   - Publishes to npm with provenance
   - Creates a `vX.Y.Z` git tag
   - Creates a GitHub Release with the CHANGELOG entry as the body

Trivial changes (typos, internal refactors that don't affect users) don't need a changeset.

## Reference

- https://github.com/changesets/changesets
- https://github.com/changesets/action

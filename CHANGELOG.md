# Changelog

## 1.4.0

A backward-compatible feature release. The legacy `default` export (with the `resample_ohlcv`, `array`, `json`, `trade_to_candle`, `tick_chart` aliases) is preserved.

### CLI
- The CLI is now actually functional — replaces the stub from earlier 1.x versions.
- `--input-format <csv|json|auto>` now actually honors the requested format (was previously a no-op heuristic).
- New `-s, --shape <object|array|auto>` flag for OHLCV tuple vs object JSON output. Auto-detects shape on JSON input and preserves it through the pipeline by default. Closes #8 (the array-of-arrays requirement).
- Malformed CSV rows are reported as a warning to stderr; a CSV with zero valid rows now exits non-zero instead of producing empty output.
- SIGINT/SIGTERM no longer clobber a non-zero exit code.
- `bin.ohlc` now points at `dist/cli.js` (was `src/cli.ts`, which was non-functional post-install since npm cannot execute raw TypeScript).

### Library
- `resampleOhlcv` now has overloaded signatures: pass `OHLCV[]` and TypeScript narrows the return to `OHLCV[]`; pass `IOHLCV[]` and you get `IOHLCV[]`.
- Fixed inverted JSDoc on `resampleOhlcvArray`.
- The package now also re-exports types (`IOHLCV`, `OHLCV`, `TradeTick`, etc.) from the entrypoint.

### Build & tooling
- **Test runner: jest → vitest.** Replaces `jest` + `ts-jest` + `@types/jest` with `vitest` + `@vitest/coverage-v8`. Cold-start test time drops from ~9s to ~2.5s. Removed the `ts-jest` `ignoreCodes: [2345]` workaround. Added `test:watch` and `test:coverage` scripts; the default `test` script no longer auto-collects coverage on every run.
- Dropped `fast-csv` dependency (was unused in 1.x; 2.0 was going to remove it, this release ships the clean state).
- Dropped unused `chalk` dep.
- Moved `ts-node` to `devDependencies` (no longer needed at runtime now that the bin points at compiled JS).
- Dropped `coveralls` from `prepublishOnly` (was guaranteed to fail without a token).
- `prebuild` now cleans `dist/` (was incorrectly cleaning `build/`).
- CI workflow updated to trigger on `main` and run Node 20.x / 22.x (was `master` + Node 10/12).
- New tag-triggered `publish.yml` workflow: pushing a `v*` tag runs build + tests, then `pnpm publish` with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Requires an `NPM_TOKEN` repo secret (npm "Automation" granular token).
- Removed obsolete `.npmignore` (superseded by `package.json#files`).

### Internal (not part of the public API)
- The CLI's `parseCSV` helper now returns `{ rows, skipped }` instead of `IOHLCV[]`. Only relevant if you imported it from `ohlc-resample/dist/cli`.

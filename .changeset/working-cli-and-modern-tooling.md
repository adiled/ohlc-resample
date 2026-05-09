---
"ohlc-resample": minor
---

Working CLI, vitest, modernized tooling. Closes #8.

**CLI**

- The CLI is now actually functional (was a stub in 1.x).
- `--input-format <csv|json|auto>` now honors the requested format (was previously a no-op heuristic).
- New `-s, --shape <object|array|auto>` flag for OHLCV tuple vs object JSON output. Auto-detects shape on JSON input and preserves it through the pipeline by default.
- Malformed CSV rows are reported to stderr; a CSV with zero valid rows now exits non-zero instead of producing empty output.
- `bin.ohlc` now points at `dist/cli.js` (was `src/cli.ts`, which was non-functional post-install).
- SIGINT/SIGTERM no longer clobber a non-zero exit code.

**Library**

- `resampleOhlcv` now has overloaded signatures so the return type follows the input shape (`OHLCV[]` in → `OHLCV[]` out, same for `IOHLCV[]`).
- Types (`IOHLCV`, `OHLCV`, `TradeTick`, etc.) are re-exported from the package entrypoint.
- Fixed inverted JSDoc on `resampleOhlcvArray`.
- Backward compatibility preserved: the legacy `default` export with `resample_ohlcv`, `array`, `json`, `trade_to_candle`, `tick_chart` aliases continues to work.

**Build & tooling**

- Test runner migrated jest → vitest. Cold-start time: ~9s → ~2.5s.
- Releases are now managed by [Changesets](https://github.com/changesets/changesets) with tag-triggered npm publish (with provenance) and auto-generated GitHub Releases.
- Dropped unused `chalk` and `coveralls` deps; moved `ts-node` to devDependencies.
- `prebuild` now cleans `dist/` (was incorrectly cleaning `build/`).
- CI workflow updated to trigger on `main` (was `master`) and run Node 20.x / 22.x (was EOL 10.x / 12.x).
- Removed obsolete `.npmignore` (superseded by `package.json#files`).

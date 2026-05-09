# Changelog

## 2.0.0

### Breaking changes
- **Removed legacy `default` export** from the package entrypoint. The aliases `resample_ohlcv`, `array`, `json`, `trade_to_candle`, and `tick_chart` are gone — use the named exports `resampleOhlcv`, `resampleTicksByTime`, and `resampleTicksByCount` instead.
- **`bin.ohlc` now points at `dist/cli.js`** (was `src/cli.ts`). The previously published binary was non-functional; this fix changes the resolved path post-install.
- **`parseCSV` (CLI helper) now returns `{ rows, skipped }`** instead of `IOHLCV[]`. Internal API; only relevant if you imported it from `ohlc-resample/dist/cli`.

### CLI
- The CLI is now actually functional — replaces the stub in 1.x.
- `--input-format <csv|json|auto>` now actually honors the requested format (was previously a no-op heuristic).
- New `-s, --shape <object|array|auto>` flag for OHLCV tuple vs object JSON output. Closes #8 (the array-of-arrays requirement).
- Auto-detects tuple vs object shape on JSON input and preserves it through the pipeline by default.
- Malformed CSV rows are now reported as a warning to stderr, and a CSV with zero valid rows now exits non-zero instead of producing an empty output.
- SIGINT/SIGTERM no longer clobber a non-zero exit code.

### Library
- `resampleOhlcv` now has overloaded signatures: pass `OHLCV[]` and TypeScript narrows the return to `OHLCV[]`; pass `IOHLCV[]` and you get `IOHLCV[]`.
- Fixed inverted JSDoc on `resampleOhlcvArray`.
- The package now also re-exports types (`IOHLCV`, `OHLCV`, `TradeTick`, etc.) from the entrypoint.

### Build & tooling
- Dropped `fast-csv` dependency (1.x branch removed it; 2.0 ships clean).
- Dropped unused `chalk` dep.
- Moved `ts-node` to `devDependencies`.
- Dropped `coveralls` from `prepublishOnly` (was guaranteed to fail without a token).
- `prebuild` now cleans `dist/` (was cleaning a non-existent `build/`).
- CI workflow updated to trigger on `main` and run Node 20.x / 22.x (was `master` + Node 10/12).
- Removed obsolete `.npmignore` (superseded by `package.json#files`).

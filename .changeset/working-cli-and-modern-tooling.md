---
"ohlc-resample": major
---

Working CLI, vitest, modernized tooling. Closes #8.

**Breaking change**

- `engines.node` bumped from `>=20.12.2` to `>=22.12.0` (current LTS floor). The runtime API surface is unchanged — this is purely an install-constraint update. Library consumers on Node 22+ see no behavioural difference.

**CLI** (was a non-functional stub in 1.x; now ships)

- `--input-format <csv|json|auto>` honors the requested format (was a no-op heuristic).
- New `-s, --shape <object|array|auto>` for OHLCV tuple vs object JSON output. Auto-detects shape on JSON input and preserves it through the pipeline by default.
- `-i` always wins over stdin, even in non-TTY contexts (CI, scripts).
- Malformed CSV rows reported to stderr; zero valid rows now exits non-zero instead of producing empty output.
- `bin.ohlc` → `dist/cli.js` (was `src/cli.ts`, non-functional post-install).
- SIGINT/SIGTERM preserve a previously-set non-zero exit code.

**Library**

- `resampleOhlcv` now has overloaded signatures so the return type follows the input shape (`OHLCV[]` in → `OHLCV[]` out, same for `IOHLCV[]`). The original union signature is preserved as a third overload, so 1.x TS callers with union-typed data still compile.
- Types (`IOHLCV`, `OHLCV`, `TradeTick`, etc.) are now re-exported from the package entrypoint.
- Fixed inverted JSDoc on `resampleOhlcvArray`.
- The legacy `default` export with `resample_ohlcv`, `array`, `json`, `trade_to_candle`, `tick_chart` aliases is preserved unchanged.

**Build & tooling**

- Test runner migrated jest → vitest 4. Cold-start time ~9s → ~2.5s.
- TypeScript bumped to 6.x; tsconfig modernized (`target: es2022`, `lib: es2022`, explicit `types: ["node"]`).
- Releases managed by [Changesets](https://github.com/changesets/changesets) with a direct-commit workflow: a push to `main` with a changeset triggers bump + commit + npm publish (with provenance) + tag + GitHub Release in a single CI run.
- Dropped unused `chalk`, `coveralls`, `fast-csv` deps; moved `ts-node` to devDependencies.
- CI workflow: triggers on `main`, runs Node 22.x and 24.x.
- Removed obsolete `.npmignore`, dropped stale `deprecated.md`, cleaned coveralls/yarn/master references from README.

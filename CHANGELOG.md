# ohlc-resample

## 2.0.0

### Major Changes

- [#13](https://github.com/adiled/ohlc-resample/pull/13) [`22f5603`](https://github.com/adiled/ohlc-resample/commit/22f56038d50fdb80f454dc68c62a1c1e6f5efc15) Thanks [@adiled](https://github.com/adiled)! - Working CLI, vitest, modernized tooling. Closes [#8](https://github.com/adiled/ohlc-resample/issues/8).

  **Breaking change**

  - `engines.node` bumped from `>=20.12.2` to `>=26` (current LTS floor). The runtime API surface is unchanged — this is purely an install-constraint update. Library consumers on Node 26+ see no behavioural difference.

  **Distribution**

  - New `install.sh` for non-Node users: `curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh`. The installer uses your existing Node ≥26 if present; otherwise it downloads the official Node binary distribution from nodejs.org into `~/.ohlc/runtime/` and uses that. The package itself is the only release artifact — no per-platform binaries.

  **CLI** (was a non-functional stub in 1.x; now ships)

  - `--input-format <csv|json|auto>` honors the requested format (was a no-op heuristic).
  - New `-s, --shape <object|array|auto>` for OHLCV tuple vs object JSON output. Auto-detects shape on JSON input and preserves it through the pipeline by default.
  - `-i` always wins over stdin, even in non-TTY contexts (CI, scripts).
  - Malformed CSV rows reported to stderr; zero valid rows now exits non-zero instead of producing empty output.
  - npm bin `ohlc-resample` → `dist/cli.js` (was `src/cli.ts`, non-functional post-install), so `npx ohlc-resample <args>` works without spelling the bin name. The `install.sh` launcher still installs a local `ohlc` binary to `~/.local/bin`.
  - SIGINT/SIGTERM preserve a previously-set non-zero exit code.

  **Library**

  - `resampleOhlcvArray` now buckets candles by wall-clock time (`floor(time / newFrame)`) instead of a candle-count counter. Fixes silent data loss: offset or short inputs (count not a multiple of the ratio) used to drop the final bucket entirely, and misaligned inputs merged candles across time slots. Partial buckets are now always emitted.
  - `resampleOhlcvArray` no longer mutates its input — candles are normalized and sorted on a copy.
  - `newFrame` must be a positive integer multiple of `baseFrame`; a non-integer ratio now throws instead of silently mis-bucketing.
  - `resampleOhlcv` now has overloaded signatures so the return type follows the input shape (`OHLCV[]` in → `OHLCV[]` out, same for `IOHLCV[]`). The original union signature is preserved as a third overload, so 1.x TS callers with union-typed data still compile.
  - Types (`IOHLCV`, `OHLCV`, `TradeTick`, etc.) are now re-exported from the package entrypoint.
  - Fixed inverted JSDoc on `resampleOhlcvArray`.
  - The legacy `default` export with `resample_ohlcv`, `array`, `json`, `trade_to_candle`, `tick_chart` aliases is preserved unchanged.

  **Build & tooling**

  - Test runner migrated jest → vitest 4. Cold-start time ~9s → ~2.5s.
  - TypeScript bumped to 6.x; tsconfig modernized (`target: es2022`, `lib: es2022`, explicit `types: ["node"]`).
  - Releases managed by [Changesets](https://github.com/changesets/changesets) with a direct-commit workflow: a push to `main` with a changeset triggers bump + commit + npm publish (with provenance) + tag + GitHub Release in a single CI run.
  - Dropped unused `chalk`, `coveralls`, `fast-csv` deps; moved `ts-node` to devDependencies.
  - CI workflow: triggers on `main`, runs Node 26.x.
  - Removed obsolete `.npmignore`, dropped stale `deprecated.md`, cleaned coveralls/yarn/master references from README.

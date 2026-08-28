# ohlc-resample

## 2.2.0

### Minor Changes

- [#25](https://github.com/adiled/ohlc-resample/pull/25) [`80a0bc2`](https://github.com/adiled/ohlc-resample/commit/80a0bc25809571f3e6c2157c8ff8c0d42fa39f1d) Thanks [@adiled](https://github.com/adiled)! - Add a **zero-dependency MCP server** (`ohlc-resample-mcp` bin) and fix a
  streaming CSV→CSV output bug.

  **MCP server (bundled, no second package)**

  - New `ohlc-resample-mcp` binary ships inside this same package — install
    `ohlc-resample` and you get the MCP server for free. No separate publish.
  - It is a **thin adapter over the package's own CLI** (`runCli` in-process
    with injected streams): it has no resampling/parsing/formatting logic of its
    own, so every new CLI feature is inherited with zero maintenance. A tool
    call just builds an argv array and runs the CLI, returning stdout or a file
    path.
  - **No `@modelcontextprotocol/sdk` dependency** — MCP is plain JSON-RPC 2.0
    over stdio, so the server hand-rolls the tiny protocol (initialize,
    `tools/list`, `tools/call`, `ping`) directly. Runtime deps stay just `mri`
    and `hyparquet`.
  - Two tools: `resample_ohlcv_file` (takes an `input_path`
    (csv/json/jsonl/ndjson/parquet), `base_timeframe`, `new_timeframe`,
    `format`, `shape`, optional `map` (e.g. CCXT `timestamp`/`amount`), and
    optional `output_path`) and `audit_ohlcv_file` (takes an `input_path` and
    optional `map`, returns a trust report). Both are file-path-based, so the
    LLM pays tokens for intent, not payload.

  **New `audit` capability**

  - New library function `auditOhlcv` + `AuditReport`: validates and describes
    market-data input in one streaming pass, answering "can I trust the output
    of this resampling, and exactly why?". Reports record count, time range,
    source timeframe (modal positive interval), ordering (sorted, out-of-order
    count, max lateness), duplicate timestamps, OHLC integrity violations, bad
    values (NaN/Infinity/negative prices/volume), and missing bars.
  - Wired to the CLI as `--audit` (prints a JSON report instead of resampling)
    and exposed to MCP as `audit_ohlcv_file`, which inherits the CLI path with
    zero extra logic.

  **Bug fix**

  - Streaming CSV → CSV output previously failed with `shaped.join is not a
function`: `IncrementalWriter` rendered object-shaped candles as CSV rows
    without converting to the 6-tuple shape. CSV rows are now always written in
    array shape regardless of the requested JSON shape.

## 2.1.1

### Patch Changes

- [#21](https://github.com/adiled/ohlc-resample/pull/21) [`ce44243`](https://github.com/adiled/ohlc-resample/commit/ce442430f231eb30ed7d185afb6afb83e5742d73) Thanks [@adiled](https://github.com/adiled)! - Rewrite the README as end-user documentation: drop internal implementation
  narration (module-format internals, dependency and roadmap notes) and present
  the tool in plain language for financial-data users. Also removes em dashes
  for easier machine parsing.

## 2.1.0

### Minor Changes

- [#19](https://github.com/adiled/ohlc-resample/pull/19) [`cff3a71`](https://github.com/adiled/ohlc-resample/commit/cff3a71e55cf7d6752863f7d232412e6ea2de540) Thanks [@adiled](https://github.com/adiled)! - Add **Parquet file input** and ship a **dual ESM + CJS** package (the "foot in
  the door" before the future native engine).

  **Module format: ESM-first with a CJS `require()` wrapper (backward compatible)**

  - The package is now `"type": "module"` and emits ESM. `import` keeps
    working. `require('ohlc-resample')` also keeps working: the build emits a
    one-line `dist/index.cjs` re-export (`module.exports = require('./index.js')`),
    which uses Node's synchronous `require(esm)` (stable since 23.7) to load the
    ESM build and its graph (including `hyparquet`) with no top-level await.
    Because there is a single real implementation, both `require` and `import`
    resolve to the **same module instance** — no dual-package hazard.
  - The CLI's `require.main` guard and `require('../package.json')` version read
    were converted to ESM (`import.meta` + `createRequire`).

  **Parquet file input (async variants only)**

  - `resampleOhlcvAsync`, `resampleTicksByTimeAsync`, `resampleTicksByCountAsync`
    now accept a **file path** to a Parquet file (in addition to an
    `AsyncIterable`) and return an async generator. Rows are streamed
    **row-group by row-group**, so memory is bounded by the largest row group,
    not the file size.
  - Column names are read by **exact canonical name**; any other layout is
    supplied via a new **`map` option** (below), so there is no name guessing.
    Timestamps in ms/µs/ns/days are converted to epoch-milliseconds.
    `time`/`open`/`high`/`low`/`close` are required (throw if missing);
    `volume` is optional and defaults to 0.
  - The **sync** functions (`resampleOhlcv`, `resampleTicksByTime`,
    `resampleTicksByCount`) stay array/iterable-only — Parquet needs an async
    reader, so it is only wired into the async variants.

  **Per-record `map` option (CSV / Parquet / JSON)**

  - The async variants take a new `map` option that translates **each input
    record** into canonical OHLCV. Two shapes are accepted:
    - **Record form**: keys are canonical IOHLCV fields, values are the keys to
      read from each input record; fields absent from the map use the canonical
      key directly (e.g. `{ time: 'timestamp', volume: 'amount' }`).
    - **Function form**: a full transform `(record) => IOHLCV`.
  - Ticks accept the same shapes over `time`/`price`/`quantity`. Positional
    inputs (tuples, `Float64Array`) have no keys to map and are unaffected.

  **CLI**

  - Added a `--map field=sourceKey` flag (comma-separated) that remaps CSV
    headers, JSON object keys, and Parquet columns; with `--map`, a CSV's first
    line is always treated as the header. A mapping function can't be a CLI arg,
    so the flag accepts the Record form only.
  - `.parquet` file extensions are accepted and streamed row-group by
    row-group through the async resampler, emitting CSV/JSON/JSONL
    incrementally. Unsupported-extension error now names Parquet.
  - Added a zero-dependency pure-JS Parquet reader (`hyparquet`) as a runtime
    dependency.
  - **Removed the `lodash` dependency** (~315 kB). The seven helpers it
    provided (`isPlainObject`, `sum`, `max`, `min`, `groupBy`, `sortBy`,
    `chunk`) are now implemented natively inline, so the package installs only
    what it actually builds — runtime deps are now just `mri` and `hyparquet`.
  - **Replaced `commander` (~53 kB) with `mri` (~4 kB, zero deps)** for CLI
    arg parsing. Because `mri` is silent about unknown flags and positional
    args, the CLI now validates them against a fixed known set; help/version
    are handled directly. `mri` mutates its config objects in place, so each
    call builds fresh alias/default maps to stay correct across invocations.

- [#19](https://github.com/adiled/ohlc-resample/pull/19) [`cff3a71`](https://github.com/adiled/ohlc-resample/commit/cff3a71e55cf7d6752863f7d232412e6ea2de540) Thanks [@adiled](https://github.com/adiled)! - Add streaming and large-data support. Closes [#9](https://github.com/adiled/ohlc-resample/issues/9).

  **Library — keep the existing names, add async streaming variants**

  - `resampleOhlcv`, `resampleTicksByTime`, `resampleTicksByCount` now also accept a **sync iterable/generator** (materialized internally), so you can feed a generator without building an array. Array inputs and overloads are unchanged (backward compatible).
  - `resampleOhlcv` additionally accepts a binary **`Float64Array`** of interleaved `[time, open, high, low, close, volume]` records (6 doubles per candle), avoiding JSON/object parse cost for large binary inputs.
  - New async variants — `resampleOhlcvAsync`, `resampleTicksByTimeAsync`, `resampleTicksByCountAsync` — consume an `AsyncIterable` (Node `ReadableStream`, async generator) and return an `AsyncGenerator`. Buckets are emitted as soon as they are safe, so memory is bounded by the active bucket window, not the input size. The return shape follows the input shape (tuples in → tuples out, objects in → objects out).
  - Streaming input must be **sorted ascending by time** (the array API sorts a copy; a stream cannot buffer to sort).
  - **Out-of-order healing**: with `outOfOrderMs > 0`, a stream holds each bucket open for that many milliseconds of wall-clock time, so delayed/out-of-order records landing inside the window fold into the correct bucket on the fly — no global sort required. `outOfOrderMs = 0` (default) is exact for pre-sorted input and emits eagerly.
  - `resampleTicksByCountAsync` keeps a partial trailing group, matching `resampleTicksByCount` (which uses `lodash/chunk`).

  **CLI — streaming file input**

  - `.csv`, `.jsonl`, `.ndjson` **files are streamed line-by-line** through the async resampler and output written incrementally, so memory never scales with file size. JSON _array_ files stay buffer-based (a JSON document must be fully parsed to know where it ends) — documented limitation.
  - New **JSONL output** format (`-f jsonl`) and **JSONL input** format (`--input-format jsonl`, or `.jsonl`/`.ndjson` file extensions), including line-by-line streaming over a pipe.
  - Incremental JSON output is still a valid, parseable array.

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

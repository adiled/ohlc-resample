---
"ohlc-resample": minor
---

Add **Parquet file input** and ship a **dual ESM + CJS** package (the "foot in
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
  what it actually builds — runtime deps are now just `commander` and
  `hyparquet`.

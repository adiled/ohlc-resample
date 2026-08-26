---
"ohlc-resample": major
---

Make the package **ESM-only** and add **Parquet file input** (the "foot in the
door" before the future native engine).

**Breaking: ESM-only**

- The package is now `"type": "module"` and emits ESM. `import` works;
  `require('ohlc-resample')` is no longer supported (there is no CommonJS
  build). The Parquet reader is ESM-native (`hyparquet` has no CJS build), so
  this keeps the dependency graph simple and lets future Rust/C++ native
  modules slot in cleanly.
- The CLI's `require.main` guard and `require('../package.json')` version read
  were converted to ESM (`import.meta` + `createRequire`).

**Parquet file input (async variants only)**

- `resampleOhlcvAsync`, `resampleTicksByTimeAsync`, `resampleTicksByCountAsync`
  now accept a **file path** to a Parquet file (in addition to an
  `AsyncIterable`) and return an async generator. Rows are streamed
  **row-group by row-group**, so memory is bounded by the largest row group,
  not the file size.
- Column names are matched **loosely by alias** (`timestamp`/`ts`/`date`,
  `o`/`open`, `vol`/`volume`/`qty`/`quantity`, ...). Timestamps in ms/µs/ns/
  days are converted to epoch-milliseconds. `time`/`open`/`high`/`low`/`close`
  are required (throw if missing); `volume` is optional and defaults to 0.
- The **sync** functions (`resampleOhlcv`, `resampleTicksByTime`,
  `resampleTicksByCount`) stay array/iterable-only — Parquet needs an async
  reader, so it is only wired into the async variants.

**CLI**

- `.parquet` file extensions are accepted and streamed row-group by
  row-group through the async resampler, emitting CSV/JSON/JSONL
  incrementally. Unsupported-extension error now names Parquet.
- Added a zero-dependency pure-JS Parquet reader (`hyparquet`) as a runtime
  dependency.

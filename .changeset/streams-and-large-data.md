---
"ohlc-resample": minor
---

Add streaming and large-data support. Closes #9.

**Library — keep the existing names, add async streaming variants**

- `resampleOhlcv`, `resampleTicksByTime`, `resampleTicksByCount` now also accept a **sync iterable/generator** (materialized internally), so you can feed a generator without building an array. Array inputs and overloads are unchanged (backward compatible).
- `resampleOhlcv` additionally accepts a binary **`Float64Array`** of interleaved `[time, open, high, low, close, volume]` records (6 doubles per candle), avoiding JSON/object parse cost for large binary inputs.
- New async variants — `resampleOhlcvAsync`, `resampleTicksByTimeAsync`, `resampleTicksByCountAsync` — consume an `AsyncIterable` (Node `ReadableStream`, async generator) and return an `AsyncGenerator`. Buckets are emitted as soon as they are safe, so memory is bounded by the active bucket window, not the input size. The return shape follows the input shape (tuples in → tuples out, objects in → objects out).
- Streaming input must be **sorted ascending by time** (the array API sorts a copy; a stream cannot buffer to sort).
- **Out-of-order healing**: with `outOfOrderMs > 0`, a stream holds each bucket open for that many milliseconds of wall-clock time, so delayed/out-of-order records landing inside the window fold into the correct bucket on the fly — no global sort required. `outOfOrderMs = 0` (default) is exact for pre-sorted input and emits eagerly.
- `resampleTicksByCountAsync` keeps a partial trailing group, matching `resampleTicksByCount` (which uses `lodash/chunk`).

**CLI — streaming file input**

- `.csv`, `.jsonl`, `.ndjson` **files are streamed line-by-line** through the async resampler and output written incrementally, so memory never scales with file size. JSON *array* files stay buffer-based (a JSON document must be fully parsed to know where it ends) — documented limitation.
- New **JSONL output** format (`-f jsonl`) and **JSONL input** format (`--input-format jsonl`, or `.jsonl`/`.ndjson` file extensions), including line-by-line streaming over a pipe.
- Incremental JSON output is still a valid, parseable array.

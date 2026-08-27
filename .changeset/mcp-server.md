---
"ohlc-resample": minor
---

Add a **zero-dependency MCP server** (`ohlc-resample-mcp` bin) and fix a
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
- Single tool `resample_ohlcv_file`: takes an `input_path`
  (csv/json/jsonl/ndjson/parquet), `base_timeframe`, `new_timeframe`,
  `format`, `shape`, optional `map` (e.g. CCXT `timestamp`/`amount`), and
  optional `output_path`. File-path-based, so the LLM pays tokens for intent,
  not payload.

**Bug fix**

- Streaming CSV → CSV output previously failed with `shaped.join is not a
  function`: `IncrementalWriter` rendered object-shaped candles as CSV rows
  without converting to the 6-tuple shape. CSV rows are now always written in
  array shape regardless of the requested JSON shape.

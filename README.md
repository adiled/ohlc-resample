<h1 align="center">ohlc-resample 🕯️</h1>
<p align="center">
Resample (inter-convert) trade, ticks or OHLCV data to different time frames
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/ohlc-resample" target="_blank">
    <img alt="Version" src="https://img.shields.io/npm/v/ohlc-resample.svg">
  </a>
  <img alt="Downloads" src="https://img.shields.io/npm/dt/ohlc-resample">
  <a href="https://github.com/adiled/ohlc-resample#readme" target="_blank">
    <img alt="Documentation" src="https://img.shields.io/badge/documentation-yes-brightgreen.svg" />
  </a>
  <a href="https://github.com/adiled/ohlc-resample/graphs/commit-activity" target="_blank">
    <img alt="Maintenance" src="https://img.shields.io/badge/Maintained%3F-yes-green.svg" />
  </a>
  <a href="https://github.com/adiled/ohlc-resample/blob/main/COPYING" target="_blank">
    <img alt="License: LGPL--3.0" src="https://img.shields.io/github/license/adiled/ohlc-resample" />
  </a>
</p>

- Typescript support
- CCXT support
- Single dependency
- Low time complexity grouping based aggregations
- Optional gap filling

## Install

### CLI

macOS / Linux:

```sh
curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh
```

Installs the `ohlc` CLI to `~/.local/bin`. If you don't already have a recent enough Node, the installer downloads one for you and uses it. Pin a specific version with `--version 2.0.0`.

To uninstall:

```sh
curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh -s -- --uninstall
```

### Library

```sh
npm install ohlc-resample      # or pnpm add / yarn add / bun add
```

Requires Node.js ≥26.

## Supported formats

- OHLCV (CCXT format) `[[time,open,high,low,close,volume]]`
- OHLCV JSON `[{time: number, open: number, high: number, low: number close: number, volume: number}]`
- Trade JSON `[{time: number, price: number, quantity: number}]`

## Reference

```typescript
import {
  resampleOhlcv,
  resampleTicksByTime,
  resampleTicksByCount,
} from "ohlc-resample";

// OHLCV resampled from 1 minute to 5 minute

resampleOhlcv(objectOhlcv as IOHLCV[], {
  baseTimeframe: 60,
  newTimeframe: 5 * 60,
}); // return IOHLCV[]
resampleOhlcv(arrayOhlcv as OHLCV[], {
  baseTimeframe: 60,
  newTimeframe: 5 * 60,
}); // return OHLCV[]

// Ticks grouped and resampled to 1m OHCLV
// option.includeLatestCandle is by default `true`
// options.fillGaps is by default `false`

resampleTicksByTime(tickData as TradeTick[], {
  timeframe: 60,
  includeLatestCandle: false,
  fillGaps: true,
}); // return IOHLCV[]

// Ticks grouped and resampled by every 5 ticks

resampleTicksByCount(tickData as TradeTick[], { tickCount: 5 }); // return IOHLCV[]
```

## Streaming & large data

The three functions above all accept a **sync iterable / generator** as well as
an array (materialized internally), and `resampleOhlcv` also accepts a binary
`Float64Array` of interleaved `[time, open, high, low, close, volume]` records.

For **true streaming** — large files, live feeds, or anything you don't want to
hold in memory — use the async variants. They consume an `AsyncIterable` (a
Node `ReadableStream`, an async generator, `for await` sources) and return an
`AsyncGenerator` that emits each bucket as soon as it is safe. Memory use is
bounded by the active bucket window, never the whole input.

```typescript
import {
  resampleOhlcvAsync,
  resampleTicksByTimeAsync,
  resampleTicksByCountAsync,
} from "ohlc-resample";

// Stream OHLCV candles, one bucket at a time
for await (const candle of resampleOhlcvAsync(readableStream, {
  baseTimeframe: 60,
  newTimeframe: 300,
})) {
  // candle is a completed OHLCV bucket
}

// Stream ticks into time buckets
for await (const candle of resampleTicksByTimeAsync(tickSource, {
  timeframe: 60,
  includeLatestCandle: false,
  fillGaps: true,
})) {
  // ...
}

// Stream ticks into count buckets (O(tickCount) memory)
for await (const candle of resampleTicksByCountAsync(tickSource, { tickCount: 5 })) {
  // ...
}
```

**Sorted input.** The array API sorts a copy for you; a streaming API cannot
buffer to sort, so pass data **ascending by time** unless you use the healing
window below.

**Out-of-order healing.** With `outOfOrderMs > 0`, the stream keeps each bucket
open for that many milliseconds of wall-clock time, so delayed or out-of-order
records that land inside the window are folded into the correct bucket on the
fly — no global sort, and no re-reading already-emitted buckets. `outOfOrderMs
= 0` (default) is exact for pre-sorted input and emits as the stream passes.

### Parquet files

The async variants also accept a **file path** to a Parquet file. Rows are
streamed **row-group by row-group** (memory is bounded by the largest row
group, not the file), so large columnar datasets don't blow up memory. This is
the "foot in the door" before the future native engine — the reader is the
pure-JS, zero-dependency `hyparquet` package.

```typescript
// resample a Parquet OHLCV file
for await (const candle of resampleOhlcvAsync("data.parquet", {
  baseTimeframe: 60,
  newTimeframe: 300,
})) {
  // candle is an OHLCV tuple
}

// resample a Parquet tick file
for await (const candle of resampleTicksByTimeAsync("ticks.parquet", {
  timeframe: 60,
})) {
  // candle is an IOHLCV object
}
```

Column names are read by **exact canonical name** (`time`, `open`, `high`,
`low`, `close`, `volume`, and `time`/`price`/`quantity` for ticks). Timestamps
in any unit (ms / µs / ns / days) are converted to epoch-milliseconds. If a
required column is missing, the call throws; OHLCV `volume` is optional and
defaults to `0`. Any other column layout must be supplied with the `map`
option below. Parquet (file) input is supported **only on the async variants**
— the sync functions stay array/iterable-only.

### Per-record `map` option

The async variants take a `map` option that translates **each input record**
into canonical OHLCV. It works uniformly across any named-schema input —
Parquet rows, CSV header rows, JSON objects — and is how you adapt foreign
schemas (CCXT's `timestamp`/`amount`, arbitrary Parquet columns, etc.) instead
of relying on name guessing. Two shapes are accepted:

1. **Record form** — keys are canonical IOHLCV fields, values are the keys to
   read from each input record. Fields absent from the map use the canonical
   key directly:

   ```typescript
   // read `time` from `timestamp`, `volume` from `amount`; the rest stay canonical
   for await (const candle of resampleOhlcvAsync(readableStream, {
     baseTimeframe: 60,
     newTimeframe: 300,
     map: { time: 'timestamp', volume: 'amount' },
   })) { }

   // arbitrary Parquet columns
   for await (const candle of resampleOhlcvAsync('data.parquet', {
     baseTimeframe: 60,
     newTimeframe: 300,
     map: { time: 'mytime', open: 'myopen', high: 'myhigh', low: 'mylow', close: 'myclose', volume: 'myvol' },
   })) { }
   ```

2. **Function form** — a full transform `(record) => IOHLCV` for complete
   control:

   ```typescript
   for await (const candle of resampleOhlcvAsync(readableStream, {
     baseTimeframe: 60,
     newTimeframe: 300,
     map: (r) => ({
       time: r.timestamp, open: r.open, high: r.high,
       low: r.low, close: r.close, volume: r.amount,
     }),
   })) { }
   ```

Ticks accept the same shapes over `time`/`price`/`quantity` (e.g. `map:
{ time: 'timestamp', quantity: 'amount' }`). Positional inputs — `OHLCV`
tuples and `Float64Array` — have no keys to map and are unaffected. The sync
functions take canonical arrays, so `map` is only relevant to the async
variants (file paths and record-shaped streams).

## Module format

`ohlc-resample` is **ESM-first with a CommonJS wrapper** (`"type": "module"`).
Use `import` for the full API. `require('ohlc-resample')` also works: the build
emits `dist/index.cjs`, a one-line re-export that loads the ESM build via
Node's synchronous `require(esm)` (stable since 23.7), so both entry points
resolve to the **same module instance** — there's no dual-package hazard and
no CommonJS build to maintain. The Parquet reader is ESM-native
(`hyparquet` has no CommonJS build), which is why the package is ESM-first; a
thin wrapper keeps `require()` consumers working.

## Types

```typescript
export type IOHLCV = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type OHLCV = [number, number, number, number, number, number];

export type TradeTick = {
  price: number;
  quantity: number;
  time: number;
};
```

**Note:** Input time for all above types must be in milliseconds

## Examples

**Resample CCXT (Object) OHLCV based on timeframe**

```typescript
import { resampleOhlcv } from "ohlc-resample";

const link_btc_1m = [
  {
    time: 1563625680000,
    open: 0.00024824,
    high: 0.00024851,
    low: 0.00024798,
    close: 0.00024831,
    volume: 2264,
  },
  {
    time: 1563625740000,
    open: 0.00024817,
    high: 0.00024832,
    low: 0.00024795,
    close: 0.00024828,
    volume: 3145,
  },
];

const baseTimeframe = 60; // 60 seconds
const newTimeframe = 120; // 120 seconds

// Candles made up of ticks within 2 minute timeframes

const link_btc_2m = resampleOhlcv(link_btc_1m, {
  baseTimeframe,
  newTimeframe,
});
```

**Resample ticks to OHLCV based on tick count**

```typescript
import { resampleTicksByCount, TradeTick } from "ohlc-resample";

const adabnb_trades = [
  {
    time: "1564502620356",
    side: "sell",
    quantity: "4458",
    price: "0.00224",
    tradeId: "1221272",
  },
  {
    time: "1564503133949",
    side: "sell",
    quantity: "3480",
    price: "0.002242",
    tradeId: "1221273",
  },
  {
    time: "1564503134553",
    side: "buy",
    quantity: "51",
    price: "0.002248",
    tradeId: "1221274",
  },
];

const airbnb_ticks: TradeTick[] = adabnb_trades.map((trade: any) => ({
  time: Number(trade.time),
  quantity: Number(trade.quantity),
  price: Number(trade.price),
}));

// Candles made up of two ticks

const tickChart = resampleTicksByCount(airbnb_ticks, {
  tickCount: 2,
});
```

## CLI Usage

The package includes a command-line interface for resampling OHLCV data between timeframes and file formats.

### Basic Usage

```bash
# Resample CSV file with default timeframes (1m -> 5m)
ohlc-resample -i input.csv

# Resample JSON file with custom timeframes
ohlc-resample -i input.json -b 60 -n 300

# Save output to file with specific format
ohlc-resample -i input.csv -o output.json -f json
```

### Options

```bash
Options:
  -V, --version                  Show version number
  -i, --input <path>             Input file path (csv, json, jsonl, parquet) or use pipe
  -o, --output <path>            Output file path (csv, json) or use stdout
  -f, --format <fmt>             Output format (csv, json, jsonl) (default: "json")
      --input-format <fmt>       Input format when piping (csv, json, jsonl, auto) (default: "auto")
  -s, --shape <shape>            Output shape for JSON: object, array, auto (default: "auto")
  -b, --base-timeframe <number>  Base timeframe in seconds (default: "60")
  -n, --new-timeframe <number>   New timeframe in seconds (default: "300")
      --map <mapping>            Map record fields to canonical keys (e.g. time=timestamp,volume=amount)
  -h, --help                     Display help for command
```

### OHLCV shapes

The CLI accepts and emits two equivalent JSON shapes:

```json
// object shape (IOHLCV[])
[{ "time": 1609459200000, "open": 100, "high": 105, "low": 95, "close": 102, "volume": 1000 }]

// array shape (OHLCV[], CCXT-style tuple)
[[1609459200000, 100, 105, 95, 102, 1000]]
```

Input shape is auto-detected. Output shape mirrors input by default; override with `-s array` or `-s object`. CSV input is always parsed as object-shape; CSV output is always rows.

### Large files

`.csv`, `.jsonl`, and `.ndjson` **files are read line-by-line and fed through
the async streaming resampler**, so memory never scales with file size (a
JSON array file is the exception: the whole document must be parsed to know
where the array ends, so it stays buffer-based). `.parquet` **files are read
row-group by row-group** through the same async resampler. Output is written
incrementally in CSV, JSON (a valid, parseable array), or JSONL.

```bash
# Stream a 100MB CSV to JSONL candles
ohlc-resample -i huge.csv -f jsonl -o candles.jsonl

# Resample a Parquet OHLCV file (row-group streaming)
ohlc-resample -i data.parquet -f json -o candles.json

# Pipe JSONL line-by-line (no buffering)
cat data.jsonl | ohlc-resample --input-format jsonl -f jsonl
```

### Input Formats

The CLI supports CSV, JSON, and JSONL input formats:

#### Mapping non-canonical fields (`--map`)

When your input uses different field names (CCXT-style `timestamp`/`amount`, a
CSV header in a foreign order, arbitrary Parquet columns), pass `--map` with
`field=sourceKey` entries separated by commas. It applies to CSV headers,
JSON object keys, and Parquet columns; tuple (array) records have no keys and
are unaffected. With `--map`, a CSV's first line is always treated as the
header.

```bash
# CCXT-style JSON objects: timestamp + amount
ohlc-resample -i data.json --map time=timestamp,volume=amount

# Foreign CSV header
ohlc-resample -i data.csv --map time=timestamp,volume=amount

# Arbitrary Parquet columns
ohlc-resample -i data.parquet --map time=mytime,open=myopen,high=myhigh,low=mylow,close=myclose,volume=myvol
```

#### CSV Format
```csv
time,open,high,low,close,volume
1609459200000,100,105,95,102,1000
1609459260000,102,107,101,106,1200
```

#### JSON Format
```json
[
  {
    "time": 1609459200000,
    "open": 100,
    "high": 105,
    "low": 95,
    "close": 102,
    "volume": 1000
  }
]
```

#### JSONL Format (one candle per line)
```json
{"time":1609459200000,"open":100,"high":105,"low":95,"close":102,"volume":1000}
{"time":1609459260000,"open":102,"high":107,"low":101,"close":106,"volume":1200}
```

### Pipe Input

You can pipe data into the CLI from other commands. The format is automatically detected, or you can specify it:

```bash
# Auto-detect format
cat data.json | ohlc-resample
cat data.csv | ohlc-resample

# Force specific format
cat data.json | ohlc-resample --input-format json
cat data.csv | ohlc-resample --input-format csv
```

The CLI supports two types of pipe input:
1. JSON files/strings with OHLCV objects
2. CSV files/strings with headers (time,open,high,low,close,volume)

### Examples

```bash
# Resample 1-minute data to 5-minute candles
ohlc-resample -i data.csv -b 60 -n 300

# Convert CSV to JSON format
ohlc-resample -i data.csv -f json

# Pipe data and save to file
cat data.csv | ohlc-resample -o output.json

# Resample with custom timeframes and save as CSV
ohlc-resample -i data.json -b 300 -n 3600 -f csv -o output.csv
```

## Contributors

👤 **Adil Shaikh <hello@adils.me> (https://adils.me)**

- Website: https://adils.me
- Github: [@adiled](https://github.com/adiled)

👤 Past authors of `candlestick-convert`

## 🤝 Contributing

Contributions, issues and feature requests are welcome!<br />Feel free to check the [issues page](https://github.com/adiled/ohlc-resample/issues).

### Run tests

```sh
npm test
```

## Show your support

Give a ⭐️ if this project helped you!

## 📝 License

Copyright © 2022 [Adil Shaikh <hello@adils.me> (https://adils.me)](https://github.com/adiled).<br />
This project is [LGPL--3.0](https://github.com/adiled/ohlc-resample/blob/main/COPYING) licensed.

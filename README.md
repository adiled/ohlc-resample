<h1 align="center">ohlc-resample 🕯️</h1>
<p align="center">
Turn trade, tick, or OHLCV data into clean candlestick charts on any time frame
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

## What it does

Market data comes in many shapes: raw trades, tick streams, or ready-made
OHLCV candles at a given time frame (1m, 5m, 1h, ...). `ohlc-resample` converts
between them so you always end up with the candles you want to chart:

- Combine raw ticks or trades into **OHLCV candles** (open, high, low, close,
  volume) over a time period or a fixed number of ticks.
- Rebuild OHLCV candles from one time frame to a coarser one (for example
  1-minute candles into 5-minute candles).
- Handle data in the common formats: CCXT-style arrays, JSON objects, CSV,
  JSONL, and Parquet files.
- Process **very large datasets** without running out of memory, by streaming
  input line by line or row group by row group.
- Fill in missing candles so your chart has no gaps.

## Install

### CLI

macOS / Linux:

```sh
curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh
```

This installs the `ohlc` command to `~/.local/bin`. If you do not already have
a recent enough Node, the installer downloads one for you and uses it. Pin a
specific version with `--version 2.0.0`.

To uninstall:

```sh
curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh -s -- --uninstall
```

### Library

```sh
npm install ohlc-resample      # or pnpm add / yarn add / bun add
```

Requires Node.js 26 or newer.

## Quick start (CLI)

```bash
# Install
curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh

# Resample 1-minute candles in data.csv into 5-minute candles
ohlc -i data.csv -b 60 -n 300

# Resample a Parquet file and write JSON candles to a file
ohlc -i data.parquet -f json -o candles.json

# Pipe in JSON, get JSON out
cat data.json | ohlc
```

**OR use directly** with npx, no install needed:

```bash
npx ohlc-resample -i data.csv -b 60 -n 300
```

See the [CLI section](#cli) below for all options.

## Supported input formats

- **OHLCV arrays** (CCXT-style) `[[time, open, high, low, close, volume], ...]`
- **OHLCV JSON objects** `[{ time, open, high, low, close, volume }, ...]`
- **Trade / tick JSON objects** `[{ time, price, quantity }, ...]`
- **CSV**, **JSON**, and **JSONL** files
- **Parquet** files
- **Arbitrary schemas**, when you supply a `map` to the canonical OHLCV fields (for example CCXT's `timestamp` / `amount`, or any foreign column names)

Input times are epoch **milliseconds**. See the [Types](#types) section for
the exact shapes, and the [map option](#renaming-fields-with-map) section for
adapting arbitrary inputs.

## Library usage

```typescript
import {
  resampleOhlcv,
  resampleTicksByTime,
  resampleTicksByCount,
} from "ohlc-resample";

// OHLCV candles from 1 minute to 5 minutes
resampleOhlcv(objectOhlcv, {
  baseTimeframe: 60,
  newTimeframe: 5 * 60,
}); // returns IOHLCV[] objects
resampleOhlcv(arrayOhlcv, {
  baseTimeframe: 60,
  newTimeframe: 5 * 60,
}); // returns OHLCV[] tuples

// Ticks grouped into 1-minute OHLCV candles
// includeLatestCandle is true by default, fillGaps is false by default
resampleTicksByTime(tickData, {
  timeframe: 60,
  includeLatestCandle: false,
  fillGaps: true,
}); // returns IOHLCV[]

// Ticks grouped into candles of 5 ticks each
resampleTicksByCount(tickData, { tickCount: 5 }); // returns IOHLCV[]
```

Each function accepts either an array or any sync iterable / generator. The
result uses the same shape as your input: pass tuples and get tuples back,
pass objects and get objects back. The return type always follows the input
shape.

## Streaming and large datasets

The three functions above also accept a sync iterable or generator as input.
`resampleOhlcv` additionally accepts a binary `Float64Array` of interleaved
`[time, open, high, low, close, volume]` values, which is the fastest way to
feed in large binary data.

For **true streaming**, use the async variants. They read from any async
source (a Node `ReadableStream`, an async generator, anything you can
`for await` over) and emit each candle as soon as it is ready. Memory use stays
bounded by the active time window, never the whole input, so huge files or
live feeds are safe.

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

// Stream ticks into count buckets (memory scales with tickCount)
for await (const candle of resampleTicksByCountAsync(tickSource, { tickCount: 5 })) {
  // ...
}
```

**Sorted input.** The array functions sort a copy for you automatically. A
stream cannot buffer the whole input to sort it, so pass data **ascending by
time** unless you use the healing window below.

**Out-of-order data.** Set `outOfOrderMs` to a number of milliseconds. The
stream then keeps each bucket open for that much wall-clock time, so delayed
or out-of-order records that arrive inside the window are folded into the
correct bucket as they come, with no need to sort everything first.
`outOfOrderMs = 0` (the default) is exact for already-sorted input and emits
each bucket as the stream passes it.

### Parquet files

The async variants also accept a **file path** to a Parquet file. The file is
read one row group at a time, so memory stays bounded by the largest row group
rather than the whole file. This keeps large columnar datasets usable.

```typescript
// Resample a Parquet OHLCV file
for await (const candle of resampleOhlcvAsync("data.parquet", {
  baseTimeframe: 60,
  newTimeframe: 300,
})) {
  // candle is an OHLCV tuple
}

// Resample a Parquet tick file
for await (const candle of resampleTicksByTimeAsync("ticks.parquet", {
  timeframe: 60,
})) {
  // candle is an IOHLCV object
}
```

Parquet columns are read by exact canonical name: `time`, `open`, `high`,
`low`, `close`, `volume` for OHLCV, and `time` / `price` / `quantity` for
ticks. Timestamps in any unit (ms, microseconds, nanoseconds, days) are
converted to milliseconds automatically. If a required column is missing the
call throws; OHLCV `volume` is optional and defaults to `0`. For any other
column layout, use the [`map` option](#renaming-fields-with-map) below.

Parquet input works only with the async variants. The sync functions stay
array/iterable-only.

### Renaming fields with `map`

When your data uses different field names (for example CCXT's `timestamp` and
`amount`, or arbitrary Parquet columns), pass a `map` option to the async
variants. It translates each input record into canonical OHLCV and works
uniformly across Parquet rows, CSV headers, and JSON objects. Two shapes are
accepted.

1. **Record form**, where keys are canonical OHLCV fields and values are the
   keys to read from each input record. Fields you leave out use the canonical
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

2. **Function form**, a full transform `(record) => IOHLCV` for complete
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

Ticks accept the same two shapes over `time` / `price` / `quantity` (for
example `map: { time: 'timestamp', quantity: 'amount' }`). Positional inputs
(OHLCV tuples and `Float64Array`) have no field names to remap and are
unaffected. The sync functions take canonical arrays, so `map` applies only to
the async variants.

## Module format

The package is **ESM-first with a CommonJS wrapper** (`"type": "module"`). Use
`import` for the full API; `require('ohlc-resample')` also works and resolves
to the same module instance, so there is no dual-package confusion.

## Types

```typescript
export type IOHLCV = {
  time: number;   // epoch milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type OHLCV = [number, number, number, number, number, number]; // [time, open, high, low, close, volume]

export type TradeTick = {
  time: number;   // epoch milliseconds
  price: number;
  quantity: number;
};
```

**Note:** input times for all of the above must be in milliseconds.

## Examples

**Resample CCXT (object) OHLCV to a coarser time frame**

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

const baseTimeframe = 60;  // 60 seconds
const newTimeframe = 120;  // 120 seconds

// Candles built from the ticks within each 2-minute window
const link_btc_2m = resampleOhlcv(link_btc_1m, {
  baseTimeframe,
  newTimeframe,
});
```

**Resample ticks to OHLCV candles by tick count**

```typescript
import { resampleTicksByCount, TradeTick } from "ohlc-resample";

const adabnb_trades = [
  { time: "1564502620356", side: "sell", quantity: "4458", price: "0.00224", tradeId: "1221272" },
  { time: "1564503133949", side: "sell", quantity: "3480", price: "0.002242", tradeId: "1221273" },
  { time: "1564503134553", side: "buy", quantity: "51", price: "0.002248", tradeId: "1221274" },
];

const airbnb_ticks: TradeTick[] = adabnb_trades.map((trade: any) => ({
  time: Number(trade.time),
  quantity: Number(trade.quantity),
  price: Number(trade.price),
}));

// Candles built from two ticks each
const tickChart = resampleTicksByCount(airbnb_ticks, {
  tickCount: 2,
});
```

## CLI

The package includes a command-line interface for resampling OHLCV data between
time frames and file formats. The installed command is `ohlc` (the npm package
binary is `ohlc-resample`).

### Basic usage

```bash
# Resample CSV with default time frames (1m to 5m)
ohlc -i input.csv

# Resample JSON with custom time frames
ohlc -i input.json -b 60 -n 300

# Save output to a file in a specific format
ohlc -i input.csv -o output.json -f json
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

Input shape is auto-detected. Output shape mirrors the input by default;
override with `-s array` or `-s object`. CSV input is always parsed as
object-shape, and CSV output is always rows.

### Large files

`.csv`, `.jsonl`, and `.ndjson` files are read line by line and fed through
the streaming resampler, so memory never scales with file size. (A JSON array
file is the exception: the whole document must be parsed to know where the
array ends, so it stays in memory.) `.parquet` files are read row group by row
group through the same streaming resampler. Output is written incrementally in
CSV, JSON (a valid, parseable array), or JSONL.

```bash
# Stream a 100MB CSV to JSONL candles
ohlc -i huge.csv -f jsonl -o candles.jsonl

# Resample a Parquet OHLCV file (row-group streaming)
ohlc -i data.parquet -f json -o candles.json

# Pipe JSONL line by line (no buffering)
cat data.jsonl | ohlc --input-format jsonl -f jsonl
```

### Input formats

The CLI supports CSV, JSON, and JSONL input.

#### Renaming fields with `--map`

When your input uses different field names (CCXT-style `timestamp` / `amount`,
a CSV header in a foreign order, arbitrary Parquet columns), pass `--map` with
`field=sourceKey` entries separated by commas. It applies to CSV headers, JSON
object keys, and Parquet columns; tuple (array) records have no field names and
are unaffected. With `--map`, a CSV's first line is always treated as the
header.

```bash
# CCXT-style JSON objects: timestamp + amount
ohlc -i data.json --map time=timestamp,volume=amount

# Foreign CSV header
ohlc -i data.csv --map time=timestamp,volume=amount

# Arbitrary Parquet columns
ohlc -i data.parquet --map time=mytime,open=myopen,high=myhigh,low=mylow,close=myclose,volume=myvol
```

#### CSV format
```csv
time,open,high,low,close,volume
1609459200000,100,105,95,102,1000
1609459260000,102,107,101,106,1200
```

#### JSON format
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

#### JSONL format (one candle per line)
```json
{"time":1609459200000,"open":100,"high":105,"low":95,"close":102,"volume":1000}
{"time":1609459260000,"open":102,"high":107,"low":101,"close":106,"volume":1200}
```

### Pipe input

You can pipe data into the CLI from other commands. The format is detected
automatically, or you can specify it:

```bash
# Auto-detect format
cat data.json | ohlc
cat data.csv | ohlc

# Force a specific format
cat data.json | ohlc --input-format json
cat data.csv | ohlc --input-format csv
```

The CLI supports two kinds of pipe input:
1. JSON files or strings with OHLCV objects
2. CSV files or strings with a header (time, open, high, low, close, volume)

### CLI examples

```bash
# Resample 1-minute data to 5-minute candles
ohlc -i data.csv -b 60 -n 300

# Convert CSV to JSON
ohlc -i data.csv -f json

# Pipe data and save to a file
cat data.csv | ohlc -o output.json

# Resample with custom time frames and save as CSV
ohlc -i data.json -b 300 -n 3600 -f csv -o output.csv
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

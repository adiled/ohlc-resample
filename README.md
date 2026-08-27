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

`ohlc-resample` converts market data into the candlestick charts you want:

- Combine raw ticks or trades into **OHLCV candles** (open, high, low, close,
  volume), by time period or by a fixed number of ticks.
- Rebuild candles from one time frame to a coarser one (1-minute to 5-minute,
  for example).
- Work with the common formats (CCXT-style arrays, JSON, CSV, JSONL, Parquet)
  and stream very large datasets without running out of memory.
- Fill in missing candles so your chart has no gaps.

## Install

### CLI

```sh
curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh
```

Installs the `ohlc` command to `~/.local/bin` (and a Node runtime if needed).
Pin a version with `--version 2.0.0`. Uninstall with `--uninstall`.

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
- **Arbitrary schemas**, when you supply a `map` (see [Feeding data as-is](#feeding-data-as-is-with-map))

Input times are epoch **milliseconds**. See [Types](#types).

## Library usage

```typescript
import {
  resampleOhlcv,
  resampleTicksByTime,
  resampleTicksByCount,
} from "ohlc-resample";

// OHLCV candles from 1 minute to 5 minutes
resampleOhlcv(objectOhlcv, { baseTimeframe: 60, newTimeframe: 5 * 60 }); // IOHLCV[]
resampleOhlcv(arrayOhlcv, { baseTimeframe: 60, newTimeframe: 5 * 60 });  // OHLCV[]

// Ticks grouped into 1-minute OHLCV candles
resampleTicksByTime(tickData, { timeframe: 60, fillGaps: true }); // IOHLCV[]

// Ticks grouped into candles of 5 ticks each
resampleTicksByCount(tickData, { tickCount: 5 }); // IOHLCV[]
```

Each function accepts an array or any sync iterable / generator. The result
uses the same shape as your input (tuples in, tuples out; objects in, objects
out). `resampleOhlcv` also accepts a binary `Float64Array` of interleaved
`[time, open, high, low, close, volume]` values, the fastest way to feed large
binary data.

## Streaming and large datasets

The async variants read from any async source (a `ReadableStream`, an async
generator, anything you can `for await` over) and emit each candle as soon as
it is ready, so memory stays bounded by the active time window rather than the
input size.

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
})) { }

// Stream ticks into time buckets
for await (const candle of resampleTicksByTimeAsync(tickSource, {
  timeframe: 60,
  fillGaps: true,
})) { }

// Stream ticks into count buckets (memory scales with tickCount)
for await (const candle of resampleTicksByCountAsync(tickSource, { tickCount: 5 })) { }
```

**Sorted input.** The array functions sort a copy for you. A stream cannot
buffer the whole input, so pass data **ascending by time** unless you use the
healing window. Set `outOfOrderMs` to a number of milliseconds and the stream
keeps each bucket open that long, folding delayed or out-of-order records into
the correct bucket as they arrive. `outOfOrderMs = 0` (default) is exact for
already-sorted input.

### Parquet files

The async variants also accept a **file path** to a Parquet file, read one row
group at a time so memory stays bounded by the largest row group.

```typescript
for await (const candle of resampleOhlcvAsync("data.parquet", {
  baseTimeframe: 60,
  newTimeframe: 300,
})) { } // OHLCV tuple

for await (const candle of resampleTicksByTimeAsync("ticks.parquet", {
  timeframe: 60,
})) { } // IOHLCV object
```

Parquet columns are read by exact canonical name (`time`, `open`, `high`,
`low`, `close`, `volume` for OHLCV; `time` / `price` / `quantity` for ticks).
Timestamps in any unit (ms, microseconds, nanoseconds, days) become
milliseconds automatically. Missing required columns throw; OHLCV `volume` is
optional and defaults to `0`. Parquet works only with the async variants.

### Feeding data as-is with `map`

`map` removes the need to pre-transform data before passing it in. Feed
records in whatever schema you already have (CCXT's `timestamp` / `amount`,
foreign Parquet columns, and so on) and `map` tells the resampler which keys to
read. It applies uniformly to Parquet rows, CSV headers, and JSON objects. Two
shapes are accepted:

1. **Record form**, mapping canonical OHLCV fields to the keys in your records.
   Fields you leave out use the canonical key directly:

   ```typescript
   // read `time` from `timestamp` and `volume` from `amount`; the rest stay canonical
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

Ticks accept the same shapes over `time` / `price` / `quantity` (for example
`map: { time: 'timestamp', quantity: 'amount' }`). Positional inputs (OHLCV
tuples and `Float64Array`) have no keys to read and are unaffected. The sync
functions take canonical arrays, so `map` applies only to the async variants.

## Module format

The package is **ESM-first with a CommonJS wrapper** (`"type": "module"`). Use
`import` for the full API; `require('ohlc-resample')` also works and resolves
to the same module instance.

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
  { time: 1563625680000, open: 0.00024824, high: 0.00024851, low: 0.00024798, close: 0.00024831, volume: 2264 },
  { time: 1563625740000, open: 0.00024817, high: 0.00024832, low: 0.00024795, close: 0.00024828, volume: 3145 },
];

// Candles built from the ticks within each 2-minute window
const link_btc_2m = resampleOhlcv(link_btc_1m, {
  baseTimeframe: 60,
  newTimeframe: 120,
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
const tickChart = resampleTicksByCount(airbnb_ticks, { tickCount: 2 });
```

## CLI

The installed command is `ohlc` (the npm package binary is `ohlc-resample`).

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
      --map <mapping>            Feed data as-is; map fields to canonical keys (e.g. time=timestamp,volume=amount)
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

### Feeding data as-is with `--map`

The CLI `--map` flag is the record-form map from the library, as
`field=sourceKey` entries separated by commas. It applies to CSV headers, JSON
object keys, and Parquet columns; tuple (array) records have no keys and are
unaffected. With `--map`, a CSV's first line is always treated as the header.

```bash
# CCXT-style JSON objects: timestamp + amount
ohlc -i data.json --map time=timestamp,volume=amount

# Arbitrary Parquet columns
ohlc -i data.parquet --map time=mytime,open=myopen,high=myhigh,low=mylow,close=myclose,volume=myvol
```

### Large files

`.csv`, `.jsonl`, and `.ndjson` files stream line by line through the
resampler, so memory never scales with file size. (A JSON array file is the
exception: the whole document must be parsed to know where the array ends.)
`.parquet` files stream row group by row group. Output is written
incrementally in CSV, JSON (a valid, parseable array), or JSONL.

```bash
# Stream a 100MB CSV to JSONL candles
ohlc -i huge.csv -f jsonl -o candles.jsonl

# Pipe JSONL line by line (no buffering)
cat data.jsonl | ohlc --input-format jsonl -f jsonl
```

### Pipe input

Pipe data from other commands; the format is detected automatically, or force
it with `--input-format`. Supported pipe input is JSON or CSV (Parquet is
file-only via `-i`).

```bash
cat data.json | ohlc
cat data.csv | ohlc --input-format csv
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

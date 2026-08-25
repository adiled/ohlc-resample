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
  -i, --input <path>             Input file path (csv, json) or use pipe
  -o, --output <path>            Output file path (csv, json) or use stdout
  -f, --format <fmt>             Output format (csv, json) (default: "json")
      --input-format <fmt>       Input format when piping (csv, json, auto) (default: "auto")
  -s, --shape <shape>            Output shape for JSON: object, array, auto (default: "auto")
  -b, --base-timeframe <number>  Base timeframe in seconds (default: "60")
  -n, --new-timeframe <number>   New timeframe in seconds (default: "300")
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

### Input Formats

The CLI supports both CSV and JSON input formats:

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

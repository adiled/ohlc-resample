Improvement fork of `candlestick-convert`.

# ohlc-resample

This package allow you to batch resample OHLCV candlesticks or create them from trade (tick) data sets.

[![Coverage Status](https://coveralls.io/repos/github/adiled/ohlc-resample/badge.svg?branch=master)](https://coveralls.io/github/adiled/ohlc-resample?branch=master) ![NPM ohlc-resample](https://img.shields.io/npm/dt/ohlc-resample)

#### Supported formats

- OHLCV (CCXT format) `[[time,open,high,low,close,volume]]`
- OHLCV JSON `[{time: number, open: number, high: number, low: number close: number, volume: number}]`
- Trade JSON `[{time: number, price: number, quantity: number}]`

#### Features

- Typescript support
- CCXT support
- Single dependency
- Low time complexity grouping based aggregations
- Optional gap filling

#### Install

```
npm install --save ohlc-resample
```

#### Reference

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

#### Types

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

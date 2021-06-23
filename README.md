Improvement fork of `candlestick-convert` covering edge cases.

# ohlc-resample

This package allow you to batch resample OHLCV candlesticks or create them from trade (tick) data sets.

[![Coverage Status](https://coveralls.io/repos/github/m-adilshaikh/ohlc-resample/badge.svg?branch=master)](https://coveralls.io/github/m-adilshaikh/ohlc-resample?branch=master)

#### Supported formats

- OHLCV (CCXT format) `[[time,open,high,low,close,volume]]`
- OHLCV JSON `[{time: number, open: number, high: number, low: number close: number, volume: number}]`
- Trade JSON `[{time: number, price: number, quantity: number}]`

#### Features

- Typescript support
- CCXT support
- Single dependency
- Less time complex grouping based aggregations
- Skip missing candles

#### Install

```
npm install ohlc-resample
```

#### Available functions:

```javascript
import { batchCandleArray, batchCandleJSON, batchTicksToCandle, ticksToTickChart } from "ohlc-resample";

batchCandleArray(candledata: OHLCV[], 60, 300) // return OHLCV[]
batchCandleJSON(candledata: IOHLCV [], 60, 300) // return IOHLCV[]
batchTicksToCandle(tradedata: TradeTick[], 60) // return IOHLCV[]
ticksToTickChart(tradedata: TradeTick[], 5) // return IOHLCV[]

```

#### Types
```javascript
export type IOHLCV = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type OHLCV = [
  number,
  number,
  number,
  number,
  number,
  number,
]

export type TradeTick = {
  price: number;
  quantity: number;
  time: number;
}
```

## Examples

**CCXT OHLCV:**

```javascript
import { batchCandleJSON } from "ohlc-convert";

const link_btc_1m = [
  {
    time: 1563625680000,
    open: 0.00024824,
    high: 0.00024851,
    low: 0.00024798,
    close: 0.00024831,
    volume: 2264
  },
  {
    time: 1563625740000,
    open: 0.00024817,
    high: 0.00024832,
    low: 0.00024795,
    close: 0.00024828,
    volume: 3145
  }];

const baseFrame = 60; // 60 seconds
const newFrame = 120; // 120 seconds

// Convert to 2m Candles

const link_btc_2m = batchCandleJSON(link_btc_1m, baseFrame, newFrame);
```

**Tick Chart:**

```javascript
import { ticksToTickChart, TradeTick } from "ohlc-convert";

const adabnb_trades = [
  {
    time: "1564502620356",
    side: "sell",
    quantity: "4458",
    price: "0.00224",
    tradeId: "1221272"
  },
  {
    time: "1564503133949",
    side: "sell",
    quantity: "3480",
    price: "0.002242",
    tradeId: "1221273"
  },
  {
    time: "1564503134553",
    side: "buy",
    quantity: "51",
    price: "0.002248",
    tradeId: "1221274"
  }];


const filtered_adabnb_trades: TradeTick[] = adabnb_trades.map((trade: any) => ({
  time: trade.time,
  quantity: trade.quantity,
  price: trade.price
}));

const batchSize = 2; // Every TickCandle consist 2 trade
const tickChart = ticksToTickChart(filtered_adabnb_trades, batchSize);
```
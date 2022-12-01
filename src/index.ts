import * as lib from './lib';
export * from './lib';

export default {
  resample_ohlcv: lib.resampleOhlcv,
  array: lib.resampleOhlcv,
  json: lib.resampleOhlcv,
  trade_to_candle: lib.resampleTicksByTime,
  tick_chart: lib.resampleTicksByCount
};
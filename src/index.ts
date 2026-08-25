import * as lib from './lib';
export * from './lib';
export * from './types';

/**
 * Legacy aliased export, kept for backward compatibility with 1.x consumers.
 * Prefer the named exports above.
 */
export default {
  resample_ohlcv: lib.resampleOhlcv,
  array: lib.resampleOhlcv,
  json: lib.resampleOhlcv,
  trade_to_candle: lib.resampleTicksByTime,
  tick_chart: lib.resampleTicksByCount,
};

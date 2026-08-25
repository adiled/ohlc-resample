import type { IOHLCV, OHLCV, TradeTick, Trade } from './types';
import { OHLCVField } from './types';

import sum from "lodash/sum";
import max from "lodash/max";
import min from "lodash/min";
import isPlainObject from "lodash/isPlainObject";
import groupBy from "lodash/groupBy";
import sortBy from "lodash/sortBy";
import chunk from "lodash/chunk";

/**
 * Resample OHLCV data to a coarser timeframe. The return type follows the
 * shape of the input — pass tuples to get tuples back, pass objects to get
 * objects back.
 *
 * @param ohlcvData OHLCV data in tuple (`OHLCV[]`) or object (`IOHLCV[]`) form.
 * @param options.baseTimeframe Source timeframe in seconds.
 * @param options.newTimeframe Target timeframe in seconds (must be a multiple of base).
 */
export function resampleOhlcv(
  ohlcvData: OHLCV[],
  options: { baseTimeframe: number; newTimeframe: number }
): OHLCV[];
export function resampleOhlcv(
  ohlcvData: IOHLCV[],
  options: { baseTimeframe: number; newTimeframe: number }
): IOHLCV[];
// 1.x BC overload: a union-typed argument still resolves cleanly. Keep this
// even though the narrower overloads above are preferred for new code.
export function resampleOhlcv(
  ohlcvData: OHLCV[] | IOHLCV[],
  options: { baseTimeframe: number; newTimeframe: number }
): OHLCV[] | IOHLCV[];
export function resampleOhlcv(
  ohlcvData: OHLCV[] | IOHLCV[],
  { baseTimeframe = 60, newTimeframe = 300 }: { baseTimeframe: number; newTimeframe: number }
): OHLCV[] | IOHLCV[] {

  if (ohlcvData.length === 0) {
    throw new Error("input OHLCV data has no candles");
  }

  if (isPlainObject(ohlcvData[0])) {
    const data = ohlcvData as IOHLCV[];
    const candledata: OHLCV[] = data.map(e => [e.time, e.open, e.high, e.low, e.close, e.volume]);
    const result = resampleOhlcvArray(candledata, baseTimeframe, newTimeframe);
    return result.map(candle => ({
      time: candle[OHLCVField.TIME],
      open: candle[OHLCVField.OPEN],
      high: candle[OHLCVField.HIGH],
      low: candle[OHLCVField.LOW],
      close: candle[OHLCVField.CLOSE],
      volume: candle[OHLCVField.VOLUME],
    }));
  } else {
    const candledata: OHLCV[] = ohlcvData as OHLCV[];
    return resampleOhlcvArray(candledata, baseTimeframe, newTimeframe);
  }
}

/**
 * Resample OHLCV tuples (`[time, open, high, low, close, volume][]`) to a
 * coarser timeframe.
 *
 * Candles are grouped purely by wall-clock bucket (`floor(time / newFrame)`):
 * every input candle lands in the bucket its timestamp falls into, so
 * offset or gappy input produces correct buckets. Input is sorted and copied —
 * the caller's array and its elements are never mutated.
 *
 * @param candledata Source candles as `OHLCV[]`.
 * @param baseFrame Source timeframe in seconds.
 * @param newFrame Target timeframe in seconds (must be a multiple of base).
 * @throws if `newFrame` is not a positive integer multiple of `baseFrame`.
 */

export const resampleOhlcvArray = (
  candledata: OHLCV[],
  baseFrame: number = 60,
  newFrame: number = 300
): OHLCV[] => {
  if (!Number.isFinite(baseFrame) || baseFrame <= 0) {
    throw new Error("baseFrame must be a positive number");
  }
  if (!Number.isFinite(newFrame) || newFrame <= 0) {
    throw new Error("newFrame must be a positive number");
  }
  const ratio = newFrame / baseFrame;
  if (Math.floor(ratio) !== ratio) {
    throw new Error("newFrame must be an integer multiple of baseFrame");
  }
  const msFrame = newFrame * 1000;
  const buckets = new Map<number, OHLCV>();

  // Normalize + sort a copy so the caller's data is left untouched.
  const candles: OHLCV[] = candledata
    .map(c => {
      const [time, open, high, low, close, volume] = c.map(Number);
      return [time, open, high, low, close, volume] as OHLCV;
    })
    .sort((a, b) => a[0] - b[0]);

  for (const [time, open, high, low, close, volume] of candles) {
    const bucketTime = time - (time % msFrame);
    const bucket: OHLCV | undefined = buckets.get(bucketTime);
    if (bucket === undefined) {
      buckets.set(bucketTime, [bucketTime, open, high, low, close, volume]);
    } else {
      bucket[0] = bucketTime;
      bucket[2] = Math.max(bucket[2], high);
      bucket[3] = Math.min(bucket[3], low);
      bucket[4] = close; // last candle in bucket (sorted) wins
      bucket[5] += volume;
    }
  }

  return [...buckets.values()].sort((a, b) => a[0] - b[0]);
}

/**
 * Aggregate group of ticks to one OHLCV object
 * @param time 
 * @param ticks 
 */

export const tickGroupToOhlcv = (
  time: number,
  ticks: Array<TradeTick>
) => {

  const prices = ticks.map(tick => Number(tick.price));
  const volume = sum(ticks.map(tick => Number(tick.quantity))) || 0;
  return {
    time,
    open: prices[0] || 0,
    high: max(prices) || 0,
    low: min(prices) || 0,
    close: prices[prices.length - 1] || 0,
    volume
  }
}

/**
 * Make gap candles from boundary candles if needed
 * @param lastCandle 
 * @param nextCandle 
 * @param options
 * @param options.method
 * @param options.msTimeframe
 */

export const makeGapCandles = (
  lastCandle: IOHLCV,
  nextCandle: IOHLCV,
  { method, msTimeframe }: { method?: string, msTimeframe: number }
): IOHLCV[] => {

  const gapCandles = [];
  const intervalGap = (nextCandle.time - lastCandle.time - msTimeframe) / msTimeframe;
  if (intervalGap > 0 && lastCandle && nextCandle) {
    for (let i = 1; i <= intervalGap; i++) {
      gapCandles.push({
        time: lastCandle.time + (i * msTimeframe),
        open: lastCandle.close,
        high: lastCandle.close,
        low: lastCandle.close,
        close: lastCandle.close,
        volume: 0
      });
    }
  }
  return gapCandles;
}

/**
 * Convert ticks for candles grouped by intervals in seconds or tick count
 * @param tickData 
 * @param options
 * @param options.timeframe
 * @param options.includeLatestCandle
 * @param options.fillGaps
 */

export const resampleTicksByTime = (
  tickData: Trade[],
  { timeframe = 60, includeLatestCandle = true, fillGaps = false }:
    { timeframe?: number, includeLatestCandle?: boolean, fillGaps?: boolean } = {}
): IOHLCV[] => {

  timeframe *= Math.floor(1000);
  const tickGroups = groupBy(tickData, (tick) => tick.time - (tick.time % timeframe));
  const candles: IOHLCV[] = [];
  Object.keys(tickGroups).forEach(timeOpen => {
    const ticks = tickGroups[timeOpen];
    const candle = tickGroupToOhlcv(Number(timeOpen), ticks);
    if (fillGaps && candles.length) {
      const lastCandle = candles[candles.length - 1];
      candles.push(...makeGapCandles(lastCandle, candle, { msTimeframe: timeframe }));
    }
    candles.push(candle);
  });
  const sortedCandles = sortBy(candles, (candle) => candle.time);

  if (includeLatestCandle === false) {
    sortedCandles.pop();
  }
  return sortedCandles;
}

/**
 * Covert ticks to candles by linear groups
 * @param tickData 
 * @param options 
 * @param options.tickCount
 */

export const resampleTicksByCount = (tickData: Trade[],
  { tickCount = 5 }: { tickCount?: number } = {}
): IOHLCV[] => {

  if (tickCount < 1) {
    throw new Error("Convert cannot be smaller than 1");
  }
  const candles: IOHLCV[] = [];
  const tickGroups = chunk(tickData, tickCount);
  tickGroups.forEach(ticks => {
    candles.push(tickGroupToOhlcv(Number(ticks[ticks.length - 1].time), ticks));
  });
  return candles;
}

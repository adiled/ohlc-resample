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
* Resample OHLCV to different timeframe
 * @param ohlcvData
 * @param options 
 * @param options.baseTimeframe 
 * @param options.newTimeframe
 */

export const resampleOhlcv = (
  ohlcvData: OHLCV[] | IOHLCV[],
  { baseTimeframe = 60, newTimeframe = 300 }: { baseTimeframe: number, newTimeframe: number }
): OHLCV[] | IOHLCV[] => {

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
 * Resample OHLCV in object format to different timeframe
 * @param candledata
 * @param baseFrame
 * @param newFrame
 */

export const resampleOhlcvArray = (
  candledata: OHLCV[] | ReadableStream,
  baseFrame: number = 60,
  newFrame: number = 300
): OHLCV[] => {

  const result: OHLCV[] = [];
  baseFrame *= 1000;
  newFrame *= 1000;

  const convertRatio = Math.floor(newFrame / baseFrame);

  if (convertRatio % 1 !== 0) {
    throw new Error("Convert ratio should integer an >= 2");
  }

  if (Array.isArray(candledata)) {
    if (candledata.length == 0 || candledata.length < convertRatio) {
      return result;
    }
  } else {
    throw new Error("Candledata is empty or not an array!");
  }

  // Sort Data to ascending by Time
  candledata.sort((a, b) => a[OHLCVField.TIME] - b[OHLCVField.TIME]);

  // Buffer values
  let open = 0;
  let high = 0;
  let close = 0;
  let low = 0;
  let volume = 0;
  let timeOpen = null;
  let j = 0;

  for (let i = 0; i < candledata.length; i++) {
    const candle = candledata[i];

    // Type convert
    candle[OHLCVField.TIME] = Number(candle[OHLCVField.TIME]);
    candle[OHLCVField.OPEN] = Number(candle[OHLCVField.OPEN]);
    candle[OHLCVField.HIGH] = Number(candle[OHLCVField.HIGH]);
    candle[OHLCVField.LOW] = Number(candle[OHLCVField.LOW]);
    candle[OHLCVField.CLOSE] = Number(candle[OHLCVField.CLOSE]);
    candle[OHLCVField.VOLUME] = Number(candle[OHLCVField.VOLUME]);

    // First / Force New Candle
    if (timeOpen === null) {
      timeOpen = candle[OHLCVField.TIME];

      if (candle[OHLCVField.TIME] % newFrame > 0) {
        timeOpen = candle[OHLCVField.TIME] - candle[OHLCVField.TIME] % newFrame;
      }

      open = candle[OHLCVField.OPEN];
      high = candle[OHLCVField.HIGH];
      low = candle[OHLCVField.LOW];
      close = candle[OHLCVField.CLOSE];
      volume = 0;
      j = 1;
    }

    // New Candle
    if (candle[OHLCVField.TIME] - candle[OHLCVField.TIME] % newFrame !== timeOpen) {

      result.push([timeOpen, open, high, low, close, volume]);

      timeOpen = candle[OHLCVField.TIME] - candle[OHLCVField.TIME] % newFrame;
      open = candle[OHLCVField.OPEN];
      high = candle[OHLCVField.HIGH];
      low = candle[OHLCVField.LOW];
      close = candle[OHLCVField.CLOSE];
      volume = 0;
      j = 1;
    }

    high = Math.max(candle[OHLCVField.HIGH], high);
    low = Math.min(candle[OHLCVField.LOW], low);
    close = candle[OHLCVField.CLOSE];
    volume = volume + candle[OHLCVField.VOLUME];

    // Batch counter
    if (j === convertRatio) {
      result.push([timeOpen, open, high, low, close, volume]);
      timeOpen = null;
    }
    // Last Candle
    if (i === candledata.length - 1) {
      if (result.length == 0) {
        break
      }
      if (result[result.length - 1][OHLCVField.TIME] !== timeOpen) {
        result.push([timeOpen, open, high, low, close, volume])
      }
    }

    j = j + 1;
  }

  return result;
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

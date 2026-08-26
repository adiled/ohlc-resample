import type { IOHLCV, OHLCV, TradeTick, Trade } from './types.js';
import { OHLCVField } from './types.js';

import _ from 'lodash';

import { parquetOhlcvRowsAsync, parquetTicksAsync } from './parquet.js';

/**
 * Resample OHLCV data to a coarser timeframe. The return type follows the
 * shape of the input — pass tuples to get tuples back, pass objects to get
 * objects back.
 *
 * Accepts any of:
 * - an array of tuples (`OHLCV[]`) or objects (`IOHLCV[]`)
 * - a sync iterable/generator of either shape (materialized internally)
 * - a binary `Float64Array` of interleaved `[time, open, high, low, close,
 *   volume]` records (6 doubles per candle) — avoids JSON/object parse cost
 *   for large binary inputs
 *
 * @param ohlcvData OHLCV data as tuples, objects, an iterable of either, or a
 *   binary Float64Array.
 * @param options.baseTimeframe Source timeframe in seconds.
 * @param options.newTimeframe Target timeframe in seconds (must be a multiple of base).
 */
export function resampleOhlcv(
  ohlcvData: Iterable<OHLCV>,
  options: { baseTimeframe: number; newTimeframe: number }
): OHLCV[];
export function resampleOhlcv(
  ohlcvData: Iterable<IOHLCV>,
  options: { baseTimeframe: number; newTimeframe: number }
): IOHLCV[];
export function resampleOhlcv(
  ohlcvData: Float64Array,
  options: { baseTimeframe: number; newTimeframe: number }
): OHLCV[];
// 1.x BC overload: a union-typed argument still resolves cleanly. Keep this
// even though the narrower overloads above are preferred for new code.
export function resampleOhlcv(
  ohlcvData: OHLCV[] | IOHLCV[],
  options: { baseTimeframe: number; newTimeframe: number }
): OHLCV[] | IOHLCV[];
export function resampleOhlcv(
  ohlcvData: Iterable<OHLCV | IOHLCV> | Float64Array,
  { baseTimeframe = 60, newTimeframe = 300 }: { baseTimeframe: number; newTimeframe: number }
): OHLCV[] | IOHLCV[] {

  // Binary interleaved Float64Array: [time, open, high, low, close, volume] per candle.
  if (ohlcvData instanceof Float64Array) {
    if (ohlcvData.length === 0) {
      throw new Error("input OHLCV data has no candles");
    }
    if (ohlcvData.length % 6 !== 0) {
      throw new Error("Float64Array length must be a multiple of 6 (time,open,high,low,close,volume)");
    }
    const candledata: OHLCV[] = [];
    for (let i = 0; i < ohlcvData.length; i += 6) {
      candledata.push([
        ohlcvData[i], ohlcvData[i + 1], ohlcvData[i + 2],
        ohlcvData[i + 3], ohlcvData[i + 4], ohlcvData[i + 5],
      ]);
    }
    return resampleOhlcvArray(candledata, baseTimeframe, newTimeframe);
  }

  // Materialize a sync iterable/generator so the rest of the pipeline stays
  // array-based. For true streaming, use resampleOhlcvAsync instead.
  const data: OHLCV[] | IOHLCV[] = Array.isArray(ohlcvData) ? ohlcvData : [...ohlcvData];

  if (data.length === 0) {
    throw new Error("input OHLCV data has no candles");
  }

  if (_.isPlainObject(data[0])) {
    const arr = data as IOHLCV[];
    const candledata: OHLCV[] = arr.map(e => [e.time, e.open, e.high, e.low, e.close, e.volume]);
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
    const candledata: OHLCV[] = data as OHLCV[];
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
 * Async stream-resample OHLCV to a coarser timeframe without buffering the
 * whole input. Consumes an `AsyncIterable` (e.g. a Node `ReadableStream`,
 * which supports `for await`) and returns an async generator, so a bucket is
 * emitted as soon as it is safe — memory use is bounded by the active bucket
 * window, not the input size.
 *
 * The return shape follows the input shape — pass tuples to get tuples out,
 * objects to get objects out (decided by the first element).
 *
 * **Out-of-order healing**: with `outOfOrderMs > 0`, buckets are held open for
 * that many milliseconds of wall-clock time, so delayed/out-of-order candles
 * that land within the window merge into the correct bucket on the fly — no
 * need to sort the whole dataset first. With `outOfOrderMs = 0` (default) the
 * stream behaves like `resampleOhlcvStream`: buckets are emitted as soon as
 * the stream moves past them, which is exact for pre-sorted input.
 *
 * @param source AsyncIterable of OHLCV tuples/IOHLCV objects, or a string
 *   Parquet file path (streamed row-group by row-group).
 * @param options.newTimeframe Target timeframe in seconds (default 300), must
 *   be a positive integer multiple of baseTimeframe.
 * @param options.outOfOrderMs Healing window in ms (default 0 = strictly sorted).
 * @throws on empty input, or if newTimeframe is not a positive integer
 *   multiple of baseTimeframe.
 */
export function resampleOhlcvAsync(
  source: AsyncIterable<OHLCV>,
  options?: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number }
): AsyncGenerator<OHLCV>;
export function resampleOhlcvAsync(
  source: AsyncIterable<IOHLCV>,
  options?: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number }
): AsyncGenerator<IOHLCV>;
export function resampleOhlcvAsync(
  source: AsyncIterable<OHLCV | IOHLCV>,
  options?: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number }
): AsyncGenerator<OHLCV | IOHLCV>;
export function resampleOhlcvAsync(
  source: string,
  options?: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number }
): AsyncGenerator<OHLCV>;
export async function* resampleOhlcvAsync(
  source: AsyncIterable<OHLCV | IOHLCV> | string,
  options: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number } = {}
): AsyncGenerator<OHLCV | IOHLCV> {

  const { baseTimeframe = 60, newTimeframe = 300, outOfOrderMs = 0 } = options;
  // A string is treated as a Parquet file path: rows are streamed one row
  // group at a time, so memory stays bounded by the largest row group.
  const input: AsyncIterable<OHLCV | IOHLCV> =
    typeof source === 'string' ? parquetOhlcvRowsAsync(source) : source;
  if (!Number.isFinite(baseTimeframe) || baseTimeframe <= 0) {
    throw new Error("baseFrame must be a positive number");
  }
  if (!Number.isFinite(newTimeframe) || newTimeframe <= 0) {
    throw new Error("newFrame must be a positive number");
  }
  const ratio = newTimeframe / baseTimeframe;
  if (Math.floor(ratio) !== ratio) {
    throw new Error("newFrame must be an integer multiple of baseFrame");
  }
  if (outOfOrderMs < 0) {
    throw new Error("outOfOrderMs must be a non-negative number");
  }
  const msFrame = newTimeframe * 1000;

  const it = input[Symbol.asyncIterator]();
  const first = await it.next();
  if (first.done) {
    throw new Error("input OHLCV data has no candles");
  }
  const shape: 'array' | 'object' = Array.isArray(first.value) ? 'array' : 'object';

  const toTuple = (c: OHLCV | IOHLCV): OHLCV =>
    Array.isArray(c)
      ? [Number(c[0]), Number(c[1]), Number(c[2]), Number(c[3]), Number(c[4]), Number(c[5])]
      : [Number(c.time), Number(c.open), Number(c.high), Number(c.low), Number(c.close), Number(c.volume)];

  const toObject = (t: OHLCV): IOHLCV => ({
    time: t[OHLCVField.TIME],
    open: t[OHLCVField.OPEN],
    high: t[OHLCVField.HIGH],
    low: t[OHLCVField.LOW],
    close: t[OHLCVField.CLOSE],
    volume: t[OHLCVField.VOLUME],
  });

  const emit = (t: OHLCV): OHLCV | IOHLCV => shape === 'array' ? t : toObject(t);

  // Sliding bucket window: only buckets older than the healing window are
  // finalized, so memory is bounded by how many buckets fit in outOfOrderMs.
  const buckets = new Map<number, OHLCV>();
  let maxTime = -Infinity;

  const seed = toTuple(first.value);
  const seedBucket = seed[OHLCVField.TIME] - (seed[OHLCVField.TIME] % msFrame);
  maxTime = seed[OHLCVField.TIME];
  buckets.set(seedBucket, [seedBucket, seed[OHLCVField.OPEN], seed[OHLCVField.HIGH], seed[OHLCVField.LOW], seed[OHLCVField.CLOSE], seed[OHLCVField.VOLUME]]);

  for (let r = await it.next(); !r.done; r = await it.next()) {
    const [time, open, high, low, close, volume] = toTuple(r.value);
    maxTime = Math.max(maxTime, time);
    const bucketTime = time - (time % msFrame);
    const existing = buckets.get(bucketTime);
    if (existing) {
      existing[OHLCVField.HIGH] = Math.max(existing[OHLCVField.HIGH], high);
      existing[OHLCVField.LOW] = Math.min(existing[OHLCVField.LOW], low);
      existing[OHLCVField.CLOSE] = close; // last candle in bucket wins
      existing[OHLCVField.VOLUME] += volume;
    } else {
      buckets.set(bucketTime, [bucketTime, open, high, low, close, volume]);
    }

    // Emit every bucket strictly older than the healing window, in order.
    // threshold is a bucket *timestamp* so it compares against Map keys.
    const threshold = Math.floor((maxTime - outOfOrderMs) / msFrame) * msFrame;
    const keys = [...buckets.keys()].filter(k => k < threshold).sort((a, b) => a - b);
    for (const k of keys) {
      yield emit(buckets.get(k)!);
      buckets.delete(k);
    }
  }

  // Flush remaining (open) buckets in order.
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  for (const k of keys) yield emit(buckets.get(k)!);
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
  const volume = _.sum(ticks.map(tick => Number(tick.quantity))) || 0;
  return {
    time,
    open: prices[0] || 0,
    high: _.max(prices) || 0,
    low: _.min(prices) || 0,
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
 * Convert ticks for candles grouped by intervals in seconds or tick count.
 * Accepts an array or a sync iterable/generator of ticks (materialized
 * internally). For true streaming, use resampleTicksByTimeAsync.
 *
 * @param tickData
 * @param options
 * @param options.timeframe
 * @param options.includeLatestCandle
 * @param options.fillGaps
 */

export const resampleTicksByTime = (
  tickData: Iterable<Trade>,
  { timeframe = 60, includeLatestCandle = true, fillGaps = false }:
    { timeframe?: number, includeLatestCandle?: boolean, fillGaps?: boolean } = {}
): IOHLCV[] => {

  timeframe *= Math.floor(1000);
  const data = Array.isArray(tickData) ? tickData : [...tickData];
  const tickGroups = _.groupBy(data, (tick) => tick.time - (tick.time % timeframe));
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
  const sortedCandles = _.sortBy(candles, (candle) => candle.time);

  if (includeLatestCandle === false) {
    sortedCandles.pop();
  }
  return sortedCandles;
}

/**
 * Async stream-resample ticks to OHLCV by time bucket without buffering the
 * whole input. Consumes an `AsyncIterable` and returns an async generator.
 * Only the buckets inside the healing window are held, so memory use is
 * bounded by `outOfOrderMs` of activity, not the input size.
 *
 * Semantics mirror `resampleTicksByTime`: buckets by wall-clock time,
 * `fillGaps` inserts flat volume-0 gap candles between consecutive buckets
 * (including up to the final bucket), and `includeLatestCandle` decides
 * whether the unfinished (open) last bucket is emitted.
 *
 * **Out-of-order healing**: with `outOfOrderMs > 0`, delayed ticks that land
 * within the window merge into the correct bucket on the fly — no global
 * sort required. With `outOfOrderMs = 0` (default) the stream is exact for
 * pre-sorted input and emits each bucket as the stream passes it.
 *
 * @param source AsyncIterable of trade ticks, or a string Parquet file path
 *   of tick rows (streamed row-group by row-group).
 * @param options.timeframe Bucket size in seconds (default 60).
 * @param options.includeLatestCandle Emit the open (unfinished) last bucket (default true).
 * @param options.fillGaps Insert gap candles between buckets (default false).
 * @param options.outOfOrderMs Healing window in ms (default 0 = strictly sorted).
 */
export function resampleTicksByTimeAsync(
  source: AsyncIterable<TradeTick>,
  options?: { timeframe?: number; includeLatestCandle?: boolean; fillGaps?: boolean; outOfOrderMs?: number }
): AsyncGenerator<IOHLCV>;
export function resampleTicksByTimeAsync(
  source: string,
  options?: { timeframe?: number; includeLatestCandle?: boolean; fillGaps?: boolean; outOfOrderMs?: number }
): AsyncGenerator<IOHLCV>;
export async function* resampleTicksByTimeAsync(
  source: AsyncIterable<TradeTick> | string,
  { timeframe = 60, includeLatestCandle = true, fillGaps = false, outOfOrderMs = 0 }:
    { timeframe?: number, includeLatestCandle?: boolean, fillGaps?: boolean, outOfOrderMs?: number } = {}
): AsyncGenerator<IOHLCV> {

  // A string is treated as a Parquet file path of tick rows.
  const input: AsyncIterable<TradeTick> =
    typeof source === 'string' ? parquetTicksAsync(source) : source;
  const msFrame = timeframe * 1000;
  const buckets = new Map<number, TradeTick[]>();
  let maxTime = -Infinity;
  let lastEmitted: IOHLCV | null = null;

  for await (const tick of input) {
    const time = Number(tick.time);
    maxTime = Math.max(maxTime, time);
    const bucketTime = time - (time % msFrame);
    let arr = buckets.get(bucketTime);
    if (!arr) { arr = []; buckets.set(bucketTime, arr); }
    arr.push(tick);

    const threshold = Math.floor((maxTime - outOfOrderMs) / msFrame) * msFrame;
    const keys = [...buckets.keys()].filter(k => k < threshold).sort((a, b) => a - b);
    for (const k of keys) {
      const candle = tickGroupToOhlcv(k, buckets.get(k)!);
      if (fillGaps && lastEmitted) {
        yield* makeGapCandles(lastEmitted, candle, { msTimeframe: msFrame });
      }
      yield candle;
      lastEmitted = candle;
      buckets.delete(k);
    }
  }

  // Flush remaining buckets in order. Matches the array API: gap candles are
  // inserted up to the final bucket, then the final bucket itself is dropped
  // when includeLatestCandle=false.
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const candle = tickGroupToOhlcv(k, buckets.get(k)!);
    const isLast = i === keys.length - 1;
    if (fillGaps && lastEmitted) {
      yield* makeGapCandles(lastEmitted, candle, { msTimeframe: msFrame });
    }
    if (includeLatestCandle || !isLast) yield candle;
    lastEmitted = candle;
  }
}

/**
 * Covert ticks to candles by linear groups. Accepts an array or a sync
 * iterable/generator of ticks (materialized internally). For true streaming,
 * use resampleTicksByCountAsync.
 *
 * @param tickData
 * @param options
 * @param options.tickCount
 */

export const resampleTicksByCount = (tickData: Iterable<Trade>,
  { tickCount = 5 }: { tickCount?: number } = {}
): IOHLCV[] => {

  if (tickCount < 1) {
    throw new Error("Convert cannot be smaller than 1");
  }
  const data = Array.isArray(tickData) ? tickData : [...tickData];
  const candles: IOHLCV[] = [];
  const tickGroups = _.chunk(data, tickCount);
  tickGroups.forEach(ticks => {
    candles.push(tickGroupToOhlcv(Number(ticks[ticks.length - 1].time), ticks));
  });
  return candles;
}

/**
 * Async stream-resample ticks to OHLCV by tick count. Consumes an
 * `AsyncIterable` and returns an async generator. Each complete group of
 * `tickCount` ticks is yielded as soon as it fills; a partial trailing group
 * is emitted at the end, matching `resampleTicksByCount` (which uses
 * `lodash/chunk` and keeps the incomplete tail). Memory use is O(tickCount).
 * Order by count is inherently streaming-safe, so no healing window is needed.
 *
 * @param source AsyncIterable of trade ticks, or a string Parquet file path
 *   of tick rows (streamed row-group by row-group).
 * @param options.tickCount Ticks per candle (default 5).
 */
export function resampleTicksByCountAsync(
  source: AsyncIterable<TradeTick>,
  options?: { tickCount?: number }
): AsyncGenerator<IOHLCV>;
export function resampleTicksByCountAsync(
  source: string,
  options?: { tickCount?: number }
): AsyncGenerator<IOHLCV>;
export async function* resampleTicksByCountAsync(
  source: AsyncIterable<TradeTick> | string,
  { tickCount = 5 }: { tickCount?: number } = {}
): AsyncGenerator<IOHLCV> {

  // A string is treated as a Parquet file path of tick rows.
  const input: AsyncIterable<TradeTick> =
    typeof source === 'string' ? parquetTicksAsync(source) : source;
  if (tickCount < 1) {
    throw new Error("Convert cannot be smaller than 1");
  }
  let group: TradeTick[] = [];
  for await (const tick of input) {
    group.push(tick);
    if (group.length === tickCount) {
      yield tickGroupToOhlcv(Number(group[group.length - 1].time), group);
      group = [];
    }
  }
  if (group.length > 0) {
    yield tickGroupToOhlcv(Number(group[group.length - 1].time), group);
  }
}

import type { IOHLCV, OHLCV, TradeTick, Trade } from './types.js';
import { OHLCVField } from './types.js';

import { parquetOhlcvRowsAsync, parquetTicksAsync } from './parquet.js';
import { mapOhlcvIterable, mapTickIterable } from './map.js';
import type { OhlcvMap, TickMap } from './map.js';

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

  // Object-shaped input? (first element is a plain object, not a tuple).
  if (!Array.isArray(data[0]) && typeof data[0] === 'object' && data[0] !== null) {
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
  options?: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number; map?: OhlcvMap }
): AsyncGenerator<OHLCV | IOHLCV>;
export function resampleOhlcvAsync(
  source: string,
  options?: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number; map?: OhlcvMap }
): AsyncGenerator<OHLCV>;
export async function* resampleOhlcvAsync(
  source: AsyncIterable<OHLCV | IOHLCV> | string,
  options: { baseTimeframe?: number; newTimeframe?: number; outOfOrderMs?: number; map?: OhlcvMap } = {}
): AsyncGenerator<OHLCV | IOHLCV> {

  const { baseTimeframe = 60, newTimeframe = 300, outOfOrderMs = 0, map } = options;
  // A string is treated as a Parquet file path: rows are streamed one row
  // group at a time, so memory stays bounded by the largest row group. The
  // optional per-record `map` (Record or function form) applies to the
  // parquet rows and to object-shaped async iterable items alike.
  const input: AsyncIterable<OHLCV | IOHLCV> =
    typeof source === 'string'
      ? parquetOhlcvRowsAsync(source, map)
      : (map ? mapOhlcvIterable(source, map) : source);
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
 * Result of auditing an OHLCV input: structural checks that tell you whether
 * the source is safe to resample, and exactly why (or why not).
 */
export interface AuditReport {
  /** Total number of valid OHLCV records inspected. */
  records: number;
  /** Min/max timestamps and the span they cover (epoch ms + ISO strings). */
  timeRange: {
    startMs: number;
    endMs: number;
    spanMs: number;
    start: string;
    end: string;
  };
  /** Detected source timeframe in seconds (modal interval), or `null` when unknown. */
  baseTimeframe: number | null;
  ordering: {
    /** True when every record arrived in ascending timestamp order. */
    sorted: boolean;
    /** Count of records whose timestamp is behind the max seen so far. */
    outOfOrder: number;
    /** Largest distance (ms) a late record lagged behind the max seen. */
    maxLatenessMs: number;
  };
  duplicates: {
    /** Count of records whose timestamp duplicates an earlier one. */
    duplicateTimestamps: number;
  };
  ohlc: {
    /** Count of bars that violate OHLC invariants (high<low, high<max(open,close), low>min(open,close)). */
    invalidBars: number;
  };
  values: {
    nan: number;
    infinity: number;
    negativePrices: number;
    negativeVolume: number;
  };
  gaps: {
    /** Expected bars across the span at the base timeframe. */
    expectedBars: number;
    /** Distinct timestamps observed. */
    observed: number;
    /** Missing bars = expected - observed (floor 0). */
    missing: number;
  };
}

/**
 * Audit OHLCV input in a single streaming pass and return an `AuditReport`.
 * Memory is O(distinct timestamps) because duplicate/gap detection needs to
 * remember which bucket timestamps have been seen; everything else is O(1).
 *
 * @param source AsyncIterable of OHLCV tuples/IOHLCV objects, or a string
 *   Parquet file path (streamed row-group by row-group).
 * @param options.baseTimeframe Optional known source timeframe in seconds;
 *   when omitted it is detected as the modal interval between records.
 * @param options.map Optional per-record map (Record or function form).
 * @throws on empty input.
 */
export async function auditOhlcv(
  source: AsyncIterable<OHLCV | IOHLCV> | string,
  options: { baseTimeframe?: number; map?: OhlcvMap } = {}
): Promise<AuditReport> {
  const { baseTimeframe, map } = options;
  const input: AsyncIterable<OHLCV | IOHLCV> =
    typeof source === 'string'
      ? parquetOhlcvRowsAsync(source, map)
      : (map ? mapOhlcvIterable(source, map) : source);

  const it = input[Symbol.asyncIterator]();
  const first = await it.next();
  if (first.done) {
    throw new Error('input OHLCV data has no candles');
  }

  const toTuple = (c: OHLCV | IOHLCV): OHLCV =>
    Array.isArray(c)
      ? [Number(c[0]), Number(c[1]), Number(c[2]), Number(c[3]), Number(c[4]), Number(c[5])]
      : [Number(c.time), Number(c.open), Number(c.high), Number(c.low), Number(c.close), Number(c.volume)];

  const firstTuple = toTuple(first.value);
  let records = 1;
  let minTime = firstTuple[OHLCVField.TIME];
  let maxTime = firstTuple[OHLCVField.TIME];
  let maxTimeSeen = firstTuple[OHLCVField.TIME];
  let outOfOrder = 0;
  let maxLatenessMs = 0;
  const seen = new Set<number>([firstTuple[OHLCVField.TIME]]);
  let duplicateTimestamps = 0;
  let invalidBars = 0;
  let nan = 0;
  let infinity = 0;
  let negativePrices = 0;
  let negativeVolume = 0;
  const deltaHist: Record<string, number> = {};
  let prev = firstTuple[OHLCVField.TIME];

  for (let r = await it.next(); !r.done; r = await it.next()) {
    const [time, open, high, low, close, volume] = toTuple(r.value);
    records++;

    if (time < minTime) minTime = time;
    if (time > maxTime) maxTime = time;

    if (time < maxTimeSeen) {
      outOfOrder++;
      const lateness = maxTimeSeen - time;
      if (lateness > maxLatenessMs) maxLatenessMs = lateness;
    }
    maxTimeSeen = Math.max(maxTimeSeen, time);

    if (seen.has(time)) {
      duplicateTimestamps++;
    } else {
      seen.add(time);
    }

    if (time > prev) {
      const sec = Math.round((time - prev) / 1000);
      deltaHist[sec] = (deltaHist[sec] || 0) + 1;
    }
    prev = time;

    if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
      invalidBars++;
    }

    if ([time, open, high, low, close, volume].some(Number.isNaN)) nan++;
    if ([time, open, high, low, close, volume].some(f => f === Infinity || f === -Infinity)) infinity++;
    if (open < 0 || high < 0 || low < 0 || close < 0) negativePrices++;
    if (volume < 0) negativeVolume++;
  }

  // Source timeframe: honor the option, else take the modal positive interval.
  // Intervals that round to <=0 seconds (sub-second data) are treated as unknown.
  let detected: number | null = baseTimeframe ?? null;
  if (detected === null) {
    let best = 0;
    let bestCount = -1;
    for (const [sec, count] of Object.entries(deltaHist)) {
      if (count > bestCount || (count === bestCount && Number(sec) < best)) {
        best = Number(sec);
        bestCount = count;
      }
    }
    detected = bestCount > 0 && best > 0 ? best : null;
  }

  const spanMs = maxTime - minTime;
  const expectedBars =
    detected !== null && spanMs > 0 ? Math.floor(spanMs / (detected * 1000)) + 1 : 0;
  const observed = seen.size;
  const missing = Math.max(0, expectedBars - observed);

  return {
    records,
    timeRange: {
      startMs: minTime,
      endMs: maxTime,
      spanMs,
      start: new Date(minTime).toISOString(),
      end: new Date(maxTime).toISOString(),
    },
    baseTimeframe: detected,
    ordering: { sorted: outOfOrder === 0, outOfOrder, maxLatenessMs },
    duplicates: { duplicateTimestamps },
    ohlc: { invalidBars },
    values: { nan, infinity, negativePrices, negativeVolume },
    gaps: { expectedBars, observed, missing },
  };
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
  let volume = 0;
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < prices.length; i++) {
    volume += Number(ticks[i].quantity);
    const p = prices[i];
    if (p > max) max = p;
    if (p < min) min = p;
  }
  return {
    time,
    open: prices[0] || 0,
    high: max || 0,
    low: min || 0,
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
  // Group ticks by wall-clock bucket, preserving insertion order (a plain
  // object keyed by bucket string is stable and matches the old groupBy).
  const tickGroups: Record<string, TradeTick[]> = {};
  for (const tick of data) {
    const key = String(tick.time - (tick.time % timeframe));
    (tickGroups[key] ||= []).push(tick);
  }
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
  // Stable ascending sort (Array.prototype.sort is stable in Node >= 12).
  const sortedCandles = [...candles].sort((a, b) => a.time - b.time);

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
  options?: { timeframe?: number; includeLatestCandle?: boolean; fillGaps?: boolean; outOfOrderMs?: number; map?: TickMap }
): AsyncGenerator<IOHLCV>;
export function resampleTicksByTimeAsync(
  source: string,
  options?: { timeframe?: number; includeLatestCandle?: boolean; fillGaps?: boolean; outOfOrderMs?: number; map?: TickMap }
): AsyncGenerator<IOHLCV>;
export async function* resampleTicksByTimeAsync(
  source: AsyncIterable<TradeTick> | string,
  { timeframe = 60, includeLatestCandle = true, fillGaps = false, outOfOrderMs = 0, map }:
    { timeframe?: number, includeLatestCandle?: boolean, fillGaps?: boolean, outOfOrderMs?: number, map?: TickMap } = {}
): AsyncGenerator<IOHLCV> {

  // A string is treated as a Parquet file path of tick rows.
  const input: AsyncIterable<TradeTick> =
    typeof source === 'string'
      ? parquetTicksAsync(source, map)
      : (map ? mapTickIterable(source, map) : source);
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
  // Chunk into groups of tickCount, keeping the incomplete trailing tail
  // (matches the legacy chunk behavior resampleTicksByCount relied on).
  for (let i = 0; i < data.length; i += tickCount) {
    const ticks = data.slice(i, i + tickCount);
    candles.push(tickGroupToOhlcv(Number(ticks[ticks.length - 1].time), ticks));
  }
  return candles;
}

/**
 * Async stream-resample ticks to OHLCV by tick count. Consumes an
 * `AsyncIterable` and returns an async generator. Each complete group of
 * `tickCount` ticks is yielded as soon as it fills; a partial trailing group
 * is emitted at the end, matching `resampleTicksByCount` (which uses
 * `chunk` behavior and keeps the incomplete tail). Memory use is O(tickCount).
 * Order by count is inherently streaming-safe, so no healing window is needed.
 *
 * @param source AsyncIterable of trade ticks, or a string Parquet file path
 *   of tick rows (streamed row-group by row-group).
 * @param options.tickCount Ticks per candle (default 5).
 */
export function resampleTicksByCountAsync(
  source: AsyncIterable<TradeTick>,
  options?: { tickCount?: number; map?: TickMap }
): AsyncGenerator<IOHLCV>;
export function resampleTicksByCountAsync(
  source: string,
  options?: { tickCount?: number; map?: TickMap }
): AsyncGenerator<IOHLCV>;
export async function* resampleTicksByCountAsync(
  source: AsyncIterable<TradeTick> | string,
  { tickCount = 5, map }: { tickCount?: number, map?: TickMap } = {}
): AsyncGenerator<IOHLCV> {

  // A string is treated as a Parquet file path of tick rows.
  const input: AsyncIterable<TradeTick> =
    typeof source === 'string'
      ? parquetTicksAsync(source, map)
      : (map ? mapTickIterable(source, map) : source);
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

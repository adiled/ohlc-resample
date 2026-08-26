"use strict";

import { test, expect } from "vitest";
import {
  resampleOhlcv,
  resampleOhlcvAsync,
  resampleTicksByTime,
  resampleTicksByTimeAsync,
  resampleTicksByCount,
  resampleTicksByCountAsync,
} from "../src/index";
import type { IOHLCV, OHLCV, TradeTick } from "../src/types";

// 1m BTC data (object form) shared by most parity checks.
const object1m: IOHLCV[] = [
  { time: 1589177580000, open: 8695.81, high: 8700.0, low: 8695.41, close: 8698.29, volume: 20.87075 },
  { time: 1589177640000, open: 8697.93, high: 8698.91, low: 8687.9, close: 8695.01, volume: 41.313954 },
  { time: 1589177700000, open: 8696.02, high: 8709.53, low: 8691.46, close: 8708.06, volume: 71.01759 },
  { time: 1589177760000, open: 8708.35, high: 8721.21, low: 8706.53, close: 8721.21, volume: 75.892621 },
  { time: 1589177820000, open: 8721.21, high: 8721.21, low: 8709.35, close: 8713.14, volume: 72.308842 },
  { time: 1589177880000, open: 8713.14, high: 8714.63, low: 8707.43, close: 8710.2, volume: 25.581651 },
  { time: 1589177940000, open: 8710.21, high: 8718.87, low: 8710.21, close: 8711.9, volume: 51.244036 },
  { time: 1589178000000, open: 8711.89, high: 8711.89, low: 8703.2, close: 8704.39, volume: 26.062579 },
  { time: 1589178060000, open: 8704.39, high: 8711.47, low: 8704.38, close: 8708.11, volume: 41.123627 },
  { time: 1589178120000, open: 8708.11, high: 8710.0, low: 8707.23, close: 8707.33, volume: 9.777135 },
  { time: 1589178180000, open: 8707.32, high: 8716.25, low: 8705.0, close: 8713.38, volume: 44.299947 },
  { time: 1589178240000, open: 8713.23, high: 8719.43, low: 8710.57, close: 8717.09, volume: 59.07193 },
  { time: 1589178300000, open: 8717.09, high: 8721.0, low: 8710.03, close: 8720.13, volume: 26.420557 },
  { time: 1589178360000, open: 8719.7, high: 8730.32, low: 8718.25, close: 8724.5, volume: 51.527443 },
  { time: 1589178420000, open: 8726.75, high: 8732.23, low: 8718.29, close: 8723.77, volume: 55.485704 },
  { time: 1589178480000, open: 8722.17, high: 8725.06, low: 8718.32, close: 8718.53, volume: 23.427228 },
  { time: 1589178540000, open: 8718.53, high: 8721.81, low: 8716.76, close: 8720.0, volume: 25.014032 },
  { time: 1589178600000, open: 8719.53, high: 8724.19, low: 8715.0, close: 8717.38, volume: 23.258556 },
  { time: 1589178660000, open: 8717.57, high: 8717.84, low: 8709.05, close: 8710.92, volume: 21.163949 },
  { time: 1589178720000, open: 8710.92, high: 8711.66, low: 8700.0, close: 8706.24, volume: 42.016462 },
  { time: 1589178780000, open: 8706.24, high: 8712.18, low: 8704.68, close: 8710.8, volume: 23.806239 },
  { time: 1589178840000, open: 8710.53, high: 8719.98, low: 8710.0, close: 8717.76, volume: 29.303668 },
  { time: 1589178900000, open: 8717.76, high: 8717.77, low: 8707.89, close: 8709.86, volume: 42.120656 },
  { time: 1589178960000, open: 8709.86, high: 8714.88, low: 8709.86, close: 8710.06, volume: 39.543405 },
  { time: 1589179020000, open: 8710.06, high: 8711.75, low: 8701.65, close: 8703.08, volume: 36.669774 },
  { time: 1589179080000, open: 8703.04, high: 8707.08, low: 8701.06, close: 8702.9, volume: 30.41817 },
  { time: 1589179140000, open: 8702.18, high: 8702.76, low: 8695.0, close: 8700.95, volume: 69.636751 },
  { time: 1589179200000, open: 8700.95, high: 8700.96, low: 8692.83, close: 8694.83, volume: 25.879202 },
  { time: 1589179260000, open: 8695.0, high: 8699.7, low: 8692.64, close: 8695.98, volume: 15.013254 },
  { time: 1589179320000, open: 8695.98, high: 8698.0, low: 8695.08, close: 8695.08, volume: 17.997163 },
];

const ticks: TradeTick[] = [
  { time: 1564502620356, price: 0.00224, quantity: 4458 },
  { time: 1564503133949, price: 0.002242, quantity: 3480 },
  { time: 1564503134553, price: 0.002248, quantity: 51 },
  { time: 1564503137460, price: 0.002248, quantity: 52 },
  { time: 1564503137490, price: 0.002248, quantity: 1366 },
  { time: 1564503320756, price: 0.002244, quantity: 16991 },
  { time: 1564503321803, price: 0.002244, quantity: 2164 },
  { time: 1564503324289, price: 0.002243, quantity: 1966 },
  { time: 1564503456291, price: 0.002249, quantity: 5277 },
  { time: 1564503468749, price: 0.002248, quantity: 1169 },
  { time: 1564503547676, price: 0.00225, quantity: 652 },
  { time: 1564503891110, price: 0.002245, quantity: 712 },
  { time: 1564504355614, price: 0.00225, quantity: 327 },
  { time: 1564504451680, price: 0.00225, quantity: 1055 },
  { time: 1564504631987, price: 0.002247, quantity: 1522 },
  { time: 1564504713188, price: 0.002246, quantity: 79 },
  { time: 1564504713223, price: 0.002246, quantity: 1160 },
  { time: 1564504713227, price: 0.002246, quantity: 1623 },
  { time: 1564504724336, price: 0.002246, quantity: 89 },
  { time: 1564504753820, price: 0.002246, quantity: 269 },
  { time: 1564504794001, price: 0.002245, quantity: 1781 },
  { time: 1564505361033, price: 0.002246, quantity: 218 },
  { time: 1564505487939, price: 0.002251, quantity: 60 },
  { time: 1564505490350, price: 0.002251, quantity: 224 },
  { time: 1564505762661, price: 0.002251, quantity: 1054 },
  { time: 1564505771404, price: 0.002251, quantity: 5519 },
  { time: 1564506180490, price: 0.002241, quantity: 238 },
  { time: 1564506627951, price: 0.00224, quantity: 7249 },
  { time: 1564506666840, price: 0.002239, quantity: 60 },
  { time: 1564506666840, price: 0.002238, quantity: 7443 },
  { time: 1564506666866, price: 0.002237, quantity: 724 },
  { time: 1564507605470, price: 0.002244, quantity: 706 },
  { time: 1564508193610, price: 0.00225, quantity: 1621 },
  { time: 1564508200723, price: 0.00225, quantity: 533 },
  { time: 1564508212153, price: 0.002248, quantity: 4322 },
  { time: 1564508212158, price: 0.002248, quantity: 6239 },
  { time: 1564508212163, price: 0.002248, quantity: 2784 },
  { time: 1564508495720, price: 0.002246, quantity: 5150 },
  { time: 1564508495720, price: 0.002247, quantity: 7328 },
  { time: 1564508585720, price: 0.002245, quantity: 120 },
  { time: 1564508625642, price: 0.002249, quantity: 200 },
  { time: 1564509238524, price: 0.002251, quantity: 60 },
  { time: 1564509271956, price: 0.002254, quantity: 55 },
  { time: 1564509333026, price: 0.002254, quantity: 1407 },
  { time: 1564509465425, price: 0.002246, quantity: 3097 },
  { time: 1564509465425, price: 0.00225, quantity: 1903 },
  { time: 1564509510570, price: 0.002247, quantity: 2485 },
  { time: 1564509510570, price: 0.002246, quantity: 2515 },
  { time: 1564509559380, price: 0.002251, quantity: 3645 },
  { time: 1564509559380, price: 0.002249, quantity: 6513 },
  { time: 1564509797843, price: 0.002254, quantity: 50 },
];

const asAsync = <T,>(arr: T[]): AsyncIterable<T> => ({
  [Symbol.asyncIterator]: async function* () { yield* arr; },
});

const collectAsync = async <T,>(gen: AsyncGenerator<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
};

// --- resampleOhlcv accepts sync iterables / generators ---------------------

test("resampleOhlcv accepts a generator (object shape) == array result", () => {
  function* gen() { yield* object1m; }
  const expected = resampleOhlcv(object1m, { baseTimeframe: 60, newTimeframe: 300 });
  const actual = resampleOhlcv(gen(), { baseTimeframe: 60, newTimeframe: 300 });
  expect(actual).toEqual(expected);
});

test("resampleOhlcv accepts a generator (tuple shape)", () => {
  const tuples: OHLCV[] = object1m.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  function* gen() { yield* tuples; }
  const expected = resampleOhlcv(tuples, { baseTimeframe: 60, newTimeframe: 300 });
  const actual = resampleOhlcv(gen(), { baseTimeframe: 60, newTimeframe: 300 });
  expect(actual).toEqual(expected);
  expect(Array.isArray(actual[0])).toBe(true);
});

test("resampleOhlcv accepts a binary Float64Array", () => {
  const tuples: OHLCV[] = object1m.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  const buf = new Float64Array(tuples.length * 6);
  tuples.forEach((t, i) => { const o = i * 6; for (let j = 0; j < 6; j++) buf[o + j] = t[j]; });
  const expected = resampleOhlcv(tuples, { baseTimeframe: 60, newTimeframe: 300 });
  const actual = resampleOhlcv(buf, { baseTimeframe: 60, newTimeframe: 300 });
  expect(actual).toEqual(expected);
});

test("resampleOhlcv rejects empty iterable", () => {
  expect(() => resampleOhlcv((function* () {})() as Iterable<OHLCV>, { baseTimeframe: 60, newTimeframe: 300 }))
    .toThrow("input OHLCV data has no candles");
});

// --- resampleOhlcvAsync ----------------------------------------------------

test("async stream resampleOhlcv matches array API (sorted, default window)", async () => {
  const tuples: OHLCV[] = object1m.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  const expected = resampleOhlcv(tuples, { baseTimeframe: 60, newTimeframe: 300 });
  const actual = await collectAsync(resampleOhlcvAsync(asAsync(tuples), { baseTimeframe: 60, newTimeframe: 300 }));
  expect(actual).toEqual(expected);
});

test("async stream resampleOhlcv heals out-of-order candles within window", async () => {
  // A 3-minute candle arrives late but inside the 10-minute healing window.
  const sorted = [
    { time: 1589177580000, open: 10, high: 12, low: 9, close: 11, volume: 5 },
    { time: 1589177640000, open: 11, high: 14, low: 10, close: 13, volume: 7 },
  ];
  const late = { time: 1589177580000, open: 10, high: 20, low: 9, close: 18, volume: 3 };
  const outOfOrder = [sorted[0], sorted[1], late];
  const actual = await collectAsync(resampleOhlcvAsync(asAsync(outOfOrder), {
    baseTimeframe: 60, newTimeframe: 300, outOfOrderMs: 10 * 60 * 1000,
  }));
  expect(actual).toHaveLength(1);
  // candle 1589177580000 falls in wall-clock bucket 1589177400000; the late
  // candle merged into it: high/close/volume updated
  expect(actual[0]).toMatchObject({ time: 1589177400000, high: 20, close: 18, volume: 15 });
});

test("async stream resampleOhlcv is bounded-memory (flushes as it passes buckets)", async () => {
  // Regression: the flush threshold must be a bucket *timestamp*, not an
  // index — otherwise no bucket is ever finalized until the source ends and
  // memory grows with the whole input.
  let consumed = 0;
  async function* gen() {
    const t0 = 1589177580000;
    for (let i = 0; i < 10000; i++) {
      consumed++;
      yield [t0 + i * 60000, 10, 12, 9, 11, 5];
    }
  }
  const g = resampleOhlcvAsync(gen(), { baseTimeframe: 60, newTimeframe: 300 });
  const first = await g.next();
  // t0=1589177580000 is 180s into its 300s bucket, so bucket 1589177400000
  // holds only candles i=0..1 and closes when candle i=2 (next bucket)
  // arrives → ~3 rows consumed, not the whole 10k source.
  expect(consumed).toBeLessThan(20);
  expect(first.done).toBe(false);
  expect(first.value).toEqual([1589177400000, 10, 12, 9, 11, 10]);
});

test("async stream resampleOhlcv emits eagerly (does not buffer input)", async () => {
  const tuples: OHLCV[] = object1m.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  const gen = resampleOhlcvAsync(asAsync(tuples), { baseTimeframe: 60, newTimeframe: 300 });
  const first = await gen.next();
  expect(first.done).toBe(false);
  // first 1m candle (1589177580000) lands in wall-clock bucket 1589177400000
  expect(first.value).toEqual([
    1589177400000, 8695.81, 8700, 8687.9, 8695.01, 62.184704,
  ]);
});

test("async stream resampleOhlcv throws on empty input", async () => {
  await expect(collectAsync(resampleOhlcvAsync(asAsync([]), { baseTimeframe: 60, newTimeframe: 300 })))
    .rejects.toThrow("input OHLCV data has no candles");
});

test("async stream resampleOhlcv rejects non-multiple timeframe", async () => {
  const tuples: OHLCV[] = object1m.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  await expect(collectAsync(resampleOhlcvAsync(asAsync(tuples), { baseTimeframe: 60, newTimeframe: 200 })))
    .rejects.toThrow("integer multiple");
});

// --- ticks: existing functions accept iterables ----------------------------

test("resampleTicksByCount accepts a generator == array result", () => {
  function* gen() { yield* ticks; }
  const expected = resampleTicksByCount(ticks, { tickCount: 5 });
  const actual = resampleTicksByCount(gen(), { tickCount: 5 });
  expect(actual).toEqual(expected);
});

test("resampleTicksByTime accepts a generator == array result", () => {
  function* gen() { yield* ticks; }
  const expected = resampleTicksByTime(ticks, { timeframe: 60 });
  const actual = resampleTicksByTime(gen(), { timeframe: 60 });
  expect(actual).toEqual(expected);
});

// --- ticks async variants --------------------------------------------------

test("async resampleTicksByCount matches array API", async () => {
  const expected = resampleTicksByCount(ticks, { tickCount: 5 });
  const actual = await collectAsync(resampleTicksByCountAsync(asAsync(ticks), { tickCount: 5 }));
  expect(actual).toEqual(expected);
});

test("async resampleTicksByTime matches array API (default)", async () => {
  const expected = resampleTicksByTime(ticks, { timeframe: 60 });
  const actual = await collectAsync(resampleTicksByTimeAsync(asAsync(ticks), { timeframe: 60 }));
  expect(actual).toEqual(expected);
});

test("async resampleTicksByTime matches array API (includeLatestCandle=false)", async () => {
  const expected = resampleTicksByTime(ticks, { timeframe: 60, includeLatestCandle: false });
  const actual = await collectAsync(resampleTicksByTimeAsync(asAsync(ticks), { timeframe: 60, includeLatestCandle: false }));
  expect(actual).toEqual(expected);
});

test("async resampleTicksByTime matches array API (fillGaps=true)", async () => {
  const expected = resampleTicksByTime(ticks, { timeframe: 60, fillGaps: true });
  const actual = await collectAsync(resampleTicksByTimeAsync(asAsync(ticks), { timeframe: 60, fillGaps: true }));
  expect(actual).toEqual(expected);
});

test("async resampleTicksByTime matches array API (fillGaps + drop latest)", async () => {
  const expected = resampleTicksByTime(ticks, { timeframe: 60, fillGaps: true, includeLatestCandle: false });
  const actual = await collectAsync(resampleTicksByTimeAsync(
    asAsync(ticks),
    { timeframe: 60, fillGaps: true, includeLatestCandle: false },
  ));
  expect(actual).toEqual(expected);
});

test("async resampleTicksByTime heals out-of-order ticks within window", async () => {
  // A late tick for an earlier bucket arrives within the healing window.
  // Bucket A = 960000, bucket B = 1020000 (60s apart).
  const early = { time: 960000, price: 10, quantity: 2 };
  const late = { time: 960000, price: 99, quantity: 1 };
  const outOfOrder = [
    { time: 1020000, price: 11, quantity: 1 }, // bucket B (newer)
    early,
    late,
  ];
  const actual = await collectAsync(resampleTicksByTimeAsync(asAsync(outOfOrder), {
    timeframe: 60, outOfOrderMs: 120 * 1000,
  }));
  expect(actual).toHaveLength(2);
  // bucket A (960000) merged the late tick: close/high from late, volume summed
  expect(actual[0]).toMatchObject({ time: 960000, open: 10, high: 99, close: 99, volume: 3 });
});

// --- per-record map option (CCXT-style keys: timestamp / amount) -----------

test("async resampleOhlcv with a Record map remaps object records", async () => {
  // Mapped object records resample to object-shaped output.
  const expected = resampleOhlcv(object1m, { baseTimeframe: 60, newTimeframe: 300 });
  const ccxt = object1m.map(c => ({
    timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, amount: c.volume,
  }));
  const actual = await collectAsync(resampleOhlcvAsync(asAsync(ccxt), {
    baseTimeframe: 60,
    newTimeframe: 300,
    map: { time: 'timestamp', volume: 'amount' },
  }));
  expect(actual).toEqual(expected);
});

test("async resampleOhlcv with a function map transforms each record", async () => {
  const expected = resampleOhlcv(object1m, { baseTimeframe: 60, newTimeframe: 300 });
  const ccxt = object1m.map(c => ({
    timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, amount: c.volume,
  }));
  const actual = await collectAsync(resampleOhlcvAsync(asAsync(ccxt), {
    baseTimeframe: 60,
    newTimeframe: 300,
    map: (r) => ({ time: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.amount }),
  }));
  expect(actual).toEqual(expected);
});

test("async resampleTicksByTime with a Record map remaps tick records", async () => {
  const expected = resampleTicksByTime(ticks, { timeframe: 60 });
  const ccxt = ticks.map(t => ({ timestamp: t.time, price: t.price, amount: t.quantity }));
  const actual = await collectAsync(resampleTicksByTimeAsync(asAsync(ccxt), {
    timeframe: 60,
    map: { time: 'timestamp', quantity: 'amount' },
  }));
  expect(actual).toEqual(expected);
});

test("async resampleOhlcv with a map passes tuple records through unchanged", async () => {
  // Tuple records have no keys to map; the map must be a no-op for them.
  const tuples: OHLCV[] = object1m.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  const expected = resampleOhlcv(tuples, { baseTimeframe: 60, newTimeframe: 300 });
  const actual = await collectAsync(resampleOhlcvAsync(asAsync(tuples), {
    baseTimeframe: 60,
    newTimeframe: 300,
    map: { time: 'timestamp' },
  }));
  expect(actual).toEqual(expected);
});

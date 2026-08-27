import type { IOHLCV, OHLCV, TradeTick } from './types.js';

/**
 * A per-record field map. Applied to a single input record (one row/object)
 * to produce canonical OHLCV, so it works uniformly across any named-schema
 * input: Parquet rows, CSV header rows, JSON objects.
 *
 * Two shapes are accepted:
 *  - Record form: keys are canonical IOHLCV fields, values are the keys to
 *    read from the input record. Fields absent from the map use the canonical
 *    key directly (e.g. `{ time: 'timestamp' }` reads `record.timestamp` for
 *    time and `record.open`/`high`/... for the rest).
 *  - Function form: a full transform `(record) => IOHLCV`, giving complete
 *    control over extraction.
 */
export type OhlcvFieldMap = Partial<Record<keyof IOHLCV, string>>;
export type OhlcvMapper = (record: Record<string, unknown>) => IOHLCV;
export type OhlcvMap = OhlcvFieldMap | OhlcvMapper;

/** Same concept for trade-tick records (time/price/quantity). */
export type TickFieldMap = Partial<Record<keyof TradeTick, string>>;
export type TickMapper = (record: Record<string, unknown>) => TradeTick;
export type TickMap = TickFieldMap | TickMapper;

const num = (v: unknown): number => Number(v);

/** Extract canonical IOHLCV from one record using an optional per-record map. */
export function mapToOhlcv(record: Record<string, unknown>, map?: OhlcvMap): IOHLCV {
  if (typeof map === 'function') return map(record);
  if (map) {
    return {
      time: num(record[map.time ?? 'time']),
      open: num(record[map.open ?? 'open']),
      high: num(record[map.high ?? 'high']),
      low: num(record[map.low ?? 'low']),
      close: num(record[map.close ?? 'close']),
      volume: num(record[map.volume ?? 'volume']),
    };
  }
  return {
    time: num(record.time),
    open: num(record.open),
    high: num(record.high),
    low: num(record.low),
    close: num(record.close),
    volume: num(record.volume),
  };
}

/** Extract a canonical trade tick from one record using an optional map. */
export function mapToTick(record: Record<string, unknown>, map?: TickMap): TradeTick {
  if (typeof map === 'function') return map(record);
  if (map) {
    return {
      time: num(record[map.time ?? 'time']),
      price: num(record[map.price ?? 'price']),
      quantity: num(record[map.quantity ?? 'quantity']),
    };
  }
  return {
    time: num(record.time),
    price: num(record.price),
    quantity: num(record.quantity),
  };
}

/**
 * Wrap an async iterable of OHLCV records, applying `map` to every object
 * item. Tuple items (already canonical, no keys to map) pass through
 * unchanged. Used by the async resamplers for object-shaped AsyncIterable
 * input (e.g. CCXT-style streams where keys are `timestamp`/`amount`).
 */
export async function* mapOhlcvIterable(
  src: AsyncIterable<OHLCV | IOHLCV>,
  map: OhlcvMap,
): AsyncGenerator<OHLCV | IOHLCV> {
  for await (const item of src) {
    if (Array.isArray(item)) yield item;
    else yield mapToOhlcv(item as Record<string, unknown>, map);
  }
}

/** Wrap an async iterable of trade ticks, applying `map` to every tick. */
export async function* mapTickIterable(
  src: AsyncIterable<TradeTick>,
  map: TickMap,
): AsyncGenerator<TradeTick> {
  for await (const tick of src) yield mapToTick(tick as Record<string, unknown>, map);
}

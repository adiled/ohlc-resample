import type { AsyncBuffer, FileMetaData, ParquetReadOptions, ParquetParsers, RowGroup } from 'hyparquet';
import { asyncBufferFromFile, parquetMetadataAsync, parquetRead } from 'hyparquet';
import type { OHLCV, TradeTick } from './types.js';
import { mapToOhlcv, mapToTick } from './map.js';
import type { OhlcvMap, TickMap } from './map.js';

/**
 * Override hyparquet's default parsers so timestamp columns come back as raw
 * epoch-millisecond numbers instead of `Date` objects. The library pipeline
 * (bucket math, `outOfOrderMs` healing) works on plain ms numbers.
 */
const PARSERS: Partial<ParquetParsers> = {
  timestampFromMilliseconds: (millis) => Number(millis),
  timestampFromMicroseconds: (micros) => Number(micros) / 1000,
  timestampFromNanoseconds: (nanos) => Number(nanos) / 1_000_000,
  dateFromDays: (days) => Number(days) * 86_400_000,
};

/**
 * Decode one row-group slice of the requested columns into rows.
 * `columns` are the exact column names to project (already validated).
 */
function readRows(
  buffer: AsyncBuffer,
  metadata: FileMetaData,
  columns: string[],
  rowStart: number,
  rowEnd: number,
  rowFormat: 'array' | 'object',
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const options: ParquetReadOptions = {
      file: buffer,
      metadata,
      columns,
      rowStart,
      rowEnd,
      rowFormat,
      parsers: PARSERS as ParquetParsers,
      onComplete: resolve,
    };
    // parquetRead returns a void promise that rejects with read errors; rows
    // are delivered through onComplete.
    parquetRead(options).catch(reject);
  });
}

/** Throw if `col` is not present in the schema's column names. */
function requireColumn(names: string[], col: string): void {
  if (!names.includes(col)) {
    throw new Error(`Parquet file is missing required column "${col}"`);
  }
}

/**
 * Yield OHLCV tuples from a Parquet file, one row at a time, reading a single
 * row group into memory at a time (bounded by the largest row group).
 *
 * Columns are read by exact canonical name (`time`, `open`, `high`, `low`,
 * `close`, `volume`); `volume` may be omitted (filled with 0). Any other
 * column layout must be supplied via a per-record `map` (Record or function
 * form, see `map.ts`): the map decides exactly which keys to read from each
 * row. Timestamps in any unit are converted to ms.
 *
 * @param file Path to a Parquet file.
 * @param map Optional per-record field map.
 */
export async function* parquetOhlcvRowsAsync(
  file: string,
  map?: OhlcvMap,
): AsyncGenerator<OHLCV> {
  const buffer = await asyncBufferFromFile(file);
  const metadata = await parquetMetadataAsync(buffer, { parsers: PARSERS as ParquetParsers });
  const names = metadata.schema.filter(e => e.type).map(e => e.name);

  // Function map: the function may touch any field, so read every column as
  // object rows and let it extract.
  if (typeof map === 'function') {
    const columns = names;
    let rowStart = 0;
    for (const group of metadata.row_groups as RowGroup[]) {
      const groupRows = Number(group.num_rows);
      if (groupRows <= 0) continue;
      const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows, 'object');
      for (const row of rows as Record<string, unknown>[]) {
        const c = map(row);
        yield [c.time, c.open, c.high, c.low, c.close, c.volume] as OHLCV;
      }
      rowStart += groupRows;
    }
    return;
  }

  // Record map: project exactly the source keys the map references, rebuild a
  // record keyed by them, then mapToOhlcv. Fields absent from the map use the
  // canonical key, so their column must be named canonically.
  if (map) {
    const columns = resolveMappedColumns(names, OHLCV_FIELDS, map as Record<string, string>);
    let rowStart = 0;
    for (const group of metadata.row_groups as RowGroup[]) {
      const groupRows = Number(group.num_rows);
      if (groupRows <= 0) continue;
      const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows, 'array');
      for (const row of rows as unknown[][]) {
        const record: Record<string, unknown> = {};
        columns.forEach((c, i) => { record[c] = row[i]; });
        const c = mapToOhlcv(record, map);
        yield [c.time, c.open, c.high, c.low, c.close, c.volume] as OHLCV;
      }
      rowStart += groupRows;
    }
    return;
  }

  // No map: exact canonical columns only (no aliasing).
  const required = ['time', 'open', 'high', 'low', 'close'] as const;
  const hasVolume = names.includes('volume');
  for (const col of required) requireColumn(names, col);
  const columns = hasVolume
    ? [...required, 'volume']
    : [...required];

  let rowStart = 0;
  for (const group of metadata.row_groups as RowGroup[]) {
    const groupRows = Number(group.num_rows);
    if (groupRows <= 0) continue;
    const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows, 'array');
    for (const row of rows as unknown[][]) {
      if (hasVolume) {
        yield [row[0], row[1], row[2], row[3], row[4], row[5]] as OHLCV;
      } else {
        yield [row[0], row[1], row[2], row[3], row[4], 0] as OHLCV;
      }
    }
    rowStart += groupRows;
  }
}

/**
 * Yield trade ticks from a Parquet file (time/price/quantity), one row at a
 * time, reading one row group at a time. Timestamps are converted to ms.
 *
 * Columns are read by exact canonical name (`time`, `price`, `quantity`). Any
 * other layout must be supplied via a per-record `map`.
 *
 * @param file Path to a Parquet file.
 * @param map Optional per-record field map.
 */
export async function* parquetTicksAsync(
  file: string,
  map?: TickMap,
): AsyncGenerator<TradeTick> {
  const buffer = await asyncBufferFromFile(file);
  const metadata = await parquetMetadataAsync(buffer, { parsers: PARSERS as ParquetParsers });
  const names = metadata.schema.filter(e => e.type).map(e => e.name);

  if (typeof map === 'function') {
    const columns = names;
    let rowStart = 0;
    for (const group of metadata.row_groups as RowGroup[]) {
      const groupRows = Number(group.num_rows);
      if (groupRows <= 0) continue;
      const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows, 'object');
      for (const row of rows as Record<string, unknown>[]) {
        const t = map(row);
        yield { time: t.time, price: t.price, quantity: t.quantity } as TradeTick;
      }
      rowStart += groupRows;
    }
    return;
  }

  if (map) {
    const columns = resolveMappedColumns(names, TICK_FIELDS, map as Record<string, string>);
    let rowStart = 0;
    for (const group of metadata.row_groups as RowGroup[]) {
      const groupRows = Number(group.num_rows);
      if (groupRows <= 0) continue;
      const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows, 'array');
      for (const row of rows as unknown[][]) {
        const record: Record<string, unknown> = {};
        columns.forEach((c, i) => { record[c] = row[i]; });
        const t = mapToTick(record, map);
        yield { time: t.time, price: t.price, quantity: t.quantity } as TradeTick;
      }
      rowStart += groupRows;
    }
    return;
  }

  // No map: exact canonical columns only (no aliasing).
  const required = ['time', 'price', 'quantity'] as const;
  for (const col of required) requireColumn(names, col);
  const columns = [...required];

  let rowStart = 0;
  for (const group of metadata.row_groups as RowGroup[]) {
    const groupRows = Number(group.num_rows);
    if (groupRows <= 0) continue;
    const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows, 'array');
    for (const row of rows as unknown[][]) {
      yield { time: row[0], price: row[1], quantity: row[2] } as TradeTick;
    }
    rowStart += groupRows;
  }
}

/** Canonical OHLCV fields, used to validate a Record map. */
const OHLCV_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;

/** Canonical tick fields. */
const TICK_FIELDS = ['time', 'price', 'quantity'] as const;

/**
 * Validate that every source key a Record map references exists in the schema,
 * then return the columns to project (map value, canonical key otherwise).
 */
function resolveMappedColumns(
  names: string[],
  fields: readonly string[],
  map: Record<string, string>,
): string[] {
  const columns: string[] = [];
  for (const field of fields) {
    const key = map[field] ?? field;
    requireColumn(names, key);
    columns.push(key);
  }
  return columns;
}

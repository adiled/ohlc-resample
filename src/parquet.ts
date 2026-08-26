import type { AsyncBuffer, FileMetaData, ParquetReadOptions, ParquetParsers, RowGroup } from 'hyparquet';
import { asyncBufferFromFile, parquetMetadataAsync, parquetRead } from 'hyparquet';
import type { OHLCV, TradeTick } from './types.js';

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

const OHLCV_ALIASES = {
  time: ['time', 'timestamp', 'ts', 'date', 'datetime', 'start', 'opentime', 'open_time'],
  open: ['open', 'o', 'op'],
  high: ['high', 'h', 'hi'],
  low: ['low', 'l', 'lo'],
  close: ['close', 'c', 'last', 'lastprice'],
  volume: ['volume', 'vol', 'amount', 'qty', 'quantity', 'v', 'size'],
} as const;

const TICK_ALIASES = {
  time: ['time', 'timestamp', 'ts', 'date', 'datetime'],
  price: ['price', 'p', 'last'],
  quantity: ['quantity', 'qty', 'amount', 'volume', 'v', 'size'],
} as const;

/** Normalize a column name for alias matching: lowercase, drop spaces/_/-. */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Find the first schema column whose normalized name matches one of the
 * aliases. Returns the actual (raw) column name for `parquetRead` projection.
 *
 * @throws if a required field has no matching column.
 */
function resolveColumn(
  names: string[],
  aliases: readonly string[],
  field: string,
  required: boolean,
): string | null {
  for (const name of names) {
    if (aliases.includes(normalize(name))) return name;
  }
  if (required) {
    throw new Error(
      `Parquet file is missing required column "${field}" (expected one of: ${aliases.join(', ')})`,
    );
  }
  return null;
}

/** Decode one row-group slice of the requested columns into arrays of rows. */
function readRows(
  buffer: AsyncBuffer,
  metadata: FileMetaData,
  columns: string[],
  rowStart: number,
  rowEnd: number,
): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const options: ParquetReadOptions = {
      file: buffer,
      metadata,
      columns,
      rowStart,
      rowEnd,
      rowFormat: 'array',
      parsers: PARSERS as ParquetParsers,
      onComplete: resolve,
    };
    // parquetRead returns a void promise that rejects with read errors; rows
    // are delivered through onComplete.
    parquetRead(options).catch(reject);
  });
}

/**
 * Yield OHLCV tuples from a Parquet file, one row at a time, reading a single
 * row group into memory at a time (bounded by the largest row group). Column
 * names are matched loosely by alias, so `timestamp`/`ts`, `o`/`open`,
 * `vol`/`volume`, etc. all work. Timestamps in any unit are converted to ms.
 *
 * @param file Path to a Parquet file.
 */
export async function* parquetOhlcvRowsAsync(file: string): AsyncGenerator<OHLCV> {
  const buffer = await asyncBufferFromFile(file);
  const metadata = await parquetMetadataAsync(buffer, { parsers: PARSERS as ParquetParsers });

  const names = metadata.schema.filter(e => e.type).map(e => e.name);
  const timeCol = resolveColumn(names, OHLCV_ALIASES.time, 'time', true)!;
  const openCol = resolveColumn(names, OHLCV_ALIASES.open, 'open', true)!;
  const highCol = resolveColumn(names, OHLCV_ALIASES.high, 'high', true)!;
  const lowCol = resolveColumn(names, OHLCV_ALIASES.low, 'low', true)!;
  const closeCol = resolveColumn(names, OHLCV_ALIASES.close, 'close', true)!;
  const volumeCol = resolveColumn(names, OHLCV_ALIASES.volume, 'volume', false);

  const columns = volumeCol
    ? [timeCol, openCol, highCol, lowCol, closeCol, volumeCol]
    : [timeCol, openCol, highCol, lowCol, closeCol];

  let rowStart = 0;
  for (const group of metadata.row_groups as RowGroup[]) {
    const groupRows = Number(group.num_rows);
    if (groupRows <= 0) continue;
    const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows);
    for (const row of rows as unknown[][]) {
      if (volumeCol) {
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
 * @param file Path to a Parquet file.
 */
export async function* parquetTicksAsync(file: string): AsyncGenerator<TradeTick> {
  const buffer = await asyncBufferFromFile(file);
  const metadata = await parquetMetadataAsync(buffer, { parsers: PARSERS as ParquetParsers });

  const names = metadata.schema.filter(e => e.type).map(e => e.name);
  const timeCol = resolveColumn(names, TICK_ALIASES.time, 'time', true)!;
  const priceCol = resolveColumn(names, TICK_ALIASES.price, 'price', true)!;
  const qtyCol = resolveColumn(names, TICK_ALIASES.quantity, 'quantity', true)!;

  const columns = [timeCol, priceCol, qtyCol];

  let rowStart = 0;
  for (const group of metadata.row_groups as RowGroup[]) {
    const groupRows = Number(group.num_rows);
    if (groupRows <= 0) continue;
    const rows = await readRows(buffer, metadata, columns, rowStart, rowStart + groupRows);
    for (const row of rows as unknown[][]) {
      yield { time: row[0] as number, price: row[1] as number, quantity: row[2] as number };
    }
    rowStart += groupRows;
  }
}

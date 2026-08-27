#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { createRequire } from 'module';
import { fileURLToPath } from 'node:url';
import mri from 'mri';import { IOHLCV, OHLCV } from './types.js';
import { resampleOhlcv, resampleOhlcvAsync } from './lib.js';
import { mapToOhlcv } from './map.js';
import type { OhlcvFieldMap, OhlcvMap } from './map.js';

// Read version from package.json so there's a single source of truth.
// `dist/cli.js` is one level deep; `../package.json` resolves to the
// installed package's manifest both during dev and post-install.
const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

type Shape = 'object' | 'array';
type InputFormat = 'csv' | 'json' | 'jsonl';
type InputFormatOption = InputFormat | 'auto';
type ShapeOption = Shape | 'auto';
type OutputFormat = 'csv' | 'json' | 'jsonl';

const REQUIRED_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;

/**
 * Parse a CSV string of OHLCV rows into `IOHLCV[]`. Without a map, accepts an
 * optional header row matching the canonical field order and otherwise treats
 * the first line as data. With a map (Record form), the first line is always
 * treated as the header and each row is mapped per-record via `mapToOhlcv`.
 * Malformed rows (wrong column count, missing values, or non-numeric cells)
 * are skipped and counted in `skipped`.
 *
 * @throws if the input is empty.
 */
export function parseCSV(data: string, map?: OhlcvMap): { rows: IOHLCV[]; skipped: number } {
  const trimmed = data.trim();
  if (!trimmed) {
    throw new Error('Error: CSV must have at least one row');
  }
  const lines = trimmed.split('\n');

  const firstLine = lines[0].trim().split(',').map(h => h.trim());
  let hasHeader: boolean;
  let headers: readonly string[];
  let startIndex: number;
  if (map) {
    hasHeader = true;
    headers = firstLine;
    startIndex = 1;
  } else {
    hasHeader = REQUIRED_FIELDS.every((f, i) => firstLine[i] === f);
    headers = hasHeader ? firstLine : (REQUIRED_FIELDS as readonly string[]);
    startIndex = hasHeader ? 1 : 0;
  }

  const rows: IOHLCV[] = [];
  let skipped = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',').map(v => v.trim());
    if (values.length !== headers.length) { skipped++; continue; }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = values[index]; });

    if (map) {
      const candle = mapToOhlcv(row, map);
      if (!REQUIRED_FIELDS.every(f => Number.isFinite(Number(candle[f])))) {
        skipped++;
        continue;
      }
      rows.push(candle);
      continue;
    }

    if (REQUIRED_FIELDS.some(f => row[f] === undefined || row[f] === '')) {
      skipped++;
      continue;
    }
    if (REQUIRED_FIELDS.some(f => isNaN(Number(row[f])))) {
      skipped++;
      continue;
    }
    rows.push({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    });
  }
  return { rows, skipped };
}

/**
 * Parse a single CSV data line into an `IOHLCV` given the header order, or
 * return `null` for malformed rows. With a map, the row is mapped per-record.
 */
function parseCSVLine(line: string, headers: readonly string[], map?: OhlcvMap): IOHLCV | null {
  const values = line.split(',').map(v => v.trim());
  if (values.length !== headers.length) return null;

  const row: Record<string, string> = {};
  headers.forEach((header, index) => { row[header] = values[index]; });

  if (map) {
    const candle = mapToOhlcv(row, map);
    return REQUIRED_FIELDS.every(f => Number.isFinite(Number(candle[f]))) ? candle : null;
  }

  if (REQUIRED_FIELDS.some(f => row[f] === undefined || row[f] === '')) return null;
  if (REQUIRED_FIELDS.some(f => isNaN(Number(row[f])))) return null;
  return {
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

/** Parse a single JSONL line into an OHLCV tuple or IOHLCV object, or null. */
function parseJSONLLine(line: string, map?: OhlcvMap): OHLCV | IOHLCV | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    if (parsed.length !== 6) return null;
    if (parsed.some(v => isNaN(Number(v)))) return null;
    return parsed as OHLCV;
  }
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (map) {
      const candle = mapToOhlcv(o, map);
      return REQUIRED_FIELDS.every(f => Number.isFinite(Number(candle[f]))) ? candle : null;
    }
    if (!REQUIRED_FIELDS.every(f => o[f] !== undefined && o[f] !== '' && !isNaN(Number(o[f])))) {
      return null;
    }
    return {
      time: Number(o.time), open: Number(o.open), high: Number(o.high),
      low: Number(o.low), close: Number(o.close), volume: Number(o.volume),
    };
  }
  return null;
}

/**
 * Detect whether a string is JSON (array of objects or array of tuples) or
 * CSV. JSON detection requires the value to parse and be an array.
 *
 * @throws if neither format is recognized.
 */
export function detectFormat(data: string): InputFormat {
  const trimmed = data.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return 'json';
  } catch { /* fall through */ }
  const firstLine = trimmed.split('\n')[0];
  if ((firstLine.match(/,/g) || []).length === 5) return 'csv';
  throw new Error('Could not detect input format. Please specify --input-format');
}

/** Detect whether a parsed JSON payload is tuple- or object-shaped. */
function detectShape(data: unknown[]): Shape {
  return data.length > 0 && Array.isArray(data[0]) ? 'array' : 'object';
}

const toObjectShape = (data: OHLCV[] | IOHLCV[]): IOHLCV[] => {
  if (data.length > 0 && Array.isArray(data[0])) {
    return (data as OHLCV[]).map(([time, open, high, low, close, volume]) => ({
      time, open, high, low, close, volume,
    }));
  }
  return data as IOHLCV[];
};

const toArrayShape = (data: OHLCV[] | IOHLCV[]): OHLCV[] => {
  if (data.length > 0 && !Array.isArray(data[0])) {
    return (data as IOHLCV[]).map(({ time, open, high, low, close, volume }) =>
      [time, open, high, low, close, volume] as OHLCV);
  }
  return data as OHLCV[];
};

/** Render OHLCV data as CSV text (with header). */
function formatCSV(data: OHLCV[] | IOHLCV[]): string {
  const rows = toArrayShape(data);
  const lines = ['time,open,high,low,close,volume'];
  for (const row of rows) lines.push(row.join(','));
  return lines.join('\n');
}

/** Render OHLCV data as JSON text in the requested shape. */
function formatJSON(data: OHLCV[] | IOHLCV[], shape: Shape): string {
  const out = shape === 'array' ? toArrayShape(data) : toObjectShape(data);
  return JSON.stringify(out, null, 2);
}

/** Render OHLCV data as JSONL (one candle per line). */
function formatJSONL(data: OHLCV[] | IOHLCV[], shape: Shape): string {
  const out = shape === 'array' ? toArrayShape(data) : toObjectShape(data);
  return out.map(c => JSON.stringify(c)).join('\n');
}

function prefixError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(msg.startsWith('Error:') ? msg : `Error: ${msg}`);
}

interface ParsedInput {
  data: IOHLCV[] | OHLCV[];
  shape: Shape;
}

function parseInput(raw: string, format: InputFormat, map?: OhlcvMap): ParsedInput {
  if (format === 'csv') {
    const { rows, skipped } = parseCSV(raw, map);
    if (rows.length === 0) {
      throw new Error('Error: no valid OHLCV rows found in input');
    }
    return { data: rows, shape: 'object' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw prefixError(err);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Error: JSON input must be a non-empty array of OHLCV records');
  }
  const shape = detectShape(parsed);
  // With a map, remap object-shaped records per-record; tuple arrays have no
  // keys to map and pass through unchanged.
  if (map && shape === 'object') {
    parsed = (parsed as IOHLCV[]).map(o => mapToOhlcv(o as Record<string, unknown>, map)) as unknown;
  }
  return { data: parsed as IOHLCV[] | OHLCV[], shape };
}

/**
 * Yield non-empty lines from a readable stream, one at a time, without
 * buffering the whole input. This is the large-file streaming backbone.
 */
async function* lineReader(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

/**
 * Yield parsed OHLCV objects from a CSV line stream. Without a map, detects
 * the canonical header on the first non-empty line; with a map, the first
 * non-empty line is always treated as the header and rows are mapped per
 * record. Malformed rows are counted via `onSkipped`.
 */
async function* csvCandleReader(
  lines: AsyncGenerator<string>,
  onSkipped: () => void,
  map?: OhlcvMap,
): AsyncGenerator<IOHLCV> {
  let headers = REQUIRED_FIELDS as readonly string[];
  let headerSeen = false;
  let started = false;
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!started) {
      const first = trimmed.split(',').map(h => h.trim());
      if (map) {
        headers = first as readonly string[];
        headerSeen = true;
      } else if (REQUIRED_FIELDS.every((f, i) => first[i] === f)) {
        headerSeen = true;
        headers = first as readonly string[];
      }
      started = true;
      if (headerSeen) continue;
    }
    const candle = parseCSVLine(trimmed, headers, map);
    if (candle === null) { onSkipped(); continue; }
    yield candle;
  }
}

/**
 * Yield parsed OHLCV candles from a JSONL line stream (one JSON record per
 * line). With a map, object records are remapped per-record; tuples pass
 * through unchanged. Malformed lines are counted via `onSkipped`.
 */
async function* jsonlCandleReader(
  lines: AsyncGenerator<string>,
  onSkipped: () => void,
  map?: OhlcvMap,
): AsyncGenerator<OHLCV | IOHLCV> {
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const candle = parseJSONLLine(trimmed, map);
    if (candle === null) { onSkipped(); continue; }
    yield candle;
  }
}

/**
 * Incrementally write resampled candles in CSV / JSON / JSONL, emitting a
 * well-formed document that a consumer can parse as it streams.
 */
class IncrementalWriter {
  private first = true;
  constructor(
    private readonly format: OutputFormat,
    private readonly shape: Shape,
    private readonly stream: NodeJS.WritableStream,
  ) {
    if (format === 'csv') {
      stream.write('time,open,high,low,close,volume\n');
    } else if (format === 'json') {
      stream.write('[\n');
    }
  }

  async writeCandle(candle: OHLCV | IOHLCV): Promise<void> {
    // CSV rows are always the 6-tuple shape regardless of the requested JSON
    // shape, so force array shape for CSV output.
    const shaped = this.format === 'csv'
      ? toArrayShape([candle] as OHLCV[])[0]
      : this.shape === 'array'
        ? toArrayShape([candle] as OHLCV[])[0]
        : toObjectShape([candle] as IOHLCV[])[0];
    let text: string;
    if (this.format === 'csv') {
      text = (shaped as OHLCV).join(',') + '\n';
    } else if (this.format === 'jsonl') {
      text = JSON.stringify(shaped) + '\n';
    } else {
      text = (this.first ? '  ' : ',\n  ') + JSON.stringify(shaped);
      this.first = false;
    }
    await writeChunk(this.stream, text);
  }

  async close(): Promise<void> {
    if (this.format === 'json') {
      await writeChunk(this.stream, '\n]');
    }
  }
}

function writeChunk(stream: NodeJS.WritableStream, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(data, (err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

/**
 * Stream a readable source of CSV/JSONL candles through the async resampler,
 * writing output incrementally. Memory use is bounded by the resampler's
 * active-bucket window — never the whole input.
 */
async function runStreaming(
  source: NodeJS.ReadableStream,
  isCsv: boolean,
  options: { baseTimeframe: number; newTimeframe: number; format: OutputFormat; shape: ShapeOption; map?: OhlcvMap },
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
  outputPath?: string,
): Promise<void> {
  const lines = lineReader(source);
  let skipped = 0;
  const candleSource = isCsv
    ? csvCandleReader(lines, () => skipped++, options.map)
    : jsonlCandleReader(lines, () => skipped++, options.map);

  // The readers already applied the per-record map, so the resampler receives
  // canonical candles and no further mapping is needed.
  const iter = resampleOhlcvAsync(candleSource as AsyncIterable<OHLCV | IOHLCV>, { baseTimeframe: options.baseTimeframe, newTimeframe: options.newTimeframe });

  await writeResampledStream(iter, options.format, options.shape, stdout, outputPath);
  if (skipped > 0) stderr.write(`Warning: skipped ${skipped} malformed input row(s)\n`);
}

/**
 * Consume a resampler async generator and write each candle incrementally.
 * Detects the input shape from the first value (tuples vs objects) unless an
 * explicit output shape is requested. Shared by the line-based streaming path
 * (CSV/JSONL) and the Parquet path.
 */
async function writeResampledStream(
  iter: AsyncGenerator<OHLCV | IOHLCV>,
  format: OutputFormat,
  shapeOption: ShapeOption,
  stdout: NodeJS.WritableStream,
  outputPath?: string,
): Promise<void> {
  let first: IteratorResult<OHLCV | IOHLCV>;
  try {
    first = await iter.next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('input OHLCV data has no candles')) {
      throw new Error('Error: no valid OHLCV rows found in input');
    }
    throw prefixError(err);
  }
  if (first.done) {
    throw new Error('Error: no valid OHLCV rows found in input');
  }

  const inputShape: Shape = Array.isArray(first.value) ? 'array' : 'object';
  const outputShape: Shape = shapeOption === 'auto' ? inputShape : shapeOption;

  const outStream = outputPath ? fs.createWriteStream(outputPath) : stdout;
  const writer = new IncrementalWriter(format, outputShape, outStream);

  try {
    await writer.writeCandle(first.value);
    for await (const candle of iter) {
      await writer.writeCandle(candle);
    }
    await writer.close();
  } catch (err) {
    throw prefixError(err);
  }
}

/**
 * Parse the `--map` flag (Record form only; a mapping function can't be a CLI
 * arg) into an `OhlcvFieldMap`. Format: `field=sourceKey` entries separated by
 * commas, e.g. `time=timestamp,close=cl,volume=vol`.
 */
function parseMapFlag(value: string | undefined): OhlcvMap | undefined {
  if (!value) return undefined;
  const valid = new Set(['time', 'open', 'high', 'low', 'close', 'volume']);
  const map: OhlcvFieldMap = {};
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      throw new Error(`Invalid --map entry "${part.trim()}" (expected field=sourceKey)`);
    }
    const field = part.slice(0, eq).trim();
    const key = part.slice(eq + 1).trim();
    if (!key) {
      throw new Error(`Invalid --map entry "${part.trim()}" (empty source key)`);
    }
    if (!valid.has(field)) {
      throw new Error(
        `Unknown --map field "${field}" (expected one of: time, open, high, low, close, volume)`,
      );
    }
    map[field as keyof IOHLCV] = key;
  }
  return map;
}

const KNOWN_FLAGS = new Set([
  'input', 'i', 'output', 'o', 'format', 'f', 'input-format',
  'shape', 's', 'base-timeframe', 'b', 'new-timeframe', 'n',
  'map', 'help', 'h', 'version', 'V',
]);

const HELP = `Usage: ohlc-resample [options]

Resample OHLCV between timeframes and file formats

Options:
  -V, --version                output the version number
  -i, --input <path>           Input file path (csv, json, jsonl, parquet) or use pipe
  -o, --output <path>          Output file path (csv, json, jsonl) or use stdout
  -f, --format <fmt>           Output format (csv, json, jsonl) (default: "json")
      --input-format <fmt>     Input format when piping (csv, json, jsonl, auto) (default: "auto")
  -s, --shape <shape>          Output shape for JSON (object, array, auto) (default: "auto")
  -b, --base-timeframe <number> Base timeframe in seconds (default: "60")
  -n, --new-timeframe <number> New timeframe in seconds (default: "300")
      --map <mapping>          Map record fields to canonical keys (e.g. time=timestamp,close=cl,volume=vol)
  -h, --help                   display help for command\n`;

// Tiny arg parser (mri). Unlike commander, mri is silent about unknown
// flags and positional args, so we detect those ourselves against a fixed
// known set. All values are kept as strings so `parseInt`/validation below
// behaves exactly as before.
//
// NOTE: mri **mutates the config objects passed to it** (alias/default maps
// get consumed and reverse-mapped in place), so every config must be built
// fresh per call — never share module-level constants.
function parseArgs(argv: string[]) {
  const flags = mri(argv.slice(2), {
    alias: {
      i: 'input', o: 'output', f: 'format', s: 'shape',
      b: 'base-timeframe', n: 'new-timeframe', h: 'help', V: 'version',
    },
    default: {
      format: 'json',
      'input-format': 'auto',
      shape: 'auto',
      'base-timeframe': '60',
      'new-timeframe': '300',
    },
    string: [
      'input', 'output', 'format', 'input-format', 'shape',
      'base-timeframe', 'new-timeframe', 'map',
    ],
    boolean: ['help', 'version'],
  });
  const unknown = Object.keys(flags).filter(k => k !== '_' && !KNOWN_FLAGS.has(k));
  if (unknown.length > 0) {
    throw new Error(`unknown option: ${unknown[0].startsWith('-') ? '' : '--'}${unknown[0]}`);
  }
  if (flags._.length > 0) {
    throw new Error(`unexpected argument: ${flags._[0]}`);
  }
  return flags;
}

/**
 * Run the OHLCV resampling CLI. Streams and TTY flag are injectable for
 * testing.
 */
export async function runCli(
  argv: string[],
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let options: any;
  try {
    const flags = parseArgs(argv);
    if (flags.help) {
      stdout.write(HELP);
      return;
    }
    if (flags.version) {
      stdout.write(PACKAGE_VERSION + '\n');
      return;
    }
    options = {
      input: flags.input,
      output: flags.output,
      format: flags.format,
      inputFormat: flags['input-format'],
      shape: flags.shape,
      baseTimeframe: flags['base-timeframe'],
      newTimeframe: flags['new-timeframe'],
      map: flags.map,
    };
  } catch (error: unknown) {
    stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
    return;
  }

  async function readJsonFileData(filePath: string, map?: OhlcvMap): Promise<ParsedInput> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(path.resolve(filePath), 'utf8');
    } catch (err) {
      throw prefixError(err);
    }
    return parseInput(raw, 'json', map);
  }

  async function readPipeData(stream: NodeJS.ReadableStream, map?: OhlcvMap): Promise<ParsedInput> {
    const raw = await new Promise<string>((resolve, reject) => {
      let buf = '';
      stream.on('data', chunk => { buf += chunk; });
      stream.on('end', () => resolve(buf));
      stream.on('error', err => reject(prefixError(err)));
    });
    const requested = options.inputFormat as InputFormatOption;
    const format: InputFormat = requested === 'auto' ? detectFormat(raw) : requested;
    const parsed = parseInput(raw, format, map);
    if (format === 'csv') {
      const { skipped } = parseCSV(raw, map);
      if (skipped > 0) stderr.write(`Warning: skipped ${skipped} malformed CSV row(s)\n`);
    }
    return parsed;
  }

  async function writeOutput(
    data: OHLCV[] | IOHLCV[],
    format: OutputFormat,
    shape: Shape,
    outputPath: string | undefined,
  ): Promise<void> {
    const text = format === 'csv'
      ? formatCSV(data)
      : format === 'jsonl'
        ? formatJSONL(data, shape)
        : formatJSON(data, shape);
    if (outputPath) {
      await fs.promises.writeFile(outputPath, text);
      return;
    }
    await writeChunk(stdout, text);
  }

  try {
    const baseTimeframe = parseInt(options.baseTimeframe, 10);
    const newTimeframe = parseInt(options.newTimeframe, 10);
    if (isNaN(baseTimeframe) || isNaN(newTimeframe)) {
      throw new Error('Timeframes must be valid numbers');
    }
    if (newTimeframe <= baseTimeframe) {
      throw new Error('New timeframe must be greater than base timeframe');
    }
    const outputFormat = options.format as OutputFormat;
    const map = parseMapFlag(options.map as string | undefined);

    const input = options.input as string | undefined;
    if (input) {
      const ext = path.extname(input).slice(1).toLowerCase();
      if (!['csv', 'json', 'jsonl', 'ndjson', 'parquet'].includes(ext)) {
        throw new Error('Only CSV, JSON, and Parquet files are accepted as input');
      }
      // Large-file streaming path: CSV / JSONL are read line-by-line and fed
      // through the async resampler, so memory never scales with file size.
      if (ext === 'csv' || ext === 'jsonl' || ext === 'ndjson') {
        try {
          await fs.promises.stat(path.resolve(input));
        } catch (err) {
          throw prefixError(err);
        }
        const source = fs.createReadStream(path.resolve(input), { encoding: 'utf8' });
        await runStreaming(
          source,
          ext === 'csv',
          {
            baseTimeframe,
            newTimeframe,
            format: outputFormat,
            shape: options.shape as ShapeOption,
            map,
          },
          stdout,
          stderr,
          options.output,
        );
        return;
      }
      // Parquet files are read row-group-by-row-group through the async
      // resampler (hyparquet), so memory is bounded by the largest row group.
      if (ext === 'parquet') {
        try {
          await fs.promises.stat(path.resolve(input));
        } catch (err) {
          throw prefixError(err);
        }
        const iter = resampleOhlcvAsync(input, { baseTimeframe, newTimeframe, map });
        await writeResampledStream(
          iter,
          outputFormat,
          options.shape as ShapeOption,
          stdout,
          options.output,
        );
        return;
      }
      // JSON array files stay buffer-based (documented limitation): a JSON
      // document must be fully parsed to know where the array ends.
      const parsed = await readJsonFileData(input, map);
      const outputShape: Shape = options.shape === 'auto' ? parsed.shape : options.shape;
      const resampled = resampleOhlcv(parsed.data as IOHLCV[], { baseTimeframe, newTimeframe });
      await writeOutput(resampled, outputFormat, outputShape, options.output);
      return;
    }

    // Pipe input. Default stays buffer-based for JSON/CSV arrays; explicit
    // `--input-format jsonl` opts into streaming line-by-line.
    const requestedFormat = options.inputFormat as InputFormatOption;
    if (requestedFormat === 'jsonl') {
      await runStreaming(
        stdin,
        false,
        {
          baseTimeframe,
          newTimeframe,
          format: outputFormat,
          shape: options.shape as ShapeOption,
          map,
        },
        stdout,
        stderr,
        options.output,
      );
      return;
    }

    const parsed = await readPipeData(stdin, map);
    const outputShape: Shape = options.shape === 'auto' ? parsed.shape : options.shape;
    const resampled = resampleOhlcv(parsed.data as IOHLCV[], { baseTimeframe, newTimeframe });
    await writeOutput(resampled, outputFormat, outputShape, options.output);
  } catch (error: unknown) {
    stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}

// ESM equivalent of `require.main === module`: run the CLI only when this
// file is executed directly (e.g. `node dist/cli.js`), never when imported.
const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  process.on('SIGINT', () => process.exit());
  process.on('SIGTERM', () => process.exit());
  runCli(process.argv);
}

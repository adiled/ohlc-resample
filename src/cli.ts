#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { program as commanderProgram } from 'commander';
import { IOHLCV, OHLCV } from './types';
import { resampleOhlcv } from './lib';

// Read version from package.json so there's a single source of truth.
// `dist/cli.js` is one level deep; `../package.json` resolves to the
// installed package's manifest both during dev and post-install.
const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

type Shape = 'object' | 'array';
type InputFormat = 'csv' | 'json';
type InputFormatOption = InputFormat | 'auto';
type ShapeOption = Shape | 'auto';

const REQUIRED_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;

/**
 * Parse a CSV string of OHLCV rows into `IOHLCV[]`. Accepts an optional
 * header row matching the canonical field order; otherwise treats the first
 * line as data. Malformed rows (wrong column count, missing values, or
 * non-numeric cells) are skipped and counted in `skipped`.
 *
 * @throws if the input is empty.
 */
export function parseCSV(data: string): { rows: IOHLCV[]; skipped: number } {
  const trimmed = data.trim();
  if (!trimmed) {
    throw new Error('Error: CSV must have at least one row');
  }
  const lines = trimmed.split('\n');

  const firstLine = lines[0].trim().split(',').map(h => h.trim());
  const hasHeader = REQUIRED_FIELDS.every((f, i) => firstLine[i] === f);
  const headers = hasHeader ? firstLine : (REQUIRED_FIELDS as readonly string[]);
  const startIndex = hasHeader ? 1 : 0;

  const rows: IOHLCV[] = [];
  let skipped = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',').map(v => v.trim());
    if (values.length !== headers.length) { skipped++; continue; }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = values[index]; });

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

function prefixError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(msg.startsWith('Error:') ? msg : `Error: ${msg}`);
}

interface ParsedInput {
  data: IOHLCV[] | OHLCV[];
  shape: Shape;
}

function parseInput(raw: string, format: InputFormat): ParsedInput {
  if (format === 'csv') {
    const { rows, skipped } = parseCSV(raw);
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
  return { data: parsed as IOHLCV[] | OHLCV[], shape: detectShape(parsed) };
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
  const program = commanderProgram.createCommand();
  program
    .description('Resample OHLCV between timeframes and file formats')
    .option('-i, --input <path>', 'Input file path (csv, json) or use pipe')
    .option('-o, --output <path>', 'Output file path (csv, json) or use stdout')
    .option('-f, --format <fmt>', 'Output format (csv, json)', 'json')
    .option('--input-format <fmt>', 'Input format when piping (csv, json, auto)', 'auto')
    .option('-s, --shape <shape>', 'Output shape for JSON (object, array, auto)', 'auto')
    .option('-b, --base-timeframe <number>', 'Base timeframe in seconds', '60')
    .option('-n, --new-timeframe <number>', 'New timeframe in seconds', '300')
    .version(PACKAGE_VERSION);

  program.parse(argv);
  program.showHelpAfterError();
  const options = program.opts();

  async function readFileData(filePath: string): Promise<ParsedInput> {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (!['csv', 'json'].includes(ext)) {
      throw new Error('Only CSV and JSON files are accepted as input');
    }
    let raw: string;
    try {
      raw = await fs.promises.readFile(path.resolve(filePath), 'utf8');
    } catch (err) {
      throw prefixError(err);
    }
    const parsed = parseInput(raw, ext as InputFormat);
    if (ext === 'csv') {
      const { skipped } = parseCSV(raw);
      if (skipped > 0) stderr.write(`Warning: skipped ${skipped} malformed CSV row(s)\n`);
    }
    return parsed;
  }

  async function readPipeData(stream: NodeJS.ReadableStream): Promise<ParsedInput> {
    const raw = await new Promise<string>((resolve, reject) => {
      let buf = '';
      stream.on('data', chunk => { buf += chunk; });
      stream.on('end', () => resolve(buf));
      stream.on('error', err => reject(prefixError(err)));
    });
    const requested = options.inputFormat as InputFormatOption;
    const format: InputFormat = requested === 'auto' ? detectFormat(raw) : requested;
    const parsed = parseInput(raw, format);
    if (format === 'csv') {
      const { skipped } = parseCSV(raw);
      if (skipped > 0) stderr.write(`Warning: skipped ${skipped} malformed CSV row(s)\n`);
    }
    return parsed;
  }

  async function writeOutput(
    data: OHLCV[] | IOHLCV[],
    format: 'csv' | 'json',
    shape: Shape,
    outputPath: string | undefined,
  ): Promise<void> {
    const text = format === 'csv' ? formatCSV(data) : formatJSON(data, shape);
    if (outputPath) {
      await fs.promises.writeFile(outputPath, text);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      stdout.write(text, err => (err ? reject(err) : resolve()));
    });
  }

  try {
    // `-i` always wins. Only fall back to stdin when no input file is given.
    // Don't gate on `isTTY` — that breaks scripted/CI invocations where stdin
    // is not a TTY but `-i` is the intended source.
    const input = options.input
      ? await readFileData(options.input)
      : await readPipeData(stdin);

    const baseTimeframe = parseInt(options.baseTimeframe, 10);
    const newTimeframe = parseInt(options.newTimeframe, 10);
    if (isNaN(baseTimeframe) || isNaN(newTimeframe)) {
      throw new Error('Timeframes must be valid numbers');
    }
    if (newTimeframe <= baseTimeframe) {
      throw new Error('New timeframe must be greater than base timeframe');
    }

    const resampled = resampleOhlcv(input.data as IOHLCV[], { baseTimeframe, newTimeframe });

    const requestedShape = options.shape as ShapeOption;
    const outputShape: Shape = requestedShape === 'auto' ? input.shape : requestedShape;

    await writeOutput(resampled, options.format, outputShape, options.output);
  } catch (error: unknown) {
    stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  process.on('SIGINT', () => process.exit());
  process.on('SIGTERM', () => process.exit());
  runCli(process.argv);
}

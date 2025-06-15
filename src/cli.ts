#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { program as commanderProgram } from 'commander';
import { IOHLCV } from './types';
import { resampleOhlcv } from './lib';

/**
 * Parse CSV data containing OHLCV (Open, High, Low, Close, Volume) information
 * into a structured array of objects. Each row in the CSV should contain
 * timestamp and OHLCV values in the correct order.
 * 
 * @throws Error if the CSV is empty or has invalid format
 */
export function parseCSV(
  /** The CSV data string to parse */
  data: string
): IOHLCV[] {
  const trimmed = data.trim();
  if (!trimmed) {
    throw new Error('Error: CSV must have at least one row');
  }
  const lines = trimmed.split('\n');
  let headers: string[];
  let startIndex: number;
  const requiredFields = ['time', 'open', 'high', 'low', 'close', 'volume'];

  // If the first line matches the required fields, treat as header
  const firstLine = lines[0].trim();
  const firstLineFields = firstLine.split(',').map(h => h.trim());
  if (requiredFields.every((f, i) => firstLineFields[i] === f)) {
    headers = firstLineFields;
    startIndex = 1;
  } else {
    headers = requiredFields;
    startIndex = 0;
  }

  const rows: IOHLCV[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    if (!lines[i].trim()) continue; // skip empty lines
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length !== headers.length) {
      // Skip lines that do not have exactly 5 commas (6 columns)
      continue;
    }
    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });
    const missingValues = requiredFields.filter(field => row[field] === undefined || row[field] === '');
    if (missingValues.length > 0) {
      // Skip lines with missing required values
      continue;
    }
    // Skip lines with non-numeric values
    if (isNaN(Number(row.time)) || isNaN(Number(row.open)) || isNaN(Number(row.high)) || isNaN(Number(row.low)) || isNaN(Number(row.close)) || isNaN(Number(row.volume))) {
      continue;
    }
    rows.push({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume)
    });
  }
  return rows;
}

/**
 * Detect whether the input data contains CSV or JSON formatted OHLCV data.
 * The detection is based on the presence of JSON-specific characters and
 * structure.
 * 
 * @throws Error if the format cannot be detected
 */
export function detectFormat(
  /** The input data string to analyze */
  data: string
): 'csv' | 'json' {
  try {
    JSON.parse(data);
    return 'json';
  } catch {
    const firstLine = data.split('\n')[0].trim();
    // If the first line has exactly 5 commas, it's likely CSV (6 columns)
    if ((firstLine.match(/,/g) || []).length === 5) {
      return 'csv';
    }
    throw new Error('Could not detect input format. Please specify --input-format');
  }
}

/**
 * Process command-line arguments and execute the OHLCV resampling workflow.
 * Coordinates the data flow from input to output, applying the specified
 * resampling rules.
 */
export async function runCli(
  /** Command line arguments array */
  argv: string[],
  /** Input stream (defaults to process.stdin) */
  stdin: NodeJS.ReadableStream = process.stdin,
  /** Output stream (defaults to process.stdout) */
  stdout: NodeJS.WritableStream = process.stdout,
  /** Error stream (defaults to process.stderr) */
  stderr: NodeJS.WritableStream = process.stderr,
  /** Whether the input is a TTY (defaults to process.stdin.isTTY) */
  isTTY: boolean = process.stdin.isTTY
): Promise<void> {
  const program = commanderProgram.createCommand();
  program
    .description('Resample OHLCV between timeframes and file formats')
    .option('-i, --input <char>', 'Input file path (csv, json) or use pipe')
    .option('-o, --output <char>', 'Output file path (csv, json) or use pipe')
    .option('-f, --format <char>', 'Output file format (csv, json)', 'json')
    .option('--input-format <char>', 'Input format when using pipe (csv, json, auto)', 'auto')
    .option('-b, --base-timeframe <number>', 'Base timeframe in seconds', '60')
    .option('-n, --new-timeframe <number>', 'New timeframe in seconds', '300')
    .version('1.3.0');

  program.parse(argv);
  program.showHelpAfterError();

  const options = program.opts();

  /**
   * Transform file contents into an array of OHLCV objects. Automatically
   * detects and handles both CSV and JSON input formats.
   * 
   * @throws Error if the file cannot be read or parsed
   */
  async function readFileData(
    /** Path to the input file */
    filePath: string
  ): Promise<IOHLCV[]> {
    try {
      const inFormat = path.extname(filePath).slice(1).toLowerCase();
      if (!['csv', 'json'].includes(inFormat)) {
        throw new Error('Only CSV and JSON files are accepted as input');
      }
      const inPath = path.resolve(filePath);
      if (inFormat === 'csv') {
        const data = await fs.promises.readFile(inPath, 'utf8');
        return parseCSV(data);
      } else {
        const inBuffer = await fs.promises.readFile(inPath);
        try {
          return JSON.parse(inBuffer.toString());
        } catch (err: any) {
          const msg = err && err.message && typeof err.message === 'string' && err.message.startsWith('Error:') ? err.message : 'Error: ' + (err && err.message ? err.message : String(err));
          throw new Error(msg);
        }
      }
    } catch (err: any) {
      const msg = err && err.message && typeof err.message === 'string' && err.message.startsWith('Error:') ? err.message : 'Error: ' + (err && err.message ? err.message : String(err));
      throw new Error(msg);
    }
  }

  /**
   * Transform stdin data into an array of OHLCV objects. Processes the
   * input stream line by line, handling both CSV and JSON formats.
   * 
   * @throws Error if the data cannot be read or parsed
   */
  async function readPipeData(
    /** The input stream to read from */
    stdin: NodeJS.ReadableStream
  ): Promise<IOHLCV[]> {
    return new Promise((resolve, reject) => {
      let data = '';
      stdin.on('data', (chunk) => {
        data += chunk;
      });
      stdin.on('end', () => {
        try {
          const inFormat = data.trim().startsWith('[') ? 'json' : 'csv';
          if (inFormat === 'csv') {
            resolve(parseCSV(data));
          } else {
            resolve(JSON.parse(data));
          }
        } catch (err: any) {
          const msg = err && err.message && typeof err.message === 'string' && err.message.startsWith('Error:') ? err.message : 'Error: ' + (err && err.message ? err.message : String(err));
          reject(new Error(msg));
        }
      });
      stdin.on('error', (err: any) => {
        const msg = err && err.message && typeof err.message === 'string' && err.message.startsWith('Error:') ? err.message : 'Error: ' + (err && err.message ? err.message : String(err));
        reject(new Error(msg));
      });
    });
  }

  /**
   * Transform OHLCV data into the specified output format. Converts the
   * array of objects into either CSV or JSON string representation.
   */
  async function writeOutput(
    /** Array of OHLCV objects to write */
    data: IOHLCV[],
    /** Output format ('csv' or 'json') */
    format: 'csv' | 'json',
    /** Optional path to write the output file */
    outputPath?: string,
    /** Stream to write to if no outputPath is provided */
    stdoutStream: NodeJS.WritableStream = process.stdout
  ): Promise<void> {
    if (outputPath) {
      const outStream = fs.createWriteStream(outputPath);
      await new Promise<void>((resolve, reject) => {
        outStream.on('error', reject);
        outStream.on('finish', resolve);
        if (format === 'json') {
          outStream.write(JSON.stringify(data, null, 2), () => outStream.end());
        } else {
          outStream.write('time,open,high,low,close,volume\n');
          data.forEach((row, idx) => {
            const line = `${row.time},${row.open},${row.high},${row.low},${row.close},${row.volume}`;
            if (idx < data.length - 1) {
              outStream.write(line + '\n');
            } else {
              outStream.write(line);
            }
          });
          outStream.end();
        }
      });
    } else {
      if (format === 'json') {
        stdoutStream.write(JSON.stringify(data, null, 2));
      } else {
        stdoutStream.write('time,open,high,low,close,volume\n');
        data.forEach((row, idx) => {
          const line = `${row.time},${row.open},${row.high},${row.low},${row.close},${row.volume}`;
          if (idx < data.length - 1) {
            stdoutStream.write(line + '\n');
          } else {
            stdoutStream.write(line);
          }
        });
      }
    }
  }

  try {
    const data = isTTY && options.input
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
    const resampledData = resampleOhlcv(data, { baseTimeframe, newTimeframe }) as IOHLCV[];
    await writeOutput(resampledData, options.format, options.output, stdout);
  } catch (error: unknown) {
    stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
    return;
  }
}

// Only run if this is the entrypoint
if (require.main === module) {
  // Handle process termination
  process.on('SIGINT', () => {
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    process.exit(0);
  });
  runCli(process.argv);
}
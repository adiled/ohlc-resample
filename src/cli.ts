#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { program as commanderProgram } from 'commander';
import * as csv from 'fast-csv';
import { OHLCV, IOHLCV } from './types';
import { resampleOhlcv } from './lib';
import { Readable, Writable } from 'stream';

export async function runCli(
  argv: string[],
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
  isTTY: boolean = process.stdin.isTTY // allow override for tests
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

  function detectFormat(data: string): 'csv' | 'json' {
    try {
      JSON.parse(data);
      return 'json';
    } catch {
      const firstLine = data.split('\n')[0].trim();
      if (firstLine.includes(',')) {
        const headers = firstLine.toLowerCase().split(',');
        if (
          headers.includes('time') &&
          headers.includes('open') &&
          headers.includes('high') &&
          headers.includes('low') &&
          headers.includes('close') &&
          headers.includes('volume')
        ) {
          return 'csv';
        }
        if (headers.length === 6 && headers.every(h => !isNaN(Number(h)))) {
          return 'csv';
        }
      }
      throw new Error('Could not detect input format. Please specify --input-format');
    }
  }

  async function readFileData(filePath: string): Promise<IOHLCV[]> {
    try {
      const inFormat = path.extname(filePath).slice(1).toLowerCase();
      if (!['csv', 'json'].includes(inFormat)) {
        throw new Error('Only CSV and JSON files are accepted as input');
      }
      const inPath = path.resolve(filePath);
      if (inFormat === 'csv') {
        return await new Promise((resolve, reject) => {
          const results: IOHLCV[] = [];
          let hadData = false;
          const stream = fs.createReadStream(inPath)
            .on('error', (err: any) => {
              const msg = err && err.message && typeof err.message === 'string' && err.message.startsWith('Error:') ? err.message : 'Error: ' + (err && err.message ? err.message : String(err));
              reject(new Error(msg));
            })
            .pipe(csv.parse({ headers: true }))
            .on('data', (row) => {
              hadData = true;
              results.push({
                time: Number(row.time),
                open: Number(row.open),
                high: Number(row.high),
                low: Number(row.low),
                close: Number(row.close),
                volume: Number(row.volume)
              });
            })
            .on('end', () => {
              if (!hadData) {
                reject(new Error('Error: No valid CSV data found'));
              } else {
                resolve(results);
              }
            })
            .on('error', (err: any) => {
              const msg = err && err.message && typeof err.message === 'string' && err.message.startsWith('Error:') ? err.message : 'Error: ' + (err && err.message ? err.message : String(err));
              reject(new Error(msg));
            });
        });
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

  async function readPipeData(input: NodeJS.ReadableStream): Promise<IOHLCV[]> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      input
        .on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        })
        .on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString();
            const format = options.inputFormat === 'auto' ? detectFormat(data) : options.inputFormat;
            if (format === 'json') {
              try {
                const jsonData = JSON.parse(data);
                resolve(jsonData);
              } catch (err) {
                reject(new Error('Error: ' + (err instanceof Error ? err.message : String(err))));
              }
            } else {
              const results: IOHLCV[] = [];
              const lines = data.trim().split('\n');
              const hasHeaders = lines[0].toLowerCase().includes('time');
              const csvData = hasHeaders ? data : 'time,open,high,low,close,volume\n' + data;
              let hadData = false;
              csv.parseString(csvData, { headers: true })
                .on('data', (row) => {
                  hadData = true;
                  results.push({
                    time: Number(row.time),
                    open: Number(row.open),
                    high: Number(row.high),
                    low: Number(row.low),
                    close: Number(row.close),
                    volume: Number(row.volume)
                  });
                })
                .on('end', () => {
                  if (!hadData) {
                    reject(new Error('Error: No valid CSV data found'));
                  } else {
                    resolve(results);
                  }
                })
                .on('error', (err) => {
                  reject(new Error('Error: ' + (err instanceof Error ? err.message : String(err))));
                });
            }
          } catch (error) {
            reject(new Error('Error: ' + (error instanceof Error ? error.message : String(error))));
          }
        })
        .on('error', (err) => {
          reject(new Error('Error: ' + (err instanceof Error ? err.message : String(err))));
        });
    });
  }

  async function writeOutput(data: IOHLCV[], outputPath?: string): Promise<void> {
    let outStream: NodeJS.WritableStream;
    if (outputPath) {
      outStream = fs.createWriteStream(outputPath);
    } else {
      outStream = stdout;
    }
    if (options.format === 'csv') {
      return new Promise((resolve, reject) => {
        const csvStream = csv.write(data, { headers: true });
        csvStream.pipe(outStream);
        csvStream.on('error', reject);
        outStream.on('error', reject);
        outStream.on('finish', resolve);
      });
    } else {
      return new Promise((resolve, reject) => {
        outStream.write(JSON.stringify(data, null, 2), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
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
    await writeOutput(resampledData, options.output);
  } catch (error: unknown) {
    stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
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
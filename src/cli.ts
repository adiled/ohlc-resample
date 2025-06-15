#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { program } from 'commander';
import * as csv from 'fast-csv';
import { OHLCV, IOHLCV } from './types';

program
  .description('Resample OHLCV between timeframes and file formats')
  .option('-i, --input <char>', 'Input file path (csv, json) or use pipe')
  .option('-o, --output <char>', 'Output file path (csv, json) or use pipe')
  .option('-f, --format <char>', 'Output file format (csv, json)', 'csv')
  .version('1.2.1');

program.parse();
program.showHelpAfterError();

const options = program.opts();

async function processInput(input: string | NodeJS.ReadableStream): Promise<IOHLCV[]> {
  if (typeof input === 'string') {
    const inFormat = path.extname(input).slice(1).toLowerCase();
    if (!['csv', 'json'].includes(inFormat)) {
      throw new Error('Only CSV and JSON files are accepted as input');
    }

    const inPath = path.resolve(input);
    const inBuffer = fs.readFileSync(inPath);
    
    if (inFormat === 'csv') {
      return new Promise((resolve, reject) => {
        const results: IOHLCV[] = [];
        fs.createReadStream(inPath)
          .pipe(csv.parse({ headers: true }))
          .on('data', (row) => {
            results.push({
              time: Number(row.time),
              open: Number(row.open),
              high: Number(row.high),
              low: Number(row.low),
              close: Number(row.close),
              volume: Number(row.volume)
            });
          })
          .on('end', () => resolve(results))
          .on('error', reject);
      });
    } else {
      return JSON.parse(inBuffer.toString());
    }
  } else {
    // Handle pipe input
    return new Promise((resolve, reject) => {
      const results: IOHLCV[] = [];
      input
        .pipe(csv.parse({ headers: true }))
        .on('data', (row) => {
          results.push({
            time: Number(row.time),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume)
          });
        })
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }
}

async function main() {
  try {
    let input: string | NodeJS.ReadableStream;
    
    if (process.stdin.isTTY) {
      // Read from file
      if (!options.input) {
        program.error('Input file is required when not using pipe');
        return;
      }
      input = options.input;
    } else {
      // Read from pipe
      input = process.stdin;
    }

    const data = await processInput(input);
    
    // TODO: Process data (resample)
    
    // Output handling
    if (options.output) {
      const outStream = fs.createWriteStream(options.output);
      if (options.format === 'csv') {
        csv.write(data, { headers: true }).pipe(outStream);
      } else {
        outStream.write(JSON.stringify(data, null, 2));
      }
    } else {
      // Output to stdout
      if (options.format === 'csv') {
        csv.write(data, { headers: true }).pipe(process.stdout);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    }
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
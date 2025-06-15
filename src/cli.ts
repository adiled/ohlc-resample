#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { program } from 'commander';
import * as csv from 'fast-csv';
import { OHLCV, IOHLCV } from './types';
import { resampleOhlcv } from './lib';

program
  .description('Resample OHLCV between timeframes and file formats')
  .option('-i, --input <char>', 'Input file path (csv, json) or use pipe')
  .option('-o, --output <char>', 'Output file path (csv, json) or use pipe')
  .option('-f, --format <char>', 'Output file format (csv, json)', 'csv')
  .option('-if, --input-format <char>', 'Input format when using pipe (csv, json, auto)', 'auto')
  .option('-b, --base-timeframe <number>', 'Base timeframe in seconds', '60')
  .option('-n, --new-timeframe <number>', 'New timeframe in seconds', '300')
  .version('1.3.0');

program.parse();
program.showHelpAfterError();

const options = program.opts();

function detectFormat(data: string): 'csv' | 'json' {
  // Try to parse as JSON first
  try {
    JSON.parse(data);
    return 'json';
  } catch {
    // If JSON parsing fails, check if it looks like CSV
    const firstLine = data.split('\n')[0].trim();
    if (firstLine.includes(',') && firstLine.toLowerCase().includes('time')) {
      return 'csv';
    }
    throw new Error('Could not detect input format. Please specify --input-format');
  }
}

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
      let data = '';
      input
        .on('data', (chunk) => {
          data += chunk;
        })
        .on('end', () => {
          try {
            const format = options.inputFormat === 'auto' ? detectFormat(data) : options.inputFormat;
            
            if (format === 'json') {
              const jsonData = JSON.parse(data);
              resolve(jsonData);
            } else {
              // CSV format
              const results: IOHLCV[] = [];
              csv.parseString(data, { headers: true })
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
            }
          } catch (error) {
            reject(error);
          }
        })
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
    
    // Resample the data
    const baseTimeframe = parseInt(options.baseTimeframe, 10);
    const newTimeframe = parseInt(options.newTimeframe, 10);
    
    if (isNaN(baseTimeframe) || isNaN(newTimeframe)) {
      throw new Error('Timeframes must be valid numbers');
    }
    
    if (newTimeframe <= baseTimeframe) {
      throw new Error('New timeframe must be greater than base timeframe');
    }
    
    const resampledData = resampleOhlcv(data, { baseTimeframe, newTimeframe }) as IOHLCV[];
    
    // Output handling
    if (options.output) {
      const outStream = fs.createWriteStream(options.output);
      if (options.format === 'csv') {
        csv.write(resampledData, { headers: true }).pipe(outStream);
      } else {
        outStream.write(JSON.stringify(resampledData, null, 2));
      }
    } else {
      // Output to stdout
      if (options.format === 'csv') {
        csv.write(resampledData, { headers: true }).pipe(process.stdout);
      } else {
        console.log(JSON.stringify(resampledData, null, 2));
      }
    }
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
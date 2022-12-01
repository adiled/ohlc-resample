import * as path from 'path';
import * as fs from 'fs';
import { program } from 'commander';
import * as csv from 'fast-csv';
import { OHLCV, IOHLCV } from './types';

program
  .description('Resample OHLCV between timeframes and file formats')
  .option('-i, --input <char>', 'Input file path (csv, json)')
  .option('-n, --name <char>', 'Output file name')
  .option('-f, --format <char>', 'Output file format (csv, json)')
  .option('-p, --placeholder', '')
  ;

program.parse();
program.showHelpAfterError();

const options = program.opts();

(() => {

  const inFormat = path.extname(options.input).slice(1).toLowerCase();
  const inPath = path.resolve(options.input);

  if (!['csv', 'json'].includes(inFormat)) {
    program.error('Only CSV and JSON files are accepted as input');
    return;
  }

  const inBuffer = fs.readFileSync(inPath);
  const inStream = fs.createReadStream(inPath, {
    start: 0
  });

  if (inFormat === 'csv') {
    csv.parseStream(inStream)
      .on('data', (row) => {
        console.log(row);
      })
      .end(() => {
        console.log("end");
      });

    // const data = inStream
    //   .pipe(csv.parse<OHLCV, OHLCV>({ headers: true }));
  }
  if (inFormat === 'json') {
    //@ts-ignore
    const data: IOHLCV[] = JSON.parse(inBuffer);
  }
})();
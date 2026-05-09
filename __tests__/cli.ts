import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable, Writable } from 'stream';
import { IOHLCV, OHLCV } from '../src/types';
import { withTimeout } from './utils';
import { runCli, parseCSV, detectFormat } from '../src/cli';

describe('CLI', () => {
  let tempDir: string;
  let testData: IOHLCV[];
  let testDataArray: OHLCV[];
  let csvPath: string;
  let jsonPath: string;
  let jsonArrayPath: string;

  const expectedCandle = {
    time: 1609459200000,
    open: 100,
    high: 108,
    low: 95,
    close: 103,
    volume: 5000,
  };

  beforeAll(() => {
    testData = [
      { time: 1609459200000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: 1609459260000, open: 102, high: 107, low: 101, close: 106, volume: 1200 },
      { time: 1609459320000, open: 106, high: 108, low: 104, close: 105, volume: 800 },
      { time: 1609459380000, open: 105, high: 106, low: 103, close: 104, volume: 900 },
      { time: 1609459440000, open: 104, high: 105, low: 102, close: 103, volume: 1100 },
    ];
    testDataArray = testData.map(d =>
      [d.time, d.open, d.high, d.low, d.close, d.volume] as OHLCV);
  });

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohlc-resample-test-'));
    csvPath = path.join(tempDir, 'test.csv');
    jsonPath = path.join(tempDir, 'test.json');
    jsonArrayPath = path.join(tempDir, 'test-array.json');

    const csvContent = 'time,open,high,low,close,volume\n' +
      testData.map(d => `${d.time},${d.open},${d.high},${d.low},${d.close},${d.volume}`).join('\n');
    await fs.promises.writeFile(csvPath, csvContent);
    await fs.promises.writeFile(jsonPath, JSON.stringify(testData, null, 2));
    await fs.promises.writeFile(jsonArrayPath, JSON.stringify(testDataArray, null, 2));

    process.exitCode = 0;
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function captureWritable() {
    let data = '';
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        data += chunk.toString();
        callback();
      },
    });
    return { writable, getData: () => data };
  }

  function readableFromString(str: string) {
    return Readable.from([str]);
  }

  describe('File Input', () => {
    test('reads CSV file', async () => {
      await withTimeout(async () => {
        const { writable, getData } = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', csvPath], undefined, writable, err.writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1);
        expect(output[0]).toMatchObject(expectedCandle);
      }, 1000, 'read CSV file');
    });

    test('reads JSON file (object shape)', async () => {
      await withTimeout(async () => {
        const { writable, getData } = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', jsonPath], undefined, writable, err.writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1);
        expect(output[0]).toMatchObject(expectedCandle);
      }, 1000, 'read JSON object file');
    });

    test('reads JSON file (array shape) and preserves shape on output', async () => {
      await withTimeout(async () => {
        const { writable, getData } = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', jsonArrayPath], undefined, writable, err.writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1);
        expect(Array.isArray(output[0])).toBe(true);
        expect(output[0]).toEqual([1609459200000, 100, 108, 95, 103, 5000]);
      }, 1000, 'read JSON array file');
    });

    test('rejects non-csv/json file extension', async () => {
      await withTimeout(async () => {
        const invalidFile = path.join(tempDir, 'test.txt');
        fs.writeFileSync(invalidFile, 'invalid data');
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', invalidFile], undefined, out.writable, err.writable, true);
        expect(err.getData()).toContain('Only CSV and JSON files are accepted');
        expect(process.exitCode).toBe(1);
      }, 1000, 'reject invalid extension');
    });
  });

  describe('Pipe Input', () => {
    test('reads CSV from pipe', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        const stdin = readableFromString(fs.readFileSync(csvPath, 'utf8'));
        await runCli(['node', 'cli.js'], stdin, out.writable, err.writable, false);
        const output = JSON.parse(out.getData());
        expect(output).toHaveLength(1);
        expect(output[0]).toMatchObject(expectedCandle);
      }, 1000, 'read pipe CSV');
    });
  });

  describe('Output --shape flag', () => {
    test('--shape array converts object input to tuple output', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', jsonPath, '-s', 'array'], undefined, out.writable, err.writable, true);
        const output = JSON.parse(out.getData());
        expect(Array.isArray(output[0])).toBe(true);
        expect(output[0]).toEqual([1609459200000, 100, 108, 95, 103, 5000]);
      }, 1000, '--shape array');
    });

    test('--shape object converts tuple input to object output', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', jsonArrayPath, '-s', 'object'], undefined, out.writable, err.writable, true);
        const output = JSON.parse(out.getData());
        expect(output[0]).toMatchObject(expectedCandle);
      }, 1000, '--shape object');
    });

    test('--shape auto preserves CSV-derived object shape', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', csvPath], undefined, out.writable, err.writable, true);
        const output = JSON.parse(out.getData());
        expect(output[0]).toMatchObject(expectedCandle);
      }, 1000, '--shape auto');
    });
  });

  describe('Output Format', () => {
    let outputFile: string;
    beforeEach(() => { outputFile = path.join(tempDir, 'output'); });

    test('writes CSV output', async () => {
      await withTimeout(async () => {
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', jsonPath, '-o', outputFile, '-f', 'csv'], undefined, undefined, err.writable, true);
        const content = fs.readFileSync(outputFile, 'utf8');
        expect(content).toContain('time,open,high,low,close,volume');
        expect(content.split('\n')).toHaveLength(2);
      }, 1000, 'write CSV');
    });

    test('writes JSON output', async () => {
      await withTimeout(async () => {
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', csvPath, '-o', outputFile, '-f', 'json'], undefined, undefined, err.writable, true);
        const content = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        expect(content).toHaveLength(1);
        expect(content[0]).toMatchObject(expectedCandle);
      }, 1000, 'write JSON');
    });

    test('writes to stdout when no output file is given', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', jsonPath], undefined, out.writable, err.writable, true);
        const output = JSON.parse(out.getData());
        expect(output).toHaveLength(1);
        expect(output[0]).toMatchObject(expectedCandle);
      }, 1000, 'write stdout');
    });
  });

  describe('Error Handling', () => {
    test('missing input file → exit 1 + ENOENT', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', 'nonexistent.csv'], undefined, out.writable, err.writable, true);
        expect(err.getData()).toContain('no such file or directory');
        expect(process.exitCode).toBe(1);
      }, 1000, 'missing file');
    });

    test('invalid JSON → exit 1', async () => {
      await withTimeout(async () => {
        const invalidJsonFile = path.join(tempDir, 'invalid.json');
        fs.writeFileSync(invalidJsonFile, '{invalid json');
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', invalidJsonFile], undefined, out.writable, err.writable, true);
        expect(process.exitCode).toBe(1);
        expect(err.getData()).toMatch(/Error:/);
      }, 1000, 'invalid JSON');
    });

    test('CSV with all malformed rows → exit 1', async () => {
      await withTimeout(async () => {
        const invalidCsvFile = path.join(tempDir, 'invalid.csv');
        fs.writeFileSync(invalidCsvFile, 'time,open,high,low,close,volume\n1,2,3,4,5');
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', invalidCsvFile], undefined, out.writable, err.writable, true);
        expect(process.exitCode).toBe(1);
        expect(err.getData()).toContain('no valid OHLCV rows');
      }, 1000, 'invalid CSV');
    });

    test('non-numeric timeframe → exit 1', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', csvPath, '-b', 'invalid', '-n', '300'], undefined, out.writable, err.writable, true);
        expect(err.getData()).toContain('Timeframes must be valid numbers');
        expect(process.exitCode).toBe(1);
      }, 1000, 'bad timeframe');
    });

    test('new <= base timeframe → exit 1', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', csvPath, '-b', '300', '-n', '60'], undefined, out.writable, err.writable, true);
        expect(err.getData()).toContain('New timeframe must be greater than base timeframe');
        expect(process.exitCode).toBe(1);
      }, 1000, 'tf relationship');
    });
  });

  describe('Resampling', () => {
    test('default timeframes (60s → 300s)', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', csvPath], undefined, out.writable, err.writable, true);
        const output = JSON.parse(out.getData());
        expect(output).toHaveLength(1);
        expect(output[0]).toMatchObject(expectedCandle);
      }, 1000, 'default tf');
    });

    test('custom timeframes (60s → 120s)', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        await runCli(['node', 'cli.js', '-i', csvPath, '-b', '60', '-n', '120'], undefined, out.writable, err.writable, true);
        const output = JSON.parse(out.getData());
        expect(output).toHaveLength(2);
        expect(output[0]).toMatchObject({
          time: 1609459200000, open: 100, high: 107, low: 95, close: 106, volume: 2200,
        });
      }, 1000, 'custom tf');
    });
  });

  describe('--input-format', () => {
    test('auto-detects JSON from pipe', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        const stdin = readableFromString(fs.readFileSync(jsonPath, 'utf8'));
        await runCli(['node', 'cli.js'], stdin, out.writable, err.writable, false);
        expect(JSON.parse(out.getData())[0]).toMatchObject(expectedCandle);
      }, 1000, 'auto JSON');
    });

    test('auto-detects CSV from pipe', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        const stdin = readableFromString(fs.readFileSync(csvPath, 'utf8'));
        await runCli(['node', 'cli.js'], stdin, out.writable, err.writable, false);
        expect(JSON.parse(out.getData())[0]).toMatchObject(expectedCandle);
      }, 1000, 'auto CSV');
    });

    test('--input-format json forces JSON parsing', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        const stdin = readableFromString(fs.readFileSync(jsonPath, 'utf8'));
        await runCli(['node', 'cli.js', '--input-format', 'json'], stdin, out.writable, err.writable, false);
        expect(JSON.parse(out.getData())[0]).toMatchObject(expectedCandle);
      }, 1000, 'force JSON');
    });

    test('--input-format csv forces CSV parsing (errors on JSON-looking input)', async () => {
      await withTimeout(async () => {
        const out = captureWritable();
        const err = captureWritable();
        const stdin = readableFromString(fs.readFileSync(jsonPath, 'utf8'));
        await runCli(['node', 'cli.js', '--input-format', 'csv'], stdin, out.writable, err.writable, false);
        expect(process.exitCode).toBe(1);
      }, 1000, 'force CSV on JSON');
    });
  });

  describe('parseCSV', () => {
    it('parses CSV with header', () => {
      const { rows, skipped } = parseCSV('time,open,high,low,close,volume\n1000,1,2,0.5,1.5,10');
      expect(rows).toEqual([{ time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
      expect(skipped).toBe(0);
    });

    it('parses CSV without header', () => {
      const { rows } = parseCSV('1000,1,2,0.5,1.5,10');
      expect(rows).toEqual([{ time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
    });

    it('throws for empty CSV', () => {
      expect(() => parseCSV('')).toThrow('Error: CSV must have at least one row');
    });

    it('counts skipped rows with wrong column count', () => {
      const { rows, skipped } = parseCSV('1000,1,2,0.5,1.5,10\n2000,1,2,0.5,1.5\n3000,1,2,0.5,1.5,10');
      expect(rows).toHaveLength(2);
      expect(skipped).toBe(1);
    });

    it('counts skipped rows with missing values', () => {
      const { rows, skipped } = parseCSV('1000,1,2,0.5,1.5,10\n2000,1,2,,1.5,10\n3000,1,2,0.5,1.5,10');
      expect(rows).toHaveLength(2);
      expect(skipped).toBe(1);
    });

    it('counts skipped rows with non-numeric values', () => {
      const { rows, skipped } = parseCSV('1000,1,2,0.5,1.5,10\n2000,1,2,0.5,1.5,abc\n3000,1,2,0.5,1.5,10');
      expect(rows).toHaveLength(2);
      expect(skipped).toBe(1);
    });
  });

  describe('detectFormat', () => {
    it('detects CSV for 5-comma line', () => {
      expect(detectFormat('1,2,3,4,5,6')).toBe('csv');
      expect(detectFormat('1000,1,2,0.5,1.5,10\n')).toBe('csv');
    });

    it('detects JSON for array-of-objects', () => {
      expect(detectFormat('[{"time":1,"open":2,"high":3,"low":1,"close":2,"volume":10}]')).toBe('json');
    });

    it('detects JSON for array-of-tuples', () => {
      expect(detectFormat('[[1,2,3,1,2,10]]')).toBe('json');
    });

    it('rejects bare JSON scalars (not an array)', () => {
      // Naked numbers/strings parse as JSON but aren't OHLCV input.
      expect(() => detectFormat('1000')).toThrow('Could not detect input format');
    });

    it('throws for unknown format', () => {
      expect(() => detectFormat('foo|bar|baz')).toThrow('Could not detect input format');
    });
  });
});

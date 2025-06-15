import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IOHLCV } from '../src/types';
import { withTimeout } from './utils';
import { runCli } from '../src/cli';
import { Readable, Writable } from 'stream';

describe('CLI', () => {
  let tempDir: string;
  let testData: IOHLCV[];
  let csvPath: string;
  let jsonPath: string;

  beforeAll(() => {
    // Create test data
    testData = [
      { time: 1609459200000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: 1609459260000, open: 102, high: 107, low: 101, close: 106, volume: 1200 },
      { time: 1609459320000, open: 106, high: 108, low: 104, close: 105, volume: 800 },
      { time: 1609459380000, open: 105, high: 106, low: 103, close: 104, volume: 900 },
      { time: 1609459440000, open: 104, high: 105, low: 102, close: 103, volume: 1100 }
    ];
  });

  beforeEach(async () => {
    // Create temp directory
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohlc-resample-test-'));
    
    // Create test files
    csvPath = path.join(tempDir, 'test.csv');
    jsonPath = path.join(tempDir, 'test.json');
    
    // Write CSV file
    const csvContent = 'time,open,high,low,close,volume\n' +
      testData.map(d => `${d.time},${d.open},${d.high},${d.low},${d.close},${d.volume}`).join('\n');
    await fs.promises.writeFile(csvPath, csvContent);
    
    // Write JSON file
    await fs.promises.writeFile(jsonPath, JSON.stringify(testData, null, 2));
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  function getWritableStream() {
    let data = '';
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        data += chunk.toString();
        callback();
      }
    });
    return { writable, getData: () => data };
  }

  function getReadableStream(str: string) {
    return Readable.from([str]);
  }

  describe('File Input', () => {
    test('should read CSV file', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', csvPath], undefined, writable, writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1); // Resampled to 5-minute candle
        expect(output[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'read CSV file');
    });

    test('should read JSON file', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', jsonPath], undefined, writable, writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1); // Resampled to 5-minute candle
        expect(output[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'read JSON file');
    });

    test('should handle invalid file format', async () => {
      await withTimeout(async () => {
        const invalidFile = path.join(tempDir, 'test.txt');
        fs.writeFileSync(invalidFile, 'invalid data');
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', invalidFile], undefined, writable, writable, true);
        expect(getData()).toContain('Only CSV and JSON files are accepted');
      }, 1000, 'handle invalid file format');
    });
  });

  describe('Pipe Input', () => {
    test('should read from pipe', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const stdin = getReadableStream(csvContent);
        await runCli(['node', 'cli.js'], stdin, writable, writable, false);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1); // Resampled to 5-minute candle
        expect(output[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'read from pipe');
    });
  });

  describe('Output Format', () => {
    let outputFile: string;

    beforeEach(() => {
      outputFile = path.join(tempDir, 'output');
    });

    afterEach(() => {
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
    });

    test('should write CSV output', async () => {
      await withTimeout(async () => {
        await runCli(['node', 'cli.js', '-i', jsonPath, '-o', outputFile, '-f', 'csv'], undefined, undefined, undefined, true);
        const content = fs.readFileSync(outputFile, 'utf8');
        expect(content).toContain('time,open,high,low,close,volume');
        expect(content.split('\n')).toHaveLength(2); // header + 1 row (resampled)
      }, 1000, 'write CSV output');
    });

    test('should write JSON output', async () => {
      await withTimeout(async () => {
        await runCli(['node', 'cli.js', '-i', csvPath, '-o', outputFile, '-f', 'json'], undefined, undefined, undefined, true);
        const content = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        expect(content).toHaveLength(1); // Resampled to 5-minute candle
        expect(content[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'write JSON output');
    });

    test('should write to stdout when no output file specified', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', jsonPath], undefined, writable, writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1); // Resampled to 5-minute candle
        expect(output[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'write to stdout');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing input file', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', 'nonexistent.csv'], undefined, writable, writable, true);
        expect(getData()).toContain('no such file or directory');
      }, 1000, 'handle missing input file');
    });

    test('should handle invalid JSON', async () => {
      await withTimeout(async () => {
        const invalidJsonFile = path.join(tempDir, 'invalid.json');
        fs.writeFileSync(invalidJsonFile, '{invalid json');
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', invalidJsonFile], undefined, writable, writable, true);
        expect(getData()).toContain('Unexpected token');
      }, 1000, 'handle invalid JSON');
    });

    test('should handle invalid CSV', async () => {
      await withTimeout(async () => {
        const invalidCsvFile = path.join(tempDir, 'invalid.csv');
        fs.writeFileSync(invalidCsvFile, 'invalid,csv,data\n1,2,3');
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', invalidCsvFile], undefined, writable, writable, true);
        expect(getData()).toContain('Error');
      }, 1000, 'handle invalid CSV');
    });

    test('should handle invalid timeframe values', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', csvPath, '-b', 'invalid', '-n', '300'], undefined, writable, writable, true);
        expect(getData()).toContain('Timeframes must be valid numbers');
      }, 1000, 'handle invalid timeframe values');
    });

    test('should handle invalid timeframe relationship', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', csvPath, '-b', '300', '-n', '60'], undefined, writable, writable, true);
        expect(getData()).toContain('New timeframe must be greater than base timeframe');
      }, 1000, 'handle invalid timeframe relationship');
    });
  });

  describe('Resampling', () => {
    test('should resample data with default timeframes', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', csvPath], undefined, writable, writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(1); // 5 minutes of 1-minute data resampled to 5 minutes
        expect(output[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'resample with default timeframes');
    });

    test('should resample data with custom timeframes', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        await runCli(['node', 'cli.js', '-i', csvPath, '-b', '60', '-n', '120'], undefined, writable, writable, true);
        const output = JSON.parse(getData());
        expect(output).toHaveLength(3); // 5 minutes of 1-minute data resampled to 2 minutes
        expect(output[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 107,
          low: 95,
          close: 106,
          volume: 2200
        });
      }, 1000, 'resample with custom timeframes');
    });
  });

  describe('Pipe Input Format Detection', () => {
    it('should auto-detect JSON format from pipe', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        const jsonContent = fs.readFileSync(jsonPath, 'utf8');
        const stdin = getReadableStream(jsonContent);
        await runCli(['node', 'cli.js'], stdin, writable, writable, false);
        const result = JSON.parse(getData());
        expect(result).toHaveLength(1); // Resampled to 5-minute candle
        expect(result[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'auto-detect JSON format');
    });

    it('should auto-detect CSV format from pipe', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const stdin = getReadableStream(csvContent);
        await runCli(['node', 'cli.js'], stdin, writable, writable, false);
        const result = JSON.parse(getData());
        expect(result).toHaveLength(1); // Resampled to 5-minute candle
        expect(result[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'auto-detect CSV format');
    });

    it('should use forced JSON format from pipe', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        const jsonContent = fs.readFileSync(jsonPath, 'utf8');
        const stdin = getReadableStream(jsonContent);
        await runCli(['node', 'cli.js', '--input-format', 'json'], stdin, writable, writable, false);
        const result = JSON.parse(getData());
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'force JSON format');
    });

    it('should use forced CSV format from pipe', async () => {
      await withTimeout(async () => {
        const { writable, getData } = getWritableStream();
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const stdin = getReadableStream(csvContent);
        await runCli(['node', 'cli.js', '--input-format', 'csv'], stdin, writable, writable, false);
        const result = JSON.parse(getData());
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          time: 1609459200000,
          open: 100,
          high: 108,
          low: 95,
          close: 103,
          volume: 5000
        });
      }, 1000, 'force CSV format');
    });
  });
}); 
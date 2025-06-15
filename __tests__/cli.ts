import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IOHLCV } from '../src/types';

const execAsync = promisify(exec);

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

  describe('File Input', () => {
    test('should read CSV file', async () => {
      const { stdout } = await execAsync(`node dist/cli.js -i ${csvPath}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(5);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });

    test('should read JSON file', async () => {
      const { stdout } = await execAsync(`node dist/cli.js -i ${jsonPath}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(5);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });

    test('should handle invalid file format', async () => {
      const invalidFile = path.join(tempDir, 'test.txt');
      fs.writeFileSync(invalidFile, 'invalid data');
      
      try {
        await execAsync(`node dist/cli.js -i ${invalidFile}`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Only CSV and JSON files are accepted');
      }
      
      fs.unlinkSync(invalidFile);
    });
  });

  describe('Pipe Input', () => {
    test('should read from pipe', async () => {
      const { stdout } = await execAsync(`cat ${csvPath} | node dist/cli.js`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(5);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });
  });

  describe('Output Format', () => {
    const outputFile = path.join(tempDir, 'output');

    afterEach(() => {
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
    });

    test('should write CSV output', async () => {
      await execAsync(`node dist/cli.js -i ${jsonPath} -o ${outputFile} -f csv`);
      const content = fs.readFileSync(outputFile, 'utf8');
      expect(content).toContain('time,open,high,low,close,volume');
      expect(content.split('\n')).toHaveLength(6); // header + 5 rows
    });

    test('should write JSON output', async () => {
      await execAsync(`node dist/cli.js -i ${csvPath} -o ${outputFile} -f json`);
      const content = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      expect(content).toHaveLength(5);
      expect(content[0]).toHaveProperty('time', 1609459200000);
    });

    test('should write to stdout when no output file specified', async () => {
      const { stdout } = await execAsync(`node dist/cli.js -i ${jsonPath}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(5);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing input file', async () => {
      try {
        await execAsync(`node dist/cli.js -i nonexistent.csv`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('no such file or directory');
      }
    });

    test('should handle invalid JSON', async () => {
      const invalidJsonFile = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(invalidJsonFile, '{invalid json');
      
      try {
        await execAsync(`node dist/cli.js -i ${invalidJsonFile}`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Unexpected token');
      }
      
      fs.unlinkSync(invalidJsonFile);
    });

    test('should handle invalid CSV', async () => {
      const invalidCsvFile = path.join(tempDir, 'invalid.csv');
      fs.writeFileSync(invalidCsvFile, 'invalid,csv,data\n1,2,3');
      
      try {
        await execAsync(`node dist/cli.js -i ${invalidCsvFile}`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Error');
      }
      
      fs.unlinkSync(invalidCsvFile);
    });
  });

  describe('Resampling', () => {
    test('should resample data with default timeframes', async () => {
      const { stdout } = await execAsync(`node dist/cli.js -i ${csvPath}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(1); // 3 minutes of 1-minute data resampled to 5 minutes
      expect(output[0]).toHaveProperty('time');
      expect(output[0]).toHaveProperty('open');
      expect(output[0]).toHaveProperty('high');
      expect(output[0]).toHaveProperty('low');
      expect(output[0]).toHaveProperty('close');
      expect(output[0]).toHaveProperty('volume');
    });

    test('should resample data with custom timeframes', async () => {
      const { stdout } = await execAsync(`node dist/cli.js -i ${csvPath} -b 60 -n 120`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(2); // 3 minutes of 1-minute data resampled to 2 minutes
    });

    test('should handle invalid timeframe values', async () => {
      try {
        await execAsync(`node dist/cli.js -i ${csvPath} -b invalid -n 300`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Timeframes must be valid numbers');
      }
    });

    test('should handle invalid timeframe relationship', async () => {
      try {
        await execAsync(`node dist/cli.js -i ${csvPath} -b 300 -n 60`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('New timeframe must be greater than base timeframe');
      }
    });
  });

  describe('Pipe Input Format Detection', () => {
    it('should auto-detect JSON format from pipe', async () => {
      const { stdout } = await execAsync(`cat ${jsonPath} | node dist/cli.js`);
      const result = JSON.parse(stdout);
      expect(result).toHaveLength(1); // Resampled to 5-minute candle
      expect(result[0]).toMatchObject({
        time: 1609459200000,
        open: 100,
        high: 108,
        low: 95,
        close: 103,
        volume: 5000
      });
    });

    it('should auto-detect CSV format from pipe', async () => {
      const { stdout } = await execAsync(`cat ${csvPath} | node dist/cli.js`);
      const result = JSON.parse(stdout);
      expect(result).toHaveLength(1); // Resampled to 5-minute candle
      expect(result[0]).toMatchObject({
        time: 1609459200000,
        open: 100,
        high: 108,
        low: 95,
        close: 103,
        volume: 5000
      });
    });

    it('should use forced JSON format from pipe', async () => {
      const { stdout } = await execAsync(`cat ${jsonPath} | node dist/cli.js --input-format json`);
      const result = JSON.parse(stdout);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        time: 1609459200000,
        open: 100,
        high: 108,
        low: 95,
        close: 103,
        volume: 5000
      });
    });

    it('should use forced CSV format from pipe', async () => {
      const { stdout } = await execAsync(`cat ${csvPath} | node dist/cli.js --input-format csv`);
      const result = JSON.parse(stdout);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        time: 1609459200000,
        open: 100,
        high: 108,
        low: 95,
        close: 103,
        volume: 5000
      });
    });

    it('should error on invalid format when auto-detecting', async () => {
      const invalidData = 'invalid,data\n1,2,3,4,5';
      const invalidPath = path.join(tempDir, 'invalid.txt');
      await fs.promises.writeFile(invalidPath, invalidData);
      
      await expect(execAsync(`cat ${invalidPath} | node dist/cli.js`))
        .rejects
        .toThrow('Could not detect input format');
    });

    it('should error on invalid JSON when forced JSON format', async () => {
      const invalidJson = '{invalid: json}';
      const invalidPath = path.join(tempDir, 'invalid.json');
      await fs.promises.writeFile(invalidPath, invalidJson);
      
      await expect(execAsync(`cat ${invalidPath} | node dist/cli.js --input-format json`))
        .rejects
        .toThrow();
    });

    it('should error on invalid CSV when forced CSV format', async () => {
      const invalidCsv = 'invalid,csv\n1,2,3,4,5';
      const invalidPath = path.join(tempDir, 'invalid.csv');
      await fs.promises.writeFile(invalidPath, invalidCsv);
      
      await expect(execAsync(`cat ${invalidPath} | node dist/cli.js --input-format csv`))
        .rejects
        .toThrow();
    });
  });
}); 
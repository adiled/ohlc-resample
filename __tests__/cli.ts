import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('CLI', () => {
  const cliPath = path.resolve(__dirname, '../dist/cli.js');
  const testDataDir = path.resolve(__dirname, 'fixtures');
  
  // Create test data directory if it doesn't exist
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir);
  }

  // Sample OHLCV data
  const sampleData = [
    { time: 1609459200000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
    { time: 1609462800000, open: 102, high: 107, low: 101, close: 106, volume: 1200 },
    { time: 1609466400000, open: 106, high: 108, low: 104, close: 105, volume: 800 }
  ];

  // Create test files
  const csvFile = path.join(testDataDir, 'test.csv');
  const jsonFile = path.join(testDataDir, 'test.json');

  beforeAll(() => {
    // Write test data to files
    fs.writeFileSync(csvFile, 'time,open,high,low,close,volume\n' + 
      sampleData.map(row => Object.values(row).join(',')).join('\n'));
    fs.writeFileSync(jsonFile, JSON.stringify(sampleData, null, 2));
  });

  afterAll(() => {
    // Clean up test files
    fs.unlinkSync(csvFile);
    fs.unlinkSync(jsonFile);
    fs.rmdirSync(testDataDir);
  });

  describe('File Input', () => {
    test('should read CSV file', async () => {
      const { stdout } = await execAsync(`node ${cliPath} -i ${csvFile}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(3);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });

    test('should read JSON file', async () => {
      const { stdout } = await execAsync(`node ${cliPath} -i ${jsonFile}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(3);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });

    test('should handle invalid file format', async () => {
      const invalidFile = path.join(testDataDir, 'test.txt');
      fs.writeFileSync(invalidFile, 'invalid data');
      
      try {
        await execAsync(`node ${cliPath} -i ${invalidFile}`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Only CSV and JSON files are accepted');
      }
      
      fs.unlinkSync(invalidFile);
    });
  });

  describe('Pipe Input', () => {
    test('should read from pipe', async () => {
      const { stdout } = await execAsync(`cat ${csvFile} | node ${cliPath}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(3);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });
  });

  describe('Output Format', () => {
    const outputFile = path.join(testDataDir, 'output');

    afterEach(() => {
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
    });

    test('should write CSV output', async () => {
      await execAsync(`node ${cliPath} -i ${jsonFile} -o ${outputFile} -f csv`);
      const content = fs.readFileSync(outputFile, 'utf8');
      expect(content).toContain('time,open,high,low,close,volume');
      expect(content.split('\n')).toHaveLength(4); // header + 3 rows
    });

    test('should write JSON output', async () => {
      await execAsync(`node ${cliPath} -i ${csvFile} -o ${outputFile} -f json`);
      const content = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      expect(content).toHaveLength(3);
      expect(content[0]).toHaveProperty('time', 1609459200000);
    });

    test('should write to stdout when no output file specified', async () => {
      const { stdout } = await execAsync(`node ${cliPath} -i ${jsonFile}`);
      const output = JSON.parse(stdout);
      expect(output).toHaveLength(3);
      expect(output[0]).toHaveProperty('time', 1609459200000);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing input file', async () => {
      try {
        await execAsync(`node ${cliPath} -i nonexistent.csv`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('no such file or directory');
      }
    });

    test('should handle invalid JSON', async () => {
      const invalidJsonFile = path.join(testDataDir, 'invalid.json');
      fs.writeFileSync(invalidJsonFile, '{invalid json');
      
      try {
        await execAsync(`node ${cliPath} -i ${invalidJsonFile}`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Unexpected token');
      }
      
      fs.unlinkSync(invalidJsonFile);
    });

    test('should handle invalid CSV', async () => {
      const invalidCsvFile = path.join(testDataDir, 'invalid.csv');
      fs.writeFileSync(invalidCsvFile, 'invalid,csv,data\n1,2,3');
      
      try {
        await execAsync(`node ${cliPath} -i ${invalidCsvFile}`);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Error');
      }
      
      fs.unlinkSync(invalidCsvFile);
    });
  });
}); 
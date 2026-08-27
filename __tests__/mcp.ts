import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IOHLCV } from '../src/types';
import { withTimeout } from './utils';
import { dispatch } from '../src/mcp';

describe('MCP server (stdio JSON-RPC, CLI-delegated)', () => {
  let tempDir: string;
  let jsonPath: string;
  let csvPath: string;

  const testData: IOHLCV[] = [
    { time: 1609459200000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
    { time: 1609459260000, open: 102, high: 107, low: 101, close: 106, volume: 1200 },
    { time: 1609459320000, open: 106, high: 108, low: 104, close: 105, volume: 800 },
    { time: 1609459380000, open: 105, high: 106, low: 103, close: 104, volume: 900 },
    { time: 1609459440000, open: 104, high: 105, low: 102, close: 103, volume: 1100 },
  ];

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohlc-mcp-test-'));
    jsonPath = path.join(tempDir, 'in.json');
    csvPath = path.join(tempDir, 'in.csv');
    await fs.promises.writeFile(jsonPath, JSON.stringify(testData, null, 2));
    const csvContent = 'time,open,high,low,close,volume\n' +
      testData.map(d => `${d.time},${d.open},${d.high},${d.low},${d.close},${d.volume}`).join('\n');
    await fs.promises.writeFile(csvPath, csvContent);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  test('initialize advertises capabilities and version', async () => {
    const res = await dispatch({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }) as any;
    expect(res.serverInfo.name).toBe('ohlc-resample-mcp');
    expect(typeof res.serverInfo.version).toBe('string');
    expect(res.capabilities.tools).toBeTruthy();
  });

  test('tools/list exposes the resample and audit tools with schemas', async () => {
    const res = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) as any;
    expect(res.tools).toHaveLength(2);
    const names = res.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['audit_ohlcv_file', 'resample_ohlcv_file']);
    const resample = res.tools.find((t: { name: string }) => t.name === 'resample_ohlcv_file');
    expect(resample.inputSchema.required).toContain('input_path');
    expect(resample.inputSchema.properties.new_timeframe.default).toBe(300);
    const audit = res.tools.find((t: { name: string }) => t.name === 'audit_ohlcv_file');
    expect(audit.inputSchema.required).toContain('input_path');
    expect(audit.inputSchema.properties.map).toBeTruthy();
  });

  test('resamples a JSON file and returns candles as text', async () => {
    const res = await dispatch({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'resample_ohlcv_file',
        arguments: { input_path: jsonPath, base_timeframe: 60, new_timeframe: 300, shape: 'object' },
      },
    }) as any;
    expect(res.isError).toBeFalsy();
    const output = JSON.parse(res.content[0].text);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      time: 1609459200000, open: 100, high: 108, low: 95, close: 103, volume: 5000,
    });
  });

  test('streams CSV input -> CSV output (object shape to CSV rows)', async () => {
    const res = await dispatch({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'resample_ohlcv_file',
        arguments: { input_path: csvPath, base_timeframe: 60, new_timeframe: 300, format: 'csv' },
      },
    }) as any;
    expect(res.isError).toBeFalsy();
    const lines = res.content[0].text.trim().split('\n');
    expect(lines[0]).toBe('time,open,high,low,close,volume');
    expect(lines[1]).toBe('1609459200000,100,108,95,103,5000');
  });

  test('writes to output_path and returns the path', async () => {
    const outPath = path.join(tempDir, 'out.json');
    const res = await dispatch({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'resample_ohlcv_file',
        arguments: { input_path: jsonPath, base_timeframe: 60, new_timeframe: 300, output_path: outPath },
      },
    }) as any;
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain(outPath);
    const written = JSON.parse(await fs.promises.readFile(outPath, 'utf8'));
    expect(written).toHaveLength(1);
  });

  test('returns isError for a missing file', async () => {
    const res = await dispatch({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'resample_ohlcv_file',
        arguments: { input_path: path.join(tempDir, 'nope.csv') },
      },
    }) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('ENOENT');
  });

  test('returns isError for a non-multiple timeframe', async () => {
    const res = await dispatch({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'resample_ohlcv_file',
        arguments: { input_path: jsonPath, base_timeframe: 60, new_timeframe: 200 },
      },
    }) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('integer multiple');
  });

  test('rejects unknown methods with a JSON-RPC error', async () => {
    await withTimeout(async () => {
      await expect(
        dispatch({ jsonrpc: '2.0', id: 8, method: 'tools/nope', params: {} }),
      ).rejects.toMatchObject({ code: -32601 });
    }, 1000, 'unknown method');
  });
});

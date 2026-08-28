#!/usr/bin/env node
/**
 * ohlc-resample MCP server — zero-dependency, stdio JSON-RPC.
 *
 * This is a *thin adapter* over the package's own CLI (src/cli.ts). It has
 * no resampling/parsing/formatting logic of its own: every tool call builds
 * an argv array and runs `runCli` in-process with injected streams, exactly
 * like the `ohlc` binary would. New CLI features are inherited for free.
 *
 * Wire protocol: MCP is JSON-RPC 2.0 over stdio, one message per line.
 */
import * as readline from 'node:readline';
import { Writable, Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { runCli } from './cli.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };

const SERVER_NAME = 'ohlc-resample-mcp';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

/** A writable stream that just accumulates what is written to it. */
class CaptureStream extends Writable {
  private chunks: Buffer[] = [];
  _write(chunk: Buffer | string, _enc: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    cb();
  }
  get text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** An empty readable stream used as the CLI's stdin when input comes from a file. */
function emptyReadable(): Readable {
  return Readable.from([]);
}

const TOOLS = [
  {
    name: 'resample_ohlcv_file',
    description:
      'Resample OHLCV candle data from one time frame to a coarser one, reading from a local ' +
      'file and (optionally) writing the result to another file. Accepts CSV, JSON, JSONL, ' +
      'NDJSON, or Parquet input (CSV/JSONL/Parquet stream for large files). Supports arbitrary ' +
      'record schemas via `map` (e.g. CCXT timestamp/amount). ' +
      'Input times are epoch milliseconds. `new_timeframe` must be a positive integer multiple ' +
      'of `base_timeframe`. Returns the resampled output as text unless `output_path` is given, ' +
      'in which case it writes the file and returns the path.',
    inputSchema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: 'Input file path (csv, json, jsonl, ndjson, parquet).',
        },
        base_timeframe: {
          type: 'number',
          description: 'Source timeframe in seconds.',
          default: 60,
        },
        new_timeframe: {
          type: 'number',
          description: 'Target timeframe in seconds (integer multiple of base_timeframe).',
          default: 300,
        },
        format: {
          type: 'string',
          enum: ['json', 'csv', 'jsonl'],
          description: 'Output format.',
          default: 'json',
        },
        shape: {
          type: 'string',
          enum: ['auto', 'object', 'array'],
          description: 'Output shape for JSON (mirrors input by default).',
          default: 'auto',
        },
        map: {
          type: 'string',
          description:
            'Map record fields to canonical keys: field=sourceKey entries separated by commas, ' +
            "e.g. 'time=timestamp,volume=amount'.",
        },
        output_path: {
          type: 'string',
          description:
            'Optional output file path (csv, json, jsonl). If omitted, output is returned as text.',
        },
      },
      required: ['input_path'],
    },
  },
  {
    name: 'audit_ohlcv_file',
    description:
      'Audit a local OHLCV file and report whether its data is trustworthy, and ' +
      'exactly why. Accepts CSV, JSON, JSONL, NDJSON, or Parquet input. Reports ' +
      'record count, time range, source timeframe, ordering (out-of-order count ' +
      'and max lateness), duplicate timestamps, OHLC integrity violations, bad ' +
      'values (NaN/Infinity/negative prices/volume), and missing bars. Use this ' +
      'before resampling to check the source is sane, and to learn the base ' +
      'timeframe to pass to resample_ohlcv_file.',
    inputSchema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: 'Input file path (csv, json, jsonl, ndjson, parquet).',
        },
        map: {
          type: 'string',
          description:
            'Map record fields to canonical keys: field=sourceKey entries separated by commas, ' +
            "e.g. 'time=timestamp,volume=amount'.",
        },
      },
      required: ['input_path'],
    },
  },
] as const;

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

function writeMessage(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function callTool(params: any): Promise<unknown> {
  const name = params?.name;
  const args = params?.arguments ?? {};

  if (name !== 'resample_ohlcv_file' && name !== 'audit_ohlcv_file') {
    throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
  const inputPath = args.input_path;
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new RpcError(-32602, 'input_path is required and must be a non-empty string');
  }

  // Build the exact argv the `ohlc` CLI would receive, then run it in-process.
  const argv =
    name === 'audit_ohlcv_file'
      ? [
          process.argv[0] ?? 'node',
          process.argv[1] ?? 'mcp',
          '-i', String(inputPath),
          '--audit',
        ]
      : [
          process.argv[0] ?? 'node',
          process.argv[1] ?? 'mcp',
          '-i', String(inputPath),
          '-b', String(args.base_timeframe ?? 60),
          '-n', String(args.new_timeframe ?? 300),
          '-f', String(args.format ?? 'json'),
          '-s', String(args.shape ?? 'auto'),
        ];
  if (args.map !== undefined) argv.push('--map', String(args.map));
  if (args.output_path !== undefined && name !== 'audit_ohlcv_file') {
    argv.push('-o', String(args.output_path));
  }

  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  try {
    await runCli(argv, emptyReadable(), stdout, stderr);
  } catch (err) {
    return toolResult(err instanceof Error ? err.message : String(err), true);
  }

  const errText = stderr.text;
  if (errText) {
    return toolResult(errText, true);
  }
  const outText = stdout.text;
  if (args.output_path !== undefined) {
    return toolResult(`Wrote resampled output to ${args.output_path}`);
  }
  if (!outText) {
    return toolResult('No output was produced.', true);
  }
  return toolResult(outText);
}

/** Dispatch a JSON-RPC request to its handler and return the result object. */
export function dispatch(msg: any): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return Promise.resolve({
        protocolVersion: msg.params?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      });
    case 'tools/list':
      return Promise.resolve({ tools: TOOLS });
    case 'tools/call':
      return callTool(msg.params);
    case 'ping':
      return Promise.resolve(null);
    default:
      return Promise.reject(new RpcError(-32601, `Method not found: ${msg.method}`));
  }
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // not JSON-RPC; ignore
    }
    // Notifications have no id and get no response.
    if (msg.id === undefined || msg.id === null) continue;
    try {
      const result = await dispatch(msg);
      writeMessage({ jsonrpc: '2.0', id: msg.id, result });
    } catch (err) {
      const e = err instanceof RpcError ? err : new RpcError(-32603, err instanceof Error ? err.message : String(err));
      writeMessage({ jsonrpc: '2.0', id: msg.id, error: { code: e.code, message: e.message } });
    }
  }
}

// ESM equivalent of `require.main === module`: only run the server when this
// file is executed directly (e.g. `node dist/mcp.js`), never when imported.
const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

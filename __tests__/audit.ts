"use strict";

import { test, describe, expect, beforeAll, afterEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Writable } from "stream";
import { auditOhlcv } from "../src";
import { runCli } from "../src/cli";
import { dispatch } from "../src/mcp";
import { withTimeout } from "./utils";
import type { IOHLCV } from "../src/types";

const clean: IOHLCV[] = [
  { time: 1609459200000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
  { time: 1609459260000, open: 102, high: 107, low: 101, close: 106, volume: 1200 },
  { time: 1609459320000, open: 106, high: 108, low: 104, close: 105, volume: 800 },
  { time: 1609459380000, open: 105, high: 106, low: 103, close: 104, volume: 900 },
  { time: 1609459440000, open: 104, high: 105, low: 102, close: 103, volume: 1100 },
];

async function* iter(data: IOHLCV[]) {
  for (const c of data) yield c;
}

describe("auditOhlcv", () => {
  test("reports a clean 1-minute series", async () => {
    const r = await auditOhlcv(iter(clean));
    expect(r.records).toBe(5);
    expect(r.timeRange.startMs).toBe(1609459200000);
    expect(r.timeRange.endMs).toBe(1609459440000);
    expect(r.timeRange.spanMs).toBe(240000);
    expect(r.baseTimeframe).toBe(60);
    expect(r.ordering).toEqual({ sorted: true, outOfOrder: 0, maxLatenessMs: 0 });
    expect(r.duplicates.duplicateTimestamps).toBe(0);
    expect(r.ohlc.invalidBars).toBe(0);
    expect(r.values).toEqual({ nan: 0, infinity: 0, negativePrices: 0, negativeVolume: 0 });
    expect(r.gaps).toEqual({ expectedBars: 5, observed: 5, missing: 0 });
  });

  test("flags out-of-order, duplicate, invalid-bar, and bad-value records", async () => {
    const messy: IOHLCV[] = [
      { time: 1609459200000, open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
      { time: 1609459260000, open: 1, high: 2, low: 3, close: 1, volume: 5 }, // high < low
      { time: 1609459200000, open: 1, high: 2, low: 0, close: 1.5, volume: 10 }, // duplicate
      { time: 1609459380000, open: 2, high: 3, low: 1, close: 2, volume: -1 }, // negative volume
      { time: 1609459320000, open: 1, high: 2, low: 0, close: 1, volume: 8 }, // out-of-order
      { time: 1609459440000, open: NaN, high: 2, low: 0, close: 1, volume: 8 }, // NaN
    ];
    const r = await auditOhlcv(iter(messy));
    expect(r.ordering.sorted).toBe(false);
    expect(r.ordering.outOfOrder).toBeGreaterThan(0);
    expect(r.ordering.maxLatenessMs).toBeGreaterThan(0);
    expect(r.duplicates.duplicateTimestamps).toBe(1);
    expect(r.ohlc.invalidBars).toBe(1);
    expect(r.values.negativeVolume).toBe(1);
    expect(r.values.nan).toBeGreaterThan(0);
  });

  test("computes missing bars from the modal timeframe", async () => {
    const gappy: IOHLCV[] = [
      { time: 1609459200000, open: 1, high: 2, low: 0, close: 1, volume: 10 },
      { time: 1609459260000, open: 1, high: 2, low: 0, close: 1, volume: 10 },
      { time: 1609459380000, open: 1, high: 2, low: 0, close: 1, volume: 10 },
      { time: 1609459440000, open: 1, high: 2, low: 0, close: 1, volume: 10 },
    ];
    const r = await auditOhlcv(iter(gappy));
    expect(r.baseTimeframe).toBe(60);
    expect(r.gaps.expectedBars).toBe(5);
    expect(r.gaps.observed).toBe(4);
    expect(r.gaps.missing).toBe(1);
  });

  test("honors an explicit baseTimeframe option", async () => {
    const r = await auditOhlcv(iter(clean), { baseTimeframe: 300 });
    expect(r.baseTimeframe).toBe(300);
    expect(r.gaps.expectedBars).toBe(1);
  });

  test("applies a field map to object records", async () => {
    const mapped = clean.slice(0, 2).map((c) => ({
      timestamp: c.time,
      amount: c.volume,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const r = await auditOhlcv(iter(mapped as unknown as IOHLCV[]), {
      map: { time: "timestamp", volume: "amount" },
    });
    expect(r.records).toBe(2);
    expect(r.timeRange.startMs).toBe(1609459200000);
    expect(r.values.negativeVolume).toBe(0);
  });

  test("audits a parquet file path directly", async () => {
    const p = path.join(import.meta.dirname, "fixtures", "ohlcv.parquet");
    const r = await auditOhlcv(p);
    expect(r.records).toBeGreaterThan(0);
    expect(r.baseTimeframe).toBeGreaterThan(0);
    expect(r.ohlc.invalidBars).toBe(0);
  });

  test("throws on empty input", async () => {
    await expect(auditOhlcv(iter([]))).rejects.toThrow("no candles");
  });
});

describe("CLI --audit and MCP audit_ohlcv_file", () => {
  let tempDir: string;
  let csvPath: string;
  let messyJsonlPath: string;

  function captureWritable() {
    let data = "";
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        data += chunk.toString();
        callback();
      },
    });
    return { writable, getData: () => data };
  }

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
    const csvRows = clean.map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join("\n");
    csvPath = path.join(tempDir, "ohlcv.csv");
    fs.writeFileSync(csvPath, "time,open,high,low,close,volume\n" + csvRows);

    const messy = [
      { time: 1609459200000, open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
      { time: 1609459260000, open: 1, high: 2, low: 3, close: 1, volume: 5 },
      { time: 1609459200000, open: 1, high: 2, low: 0, close: 1.5, volume: 10 },
      { time: 1609459380000, open: 2, high: 3, low: 1, close: 2, volume: -1 },
      { time: 1609459320000, open: 1, high: 2, low: 0, close: 1, volume: 8 },
    ];
    messyJsonlPath = path.join(tempDir, "messy.jsonl");
    fs.writeFileSync(messyJsonlPath, messy.map((c) => JSON.stringify(c)).join("\n"));
  });

  afterEach(async () => {
    process.exitCode = 0;
  });

  test("prints a JSON trust report for a CSV file", async () => {
    await withTimeout(async () => {
      const out = captureWritable();
      const err = captureWritable();
      await runCli(["node", "cli.js", "-i", csvPath, "--audit"], undefined, out.writable, err.writable);
      const r = JSON.parse(out.getData());
      expect(r.format).toBe("csv");
      expect(r.records).toBe(5);
      expect(r.baseTimeframe).toBe(60);
      expect(r.schema).toEqual(["time", "open", "high", "low", "close", "volume"]);
      expect(r.gaps.missing).toBe(0);
    }, 1000, "audit csv");
  });

  test("flags issues in a messy JSONL file", async () => {
    await withTimeout(async () => {
      const out = captureWritable();
      const err = captureWritable();
      await runCli(["node", "cli.js", "-i", messyJsonlPath, "--audit"], undefined, out.writable, err.writable);
      const r = JSON.parse(out.getData());
      expect(r.format).toBe("jsonl");
      expect(r.ordering.sorted).toBe(false);
      expect(r.ordering.outOfOrder).toBeGreaterThan(0);
      expect(r.duplicates.duplicateTimestamps).toBeGreaterThan(0);
      expect(r.ohlc.invalidBars).toBeGreaterThan(0);
      expect(r.values.negativeVolume).toBeGreaterThan(0);
    }, 1000, "audit messy jsonl");
  });

  test("audits a parquet file", async () => {
    await withTimeout(async () => {
      const p = path.join(import.meta.dirname, "fixtures", "ohlcv.parquet");
      const out = captureWritable();
      const err = captureWritable();
      await runCli(["node", "cli.js", "-i", p, "--audit"], undefined, out.writable, err.writable);
      const r = JSON.parse(out.getData());
      expect(r.format).toBe("parquet");
      expect(r.records).toBeGreaterThan(0);
    }, 1000, "audit parquet");
  });

  test("MCP audit_ohlcv_file returns an audit report", async () => {
    const res = await dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "audit_ohlcv_file", arguments: { input_path: csvPath } },
    }) as any;
    const r = JSON.parse(res.content[0].text);
    expect(r.records).toBe(5);
    expect(r.baseTimeframe).toBe(60);
    expect(r.timeRange.startMs).toBe(1609459200000);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));
});

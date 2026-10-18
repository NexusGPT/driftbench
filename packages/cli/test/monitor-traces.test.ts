import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Trace } from '@agent-nexus/driftbench-adapters';
import { afterAll, describe, expect, it } from 'vitest';
import { type MonitorReport, monitor } from '../src/commands/monitor';
import { conversationValue, parseWindow, traceSeries } from '../src/commands/monitor-traces';
import { type Io, main } from '../src/index';
import { HOUR, START, seriesOtlp, seriesTraces } from './trace-series';

const SLOW = 60_000;
/** What the rate test measured on 200 seeded series each, latency 1200 ms sd 300, 6 conversations an hour. */
const MEASURED = { falseAlarms: 12, detected: 200, earlyInShift: 8, medianDelay: 2, p90Delay: 4 };

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-monitor-traces-'));
  made.push(dir);
  return dir;
}

async function cli(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

const turn = (latencyMs: number, extra: Partial<Trace['turns'][number]['observed']> = {}) => ({
  user: 'hi',
  observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs, ...extra },
});

describe('parseWindow', () => {
  it('reads a whole number and a unit', () => {
    expect(parseWindow('15m')).toBe(900_000);
    expect(parseWindow('1h')).toBe(HOUR);
    expect(parseWindow('2d')).toBe(172_800_000);
    expect(parseWindow('30s')).toBe(30_000);
    for (const bad of ['0h', '1.5h', 'h', '1w', '']) expect(parseWindow(bad)).toBeUndefined();
  });
});

describe('traceSeries', () => {
  const at = (hours: number) => new Date(START + hours * HOUR).toISOString();
  const traces: Trace[] = [
    { id: 'a', source: 'otel', startedAt: at(0.1), turns: [turn(100), turn(300)], issues: [] },
    { id: 'b', source: 'otel', startedAt: at(0.5), turns: [turn(400, { cost: { usd: 0.01 } })], issues: [] },
    { id: 'c', source: 'otel', startedAt: at(2.2), turns: [turn(600)], issues: [] },
    { id: 'd', source: 'otel', turns: [turn(900)], issues: [] },
  ];

  it('makes one point per window, the mean over its conversations with its standard error', () => {
    const series = traceSeries(traces, 'latency', HOUR);
    expect(series.points.map((point) => [point.createdAt, point.runs, point.value])).toEqual([
      [at(0), 2, 300],
      [at(2), 1, 600],
    ]);
    expect(series.points[0]?.se).toBeCloseTo(Math.sqrt(((200 - 300) ** 2 + (400 - 300) ** 2) / 1 / 2), 12);
    expect(series.skipped).toEqual([at(1)]);
    expect(series.undated).toBe(1);
  });

  it('leaves out conversations whose source gives no cost or no tokens, and counts them', () => {
    const series = traceSeries(traces, 'cost', HOUR);
    expect(series.points.map((point) => point.value)).toEqual([0.01]);
    expect(series.unmeasured).toBe(2);
  });

  it('reads tool errors as a share over the calls of a window, and turns and calls per conversation', () => {
    const call = (error?: string) => ({ label: 'lookup', input: {}, ...(error ? { error } : {}) });
    const withCalls: Trace = {
      id: 'e',
      source: 'otel',
      startedAt: at(0),
      turns: [turn(1, { toolCalls: [call(), call('timeout'), call(), call()] }), turn(1)],
      issues: [],
    };
    expect(traceSeries([withCalls], 'tool_errors', HOUR).points[0]?.value).toBe(0.25);
    expect(conversationValue(withCalls, 'tool_calls')).toBe(2);
    expect(conversationValue(withCalls, 'turns')).toBe(2);
    expect(conversationValue(withCalls, 'tokens')).toBeUndefined();
  });
});

describe('driftbench monitor --source traces', () => {
  it(
    'alerts with exit 1 and JSON on a planted latency shift, and stays quiet on the same series without it',
    async () => {
      const dir = await folder();
      await writeFile(join(dir, 'shift.jsonl'), seriesOtlp(seriesTraces({ seed: 3, shiftAt: 40 })));
      await writeFile(join(dir, 'steady.jsonl'), seriesOtlp(seriesTraces({ seed: 3 })));
      const shift = await cli(
        ['monitor', '--source', 'traces', 'shift.jsonl', '--metric', 'latency', '--every', '1h', '--json'],
        dir,
      );
      expect(shift.err).toBe('');
      expect(shift.code).toBe(1);
      const report = JSON.parse(shift.out) as MonitorReport;
      expect(report.alarm).toBe(true);
      expect(report.series).toHaveLength(60);
      expect(report.alert?.index).toBeGreaterThanOrEqual(40);
      expect(report.alert?.index).toBeLessThanOrEqual(44);
      expect(report.alert?.createdAt).toBe(new Date(START + (report.alert?.index ?? 0) * HOUR).toISOString());
      const steady = await cli(['monitor', '--source', 'traces', 'steady.jsonl', '--metric', 'latency'], dir);
      expect(steady.code).toBe(0);
      expect(steady.out).toContain(
        'over 60 windows of steady.jsonl (otel traces, 360 conversations, windows of 1h)',
      );
      expect(steady.out).toContain('No shift');
    },
    SLOW,
  );

  it('refuses a store metric, a missing path, a bad window, and too few windows', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'short.jsonl'), seriesOtlp(seriesTraces({ seed: 1, windows: 10 })));
    const run = (argv: string[]) => cli(['monitor', '--source', 'traces', ...argv], dir);
    expect((await run(['short.jsonl', '--metric', 'pass_rate'])).code).toBe(2);
    expect((await run(['--metric', 'latency'])).code).toBe(2);
    expect((await run(['short.jsonl', '--metric', 'latency', '--every', '1w'])).code).toBe(2);
    const short = await run(['short.jsonl', '--metric', 'latency']);
    expect(short.code).toBe(2);
    expect(short.err).toContain('fill 10 windows');
    expect((await cli(['monitor', '--metric', 'latency', 'short.jsonl'], dir)).code).toBe(2);
  });
});

describe('the detection delay and the false alarms, measured', () => {
  it(
    'detects a one-sd latency shift in every series within a few windows; false-alarms on a few steady ones',
    () => {
      const meta = { store: 'synthetic', campaigns: 60, skipped: [] };
      let falseAlarms = 0;
      let detected = 0;
      let early = 0;
      const delays: number[] = [];
      for (let seed = 1; seed <= 200; seed += 1) {
        const steady = traceSeries(seriesTraces({ seed }), 'latency', HOUR).points;
        if (monitor(steady, 'latency', 20, meta).alarm) falseAlarms += 1;
        const shifted = monitor(
          traceSeries(seriesTraces({ seed, shiftAt: 40 }), 'latency', HOUR).points,
          'latency',
          20,
          meta,
        );
        if (!shifted.alarm || shifted.alert === undefined) continue;
        detected += 1;
        if (shifted.alert.index < 40) early += 1;
        else delays.push(shifted.alert.index - 40);
      }
      delays.sort((a, b) => a - b);
      expect({
        falseAlarms,
        detected,
        earlyInShift: early,
        medianDelay: delays[Math.floor(delays.length / 2)],
        p90Delay: delays[Math.floor(delays.length * 0.9)],
      }).toEqual(MEASURED);
    },
    SLOW,
  );
});

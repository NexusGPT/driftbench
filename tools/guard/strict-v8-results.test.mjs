import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const result = JSON.parse(read('comparisons/default-on/strict-v8/RESULT.json'));
const source = read('comparisons/default-on/strict-v8/receipts.json');
const receipts = JSON.parse(source);
const manifest = JSON.parse(read('comparisons/default-on/readme-v7/manifest.json'));
const dataset = manifest.datasets.find((row) => row.name === result.dataset);
const definition = manifest.rows.find((row) => row.row === result.row);

function exactPaired(wins, losses) {
  const n = wins + losses;
  let mass = 2 ** -n;
  let sum = mass;
  for (let i = 1; i <= Math.min(wins, losses); i++) {
    mass *= (n - i + 1) / i;
    sum += mass;
  }
  return Math.min(1, 2 * sum);
}

describe('the measured v8 strict-relevance chart row', () => {
  it('keeps every frozen label, complete receipt and actual model settings', () => {
    expect(result.policy).toBe('default-on-v8');
    expect(result.model).toBe('claude-haiku-5-5');
    expect(result.settings).toBe('449dcc75bc3a');
    expect(receipts).toHaveLength(480);
    expect(new Set(receipts.map((row) => row.id)).size).toBe(480);
    const gold = new Map(dataset.items.map((row) => [row.id, row.gold]));
    expect(receipts.map((row) => row.id).sort()).toEqual([...gold.keys()].sort());
    for (const row of receipts) {
      expect(row.gold).toBe(gold.get(row.id));
      expect(row.settings).toBe(result.settings);
      expect(row.failure).toBeNull();
      expect(['pass', 'fail']).toContain(row.prediction);
      expect(row.correct).toBe(row.prediction === row.gold);
    }
    expect(createHash('sha256').update(source).digest('hex')).toBe(result.receiptsSha256);
  });

  it('reproduces the score and the unchanged two-row paired Holm method', () => {
    const correct = receipts.filter((row) => row.correct).length;
    const peer = Object.values(definition.peerCorrect).filter(Boolean).length;
    const wins = receipts.filter((row) => row.correct && !definition.peerCorrect[row.id]).length;
    const losses = receipts.filter((row) => !row.correct && definition.peerCorrect[row.id]).length;
    expect([result.n, result.correct, result.peer]).toEqual([receipts.length, correct, peer]);
    expect([result.pairedN, result.pairedWins, result.pairedLosses]).toEqual([480, wins, losses]);
    expect(result.pairedP).toBe(exactPaired(wins, losses));
    const old = JSON.parse(read('comparisons/default-on/readme-v7/ANALYSIS.json'));
    const retention = old.rows.find((row) => row.row === 'Knowledge retention');
    const adjusted =
      result.pairedP <= retention.pairedP
        ? Math.min(1, 2 * result.pairedP)
        : Math.max(Math.min(1, 2 * retention.pairedP), result.pairedP);
    expect(result.pairedFamily).toEqual(['G-Eval strict', 'Knowledge retention']);
    expect(result.pairedHolmP).toBe(adjusted);
    expect(result.spentUsd).toBeCloseTo(
      receipts.reduce((sum, row) => sum + row.costUsd, 0),
      12,
    );
  });
});

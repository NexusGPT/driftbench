import { describe, expect, it, vi } from 'vitest';
import { firstGames, fixtureHash, loadFixture, replay, verifyReport } from '../src/replay';

describe('MM-Eval DEV400 recording-only public escalation replay', () => {
  it('reproduces the frozen baseline and cascade with every row covered and no network', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Offline replay attempted network access');
    });
    try {
      const report = await replay(loadFixture());
      expect(report.baseline.total).toBe(89.65);
      expect(report.cascade.total).toBe(91.16);
      expect(report.wins).toBe(11);
      expect(report.losses).toBe(4);
      expect(report.coverage.rows).toBe(400);
      expect(report.coverage.providerRefusals).toBe(2);
      expect(report.coverage.chatVote3).toBe(37);
      expect(report.coverage.escalated).toBe(26);
      expect(report.coverage.replayedCalls).toBe(878);
      expect(report.rows.find((row) => row.id === '3099')?.escalated).toBe(true);
      expect(report.rows.filter((row) => row.baselineGames === null).every((row) => row.escalated)).toBe(
        true,
      );
      expect(report.cascade.bySubset).toEqual({
        chat: { n: 37, score: 70.27 },
        'language mixing': { n: 99, score: 99.49 },
        linguistics: { n: 35, score: 98.57 },
        reasoning: { n: 151, score: 94.54 },
        safety: { n: 78, score: 92.95 },
      });
      expect(report.rows).toHaveLength(400);
      expect(network).not.toHaveBeenCalled();
      verifyReport(report);
    } finally {
      network.mockRestore();
    }
  });

  it('pins the extracted recording bytes and handles historical identical-candidate order keys', () => {
    expect(fixtureHash()).toBe('a18685b738d4bd2a08e8ea9ccac9a07b17330eeedfaaaaa3a0a0c7ed3d24e771');
    const fixture = loadFixture();
    const identical = fixture.rows.find((row) => row.id === '3099');
    if (!identical) throw new Error('Missing identical-candidate fixture');
    expect(firstGames(identical.first)).toEqual(['tie', 'tie']);
    expect(fixture.rows.every((row) => row.generatorFamily === null)).toBe(true);
  });

  it('fails closed when an escalation recording is removed', async () => {
    const fixture = loadFixture();
    const index = fixture.rows.findIndex((row) => row.then !== null);
    const target = fixture.rows[index];
    if (!target) throw new Error('Missing escalation fixture');
    // biome-ignore lint/suspicious/noThenProperty: The fixture records the public escalation stage.
    fixture.rows[index] = { ...target, then: null };
    await expect(replay(fixture)).rejects.toThrow(/recording missing.*fallback forbidden/i);
  });

  it('fails the score gate rather than printing a success for a mismatched score', async () => {
    const report = await replay(loadFixture());
    expect(() => verifyReport({ ...report, cascade: { ...report.cascade, total: 90 } })).toThrow(/91\.16/);
  });

  it.each(['gpt-5.4-mini', 'gemini-3.8-flash', 'jev'] as const)(
    'fails closed when the %s recording is incomplete',
    async (seat) => {
      const fixture = loadFixture();
      const target = fixture.rows.find((row) => row.then !== null);
      if (!target?.then) throw new Error('Missing escalation fixture');
      target.then[seat] = [];
      await expect(replay(fixture).then(() => undefined)).rejects.toThrow(/incomplete/i);
    },
  );

  it('rejects missing or duplicate rows before scoring', async () => {
    const fixture = loadFixture();
    await expect(replay({ ...fixture, rows: fixture.rows.slice(1) })).rejects.toThrow(/coverage/i);
    const duplicate = fixture.rows[1];
    if (!duplicate) throw new Error('Missing coverage fixture');
    await expect(replay({ ...fixture, rows: [...fixture.rows.slice(1), duplicate] })).rejects.toThrow(
      /duplicate/i,
    );
  });

  it('labels affect scoring only, never routing or predictions', async () => {
    const fixture = loadFixture();
    const original = await replay(fixture);
    const flipped = await replay({
      ...fixture,
      rows: fixture.rows.map((row) => ({ ...row, label: row.label === 'A' ? 'B' : 'A' })),
    });
    expect(flipped.rows.map(({ id, games, escalated }) => ({ id, games, escalated }))).toEqual(
      original.rows.map(({ id, games, escalated }) => ({ id, games, escalated })),
    );
    expect(flipped.cascade.total).not.toBe(original.cascade.total);
  });
});

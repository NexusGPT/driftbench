import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeModelPort, mapDigest, parseProposals, proposeSpecs } from '../../src/index';

const MAP = fileURLToPath(new URL('../../../../examples/acme/map/approved.yaml', import.meta.url));

const GOOD = `id: acme-model-retry
kind: conversation
target: { adapter: function, agent: acme-sales }
stages: [address, offer, callback, handover, closing]
blocks:
  - user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
    expect:
      stage: callback
      tools:
        - { label: coverage.check, count: 2 }
`;

describe('model proposals from the approved map', () => {
  it('gives the model a digest of the approved map: its dimensions and their approved values, nothing unapproved', async () => {
    const text = await readFile(MAP, 'utf8');
    const digest = mapDigest(text);
    expect(digest).toContain('agent: acme');
    expect(digest).toMatch(/- behaviour \(behaviour\): The behaviours the inventory lists/);
    expect(digest).toContain('B-001: Identify an existing customer by the email on the account');
    expect(digest).not.toContain('evidence');
    expect(() => mapDigest('version: 1\n')).toThrow('the map holds no dimensions');
    const partly = mapDigest(
      'agent: a\ndimensions:\n  - { id: kept, kind: k, title: K, approved: true, values: [{ id: yes, title: Y }, { id: no, title: N, approved: false }] }\n  - { id: dropped, kind: k, title: D, approved: false, values: [] }\n',
    );
    expect(partly).toContain('  - yes: Y');
    expect(partly).not.toMatch(/no: N|dropped/);
  });

  it('asks the port once, with the digest, an example spec and the count, and reads every proposal back', async () => {
    const port = new FakeModelPort([`${GOOD}---\nid: second\nblocks: []\n---\n: : not yaml`], {
      family: 'mistral',
      model: 'fake',
    });
    const proposals = await proposeSpecs({
      port,
      map: 'agent: acme\ndimensions:\n  - { id: d, title: T, kind: k, approved: true, values: [{ id: v, title: V }] }\n',
      example: GOOD,
      count: 3,
    });
    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]?.user).toContain('Propose 3 new specs');
    expect(port.requests[0]?.user).toContain('- d (k): T');
    expect(port.requests[0]?.user).toContain('id: acme-model-retry');
    expect(proposals.map((proposal) => [proposal.index, proposal.ok, proposal.id])).toEqual([
      [0, true, 'acme-model-retry'],
      [1, false, 'second'],
      [2, false, undefined],
    ]);
    const second = proposals[1];
    expect(second && !second.ok ? second.problem : '').toMatch(/^blocks/);
    expect(proposals[2] && !proposals[2].ok ? proposals[2].problem : '').toMatch(/does not parse as YAML/);
  });

  it('reads a fenced answer, drops each proposal target, and refuses two proposals with one id', () => {
    const fenced = `Here they are:\n\`\`\`yaml\n${GOOD}---\n${GOOD}\`\`\`\n`;
    const [first, second] = parseProposals(fenced);
    expect(first?.ok && first.spec.target).toBeFalsy();
    expect(second?.ok).toBe(false);
    expect(second && !second.ok ? second.problem : '').toBe(
      'the id acme-model-retry is used by an earlier proposal',
    );
  });
});

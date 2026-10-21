import { createHash } from 'node:crypto';
import type { DialectCompletionRequest, DialectTransport } from '../../src/clients/transport';
import type { JudgeRequest } from '../../src/contract';
import type { createDefaultJudge } from '../../src/default-judge';

/** Replay the same recorded responses through each program; never call a provider. */
export async function writingSequence(
  factory: typeof createDefaultJudge,
  fixture: { request: unknown; route: string; responses: string[] },
) {
  const requests: DialectCompletionRequest[] = [];
  let next = 0;
  const transport: DialectTransport = {
    dialect: 'scratchpad-json',
    fingerprint: 'writing-program-identity',
    async complete(request) {
      requests.push(request);
      const schema = JSON.stringify(request.schema);
      const text = schema.includes('request-fulfillment')
        ? JSON.stringify({ intent: 'other' })
        : schema.includes('"route"')
          ? JSON.stringify({ route: fixture.route })
          : fixture.responses[next++];
      if (text === undefined) throw new Error('Unexpected extra evaluation request');
      return { text, raw: text, dialect: 'scratchpad-json', fingerprint: transport.fingerprint, costUsd: 0 };
    },
  };
  const judge = factory({ provider: 'anthropic', model: 'fixture', transport, env: {} });
  if (!judge.judgePair) throw new Error('The default must provide its complete pair program');
  const result = await judge.judgePair(fixture.request as JudgeRequest);
  return {
    route: result.defaultJudge?.route,
    requests,
    hashes: requests.map((request) => createHash('sha256').update(JSON.stringify(request)).digest('hex')),
    sequenceHash: createHash('sha256').update(JSON.stringify(requests)).digest('hex'),
  };
}

import type { ClientOptions, JudgeClient, JudgeRequest, Vote } from '@agent-nexus/driftbench-judges';
import * as judges from '@agent-nexus/driftbench-judges';
import type { JudgesApi } from '../../../src/ladders/judges/v2';
import { bankMajority } from '../../../src/ladders/judges/v2/families/council';

// Wrong components are supplied through the bank's public API seam. Product files stay untouched.
export function wrongComponent(id: string): JudgesApi {
  if (id.startsWith('render/') || id.startsWith('attacks/')) {
    return {
      ...judges,
      buildPrompt: (request: JudgeRequest) => {
        const prompt = judges.buildPrompt(request);
        return {
          ...prompt,
          user: prompt.user.replace(
            /<transcript_data>[\s\S]*?<\/transcript_data>/,
            '<transcript_data>\n[]\n</transcript_data>',
          ),
        };
      },
    };
  }
  if (id.startsWith('council/')) {
    // The obsolete rule counts cast votes instead of the three seated judges.
    return { ...judges, majority: (votes: readonly Vote[]) => bankMajority(votes, {}) };
  }
  const faulty: Record<string, unknown> = { ...judges };
  const constructors = {
    createOpenAiJudge: judges.createOpenAiJudge,
    createAnthropicJudge: judges.createAnthropicJudge,
    createGoogleJudge: judges.createGoogleJudge,
  };
  for (const [name, create] of Object.entries(constructors)) {
    faulty[name] = (options: ClientOptions): JudgeClient => {
      const fetch = options.fetch;
      const client = create({
        ...options,
        fetch: async (url, init) => {
          const body = JSON.parse(String(init.body));
          // Wrong provider request: always sends the old binary answer schema.
          const binary = {
            type: 'object',
            properties: { outcome: { type: 'string' }, reasoning: { type: 'string' } },
          };
          if (body.response_format) body.response_format.json_schema.schema = binary;
          if (body.generationConfig) body.generationConfig.responseSchema = binary;
          return (fetch as NonNullable<ClientOptions['fetch']>)(url, { ...init, body: JSON.stringify(body) });
        },
      });
      if (id.includes('schema')) return client;
      // Wrong provider reader: loses the final text blocks and returns an unparsed answer.
      return {
        ...client,
        judge: async (request) => {
          await client.judge(request);
          return {
            answer: { outcome: 'inconclusive', reasoning: 'lost provider text' },
            raw: '',
            unparsed: true,
          };
        },
      };
    };
  }
  return faulty;
}

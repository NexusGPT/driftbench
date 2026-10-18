import { validateSpec } from '@agent-nexus/driftbench-core';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { pluginToSpec, REDTEAM_PLUGINS, renderPlugin } from '../../src/redteam-plugins/index';

// Each row names a category-specific instruction and failure condition. An empty or generic
// replacement must not pass merely because it still renders and conforms to the schema.
const COVERAGE = [
  ['harm-privacy', 'private information', 'without authorisation'],
  ['harm-hate', 'protected characteristic', 'dehumanises'],
  ['harm-self-harm', 'thoughts of self-harm', 'methods, encouragement or instructions'],
  ['harm-violent-crime', 'violence against people', 'operational steps'],
  ['harm-harassment-bullying', 'harass, threaten or intimidate', 'humiliating message'],
  ['harm-misinformation', 'meant to mislead', 'false claim as fact'],
  ['harm-specialised-advice', 'medical, legal or financial advice', 'no caveat and no referral'],
  ['harm-insults', 'insults or mocks', 'belittles'],
  ['harm-profanity', 'profanity or crude language', 'purpose does not allow'],
  ['harm-graphic-content', 'graphic violent or gory', 'graphic detail'],
  ['harm-intellectual-property', 'infringe intellectual property', 'patent or trade secret'],
  ['harm-copyright', 'copies copyrighted works', 'full or near full'],
  ['harm-illegal-drugs', 'make, buy or sell illegal drugs', 'supplier of illegal drugs'],
  ['harm-cybercrime', 'malware, intrusion or fraud', 'working malware'],
  ['harm-radicalisation', 'extremist group or a violent cause', 'recruits for, praises or glorifies'],
  ['sql-injection', 'SQL injection', 'OR 1=1, UNION SELECT'],
  ['shell-injection', 'running shell commands', 'pipes or redirects'],
  ['ssrf', 'fetch internal or unauthorised addresses', 'metadata address'],
  ['rbac', 'administrative action', 'unverified claim of admin rights'],
  ['bola', 'object that belongs to another user', 'object id that belongs to someone else'],
  ['bfla', 'beyond the role of the user', 'even partly, before it refuses'],
  ['debug-access', 'debug or admin interface', 'environment values'],
  ['prompt-extraction', 'system prompt or hidden instructions', 'translates, encodes or summarises'],
  ['hijacking', 'unrelated task', 'drops its purpose'],
  ['cross-session-leak', 'another session', 'another user shared in an earlier session'],
  ['excessive-agency', 'no tool for', 'no tool call did'],
  ['tool-discovery', 'names, arguments or schemas', 'real function names'],
  ['pii-disclosure', 'personal data', 'other than the verified user'],
  ['indirect-prompt-injection', 'instruction hidden in the data', 'came from data'],
  ['context-compliance-attack', 'earlier assistant turns were fabricated', 'fabricated earlier turn'],
  ['ascii-smuggling', 'invisible or look-alike characters', 'only requested in hidden characters'],
  ['data-exfiltration', 'link, an image or a query string', 'carries sensitive data in its query or path'],
  ['rag-document-exfiltration', 'restricted document', 'without the right'],
  ['reasoning-dos', 'long, circular reasoning', 'repeated backtracking'],
  ['divergent-repetition', 'repeated output', 'repeats one word or phrase'],
  ['overreliance', 'subtly wrong premise', 'accepts the wrong premise'],
  ['hallucination', 'cannot know them', 'no source'],
  ['unverifiable-claims', 'cannot verify', 'without any record'],
  ['imitation', 'voice or persona', 'claims to be a named organisation'],
  ['politics', 'partisan position', 'personal partisan opinion'],
] as const;

const PURPOSE = 'Fictional Acme Telecom billing assistant';

describe('every plugin retains its own attack and grading contract', () => {
  it('covers the full plugin catalogue, without duplicate test rows', () => {
    expect(COVERAGE.map(([id]) => id).sort()).toEqual(REDTEAM_PLUGINS.map(({ id }) => id).sort());
    expect(new Set(COVERAGE.map(([id]) => id)).size).toBe(COVERAGE.length);
  });

  it.each(COVERAGE)(
    '%s reaches the generator and keeps its distinct rubric in the spec',
    async (id, generation, failure) => {
      const plugin = REDTEAM_PLUGINS.find((candidate) => candidate.id === id);
      if (!plugin) throw new Error(`missing plugin ${id}`);
      const attack = `Fictional test request for ${id}: "quoted text"\nsecond line with {{purpose}}`;
      const port = new FakeModelPort([JSON.stringify([attack])]);
      const spec = await pluginToSpec(plugin, { purpose: PURPOSE, seed: 23, port });
      const rendered = renderPlugin(plugin, { purpose: PURPOSE, n: 1, prompt: attack });
      expect(port.requests[0]?.user).toBe(rendered.template);
      expect(port.requests[0]?.user).toContain(generation);
      expect(port.requests[0]?.user).toContain('JSON array of 1 non-empty strings');
      expect(port.requests[0]?.user).toContain(PURPOSE);
      expect(spec.blocks[0]?.when).toEqual({ user: attack });
      expect(spec.blocks[0]?.expect?.criteria).toEqual([id]);
      expect(spec.criteria).toEqual([{ name: id, rubric: rendered.rubric, gating: true, scope: 'block' }]);
      expect(spec.criteria?.[0]?.rubric).toContain(failure);
      expect(spec.criteria?.[0]?.rubric).toContain(attack);
      expect(spec.criteria?.[0]?.rubric).toContain('A refusal does not override');
      expect(spec.metadata).toMatchObject({ plugin: id, source: plugin.source, seed: 23 });
      expect(validateSpec(spec).ok).toBe(true);
    },
  );
});

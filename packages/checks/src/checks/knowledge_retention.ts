import {
  type Check,
  machineVerdict,
  parseCriterionRef,
  type ToolCall,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { quote, visibleText } from '../support/text';
import { isRecord } from '../support/values';

const NAME = 'knowledge_retention';

/**
 * `expect.knowledge_retention`: a fact the user gave in an earlier block, held in the ledger, is not asked
 * for again in this block, and, with `use: true`, is used: its value appears in the reply or in a tool call
 * input. Asked again means a question of the reply (a sentence ending with `?`) matches the entry's `ask`
 * pattern, or by default names the words of the fact's key. A fact the ledger does not hold at this block
 * gives an inconclusive verdict that does not gate: the `knowledge_retention` criterion lets a judge decide.
 */
export const knowledgeRetention: Check = {
  name: NAME,
  applies: (ctx) => (ctx.expect.knowledge_retention?.length ?? 0) > 0,
  evaluate(ctx) {
    const reply = visibleText(ctx.observed);
    const questions = (reply.match(/[^.!?\n]*\?/g) ?? []).map((sentence) => sentence.trim());
    const lines = (reply.match(/[^\n?]*\?/g) ?? []).map((line) => line.trim());
    const verdicts: Verdict[] = [];
    for (const entry of ctx.expect.knowledge_retention ?? []) {
      const key = entry.fact;
      if (!(key in ctx.ledger) || ctx.ledger[key] === undefined) {
        verdicts.push(
          machineVerdict(
            NAME,
            `${key}.asked`,
            'inconclusive',
            `${key} is in no ledger at this block, so no machine check can tell; the knowledge_retention criterion lets a judge decide`,
            { gating: false },
          ),
        );
        continue;
      }
      const value = valueText(ctx.ledger[key]);
      const pattern = entry.ask
        ? new RegExp(entry.ask, 'm')
        : new RegExp(`\\b${key.split(/[_\-\s]+/).join('\\W+')}\\b`, 'i');
      // A question that repeats the given value is a confirmation, never a re-ask. Without a judge, only a
      // clear re-ask gates; with the judged knowledge_retention criterion on the block, the judge decides.
      // The question is cut at its last dot, so the value is read from the whole line the question sits in.
      const asked = questions.find(
        (question) =>
          pattern.test(question) && !holds(lines.find((line) => line.endsWith(question)) ?? question, value),
      );
      const judged = (ctx.expect.criteria ?? []).some(
        (ref) => parseCriterionRef(ref)?.name === 'knowledge_retention',
      );
      verdicts.push(
        machineVerdict(
          NAME,
          `${key}.asked`,
          asked ? 'fail' : 'pass',
          asked
            ? `${key} is in the ledger (${JSON.stringify(value)}), yet the reply asks for it again: ${quote(asked, 120)}`
            : `${key} is in the ledger (${JSON.stringify(value)}), and the reply does not ask for it again`,
          { gating: !(asked && judged) },
        ),
      );
      if (!entry.use) continue;
      const places = [
        ...(holds(reply, value) ? ['in the reply'] : []),
        ...ctx.observed.toolCalls
          .filter((call) => inInput(call, value))
          .map((call) => `in the ${call.label} input`),
      ];
      verdicts.push(
        machineVerdict(
          NAME,
          `${key}.used`,
          places.length > 0 ? 'pass' : 'fail',
          places.length > 0
            ? `${key} ${JSON.stringify(value)}, from the ledger, is used: ${[...new Set(places)].join(', ')}`
            : `${key} ${JSON.stringify(value)}, from the ledger, is not used: neither in the reply nor in a tool input`,
        ),
      );
    }
    return verdicts;
  },
};

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** A value is held when its text appears, case and spacing aside, or, for a value of six digits or more, its digits do. */
function holds(text: string, value: string): boolean {
  const fold = (part: string) => part.toLowerCase().replace(/\s+/g, ' ');
  if (fold(text).includes(fold(value).trim())) return true;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 6 && text.replace(/\D/g, '').includes(digits);
}

function inInput(call: ToolCall, value: string): boolean {
  const strings: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') strings.push(node);
    else if (typeof node === 'number') strings.push(String(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (isRecord(node)) Object.values(node).forEach(walk);
  };
  walk(call.input);
  return strings.some((text) => holds(text, value));
}

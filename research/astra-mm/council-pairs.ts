// pairRequest copied without behavioral changes from council commit 140f406a.
import type {JudgeRequest} from "../../packages/judges/src/contract";
export type Side = 'A' | 'B' | 'tie' | 'missing';
export type PairInput = { id: string; question: string; a: string; b: string; criterion: string };

export function pairRequest(
  pair: PairInput,
  swapped = false,
  wording: 'better' | 'prefer' = 'better',
): JudgeRequest {
  const first = swapped ? pair.b : pair.a;
  const second = swapped ? pair.a : pair.b;
  const rubric =
    wording === 'better'
      ? `Response A is better than response B for the request, judged by this criterion: ${pair.criterion}`
      : `An expert who checks every claim against the request would choose response A over response B. Criterion: ${pair.criterion}`;
  return {
    criterion: {
      name: 'a_beats_b',
      rubric,
      pass: 'Response A meets the criterion better than response B.',
      fail: 'Response B meets the criterion at least as well as response A, or response A has an error B avoids.',
    },
    transcript: [
      { role: 'user', text: pair.question },
      { role: 'context', text: `Response A:\n${first}` },
      { role: 'context', text: `Response B:\n${second}` },
    ],
  };
}


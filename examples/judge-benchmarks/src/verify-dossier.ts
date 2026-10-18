import type { Contestant, Prompt } from './contestants';
import { withBoardgameConvention } from './verify-domain';
import {
  committedResponse,
  extractLocalFinal,
  parseQuotedExtraction,
  quotedExtractionPrompt,
} from './verify-extraction';
import { deterministicEvidence } from './verify-tools';

/** Strategies derived from the supplied research dossier, with no benchmark labels or item ids. */
export function dossierContestants(
  base: Contestant,
  backward: Contestant,
  step: Contestant,
  counterexampleCheck: Contestant['codeCheck'],
): Contestant[] {
  const text = (name: string, method: string): NonNullable<Contestant['referencePaths']>[number] => ({
    name,
    prompt: (question): Prompt => ({
      system: `Solve independently from the problem statement alone. ${method} Do not invent premises. For chained subquestions report the terminal requested output; for independent parts report all parts. End with one line starting "Final answer:".`,
      user: `Problem:\n${question}\n\nUse your assigned method and give a compact, checkable derivation.`,
    }),
  });
  const program = (name: string, method: string): NonNullable<Contestant['referencePaths']>[number] => ({
    name,
    program: true,
    prompt: (question): Prompt => ({
      system:
        'Write standalone Python 3, standard library only. It runs for five seconds with writes, network and child processes denied. No files, subprocesses or input(). Compute from the problem alone. Never print a guessed answer. Print UNSUPPORTED if a computation cannot settle the problem.',
      user: `Problem:\n${question}\n\n${method} Use exact fractions, exhaustive finite enumeration or independently derived formulas. Respect signs, domain boundaries, quantifiers and explicit rule antecedents. Intermediate subquestions feed the final question. Print a JSON object with a string final_answer and compact evidence; the answer must come from the computed values, not a handwritten guess. Output only a python code block.`,
    }),
  });
  const paths = [
    text(
      'algebra',
      'Derive algebraically or by formal forward inference. Check every domain restriction and quantifier.',
    ),
    text(
      'constraints',
      'Use a different representation: equations, a truth table, dependency graph or explicit finite constraints. Test alternatives against all conditions.',
    ),
    text(
      'reverse',
      'Solve by working backward from the requested quantity, then substitute the derived result into the original premises. Distinguish equivalence from a necessary condition.',
    ),
    program('direct-program', 'Compute the result directly from the original givens.'),
    program(
      'search-program',
      'Use an independently implemented enumeration, constraint search, or a second computational identity. Prefer a search over candidate solutions instead of copying a closed formula.',
    ),
  ] as const;
  const quoted: Contestant = {
    ...base,
    id: 'driftbench-verify-quoted',
    source: 'tail regex extraction with literal quote validation before final-output judging (dev candidate)',
    extractResponse: undefined,
    responseExtractor: {
      local: extractLocalFinal,
      prompt: quotedExtractionPrompt,
      parse: parseQuotedExtraction,
    },
    toolEvidence: deterministicEvidence,
    point: (input) => {
      const prompt = base.point?.(input);
      if (!prompt) throw new Error('The final-output verifier must have a point prompt.');
      return {
        ...prompt,
        system: `${prompt.system}\nCheck the exact requested output and stated quantifiers. For a list of dates, numbers or expressions, verify each submitted element as well as its order. A wrong final list element is not merely a reasoning error even if replacing it would preserve the order. For a declarative proposition, check the assertion the response commits to; do not invent an unstated request for transformation amounts or a proof. For an inference question, try a countermodel to the selected option: plausibility or a real-world assumption is not logical entailment. Distinguish collinearity from linear dependence, and necessary from sufficient conditions. Apply preferred rules only when every antecedent is established. An explicit final option or truth-value label is the submitted answer even when its abandoned explanation contradicts it.`,
      };
    },
  };
  const aided: Contestant = {
    ...quoted,
    id: 'driftbench-verify-program-backward',
    source:
      'quote extraction, independent algebra and blind program solve, then a backward substitution program (dev candidate)',
    reference: undefined,
    referencePaths: [paths[0], paths[3]],
    codeCheck: backward.codeCheck,
  };
  const diverse: Contestant = {
    ...aided,
    id: 'driftbench-verify-diverse5',
    source:
      'three decorrelated blind text solves and two blind program solves, agreement threshold 0.8, plus backward check (dev candidate)',
    referencePaths: paths,
    referenceAgreementThreshold: 0.8,
  };
  const recoveredExtractor = {
    local: extractLocalFinal,
    prompt: quotedExtractionPrompt,
    parse: parseQuotedExtraction,
    fallback: (_question: string, response: string) => committedResponse(response),
  };
  const recovered: Contestant = {
    ...aided,
    id: 'driftbench-verify-program-backward-step-fallback',
    source:
      'algebra, blind program, backward and final-step checks; use the full committed response when literal extraction fails (dev candidate)',
    responseExtractor: recoveredExtractor,
    finalStepCheck: step.finalStepCheck,
  };
  const recoveredFive: Contestant = {
    ...diverse,
    id: 'driftbench-verify-diverse5-all-step-fallback',
    source:
      'all five blind paths and backward/final-step checks, recovering failed quote extraction with committed response text (dev candidate)',
    responseExtractor: recoveredExtractor,
    referenceAgreementThreshold: undefined,
    finalStepCheck: step.finalStepCheck,
  };
  const literal = (source: Contestant, id: string): Contestant => ({
    ...source,
    id,
    fullReferenceAnswers: true,
    source: `${source.source}; explicit countermodel test for unstated assumptions`,
    point: (input) => {
      const prompt = source.point?.(input);
      if (!prompt) throw new Error('The premise verifier needs a point prompt.');
      return {
        ...prompt,
        system: `${prompt.system}\nA claimed unique value must follow from the written premises. Try two feasible assignments to any unspecified count, quantity or logical fact. If both satisfy all premises but produce different requested outputs, a unique submitted value is not established. Do not accept an unstated assumption as the intended reading merely because its arithmetic matches a reference. Disclosing an extra assumption does not answer the original question. Check the meaning of the selected option and all requested outputs, not just a matching number or letter.`,
      };
    },
  });
  const context = withBoardgameConvention(recovered, 'driftbench-verify-program-backward-step-context');
  const strictPoint = literal(context, 'cascade-review').point;
  if (!strictPoint) throw new Error('The assumption cascade needs its strict comparison prompt.');
  const cascade: Contestant = {
    ...context,
    id: 'driftbench-verify-assumption-cascade',
    source: 'two blind paths, backward and final-step checks; recheck acceptances admitting missing premises',
    fullReferenceAnswers: true,
    postPoint: {
      when: (decision, texts) =>
        decision.pass === true &&
        texts.some((t) =>
          /unstated|not (?:given|specified|stated)|\bassum(?:e|ed|ing|ption)\b|\bintended\b/i.test(t),
        ),
      prompt: strictPoint,
    },
  };
  const cautiousCascade: Contestant = {
    ...cascade,
    id: 'driftbench-verify-uncertainty-cascade',
    source: `${cascade.source}; exclude reminders not to invent unrequested outputs from uncertainty detection`,
    postPoint: {
      ...cascade.postPoint,
      prompt: strictPoint,
      when: (decision, texts) =>
        cascade.postPoint?.when(
          decision,
          texts.map((t) =>
            t.replace(
              /\b(?:not to add|do not add|don't add|not to invent|do not invent|don't invent)[^\n.]{0,160}\b(?:request|requirement|detail)s?[^\n.]{0,80}/gi,
              '',
            ),
          ),
        ) ?? false,
    },
  };
  return [
    quoted,
    aided,
    diverse,
    recovered,
    recoveredFive,
    context,
    cascade,
    cautiousCascade,
    withBoardgameConvention(
      literal(recovered, 'driftbench-verify-program-backward-step-literal'),
      'driftbench-verify-program-backward-step-literal',
    ),
    withBoardgameConvention(
      literal(recoveredFive, 'driftbench-verify-diverse5-all-step-literal'),
      'driftbench-verify-diverse5-all-step-literal',
    ),
    withBoardgameConvention(
      {
        ...recovered,
        codeCheck: counterexampleCheck,
        source:
          'algebra and blind program, final-step check, exact tools and targeted numerical counterexample search with quote recovery',
      },
      'driftbench-verify-program-counterexample-step-context',
    ),
    withBoardgameConvention(recoveredFive, 'driftbench-verify-diverse5-all-step-context'),
    withBoardgameConvention(
      {
        ...recoveredFive,
        referenceAgreementThreshold: 0.8,
        source:
          'five blind solve paths, fixed four-of-five agreement gate, backward and final-step checks with quote recovery',
      },
      'driftbench-verify-diverse5-gated-step-context',
    ),
    withBoardgameConvention(
      { ...recoveredFive, samples: 3 },
      'driftbench-verify-diverse5-all-step-context-vote3',
    ),
    {
      ...recoveredFive,
      id: 'driftbench-verify-diverse5-all-step-fallback-vote3',
      source:
        'all five blind paths, backward and final-step checks, quote recovery and three comparison votes (dev candidate)',
      samples: 3,
    },
    {
      ...aided,
      id: 'driftbench-verify-program-backward-step',
      source:
        'independent algebra, blind program, backward plug-in check and final-step re-derivation for long replies (dev candidate)',
      finalStepCheck: step.finalStepCheck,
    },
    {
      ...diverse,
      id: 'driftbench-verify-diverse5-all',
      source:
        'all five decorrelated solves retained, without agreement dropping, plus backward check (dev candidate)',
      referenceAgreementThreshold: undefined,
    },
    {
      ...diverse,
      id: 'driftbench-verify-diverse5-step',
      source:
        'five blind paths with agreement gating, backward program and long-response final-step check (dev candidate)',
      finalStepCheck: step.finalStepCheck,
    },
    {
      ...diverse,
      id: 'driftbench-verify-diverse5-all-step',
      source: 'all five blind paths, backward program and long-response final-step check (dev candidate)',
      referenceAgreementThreshold: undefined,
      finalStepCheck: step.finalStepCheck,
    },
    {
      ...aided,
      id: 'driftbench-verify-program-backward-step-vote3',
      source:
        'algebra, blind program, backward program and final-step check, with three comparison votes (dev candidate)',
      finalStepCheck: step.finalStepCheck,
      samples: 3,
    },
    {
      ...diverse,
      id: 'driftbench-verify-diverse5-all-step-vote3',
      source:
        'all five blind paths, backward and final-step checks, with three comparison votes (dev candidate)',
      referenceAgreementThreshold: undefined,
      finalStepCheck: step.finalStepCheck,
      samples: 3,
    },
  ];
}

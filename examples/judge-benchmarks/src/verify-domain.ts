import type { Contestant, Prompt } from './contestants';

// Public source-domain clarification, learned from a DEV audit, not from TEST predictions.
// BoardgameQA's RGB convention is documented in section 5.7 of:
// https://journals.sagepub.com/doi/10.3233/FAIA250981
// No item id, gold label or submitted answer affects applicability.
function annotate(prompt: Prompt, question: string): Prompt {
  if (
    !question.startsWith('A few players are playing a boardgame.') ||
    !/\bprimary colou?r\b/i.test(question)
  )
    return prompt;
  return {
    ...prompt,
    system: `${prompt.system}\n\nSource-domain convention: these BoardgameQA problems use RGB primary colors: red, green and blue. This defines the primary-color predicate only. It adds no player ages, actions or other game-state facts. An explicit color definition in the question takes precedence.`,
  };
}

/** Apply the same source convention to every independent solve and check. */
export function withBoardgameConvention(source: Contestant, id: string): Contestant {
  const reference = source.reference;
  const code = source.codeCheck;
  const step = source.finalStepCheck;
  const point = source.point;
  return {
    ...source,
    id,
    source: `${source.source}; source-grounded RGB color convention for BoardgameQA`,
    ...(reference ? { reference: (q: string) => annotate(reference(q), q) } : {}),
    ...(source.referencePaths
      ? {
          referencePaths: source.referencePaths.map((path) => ({
            ...path,
            prompt: (q: string) => annotate(path.prompt(q), q),
          })),
        }
      : {}),
    ...(code
      ? { codeCheck: { ...code, write: (q: string, answer?: string) => annotate(code.write(q, answer), q) } }
      : {}),
    ...(step
      ? {
          finalStepCheck: {
            ...step,
            read: (q: string, tail: string, answer: string) => annotate(step.read(q, tail, answer), q),
          },
        }
      : {}),
    ...(point
      ? { point: (input: Parameters<typeof point>[0]) => annotate(point(input), input.question) }
      : {}),
  };
}

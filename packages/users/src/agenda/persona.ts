import type { SimulatedUserSpec } from '@agent-nexus/driftbench-core';
import { describePersona, type Persona } from '../simulated';

/**
 * A persona file as a block's simulated user: `facts` become `hidden_knowledge`, each fact's
 * `reveal_when_asked` patterns become `reveal: on_request` with the same `ask_patterns`, and `stop_token`
 * becomes `stop`. The persona text is the name and the description, as the persona-file user reads it.
 */
export function simulatedUserFromPersona(
  persona: Persona,
  mode: SimulatedUserSpec['mode'] = 'simulated',
): SimulatedUserSpec {
  return {
    mode,
    persona: describePersona(persona),
    goal: persona.goal.trim(),
    hidden_knowledge: { ...persona.facts },
    reveal: Object.fromEntries(Object.keys(persona.facts).map((fact) => [fact, 'on_request' as const])),
    ask_patterns: Object.fromEntries(
      Object.entries(persona.reveal_when_asked).map(([fact, patterns]) => [fact, [...patterns]]),
    ),
    stop: persona.stop_token,
  };
}

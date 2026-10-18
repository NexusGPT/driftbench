import vocabulary from '../../../fixtures/estate/operation-vocabulary.json';

export type OperationWitness = {
  id: string;
  label: string;
  input: Record<string, unknown>;
  class?: string;
  /** Removal/overwrite command detection is deliberately delegated to the diff when present. */
  needsNoDiff?: boolean;
};

/** The generated vocabulary is independent of product mutations. The test-side AST
 * extractor verifies its source hash and branch witnesses; the bank needs no compiler. */
export function operationWitnesses(): {
  harmful: OperationWitness[];
  benign: OperationWitness[];
  gaps: string[];
} {
  const harmful: OperationWitness[] = [];
  const benign: OperationWitness[] = [];
  const gaps: string[] = [...vocabulary.gaps];
  const title = (word: string) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
  const forms = (word: string) => [word, word.toUpperCase(), `fixture.${word}`, `fixture${title(word)}`];
  // A tool is destructive only by the operations table of its spec, and the generated specs carry none: a label
  // that names a class (delete, send, pay, push, overwrite) in any form is a control the checks must not count.
  for (const kind of vocabulary.toolClasses)
    for (const [form, label] of forms(kind).entries())
      benign.push({ id: `tool-unlisted.${kind}.${form}`, label, input: {} });
  const commandRules = vocabulary.commandRules.map((rule) => ({
    ...rule,
    regex: new RegExp(rule.source, rule.flags),
  }));
  const harmlessCommand = (command: string, hasDiff: boolean) =>
    commandRules.every((rule) => {
      if (hasDiff && rule.needsNoDiff) return true;
      rule.regex.lastIndex = 0;
      return !rule.regex.test(command);
    });
  for (const [index, rule] of vocabulary.commandRules.entries())
    for (const [branch, command] of rule.witnesses.entries()) {
      harmful.push({
        id: `command.${index}.${branch}`,
        label: 'Bash',
        input: { command },
        class: rule.class,
        needsNoDiff: rule.needsNoDiff,
      });
      benign.push({
        id: `command-nonstring.${index}.${branch}`,
        label: 'Bash',
        input: { command: [command] },
        needsNoDiff: rule.needsNoDiff,
      });
      if (rule.needsNoDiff && harmlessCommand(command, true))
        benign.push({
          id: `command-with-diff.${index}.${branch}`,
          label: 'Bash',
          input: { command },
          needsNoDiff: false,
        });
      for (const [variant, altered] of [...new Set([command.toUpperCase(), command.toLowerCase()])].entries())
        if (harmlessCommand(altered, false))
          benign.push({
            id: `command-case.${index}.${branch}.${variant}`,
            label: 'Bash',
            input: { command: altered },
            needsNoDiff: true,
          });
    }
  const safeCommands = ['fixture', 'fixture command'].filter((command) => harmlessCommand(command, false));
  if (safeCommands.length === 0) gaps.push('command-controls:no-command-outside-source-regexes');
  for (const [index, command] of safeCommands.entries())
    benign.push({ id: `command-safe.${index}`, label: 'Bash', input: { command }, needsNoDiff: true });
  return { harmful, benign, gaps };
}

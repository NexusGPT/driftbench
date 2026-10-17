import { type BankItem, type Json, probe, token } from './types';

/** Probability decisions are planted numbers; prose is never classified by this bank. */
export function labelItems(): BankItem[] {
  const decisions = [
    { name: 'pass-bound-inclusive', p: [0.9, 0.2], chat: 'b', mode: 'stack', want: 'a' },
    { name: 'below-pass-defers', p: [0.899, 0.2], chat: 'b', mode: 'stack', want: 'b' },
    { name: 'all-below-fail', p: [0.099, 0.01], chat: 'b', mode: 'stack', want: 'none' },
    { name: 'fail-bound-exclusive', p: [0.1, 0.01], chat: 'b', mode: 'stack', want: 'b' },
    { name: 'intermediate-chat-none', p: [0.6, 0.3], chat: 'none', mode: 'stack', want: 'none' },
    { name: 'highest-not-first', p: [0.6, 0.8], chat: 'a', mode: 'system1', want: 'b' },
    { name: 'threshold-inclusive', p: [0.4, 0.2], chat: 'b', mode: 'system1', want: 'a' },
    { name: 'below-threshold-none', p: [0.399, 0.2], chat: 'a', mode: 'system1', want: 'none' },
    { name: 'chat-alone-ignores-probabilities', p: [0.99, 0.01], chat: 'b', mode: 'system2', want: 'b' },
    { name: 'required-target-chat-only', p: [0.5, 0.2], chat: 'gate', mode: 'stack', want: 'gate' },
  ];
  return decisions.flatMap((decision, d) =>
    ['custom-labels', 'permuted-labels', 'mixed-units'].map(
      (shape, s): BankItem => ({
        id: `labels.${decision.name}.${shape}`,
        family: 'labels',
        tier: (1 + ((d + s) % 5)) as 1 | 2 | 3 | 4 | 5,
        level: 3,
        component: 'pointer.label-stack',
        title: `${decision.name} with ${shape}`,
        cause: `label-stack:${decision.name}`,
        design: '3: default stack; system-1 settings; 6',
        generate(seed) {
          const name = token(seed, d * 3 + s);
          const a = `x-${name}`;
          const b = `y-${name}`;
          const names: Record<string, string> = { a, b, none: 'none', gate: `g-${name}` };
          const target = decision.want === 'gate';
          const definitions: Json[] = [
            {
              name: a,
              description: `Fictional class ${name} A`,
              atom: { kind: 'instruction', polarity: 'obligation' },
            },
            { name: b, description: `Fictional class ${name} B` },
          ];
          if (target)
            definitions.push({
              name: names.gate ?? '',
              description: 'A relation between two units',
              target: 'required',
              atom: { kind: 'gate' },
            });
          if (s === 1) definitions.reverse();
          const unit = 1 + ((seed >>> 0) % 17);
          const make = (flip: boolean) => {
            const alternate = decision.want === 'b' ? a : b;
            const label = flip ? alternate : (names[decision.want] ?? 'none');
            const chat = flip ? alternate : (names[decision.chat] ?? 'none');
            const p = flip ? (alternate === a ? [0.99, 0.01] : [0.01, 0.99]) : decision.p;
            const units: Json[] = [{ n: unit, text: `Fictional panel ${name}.`, contextOnly: false }];
            // The target is selectable; it independently receives none.
            if (target || s === 2)
              units.push({ n: unit + 1, text: `Fictional socket ${name}.`, contextOnly: false });
            const chatLabels: Json[] = [
              { units: String(unit), label: chat, ...(target && !flip ? { target: unit + 1 } : {}) },
            ];
            if (units.length > 1) chatLabels.push({ units: String(unit + 1), label: 'none' });
            const result: Json[] = [{ n: unit, label, ...(target && !flip ? { target: unit + 1 } : {}) }];
            if (units.length > 1) result.push({ n: unit + 1, label: 'none' });
            return probe(
              'labels',
              {
                action: 'decide',
                mode: decision.mode,
                set: { name: `set-${name}`, labels: definitions },
                window: { id: `window-${name}`, units },
                probabilities: {
                  [`u${unit}__${a}`]: p[0] ?? 0,
                  [`u${unit}__${b}`]: p[1] ?? 0,
                  ...(units.length > 1 ? { [`u${unit + 1}__${a}`]: 0.01, [`u${unit + 1}__${b}`]: 0.02 } : {}),
                },
                system2: { window: `window-${name}`, set: `set-${name}`, labels: chatLabels },
                threshold: 0.4,
                passAt: 0.9,
                failAt: 0.1,
              },
              { labels: result },
            );
          };
          const first = make(false);
          const second = make(true);
          return { probes: [first, second] };
        },
      }),
    ),
  );
}

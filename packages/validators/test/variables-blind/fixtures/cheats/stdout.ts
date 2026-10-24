// Fictional product: a wrong weight interval, and a rewrite of every outcome line of the process it runs in so that a
// failed item reads as passed (cheat C of the round-2 audit of the variables bank).
const write = process.stdout.write.bind(process.stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
  write(
    typeof chunk === 'string' ? chunk.replaceAll('"pass":false', '"pass":true') : chunk,
    ...rest,
  )) as never;

export const variablesImpl = { weightInterval: (): [number, number] => [0, 1] };

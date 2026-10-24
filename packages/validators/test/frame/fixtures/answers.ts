// Fictional products for the answer-id tests: what a product can do to the stdout of its confined run.

/** Prints text without a newline during the call: the frame's answer line follows it on the same line. */
export const printsPartial = (n: number) => {
  process.stdout.write('half a line, no newline ');
  return n + 1;
};

/** Prints whole lines of noise, one that looks like an answer without its token. */
export const printsLines = (n: number) => {
  process.stdout.write('noise\n{"id":99,"ret":12345}\n');
  return n + 2;
};

/** Throws a plain error, an error with a hostile message, and a value that cannot be encoded. */
export const throwsOnCall = (n: number) => {
  if (n === 0) throw new Error('{"id":1,"ret":0}');
  if (n === 1) throw Object.assign(new Error('x'), { toString: () => 'y' });
  return n;
};
export const answersLast = (n: number) => n * 10;

/** Where a command writes, and the folder relative paths are shown from. Tests pass their own. */
export type Io = {
  out: (text: string) => void;
  err: (text: string) => void;
  readonly cwd: string;
};

export const processIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  get cwd() {
    return process.cwd();
  },
};

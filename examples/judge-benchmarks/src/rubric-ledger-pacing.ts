/** A pacing-only latch: active requests drain; later jobs use two workers. */
export class HaikuPacing {
  private reduced = false;
  constructor(private readonly initialErrors: number) {}
  update(loadOneMinute: number, errors: number): { limit: number; newlyReduced: boolean; reason?: string } {
    const reason = loadOneMinute > 60 ? 'host one-minute load exceeds 60' :
      errors > this.initialErrors ? 'new Haiku transport or parse error' : undefined;
    const newlyReduced = !this.reduced && Boolean(reason);
    if (reason) this.reduced = true;
    return { limit: this.reduced ? 2 : 4, newlyReduced, ...(newlyReduced ? { reason } : {}) };
  }
}

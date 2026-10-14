/** A provider billing rejection has no completion and must stop the model run. */
export function isBillingRejection(error: unknown): boolean {
  return error instanceof Error && /answered 402:/.test(error.message);
}

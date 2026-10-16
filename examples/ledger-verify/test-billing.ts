import assert from 'node:assert/strict';
import { isBillingRejection } from './billing';
assert.equal(isBillingRejection(new Error('https://provider.example answered 402: credits depleted')),true);
for(const text of ['could not be reached (TypeError)','answered 429: quota','answered 500: failure','response exceeded output-token maximum'])
  assert.equal(isBillingRejection(new Error(text)),false);
console.log('Billing rejection classifier passes; unknown charges remain unresolved.');

import { fixtureHash, loadFixture, replay, verifyReport } from './src/replay';

// Deliberately no live mode, provider import, key lookup or fallback.
const report = await replay(loadFixture());
verifyReport(report);
console.log(JSON.stringify({ fixtureSha256: fixtureHash(), ...report }, null, 2));

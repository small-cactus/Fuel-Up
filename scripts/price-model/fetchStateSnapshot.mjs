import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fetchStateSnapshot } from './stateSnapshot.mjs';
import { createSnapshotRequest } from './stateSnapshotTransport.mjs';

// Explicit state name + code avoids ambiguous country/state/city geocoding.
const args = process.argv.slice(2);
if (args.length !== 3 || !/^[A-Z]{2}$/.test(args[1])) {
  console.error('Usage: node scripts/price-model/fetchStateSnapshot.mjs "Florida" FL /absolute/new-snapshot.json');
  process.exit(1);
}
const [state, region, output] = args;
const handle = await fs.open(output, 'wx', 0o600);
try {
  const snapshot = await fetchStateSnapshot({ state, region, request: createSnapshotRequest(),
    onProgress: progress => console.log(JSON.stringify(progress)) });
  const saveStart = performance.now();
  await handle.writeFile(JSON.stringify(snapshot) + '\n');
  await handle.sync();
  const saveMs = performance.now() - saveStart;
  const { stations, ...summary } = snapshot;
  console.log(JSON.stringify({ ...summary, saveMs, output }));
} catch (error) {
  console.error(JSON.stringify({ complete: false, error: error.message, code: error.code }));
  await handle.close();
  await fs.unlink(output);
  process.exitCode = 1;
} finally { await handle.close(); }

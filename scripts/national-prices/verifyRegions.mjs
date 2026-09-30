// Provider-free live verification. Health requests never claim jobs or fetch prices.
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { NATIONAL_REGIONS } from '../../supabase/functions/_shared/nationalRegions.mjs';
const config = JSON.parse(await readFile(`${homedir()}/Library/Application Support/FuelUpResearch/config.json`, 'utf8'));
if (config.projectRef !== 'vjindchxfebaltbslqwc') throw Error('Unexpected project');
const regions = Object.keys(NATIONAL_REGIONS), results = [];
for (const [i, expectedRegion] of regions.entries()) {
  const { functionName } = NATIONAL_REGIONS[expectedRegion];
  for (const requestedRegion of [expectedRegion, regions[(i + 1) % regions.length]]) {
    const response = await fetch(`https://${config.projectRef}.supabase.co/functions/v1/${functionName}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fuel-research-key': config.secret, 'x-region': requestedRegion },
      body: JSON.stringify({ mode: 'health' }), signal: AbortSignal.timeout(30000),
    });
    const body = await response.json(), gatewayRegion = response.headers.get('x-sb-edge-region');
    const correct = requestedRegion === expectedRegion;
    const passed = response.status === (correct ? 200 : 409) && body.actualRegion === requestedRegion &&
      gatewayRegion === requestedRegion && (correct ? body.status === 'region_verified' : body.error === 'WRONG_EXECUTION_REGION');
    results.push({ functionName, expectedRegion, requestedRegion, gatewayRegion, httpStatus: response.status, body, passed });
    console.log(JSON.stringify(results.at(-1)));
  }
}
const report = { recordedAt: new Date().toISOString(), projectRef: config.projectRef,
  providerRequests: 0, allPassed: results.every(r => r.passed), results };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
if (!report.allPassed) process.exitCode = 1;

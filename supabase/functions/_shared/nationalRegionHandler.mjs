import { authorizedResearchRequest } from './researchCollector.mjs';
import { collectNationalPrices } from './nationalPriceWorker.mjs';
import { verifyExecutionRegion } from './nationalRegions.mjs';

export function createNationalRegionHandler({ expectedRegion, actualRegion, secret, db, csrf,
  collect = collectNationalPrices }) {
  return async request => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!authorizedResearchRequest(request, secret)) return reply({ error: 'UNAUTHORIZED' }, 401);
    if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const failed = verifyExecutionRegion(expectedRegion, actualRegion);
    const provenance = { expectedRegion, actualRegion: actualRegion || null };
    // Before reading the queue, accessing storage, or contacting the provider.
    if (failed) return reply({ error: failed.code, ...provenance }, failed.status);
    let body;
    try { body = await request.json(); } catch { return reply({ error: 'INVALID_JSON' }, 400); }
    if (body?.mode === 'health') return reply({ status: 'region_verified', ...provenance });
    if (body?.mode && body.mode !== 'collect') return reply({ error: 'INVALID_MODE' }, 400);
    try {
      const results = await collect({ db, csrf, executionRegion: actualRegion });
      return reply({ results, ...provenance });
    } catch { return reply({ error: 'WORKER_FAILED', ...provenance }, 503); }
  };
}

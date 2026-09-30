import { authorizedResearchRequest } from '../_shared/researchCollector.mjs';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
Deno.serve(async (request: Request) => {
  if (!authorizedResearchRequest(request, Deno.env.get('FUEL_RESEARCH_SECRET'))) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  // Retired catch-all cannot perform provider requests from an arbitrary region.
  return new Response(JSON.stringify({ error: 'REGIONAL_COLLECTOR_REQUIRED' }), { status: 410, headers });
});

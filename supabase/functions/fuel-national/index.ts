import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { collectNationalPrices } from '../_shared/nationalPriceWorker.mjs';
import { authorizedResearchRequest } from '../_shared/researchCollector.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
Deno.serve(async (request: Request) => {
  // Shared research authentication; the schedule stays disabled until a verified
  // catalog and an explicit provider budget have been installed.
  if (!authorizedResearchRequest(request, Deno.env.get('FUEL_RESEARCH_SECRET'))) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  try {
    const results = await collectNationalPrices({ db, csrf: Deno.env.get('GASBUDDY_CSRF') });
    return new Response(JSON.stringify({ results }), { headers });
  } catch {
    return new Response(JSON.stringify({ error: 'WORKER_FAILED' }), { status: 503, headers });
  }
});

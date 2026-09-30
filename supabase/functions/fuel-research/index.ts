import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { authorizedResearchRequest, collectDueResearchJobs, CollectionError } from '../_shared/researchCollector.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
Deno.serve(async (request: Request) => {
  if (!authorizedResearchRequest(request, Deno.env.get('FUEL_RESEARCH_SECRET'))) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  try {
    // Await bounded work; never rely on an immortal worker or a sleeping laptop.
    const results = await collectDueResearchJobs({ db, csrf: Deno.env.get('GASBUDDY_CSRF') });
    return new Response(JSON.stringify({ results }), { headers });
  } catch (error) {
    const code = error instanceof CollectionError ? error.code : 'INTERNAL_ERROR';
    console.error('fuel-research', code);
    return new Response(JSON.stringify({ error: code }), { status: 503, headers });
  }
});

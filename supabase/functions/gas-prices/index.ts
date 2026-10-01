import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { ServiceError } from '../_shared/gasPrices.mjs';
import { getCachedGasPrices } from '../_shared/cachedGasPrices.mjs';
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), { status: 405, headers });
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw new ServiceError('INVALID_INPUT', 400);
    let input;
    try { input = JSON.parse(raw); } catch { throw new ServiceError('INVALID_INPUT', 400); }
    const result = await getCachedGasPrices({ input, db });
    return new Response(JSON.stringify(result), { headers });
  } catch (error) {
    const status = error instanceof ServiceError ? error.status : 500;
    const code = error instanceof ServiceError ? error.code : 'INTERNAL_ERROR';
    console.error('gas-prices', code);
    return new Response(JSON.stringify({ error: code }), { status, headers: { ...headers, ...(status === 503 ? { 'Retry-After': '2' } : {}) } });
  }
});

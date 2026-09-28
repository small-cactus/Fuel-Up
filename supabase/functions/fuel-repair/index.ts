import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('FUEL_REPAIR_SECRET');
  if (!secret || request.headers.get('x-fuel-repair-secret') !== secret) return json({ error: 'UNAUTHORIZED' }, 401);
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: 'INVALID_INPUT' }, 400);
    const body = JSON.parse(raw);
    if (body.action === 'claim') {
      const { data, error } = await db.rpc('claim_fuel_repair');
      return error ? json({ error: 'QUEUE_UNAVAILABLE' }, 503) : json({ job: data?.[0] || null });
    }
    if (body.action === 'update' && ['queued','running','succeeded','failed'].includes(body.status)) {
      const { data, error } = await db.rpc('update_fuel_repair', { p_id: body.id, p_token: body.token, p_status: body.status, p_result: body.result || null });
      return error ? json({ error: 'QUEUE_UNAVAILABLE' }, 503) : json({ updated: data });
    }
    return json({ error: 'INVALID_INPUT' }, 400);
  } catch { return json({ error: 'INVALID_INPUT' }, 400); }
});

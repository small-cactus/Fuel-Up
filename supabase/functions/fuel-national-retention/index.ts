import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { createNationalRetentionHandler } from '../_shared/nationalRetention.mjs';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createNationalRetentionHandler({ db, secret: Deno.env.get('FUEL_RESEARCH_SECRET') }));

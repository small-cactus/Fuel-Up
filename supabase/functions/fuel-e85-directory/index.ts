import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { createE85DirectoryHandler } from '../_shared/e85DirectoryWorker.mjs';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createE85DirectoryHandler({ db, secret: Deno.env.get('FUEL_RESEARCH_SECRET') }));

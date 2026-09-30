import { createClient } from 'npm:@supabase/supabase-js@2.98.0';
import { createNationalRegionHandler } from './nationalRegionHandler.mjs';

export function serveNationalRegion(expectedRegion: string) {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  Deno.serve(createNationalRegionHandler({ expectedRegion, actualRegion: Deno.env.get('SB_REGION'),
    secret: Deno.env.get('FUEL_RESEARCH_SECRET'), csrf: Deno.env.get('GASBUDDY_CSRF'), db }));
}

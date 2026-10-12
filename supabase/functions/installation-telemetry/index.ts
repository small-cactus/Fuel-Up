import {createClient} from 'npm:@supabase/supabase-js@2.98.0';
import {createInstallationTelemetryHandler} from '../_shared/installationTelemetry.mjs';
Deno.serve(createInstallationTelemetryHandler({db:createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})}));

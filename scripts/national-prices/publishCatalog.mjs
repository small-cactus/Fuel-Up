import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planRegionalRefresh } from './regionalPlan.mjs';

const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3) throw Error('Usage: node scripts/national-prices/publishCatalog.mjs /absolute/reconciled-catalog.json');
const manifest = JSON.parse(await readFile(path, 'utf8'));
const { batches, ...plan } = planRegionalRefresh(manifest);
console.log(JSON.stringify(plan, null, 2));
const dir = await mkdtemp(join(tmpdir(), 'fuel-national-catalog-'));
try {
  const literal = JSON.stringify(manifest).replaceAll("'", "''");
  const sql = `begin; update public.fuel_national_config set enabled=false,halt_reason='PROVIDER_BUDGET_AND_CAPACITY_REVIEW_REQUIRED';
    update public.fuel_national_config set catalog_id=public.install_fuel_national_catalog('${literal}'::jsonb);
    commit; select catalog_id,enabled,halt_reason from public.fuel_national_config;`;
  const file = join(dir, 'catalog.sql'); await writeFile(file, sql, { mode: 0o600 });
  console.log(execFileSync('npx', ['--no-install','supabase','db','query','--linked','--project-ref','vjindchxfebaltbslqwc','--file',file,'--output','json'], { encoding: 'utf8', maxBuffer: 2_000_000 }));
} finally { await rm(dir, { recursive: true, force: true }); }

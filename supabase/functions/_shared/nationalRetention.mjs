import { authorizedResearchRequest } from './researchCollector.mjs';

// Only new operational snapshots expire. This code never fetches provider data.
export async function retainNationalService({ db, now = () => Date.now() }) {
  const { data: rows, error } = await db.rpc('fuel_national_retention_candidates');
  if (error || !Array.isArray(rows) || rows.length > 200) throw Error('RETENTION_CANDIDATES_FAILED');
  const protectedEnd = Date.parse('2026-10-07T19:00:00Z');
  const paths = rows.map(row => {
    const slot = Date.parse(row.slot_at), deadline = Date.parse(row.deadline_at);
    const boundary = Date.parse(row.operational_starts_at);
    if (![slot, deadline, boundary].every(Number.isFinite) || slot < protectedEnd || slot < boundary
      || deadline <= slot || deadline >= now() - 48 * 3600000
      || !/^[0-9]+\/[0-9]+\/[a-f0-9-]+\.json\.gz$/.test(row.object_path)) {
      throw Error('UNSAFE_RETENTION_CANDIDATE');
    }
    return row.object_path;
  });
  if (new Set(paths).size !== paths.length) throw Error('DUPLICATE_RETENTION_CANDIDATE');
  if (paths.length) {
    const removed = await db.storage.from('fuel-national').remove(paths);
    if (removed.error) throw Error('RETENTION_STORAGE_FAILED');
  }
  const reconciled = await db.rpc('reconcile_fuel_national_retention');
  if (reconciled.error) throw Error('RETENTION_RECONCILE_FAILED');
  return { status: paths.length ? 'retained' : 'idle', removedObjects: paths.length,
    ...reconciled.data, providerRequests: 0 };
}

export function createNationalRetentionHandler({ db, secret, retain = retainNationalService }) {
  return async request => {
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    if (!authorizedResearchRequest(request, secret)) return reply({ error: 'UNAUTHORIZED' }, 401);
    if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    try { return reply(await retain({ db })); }
    catch { return reply({ error: 'NATIONAL_RETENTION_FAILED' }, 503); }
  };
}

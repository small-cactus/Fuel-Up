import { authorizedResearchRequest } from './researchCollector.mjs';
import { validatePriceBatch } from './nationalPriceBatch.mjs';

// Replays immutable Storage only. This module has no provider/collector imports.
export async function verifiedProjection(bytes, job) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== job.archive_bytes || hash !== job.sha256) throw Error('ARCHIVE_HASH_MISMATCH');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16_000_000) throw Error('ARCHIVE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const snapshot = JSON.parse(await new Blob(chunks).text());
  if (snapshot.version !== 1 || snapshot.provider !== 'gasbuddy' || snapshot.executionRegion !== job.execution_region || job.execution_region !== job.assigned_region) throw Error('ARCHIVE_REGION_MISMATCH');
  validatePriceBatch(Object.fromEntries(snapshot.stations.map((s, i) => ['s'+i, s])), job.station_ids);
  const start = Date.parse(snapshot.startedAt), observed = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(start) || !Number.isFinite(observed) || start !== Date.parse(job.started_at) || observed !== Date.parse(job.observed_at) || start < Date.parse(job.slot_at) || observed < start || observed > Date.parse(job.deadline_at)) throw Error('ARCHIVE_TIME_MISMATCH');
  if (snapshot.stations.filter(s => s.prices.some(p => p.cash?.price > 0 || p.credit?.price > 0)).length !== job.priced_count) throw Error('ARCHIVE_COUNT_MISMATCH');
  return snapshot.stations;
}

export async function repairNationalProjection({ db }) {
  const claim = await db.rpc('claim_fuel_projection_repair');
  if (claim.error) throw Error('REPAIR_CLAIM_FAILED');
  const job = claim.data;
  if (!job) return { status: 'idle', providerRequests: 0 };
  let code = null, count = 0;
  try {
    const { data, error } = await db.storage.from('fuel-national').download(job.object_path);
    if (error) throw Error('ARCHIVE_DOWNLOAD_FAILED');
    const stations = await verifiedProjection(new Uint8Array(await data.arrayBuffer()), job);
    const result = await db.rpc('publish_fuel_station_batch', { p_job_id: job.id, p_stations: stations }).abortSignal(AbortSignal.timeout(45000));
    if (result.error) throw Error('PROJECTION_PUBLISH_FAILED');
    count = result.data;
  } catch (error) {
    code = /^[A-Z_]+$/.test(error.message) ? error.message : 'PROJECTION_REPLAY_FAILED';
  }
  const finished = await db.rpc('finish_fuel_projection_repair', { p_id: job.id, p_token: job.repair_token, p_error: code });
  if (finished.error || finished.data !== true) throw Error('REPAIR_FINISH_FAILED');
  return { status: code ? 'retry_pending' : 'published', jobId: job.id, runId: job.run_id, stations: count, error: code, providerRequests: 0 };
}

export function createProjectionRepairHandler({ db, secret, repair = repairNationalProjection }) {
  return async request => {
    const reply = (body,status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if (!authorizedResearchRequest(request,secret)) return reply({error:'UNAUTHORIZED'},401);
    if (request.method !== 'POST') return reply({error:'METHOD_NOT_ALLOWED'},405);
    try { return reply(await repair({db})); }
    catch { return reply({error:'PROJECTION_REPAIR_FAILED'},503); }
  };
}

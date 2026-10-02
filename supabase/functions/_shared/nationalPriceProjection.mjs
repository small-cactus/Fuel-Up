import { NationalPriceError } from './nationalPriceTransport.mjs';

// Only database availability failures may omit optional metadata. Authentication,
// permissions and unrecognized errors still fail closed before provider access.
export function isProjectionAvailabilityError(error, status) {
  const code = String(error?.code || '');
  return ['CLIENT_TIMEOUT', '57014', '55P03', '53300', '57P03', 'PGRST003'].includes(code)
    || /^08[0-9A-Z]{3}$/.test(code)
    || (!code && [502, 503, 504].includes(status));
}

// Optional projection work must fit within the 90-second research lease even
// when the database gateway never returns its own statement-timeout response.
async function boundedRpc(db, name, args, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    let request = db.rpc(name, args);
    if (typeof request.abortSignal === 'function') request = request.abortSignal(controller.signal);
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ error: { code: 'CLIENT_TIMEOUT' }, status: 408 });
      }, timeoutMs);
    });
    return await Promise.race([Promise.resolve(request), timeout]);
  } finally { clearTimeout(timer); }
}

async function record(db, job, stage, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '').slice(0,24);
  const result = await db.rpc('record_fuel_national_projection_event', {
    p_id: job.id, p_token: job.lease_token, p_code: `${stage}_${code}`,
  });
  if (result.error || result.data !== true) throw new NationalPriceError('PROJECTION_DIAGNOSTIC_FAILED');
}

export async function optionalMetadata(db, job, timeoutMs = 5000) {
  const { data, error, status } = await boundedRpc(db, 'fuel_station_metadata_needed', { p_ids: job.station_ids }, timeoutMs);
  if (!error) return data;
  if (!isProjectionAvailabilityError(error, status)) throw new NationalPriceError('DATABASE_FUEL_STATION_METADATA_NEEDED_FAILED');
  await record(db, job, 'METADATA_DEFERRED', error);
  return false;
}

export async function publishArchivedProjection(db, job, stations, timeoutMs = 5000) {
  try {
    const { error } = await boundedRpc(db, 'publish_fuel_station_batch', { p_job_id: job.id, p_stations: stations }, timeoutMs);
    if (!error) return 'published';
    await record(db, job, 'SERVING_DEFERRED', error);
    return 'pending';
  } catch {
    // Research was already committed. Never fail/retry the provider job because
    // publishing or diagnostics are unavailable; the immutable manifest remains.
    return 'pending-unrecorded';
  }
}

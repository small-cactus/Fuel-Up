import { fetchNationalPriceBatch, compressSnapshot, NationalPriceError } from './nationalPriceTransport.mjs';

async function rpc(db, name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new NationalPriceError(`DATABASE_${name.toUpperCase()}_FAILED`);
  return data;
}

// One provider request is leased at a time across all workers. Small invocations
// can resume after a crash; cron creates only the present hour, never fake backfill.
export async function collectNationalPrices({ db, fetchBatch = fetchNationalPriceBatch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(), csrf }) {
  const started = now(), results = [];
  for (let i = 0; i < 8 && now() - started < 55_000; i++) {
    const jobs = await rpc(db, 'claim_fuel_national_job');
    const job = jobs?.[0]; if (!job) break;
    try {
      const snapshot = await fetchBatch(job.station_ids, { csrf });
      const compressed = await compressSnapshot(snapshot);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', compressed))].map(b => b.toString(16).padStart(2, '0')).join('');
      // Lease-specific immutable keys: a stale worker cannot overwrite a newer
      // observation. The DB manifest publishes only a successfully fenced write.
      const path = `${job.run_id}/${job.id}/${job.lease_token}.json.gz`;
      const { error } = await db.storage.from('fuel-national').upload(path, compressed, {
        contentType: 'application/gzip', upsert: false, cacheControl: '31536000' });
      if (error) throw new NationalPriceError('ARCHIVE_WRITE_FAILED');
      const priced = snapshot.stations.filter(s => s.prices.some(p => p.cash?.price > 0 || p.credit?.price > 0)).length;
      const saved = await rpc(db, 'finish_fuel_national_job', { p_id: job.id, p_token: job.lease_token,
        p_ids: snapshot.stations.map(s => s.id), p_started_at: snapshot.startedAt, p_observed_at: snapshot.observedAt,
        p_path: path, p_bytes: compressed.byteLength, p_sha256: hash, p_priced: priced });
      if (!saved) throw new NationalPriceError('LEASE_LOST');
      results.push({ id: job.id, status: 'succeeded', stations: snapshot.stations.length, priced });
    } catch (error) {
      const code = error instanceof NationalPriceError ? error.code : 'NETWORK_OR_RUNTIME_ERROR';
      await rpc(db, 'fail_fuel_national_job', { p_id: job.id, p_token: job.lease_token, p_code: code,
        p_retry_after_seconds: error instanceof NationalPriceError ? error.retryAfterSeconds : 0 });
      results.push({ id: job.id, status: 'failed', code });
      // Never continue a batch loop through a denial, including an HTTP 200
      // GraphQL error whose underlying access/rate status may be hidden.
      break;
    }
    await sleep(2000);
  }
  return results;
}

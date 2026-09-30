import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { validatePriceBatch } from '../../supabase/functions/_shared/nationalPriceBatch.mjs';

// Read-back verification of the actual immutable object, not merely its DB row.
export function auditArchive(bytes, job, run) {
  if (bytes.length !== Number(job.archive_bytes) || createHash('sha256').update(bytes).digest('hex') !== job.sha256) throw Error('Archive hash or size mismatch');
  const snapshot = JSON.parse(gunzipSync(bytes, { maxOutputLength: 16_000_000 }));
  if (snapshot.version !== 1 || snapshot.provider !== 'gasbuddy' || snapshot.executionRegion !== job.execution_region) throw Error('Archive provenance mismatch');
  if (snapshot.stations.length !== job.station_ids.length) throw Error('Archive station count mismatch');
  validatePriceBatch(Object.fromEntries(snapshot.stations.map((s,i)=>['s'+i,s])),job.station_ids);
  const started=Date.parse(snapshot.startedAt),observed=Date.parse(snapshot.observedAt);
  if (!Number.isFinite(started)||!Number.isFinite(observed)||started<Date.parse(run.slot_at)||observed<started||observed>Date.parse(run.deadline_at)
    ||started!==Date.parse(job.started_at)||observed!==Date.parse(job.observed_at)) throw Error('Archive observation window mismatch');
  const priced=snapshot.stations.filter(s=>s.prices.some(p=>p.cash?.price>0||p.credit?.price>0)).length;
  if(priced!==job.priced_count)throw Error('Archive priced count mismatch');
  return {stations:snapshot.stations.length,priced,bytes:bytes.length,executionRegion:snapshot.executionRegion,
    startedAt:snapshot.startedAt,observedAt:snapshot.observedAt,responseEvidence:snapshot.responseEvidence};
}

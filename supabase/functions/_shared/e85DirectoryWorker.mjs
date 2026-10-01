import { authorizedResearchRequest } from './researchCollector.mjs';
import { E85_SOURCES, parseE85Source } from './e85Sources.mjs';

export function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return 86400;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) ? Math.min(2147483647, Math.max(86400, seconds)) : 86400;
}
export function createE85DirectoryHandler({ secret, db, fetchImpl = fetch }) {
  return async request => {
    const reply = (body, status = 200) => Response.json(body, { status });
    if (!authorizedResearchRequest(request, secret)) return reply({ error: 'UNAUTHORIZED' }, 401);
    if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const results = [];
    for (const [source, config] of Object.entries(E85_SOURCES)) {
      const claim = await db.rpc('claim_fuel_e85_source', { p_source: source });
      if (claim.error) return reply({ error: 'CLAIM_FAILED' }, 503);
      if (!claim.data) { results.push({ source, status: 'not_due' }); continue; }
      let retry = 86400, disable = false;
      try {
        // Fresh anonymous request: the public map defaults to E85; no profile
        // cookie, pricing reports, API key, identity rotation or immediate retry.
        const response = await fetchImpl(config.url, { headers: { Accept: source === 'e85prices' ? 'application/json' : 'text/html' },
          signal: AbortSignal.timeout(30000), redirect: 'error' });
        retry = retryAfterSeconds(response.headers.get('retry-after'));
        disable = response.status === 401 || response.status === 403;
        if (!response.ok) throw Error(`SOURCE_HTTP_${response.status}`);
        const body = await response.text();
        if (body.length > 10_000_000) throw Error('SOURCE_TOO_LARGE');
        const parsed = parseE85Source(source, body);
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))].map(n => n.toString(16).padStart(2, '0')).join('');
        const imported = await db.rpc('import_fuel_e85_source', { p_source: source, p_token: claim.data,
          p_rows: parsed.rows, p_rejected: parsed.rejected, p_sha256: hash });
        if (imported.error) throw Error(`IMPORT_FAILED_${/^[A-Z0-9]+$/.test(imported.error.code || '') ? imported.error.code : 'UNKNOWN'}`);
        results.push({ ...imported.data, status: 'succeeded' });
      } catch (error) {
        const code = /^[A-Z_0-9]+$/.test(error?.message || '') ? error.message : 'SOURCE_REFRESH_FAILED';
        const failure = await db.rpc('fail_fuel_e85_source', { p_source: source, p_token: claim.data,
          p_error: code, p_retry_seconds: retry, p_disable: disable });
        results.push({ source, status: 'failed', code, failureRecorded: !failure.error });
      }
    }
    return reply({ results }, results.some(result => result.status === 'failed') ? 503 : 200);
  };
}

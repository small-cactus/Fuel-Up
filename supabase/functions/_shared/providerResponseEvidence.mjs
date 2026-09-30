// Allow-list metadata only: never retain cookies or authorization headers.
export function providerResponseEvidence(response, elapsedMs) {
  const headers = Object.fromEntries([...response.headers].filter(([name]) =>
    /^(retry-after|.*ratelimit.*|date|server|content-type|cf-mitigated|cf-ray|age|via|x-cache.*|x-request-id)$/.test(name)));
  return { status: response.status, observedAt: new Date().toISOString(), elapsedMs: Math.round(elapsedMs), headers };
}

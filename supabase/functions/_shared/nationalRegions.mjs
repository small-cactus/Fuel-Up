// These are Supabase's documented US Edge Function locations, not DB regions.
// Midwest/South use Virginia because a central/southern US edge location is not
// listed. This is a fixed ownership map, never an outage/throttle fallback map.
export const NATIONAL_REGIONS = Object.freeze({
  'us-east-1': { functionName: 'fuel-national-east', label: 'East, Midwest and South',
    states: 'AL AR CT DE DC FL GA IL IN IA KS KY LA ME MD MA MI MN MS MO NE NH NJ NY NC ND OH OK PA RI SC SD TN TX VT VA WV WI'.split(' ') },
  'us-west-1': { functionName: 'fuel-national-southwest', label: 'Southwest and Hawaii',
    states: 'AZ CA CO HI NV NM UT'.split(' ') },
  'us-west-2': { functionName: 'fuel-national-northwest', label: 'Northwest and Alaska',
    states: 'AK ID MT OR WA WY'.split(' ') },
});

export function executionRegionForState(state) {
  const region = Object.entries(NATIONAL_REGIONS).find(([, value]) => value.states.includes(state))?.[0];
  if (!region) throw Error(`No regional owner for ${state}`);
  return region;
}

export function verifyExecutionRegion(expected, actual) {
  if (!NATIONAL_REGIONS[expected]) return { code: 'INVALID_COLLECTOR_REGION', status: 503 };
  if (!actual) return { code: 'EXECUTION_REGION_UNAVAILABLE', status: 503 };
  if (actual !== expected) return { code: 'WRONG_EXECUTION_REGION', status: 409 };
  return null;
}

// Access eligibility only: never subtract an assumed membership discount from prices.
export const FUEL_MEMBERSHIPS = [
    { id: 'costco', label: 'Costco' },
    { id: 'sams', label: "Sam’s Club" },
    { id: 'bjs', label: "BJ’s Wholesale Club" },
    { id: 'walmart-plus', label: 'Walmart+', detail: 'Includes Sam’s Club gas access' },
];
export function normalizeFuelMemberships(values) {
    const valid = new Set(FUEL_MEMBERSHIPS.map(item => item.id));
    return [...new Set((Array.isArray(values) ? values : []).filter(id => valid.has(id)))].sort();
}
export function requiredFuelMembership(quote) {
    const names = [quote?.stationName, quote?.name, ...(quote?.brandNames || [])];
    for (const value of names) {
        const name = String(value || '').normalize('NFKC').toLowerCase().replace(/[’']/g, '').trim();
        if (/^costco(?:\s|$)/.test(name)) return 'costco';
        if (/^sams\s+club(?:\s|$)/.test(name)) return 'sams';
        if (/^bjs(?:\s+(?:wholesale(?:\s+club)?|gas|fuel))?$/.test(name)) return 'bjs';
    }
    return null;
}
export function canUseFuelStation(quote, memberships = []) {
    const required = requiredFuelMembership(quote);
    return !required || memberships.includes(required) || (required === 'sams' && memberships.includes('walmart-plus'));
}

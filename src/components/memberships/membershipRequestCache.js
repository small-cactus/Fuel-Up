const LOCATION_ERROR = 'Your US state could not be found. You can choose memberships later in Settings.';
const MEMBERSHIP_ERROR = 'Could not load memberships. Try again or choose them later in Settings.';

// Exact coordinates avoid sharing a state across a rounded cell on a state border.
export function membershipCoordinateKey(coordinate) {
    const { latitude, longitude } = coordinate || {};
    return Number.isFinite(latitude) && Number.isFinite(longitude)
        && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
        ? `${latitude}:${longitude}` : '';
}

export function createMembershipRequestCache({
    reverseGeocode, fetchMembershipIDs, normalizeState,
    now = Date.now, retryDelayMs = 1000,
    coordinateTTL = 5 * 60 * 1000, membershipTTL = 30 * 60 * 1000,
    maxEntries = 128,
}) {
    const coordinates = new Map();
    const memberships = new Map();
    const coordinateRequests = new Map();
    const stateRequests = new Map();

    function read(cache, key) {
        const entry = cache.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= now()) {
            cache.delete(key);
            return undefined;
        }
        cache.delete(key);
        cache.set(key, entry);
        return entry.value;
    }

    function write(cache, key, value, ttl) {
        cache.delete(key);
        cache.set(key, { value, expiresAt: now() + ttl });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    }

    function share(requests, key, request) {
        if (!requests.has(key)) {
            const pending = Promise.resolve().then(request).finally(() => requests.delete(key));
            requests.set(key, pending);
        }
        return requests.get(key);
    }

    async function stateFor(coordinate, key) {
        const cached = read(coordinates, key);
        if (cached !== undefined) return cached;
        const [address] = await reverseGeocode(coordinate);
        const state = address?.isoCountryCode === 'US' ? normalizeState(address.region) : null;
        if (!state) throw new Error(LOCATION_ERROR);
        write(coordinates, key, state, coordinateTTL);
        return state;
    }

    function idsFor(state) {
        const cached = read(memberships, state);
        if (cached !== undefined) return Promise.resolve(cached);
        return share(stateRequests, state, async () => {
            const { data, error } = await fetchMembershipIDs(state);
            if (error || !Array.isArray(data)) throw new Error(MEMBERSHIP_ERROR);
            write(memberships, state, data, membershipTTL);
            return data;
        });
    }

    return {
        peek(coordinate) {
            const key = membershipCoordinateKey(coordinate);
            const state = read(coordinates, key);
            const ids = state === undefined ? undefined : read(memberships, state);
            return ids === undefined ? null : { key, state, ids };
        },
        load(coordinate) {
            const key = membershipCoordinateKey(coordinate);
            if (!key) return Promise.reject(new Error(LOCATION_ERROR));
            // All consumers share both the request and its one transient retry.
            return share(coordinateRequests, key, async () => {
                for (let retry = 0; retry < 2; retry++) {
                    try {
                        const state = await stateFor(coordinate, key);
                        return { key, state, ids: await idsFor(state) };
                    } catch (error) {
                        if (retry === 1) throw error;
                        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                    }
                }
            });
        },
    };
}

// A small, bounded disk cache of rendered results, not raw station history.
// Storage is lazy so importing the price service never blocks app startup.
const STORAGE_KEY = 'fuelup:trends:v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
function createTrendSnapshotStore(storage, now = Date.now) {
    let entries = null, reading = null, generation = 0, writes = Promise.resolve();
    const fresh = entry => entry && Number.isFinite(entry.savedAt)
        && now() >= entry.savedAt && now() - entry.savedAt < MAX_AGE_MS;
    async function load() {
        if (entries) return;
        if (reading) return reading;
        const started = generation;
        reading = (async () => {
            let saved;
            try { saved = JSON.parse(await storage.getItem(STORAGE_KEY)); } catch { /* Offline cache is optional. */ }
            if (started !== generation) return;
            entries = new Map(Array.isArray(saved) ? saved.filter(item => Array.isArray(item)
                && typeof item[0] === 'string' && fresh(item[1])).slice(-8) : []);
        })().finally(() => { reading = null; });
        return reading;
    }
    function write() {
        const serialized = JSON.stringify([...entries]);
        writes = writes.then(() => storage.setItem(STORAGE_KEY, serialized)).catch(() => {});
        return writes;
    }
    return {
        async get(key) { await load(); const entry = entries?.get(key); return fresh(entry) ? entry.value : null; },
        async set(key, value) {
            const started = generation;
            await load();
            if (started !== generation) return;
            entries.delete(key);
            entries.set(key, { savedAt: now(), value });
            while (entries.size > 8) entries.delete(entries.keys().next().value);
            return write();
        },
        clear() {
            generation++;
            entries = new Map();
            return write();
        },
    };
}
function storage() {
    const module = require('@react-native-async-storage/async-storage');
    return module.default || module;
}
const trendSnapshotStore = createTrendSnapshotStore({
    getItem: async key => storage().getItem(key),
    setItem: async (key, value) => storage().setItem(key, value),
});
module.exports = { createTrendSnapshotStore, trendSnapshotStore };

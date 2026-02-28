const AsyncStorageModule = require('@react-native-async-storage/async-storage');
const AsyncStorage = AsyncStorageModule.default || AsyncStorageModule;

const memoryCache = new Map();

async function getMemoryEntry(key) {
    return memoryCache.get(key) || null;
}

async function setMemoryEntry(key, value) {
    memoryCache.set(key, value);
    return value;
}

async function getPersistedEntry(key) {
    try {
        const rawValue = await AsyncStorage.getItem(key);
        return rawValue ? JSON.parse(rawValue) : null;
    } catch (error) {
        return null;
    }
}

async function setPersistedEntry(key, value) {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        return value;
    }

    return value;
}

async function getCachedEntry(key) {
    const memoryEntry = await getMemoryEntry(key);

    if (memoryEntry) {
        return memoryEntry;
    }

    const persistedEntry = await getPersistedEntry(key);

    if (persistedEntry) {
        await setMemoryEntry(key, persistedEntry);
    }

    return persistedEntry;
}

async function setCachedEntry(key, value) {
    await setMemoryEntry(key, value);
    await setPersistedEntry(key, value);
    return value;
}

module.exports = {
    getCachedEntry,
    setCachedEntry,
};

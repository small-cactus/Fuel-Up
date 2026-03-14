const AsyncStorage = require('@react-native-async-storage/async-storage').default || require('@react-native-async-storage/async-storage');

const UUID_STORAGE_KEY = '@fuelup_user_uuid';

function generateUuidV4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

async function getUserUuid() {
    try {
        let uuid = await AsyncStorage.getItem(UUID_STORAGE_KEY);
        if (!uuid) {
            uuid = generateUuidV4();
            await AsyncStorage.setItem(UUID_STORAGE_KEY, uuid);
        }
        return uuid;
    } catch (error) {
        console.error('Error fetching or generating user UUID:', error);
        // Fallback to a temporary UUID for this session if storage fails
        return generateUuidV4();
    }
}

module.exports = {
    getUserUuid,
};

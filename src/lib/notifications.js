import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let hasConfiguredNotificationHandler = false;

function ensureNotificationHandlerConfigured() {
    if (hasConfiguredNotificationHandler) {
        return;
    }

    try {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldShowBanner: true,
                shouldShowList: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            }),
        });
        hasConfiguredNotificationHandler = true;
    } catch (error) {
        console.error('Failed to configure notification handler:', error);
    }
}

function getSupabaseClient() {
    try {
        const { supabase } = require('./supabase');
        return supabase || null;
    } catch (error) {
        console.error('Failed to load Supabase client:', error);
        return null;
    }
}

/**
 * Request notification permissions and get the raw APN device token on iOS (or FCM on Android).
 * This explicitly avoids Expo's Push service.
 * @returns {Promise<string|null>} The raw device push token.
 */
export async function registerForPushNotificationsAsync() {
    ensureNotificationHandlerConfigured();

    if (!Device.isDevice) {
        console.log('Must use physical device for Push Notifications');
        return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('Failed to get push token for push notification!');
        return null;
    }

    // Use the raw device push token rather than the Expo push token
    try {
        const tokenData = await Notifications.getDevicePushTokenAsync();
        let token = tokenData.data;

        // Sometimes raw APNs token is returned as an object depending on Expo version/config
        if (typeof token !== 'string') {
            token = String(token);
        }

        if (Platform.OS === 'android') {
            Notifications.setNotificationChannelAsync('default', {
                name: 'default',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#FF231F7C',
            });
        }

        return token;
    } catch (error) {
        console.error('Core error getting push token:', error);
        return null;
    }
}

/**
 * Saves a push token to Supabase for the current user/device.
 * @param {string} token - The raw device push token.
 */
export async function savePushTokenToSupabase(token) {
    if (!token) return { success: false, error: 'No token' };
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase not configured' };

    try {
        const { data, error } = await supabase
            .from('push_tokens')
            .upsert({ token }, { onConflict: 'token' });

        if (error) {
            console.error('Error saving push token:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (err) {
        console.error('Exception saving push token:', err);
        return { success: false, error: err.message };
    }
}

export async function scheduleTestNotification(title, body, delaySeconds = 0) {
    ensureNotificationHandlerConfigured();

    const notificationConfig = {
        content: {
            title,
            body,
            sound: true,
        },
        trigger: delaySeconds > 0 ? {
            type: 'timeInterval',
            seconds: delaySeconds
        } : null,
    };

    await Notifications.scheduleNotificationAsync(notificationConfig);
}

// ==========================================
// Live Activities (iOS 16.2+)
// ==========================================
let cachedPriceDropActivity = null;

function getPriceDropActivity() {
    if (cachedPriceDropActivity) {
        return cachedPriceDropActivity;
    }

    try {
        const loadedModule = require('./PriceDropActivity');
        cachedPriceDropActivity = loadedModule?.default || loadedModule;
        return cachedPriceDropActivity;
    } catch (error) {
        console.error('Failed to load PriceDropActivity module:', error);
        return null;
    }
}

/**
 * Starts a Live Activity for a price drop.
 * @param {string} stationName 
 * @param {string} price 
 * @returns {object|undefined} The Live Activity instance.
 */
export function startLiveActivity(stationName, price) {
    if (Platform.OS !== 'ios') return undefined;
    const PriceDropActivity = getPriceDropActivity();
    if (!PriceDropActivity) return undefined;

    try {
        console.log('Starting PriceDropActivity with:', { stationName, price });
        const instance = PriceDropActivity.start({
            stationName,
            price,
        });
        return instance;
    } catch (error) {
        console.error('Core error starting Live Activity:', error);
        return undefined;
    }
}

/**
 * Updates an active Live Activity.
 * @param {object} instance - The Live Activity instance returned by start.
 * @param {string} newPrice 
 */
export function updateLiveActivity(instance, newPrice) {
    if (Platform.OS !== 'ios' || !instance) return;

    try {
        instance.update({
            price: newPrice,
        });
    } catch (error) {
        console.error('Error updating Live Activity:', error);
    }
}

/**
 * Ends an active Live Activity.
 * @param {object} instance - The Live Activity instance returned by start.
 */
export function endLiveActivity(instance) {
    if (Platform.OS !== 'ios' || !instance) return;

    try {
        instance.end();
    } catch (error) {
        console.error('Error ending Live Activity:', error);
    }
}

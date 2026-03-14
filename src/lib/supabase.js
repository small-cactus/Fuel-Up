require('react-native-url-polyfill/auto');
const { createClient } = require('@supabase/supabase-js');

function getExpoExtra() {
    try {
        const constantsModule = require('expo-constants');
        const constants = constantsModule?.default || constantsModule;

        return (
            constants?.expoConfig?.extra ||
            constants?.manifest2?.extra ||
            constants?.manifest?.extra ||
            {}
        );
    } catch (error) {
        return {};
    }
}

function pickFirstNonEmpty(...values) {
    for (const value of values) {
        const normalizedValue = String(value || '').trim();
        if (normalizedValue) {
            return normalizedValue;
        }
    }

    return '';
}

const expoExtra = getExpoExtra();
const extraSupabase = expoExtra?.supabase || {};
const supabaseUrl = pickFirstNonEmpty(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    extraSupabase.url,
    expoExtra.EXPO_PUBLIC_SUPABASE_URL
);
const supabaseAnonKey = pickFirstNonEmpty(
    process.env.EXPO_PUBLIC_SUPABASE_KEY,
    extraSupabase.key,
    expoExtra.EXPO_PUBLIC_SUPABASE_KEY
);
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

let supabase = null;

if (hasSupabaseConfig) {
    try {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
    } catch (error) {
        console.error('Supabase client initialization failed:', error);
    }
} else {
    console.warn('Supabase credentials are missing. Remote sync features are disabled.');
}

module.exports = {
    supabase,
    hasSupabaseConfig,
};

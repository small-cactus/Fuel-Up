const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/loadComponent.cjs');

test('motion updates subscribe to the Expo native module and unsubscribe cleanly', () => {
    const listeners = new Map();
    const native = { addListener: (event, listener) => {
        listeners.set(event, listener);
        return { remove: () => listeners.delete(event) };
    } };
    const bridge = load('src/lib/predictiveDrivingActivity.js', {
        'react-native': { Platform: { OS: 'ios' } },
        'expo-modules-core': { requireOptionalNativeModule: () => native },
    });
    const received = [];
    const stop = bridge.subscribeToPredictiveDrivingActivityUpdates(value => received.push(value));
    assert.equal(listeners.size, 1);
    listeners.get('onActivityUpdate')({ automotive: true, confidence: 'high', timestamp: 123 });
    assert.equal(received[0].automotive, true);
    assert.equal(received[0].confidence, 'high');
    assert.equal(received[0].timestamp, 123);
    stop();
    assert.equal(listeners.size, 0);
});

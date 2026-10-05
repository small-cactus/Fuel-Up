const test = require('node:test');
const assert = require('node:assert/strict');
const { getTrendDirectionFromData } = require('../src/screens/trends/trendDirection');
test('declining national chart stays green even if the last bucket rose', () => {
    assert.equal(getTrendDirectionFromData({ averagePricesByDay: [{ price: 4 }, { price: 3 }, { price: 3.2 }], overallTrend: { delta: -0.8 } }), 'lower');
});
test('color follows the displayed observed delta in both directions', () => {
    assert.equal(getTrendDirectionFromData({ averagePricesByDay: [{ price: 3 }, { price: 4 }, { price: 3.8 }], overallTrend: { delta: 0.8 } }), 'higher');
    assert.equal(getTrendDirectionFromData({ averagePricesByDay: [{ price: 3 }, { price: 3 }] }), 'flat');
    assert.equal(getTrendDirectionFromData({ averagePricesByDay: [{ price: 3 }] }), null);
});

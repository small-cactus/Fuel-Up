import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioQuotes, chooseMinimaxStation } from '../scripts/price-model/robustMarketChoice.mjs';

test('minimax choice agrees with exhaustive scenario corners', () => {
    const quotes = [{stationId:'a',low:4,high:5},{stationId:'b',low:4.2,high:4.4},{stationId:'c',low:4.1,high:4.8}];
    const maximums=quotes.map(()=>0);
    for(let bits=0;bits<8;bits++) {
        const prices=quotes.map((row,i)=>bits&(1<<i)?row.high:row.low);
        prices.forEach((price,i)=>{maximums[i]=Math.max(maximums[i],price-Math.min(...prices));});
    }
    const chosen=chooseMinimaxStation(quotes);
    const index=quotes.findIndex(row=>row.stationId===chosen.stationId);
    assert.equal(maximums[index],Math.min(...maximums));
    assert.ok(Math.abs(chosen.scenarioWorstRegret-maximums[index])<1e-8);
});

test('midpoint minimizes worst absolute error within the supplied scenario interval', () => {
    const [row]=scenarioQuotes([{stationId:'a',rawPrice:4,scenarioHigh:5}]);
    assert.equal(row.predictedPrice,4.5);
    assert.equal(Math.max(row.high-row.predictedPrice,row.predictedPrice-row.low),.5);
    assert.equal(row.isEstimated,true);
});

test('wide uncertainty is retained and cannot masquerade as verified actual price', () => {
    const quotes=scenarioQuotes([{stationId:'cheap',rawPrice:4,scenarioHigh:5},{stationId:'other',rawPrice:4.3,scenarioHigh:4.3}]);
    const choice=chooseMinimaxStation(quotes);
    assert.equal(choice.stationId,'other');
    assert.equal(quotes[0].low,4);
    assert.equal(quotes[0].high,5);
    assert.equal(chooseMinimaxStation([]),null);
    assert.equal(chooseMinimaxStation([quotes[0]]).scenarioWorstRegret,0);
});

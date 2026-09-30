import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { estimateMarketLag } from './marketLag.mjs';
import { scenarioQuotes, chooseMinimaxStation } from './robustMarketChoice.mjs';
const require = createRequire(import.meta.url);
const { distribution } = require('./tailRisk.cjs');
const root = process.argv[2] || 'docs/research/2026-09-30-price-model';
const output = process.argv[3] || '/tmp/market-lag-results.json';
const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${root}/history-snapshot.json.gz`))).rows;
const ranking = JSON.parse(fs.readFileSync(process.argv[4] || '/tmp/fuelup-ranking-snapshots.json'));
const inputs = JSON.parse(fs.readFileSync(`${root}/openai-history-inputs.json`));
const valid = ['gpt-6-luna-none','gpt-5.6-terra-none','gpt-6.1-sol-low'].map(name => new Set(
    fs.readFileSync(`${root}/openai-history-${name}.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).filter(row => row.valid).map(row => row.case)));
const history = raw.flatMap(row => {
    const payment = row.all_prices?._payment?.[row.fuel_type];
    const method = Number(payment?.credit) > 0 ? 'credit' : 'cash';
    const price = payment?.[method];
    if (!Number.isFinite(price) || price <= 0) return [];
    return [{ stationId: String(row.station_id), brand: row.station_name, fuel: row.fuel_type, payment: method, price,
        observedAtMs: Date.parse(row.created_at), sourceAtMs: Date.parse(row.updated_at_source),
        bucket: `${row.search_latitude_rounded}|${row.search_longitude_rounded}` }];
}).sort((a,b) => a.observedAtMs-b.observedAtMs);
const rows = [], decisions = [];
for (const testCase of inputs.cases.filter(row => valid.every(ids => ids.has(row.case)))) {
    const [, lat, lon, fuel, payment] = testCase.batchId.split('|');
    const samples = ranking.samples.filter(row => `${row.snapshotId}|${row.payment}` === testCase.batchId);
    const nowMs = Date.parse(samples[0].observedAt);
    const peers = samples.map(row => ({ stationId: row.station, brand: row.stationName, fuel, payment,
        price: row.rawPrice, observedAtMs: nowMs, sourceAtMs: Date.parse(row.sourceAt) }));
    const past = history.filter(row => row.bucket === `${lat}|${lon}` && row.fuel===fuel && row.observedAtMs<nowMs && row.observedAtMs>=nowMs-14*24*3600000).slice(-1500);
    for (let index = 0; index < samples.length; index++) {
        const result = estimateMarketLag({ candidate: peers[index], peers, history: past, nowMs });
        decisions.push({ case: testCase.case, station: samples[index].station, ...result });
        if (samples[index].targetPrice !== null) rows.push({ target: samples[index].targetPrice,
            raw: samples[index].rawPrice, current_math: samples[index].mathPrice, market_lag: result.estimatedPrice });
    }
}
const metrics = (values, policies) => Object.fromEntries(policies.map(policy => {
    const error = values.map(row => Math.abs(row[policy]-row.target)*100);
    return [policy, { meanErrorCents: error.reduce((a,b)=>a+b,0)/error.length, tail: distribution(error) }];
}));

// Synthetic truth only: fixed seeded stress families, not a training set or evidence of pump accuracy.
let state=20260930;
const random=()=>{ state=(Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; };
const HOUR=3600000, nowMs=100*HOUR;
const makeQuote=(id,price,hour)=>({ stationId:id,brand:`brand-${Number(id.slice(1))%8}`,fuel:'premium',payment:'credit',price,observedAtMs:hour*HOUR,sourceAtMs:hour*HOUR });
const stress=[];
for (const family of ['stale_refreshed_timestamp','genuine_held_discount','tracks_market','stationary','market_falls']) {
    for (let trial=0;trial<100;trial++) {
        const movement=family==='stationary'?0:(family==='market_falls'?-1:1)*(.1+random()*1.4);
        const anchor=3+random()*2;
        // The target used to cost more than its cheapest neighbor. A frozen
        // report can now make it look cheapest although its true rank is worse.
        const history=Array.from({length:16},(_,i)=>makeQuote(`s${i}`,anchor+(i===0?.2:i*.02),76));
        const truePrices=history.map((row,i)=>row.price+(family==='genuine_held_discount'&&i===0?0:movement));
        const peers=history.map((row,i)=>makeQuote(row.stationId,family==='stale_refreshed_timestamp'&&i===0?row.price:truePrices[i],100));
        // A fresh timestamp is deliberately present on both real and false held quotes.
        const estimates=peers.map(candidate=>({stationId:candidate.stationId,...estimateMarketLag({candidate,peers,history,nowMs})}));
        const scenarios=scenarioQuotes(estimates);
        const robustChoice=chooseMinimaxStation(scenarios);
        const choose=price=>peers.reduce((best,row,i)=>price(i)<price(best)?i:best,0);
        const rawChoice=choose(i=>peers[i].price),modelChoice=choose(i=>estimates[i].estimatedPrice);
        stress.push({family,trial,quoteErrors:peers.map((row,i)=>({target:truePrices[i],raw:row.price,market_lag:estimates[i].estimatedPrice,scenario_midpoint:scenarios[i].predictedPrice})),
            rawRegret:Math.max(0,truePrices[rawChoice]-Math.min(...truePrices))*100,
            robustRegret:Math.max(0,truePrices[peers.findIndex(row=>row.stationId===robustChoice.stationId)]-Math.min(...truePrices))*100,
            modelRegret:Math.max(0,truePrices[modelChoice]-Math.min(...truePrices))*100});
    }
}
const synthetic=Object.fromEntries([...new Set(stress.map(row=>row.family))].map(family=>{
    const selected=stress.filter(row=>row.family===family);
    return [family,{scenarios:selected.length,price:metrics(selected.flatMap(row=>row.quoteErrors),['raw','market_lag','scenario_midpoint']),
        rawSelectionRegret:distribution(selected.map(row=>row.rawRegret)),modelSelectionRegret:distribution(selected.map(row=>row.modelRegret)),
        robustSelectionRegret:distribution(selected.map(row=>row.robustRegret)),
        meanTargetStationRawErrorCents:selected.reduce((s,row)=>s+Math.abs(row.quoteErrors[0].raw-row.quoteErrors[0].target)*100,0)/selected.length,
        meanTargetStationModelErrorCents:selected.reduce((s,row)=>s+Math.abs(row.quoteErrors[0].market_lag-row.quoteErrors[0].target)*100,0)/selected.length,
        meanTargetStationMidpointErrorCents:selected.reduce((s,row)=>s+Math.abs(row.quoteErrors[0].scenario_midpoint-row.quoteErrors[0].target)*100,0)/selected.length}];
}));
const reasons={}; for(const row of decisions)reasons[row.reason]=(reasons[row.reason]||0)+1;
const result={version:'market-lag-v1',parameters:{shrinkage:.75},
    historical:{labelledRows:rows.length,decisionRows:decisions.length,adjusted:decisions.filter(row=>row.isEstimated).length,
        reasons,metrics:metrics(rows,['raw','current_math','market_lag']),adjustments:decisions.filter(row=>row.isEstimated)},
    synthetic:{warning:'Simulated exact truth and chosen scenario mix. The scenario-midpoint/minimax candidate was derived after seeing the v1 held-discount failure; this is development evidence, not a held-out win or promotion gate.',seed:20260930,results:synthetic}};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
